/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents, absorbsIn, actionIn) */
/**
 * scan5/t83.ts — ticket T83, a MEASUREMENT for a ruling (no line is called
 * wrong): Power Word: Shield's DB2 family (`OWN_SHIELD_RULING_FAMILY_IDS`)
 * as a purge target. The purge-priority table (`SPELL_CATEGORIES`) registers
 * 17 and 1253593 as `buffs_defensive` (purge tier High) and not 1246768,
 * 1300008, 1300009. Each round once, read from the recorder's side: the runs
 * of a family aura on an ENEMY player.
 *
 *  - `shieldRun` (every kind out of the total; kind = `<id> <how it ended>`):
 *    one row per run. How it ended, first that applies — `purged` (a
 *    SPELL_DISPEL / SPELL_STOLEN row naming the id beside its end), `round
 *    end` (no REMOVED row), `ran out` (lasted the official length less
 *    0.3 s), `used up` (a SPELL_ABSORBED row of that shield beside its end),
 *    `other` (replaced, cancelled, the wearer died).
 *  - `purgeWindow` (out of the total): the product's own missed-purge
 *    windows on a family id (`reconstructDispelSummary`), by the one
 *    accusation that reads them — the desktop card `missed-purge-kill-window`
 *    (`mistakes.ts`: inside a kill window, `annotateMissedPurgesWithKillWindows`,
 *    and not `missedPurgeNotActionable`). Kind = `<id> card` or why it is
 *    none. An id the table does not register has no window — run this with
 *    the ids registered to read theirs.
 *
 * `report()` prints, per id: absorbed per run (median / p90, and as a share
 * of the wearer's largest logged max HP), run length, and how soon a family
 * shield is up again on that unit after a run that was purged or used up
 * (median seconds, share within 3 s); the purge windows by the purger specs
 * on the team; and the Curated-List forward check — aura ids seen on a
 * player that carry the name of a registered `buffs_defensive` id but are
 * not in the table themselves.
 */
import { OWN_SHIELD_RULING_FAMILY_IDS } from "@gladlog/analysis/src/data/ownShieldLinks";
import { SPELL_CATEGORIES } from "@gladlog/analysis/src/data/spellCategories";
import { buildAuraIntervals } from "@gladlog/analysis/src/utils/auraIntervals";
import {
  annotateMissedPurgesWithKillWindows,
  canOffensivePurge,
  getDispelType,
  missedPurgeNotActionable,
  reconstructDispelSummary,
} from "@gladlog/analysis/src/utils/dispelAnalysis";

import { computeOffensiveWindows } from "@gladlog/analysis/src/utils/offensiveWindows";

import { ev, fmtS, type IRoundCtx, nameOf, tsOf } from "./ctx";

export const CHECKS = ["shieldRun", "purgeWindow"] as const;

const ENDS = ["purged", "round end", "ran out", "used up", "other"] as const;
const DOORS = [
  "card",
  "kill window, not actionable",
  "no kill window, actionable",
  "no kill window, not actionable",
] as const;
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set(
  [...OWN_SHIELD_RULING_FAMILY_IDS].flatMap((id) => [
    ...ENDS.map((e) => `shieldRun|${id} ${e}`),
    ...DOORS.map((d) => `purgeWindow|${id} ${d}`),
  ]),
);

const OFFICIAL_S = 15;
const NEAR_MS = 150;

/** [id, how it ended, absorbed, max HP, length s, s to the family's next run
 *  on the unit (-1 = none)] */
type Run = [string, string, number, number, number, number];
let runs: Run[] = [];
/** `<id>|<door>|<purger specs on the team>` → windows */
let windows = new Map<string, number>();
/** `<id>|<name>` → [runs on any player, registered sibling's id] */
let unlisted = new Map<string, number>();
/** every `missed-purge-kill-window` card of the capture, any buff */
let cards = 0;

const registeredDefensiveNames = (() => {
  const m = new Map<string, string>();
  for (const [id, c] of Object.entries(SPELL_CATEGORIES))
    if ((c as any).type === "buffs_defensive") {
      const n = nameOf(id, "");
      if (n && !m.has(n)) m.set(n, id);
    }
  return m;
})();

export function run(ctx: IRoundCtx): void {
  if (!ctx.owner || !ctx.firstOwnerOfRound) return;
  const combat = {
    startTime: ctx.start,
    endTime: ctx.end,
    units: ctx.legacy.units,
  };
  const players = ctx.players as any[];
  const friends = players.filter((u) => u.reaction === ctx.owner.reaction);
  const enemies = players.filter((u) => u.reaction !== ctx.owner.reaction);

  for (const u of players) {
    const ivs = buildAuraIntervals(u, combat as any);
    // forward check: a registered defensive buff's name under an id the
    // table lacks
    for (const iv of ivs) {
      if (SPELL_CATEGORIES[iv.spellId] !== undefined) continue;
      const name = nameOf(iv.spellId, iv.spellName);
      const sibling = registeredDefensiveNames.get(name);
      if (!sibling && !OWN_SHIELD_RULING_FAMILY_IDS.has(iv.spellId)) continue;
      const k = `${iv.spellId}|${name}|${sibling ?? "family"}|${getDispelType(iv.spellId) ?? "none"}`;
      unlisted.set(k, (unlisted.get(k) ?? 0) + 1);
    }
    if (u.reaction === ctx.owner.reaction) continue;
    const family = ivs
      .filter((iv) => OWN_SHIELD_RULING_FAMILY_IDS.has(iv.spellId))
      .sort((a, b) => a.fromS - b.fromS);
    const maxHp = Math.max(
      0,
      ...((u.advancedActions ?? []) as any[]).map(
        (x) => x.advancedActorMaxHp ?? 0,
      ),
    );
    family.forEach((iv, i) => {
      const fromMs = ctx.start + iv.fromS * 1000;
      const toMs = ctx.start + iv.toS * 1000;
      const absorbRows = ((u.absorbsIn ?? []) as any[]).filter(
        (r) =>
          String(r.spellId) === iv.spellId &&
          tsOf(r) >= fromMs &&
          tsOf(r) <= toMs + NEAR_MS,
      );
      const absorbed = absorbRows.reduce(
        (n, r) => n + Math.abs(Number(r.absorbedAmount) || 0),
        0,
      );
      const purged = ((u.actionIn ?? []) as any[]).some(
        (x) =>
          (ev(x) === "SPELL_DISPEL" || ev(x) === "SPELL_STOLEN") &&
          String(x.extraSpellId) === iv.spellId &&
          Math.abs(tsOf(x) - toMs) <= NEAR_MS,
      );
      const end = purged
        ? "purged"
        : iv.inferredEnd
          ? "round end"
          : iv.toS - iv.fromS >= OFFICIAL_S - 0.3
            ? "ran out"
            : absorbRows.some((r) => Math.abs(tsOf(r) - toMs) <= NEAR_MS)
              ? "used up"
              : "other";
      const next = family.find((x, j) => j > i && x.fromS >= iv.toS - 0.05);
      runs.push([
        iv.spellId,
        end,
        absorbed,
        maxHp,
        iv.toS - iv.fromS,
        next ? next.fromS - iv.toS : -1,
      ]);
      ctx.bump("shieldRun");
      ctx.violate(
        "shieldRun",
        `${iv.spellId} ${end}`,
        fromMs,
        `${u.name}:${iv.spellId}:${iv.fromS.toFixed(3)}`,
        `${u.name} wore ${iv.spellId} ${fmtS(iv.fromS)}–${fmtS(iv.toS)}, ${Math.round(absorbed / 1000)}k absorbed`,
        "",
      );
    });
  }

  // the product's own windows and door
  let ds: ReturnType<typeof reconstructDispelSummary>;
  try {
    const fIds = new Set(friends.map((u) => u.id));
    const eIds = new Set(enemies.map((u) => u.id));
    const units = Object.values(ctx.legacy.units) as any[];
    ds = reconstructDispelSummary(
      friends,
      enemies,
      ctx.legacy,
      units.filter((u) => u.ownerId && fIds.has(u.ownerId)),
      units.filter((u) => u.ownerId && eIds.has(u.ownerId)),
    );
  } catch {
    return;
  }
  const specs = friends
    .filter((u) => canOffensivePurge(u, Object.values(ctx.legacy.units) as any))
    .map((u) => String(u.spec))
    .sort()
    .join("+");
  try {
    annotateMissedPurgesWithKillWindows(
      ds.missedPurgeWindows,
      computeOffensiveWindows(enemies, friends, ctx.legacy),
    );
  } catch {
    return;
  }
  for (const w of ds.missedPurgeWindows) {
    // the desktop card's own selection (`mistakes.ts`): inside a kill
    // window and not `missedPurgeNotActionable`
    const why = missedPurgeNotActionable(w);
    const actionable = !(
      why.lockedOut ||
      why.noReach ||
      why.onCooldownThroughout
    );
    if (w.duringKillWindow && actionable) cards++;
    if (!OWN_SHIELD_RULING_FAMILY_IDS.has(w.spellId)) continue;
    const door = w.duringKillWindow
      ? actionable
        ? "card"
        : "kill window, not actionable"
      : actionable
        ? "no kill window, actionable"
        : "no kill window, not actionable";
    ctx.bump("purgeWindow");
    ctx.violate(
      "purgeWindow",
      `${w.spellId} ${door}`,
      ctx.start + w.timeSeconds * 1000,
      `${w.enemyName}:${w.spellId}:${w.timeSeconds.toFixed(3)}`,
      `${w.spellId} on ${w.enemyName} at ${fmtS(w.timeSeconds)} for ${w.durationSeconds.toFixed(1)}s, priority ${w.priority}, purger specs ${specs || "none"}`,
      "",
    );
    const k = `${w.spellId}|${door}|${specs || "none"}`;
    windows.set(k, (windows.get(k) ?? 0) + 1);
  }
}

const q = (xs: number[], p: number): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
};
const k1 = (n: number) => (Number.isNaN(n) ? "-" : `${(n / 1000).toFixed(0)}k`);
const pct = (n: number) => (Number.isNaN(n) ? "-" : `${(n * 100).toFixed(1)}%`);
const s1 = (n: number) => (Number.isNaN(n) ? "-" : `${n.toFixed(1)}s`);

export function report(): string[] {
  const out: string[] = [
    "t83 shield runs on enemy players (each round once) — id: runs | absorbed per run median / p90 (share of max HP median / p90) | share of runs that absorbed nothing | length median / p90 | ends | after purged: runs, re-up median, ≤3 s | after used up: runs, re-up median, ≤3 s",
  ];
  for (const id of OWN_SHIELD_RULING_FAMILY_IDS) {
    const rs = runs.filter((r) => r[0] === id);
    if (!rs.length) {
      out.push(`  ${id}: 0 runs`);
      continue;
    }
    const abs = rs.map((r) => r[2]);
    const share = rs.filter((r) => r[3] > 0).map((r) => r[2] / r[3]);
    const ends = ENDS.map(
      (e) => `${e} ${rs.filter((r) => r[1] === e).length}`,
    ).join(", ");
    const reup = (e: string) => {
      const of = rs.filter((r) => r[1] === e);
      const gaps = of.filter((r) => r[5] >= 0).map((r) => r[5]);
      return `${of.length}, ${s1(q(gaps, 0.5))}, ${of.length ? pct(gaps.filter((g) => g <= 3).length / of.length) : "-"} (never again ${of.length - gaps.length})`;
    };
    out.push(
      `  ${id} ${nameOf(id, id)}: ${rs.length} | ${k1(q(abs, 0.5))} / ${k1(q(abs, 0.9))} (${pct(q(share, 0.5))} / ${pct(q(share, 0.9))}) | ${pct(abs.filter((a) => a === 0).length / rs.length)} | ${s1(
        q(
          rs.map((r) => r[4]),
          0.5,
        ),
      )} / ${s1(
        q(
          rs.map((r) => r[4]),
          0.9,
        ),
      )} | ${ends} | ${reup("purged")} | ${reup("used up")}`,
    );
  }
  out.push(
    `t83 product missed-purge windows on a family id (all missed-purge-kill-window cards of the capture, any buff: ${cards}) — id door: windows by purger specs on the team`,
  );
  const byIdDoor = new Map<string, Array<[string, number]>>();
  for (const [k, n] of windows) {
    const [id, door, specs] = k.split("|");
    const key = `${id} ${door}`;
    byIdDoor.set(key, [...(byIdDoor.get(key) ?? []), [specs!, n]]);
  }
  for (const [key, list] of [...byIdDoor].sort()) {
    list.sort((a, b) => b[1] - a[1]);
    out.push(
      `  ${key}: ${list.reduce((n, x) => n + x[1], 0)} — ${list
        .slice(0, 12)
        .map(([s, n]) => `${s}: ${n}`)
        .join(", ")}`,
    );
  }
  out.push(
    "t83 forward check — aura ids on a player that are not in SPELL_CATEGORIES and carry a registered buffs_defensive id's name (or are in the shield family): id name | registered sibling | DB2 dispel type | runs",
  );
  for (const [k, n] of [...unlisted].sort((a, b) => b[1] - a[1])) {
    const [id, name, sibling, type] = k.split("|");
    out.push(`  ${id} ${name} | ${sibling} | ${type} | ${n}`);
  }
  return out;
}

export const state = () => ({ runs, windows, unlisted, cards });
export const load = (s: ReturnType<typeof state>): void => {
  ({ runs, windows, unlisted, cards } = s);
};

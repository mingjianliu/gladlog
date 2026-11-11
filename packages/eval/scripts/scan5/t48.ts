/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units) */
/**
 * scan5/t48.ts — pipeline T48 (GH #123.10 / #123.8): a talent that SHORTENS
 * an effect, missing from the duration model. 60bfdea9: `Invoke Chi-Ji, the
 * Red Crane [60s, lasts 25s]` for a Gift of the Celestials holder whose two
 * Chi-Ji lived 12.15 s and 12.05 s (DB2 388212 effect 1: aura 107 misc 1
 * −13000 ms on the celestials' mask; 25 − 13 = 12).
 *
 * Check `shortenedDuration`. The pairs are DB2's own: every
 * `talentEffectInventoryGenerated.json` row with SpellModOp 1 (duration),
 * aura 107 / 108 (mask) or 219 / 218 (label), a negative value and a resolved
 * target. Per round, for each player who holds the talent
 * (`talentModifierOwnershipOf` = yes, a lookup) the scan reads the effect's
 * clean lives, never from the model:
 *  - an aura of the target id the player applied: `cleanAuraRuns` over the
 *    carrier's parsed aura rows — the product's reading (`buildAuraIntervals`:
 *    a REMOVED → APPLIED re-broadcast is one run, a REFRESH makes the run
 *    unclean), the reader `buffDurationScan --per-app` uses;
 *  - a SPELL_SUMMON of the target id by the player → that creature's
 *    UNIT_DIED (raw rows).
 * A life something else ended is no duration sample and is dropped
 * (`forcedEnd`, codex 85-tk-G-T48-1 #1): a SPELL_DISPEL / SPELL_STOLEN of the
 * aura on its carrier at its end, the carrier's or the caster's death within
 * a second of it, the round's end within a second, or an immunity applied to
 * the carrier at its end (codex 85-tk-G-T48-1b #1: Cloak of Shadows and
 * Divine Shield take debuffs off with no SPELL_DISPEL row; `IMMUNITY_IDS`),
 * or a control that clears damage-over-time effects landing on it
 * (`DOT_CLEARING_APPLICATIONS`, codex 85-tk-G-T48-1c #2).
 * Counted: every such life whose target the model prices
 * (`buffFullDurationForCaster` for this caster, at the application).
 * Violation `shortLife`, only for a pair no duration table carries
 * (`BUFF_DURATION_TALENT_MODIFIERS`, `TOOLTIP_DURATION_ROWS`,
 * `CC_DURATION_TALENT_MODIFIERS` — a table lookup: a priced pair's model
 * length already is the cut one, and a second cut would only match early
 * removals): the life sits within ±0.6 s of the model's length with DB2's
 * row applied to it (flat: + value; percent: × (1 + value)), per rank read
 * from COMBATANT_INFO, while the model's length is ≥ 1 s away from that.
 *
 * `report()` prints one row per (talent → target) pair with holder lives:
 * how many sit at the model's length and how many at the cut one — the
 * corpus leg of the Game-Behaviour Rule for a reduction, whose mechanism is
 * the DB2 row (rule 7).
 */
import {
  BUFF_DURATION_TALENT_MODIFIERS,
  CC_DURATION_TALENT_MODIFIERS,
} from "@gladlog/analysis/src/data/spellEffectData";
import { TOOLTIP_DURATION_ROWS } from "@gladlog/analysis/src/data/talentDurationTooltips";
import INVENTORY from "@gladlog/analysis/src/data/talentEffectInventoryGenerated.json";
import { buffFullDurationForCaster } from "@gladlog/analysis/src/utils/buffDuration";
import { IMMUNITY_IDS } from "@gladlog/analysis/src/utils/enemyDefensives";
import {
  parseRawTimestamp,
  splitRawLine,
} from "@gladlog/analysis/src/utils/rawStreams";
import {
  talentModifierOwnershipOf,
  talentRankOf,
} from "@gladlog/analysis/src/utils/talentOwnership";

import { builderNewApplication, cleanAuraRuns } from "../lib/auraRuns";
import { type IRoundCtx, nameOf } from "./ctx";

export const CHECKS = ["shortenedDuration"] as const;

interface IInvRow {
  spellId: string;
  aura: number;
  misc0: number;
  basePoints: number;
  pvpMultiplier?: number;
  targets?: { spellId: string }[];
}
export interface IShortening {
  talent: string;
  target: string;
  /** "flat" seconds (negative) or "pct" percent (negative) */
  kind: "flat" | "pct";
  value: number;
}

/** DB2's duration reductions, one per (talent, target); the larger cut when a
 * talent carries two rows on one target */
export const SHORTENINGS: IShortening[] = (() => {
  const out = new Map<string, IShortening>();
  for (const r of (INVENTORY as unknown as { rows: IInvRow[] }).rows) {
    if (r.misc0 !== 1 || ![107, 108, 218, 219].includes(r.aura)) continue;
    const raw = r.basePoints * (r.pvpMultiplier ?? 1);
    if (!(raw < 0)) continue;
    const kind = r.aura === 107 || r.aura === 219 ? "flat" : "pct";
    const value = kind === "flat" ? raw / 1000 : raw;
    for (const t of r.targets ?? []) {
      const k = `${r.spellId}|${t.spellId}`;
      const had = out.get(k);
      if (!had || value < had.value)
        out.set(k, { talent: r.spellId, target: t.spellId, kind, value });
    }
  }
  return [...out.values()];
})();
const BY_TARGET = new Map<string, IShortening[]>();
for (const s of SHORTENINGS)
  BY_TARGET.set(s.target, [...(BY_TARGET.get(s.target) ?? []), s]);

/** is (talent → target) a row of one of the duration tables? */
export const isPriced = (s: IShortening): boolean =>
  [
    BUFF_DURATION_TALENT_MODIFIERS,
    TOOLTIP_DURATION_ROWS,
    CC_DURATION_TALENT_MODIFIERS,
  ].some((table) =>
    (table[s.target] ?? []).some((m) => m.talentSpellId === s.talent),
  );

const TOL_S = 0.6;
const MIN_GAP_S = 1;

interface IRawRow {
  ms: number;
  event: string;
  src: string;
  dest: string;
  /** the summoned id; for a dispel / steal, the aura taken off; for an
   * application, the immunity applied */
  spellId: string;
}
const EVENTS = new Set([
  "SPELL_SUMMON",
  "SPELL_DISPEL",
  "SPELL_STOLEN",
  "UNIT_DIED",
  "SPELL_AURA_APPLIED",
]);
const DISPELS = new Set(["SPELL_DISPEL", "SPELL_STOLEN"]);
/** auras whose application takes the damage-over-time effects off their
 * target with no SPELL_DISPEL row. Scatter Shot 213691 (tooltip: removes all
 * harmful damage over time effects; 605: two Virulent Plague lives ended at
 * its application's own timestamp, 144-4-837 and 137-1-755). A scan-side
 * list of what is NOT a duration sample — it gates no product reading. */
export const DOT_CLEARING_APPLICATIONS: ReadonlySet<string> = new Set([
  "213691",
]);

export function rowsOf(rawLines: string[]): IRawRow[] {
  const rows: IRawRow[] = [];
  for (const l of rawLines) {
    // cheap reject before the split
    if (
      !l.includes("SPELL_SUMMON") &&
      !l.includes("SPELL_DISPEL") &&
      !l.includes("SPELL_STOLEN") &&
      !l.includes("UNIT_DIED") &&
      !l.includes("SPELL_AURA_APPLIED")
    )
      continue;
    const parts = splitRawLine(l);
    if (!parts || !EVENTS.has(parts.eventName)) continue;
    // a dispel names the aura it took in its extra spell id
    const spellId =
      (DISPELS.has(parts.eventName) ? parts.params[11] : parts.params[8]) ?? "";
    // an application is kept only when it is an immunity's
    if (parts.eventName === "SPELL_AURA_APPLIED") {
      if (!IMMUNITY_IDS.has(spellId) && !DOT_CLEARING_APPLICATIONS.has(spellId))
        continue;
    } else if (parts.eventName !== "UNIT_DIED" && !BY_TARGET.has(spellId))
      continue;
    const ms = parseRawTimestamp(parts.datePart);
    if (ms === null) continue;
    rows.push({
      ms,
      event: parts.eventName,
      src: parts.params[0] ?? "",
      dest: parts.params[4] ?? "",
      spellId,
    });
  }
  return rows;
}

export interface ILife {
  startMs: number;
  endMs: number;
  /** the aura's carrier, or the summoned creature */
  dest: string;
  summon?: true;
}

/** `casterId`'s summons of `target`: SPELL_SUMMON → that creature's
 * UNIT_DIED */
export function summonLives(
  rows: IRawRow[],
  casterId: string,
  target: string,
): ILife[] {
  const lives: ILife[] = [];
  const summoned = new Map<string, number>();
  for (const r of rows) {
    if (r.event === "UNIT_DIED") {
      const at = summoned.get(r.dest);
      if (at !== undefined) {
        lives.push({ startMs: at, endMs: r.ms, dest: r.dest, summon: true });
        summoned.delete(r.dest);
      }
    } else if (
      r.event === "SPELL_SUMMON" &&
      r.spellId === target &&
      r.src === casterId
    )
      summoned.set(r.dest, r.ms);
  }
  return lives;
}

/** every clean run of `target` in the round, on every carrier: the shared
 * reader (`cleanAuraRuns` with the builder's split) */
export function auraLives(units: any[], target: string): ILife[] {
  const byId: Record<string, any> = {};
  for (const u of units) byId[u.id] = u;
  const isNewApplication = builderNewApplication(byId, target);
  const lives: (ILife & { src: string })[] = [];
  for (const u of units) {
    const rows = ((u.auraEvents ?? []) as any[]).filter(
      (a) => a.spellId === target && a.destUnitId === u.id,
    );
    if (rows.length === 0) continue;
    for (const r of cleanAuraRuns(rows, { isNewApplication }))
      lives.push({
        src: r.srcUnitId,
        startMs: r.fromMs,
        endMs: r.toMs,
        dest: String(u.id),
      });
  }
  return lives;
}

const FORCED_END_MS = 1000;
const DISPEL_AT_END_MS = 100;

/** did something other than the duration end this life? */
export function forcedEnd(
  life: ILife,
  target: string,
  casterId: string,
  rows: IRawRow[],
  roundEndMs: number,
): boolean {
  if (roundEndMs - life.endMs < FORCED_END_MS) return true;
  return rows.some((r) => {
    if (r.event === "UNIT_DIED")
      return (
        // a summon's own death row is its end, not a forced one
        ((!life.summon && r.dest === life.dest) || r.dest === casterId) &&
        Math.abs(r.ms - life.endMs) < FORCED_END_MS
      );
    if (r.event === "SPELL_AURA_APPLIED")
      // rowsOf keeps the applications that take debuffs off only
      return (
        r.dest === life.dest && Math.abs(r.ms - life.endMs) <= DISPEL_AT_END_MS
      );
    return (
      DISPELS.has(r.event) &&
      r.spellId === target &&
      r.dest === life.dest &&
      Math.abs(r.ms - life.endMs) <= DISPEL_AT_END_MS
    );
  });
}

/** pair → [lives, at the model's length, at the cut length] */
let pairs = new Map<string, number[]>();

/** dropped as forced ends, per pair — printed, never counted */
let forced = new Map<string, number>();

export function run(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  let rows: IRawRow[] | undefined;
  const auraCache = new Map<string, ReturnType<typeof auraLives>>();
  const roundEndMs = Math.min(ctx.end, ctx.roundEndAt);
  for (const u of ctx.players as any[]) {
    for (const s of SHORTENINGS) {
      if (talentModifierOwnershipOf(u, s.talent) !== "yes") continue;
      rows ??= rowsOf(ctx.rawLines);
      let ofTarget = auraCache.get(s.target);
      if (!ofTarget) {
        ofTarget = auraLives(ctx.units, s.target);
        auraCache.set(s.target, ofTarget);
      }
      const casterId = String(u.id);
      const k = `${s.talent}|${s.target}`;
      const lives = [
        ...(ofTarget as (ILife & { src: string })[]).filter(
          (l) => l.src === casterId,
        ),
        ...summonLives(rows, casterId, s.target),
      ].filter((l) => {
        if (!forcedEnd(l, s.target, casterId, rows!, roundEndMs)) return true;
        forced.set(k, (forced.get(k) ?? 0) + 1);
        return false;
      });
      if (lives.length === 0) continue;
      const rank = Math.max(1, talentRankOf(u, s.talent));
      const priced = isPriced(s);
      for (const l of lives) {
        const life = {
          startMs: l.startMs,
          seconds: (l.endMs - l.startMs) / 1000,
        };
        const model = buffFullDurationForCaster(s.target, u, life.startMs);
        if (model === undefined) continue;
        ctx.bump("shortenedDuration");
        const cut =
          s.kind === "flat"
            ? model + s.value * rank
            : model * (1 + (s.value / 100) * rank);
        const tally = pairs.get(k) ?? [0, 0, 0];
        tally[0]!++;
        const atModel = Math.abs(life.seconds - model) <= TOL_S;
        // a priced pair's model length is the cut one
        const atCut =
          !priced && cut > 0 && Math.abs(life.seconds - cut) <= TOL_S;
        if (atModel) tally[1]!++;
        if (atCut && !atModel) tally[2]!++;
        pairs.set(k, tally);
        if (atCut && !priced && Math.abs(model - cut) >= MIN_GAP_S)
          ctx.violate(
            "shortenedDuration",
            "shortLife",
            life.startMs,
            `${u.id}|${s.target}|${life.startMs}`,
            `${nameOf(s.target, s.target)} lived ${life.seconds.toFixed(1)}s for a ${nameOf(s.talent, s.talent)} holder: model ${model}s, DB2 ${s.kind === "flat" ? `${s.value}s` : `${s.value}%`} → ${Math.round(cut * 10) / 10}s`,
          );
      }
    }
  }
}

export function report(): string[] {
  const out = [
    "shortening pairs with holder lives (lives / at model / at cut; forced ends dropped):",
  ];
  for (const [k, [n, atModel, atCut]] of [...pairs].sort(
    (a, b) => b[1][0]! - a[1][0]!,
  )) {
    const [talent, target] = k.split("|");
    const s = SHORTENINGS.find(
      (x) => x.talent === talent && x.target === target,
    )!;
    out.push(
      `  ${nameOf(talent, talent)} ${talent} → ${nameOf(target, target)} ${target} (${s.kind} ${s.value}${isPriced(s) ? ", priced" : ""}): ${n} / ${atModel} / ${atCut}; ${forced.get(k) ?? 0}`,
    );
  }
  return out;
}
export const state = () => ({ pairs, forced });
export const load = (s: ReturnType<typeof state>): void => {
  pairs = s.pairs;
  forced = s.forced;
};
export const merge = {
  pairs: (a: Map<string, number[]>, b: Map<string, number[]>) => {
    for (const [k, v] of b) {
      const had = a.get(k);
      a.set(k, had ? had.map((x, i) => x + (v[i] ?? 0)) : v);
    }
    return a;
  },
  forced: (a: Map<string, number>, b: Map<string, number>) => {
    for (const [k, v] of b) a.set(k, (a.get(k) ?? 0) + v);
    return a;
  },
};

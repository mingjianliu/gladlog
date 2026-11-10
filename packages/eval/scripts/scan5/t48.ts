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
 * clean lives from the round's raw rows, never from the model:
 *  - an aura of the target id the player applied: APPLIED → REMOVED with no
 *    REFRESH of it between;
 *  - a SPELL_SUMMON of the target id by the player → that creature's
 *    UNIT_DIED.
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
import {
  parseRawTimestamp,
  splitRawLine,
} from "@gladlog/analysis/src/utils/rawStreams";
import {
  talentModifierOwnershipOf,
  talentRankOf,
} from "@gladlog/analysis/src/utils/talentOwnership";

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
  spellId: string;
}
const EVENTS = new Set([
  "SPELL_AURA_APPLIED",
  "SPELL_AURA_REMOVED",
  "SPELL_AURA_REFRESH",
  "SPELL_SUMMON",
  "UNIT_DIED",
]);

function rowsOf(rawLines: string[]): IRawRow[] {
  const rows: IRawRow[] = [];
  for (const l of rawLines) {
    // cheap reject before the split
    if (
      !l.includes("SPELL_AURA_") &&
      !l.includes("SPELL_SUMMON") &&
      !l.includes("UNIT_DIED")
    )
      continue;
    const parts = splitRawLine(l);
    if (!parts || !EVENTS.has(parts.eventName)) continue;
    const spellId = parts.params[8] ?? "";
    if (parts.eventName !== "UNIT_DIED" && !BY_TARGET.has(spellId)) continue;
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

/** the clean lives of `target` produced by `casterId`, in seconds, with the
 * start (epoch ms, the parsed events' clock) */
export function cleanLives(
  rows: IRawRow[],
  casterId: string,
  target: string,
): { startMs: number; seconds: number }[] {
  const lives: { startMs: number; seconds: number }[] = [];
  const open = new Map<string, number | null>(); // dest → start, null = dirty
  const summoned = new Map<string, number>();
  for (const r of rows) {
    if (r.event === "UNIT_DIED") {
      const at = summoned.get(r.dest);
      if (at !== undefined) {
        lives.push({ startMs: at, seconds: (r.ms - at) / 1000 });
        summoned.delete(r.dest);
      }
      continue;
    }
    if (r.spellId !== target || r.src !== casterId) continue;
    if (r.event === "SPELL_SUMMON") summoned.set(r.dest, r.ms);
    else if (r.event === "SPELL_AURA_APPLIED") open.set(r.dest, r.ms);
    else if (r.event === "SPELL_AURA_REFRESH") {
      if (open.has(r.dest)) open.set(r.dest, null);
    } else {
      const at = open.get(r.dest);
      if (at !== undefined && at !== null)
        lives.push({ startMs: at, seconds: (r.ms - at) / 1000 });
      open.delete(r.dest);
    }
  }
  return lives;
}

/** pair → [lives, at the model's length, at the cut length] */
let pairs = new Map<string, number[]>();

export function run(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  let rows: IRawRow[] | undefined;
  for (const u of ctx.players as any[]) {
    for (const s of SHORTENINGS) {
      if (talentModifierOwnershipOf(u, s.talent) !== "yes") continue;
      rows ??= rowsOf(ctx.rawLines);
      const lives = cleanLives(rows, String(u.id), s.target);
      if (lives.length === 0) continue;
      const rank = Math.max(1, talentRankOf(u, s.talent));
      const priced = isPriced(s);
      for (const life of lives) {
        const model = buffFullDurationForCaster(s.target, u, life.startMs);
        if (model === undefined) continue;
        ctx.bump("shortenedDuration");
        const cut =
          s.kind === "flat"
            ? model + s.value * rank
            : model * (1 + (s.value / 100) * rank);
        const k = `${s.talent}|${s.target}`;
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
    "shortening pairs with holder lives (lives / at model / at cut):",
  ];
  for (const [k, [n, atModel, atCut]] of [...pairs].sort(
    (a, b) => b[1][0]! - a[1][0]!,
  )) {
    const [talent, target] = k.split("|");
    const s = SHORTENINGS.find(
      (x) => x.talent === talent && x.target === target,
    )!;
    out.push(
      `  ${nameOf(talent, talent)} ${talent} → ${nameOf(target, target)} ${target} (${s.kind} ${s.value}${isPriced(s) ? ", priced" : ""}): ${n} / ${atModel} / ${atCut}`,
    );
  }
  return out;
}
export const state = () => ({ pairs });
export const load = (s: ReturnType<typeof state>): void => {
  pairs = s.pairs;
};
export const merge = {
  pairs: (a: Map<string, number[]>, b: Map<string, number[]>) => {
    for (const [k, v] of b) {
      const had = a.get(k);
      a.set(k, had ? had.map((x, i) => x + (v[i] ?? 0)) : v);
    }
    return a;
  },
};

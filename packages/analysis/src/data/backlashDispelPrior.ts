/**
 * Backlash-dispel reference (corpus-derived, GENERATED json) — GH #80, user
 * approval 2026-09-12 ("做出来看看是否对游戏建议有真正的帮助").
 *
 * "When a friendly dispelled Unstable Affliction / Vampiric Touch off a
 * teammate, what did it cost and what did it buy?" — per debuff, measured
 * over the 12.1 archive by `packages/eval/scripts/backlashDispelOutcomeProbe.ts`:
 *   removedK      damage from the debuff's caster on the target in the 15 s
 *                 after the decision, left-on minus dispelled (all damage,
 *                 periodic + direct — Malefic Rapture scales with DoT count)
 *   healLostK     the dispeller's healing output 4 s after vs before, net of
 *                 the left-on reference dispeller's own before/after
 *   backlashDmgK  damage taken by the dispeller 4 s after vs before
 *   ccExposureS   extra seconds of dispellable hard CC on ANY teammate inside
 *                 the 8 s dispel cooldown that no capable dispeller could
 *                 answer, dispelled minus left-on
 *   backlashKind  what lands on the dispeller: UA silences (196364, 4 s),
 *                 VT horrifies (87204 Sin and Punishment, 3 s — the registered
 *                 34914 was stale, corpus 2026-09-12: 88 % vs 0.4 %)
 * The `immunity` lists are corpus-MINED, not hand-written (Curated-List rule):
 * a buff on the dispeller under which the backlash aura landed < 35 % as
 * often as baseline (n ≥ 40). UA (silence) and VT (horror) have different
 * sets — interrupt immunities block the silence, CC immunities block the
 * horror — which is exactly why the list cannot be typed from memory.
 *
 * Rating is NOT a key (user ruling 2026-09-11: no rating buckets — small
 * future corpora, buckets drift within a season).
 *
 * Regenerate (REQUIRED after any change to `backlashDispelDecisionPoints`):
 *   npx tsx packages/eval/scripts/backlashDispelOutcomeProbe.ts scan …
 *   npx tsx packages/eval/scripts/backlashDispelOutcomeProbe.ts emit-table --in <scan.jsonl> \
 *     > /tmp/table.json && cp /tmp/table.json packages/analysis/src/data/backlashDispelPriorGenerated.json
 * (temp-then-cp — never `>` directly into the imported json.)
 */
import raw from "./backlashDispelPriorGenerated.json";
import { BEHAVIOR_PRIOR_N_FLOOR } from "./behaviorPrior";

/** Same n floor as the crisis/burst/sync references — imported, never re-typed. */
export const BACKLASH_PRIOR_N_FLOOR = BEHAVIOR_PRIOR_N_FLOOR;

export interface BacklashPriorRef {
  spellId: string;
  /** dispelled-and-pure opportunities behind the numbers */
  n: number;
  /** left-on opportunities behind the numbers */
  nLeft: number;
  removedK: number;
  healLostK: number;
  backlashDmgK: number;
  ccExposureS: number;
  backlashKind: "silence" | "horror";
  backlashS: number;
}

/** The "worth dispelling" cell for a debuff: left-on vs dispelled outcome in
 * the stratum where the dispel is net positive (VT: target 40–60 % HP with
 * ≥ 3 of the caster's DoTs on them). */
export interface BacklashWorthRef {
  spellId: string;
  nD: number;
  nL: number;
  deathDPct: number;
  deathLPct: number;
  netK: number;
}

interface RawCell {
  n?: number;
  nLeft?: number;
  removedK?: number;
  healLostK?: number;
  backlashDmgK?: number;
  ccExposureS?: number;
  backlashKind?: string;
  backlashS?: number;
  nD?: number;
  nL?: number;
  deathDPct?: number;
  deathLPct?: number;
  netK?: number;
}
const CELLS = (raw as unknown as { cells: Record<string, RawCell | undefined> })
  .cells;
const IMMUNITY = (
  raw as unknown as { immunity: Record<string, string[] | undefined> }
).immunity;
export const BACKLASH_PRIOR_META = (
  raw as unknown as { meta: Record<string, unknown> }
).meta;

const fin = (x: unknown): x is number =>
  typeof x === "number" && Number.isFinite(x);

export function lookupBacklashPrior(spellId: string): BacklashPriorRef | null {
  const c = CELLS[spellId];
  if (
    !c ||
    !fin(c.n) ||
    !fin(c.nLeft) ||
    !fin(c.removedK) ||
    !fin(c.healLostK) ||
    !fin(c.backlashDmgK) ||
    !fin(c.ccExposureS) ||
    !fin(c.backlashS) ||
    (c.backlashKind !== "silence" && c.backlashKind !== "horror")
  )
    return null;
  if (c.n < BACKLASH_PRIOR_N_FLOOR || c.nLeft < BACKLASH_PRIOR_N_FLOOR)
    return null;
  return {
    spellId,
    n: c.n,
    nLeft: c.nLeft,
    removedK: c.removedK,
    healLostK: c.healLostK,
    backlashDmgK: c.backlashDmgK,
    ccExposureS: c.ccExposureS,
    backlashKind: c.backlashKind,
    backlashS: c.backlashS,
  };
}

export type BacklashWindowKind = "worth" | "immune";
/** The window cell for (debuff, kind): "worth" = VT at 40–60 % with ≥ 3 DoTs,
 * "immune" = the reference dispeller under a mined immunity at ≥ 60 %. A
 * window type only fires where this returns non-null, i.e. where the corpus
 * measured the dispel as net-positive on the HP ledger AND the left-on death
 * rate above the dispelled one — the table guards the product, not the
 * other way round. */
export function lookupBacklashWorth(
  spellId: string,
  kind: BacklashWindowKind = "worth",
): BacklashWorthRef | null {
  const c = CELLS[`${spellId}:${kind}`];
  if (
    !c ||
    !fin(c.nD) ||
    !fin(c.nL) ||
    !fin(c.deathDPct) ||
    !fin(c.deathLPct) ||
    !fin(c.netK)
  )
    return null;
  if (c.nD < BACKLASH_PRIOR_N_FLOOR || c.nL < BACKLASH_PRIOR_N_FLOOR)
    return null;
  // the cell only exists to say "dispelling here was worth it" — a cell where
  // it is not (net ≤ 0 or no death contrast) must not produce a window
  if (c.netK <= 0 || c.deathLPct <= c.deathDPct) return null;
  return {
    spellId,
    nD: c.nD,
    nL: c.nL,
    deathDPct: c.deathDPct,
    deathLPct: c.deathLPct,
    netK: c.netK,
  };
}

const EMPTY: ReadonlySet<string> = new Set();
const immunityCache = new Map<string, ReadonlySet<string>>();
/** Buff ids under which the debuff's backlash does not land on the dispeller. */
export function backlashImmunityIds(spellId: string): ReadonlySet<string> {
  const hit = immunityCache.get(spellId);
  if (hit) return hit;
  const ids = IMMUNITY[spellId];
  const set: ReadonlySet<string> = Array.isArray(ids)
    ? new Set(ids.map(String))
    : EMPTY;
  immunityCache.set(spellId, set);
  return set;
}

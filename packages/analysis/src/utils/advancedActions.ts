import { IAdvancedAction, ICombatUnit } from "@gladlog/parser-compat";

const sortedAdvancedActionsCache = new WeakMap<
  IAdvancedAction[],
  IAdvancedAction[]
>();

/**
 * Returns a sorted view of unit.advancedActions by timestamp.
 * Caches the result in a WeakMap keyed by the actions array so that repeated
 * queries across a match (HP, resource, counterfactual) share the same sorted
 * reference in O(1) without in-place mutation or repeated sorting.
 */
export function getSortedAdvancedActions(
  unit: Pick<ICombatUnit, "advancedActions">,
): IAdvancedAction[] {
  const actions = unit.advancedActions ?? [];
  if (actions.length <= 1) return actions;

  const cached = sortedAdvancedActionsCache.get(actions);
  if (cached) return cached;

  let isSorted = true;
  for (let i = 1; i < actions.length; i++) {
    if (actions[i].logLine.timestamp < actions[i - 1].logLine.timestamp) {
      isSorted = false;
      break;
    }
  }

  const result = isSorted
    ? actions
    : [...actions].sort((a, b) => a.logLine.timestamp - b.logLine.timestamp);
  sortedAdvancedActionsCache.set(actions, result);
  return result;
}

/** How far before the max-HP step a stale row is looked for: a form's rows are
 * rewritten within a few hundred ms (4f8a5947 2:33.08 → 2:33.28). */
const STALE_MAX_HP_LOOKBACK_MS = 500;
/** "Current HP has not moved" across the step, as a share of the new max. */
const STALE_MAX_HP_CURRENT_SLACK = 0.05;
/** The dip a stale row must show, and how close the current over the new max
 * must sit to the reading before it, in HP points. */
const STALE_MAX_HP_MIN_DIP_PCT = 3;
const STALE_MAX_HP_RECOVERED_PCT = 5;
/** Across the step the current must be carried, not rescaled with the max: the
 * step's row is read against the row just before it, 0 = current rescaled by
 * new max / old max (a hit, then a proportional shift: the dip was HP), 1 =
 * current carried (a stale max). Only this pair decides: hits inside the run
 * move its first row (1-5-13 2:14, Rallying Cry ending, 0.5 s of hits on it).
 * 2,590 runs on the 605 raw logs: 2,333 sit in 0.75–1.25 and 109 below this
 * (fact7 r6, codex 03-2). */
const STALE_MAX_HP_STEP_CARRIES = 0.5;

const staleMaxHpRowsCache = new WeakMap<
  IAdvancedAction[],
  ReadonlyMap<IAdvancedAction, number>
>();

/**
 * fact7 D60 (4f8a5947 2:33.08, a Feral out of Bear Form): the rows the log
 * wrote between a max-HP drop's new current and its new max — the current
 * already on the new scale, the max still the old one. 151364 / 1361920 read
 * 11 %; the unit stood at 15.0 % the row before and 14.5 % (151771 / 1047640)
 * on the row after. No HP moved: a percentage over two scales.
 *
 * A run of rows, directly before a max-HP step down, whose current sits at the
 * step's own current, whose percentage fell off the reading before the run,
 * and whose current over the NEW max recovers that reading. A max that rises
 * (a form going in, Rallying Cry) and a max that falls with its current (the
 * real loss of a buff) are not flagged. The rows stay for every non-HP reader
 * (resources, positions): this is a filter on the HP percentage alone, read by
 * `unitHpSampleAt`, `hpTroughInWindow` and `hpAtPress`.
 *
 * fact8 D16 (21caf35a 1:42, a Warlock): damage the log itself wrote is no scale
 * artefact. A Ferocious Bite took 88,826 off 1,163,505, 0.3 s later the max
 * stepped down 3 % with the current carried, and all six rows of the hit went
 * as stale: `[STATE]` printed 98 for a real 89.3. Only the part of the dip the
 * hits between the two rows do not explain counts towards it.
 */
export function staleMaxHpRows(
  unit: Pick<ICombatUnit, "advancedActions" | "id"> &
    Partial<Pick<ICombatUnit, "damageIn">>,
): ReadonlySet<IAdvancedAction> {
  return new Set(staleMaxHpNewMax(unit).keys());
}

/**
 * `staleMaxHpRows`, each row with the max its current is on: the step's NEW
 * max (fact10 D18 / D33). The detection already proves it — the run's current
 * over the new max recovers the reading before it — so the row is a reading
 * on that scale, not a gap: dropped, the tick fell back to the reading before
 * the step and left out what happened in it (461265d4 1:55: Fortifying Brew
 * off, 907,158 / 1,057,720 = 86, printed the pre-step 88; 6e0b8761 0:14:
 * Fortitude dispelled, three hits on the new scale, printed 95 for 93).
 */
export function staleMaxHpNewMax(
  unit: Pick<ICombatUnit, "advancedActions" | "id"> &
    Partial<Pick<ICombatUnit, "damageIn">>,
): ReadonlyMap<IAdvancedAction, number> {
  const sorted = getSortedAdvancedActions(unit);
  const cached = staleMaxHpRowsCache.get(sorted);
  if (cached) return cached;
  const out = new Map<IAdvancedAction, number>();
  const rows = sorted.filter(
    (a) => a.advancedActorId === unit.id && a.advancedActorMaxHp > 0,
  );
  const pct = (a: IAdvancedAction) =>
    (100 * a.advancedActorCurrentHp) / a.advancedActorMaxHp;
  for (let j = 1; j < rows.length; j++) {
    const after = rows[j]!;
    const m0 = rows[j - 1]!.advancedActorMaxHp;
    const m1 = after.advancedActorMaxHp;
    if (m1 >= m0) continue;
    let i = j;
    while (
      i > 0 &&
      rows[i - 1]!.advancedActorMaxHp === m0 &&
      after.logLine.timestamp - rows[i - 1]!.logLine.timestamp <=
        STALE_MAX_HP_LOOKBACK_MS &&
      Math.abs(
        rows[i - 1]!.advancedActorCurrentHp - after.advancedActorCurrentHp,
      ) <=
        STALE_MAX_HP_CURRENT_SLACK * m1
    )
      i--;
    if (i === j || i === 0) continue;
    const before = pct(rows[i - 1]!);
    const first = rows[i]!;
    const last = rows[j - 1]!.advancedActorCurrentHp;
    const rescaled = (last * m1) / m0;
    const priorMs = rows[i - 1]!.logLine.timestamp;
    const hitsInDip = (unit.damageIn ?? []).reduce(
      (sum, d) =>
        d.logLine.timestamp > priorMs &&
        d.logLine.timestamp <= first.logLine.timestamp
          ? sum + Math.abs(d.effectiveAmount)
          : sum,
      0,
    );
    if (
      before - pct(first) - (100 * hitsInDip) / m0 >=
        STALE_MAX_HP_MIN_DIP_PCT &&
      Math.abs((100 * first.advancedActorCurrentHp) / m1 - before) <=
        STALE_MAX_HP_RECOVERED_PCT &&
      after.advancedActorCurrentHp - rescaled >=
        STALE_MAX_HP_STEP_CARRIES * (last - rescaled)
    )
      for (let k = i; k < j; k++) out.set(rows[k]!, m1);
  }
  staleMaxHpRowsCache.set(sorted, out);
  return out;
}

/** The rows a point HP reading may stand on: every row, a stale-max one
 * read over its new max (`hpReadingMaxHp`, fact10 D18 / D33 — it used to be
 * dropped). */
export function hpReadingRows(
  unit: Pick<ICombatUnit, "advancedActions" | "id">,
): IAdvancedAction[] {
  return getSortedAdvancedActions(unit);
}

/** The max HP a row's current is on: the logged max, or a stale-max row's
 * new max (`staleMaxHpNewMax`). Every HP percentage of a row reads it. */
export function hpReadingMaxHp(
  unit: Pick<ICombatUnit, "advancedActions" | "id"> &
    Partial<Pick<ICombatUnit, "damageIn">>,
  a: IAdvancedAction,
): number {
  return staleMaxHpNewMax(unit).get(a) ?? a.advancedActorMaxHp;
}

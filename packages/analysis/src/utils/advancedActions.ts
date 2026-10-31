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
/** The step's own row must give back this share of the dip: a dip it keeps is
 * HP that went (a hit, then a proportional shift). The gap in current cannot
 * tell the two: on the 605 raw logs it runs to 5 % of the new max on both, the
 * 4,711 rows the step recovers (p99 4.5 %) and the 816 it does not (p99 4.8 %),
 * which read as stale before (fact7 r6, codex 03-2). */
const STALE_MAX_HP_STEP_RECOVERS = 0.5;

const staleMaxHpRowsCache = new WeakMap<
  IAdvancedAction[],
  ReadonlySet<IAdvancedAction>
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
 */
export function staleMaxHpRows(
  unit: Pick<ICombatUnit, "advancedActions" | "id">,
): ReadonlySet<IAdvancedAction> {
  const sorted = getSortedAdvancedActions(unit);
  const cached = staleMaxHpRowsCache.get(sorted);
  if (cached) return cached;
  const out = new Set<IAdvancedAction>();
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
    const dip = before - pct(first);
    if (
      dip >= STALE_MAX_HP_MIN_DIP_PCT &&
      Math.abs((100 * first.advancedActorCurrentHp) / m1 - before) <=
        STALE_MAX_HP_RECOVERED_PCT &&
      pct(after) - pct(first) >= STALE_MAX_HP_STEP_RECOVERS * dip
    )
      for (let k = i; k < j; k++) out.add(rows[k]!);
  }
  staleMaxHpRowsCache.set(sorted, out);
  return out;
}

const hpReadingRowsCache = new WeakMap<IAdvancedAction[], IAdvancedAction[]>();

/** `getSortedAdvancedActions` without `staleMaxHpRows`: the rows a point HP
 * reading may stand on. The same array when the unit has none. */
export function hpReadingRows(
  unit: Pick<ICombatUnit, "advancedActions" | "id">,
): IAdvancedAction[] {
  const sorted = getSortedAdvancedActions(unit);
  const stale = staleMaxHpRows(unit);
  if (stale.size === 0) return sorted;
  let rows = hpReadingRowsCache.get(sorted);
  if (!rows) {
    rows = sorted.filter((a) => !stale.has(a));
    hpReadingRowsCache.set(sorted, rows);
  }
  return rows;
}

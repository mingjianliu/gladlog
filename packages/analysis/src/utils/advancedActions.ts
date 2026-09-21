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

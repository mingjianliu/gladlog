import { IAdvancedAction, ICombatUnit } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { getSortedAdvancedActions } from "../src/utils/advancedActions";

describe("getSortedAdvancedActions", () => {
  const makeAction = (timestamp: number): IAdvancedAction =>
    ({
      logLine: { timestamp },
      timestamp,
    }) as unknown as IAdvancedAction;

  it("returns the same array reference when empty or single-element", () => {
    const empty: ICombatUnit = { advancedActions: [] } as unknown as ICombatUnit;
    expect(getSortedAdvancedActions(empty)).toBe(empty.advancedActions);

    const single: ICombatUnit = {
      advancedActions: [makeAction(10_000)],
    } as unknown as ICombatUnit;
    expect(getSortedAdvancedActions(single)).toBe(single.advancedActions);
  });

  it("returns the same array reference when already sorted (zero allocation)", () => {
    const actions = [makeAction(10_000), makeAction(10_020), makeAction(10_050)];
    const unit: ICombatUnit = { advancedActions: actions } as unknown as ICombatUnit;

    const result = getSortedAdvancedActions(unit);
    expect(result).toBe(actions);
  });

  it("returns cached result on subsequent calls for both sorted and unsorted inputs", () => {
    const sortedActions = [makeAction(10_000), makeAction(10_020)];
    const sortedUnit: ICombatUnit = {
      advancedActions: sortedActions,
    } as unknown as ICombatUnit;
    expect(getSortedAdvancedActions(sortedUnit)).toBe(
      getSortedAdvancedActions(sortedUnit),
    );

    const unsortedActions = [makeAction(10_020), makeAction(10_010)];
    const unsortedUnit: ICombatUnit = {
      advancedActions: unsortedActions,
    } as unknown as ICombatUnit;
    const firstCall = getSortedAdvancedActions(unsortedUnit);
    const secondCall = getSortedAdvancedActions(unsortedUnit);
    expect(firstCall).toBe(secondCall);
    expect(firstCall.map((a) => a.logLine.timestamp)).toEqual([10_010, 10_020]);
  });

  it("sorts out-of-order actions without mutating the original array", () => {
    const a1 = makeAction(10_030);
    const a2 = makeAction(10_010);
    const a3 = makeAction(10_020);
    const actions = [a1, a2, a3];
    const unit: ICombatUnit = { advancedActions: actions } as unknown as ICombatUnit;

    const sorted = getSortedAdvancedActions(unit);
    expect(sorted).not.toBe(actions);
    expect(sorted.map((a) => a.logLine.timestamp)).toEqual([
      10_010, 10_020, 10_030,
    ]);
    // Original array remains intact
    expect(actions).toEqual([a1, a2, a3]);
  });
});

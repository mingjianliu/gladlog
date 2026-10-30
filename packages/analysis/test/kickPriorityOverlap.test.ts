/**
 * fact3 (605 b26→b27): a heal cast inside two targets' overlapping kill
 * windows is judged against the lowest target under the HP gate, whatever
 * order the windows come in (49643222 2:30: the 46 % hunter's span beside the
 * priest's).
 */
import { describe, expect, it } from "vitest";

import { lowestTargetWindowAt } from "../src/analysis/candidates/kickPriority";

const priest = { targetUnitId: "priest", fromSeconds: 124, toSeconds: 157 };
const hunter = { targetUnitId: "hunter", fromSeconds: 135, toSeconds: 157 };
const hp: Record<string, number> = { priest: 82, hunter: 46 };

describe("lowestTargetWindowAt", () => {
  it("picks the low target's window in either order", () => {
    for (const ws of [
      [priest, hunter],
      [hunter, priest],
    ])
      expect(lowestTargetWindowAt(ws, 150.3, 50, (id) => hp[id])).toEqual({
        w: hunter,
        hp: 46,
      });
  });
  it("none under the gate, or the cast outside every window: undefined", () => {
    expect(lowestTargetWindowAt([priest], 150.3, 50, (id) => hp[id])).toBe(
      undefined,
    );
    expect(
      lowestTargetWindowAt([priest, hunter], 100, 50, (id) => hp[id]),
    ).toBe(undefined);
  });
});

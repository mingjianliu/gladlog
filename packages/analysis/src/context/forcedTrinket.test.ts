/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";

import {
  FORCED_FOLLOWUP_CAP,
  forcedTrinketFollowUps,
  formatForcedTrinketFollowUps,
} from "./forcedTrinket";

const owner: any = { name: "Owner" };
const attempt = (from: number, to: number, targetName = "Priest"): any => ({
  targetName,
  fromSeconds: from,
  toSeconds: to,
});
const cc = (
  atSeconds: number,
  durationSeconds: number,
  sourceName = "Owner",
) => ({
  atSeconds,
  durationSeconds,
  sourceName,
  spellName: "Fear",
});
const summary = (trinketUseTimes: number[], ccInstances: any[]): any => ({
  playerName: "Priest",
  trinketUseTimes,
  ccInstances,
});
const run = (s: any, attempts: any[] = [attempt(8, 20)]) =>
  forcedTrinketFollowUps({ owner, enemyCC: [s], killAttempts: attempts });

describe("forcedTrinketFollowUps (GH #69)", () => {
  it("keeps the owner's CC landing within 3 rendered seconds of an in-attempt trinket", () => {
    const out = run(summary([10.4], [cc(11.2, 6)]));
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual(
      expect.objectContaining({ spellName: "Fear", durationS: 6 }),
    );
    expect(formatForcedTrinketFollowUps(out, (n) => `5(${n})`)[1]).toBe(
      "0:10  [FORCED TRINKET]  5(Priest) used PvP trinket inside your team's kill attempt [0:08–0:20] on them → 0:11 your Fear landed on 5(Priest) 1 s later (6s)",
    );
  });

  it("measures the gap on the render grid (codex r2): 10.1 → 13.9 is 3, 10.9 → 14.0 is 4", () => {
    expect(run(summary([10.1], [cc(13.9, 6)]))).toHaveLength(1);
    expect(run(summary([10.9], [cc(14.0, 6)]))).toHaveLength(0);
  });

  it("ignores another player's CC, a CC before the trinket, and a trinket outside our attempts", () => {
    expect(run(summary([10], [cc(11, 6, "Teammate")]))).toHaveLength(0);
    expect(run(summary([10], [cc(9.5, 6)]))).toHaveLength(0);
    expect(run(summary([30], [cc(31, 6)]))).toHaveLength(0);
    expect(
      run(summary([10], [cc(11, 6)]), [attempt(8, 20, "Other")]),
    ).toHaveLength(0);
  });

  it("applies the duration door on the [CC ON …] rounding (1.4 s → 1, 1.5 s → 2)", () => {
    expect(run(summary([10], [cc(11, 1.4)]))).toHaveLength(0);
    expect(run(summary([10], [cc(11, 1.5)]))).toHaveLength(1);
  });

  it("finds a qualifying CC even when an earlier one in the window is too short (not just the first CC)", () => {
    const out = run(summary([10], [cc(10.5, 0.4), cc(12, 6)]));
    expect(out).toHaveLength(1);
    expect(out[0]!.ccAtS).toBe(12);
  });

  it(`keeps at most ${FORCED_FOLLOWUP_CAP} line — the quickest follow-up`, () => {
    const out = run(summary([10, 15], [cc(12.5, 6), cc(15.5, 6)]));
    expect(out).toHaveLength(FORCED_FOLLOWUP_CAP);
    expect(out[0]!.trinketS).toBe(15);
  });
});

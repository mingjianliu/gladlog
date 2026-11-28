/**
 * The kit prints the range of a cooldown a buff of the unit's own sped up
 * this round (`rateWindows`, the warped clock every [RES] row reads) —
 * fact2-retest idx 25 (GH #153): Emerald Communion `[180s]` above
 * `+Emerald Communion` [RES] rows and two presses 175.0 s apart.
 */
import { describe, expect, it } from "vitest";

import { buildPlayerLoadout } from "../src/context/resourceSnapshot";
import type { IMajorCooldownInfo } from "../src/utils/cooldowns";
import type { IEnemyCDTimeline } from "../src/utils/enemyCDs";
import { makeUnit } from "./ported/testHelpers";

const NO_ENEMIES = {
  players: [],
  alignedBurstWindows: [],
} as unknown as IEnemyCDTimeline;
const owner = makeUnit("player-1", { name: "Player1" });
const kit = (cd: Partial<IMajorCooldownInfo>) =>
  buildPlayerLoadout(
    owner,
    "Preservation Evoker",
    [
      {
        spellId: "370960",
        spellName: "Emerald Communion",
        cooldownSeconds: 180,
        maxChargesDetected: 1,
        neverUsed: false,
        casts: [{ timeSeconds: 10 }],
        ...cd,
      } as unknown as IMajorCooldownInfo,
    ],
    [],
    NO_ENEMIES,
  ).text;

describe("kit — a rate-warped cooldown prints its realised range", () => {
  it("a 2× window of 20 s after the press brings it back 20 s sooner", () => {
    const text = kit({
      rateWindows: [{ fromSeconds: 20, toSeconds: 40, mult: 2 }],
    });
    expect(text).toContain("Emerald Communion [160–180s");
  });
  it("no rate window: the bare official length", () => {
    expect(kit({})).toContain("Emerald Communion [180s");
  });
});

describe("kit — the unit's own shortest recast (T316)", () => {
  const twice = (endOfPlayS?: number, floor: number | null = 150) =>
    buildPlayerLoadout(
      owner,
      "Preservation Evoker",
      [
        {
          spellId: "370960",
          spellName: "Emerald Communion",
          cooldownSeconds: 180,
          maxChargesDetected: 1,
          neverUsed: false,
          casts: [{ timeSeconds: 10 }, { timeSeconds: 115 }],
          ...(floor === null ? {} : { earliestCooldownSeconds: floor }),
        } as unknown as IMajorCooldownInfo,
      ],
      [],
      NO_ENEMIES,
      undefined,
      undefined,
      endOfPlayS === undefined
        ? undefined
        : {
            startTime: 0,
            endTime: 300_000,
            startInfo: { bracket: "Rated Solo Shuffle" },
            units: [
              {
                info: {},
                deathRecords: [{ timestamp: endOfPlayS * 1000 }],
              },
            ],
          },
    ).text;
  it("已经是区间(语料下限 150 s)的条目,两次按键隔 105 s:低端不高于它", () => {
    expect(twice()).toContain("Emerald Communion [105–180s");
    expect(twice(200)).toContain("Emerald Communion [105–180s");
  });
  it("可玩结束之后的按键不读(codex 85-tk-L8-T316-1 #2)", () => {
    expect(twice(100)).toContain("Emerald Communion [150–180s");
  });
  it("没有任何缩短来源的条目保持一个数:早按零点几秒不印成 [179–180s](cover T316-5)", () => {
    expect(twice(undefined, null)).toContain("Emerald Communion [180s");
  });
});

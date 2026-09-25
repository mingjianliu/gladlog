/**
 * cd-hoarded, reliability audit A2 (2026-09-24):
 *  (i) a save cooldown pressed just BEFORE the crossing counts as the
 *      response even though it is (by construction) on cooldown at the
 *      crossing — a9bc48b5 @23 was accused while Ironbark had gone on the
 *      crisis unit 0.9 s earlier;
 * (ii) a major wall already up on the crisis unit at the crossing, whoever
 *      cast it, makes the line abstain — e9ea8a0c @266 was accused while the
 *      owner's own Ironbark was running on him (user ruling 2026-09-19
 *      "该不该救 = 伤情 × 已有保护一起看"; codex astra debate 2026-09-24:
 *      abstain, never "responded" / "enough").
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  cdHoardedEvents,
  type ICdHoardedCrisisSource,
} from "../src/analysis/candidates/cooldownTiming";
import { ensureAnalysisData } from "../src/data/ensure";

const OWNER = { id: "h", name: "Healer-R" };
const MATE = { id: "m", name: "Ally-R" };

const point = (
  over: Partial<ICdHoardedCrisisSource["points"][number]> = {},
): ICdHoardedCrisisSource["points"][number] => ({
  tSec: 23,
  hpPct: 39,
  dmg2s: 0.28,
  attackers2s: 1,
  enemyBurst: false,
  inCC: false,
  dangerous: true,
  ...over,
});
const tranq = {
  spellId: "740",
  spellName: "Tranquility",
  tag: "Defensive",
  cooldownSeconds: 300,
  casts: [] as { timeSeconds: number }[],
  neverUsed: true,
};
const ironbark = (castAt: number[]) => ({
  spellId: "102342",
  spellName: "Ironbark",
  tag: "Defensive",
  cooldownSeconds: 90,
  casts: castAt.map((timeSeconds) => ({ timeSeconds })),
  neverUsed: castAt.length === 0,
});

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("cd-hoarded: pre-pressed response (A2 i)", () => {
  it("Ironbark on the crisis unit 0.9 s before the crossing answers it (it is on cooldown at the crossing)", () => {
    const evts = cdHoardedEvents(
      [{ crisisUnit: MATE, own: false, points: [point()] }],
      [tranq, ironbark([22.1])],
      OWNER,
    );
    expect(evts).toEqual([]);
  });

  it("a press 2 s before the crossing is outside the response window — Tranquility is still accused", () => {
    const evts = cdHoardedEvents(
      [{ crisisUnit: MATE, own: false, points: [point()] }],
      [tranq, ironbark([21.0])],
      OWNER,
    );
    expect(evts).toHaveLength(1);
    expect(evts[0]!.facts["readyCds"]).toBe("Tranquility");
  });
});

describe("cd-hoarded: a major wall already up at the crossing (A2 ii)", () => {
  const src = (
    majorWalls: ICdHoardedCrisisSource["majorWalls"],
  ): ICdHoardedCrisisSource => ({
    crisisUnit: MATE,
    own: false,
    points: [point()],
    majorWalls,
  });

  it("a teammate's Pain Suppression running on the crisis unit → abstain", () => {
    expect(
      cdHoardedEvents(
        [
          src([
            { spellId: "33206", srcUnitName: "Priest-R", fromS: 20, toS: 28 },
          ]),
        ],
        [tranq],
        OWNER,
      ),
    ).toEqual([]);
  });

  it("the owner's own Ironbark running on the crisis unit → abstain", () => {
    expect(
      cdHoardedEvents(
        [
          src([
            {
              spellId: "102342",
              srcUnitName: OWNER.name,
              fromS: 20.1,
              toS: 32.1,
            },
          ]),
        ],
        [tranq, ironbark([20.1])],
        OWNER,
      ),
    ).toEqual([]);
  });

  it("a wall that ended before the crossing, or starts after it, does not abstain", () => {
    for (const w of [
      { spellId: "33206", srcUnitName: "Priest-R", fromS: 10, toS: 23 },
      { spellId: "33206", srcUnitName: "Priest-R", fromS: 23.5, toS: 31 },
    ])
      expect(
        cdHoardedEvents([src([w])], [tranq], OWNER),
        `${w.fromS}–${w.toS}`,
      ).toHaveLength(1);
  });

  it("no wall record (old callers) → unchanged behaviour", () => {
    expect(cdHoardedEvents([src(undefined)], [tranq], OWNER)).toHaveLength(1);
  });
});

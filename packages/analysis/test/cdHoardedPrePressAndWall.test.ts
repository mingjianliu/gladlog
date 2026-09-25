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

describe("cd-hoarded: the press must reach THIS crisis unit (A2 step 2, user ruling 2026-09-24 「加」)", () => {
  const bop = (casts: { timeSeconds: number; targetName?: string }[]) => ({
    spellId: "1022",
    spellName: "Blessing of Protection",
    tag: "Defensive",
    cooldownSeconds: 300,
    casts,
    neverUsed: casts.length === 0,
  });
  const OTHER = "Other-R";

  it("an external on ANOTHER teammate does not answer this teammate's crisis — and the line says where it went (user ruling 2026-09-25)", () => {
    const evts = cdHoardedEvents(
      [{ crisisUnit: MATE, own: false, points: [point()] }],
      [tranq, bop([{ timeSeconds: 24, targetName: OTHER }])],
      OWNER,
    );
    expect(evts).toHaveLength(1);
    expect(evts[0]!.facts["spentElsewhere"]).toBe(
      "Blessing of Protection → Other-R +1.0s",
    );
  });

  it("no save went elsewhere → no spentElsewhere fact", () => {
    const evts = cdHoardedEvents(
      [{ crisisUnit: MATE, own: false, points: [point()] }],
      [tranq],
      OWNER,
    );
    expect(evts[0]!.facts["spentElsewhere"]).toBeUndefined();
  });

  it("the same external on the crisis unit answers it", () => {
    expect(
      cdHoardedEvents(
        [{ crisisUnit: MATE, own: false, points: [point()] }],
        [tranq, bop([{ timeSeconds: 24, targetName: MATE.name }])],
        OWNER,
      ),
    ).toEqual([]);
  });

  it("a press with no named target (self / group effect) still answers", () => {
    expect(
      cdHoardedEvents(
        [{ crisisUnit: MATE, own: false, points: [point()] }],
        [tranq, bop([{ timeSeconds: 24 }])],
        OWNER,
      ),
    ).toEqual([]);
  });

  it("a SELF-only wall answers the owner's own crisis even when the log names an enemy as its cast target (Obsidian Scales / Touch of Karma)", () => {
    const scales = {
      spellId: "363916",
      spellName: "Obsidian Scales",
      tag: "Defensive",
      cooldownSeconds: 90,
      casts: [{ timeSeconds: 24, targetName: "Enemy-R" }],
      neverUsed: false,
    };
    expect(
      cdHoardedEvents(
        [{ crisisUnit: OWNER, own: true, points: [point()] }],
        [{ ...tranq, spellId: "642", spellName: "Divine Shield" }, scales],
        OWNER,
      ),
    ).toEqual([]);
  });

  it("on the owner's own crisis, an external given to a teammate does not answer it", () => {
    const evts = cdHoardedEvents(
      [{ crisisUnit: OWNER, own: true, points: [point()] }],
      [
        { ...tranq, spellId: "642", spellName: "Divine Shield" },
        bop([{ timeSeconds: 24, targetName: MATE.name }]),
      ],
      OWNER,
    );
    expect(evts).toHaveLength(1);
  });
});

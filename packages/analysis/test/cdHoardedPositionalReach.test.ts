/**
 * cd-hoarded, triage 2026-09-29 menu-coverage F-MC1 (user ruling 2026-09-30,
 * A58; executes the 2026-07-30 ruling "Darkness counts as 40 % but position
 * MUST be evaluated"): once Darkness is ledgered as a Defensive, a TEAMMATE's
 * crisis may only name it as "ready and held" when the owner stood within the
 * zone's reach of that teammate. 4446729d: the two crisis points of the
 * teammate were 8.4 yd and 31.3 yd from the owner against an 8 yd zone.
 */
import { CombatUnitSpec } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  cdHoardedEvents,
  type ICdHoardedCrisisSource,
} from "../src/analysis/candidates/cooldownTiming";
import { buildKillSequenceBlock } from "../src/context/timelineHelpers";
import { ensureAnalysisData } from "../src/data/ensure";
import { MITIGATION_TABLE } from "../src/data/mitigationData";
import { positionalWallReaches } from "../src/utils/deathOutcomeAnalysis";
import { makeUnit } from "./ported/testHelpers";

const OWNER = { id: "o", name: "Havoc-R" };
const MATE = { id: "m", name: "Ally-R" };

const point = (
  over: Partial<ICdHoardedCrisisSource["points"][number]> = {},
): ICdHoardedCrisisSource["points"][number] => ({
  tSec: 82,
  hpPct: 40,
  dmg2s: 0.28,
  attackers2s: 2,
  enemyBurst: false,
  inCC: false,
  dangerous: true,
  ...over,
});
const darkness = (castAt: number[] = []) => ({
  spellId: "196718",
  spellName: "Darkness",
  tag: "Defensive",
  cooldownSeconds: 180,
  casts: castAt.map((timeSeconds) => ({ timeSeconds })),
  neverUsed: castAt.length === 0,
});
// a non-positional group wall, to show the gate keys on `positional` only
const rallyingCry = {
  spellId: "97462",
  spellName: "Rallying Cry",
  tag: "Defensive",
  cooldownSeconds: 180,
  casts: [] as { timeSeconds: number }[],
  neverUsed: true,
};

const run = (
  src: ICdHoardedCrisisSource,
  cds: Parameters<typeof cdHoardedEvents>[1],
  reaches?: (spellId: string, crisisUnitId: string, tSec: number) => boolean,
) =>
  cdHoardedEvents(
    [src],
    cds,
    OWNER,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    reaches,
  );

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("cd-hoarded: a positional wall must reach the teammate in crisis (F-MC1)", () => {
  const mateSrc: ICdHoardedCrisisSource = {
    crisisUnit: MATE,
    own: false,
    points: [point()],
  };

  it("the fixture's premise: Darkness is the positional row", () => {
    expect(MITIGATION_TABLE["196718"]?.positional).toBe(true);
    expect(MITIGATION_TABLE["97462"]?.positional).toBeFalsy();
  });

  it("owner out of the zone's reach → Darkness is not named (no ready cooldown, no event)", () => {
    const asked: Array<[string, string, number]> = [];
    const evts = run(mateSrc, [darkness()], (id, unit, t) => {
      asked.push([id, unit, t]);
      return false;
    });
    expect(evts).toEqual([]);
    expect(asked).toEqual([["196718", MATE.id, 82]]);
  });

  it("owner within reach → Darkness is named", () => {
    const evts = run(mateSrc, [darkness()], () => true);
    expect(evts).toHaveLength(1);
    expect(evts[0]!.facts["readyCds"]).toBe("Darkness");
  });

  it("only the positional wall is dropped; a non-positional one in the same set stays", () => {
    const evts = run(mateSrc, [darkness(), rallyingCry], () => false);
    expect(evts).toHaveLength(1);
    expect(evts[0]!.facts["readyCds"]).toBe("Rallying Cry");
  });

  it("the owner's OWN crisis is not gated (they stand in their own zone)", () => {
    const evts = run(
      { crisisUnit: OWNER, own: true, points: [point()] },
      [darkness()],
      () => false,
    );
    expect(evts).toHaveLength(1);
    expect(evts[0]!.facts["readyCds"]).toBe("Darkness");
  });

  it("no callback (old callers, tests) → unchanged behaviour", () => {
    expect(run(mateSrc, [darkness()])).toHaveLength(1);
  });

  it("a cooldown Forbearance blocks at the crisis is not ready (review of F-W6); others stay", () => {
    const asked: Array<[string, number]> = [];
    const evts = cdHoardedEvents(
      [{ crisisUnit: OWNER, own: true, points: [point()] }],
      [darkness(), rallyingCry],
      OWNER,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (spellId, tSec) => {
        asked.push([spellId, tSec]);
        return spellId === "196718";
      },
    );
    expect(evts).toHaveLength(1);
    expect(evts[0]!.facts["readyCds"]).toBe("Rallying Cry");
    expect(asked).toContainEqual(["196718", 82]);
  });

  it("the response set is untouched: Darkness pressed in the window answers the crisis even when out of reach", () => {
    const evts = run(mateSrc, [darkness([82.5]), rallyingCry], () => false);
    expect(evts).toEqual([]);
  });
});

describe("positionalWallReaches — one predicate for every consumer that names a positional wall for another unit", () => {
  const at = (id: string, x: number, samples = true) =>
    makeUnit(id, {
      name: `${id}-R`,
      advancedActions: samples
        ? ([0, 5, 10, 15, 20].map((s) => ({
            timestamp: s * 1000,
            logLine: { timestamp: s * 1000 },
            advancedActorId: id,
            advancedActorCurrentHp: 100,
            advancedActorMaxHp: 100,
            advancedActorPositionX: x,
            advancedActorPositionY: 0,
          })) as never)
        : [],
    });

  it("Darkness: within its 8 yd zone yes, outside no, no sample no", () => {
    expect(
      positionalWallReaches("196718", at("dh", 0), at("m", 7), 10_000),
    ).toBe(true);
    expect(
      positionalWallReaches("196718", at("dh", 0), at("m", 9), 10_000),
    ).toBe(false);
    expect(
      positionalWallReaches("196718", at("dh", 0), at("m", 0, false), 10_000),
    ).toBe(false);
  });

  it("a non-positional wall is never gated here", () => {
    expect(
      positionalWallReaches("97462", at("w", 0), at("m", 0, false), 10_000),
    ).toBe(true);
  });

  describe("kill sequence [DEFENSIVE AVAILABLE]", () => {
    const DEATH_T = 15;
    const lines = (dhX: number, dying: "mate" | "dh") => {
      const dh = at("dh", dhX);
      dh.spec = CombatUnitSpec.DemonHunter_Havoc;
      const mate = at("mate", 0);
      return buildKillSequenceBlock({
        matchStartMs: 0,
        matchEndSeconds: DEATH_T + 5,
        owner: dh,
        friends: [dh, mate],
        enemies: [],
        ownerCDs: [
          { ...darkness(), maxChargesDetected: 1, availableWindows: [] },
        ],
        teammateCDs: [],
        enemyCDTimeline: { alignedBurstWindows: [], players: [] } as any,
        ccTrinketSummaries: [],
        friendlyDeaths: [
          {
            spec: "x",
            name: dying === "mate" ? mate.name : dh.name,
            atSeconds: DEATH_T,
          },
        ],
        enemyDeaths: [],
        isHealer: false,
        pid: (n: string) => n,
        actorLabel: (n: string) => n,
      } as never).filter((l) => l.includes("[DEFENSIVE AVAILABLE]"));
    };

    it("a teammate dies 30 yd from the Demon Hunter → Darkness is not named", () => {
      expect(lines(30, "mate")).toEqual([]);
    });
    it("a teammate dies 5 yd from the Demon Hunter → Darkness is named", () => {
      expect(lines(5, "mate").join("\n")).toContain(
        "Darkness available but unused",
      );
    });
    it("the Demon Hunter's own death is not gated", () => {
      expect(lines(30, "dh").join("\n")).toContain(
        "Darkness available but unused",
      );
    });
  });
});

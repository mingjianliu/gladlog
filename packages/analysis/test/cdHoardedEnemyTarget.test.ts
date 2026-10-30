/**
 * Codex review of cd-hoarded F-W6, round 6 (2026-10-06): Touch of Karma is
 * pressed ON AN ENEMY (DB2 ImplicitTarget 6, UNIT_TARGET_ENEMY), so it is
 * "ready and held" only with a living enemy in its reach. The reproduction: a
 * Windwalker who never casts Karma, rooted 18–26 s, drops to 30 % at 20 s
 * while the only enemy stays 40 yd away — the baseline row named Karma as
 * held. `enemyTargetReaches` is the one predicate, read by cd-hoarded's
 * accusation set and the kill sequence's [DEFENSIVE AVAILABLE].
 */
import { CombatUnitSpec } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  cdHoardedEvents,
  type ICdHoardedCrisisSource,
} from "../src/analysis/candidates/cooldownTiming";
import { emitFriendlyDeathEntries } from "../src/context/matchTimelineSections";
import { buildKillSequenceBlock } from "../src/context/timelineHelpers";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  BASELINE_DEFENSIVE_BY_SPEC,
  ENEMY_TARGET_DEFENSIVE_IDS,
} from "../src/utils/cooldowns";
import { enemyTargetReaches } from "../src/utils/deathOutcomeAnalysis";
import { makeUnit } from "./ported/testHelpers";

const KARMA = "122470";
const DIVINE_SHIELD = "642";

beforeAll(async () => {
  await ensureAnalysisData();
});

const at = (
  id: string,
  x: number,
  opts: { samples?: boolean; diedAtS?: number } = {},
) => {
  const u = makeUnit(id, {
    name: `${id}-R`,
    advancedActions:
      opts.samples === false
        ? []
        : ([0, 5, 10, 15, 20, 25, 30].map((s) => ({
            timestamp: s * 1000,
            logLine: { timestamp: s * 1000 },
            advancedActorId: id,
            advancedActorCurrentHp: 100,
            advancedActorMaxHp: 100,
            advancedActorPositionX: x,
            advancedActorPositionY: 0,
          })) as never),
  });
  if (opts.diedAtS !== undefined)
    (u as any).deathRecords = [{ timestamp: opts.diedAtS * 1000 }];
  return u;
};

describe("the official enemy-target set", () => {
  it("is Touch of Karma, and Karma is the Windwalker's baseline row", () => {
    expect([...ENEMY_TARGET_DEFENSIVE_IDS]).toEqual([KARMA]);
    expect(BASELINE_DEFENSIVE_BY_SPEC["269"]).toContain(KARMA);
  });
});

describe("enemyTargetReaches", () => {
  it("Karma (20 yd): an enemy at 15 yd yes, at 40 yd no", () => {
    expect(enemyTargetReaches(KARMA, at("ww", 0), [at("e", 15)], 20_000)).toBe(
      true,
    );
    expect(enemyTargetReaches(KARMA, at("ww", 0), [at("e", 40)], 20_000)).toBe(
      false,
    );
  });

  it("any one living enemy in reach is enough; a dead one is not a target", () => {
    expect(
      enemyTargetReaches(
        KARMA,
        at("ww", 0),
        [at("a", 40), at("b", 10)],
        20_000,
      ),
    ).toBe(true);
    expect(
      enemyTargetReaches(
        KARMA,
        at("ww", 0),
        [at("b", 10, { diedAtS: 12 })],
        20_000,
      ),
    ).toBe(false);
  });

  it("no position sample (holder or enemy) or no enemy fails closed", () => {
    expect(
      enemyTargetReaches(
        KARMA,
        at("ww", 0, { samples: false }),
        [at("e", 5)],
        20_000,
      ),
    ).toBe(false);
    expect(
      enemyTargetReaches(
        KARMA,
        at("ww", 0),
        [at("e", 5, { samples: false })],
        20_000,
      ),
    ).toBe(false);
    expect(enemyTargetReaches(KARMA, at("ww", 0), [], 20_000)).toBe(false);
  });

  it("a spell that is not cast on an enemy is never gated here", () => {
    expect(
      enemyTargetReaches(DIVINE_SHIELD, at("p", 0, { samples: false }), [], 0),
    ).toBe(true);
  });
});

describe("cd-hoarded: Karma is ready only with an enemy in reach (codex round 6)", () => {
  const OWNER = { id: "ww", name: "ww-R" };
  const crisis: ICdHoardedCrisisSource = {
    crisisUnit: OWNER,
    own: true,
    points: [
      {
        tSec: 20,
        hpPct: 30,
        dmg2s: 0.3,
        attackers2s: 1,
        enemyBurst: false,
        inCC: false,
        dangerous: true,
      },
    ],
  };
  const karma = {
    spellId: KARMA,
    spellName: "Touch of Karma",
    tag: "Defensive",
    cooldownSeconds: 90,
    casts: [] as { timeSeconds: number }[],
    neverUsed: true,
    baselineOnly: true,
  };
  const run = (enemyX: number) => {
    const ww = at("ww", 0);
    const enemy = at("e", enemyX);
    return cdHoardedEvents(
      [crisis],
      [karma],
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
      undefined,
      (spellId, tSec) => enemyTargetReaches(spellId, ww, [enemy], tSec * 1000),
    );
  };

  it("the only enemy 40 yd away → Karma is not named (the reproduction)", () => {
    expect(run(40)).toEqual([]);
  });

  it("an enemy 10 yd away → Karma is named", () => {
    const evts = run(10);
    expect(evts).toHaveLength(1);
    expect(evts[0]!.facts["readyCds"]).toBe("Touch of Karma");
  });
});

describe("kill sequence [DEFENSIVE AVAILABLE]: Karma at the Windwalker's own death", () => {
  const DEATH_T = 15;
  const lines = (enemyX: number) => {
    const ww = at("ww", 0);
    ww.spec = CombatUnitSpec.Monk_Windwalker;
    return buildKillSequenceBlock({
      matchStartMs: 0,
      matchEndSeconds: DEATH_T + 5,
      owner: ww,
      friends: [ww],
      enemies: [at("e", enemyX)],
      ownerCDs: [
        {
          spellId: KARMA,
          spellName: "Touch of Karma",
          tag: "Defensive",
          cooldownSeconds: 90,
          casts: [],
          neverUsed: true,
          maxChargesDetected: 1,
          availableWindows: [],
        },
      ],
      teammateCDs: [],
      enemyCDTimeline: { alignedBurstWindows: [], players: [] } as any,
      ccTrinketSummaries: [],
      friendlyDeaths: [{ spec: "x", name: ww.name, atSeconds: DEATH_T }],
      enemyDeaths: [],
      isHealer: false,
      pid: (n: string) => n,
      actorLabel: (n: string) => n,
    } as never).filter((l) => l.includes("[DEFENSIVE AVAILABLE]"));
  };

  it("the only enemy 40 yd away → not named", () => {
    expect(lines(40)).toEqual([]);
  });
  it("an enemy 10 yd away → named", () => {
    expect(lines(10).join("\n")).toContain(
      "Touch of Karma available but unused",
    );
  });
});

// The Karma row here is evidence-owned (no `baselineOnly`): a baseline-only
// row never reaches the Unused list at all (next block).
describe("[DEATH] Unused: Karma at the Windwalker's own death (codex round 7)", () => {
  const DEATH_T = 20;
  const deathLine = (enemyX: number | null) => {
    const ww = at("ww", 0);
    ww.spec = CombatUnitSpec.Monk_Windwalker;
    const entries: string[] = [];
    emitFriendlyDeathEntries<string>({
      friendlyDeaths: [
        { spec: "Windwalker", name: ww.name, atSeconds: DEATH_T },
      ],
      unitsByName: new Map([[ww.name, ww]]),
      ccTrinketSummaries: [],
      owner: ww,
      ownerCDs: [
        {
          spellId: KARMA,
          spellName: "Touch of Karma",
          tag: "Defensive",
          cooldownSeconds: 90,
          maxChargesDetected: 1,
          casts: [],
          availableWindows: [],
          neverUsed: true,
        },
      ],
      teammateCDs: [],
      ...(enemyX === null ? {} : { enemies: [at("e", enemyX)] }),
      matchStartMs: 0,
      pid: (n) => n,
      requestSnapshotPlaceholder: () => "snap",
      addEntry: (_t, ...lines) => {
        entries.push(String(lines[0]));
      },
    });
    return entries.find((l) => l.includes("[DEATH]")) ?? "";
  };

  it("the only enemy 40 yd away → Karma is not listed (codex's repro)", () => {
    expect(deathLine(40)).toContain("[DEATH]");
    expect(deathLine(40)).not.toContain("Touch of Karma");
  });
  it("an enemy 10 yd away → listed", () => {
    expect(deathLine(10)).toContain("(Unused: Touch of Karma)");
  });
  it("no enemy list passed → not listed (fails closed)", () => {
    expect(deathLine(null)).not.toContain("Touch of Karma");
  });
});

describe("[DEATH] Unused: a row owned on the spec baseline alone is never listed (Fable round 9; ruling P-W6)", () => {
  // Fable's repro: an Unholy Death Knight who never pressed Anti-Magic Shell
  // dies to pure physical damage. The baseline row has no school gate here;
  // cd-hoarded drops it through `coversCrisisSchool` at the same instant.
  const deathLine = (baselineOnly: boolean) => {
    const dk = at("dk", 0);
    dk.spec = CombatUnitSpec.DeathKnight_Unholy;
    const entries: string[] = [];
    emitFriendlyDeathEntries<string>({
      friendlyDeaths: [{ spec: "Unholy", name: dk.name, atSeconds: 40 }],
      unitsByName: new Map([[dk.name, dk]]),
      ccTrinketSummaries: [],
      owner: dk,
      ownerCDs: [
        {
          spellId: "48707",
          spellName: "Anti-Magic Shell",
          tag: "Defensive",
          cooldownSeconds: 60,
          maxChargesDetected: 1,
          casts: [],
          availableWindows: [],
          neverUsed: true,
          ...(baselineOnly ? { baselineOnly } : {}),
        },
      ],
      teammateCDs: [],
      matchStartMs: 0,
      pid: (n) => n,
      requestSnapshotPlaceholder: () => "snap",
      addEntry: (_t, ...lines) => {
        entries.push(String(lines[0]));
      },
    });
    return entries.find((l) => l.includes("[DEATH]")) ?? "";
  };

  it("baseline-only → not listed; the same row with evidence → listed as before", () => {
    expect(deathLine(true)).toContain("[DEATH]");
    expect(deathLine(true)).not.toContain("Anti-Magic Shell");
    expect(deathLine(false)).toContain("(Unused: Anti-Magic Shell)");
  });
});

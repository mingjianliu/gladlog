/**
 * Triage 2026-09-29, group G4 — one dead-at predicate (`utils/unitDeath.ts`)
 * and its four new readers: missed-sync-window's ready filter (sync-burst
 * F-S1), the kill-window gate facts (sync-burst F-KW2), the [RES] ledger
 * (res-readiness F-C4) and kick-eaten's post-kick window (kick-eaten F-K7e).
 *
 * The repro behind every case is 539b6ed0 (a Balance Druid dead at 67.03 whose
 * Incarnation stayed "ready" at 68.3 / 83 / 90) and f4eb8c87 r4 (a Dark Pact
 * pressed 0.3 s after the player's own death, reason "You are dead").
 */
import {
  type AtomicArenaCombat,
  CombatUnitClass,
  CombatUnitSpec,
  type ICombatUnit,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { kickEatenEvents } from "../src/analysis/candidateFindings";
import { evaluateSyncWindow } from "../src/analysis/candidates/cooldownTiming";
import {
  buildResourceSnapshot,
  computeOnCDDisplayNames,
  computeReadyNames,
} from "../src/context/resourceSnapshot";
import { ensureAnalysisData } from "../src/data/ensure";
import { actWindowFor } from "../src/utils/cannotCastIntervals";
import type { IMajorCooldownInfo } from "../src/utils/cooldowns";
import { createKillWindowFactsComputer } from "../src/utils/killWindowFacts";
import { isDeadAt as isDeadAtReExport } from "../src/utils/positionAnalysis";
import type { RawStreams } from "../src/utils/rawStreams";
import { firstDeathMs, isDeadAt } from "../src/utils/unitDeath";
import { makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const START = 1_000_000;
const diedAt = (s: number) => [{ timestamp: START + s * 1000 }];

describe("unitDeath — the one dead-at predicate", () => {
  it("firstDeathMs is the earliest record, Infinity when the unit never died", () => {
    expect(firstDeathMs({ deathRecords: [] })).toBe(Infinity);
    expect(firstDeathMs({})).toBe(Infinity);
    expect(
      firstDeathMs({
        deathRecords: [
          { timestamp: START + 90_000 },
          { timestamp: START + 67_030 },
        ] as ICombatUnit["deathRecords"],
      }),
    ).toBe(START + 67_030);
  });

  it("isDeadAt: dead from the death instant on, alive before it", () => {
    const u = { deathRecords: diedAt(67.03) as ICombatUnit["deathRecords"] };
    expect(isDeadAt(u, START + 67_029)).toBe(false);
    expect(isDeadAt(u, START + 67_030)).toBe(true);
    expect(isDeadAt(u, START + 83_000)).toBe(true);
  });

  it("positionAnalysis re-exports the same function, not a copy", () => {
    expect(isDeadAtReExport).toBe(isDeadAt);
  });

  it("the cd-hoarded owner gate (`actWindowFor`) cuts at the same first death", () => {
    const owner = makeUnit("P1", { deathRecords: diedAt(67.03) });
    const { couldRespond } = actWindowFor(owner, new Set(["E1"]), START);
    expect(couldRespond(60, 65)).toBe(true);
    // dead before the window opens
    expect(couldRespond(68, 73)).toBe(false);
  });
});

describe("sync-burst F-S1 — a dead holder's cooldown is not ready for a lock", () => {
  const incarnation = (owner: ICombatUnit) => ({
    spellId: "102560",
    spellName: "Incarnation: Chosen of Elune",
    casts: [] as { timeSeconds: number }[],
    cooldownSeconds: 180,
    neverUsed: true,
    owner,
    ownerEnemyIds: new Set(["E1"]),
    matchStartMs: START,
  });
  const lock = { fromSeconds: 68.336, toSeconds: 73.336 };

  it("539b6ed0: the Druid died at 67.03, the lock starts at 68.336 → not ready", () => {
    const dead = makeUnit("P1", { deathRecords: diedAt(67.03) });
    expect(evaluateSyncWindow(lock, [incarnation(dead)]).ready).toHaveLength(0);
  });

  it("control: the same holder alive, or dying only after the ready instant, stays ready", () => {
    const alive = makeUnit("P1");
    expect(evaluateSyncWindow(lock, [incarnation(alive)]).ready).toHaveLength(
      1,
    );
    const diesInside = makeUnit("P1", { deathRecords: diedAt(70) });
    expect(
      evaluateSyncWindow(lock, [incarnation(diesInside)]).ready,
    ).toHaveLength(1);
  });
});

describe("sync-burst F-KW2 — kill-window readiness skips a dead friendly", () => {
  const combat = (units: ICombatUnit[]) =>
    ({
      startTime: START,
      endTime: START + 300_000,
      units: Object.fromEntries(units.map((u) => [u.id, u])),
    }) as unknown as AtomicArenaCombat;
  const druid = (deathRecords: { timestamp: number }[]) =>
    makeUnit("P1", {
      class: CombatUnitClass.Druid,
      spec: CombatUnitSpec.Druid_Balance,
      deathRecords,
    });
  const target = makeUnit("E1");

  it("alive at the span start → the roster's offensive cooldowns are ready and the span is accountable", () => {
    const f = druid([]);
    const facts = createKillWindowFactsComputer(
      combat([f, target]),
      [f],
      [target],
    ).facts(target, 83, 90);
    expect(facts.readyOffCds.length).toBeGreaterThan(0);
    expect(facts.accountable).toBe(true);
  });

  it("dead at 67.03, span from 83 → nothing ready, not accountable (539b6ed0 H:45)", () => {
    const f = druid(diedAt(67.03));
    const facts = createKillWindowFactsComputer(
      combat([f, target]),
      [f],
      [target],
    ).facts(target, 83, 90);
    expect(facts.readyOffCds).toEqual([]);
    expect(facts.accountable).toBe(false);
    // the same Druid before he died
    expect(
      createKillWindowFactsComputer(combat([f, target]), [f], [target]).facts(
        target,
        66,
        81,
      ).readyOffCds.length,
    ).toBeGreaterThan(0);
  });
});

describe("res-readiness F-C4 — [RES] drops a dead holder's entries", () => {
  const cd = (
    spellName: string,
    casts: number[] = [],
    cooldownSeconds = 120,
  ): IMajorCooldownInfo =>
    ({
      spellId: spellName,
      spellName,
      tag: "Defensive",
      cooldownSeconds,
      casts: casts.map((timeSeconds) => ({ timeSeconds })),
      availableWindows: [],
      neverUsed: casts.length === 0,
    }) as unknown as IMajorCooldownInfo;
  const owner = makeUnit("P1", { deathRecords: diedAt(67.03) });
  const mate = makeUnit("P2");
  const ownerCDs = [cd("Incarnation"), cd("Barkskin", [60])];
  const teammates = [
    { cds: [cd("Life Cocoon")], playerLabel: "3", player: mate },
  ];
  const deaths = { matchStartMs: START, ownerUnit: owner };

  it("the row at the death second keeps the dying unit's entries; the next second has none", () => {
    expect(computeReadyNames(67, ownerCDs, teammates, deaths)).toEqual([
      "Incarnation",
      "3:Life Cocoon",
    ]);
    expect(computeReadyNames(68, ownerCDs, teammates, deaths)).toEqual([
      "3:Life Cocoon",
    ]);
    expect(computeOnCDDisplayNames(67, ownerCDs, teammates, deaths)).toEqual([
      "Barkskin@60",
    ]);
    expect(computeOnCDDisplayNames(68, ownerCDs, teammates, deaths)).toEqual(
      [],
    );
  });

  it("a dead teammate's entries go the same way; without the deaths argument nobody is dead", () => {
    const deadMate = makeUnit("P2", { deathRecords: diedAt(40) });
    const withDead = [
      { cds: [cd("Life Cocoon")], playerLabel: "3", player: deadMate },
    ];
    expect(
      computeReadyNames(83, [cd("Ironbark")], withDead, {
        matchStartMs: START,
        ownerUnit: makeUnit("P1"),
      }),
    ).toEqual(["Ironbark"]);
    expect(computeReadyNames(83, [cd("Ironbark")], withDead)).toEqual([
      "Ironbark",
      "3:Life Cocoon",
    ]);
  });

  const snapshot = (
    timeSeconds: number,
    extra: Partial<Parameters<typeof buildResourceSnapshot>[0]> = {},
  ) =>
    buildResourceSnapshot({
      timeSeconds,
      ownerCDs,
      ownerName: "P1",
      ownerSpec: "Balance Druid",
      teammateCDs: [
        { player: mate, spec: "Mistweaver Monk", cds: [cd("Life Cocoon")] },
      ],
      ccTrinketSummaries: [],
      enemyCDTimeline: { players: [], alignedBurstWindows: [] } as never,
      playerIdMap: new Map([
        ["P1", 1],
        ["P2", 3],
      ]),
      matchStartMs: START,
      ownerUnit: owner,
      ...extra,
    });

  it("full row after the death: only the living holder's cooldowns", () => {
    const line = snapshot(83);
    expect(line).toContain("rdy:3:Life Cocoon");
    expect(line).not.toContain("Incarnation");
    expect(line).not.toContain("Barkskin");
  });

  it("delta row after the death: no `-X` for what the dead holder had", () => {
    const line = snapshot(83, {
      prevReadyNames: ["Incarnation", "3:Life Cocoon"],
      prevOnCDNames: ["Barkskin@60"],
    });
    // nothing else changed, so the row is empty and suppressed — the death is
    // on its own line and the ledger does not restate it as "-Incarnation"
    expect(line).toBe("");
    // with a real change next to it, only that change is printed
    const withChange = snapshot(83, {
      prevReadyNames: ["Incarnation"],
      prevOnCDNames: ["Barkskin@60"],
    });
    expect(withChange).toContain("rdy:Δ +3:Life Cocoon");
    expect(withChange).not.toContain("Incarnation");
    expect(withChange).not.toContain("Barkskin");
  });

  it("control: a living holder whose cooldown was spent still prints `-X`", () => {
    const line = buildResourceSnapshot({
      timeSeconds: 83,
      ownerCDs: [cd("Incarnation", [80])],
      ownerName: "P1",
      ownerSpec: "Balance Druid",
      teammateCDs: [],
      ccTrinketSummaries: [],
      enemyCDTimeline: { players: [], alignedBurstWindows: [] } as never,
      matchStartMs: START,
      ownerUnit: makeUnit("P1"),
      prevReadyNames: ["Incarnation"],
      prevOnCDNames: [],
    });
    expect(line).toContain("-Incarnation");
  });
});

describe("kick-eaten F-K7e — the post-kick window ends at the player's death", () => {
  const kickInst = (over: Record<string, unknown> = {}) => ({
    atSeconds: 173.436,
    lockoutDurationSeconds: 3,
    kickSpellName: "Rebuke",
    interruptedSpellName: "Drain Life",
    sourceName: "Ret",
    postKick: "idle" as const,
    firstActionDelayS: null as number | null,
    switchSpellName: null,
    switchDelayS: null,
    switchWasHardCast: null,
    nearestKickerDistYd: null,
    kickersInRange: null,
    kickDepthPct: null,
    ...over,
  });
  const failed = (t: number, spellId: number, reason = "尚未恢复") => ({
    tSeconds: t,
    unitGuid: "P1",
    spellId,
    spellName: `spell-${spellId}`,
    reason,
  });
  const streams = (castFailed: ReturnType<typeof failed>[]): RawStreams => ({
    available: true,
    manaSamples: [],
    castFailed,
  });
  const postKick = (
    inst: ReturnType<typeof kickInst>,
    presses: ReturnType<typeof failed>[],
  ) =>
    kickEatenEvents(
      [inst as never],
      { id: "P1", name: "Me" },
      {
        rawStreams: streams(presses),
        ownerCasts: [],
      },
    )[0]!.facts["postKick"]!;

  it("f4eb8c87 r4: the press 0.3 s after the death is not a rejected press, and the span is the time alive", () => {
    const f = postKick(kickInst({ diedAfterKickS: 2.74 }), [
      // the player died at 176.176; this one is "You are dead"
      failed(176.485, 605, "你已经死亡"),
    ]);
    expect(f).toBe("no cast before dying 2.7s after the kick");
  });

  it("a press made while still alive stays, under the shortened span", () => {
    const f = postKick(kickInst({ diedAfterKickS: 2.74 }), [
      failed(174.5, 605, "目标不在视野中"),
      failed(176.485, 605, "你已经死亡"),
    ]);
    expect(f).toContain("no successful cast before dying 2.7s after the kick");
    expect(f).toContain("pressed 1x but rejected");
  });

  it("control: a player who outlived the window keeps the 5 s wording and every press", () => {
    const f = postKick(kickInst(), [failed(176.485, 605, "目标不在视野中")]);
    expect(f).toContain("no successful cast for 5s after the kick");
    expect(f).toContain("pressed 1x but rejected");
  });
});

// codex review of b1 (2026-10-02): the three boundaries.
describe("G4 b1 boundaries", () => {
  it("[RES]: a death at exactly the row's second keeps that row, like one 30 ms in", () => {
    const cd = {
      spellId: "1",
      spellName: "Ready CD",
      tag: "Defensive",
      cooldownSeconds: 60,
      casts: [],
      availableWindows: [],
      neverUsed: true,
    } as unknown as IMajorCooldownInfo;
    for (const deathS of [67, 67.03]) {
      const owner = makeUnit("P1", { deathRecords: diedAt(deathS) });
      const deaths = { matchStartMs: START, ownerUnit: owner };
      expect(computeReadyNames(67, [cd], [], deaths)).toEqual(["Ready CD"]);
      expect(computeReadyNames(68, [cd], [], deaths)).toEqual([]);
    }
  });

  it("kick-eaten: a press in the death's own millisecond is not counted (no float drift)", () => {
    const evts = kickEatenEvents(
      [
        {
          atSeconds: 0.177,
          lockoutDurationSeconds: 3,
          kickSpellName: "Rebuke",
          interruptedSpellName: "Drain Life",
          sourceName: "Ret",
          postKick: "idle" as const,
          firstActionDelayS: null,
          switchSpellName: null,
          switchDelayS: null,
          switchWasHardCast: null,
          nearestKickerDistYd: null,
          kickersInRange: null,
          kickDepthPct: null,
          diedAfterKickS: 0.838 - 0.177,
        } as never,
      ],
      { id: "P1", name: "Me" },
      {
        rawStreams: {
          available: true,
          manaSamples: [],
          castFailed: [
            {
              tSeconds: 0.838,
              unitGuid: "P1",
              spellId: 605,
              spellName: "x",
              reason: "你已经死亡",
            },
          ],
        },
        ownerCasts: [],
      },
    );
    expect(evts[0]!.facts["postKick"]).toBe(
      "no cast before dying 0.7s after the kick",
    );
  });
});

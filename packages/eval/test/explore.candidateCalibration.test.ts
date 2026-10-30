/**
 * Task 5 (P1/P2 distillation) fixture tests for
 * `../src/explore/candidateCalibration.ts` — the corpus calibration scan for
 * the four new candidate builders + threatAssessment's predicates. Per
 * CLAUDE.md ("don't leave a one-shot script"), this scanner is meant to run
 * again for future calibration passes, so its wiring/aggregation logic gets
 * real unit coverage rather than only being exercised by the (unrepeated)
 * corpus scan CLI run.
 *
 * Deliberately does NOT re-verify each builder's own filtering rules (those
 * are candidateFindings.test.ts's / threatAssessment.test.ts's job) — only
 * this module's own glue: context building, raw-vs-capped counting via the
 * `overrides` threading, the missed-sync/unsynced-burst zero-ccWindows short
 * circuit, and `summarize`'s arithmetic.
 */
import type { RawStreams } from "@gladlog/analysis";
import type { ICombatUnit } from "@gladlog/parser-compat";
import { CombatUnitReaction } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  buildRoundContext,
  countsAtThresholds,
  type RoundCandidateCounts,
  type RoundContext,
  summarize,
} from "../src/explore/candidateCalibration";
import type { LegacyRound } from "../src/explore/storeAccess";

const START = 1_000_000;

function unit(overrides: Partial<ICombatUnit> = {}): ICombatUnit {
  return {
    id: overrides.id ?? "u1",
    name: overrides.name ?? "Unit-Realm",
    reaction: overrides.reaction ?? CombatUnitReaction.Friendly,
    info: overrides.info ?? ({} as never),
    class: overrides.class ?? ("Priest" as never),
    spec: overrides.spec ?? (undefined as never),
    advancedActions: overrides.advancedActions ?? [],
    damageIn: overrides.damageIn ?? [],
    auraEvents: overrides.auraEvents ?? [],
    spellCastEvents: overrides.spellCastEvents ?? [],
    deathRecords: overrides.deathRecords ?? [],
    ...overrides,
  } as unknown as ICombatUnit;
}

function legacyOf(units: ICombatUnit[]): LegacyRound {
  const byId: Record<string, ICombatUnit> = {};
  for (const u of units) byId[u.id] = u;
  return {
    units: byId,
    playerId: units[0]?.id,
    startTime: START,
    endTime: START + 300_000,
  } as unknown as LegacyRound;
}

describe("buildRoundContext", () => {
  it("returns null when there is no friendly player (mirrors teamPlayEvents' own early return)", () => {
    const enemy = unit({ id: "e1", reaction: CombatUnitReaction.Hostile });
    expect(buildRoundContext("m1", legacyOf([enemy]))).toBeNull();
  });

  it("returns null when there is no enemy player", () => {
    const friend = unit({ id: "f1", reaction: CombatUnitReaction.Friendly });
    expect(buildRoundContext("m1", legacyOf([friend]))).toBeNull();
  });

  it("owner falls back to the first friendly player when none is a healer spec", () => {
    const friend = unit({ id: "f1", reaction: CombatUnitReaction.Friendly });
    const enemy = unit({ id: "e1", reaction: CombatUnitReaction.Hostile });
    const ctx = buildRoundContext("m1", legacyOf([friend, enemy]));
    expect(ctx?.owner.id).toBe("f1");
  });

  it("carries matchId/roundSeq through unchanged", () => {
    const friend = unit({ id: "f1", reaction: CombatUnitReaction.Friendly });
    const enemy = unit({ id: "e1", reaction: CombatUnitReaction.Hostile });
    const ctx = buildRoundContext("m-abc", legacyOf([friend, enemy]), 2);
    expect(ctx?.matchId).toBe("m-abc");
    expect(ctx?.roundSeq).toBe(2);
  });

  // Task 6 (P1/P2 owner-phantom lesson applied prospectively): `owner` above
  // always resolves via `?? friends[0]`, but `ownerResolvable` mirrors
  // production's real `resolveOwner` gate (`splitTeams`'s own `owner`, which
  // CAN be undefined) — the two must diverge on exactly this fixture shape.
  it("ownerResolvable is false when neither playerId nor a healer spec resolves (mirrors resolveOwner's own undefined case)", () => {
    const friend = unit({
      id: "f1",
      spec: "0" as never, // not a healer spec
      reaction: CombatUnitReaction.Friendly,
    });
    const enemy = unit({ id: "e1", reaction: CombatUnitReaction.Hostile });
    const legacy = {
      units: { f1: friend, e1: enemy },
      playerId: "no-such-id",
      startTime: START,
      endTime: START + 300_000,
    } as unknown as LegacyRound;
    const ctx = buildRoundContext("m1", legacy);
    // owner (unconditional fallback) still resolves...
    expect(ctx?.owner.id).toBe("f1");
    // ...but ownerResolvable correctly reports production would show nothing.
    expect(ctx?.ownerResolvable).toBe(false);
  });

  it("ownerResolvable is true when a friendly healer exists even without a playerId match", () => {
    const friend = unit({
      id: "f1",
      spec: "257" as never, // Priest_Holy
      reaction: CombatUnitReaction.Friendly,
    });
    const enemy = unit({ id: "e1", reaction: CombatUnitReaction.Hostile });
    const legacy = {
      units: { f1: friend, e1: enemy },
      playerId: "no-such-id",
      startTime: START,
      endTime: START + 300_000,
    } as unknown as LegacyRound;
    const ctx = buildRoundContext("m1", legacy);
    expect(ctx?.ownerResolvable).toBe(true);
  });
});

/**
 * Parity vs `resolveOwner`'s own truth table (Task 6 review round 1,
 * 2026-08-15, task-6-review.md Important #2). `ownerResolvable`
 * (`splitTeams(legacy).owner !== undefined`, `storeAccess.ts`) is a
 * hand-written mirror of production's `resolveOwner`
 * (`packages/desktop/src/renderer/src/report/derive/analysisInput.ts:31-45`)
 * — NOT an import (`packages/eval` cannot depend on that file: it pulls in
 * an Electron-renderer `window.gladlog` bridge that has no place in a Node
 * vitest run). CLAUDE.md's shared-predicate fallback for a genuinely
 * unshareable export is a pinned equality table; this is the SAME five-case
 * table as `packages/desktop/test/analysisInput.test.ts`'s
 * `describe("resolveOwner")` block (cases ①-⑤ below correspond 1:1 to that
 * file's ①-⑤) — both files must be updated together if either function's
 * branch structure ever changes. Registered in `docs/predicate-index.md`'s
 * "Not yet unified" section.
 *
 * Each case here adds one harmless enemy unit beyond what
 * `resolveOwner`'s own table needs (`buildRoundContext` returns `null` for
 * any round with zero enemies — a gate unrelated to owner resolution
 * itself, see its own doc comment), and asserts on `ownerResolvable`
 * (undefined-or-not) rather than a resolved unit id, since that is the only
 * thing `RoundContext` exposes — `owner` itself is deliberately the
 * DIFFERENT, always-resolving predicate (see the tests above).
 */
describe("ownerResolvable parity vs resolveOwner's own truth table", () => {
  function legacyOfWithPlayerId(
    units: ICombatUnit[],
    playerId: string,
  ): LegacyRound {
    const byId: Record<string, ICombatUnit> = {};
    for (const u of units) byId[u.id] = u;
    return {
      units: byId,
      playerId,
      startTime: START,
      endTime: START + 300_000,
    } as unknown as LegacyRound;
  }

  it("① playerId 命中一个友方玩家 → resolvable(不看是不是治疗)", () => {
    const p1 = unit({ id: "p1", reaction: CombatUnitReaction.Friendly });
    const e1 = unit({
      id: "e1",
      reaction: CombatUnitReaction.Hostile,
      spec: "257" as never,
    });
    const ctx = buildRoundContext("m1", legacyOfWithPlayerId([p1, e1], "p1"));
    expect(ctx?.ownerResolvable).toBe(true);
  });

  it("② playerId 不命中任何人,但存在友方治疗 → resolvable(回退到治疗)", () => {
    const p1 = unit({ id: "p1", reaction: CombatUnitReaction.Friendly });
    const heal = unit({
      id: "heal",
      reaction: CombatUnitReaction.Friendly,
      spec: "257" as never, // Priest_Holy
    });
    const e1 = unit({ id: "e1", reaction: CombatUnitReaction.Hostile });
    const ctx = buildRoundContext(
      "m1",
      legacyOfWithPlayerId([p1, heal, e1], "no-such-id"),
    );
    expect(ctx?.ownerResolvable).toBe(true);
  });

  it("③ playerId 命中的是敌方单位(id 巧合)→ 不算数,回退到友方治疗 → resolvable", () => {
    const p1 = unit({ id: "p1", reaction: CombatUnitReaction.Hostile });
    const heal = unit({
      id: "heal",
      reaction: CombatUnitReaction.Friendly,
      spec: "257" as never,
    });
    const ctx = buildRoundContext("m1", legacyOfWithPlayerId([p1, heal], "p1"));
    expect(ctx?.ownerResolvable).toBe(true);
  });

  it("④ playerId 命中的友方单位没有 info(非玩家,如宠物)→ 不算数,回退到友方治疗 → resolvable", () => {
    const pet = unit({
      id: "pet",
      reaction: CombatUnitReaction.Friendly,
      info: undefined as never,
    });
    const heal = unit({
      id: "heal",
      reaction: CombatUnitReaction.Friendly,
      spec: "257" as never,
    });
    const e1 = unit({ id: "e1", reaction: CombatUnitReaction.Hostile });
    const ctx = buildRoundContext(
      "m1",
      legacyOfWithPlayerId([pet, heal, e1], "pet"),
    );
    expect(ctx?.ownerResolvable).toBe(true);
  });

  it("⑤ playerId 不命中,且没有任何友方治疗 → NOT resolvable", () => {
    const p1 = unit({
      id: "p1",
      reaction: CombatUnitReaction.Friendly,
      spec: "0" as never,
    });
    const e1 = unit({
      id: "e1",
      reaction: CombatUnitReaction.Hostile,
      spec: "257" as never,
    });
    const ctx = buildRoundContext(
      "m1",
      legacyOfWithPlayerId([p1, e1], "no-such-id"),
    );
    expect(ctx?.ownerResolvable).toBe(false);
  });
});

/** Hand-built context (bypassing buildRoundContext/splitTeams) so the
 * threshold-override-threading tests below don't depend on
 * extractMajorCooldowns/enemyHealerCcWindows succeeding on a synthetic unit —
 * only countsAtThresholds' own wiring is under test here. */
function makeCtx(overrides: Partial<RoundContext> = {}): RoundContext {
  const friend = unit({ id: "f1", reaction: CombatUnitReaction.Friendly });
  const enemy = unit({ id: "e1", reaction: CombatUnitReaction.Hostile });
  return {
    matchId: "m1",
    roundSeq: undefined,
    friends: [friend],
    enemies: [enemy],
    owner: friend,
    ownerCds: [],
    ccWindows: [],
    teamOffensiveCds: [],
    // unsynced-burst 可行性门(2026-08-22):手搭上下文里默认「队伍有硬控可用」,
    // 让这些用例继续只测阈值透传本身,不被新门牵连
    teamCcReadyAt: () => true,
    enemyHealerNames: [],
    legacy: legacyOf([friend, enemy]),
    rawStreams: { available: false, manaSamples: [], castFailed: [] },
    ownerResolvable: true,
    ...overrides,
    // cd-hoarded reads the ledger with the baseline rows; a test that hands
    // in `ownerCds` means that one ledger for both
    ownerCdsWithBaseline:
      overrides.ownerCdsWithBaseline ?? overrides.ownerCds ?? [],
  };
}

// 2026-08-30 (GH #34 cd-hoarded decision-point rewrite): the retired
// minLateS/crisisHpPct threshold-threading tests are gone along with the
// threshold pair itself (see cooldownTiming.ts's `cdHoardedEvents` doc
// comment) — `countsAtThresholds` no longer takes a `cdHoardThresholds`
// override at all. This block now only exercises `countsAtThresholds`' OWN
// wiring glue (building crisisDecisionPoints sources for the owner + every
// teammate, threading raw-vs-capped through the real builder) — the
// predicate's own filtering rules (ready/spent/own-vs-teammate) are
// candidateFindings.test.ts's/cdHoardedSelfOnly.test.ts's job, same
// division of labor the module header above describes.
describe("countsAtThresholds — cd-hoarded wiring", () => {
  // A real HP crossing (100%→38%, well under crisisDecisionPoints'
  // CRISIS_HP_PCT=40%) with damage right before it (dangerous=true) — same
  // shape crisisDecisionPoints.test.ts's own default fixture uses. "642"
  // (Divine Shield) is a real `bigDefensiveSpellIds` entry so the OWN-crisis
  // help-gate (`PERSONAL_WALL_IDS`) actually admits it.
  const wall = {
    spellId: "642",
    spellName: "Divine Shield",
    tag: "Defensive",
    cooldownSeconds: 300,
    maxChargesDetected: 1,
    casts: [] as { timeSeconds: number }[],
    // RoundContext.ownerCds is typed as the full IMajorCooldownInfo[] (the
    // retired predicate's own `availableWindows` shape) even though
    // cdHoardedEvents itself no longer reads this field — kept empty/unused.
    availableWindows: [] as {
      fromSeconds: number;
      toSeconds: number;
      durationSeconds: number;
    }[],
    neverUsed: true,
  };
  // `logLine.timestamp` + `advancedActorId` are what `gridHpPct`
  // (analysis/src/utils/cooldowns.ts) reads — the [STATE] tick's sampler that
  // crisisDecisionPoints' render-grid anchor shares; flat `timestamp` is what
  // that module's own `samplesOf` reads. A fixture must carry both, and the
  // actor id must be the owning unit's, or no decision point can be anchored.
  function advancedAction(
    t: number,
    currentHp: number,
    maxHp = 100,
    actorId = "f1",
  ) {
    return {
      timestamp: START + t,
      logLine: { timestamp: START + t },
      advancedActorId: actorId,
      advancedActorMaxHp: maxHp,
      advancedActorCurrentHp: currentHp,
    } as never;
  }
  function damageAction(t: number, srcUnitId: string, amount: number) {
    return {
      timestamp: START + t,
      // production rows carry their log line (the school split keys on it)
      logLine: { timestamp: START + t, parameters: [] },
      srcUnitId,
      effectiveAmount: -amount,
    } as never;
  }
  function ctxWithOwnCrisis(cds: (typeof wall)[]): RoundContext {
    const enemy = unit({ id: "e1", reaction: CombatUnitReaction.Hostile });
    const friend = unit({
      id: "f1",
      reaction: CombatUnitReaction.Friendly,
      advancedActions: [
        advancedAction(0, 100),
        advancedAction(1000, 70),
        advancedAction(2000, 38),
        advancedAction(3000, 35),
      ],
      damageIn: [damageAction(1500, "e1", 30)],
    });
    return makeCtx({
      friends: [friend],
      owner: friend,
      ownerCds: cds,
      legacy: legacyOf([friend, enemy]),
    });
  }

  it("a ready personal wall not cast → 1 capped candidate", () => {
    const ctx = ctxWithOwnCrisis([wall]);
    expect(countsAtThresholds(ctx).cdHoardedCapped).toBe(1);
  });

  it("the same wall cast inside the response window → 0 (spent, not hoarded)", () => {
    const cast = { ...wall, casts: [{ timeSeconds: 3 }] }; // crossing tSec=2, +1s is inside CD_HOARD_RESPONSE_S
    const ctx = ctxWithOwnCrisis([cast]);
    expect(countsAtThresholds(ctx).cdHoardedCapped).toBe(0);
  });

  it("raw count is read through the same builder with an uncapped override, never a second rule", () => {
    // Two independent decision points (owner's own crisis + a teammate's),
    // each with its own ready, uncast wall — raw must see both.
    const enemy = unit({ id: "e1", reaction: CombatUnitReaction.Hostile });
    const owner = unit({
      id: "f1",
      reaction: CombatUnitReaction.Friendly,
      advancedActions: [
        advancedAction(0, 100),
        advancedAction(1000, 70),
        advancedAction(2000, 38),
        advancedAction(3000, 35),
      ],
      damageIn: [damageAction(1500, "e1", 30)],
    });
    const mate = unit({
      id: "f2",
      name: "Mate-Realm",
      reaction: CombatUnitReaction.Friendly,
      advancedActions: [
        advancedAction(0, 100, 100, "f2"),
        advancedAction(1000, 70, 100, "f2"),
        advancedAction(2000, 38, 100, "f2"),
        advancedAction(3000, 35, 100, "f2"),
      ],
      damageIn: [damageAction(1500, "e1", 30)],
    });
    const ctx = makeCtx({
      friends: [owner, mate],
      owner,
      // "740" Tranquility is a real ally-reaching external — qualifies for
      // the mate's TEAMMATE-crisis help-gate (canHelpAnotherUnit) as well as
      // owner's own-crisis gate.
      ownerCds: [{ ...wall, spellId: "740", spellName: "Tranquility" }],
      legacy: legacyOf([owner, mate, enemy]),
    });
    const counts = countsAtThresholds(ctx);
    expect(counts.cdHoardedRaw).toBeGreaterThanOrEqual(counts.cdHoardedCapped);
    expect(counts.cdHoardedRaw).toBe(2);
  });
});

describe("countsAtThresholds — missed-sync-window/unsynced-burst zero-ccWindows short circuit", () => {
  it("both read 0/0 without any ccWindows, mirroring teamPlayEvents' own gate", () => {
    const ctx = makeCtx({ ccWindows: [] });
    const counts = countsAtThresholds(ctx);
    expect(counts.missedSyncWindowCapped).toBe(0);
    expect(counts.missedSyncWindowRaw).toBe(0);
    expect(counts.unsyncedBurstCapped).toBe(0);
    expect(counts.unsyncedBurstRaw).toBe(0);
  });
});

describe("countsAtThresholds — cd-spent-idle honors the threat-level red line (B6)", () => {
  it("threatOverrides that force a 'low' match threat still gate cd-spent-idle to []", () => {
    // No advancedActions anywhere → hasAnyHpData is false → matchThreatLevel
    // is unconditionally "low" regardless of overrides (the documented
    // conservative fallback) — exercises the real gate, not a mock.
    const cd = {
      spellId: "2",
      spellName: "Barrier",
      tag: "Defensive",
      cooldownSeconds: 180,
      maxChargesDetected: 1,
      casts: [{ timeSeconds: 50 }],
      availableWindows: [],
      neverUsed: false,
      isThroughput: false,
    };
    const ctx = makeCtx({ ownerCds: [cd] });
    const counts = countsAtThresholds(ctx);
    expect(counts.threatLevel).toBe("low");
    expect(counts.cdSpentIdleCapped).toBe(0);
  });
});

// Task 6 (raw-streams calibration) additions. Fixture shapes mirror
// candidateFindings.test.ts's own mana-pressure/mana-efficiency fixtures
// (real anchor spellIds 20473/82326 for efficiency, same window/reject
// magnitudes for pressure) — this file's job is only the calibration-module
// glue (rawStreams threading, overrides threading, rawAvailable), not
// re-verifying the builders' own filtering rules.
function manaRawStreams(): RawStreams {
  return {
    available: true,
    manaSamples: [
      { tSeconds: 10, unitGuid: "h", mana: 15000, manaMax: 273000 },
      { tSeconds: 15, unitGuid: "h", mana: 8000, manaMax: 273000 },
      { tSeconds: 20, unitGuid: "h", mana: 545, manaMax: 273000 },
    ],
    castFailed: [
      {
        tSeconds: 12,
        unitGuid: "h",
        spellId: 20473,
        spellName: "Holy Shock",
        reason: "法力值不足",
      },
      {
        tSeconds: 16,
        unitGuid: "h",
        spellId: 20473,
        spellName: "Holy Shock",
        reason: "法力值不足",
      },
      {
        tSeconds: 19,
        unitGuid: "h",
        spellId: 20473,
        spellName: "Holy Shock",
        reason: "法力值不足",
      },
    ],
  };
}

function healerUnit(overrides: Partial<ICombatUnit> = {}): ICombatUnit {
  return unit({
    id: "h",
    name: "Healer-R",
    spec: "257" as never, // Priest_Holy
    reaction: CombatUnitReaction.Friendly,
    ...overrides,
  });
}

describe("buildRoundContext — rawStreams threading (Task 6)", () => {
  it("threads a passed rawStreams through onto the returned context unchanged", () => {
    const friend = healerUnit();
    const enemy = unit({ id: "e1", reaction: CombatUnitReaction.Hostile });
    const raw = manaRawStreams();
    const ctx = buildRoundContext(
      "m1",
      legacyOf([friend, enemy]),
      undefined,
      raw,
    );
    expect(ctx?.rawStreams).toBe(raw);
  });

  it("no 4th arg -> rawStreams defaults to available:false (byte-identical to every pre-Task-6 call site)", () => {
    const friend = healerUnit();
    const enemy = unit({ id: "e1", reaction: CombatUnitReaction.Hostile });
    const ctx = buildRoundContext("m1", legacyOf([friend, enemy]));
    expect(ctx?.rawStreams).toEqual({
      available: false,
      manaSamples: [],
      castFailed: [],
    });
  });
});

describe("summarize", () => {
  function row(overrides: Partial<RoundCandidateCounts>): RoundCandidateCounts {
    return {
      matchId: "m",
      cdHoardedRaw: 0,
      cdHoardedCapped: 0,
      cdSpentIdleRaw: 0,
      cdSpentIdleCapped: 0,
      missedSyncWindowRaw: 0,
      missedSyncWindowCapped: 0,
      unsyncedBurstRaw: 0,
      unsyncedBurstCapped: 0,
      threatLevel: "low",
      rawAvailable: false,
      ownerResolvable: true,
      ...overrides,
    };
  }

  it("computes occurrence rate / mean-per-round for one type across 4 rounds", () => {
    const rows = [
      row({ cdHoardedCapped: 2, cdHoardedRaw: 3 }),
      row({ cdHoardedCapped: 0, cdHoardedRaw: 0 }),
      row({ cdHoardedCapped: 1, cdHoardedRaw: 1 }),
      row({ cdHoardedCapped: 0, cdHoardedRaw: 0 }),
    ];
    const s = summarize(rows);
    expect(s.roundsScanned).toBe(4);
    expect(s.perType.cdHoarded.occurrenceRatePct).toBe(50); // 2/4 rounds have >=1
    expect(s.perType.cdHoarded.meanCappedPerRound).toBeCloseTo(0.75); // (2+0+1+0)/4
    expect(s.perType.cdHoarded.meanRawPerRound).toBeCloseTo(1.0); // (3+0+1+0)/4
  });

  it("threat distribution sums to 100% across low/med/high", () => {
    const rows = [
      row({ threatLevel: "low" }),
      row({ threatLevel: "low" }),
      row({ threatLevel: "med" }),
      row({ threatLevel: "high" }),
    ];
    const s = summarize(rows);
    expect(s.threatDistributionPct.low).toBe(50);
    expect(s.threatDistributionPct.med).toBe(25);
    expect(s.threatDistributionPct.high).toBe(25);
  });

  it("empty input never divides by zero", () => {
    const s = summarize([]);
    expect(s.roundsScanned).toBe(0);
    expect(s.perType.cdHoarded.occurrenceRatePct).toBe(0);
    expect(s.threatDistributionPct).toEqual({ low: 0, med: 0, high: 0 });
    expect(s.rawAvailableRatePct).toBe(0);
  });

  it("rawAvailableRatePct:按 rawAvailable 行占比(mana-* 类型已退役,本字段仍服务 rawStreams 可用率报表)", () => {
    const rows = [
      row({ rawAvailable: true }),
      row({ rawAvailable: true }),
      row({ rawAvailable: false }),
    ];
    const s = summarize(rows);
    expect(s.rawAvailableRatePct).toBeCloseTo(66.67, 1);
  });
});

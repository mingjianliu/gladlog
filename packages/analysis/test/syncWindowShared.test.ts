/**
 * The shared sync-window predicate (reliability audit B3, 2026-09-25) — the
 * candidate `missedSyncWindowEvents` and the reference-table scan
 * `syncWindowScan.ts` both run these three functions:
 *  - B3ii  `mergeHealerCcWindows`: one continuous lock on a healer = one window
 *          (825ca842: Fear + Blind + Cheap Shot 51–57 was two candidates);
 *  - B3i   `evaluateSyncWindow` ready: the CD's owner must be free to act for
 *          ≥ REACTION_WINDOW_S of the lock (e9ea8a0c @298: The Hunt "ready"
 *          while its owner was stunned);
 *  - B3iii `evaluateSyncWindow` entered: a burst still ACTIVE at the lock
 *          counts (7c598eeb @33: Incarnation running across the Cyclone).
 */
import { ICombatUnit, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  countsAsTeamBurst,
  evaluateSyncWindow,
  lockChainName,
  mergeHealerCcWindows,
  syncWindowEligible,
} from "../src/analysis/candidates/cooldownTiming";
import { ensureAnalysisData } from "../src/data/ensure";
import { buffFullDurationForCaster } from "../src/utils/buffDuration";

beforeAll(async () => {
  await ensureAnalysisData();
});

const win = (
  from: number,
  to: number,
  spellName: string,
  healerName = "Heal-R",
) => ({
  fromSeconds: from,
  toSeconds: to,
  spellName,
  spellId: spellName,
  healerName,
  drLevel: undefined,
});

describe("mergeHealerCcWindows (B3ii)", () => {
  it("chains overlapping CC on the same healer into one window named after the chain (825ca842 @51)", () => {
    const out = mergeHealerCcWindows([
      win(51.24, 55.77, "Fear"),
      win(51.35, 53.85, "Blind"),
      win(53.59, 57.19, "Cheap Shot"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      fromSeconds: 51.24,
      toSeconds: 57.19,
      spellId: "Fear",
      spellName: "Fear→Blind→Cheap Shot",
    });
  });

  it("keeps a gap as two windows, and never merges across healers", () => {
    const out = mergeHealerCcWindows([
      win(40, 44, "Fear"),
      win(44.5, 48, "Blind"),
      win(41, 45, "Polymorph", "Other-R"),
    ]);
    expect(out.map((w) => `${w.healerName}:${w.spellName}`)).toEqual([
      "Heal-R:Fear",
      "Other-R:Polymorph",
      "Heal-R:Blind",
    ]);
  });

  it("a repeat of the same CC inside the chain is named once, with its count (FT-T09)", () => {
    const out = mergeHealerCcWindows([
      win(40, 44, "Fear"),
      win(43, 46, "Fear"),
    ]);
    // "Fear" alone read as one Fear of the whole lock's length
    expect(out[0]!.spellName).toBe("Fear ×2");
    expect(lockChainName(["Fear", "Cheap Shot", "Cheap Shot", "Fear"])).toBe(
      "Fear→Cheap Shot ×2→Fear",
    );
    expect(lockChainName(["Fear"])).toBe("Fear");
  });
});

describe("syncWindowEligible", () => {
  it("rendered start ≥ 30 s, rendered length ≥ 3 s, no enemy death inside", () => {
    // length is measured on the render grid (Shared-Predicate Rule): raw
    // 2.2 s rendered 40→43 is 3 s and qualifies; raw 2.0 s rendered 40→42 not
    expect(syncWindowEligible(win(40.9, 43.1, "x"), [])).toBe(true);
    expect(syncWindowEligible(win(40.9, 42.9, "x"), [])).toBe(false);
    expect(syncWindowEligible(win(29.9, 40, "x"), [])).toBe(false);
    expect(syncWindowEligible(win(40, 45, "x"), [42])).toBe(false);
    expect(syncWindowEligible(win(40, 45, "x"), [46])).toBe(true);
  });
});

describe("evaluateSyncWindow — ready needs an owner free to act (B3i)", () => {
  const START = 1_000_000;
  const ENEMY = "Enemy-1";
  const stunnedOwner = (fromS: number, toS: number) =>
    ({
      id: "Player-1",
      name: "Dh-R",
      auraEvents: [
        {
          spellId: "118",
          srcUnitId: ENEMY,
          timestamp: START + fromS * 1000,
          logLine: { event: LogEvent.SPELL_AURA_APPLIED },
        },
        {
          spellId: "118",
          srcUnitId: ENEMY,
          timestamp: START + toS * 1000,
          logLine: { event: LogEvent.SPELL_AURA_REMOVED },
        },
      ],
      actionIn: [],
      spellCastEvents: [],
    }) as unknown as ICombatUnit;
  const hunt = (owner?: ICombatUnit) => ({
    spellId: "370965",
    spellName: "The Hunt",
    casts: [] as { timeSeconds: number }[],
    cooldownSeconds: 90,
    neverUsed: true,
    ...(owner
      ? { owner, ownerEnemyIds: new Set([ENEMY]), matchStartMs: START }
      : {}),
  });
  const lock = win(100, 105, "Polymorph");

  it("owner locked out for all but 0.5 s of the lock → not ready (e9ea8a0c @298)", () => {
    expect(
      evaluateSyncWindow(lock, [hunt(stunnedOwner(99, 104.5))]).ready,
    ).toEqual([]);
  });

  // User ruling 2026-09-26 (reliability leftovers, sync-window question A):
  // free for 1 s of a lock is not "able to enter it" — the owner must be free
  // for at least half of the lock (couldActForMostOf). Before this the rule
  // was couldReactWithin's 1 s (e9ea8a0c: 2.2 s free while rooted was "ready").
  it("owner stunned for most of the lock (free 1 s of 5) → not ready", () => {
    expect(
      evaluateSyncWindow(lock, [hunt(stunnedOwner(99, 104))]).ready,
    ).toHaveLength(0);
  });
  it("owner free for more than half of the lock → ready", () => {
    expect(
      evaluateSyncWindow(lock, [hunt(stunnedOwner(99, 101))]).ready,
    ).toHaveLength(1);
  });

  it("no owner info (old callers) → the CD-availability test alone", () => {
    expect(evaluateSyncWindow(lock, [hunt()]).ready).toHaveLength(1);
  });
});

describe("evaluateSyncWindow — a merged lock is judged at each component start", () => {
  it("a CD back mid-lock (at the second CC's start) is ready — merging must not lose it (Intimidation 82.2 + Freezing Trap 85, Avenging Wrath back at 84)", () => {
    const [merged] = mergeHealerCcWindows([
      win(82.2, 85.2, "Intimidation"),
      win(85.0, 90.0, "Freezing Trap"),
    ]);
    const aw = {
      spellId: "31884",
      spellName: "Avenging Wrath",
      casts: [{ timeSeconds: 24 }],
      cooldownSeconds: 60,
      neverUsed: false,
    };
    expect(merged!.componentStartsSeconds).toEqual([82.2, 85.0]);
    expect(evaluateSyncWindow(merged!, [aw]).ready).toHaveLength(1);
    // judged at the merged start only, it would not be
    expect(
      evaluateSyncWindow({ fromSeconds: 82.2, toSeconds: 90 }, [aw]).ready,
    ).toHaveLength(0);
  });
});

describe("evaluateSyncWindow — entered counts a burst still active (B3iii)", () => {
  const owner = {
    id: "Player-2",
    name: "Boomkin-R",
    spec: undefined,
    info: undefined,
    spellCastEvents: [],
    auraEvents: [],
    actionIn: [],
  } as unknown as ICombatUnit;
  const INCARN = "102560";
  const incarn = (castAt: number) => ({
    spellId: INCARN,
    spellName: "Incarnation: Chosen of Elune",
    casts: [{ timeSeconds: castAt }],
    cooldownSeconds: 120,
    neverUsed: false,
    charges: 2,
    owner,
  });

  it("a burst pressed 16 s before the lock and still running counts as entered (7c598eeb @33)", () => {
    const dur = buffFullDurationForCaster(INCARN, owner);
    expect(dur).toBeGreaterThan(16);
    expect(
      evaluateSyncWindow(win(33.4, 37, "Cyclone"), [incarn(17.4)]).entered,
    ).toBe(true);
  });

  it("a burst that ended before the lock is not in it, however close", () => {
    const dur = buffFullDurationForCaster(INCARN, owner)!;
    const castAt = 33.4 - dur - 0.5;
    expect(
      evaluateSyncWindow(win(33.4, 37, "Cyclone"), [incarn(castAt)]).entered,
    ).toBe(false);
  });

  it("a press leading the lock by ≤ 2 s still counts (the pre-B3 test)", () => {
    const noDur = { ...incarn(31.5), owner: undefined };
    expect(evaluateSyncWindow(win(33.4, 37, "Cyclone"), [noDur]).entered).toBe(
      true,
    );
  });
});

describe("countsAsTeamBurst (B3iii, user ruling 2026-09-25)", () => {
  it("a healer's own offensive CD counts only when it is Power Infusion", () => {
    const holyPaladin = { spec: "65" };
    const discPriest = { spec: "256" };
    expect(countsAsTeamBurst(holyPaladin, "31884")).toBe(false); // Avenging Wrath
    expect(countsAsTeamBurst(discPriest, "10060")).toBe(true); // Power Infusion
  });

  it("a DPS's canonical offensive CD always counts; a non-offensive id never", () => {
    const ret = { spec: "70" };
    expect(countsAsTeamBurst(ret, "31884")).toBe(true);
    expect(countsAsTeamBurst(ret, "642")).toBe(false); // Divine Shield
  });
});

describe("evaluateSyncWindow — round 3 W1a legs (reliability leftovers batch 11)", () => {
  const START = 1_000_000;
  const at = (id: string, name: string, spec: unknown, xAt: (s: number) => number) =>
    ({
      id,
      name,
      spec,
      info: undefined,
      spellCastEvents: [],
      castStartEvents: [],
      auraEvents: [],
      actionIn: [],
      deathRecords: [],
      advancedActions: Array.from({ length: 401 }, (_, i) => ({
        timestamp: START + i * 500,
        logLine: { timestamp: START + i * 500 },
        advanced: true,
        advancedActorCurrentHp: 100,
        advancedActorMaxHp: 100,
        advancedActorPositionX: xAt(i / 2),
        advancedActorPositionY: 0,
        advancedActorPowers: [],
      })),
    }) as unknown as ICombatUnit;
  const lock = win(100, 105, "Polymorph");
  const smash = (owner: ICombatUnit, target: ICombatUnit) => ({
    spellId: "167105",
    spellName: "Colossus Smash",
    casts: [] as { timeSeconds: number }[],
    cooldownSeconds: 45,
    neverUsed: true,
    owner,
    ownerEnemyIds: new Set(["Enemy-1"]),
    matchStartMs: START,
    reachTargets: [target],
  });

  it("a melee CD whose owner never came within its reach of a burst target → not ready (82a2 Thunderstorm)", () => {
    const warrior = at("Player-1", "War-R", 71, () => 0);
    const far = at("Enemy-1", "Dk-R", 252, () => 20);
    const near = at("Enemy-1", "Dk-R", 252, () => 3);
    expect(evaluateSyncWindow(lock, [smash(warrior, far)]).ready).toHaveLength(0);
    expect(evaluateSyncWindow(lock, [smash(warrior, near)]).ready).toHaveLength(1);
  });

  it("a hard-cast CD whose bar STARTS inside the lock entered it (f4eb Demonic Tyrant)", () => {
    const lock2 = win(163.807, 167.143, "Mortal Coil");
    const lock2Warlock = at("Player-2", "Lock-R", 266, () => 0) as any;
    const tyrant = {
      spellId: "265187",
      spellName: "Summon Demonic Tyrant",
      casts: [{ timeSeconds: 167.861 }],
      cooldownSeconds: 90,
      neverUsed: false,
      owner: lock2Warlock,
      matchStartMs: START,
    };
    expect(evaluateSyncWindow(lock2, [tyrant]).entered).toBe(false);
    lock2Warlock.castStartEvents = [
      { spellId: "265187", timestamp: START + 166_724 },
    ];
    expect(evaluateSyncWindow(lock2, [tyrant]).entered).toBe(true);
  });
});

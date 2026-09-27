/**
 * agy post-hoc review of reliability leftovers batches 11–14 (2026-09-27):
 * each confirmed finding pinned by its own counterexample.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { CombatUnitReaction, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  evaluateSyncWindow,
  missedSyncWindowEvents,
} from "../src/analysis/candidates/cooldownTiming";
import {
  reflectedSpells,
  sanctuaryRemovals,
} from "../src/context/spellOutcomeLines";
import { getTopDamageSourcesInWindow } from "../src/context/timelineHelpers";
import { ensureAnalysisData } from "../src/data/ensure";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const REF = {
  cellKey: "3v3",
  nEntered: 174,
  killEnteredPct: 18,
  nUnentered: 174,
  killUnenteredPct: 8,
};
const probes = { enemyMinHpPctAt: () => 50, enemyDeathS: [], ref: REF } as any;
const lock = (from: number, to: number, spellId: string) => ({
  fromSeconds: from,
  toSeconds: to,
  spellName: spellId,
  spellId,
  healerName: "H1",
});

describe("batch 11 — same-hold folding needs the SAME ready set", () => {
  it("Recklessness pressed between two locks: the second lock (Avatar alone) is its own accusation, not folded into 'Avatar、Recklessness'", () => {
    const avatar = {
      spellId: "107574",
      spellName: "Avatar",
      casts: [{ timeSeconds: 0 }],
      cooldownSeconds: 90,
      neverUsed: false,
    };
    const reck = {
      spellId: "1719",
      spellName: "Recklessness",
      casts: [{ timeSeconds: 0 }, { timeSeconds: 140 }],
      cooldownSeconds: 90,
      neverUsed: false,
    };
    const out = missedSyncWindowEvents(
      [lock(100, 106, "118"), lock(160, 166, "33786")],
      [avatar, reck],
      probes,
    );
    expect(out).toHaveLength(2);
    expect(out.every((e) => !e.facts["alsoHeldAt"])).toBe(true);
  });
});

describe("batch 11 — no living burst target, no sync", () => {
  const owner: any = {
    id: "P",
    name: "P",
    spellCastEvents: [],
    auraEvents: [],
    actionIn: [],
    advancedActions: [],
  };
  const smash = (targets: any[]) => ({
    spellId: "167105",
    spellName: "Colossus Smash",
    casts: [] as { timeSeconds: number }[],
    cooldownSeconds: 45,
    neverUsed: true,
    owner,
    ownerEnemyIds: new Set(["E"]),
    matchStartMs: T0,
    reachTargets: targets,
  });
  it("every non-healer enemy dead before the lock → not ready", () => {
    const dead = {
      id: "E",
      name: "E",
      deathRecords: [{ timestamp: T0 + 40_000 }],
      advancedActions: [],
    };
    expect(
      evaluateSyncWindow({ fromSeconds: 80, toSeconds: 86 }, [smash([dead])])
        .ready,
    ).toHaveLength(0);
  });
  it("no non-healer enemy at all → not ready; old callers without reachTargets keep the availability test", () => {
    expect(
      evaluateSyncWindow({ fromSeconds: 80, toSeconds: 86 }, [smash([])]).ready,
    ).toHaveLength(0);
    const legacy = { ...smash([]), reachTargets: undefined };
    expect(
      evaluateSyncWindow({ fromSeconds: 80, toSeconds: 86 }, [legacy]).ready,
    ).toHaveLength(1);
  });
});

describe("batch 13 — reflect and Sanctuary identity", () => {
  const unit = (id: string, over: Record<string, unknown> = {}): any => ({
    id,
    name: `${id}-R-US`,
    spellCastEvents: [],
    auraEvents: [],
    missesOut: [],
    damageIn: [],
    absorbsIn: [],
    advancedActions: [0, 10_000, 20_000].map((ms) => ({
      advancedActorId: id,
      advancedActorMaxHp: 500_000,
      advancedActorCurrentHp: 500_000,
      logLine: { timestamp: T0 + ms },
    })),
    ...over,
  });
  it("another enemy's Fire Blast on the caster is not 'came back from the reflect'", () => {
    const caster = unit("Player-C", {
      missesOut: [
        {
          spellId: "108853",
          spellName: "x",
          missType: "REFLECT",
          destUnitId: "Player-W",
          logLine: { timestamp: T0 + 5_000 },
        },
      ],
      damageIn: [
        {
          spellId: "108853",
          srcUnitId: "Player-OtherMage",
          effectiveAmount: -200_000,
          logLine: { timestamp: T0 + 8_000 },
        },
      ],
    });
    expect(
      reflectedSpells([caster, unit("Player-W"), unit("Player-OtherMage")], T0),
    ).toHaveLength(0);
  });
  it("the Sanctuary-removed CC keeps its caster's GUID", () => {
    const pal = unit("Player-Pal", {
      spellCastEvents: [
        {
          spellId: "210256",
          destUnitId: "Player-H",
          logLine: {
            event: LogEvent.SPELL_CAST_SUCCESS,
            timestamp: T0 + 10_000,
          },
        },
      ],
    });
    const hunter = unit("Player-H", {
      auraEvents: [
        {
          spellId: "118905",
          spellName: "x",
          srcUnitName: "Capacitor Totem",
          srcUnitId: "Creature-0-1-1-1-61245-B",
          logLine: {
            event: LogEvent.SPELL_AURA_REMOVED,
            timestamp: T0 + 10_000,
          },
        },
      ],
    });
    const out = sanctuaryRemovals([pal, hunter], T0);
    expect(out[0]?.ccSourceId).toBe("Creature-0-1-1-1-61245-B");
  });
});

describe("batch 12 — absorbed parts: melee joins melee, attacker by GUID", () => {
  it("a swing absorb joins the landed 'Melee' line; a fully absorbed Starsurge names its caster from the unit map", () => {
    const hostile = 0x548;
    const unit = {
      id: "Player-V",
      reaction: CombatUnitReaction.Friendly,
      damageIn: [
        {
          logLine: { timestamp: T0 + 5_000 },
          effectiveAmount: -80_000,
          srcUnitId: "Player-E",
          srcUnitName: "Warr-R-US",
          srcUnitFlags: hostile,
          spellId: "0",
          spellName: "Melee",
          spellSchoolId: "0x1",
        },
      ],
      absorbsIn: [
        {
          timestamp: T0 + 5_000,
          absorbedAmount: 40_000,
          attackerId: "Player-E",
          srcUnitFlags: hostile,
          logLine: { timestamp: T0 + 5_000, parameters: [] },
        },
        {
          timestamp: T0 + 5_000,
          absorbedAmount: 150_000,
          attackerId: "Player-B",
          attackSpellId: "78674",
          attackSpellName: "Starsurge",
          srcUnitFlags: hostile,
          logLine: { timestamp: T0 + 5_000, parameters: [] },
        },
      ],
    } as never;
    const out = getTopDamageSourcesInWindow(
      unit,
      T0 + 10_000,
      10_000,
      3,
      new Map(),
      new Map([
        ["Warr-R-US", 4],
        ["Boomy-R-US", 5],
      ]),
      new Map(),
      new Map([
        ["Player-E", "Warr-R-US"],
        ["Player-B", "Boomy-R-US"],
      ]),
    );
    expect(out).toContain("5 — Starsurge (150k; 150k of it absorbed)");
    expect(
      out.some((l) => /^4 — Melee.*\(120k; 40k of it absorbed\)$/.test(l)),
    ).toBe(true);
    expect(out.join("\n")).not.toMatch(/Unknown|— melee/);
  });
});

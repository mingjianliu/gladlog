/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * R08 (b) (user ruling 2026-10-11): the kill-opportunity tier's "wall in
 * hand" asks the cooldown ledger which 20–99 % walls a unit HAS — a wall the
 * unit owns and has not pressed this round is in hand — where it used to
 * count a wall only once the unit cast it. f4da82c5: an enemy Warlock whose
 * kit line read `Unending Resolve [180s, lasts 8s] [UNUSED]` was the
 * `softer target … — PRIME` of the same prompt.
 *
 * The tier model is not what moved: prime > gated > locked, any 20–99 % wall
 * gates, immunities take no part, a pressed wall's cooldown arithmetic.
 */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { classMetadata } from "../src/data/classSpells";
import { ensureAnalysisData } from "../src/data/ensure";
import { extractMajorCooldowns, kitRowUnused } from "../src/utils/cooldowns";
import { softerTargetAt } from "../src/utils/killAttempts";
import {
  analyzeKillWindowTargetSelection,
  killOpportunityAt,
  unpressedWallsOwned,
  WALL_IN_HAND_MIT_IDS,
  wallInHandKitNames,
} from "../src/utils/killWindowTargetSelection";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

const T0 = 1_700_000_000_000;
const at = (s: number) => T0 + s * 1000;
const TRINKET = "336126";
const UNENDING_RESOLVE = "104773";
const ASTRAL_SHIFT = "108271";
/** Astral Shift's class-tree node for Restoration Shaman (talentIdMap.json) */
const ASTRAL_SHIFT_TALENT = { id1: 103616, id2: 127893, count: 1 };

const combatOf = (...units: any[]) =>
  ({
    startTime: T0,
    endTime: at(300),
    startInfo: { zoneId: "1505" },
    units: Object.fromEntries(units.map((u) => [u.id, u])),
  }) as any;
/** a unit whose trinket is spent from 0.5 s on (so the tier is prime or gated) */
const enemy = (
  id: string,
  over: Record<string, unknown> = {},
  casts: any[] = [],
) =>
  makeUnit(id, {
    name: id,
    reaction: CombatUnitReaction.Hostile,
    spellCastEvents: [makeSpellCastEvent(TRINKET, at(0.5), id), ...casts],
    ...over,
  } as any);
const warlock = (
  casts: any[] = [],
  info: any = { talents: [], pvpTalents: [] },
) =>
  enemy(
    "Lock",
    {
      class: CombatUnitClass.Warlock,
      spec: CombatUnitSpec.Warlock_Demonology,
      info,
    },
    casts,
  );
const shaman = (info: any) =>
  enemy("Sham", {
    class: CombatUnitClass.Shaman,
    spec: CombatUnitSpec.Shaman_Restoration,
    info,
  });

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("killOpportunityAt — a wall the unit owns and has not pressed is in hand", () => {
  it("f4da82c5's shape: a Warlock who never pressed Unending Resolve this round is gated, not PRIME", () => {
    const u = warlock();
    expect(unpressedWallsOwned(u, combatOf(u))).toEqual([
      { spellId: UNENDING_RESOLVE, name: "Unending Resolve" },
    ]);
    expect(killOpportunityAt(u, 70, combatOf(u))).toEqual({
      tier: "gated",
      trinketAvailable: false,
      wallsInHand: ["Unending Resolve"],
    });
  });

  it("it is the kit line's `[UNUSED]` row — the same ledger, the same reading", () => {
    const u = warlock();
    const combat = combatOf(u);
    const kitUnusedWalls = extractMajorCooldowns(u, combat, {
      withBaselineOnly: true,
    })
      .filter((cd) => WALL_IN_HAND_MIT_IDS.has(cd.spellId) && kitRowUnused(cd))
      .map((cd) => cd.spellName);
    expect(kitUnusedWalls).toEqual(["Unending Resolve"]);
    expect(unpressedWallsOwned(u, combat).map((r) => r.name)).toEqual(
      kitUnusedWalls,
    );
    // memoised per (unit, round)
    expect(unpressedWallsOwned(u, combat)).toBe(unpressedWallsOwned(u, combat));
  });

  it("a pressed wall keeps its cooldown arithmetic: spent → not in hand until it is back", () => {
    const u = warlock([makeSpellCastEvent(UNENDING_RESOLVE, at(10), "Lock")]);
    const combat = combatOf(u);
    expect(unpressedWallsOwned(u, combat)).toEqual([]);
    // 180 s cooldown from 10 s
    expect(killOpportunityAt(u, 70, combat).tier).toBe("prime");
    expect(killOpportunityAt(u, 70, combat).wallsInHand).toEqual([]);
    // back at 190 s (the trinket, spent at 0.5 s, is back by then too)
    expect(killOpportunityAt(u, 189, combat).wallsInHand).toEqual([]);
    expect(killOpportunityAt(u, 195, combat).wallsInHand).toEqual([
      "Unending Resolve",
    ]);
    // before its first press it was in hand, as before
    expect(killOpportunityAt(u, 5, combat).wallsInHand).toEqual([
      "Unending Resolve",
    ]);
  });

  it("the trinket still comes first: an unpressed wall on a trinket-up unit reads locked", () => {
    const u = makeUnit("Lock", {
      name: "Lock",
      reaction: CombatUnitReaction.Hostile,
      class: CombatUnitClass.Warlock,
      spec: CombatUnitSpec.Warlock_Demonology,
      info: { talents: [], pvpTalents: [] },
    } as any);
    expect(killOpportunityAt(u, 70, combatOf(u))).toMatchObject({
      tier: "locked",
      trinketAvailable: true,
      wallsInHand: ["Unending Resolve"],
    });
  });
});

describe("ownership is the ledger's — never a wall behind a talent the unit did not take", () => {
  it("a talent-tree wall: in hand with the talent in COMBATANT_INFO, absent without it", () => {
    const taken = shaman({ talents: [ASTRAL_SHIFT_TALENT], pvpTalents: [] });
    expect(unpressedWallsOwned(taken, combatOf(taken))).toEqual([
      { spellId: ASTRAL_SHIFT, name: "Astral Shift" },
    ]);
    expect(killOpportunityAt(taken, 70, combatOf(taken)).tier).toBe("gated");

    // talents decoded, Astral Shift not among them: not owned, not in hand —
    // the case the old "no cast, no proof they run it" guarded against
    const notTaken = shaman({ talents: [], pvpTalents: [] });
    expect(unpressedWallsOwned(notTaken, combatOf(notTaken))).toEqual([]);
    expect(killOpportunityAt(notTaken, 70, combatOf(notTaken)).tier).toBe(
      "prime",
    );
  });

  it("an undecodable talent blob proves no talent-tree wall (a cast would); the spec's DB2 baseline needs no talent", () => {
    const blind = shaman({ pvpTalents: [] });
    expect(unpressedWallsOwned(blind, combatOf(blind))).toEqual([]);
    const lock = warlock([], { pvpTalents: [] });
    expect(
      unpressedWallsOwned(lock, combatOf(lock)).map((r) => r.name),
    ).toEqual(["Unending Resolve"]);
  });

  it("a unit the class catalog cannot place (a hand-built fixture, a pet) owns nothing: the cast pass alone, as before", () => {
    const bare = enemy("Bare");
    expect(unpressedWallsOwned(bare, combatOf(bare))).toEqual([]);
    expect(killOpportunityAt(bare, 70, combatOf(bare)).tier).toBe("prime");
  });
});

describe("the readers of the tier move with it", () => {
  // the attempt's target still has its trinket; the Warlock spent his and
  // never pressed Unending Resolve
  const target = () =>
    makeUnit("Hunter", {
      name: "Hunter",
      reaction: CombatUnitReaction.Hostile,
    } as any);

  it("softerTargetAt: the Warlock is named as gated with his wall, no longer as PRIME", () => {
    const t = target();
    const lock = warlock();
    expect(softerTargetAt(t, [t, lock], 70, combatOf(t, lock))).toEqual({
      name: "Lock",
      tier: "gated",
      wallsInHand: ["Unending Resolve"],
    });
  });

  it("analyzeKillWindowTargetSelection (burst-into-mitigation's `softer target existed`, the desktop burst card): a gated alternative is no better target", () => {
    const t = target();
    const lock = warlock();
    const windows = [
      {
        targetUnitId: "Hunter",
        fromSeconds: 70,
        toSeconds: 80,
        durationSeconds: 10,
      },
    ] as any;
    const ev = analyzeKillWindowTargetSelection(
      windows,
      [t, lock],
      combatOf(t, lock),
    )[0]!;
    expect(ev.otherTargets[0]).toMatchObject({
      tier: "gated",
      wallsInHand: ["Unending Resolve"],
    });
    expect(ev.betterTargetExists).toBe(false);
    // …and with the wall spent the same alternative is prime, and is one
    const spent = warlock([
      makeSpellCastEvent(UNENDING_RESOLVE, at(10), "Lock"),
    ]);
    const ev2 = analyzeKillWindowTargetSelection(
      windows,
      [t, spent],
      combatOf(t, spent),
    )[0]!;
    expect(ev2.otherTargets[0]!.tier).toBe("prime");
    expect(ev2.betterTargetExists).toBe(true);
  });
});

describe("wallInHandKitNames — what the text gate reads a kit entry against", () => {
  it("holds the official and the catalog name of every wall id, and no catalog ability carries one of them under another id", () => {
    const names = wallInHandKitNames();
    expect(names.has("Unending Resolve")).toBe(true);
    expect(names.has("Astral Shift")).toBe(true);
    expect(names.has("Divine Shield")).toBe(false); // an immunity: no tier part
    for (const cls of classMetadata)
      for (const a of cls.abilities)
        if (names.has(a.name))
          expect(
            WALL_IN_HAND_MIT_IDS.has(a.spellId),
            `${a.name} ${a.spellId}`,
          ).toBe(true);
  });
});

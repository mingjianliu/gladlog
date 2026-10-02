/**
 * kick-eaten's cap against the playable end (triage 2026-09-29 F-K12a; found
 * by the pre-review of the batch, 2026-10-01). The menu cuts every candidate
 * past a 3v3's deciding death / a Solo Shuffle round's ending death — AFTER
 * the candidates are built. The kick-eaten cap ran before that cut, so kicks
 * from the unplayed tail (all deaths and crisis HP, the top of the pressure
 * order) took the slots and were then removed with nothing in their place.
 */
import { CombatUnitReaction, CombatUnitSpec } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { extractCandidateFindings } from "../src/analysis/candidateFindings";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  makeAdvancedAction,
  makeInterruptEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_000_000;

/** HP (% of a 100-HP pool) at every whole second, held between points. */
function hpWalk(points: Record<number, number>, untilS = 130) {
  const out = [];
  let cur = points[0] ?? 100;
  for (let s = 0; s <= untilS; s++) {
    if (points[s] !== undefined) cur = points[s]!;
    out.push(makeAdvancedAction(T0 + s * 1000, 0, 0, 100, cur));
  }
  return out;
}

/** A 3v3: enemy bursts running at 30 s and 50 s, a teammate at 20 % around
 * 70 s, the deciding death (MateA) at 100 s, a second death at 112 s. */
function round(kickSeconds: number[], bracket: string) {
  const cast = (id: string, s: number, src: string, name: string) =>
    makeSpellCastEvent(id, T0 + s * 1000, src, src, src, src, 0, name);
  const owner = makeUnit("player-1", {
    name: "Owner",
    spec: CombatUnitSpec.Priest_Discipline,
    reaction: CombatUnitReaction.Friendly,
    info: {},
    advancedActions: hpWalk({ 0: 100 }),
    actionIn: kickSeconds.map((s) =>
      makeInterruptEvent(
        "96231",
        "Rebuke",
        "2061",
        "Flash Heal",
        T0 + s * 1000,
        "e1",
        "Ret",
      ),
    ),
  });
  const mateA = makeUnit("f2", {
    name: "MateA",
    spec: CombatUnitSpec.Mage_Frost,
    reaction: CombatUnitReaction.Friendly,
    info: {},
    advancedActions: hpWalk({ 0: 100, 69: 20, 75: 90 }, 99),
    deathRecords: [{ timestamp: T0 + 100_000 }] as never,
  });
  const mateB = makeUnit("f3", {
    name: "MateB",
    spec: CombatUnitSpec.Warrior_Arms,
    reaction: CombatUnitReaction.Friendly,
    info: {},
    advancedActions: hpWalk({ 0: 100 }, 111),
    deathRecords: [{ timestamp: T0 + 112_000 }] as never,
  });
  const e1 = makeUnit("e1", {
    name: "Ret",
    spec: CombatUnitSpec.Paladin_Retribution,
    reaction: CombatUnitReaction.Hostile,
    info: {},
    advancedActions: hpWalk({ 0: 100 }),
    spellCastEvents: [cast("31884", 28, "e1", "Avenging Wrath")],
  });
  const e2 = makeUnit("e2", {
    name: "War",
    spec: CombatUnitSpec.Warrior_Fury,
    reaction: CombatUnitReaction.Hostile,
    info: {},
    advancedActions: hpWalk({ 0: 100 }),
    spellCastEvents: [cast("1719", 48, "e2", "Recklessness")],
  });
  const e3 = makeUnit("e3", {
    name: "EHeal",
    spec: CombatUnitSpec.Shaman_Restoration,
    reaction: CombatUnitReaction.Hostile,
    info: {},
    advancedActions: hpWalk({ 0: 100 }),
  });
  const units: Record<string, unknown> = {};
  for (const u of [owner, mateA, mateB, e1, e2, e3]) units[u.id] = u;
  return {
    startTime: T0,
    endTime: T0 + 130_000,
    startInfo: { bracket },
    units,
  };
}

const kicksOf = (kickSeconds: number[], bracket = "3v3") =>
  extractCandidateFindings(round(kickSeconds, bracket) as never, "player-1")
    .filter((e) => e.type === "kick-eaten")
    .map((e) => e.t);

describe("kick-eaten: kicks after the playable end do not take the cap's slots", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("nothing after the deciding death: death, crisis, then the two burst-only kicks", () => {
    expect(kicksOf([30, 50, 70, 95])).toEqual([95, 70, 30, 50]);
  });

  it("two kicks after the deciding death change nothing", () => {
    expect(kicksOf([30, 50, 70, 95, 105, 110])).toEqual([95, 70, 30, 50]);
    expect(kicksOf([30, 50, 95, 105, 110])).toEqual([95, 30, 50]);
  });

  it("three kicks after the deciding death do not push out the two played ones", () => {
    expect(kicksOf([30, 50, 105, 110, 111.5])).toEqual([30, 50]);
  });
});

/**
 * Pipeline T158 (GH #218 3.2): the death cut and the round-end cut asked
 * "does a copy of the effect outlive it" by the cooldown's English name
 * alone. A press whose effect aura carries another name — Predator's Wake
 * 1259431, whose DoT the log names "The Hunt" (370970) — read "no aura of
 * it" and was cut at its caster's death while the DoT ran on. One reading
 * now (`cooldownEffectAuras`): the cooldown's id, its effect ids
 * (`effectSpanIdsOfCast`) and all their names.
 */
import {
  CombatUnitType,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  casterAuraOutlives,
  cooldownEffectAuras,
  roundEndEndsEffect,
} from "../src/utils/enemyCDs";
import { makeAuraEvent, makeUnit } from "./ported/testHelpers";

const START = 1_000_000;
const PREDATORS_WAKE = "1259431";
const THE_HUNT_DOT = "370970";

beforeAll(async () => {
  await ensureAnalysisData();
});

/** a Demon Hunter (e1) whose DoT sits on a friendly (f1) from 10.5 s to
 * `removedAtS` */
const round = (
  removedAtS: number,
  appliedAtS = 10.5,
  auraId = THE_HUNT_DOT,
) => {
  const dh = makeUnit("e1", { name: "Hunter", auraEvents: [] });
  const target = makeUnit("f1", {
    name: "Target",
    auraEvents: [
      {
        ...makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          auraId,
          START + appliedAtS * 1000,
          "e1",
          "f1",
          "DEBUFF",
        ),
        srcUnitName: "Hunter",
      },
      {
        ...makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          auraId,
          START + removedAtS * 1000,
          "e1",
          "f1",
          "DEBUFF",
        ),
        srcUnitName: "Hunter",
      },
    ] as never,
  });
  return {
    dh,
    combat: {
      startTime: START,
      endTime: START + 60_000,
      units: { e1: dh, f1: target } as Record<string, ICombatUnit>,
    },
  };
};

describe("T158 — a cooldown's effect is read by its effect auras, not by its English name alone", () => {
  it("Predator's Wake's effect auras include The Hunt's DoT, by id and by name", () => {
    const e = cooldownEffectAuras(PREDATORS_WAKE);
    expect(e.ids.has(PREDATORS_WAKE)).toBe(true);
    expect(e.ids.has(THE_HUNT_DOT)).toBe(true);
    expect([...e.names].sort()).toEqual(["Predator's Wake", "The Hunt"]);
    // a name with no press of it: the name alone, as before
    expect(cooldownEffectAuras(undefined, "Power Infusion")).toEqual({
      ids: new Set(),
      names: new Set(["Power Infusion"]),
      ownName: "Power Infusion",
    });
  });

  it("the DoT running past the death: the effect outlives it (was: no aura of the name, cut)", () => {
    const { dh, combat } = round(16);
    // the caster dies at 12 s; the DoT runs to 16 s
    expect(
      casterAuraOutlives(
        dh,
        cooldownEffectAuras(PREDATORS_WAKE),
        START + 12_000,
        combat,
      ),
    ).toEqual({ any: true, outlives: true });
    // the name-only reading this replaces saw nothing at all
    expect(
      casterAuraOutlives(
        dh,
        { ids: new Set(), names: new Set(["Predator's Wake"]) },
        START + 12_000,
        combat,
      ),
    ).toEqual({ any: false, outlives: false });
    // a Solo Shuffle round ending at 12 s does not end it
    expect(
      roundEndEndsEffect(
        dh,
        cooldownEffectAuras(PREDATORS_WAKE),
        START + 12_000,
        combat,
      ),
    ).toBe(false);
  });

  it("the DoT gone with the death: the cut stands, now on evidence (`any`)", () => {
    const { dh, combat } = round(12.05);
    expect(
      casterAuraOutlives(
        dh,
        cooldownEffectAuras(PREDATORS_WAKE),
        START + 12_000 + 200,
        combat,
      ),
    ).toEqual({ any: true, outlives: false });
    expect(
      roundEndEndsEffect(
        dh,
        cooldownEffectAuras(PREDATORS_WAKE),
        START + 12_000,
        combat,
      ),
    ).toBe(true);
  });

  it("an effect aura under another name first applied AFTER the cut does not keep the press (batch check T158-1: Summon Infernal's Infernal Awakening landed 0.19 s after its warlock's death)", () => {
    // the caster dies at 12 s (+ the 100 ms cascade); the other-named aura
    // lands at 12.29 s and runs on
    const late = round(16, 12.29);
    expect(
      casterAuraOutlives(
        late.dh,
        cooldownEffectAuras(PREDATORS_WAKE),
        START + 12_100,
        late.combat,
      ),
    ).toEqual({ any: true, outlives: false });
    // the cooldown's OWN aura racing the cut's row keeps its landing lag
    const own = round(16, 12.29, PREDATORS_WAKE);
    expect(
      casterAuraOutlives(
        own.dh,
        cooldownEffectAuras(PREDATORS_WAKE),
        START + 12_100,
        own.combat,
      ),
    ).toEqual({ any: true, outlives: true });
  });

  it("The Hunt up only on a statue / pet at the death is not the effect running on: cut (ruling R67's reading, FT F13's — batch check T158-1, two rounds)", () => {
    const { dh, combat } = round(16);
    // the same DoT, but its only holder is a guardian
    (combat.units.f1 as { type: CombatUnitType }).type =
      CombatUnitType.Guardian;
    expect(
      casterAuraOutlives(
        dh,
        cooldownEffectAuras(PREDATORS_WAKE),
        START + 12_000,
        combat,
      ),
    ).toEqual({ any: false, outlives: false });
    // the cooldown's own-named copy on a pet still counts (T03 attempt 3)
    const own = round(16, 10.5, PREDATORS_WAKE);
    (own.combat.units.f1 as { type: CombatUnitType }).type =
      CombatUnitType.Guardian;
    expect(
      casterAuraOutlives(
        own.dh,
        cooldownEffectAuras(PREDATORS_WAKE),
        START + 12_000,
        own.combat,
      ),
    ).toEqual({ any: true, outlives: true });
  });
});

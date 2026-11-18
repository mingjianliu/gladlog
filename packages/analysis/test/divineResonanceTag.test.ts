/**
 * Pipeline T155 (r13 P1): Divine Toll's effect runs on the talent aura Divine
 * Resonance 1266308 (`TALENT_EFFECT_AURAS_OF_CAST`), and the aura readers
 * resolve it to Divine Toll for a Retribution paladin — the reading the
 * window builder, [RES] and the kill windows already had.
 */
import { CombatUnitSpec, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { castsOfTalentEffectAura } from "../src/data/castEffectAuras";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  friendlyOffensiveCdActiveAt,
  offensiveCdOfAura,
} from "../src/utils/cooldowns";
import { auraOffensiveOccurrences } from "../src/utils/offensiveAuraOccurrences";
import { makeAuraEvent, makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const at = (s: number) => T0 + s * 1000;
const round = { startTime: T0, endTime: at(120) };
const RESONANCE = "1266308";
const paladin = (spec: CombatUnitSpec) =>
  makeUnit("f1", {
    spec,
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        RESONANCE,
        at(34),
        "f1",
        "f1",
        "BUFF",
      ),
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        RESONANCE,
        at(56),
        "f1",
        "f1",
        "BUFF",
      ),
    ],
  }) as never;
const ask = (unit: never, s: number) =>
  friendlyOffensiveCdActiveAt([unit], [], new Set(["f1"]), at(s), round);

describe("Divine Resonance is Divine Toll's span for the aura readers (T155)", () => {
  it("the table reversed: the aura names its cast, for a Retribution paladin only", () => {
    expect(castsOfTalentEffectAura(RESONANCE)).toEqual(["375576"]);
    expect(castsOfTalentEffectAura("1719")).toEqual([]);
    expect(
      offensiveCdOfAura(RESONANCE, CombatUnitSpec.Paladin_Retribution),
    ).toBe("375576");
    expect(
      offensiveCdOfAura(RESONANCE, CombatUnitSpec.Paladin_Holy),
    ).toBeUndefined();
    expect(offensiveCdOfAura(RESONANCE)).toBeUndefined();
  });
  it("[friendly offensive CD active] holds while the Resonance is up, not before or after", () => {
    const ret = paladin(CombatUnitSpec.Paladin_Retribution);
    expect([ask(ret, 33), ask(ret, 34), ask(ret, 48), ask(ret, 57)]).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });
  it("a Holy paladin's is no offensive cooldown (its Divine Toll is a heal cooldown)", () => {
    expect(ask(paladin(CombatUnitSpec.Paladin_Holy), 48)).toBe(false);
  });
  it("the aura alone is no `(no press)` occurrence: its span is its press's", () => {
    expect(
      auraOffensiveOccurrences(
        paladin(CombatUnitSpec.Paladin_Retribution),
        round,
      ).occurrences,
    ).toEqual([]);
  });
});

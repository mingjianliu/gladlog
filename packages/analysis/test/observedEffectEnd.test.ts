import { CombatUnitType, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  EFFECT_CHAIN_GAP_S,
  observedEffectEndSeconds,
} from "../src/utils/enemyCDs";
import { makeAuraEvent, makeUnit } from "./ported/testHelpers";

/**
 * The observed-chain half of ruling A14 = B (triage kick-eaten F-K1): a
 * cast's span ends where its effect aura was seen to end. Avatar 107574
 * (20 s) on its caster.
 */
const T0 = 1_000_000;
const AVATAR = "107574";

function scene(auras: Array<[LogEvent, number, string?]>): {
  caster: ReturnType<typeof makeUnit>;
  combat: never;
} {
  const caster = makeUnit("c1", {
    name: "Caster",
    auraEvents: auras.map(([ev, s, src]) => ({
      ...makeAuraEvent(ev, AVATAR, T0 + s * 1000, "c1", "c1", "BUFF"),
      srcUnitName: src ?? "Caster",
    })),
  } as never);
  const combat = {
    startTime: T0,
    endTime: T0 + 200_000,
    units: { c1: caster },
  } as never;
  return { caster, combat };
}

describe("observedEffectEndSeconds", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("ends at the logged removal, shorter than the official length", () => {
    const { caster, combat } = scene([
      [LogEvent.SPELL_AURA_APPLIED, 10],
      [LogEvent.SPELL_AURA_REMOVED, 14],
    ]);
    expect(observedEffectEndSeconds(caster, AVATAR, 10, Infinity, combat)).toBe(
      14,
    );
  });

  it(`a re-application within ${EFFECT_CHAIN_GAP_S} s continues the chain; a later one does not`, () => {
    const kept = scene([
      [LogEvent.SPELL_AURA_APPLIED, 10],
      [LogEvent.SPELL_AURA_REMOVED, 30],
      [LogEvent.SPELL_AURA_APPLIED, 30.3],
      [LogEvent.SPELL_AURA_REMOVED, 41],
    ]);
    expect(
      observedEffectEndSeconds(kept.caster, AVATAR, 10, Infinity, kept.combat),
    ).toBe(41);
    const broken = scene([
      [LogEvent.SPELL_AURA_APPLIED, 10],
      [LogEvent.SPELL_AURA_REMOVED, 30],
      [LogEvent.SPELL_AURA_APPLIED, 30.8],
      [LogEvent.SPELL_AURA_REMOVED, 41],
    ]);
    expect(
      observedEffectEndSeconds(
        broken.caster,
        AVATAR,
        10,
        Infinity,
        broken.combat,
      ),
    ).toBe(30);
  });

  it("an application logged up to 0.5 s before the cast's success still starts the chain (Sim R1-A window)", () => {
    const { caster, combat } = scene([
      [LogEvent.SPELL_AURA_APPLIED, 9.6],
      [LogEvent.SPELL_AURA_REMOVED, 14],
    ]);
    expect(observedEffectEndSeconds(caster, AVATAR, 10, Infinity, combat)).toBe(
      14,
    );
  });

  it("no logged removal is no observation: null, the official length stands", () => {
    const { caster, combat } = scene([[LogEvent.SPELL_AURA_APPLIED, 10]]);
    expect(
      observedEffectEndSeconds(caster, AVATAR, 10, Infinity, combat),
    ).toBeNull();
  });

  it("the chain that ends last decides: a shorter buff's removal does not cut an unclosed effect on another unit (codex review: The Hunt)", () => {
    const caster = makeUnit("c1", {
      name: "Caster",
      auraEvents: [
        {
          ...makeAuraEvent(
            LogEvent.SPELL_AURA_APPLIED,
            AVATAR,
            T0 + 10_000,
            "c1",
            "c1",
            "BUFF",
          ),
          srcUnitName: "Caster",
        },
        {
          ...makeAuraEvent(
            LogEvent.SPELL_AURA_REMOVED,
            AVATAR,
            T0 + 10_400,
            "c1",
            "c1",
            "BUFF",
          ),
          srcUnitName: "Caster",
        },
      ],
    } as never);
    const target = makeUnit("t1", {
      name: "Target",
      auraEvents: [
        // applied 0.2 s in, never removed: ends at the official-length cap
        {
          ...makeAuraEvent(
            LogEvent.SPELL_AURA_APPLIED,
            AVATAR,
            T0 + 10_200,
            "c1",
            "t1",
            "DEBUFF",
          ),
          srcUnitName: "Caster",
        },
      ],
    } as never);
    const combat = {
      startTime: T0,
      endTime: T0 + 200_000,
      units: { c1: caster, t1: target },
    } as never;
    expect(
      observedEffectEndSeconds(caster, AVATAR, 10, Infinity, combat),
    ).toBeNull();
  });

  // FT F13 (9c6ab747): The Hunt's DoT left its player target at 83.9 and sat
  // on a Jade Serpent Statue until 85.1; a kick at 84.7 read the cooldown as
  // still running.
  describe("an effect on a summon is not the player's cooldown running", () => {
    const debuff = (
      ev: LogEvent,
      s: number,
      dest: string,
    ): Record<string, unknown> => ({
      ...makeAuraEvent(ev, AVATAR, T0 + s * 1000, "c1", dest, "DEBUFF"),
      srcUnitName: "Caster",
    });
    const sceneWithSummon = (
      type: CombatUnitType,
      playerAuras: Array<[LogEvent, number]>,
      summonAuras: Array<[LogEvent, number]>,
    ) => {
      const caster = makeUnit("c1", { name: "Caster" });
      const target = makeUnit("t1", {
        name: "Target",
        auraEvents: playerAuras.map(([ev, s]) => debuff(ev, s, "t1")),
      } as never);
      const summon = {
        ...makeUnit("s1", {
          name: "Statue",
          auraEvents: summonAuras.map(([ev, s]) => debuff(ev, s, "s1")),
        } as never),
        type,
      };
      const combat = {
        startTime: T0,
        endTime: T0 + 200_000,
        units: { c1: caster, t1: target, s1: summon },
      } as never;
      return { caster, combat };
    };

    for (const type of [
      CombatUnitType.Guardian,
      CombatUnitType.Pet,
      CombatUnitType.NPC,
    ])
      it(`a copy that outlasts the player's on a unit of type ${CombatUnitType[type]} does not lengthen the span`, () => {
        const { caster, combat } = sceneWithSummon(
          type,
          [
            [LogEvent.SPELL_AURA_APPLIED, 10],
            [LogEvent.SPELL_AURA_REMOVED, 16],
          ],
          [
            [LogEvent.SPELL_AURA_APPLIED, 11.2],
            [LogEvent.SPELL_AURA_REMOVED, 17.2],
          ],
        );
        expect(
          observedEffectEndSeconds(caster, AVATAR, 10, Infinity, combat),
        ).toBe(16);
      });

    it("a summon's unclosed copy does not hide the end the log shows on the player", () => {
      const { caster, combat } = sceneWithSummon(
        CombatUnitType.Pet,
        [
          [LogEvent.SPELL_AURA_APPLIED, 10],
          [LogEvent.SPELL_AURA_REMOVED, 16],
        ],
        [[LogEvent.SPELL_AURA_APPLIED, 10.1]],
      );
      expect(
        observedEffectEndSeconds(caster, AVATAR, 10, Infinity, combat),
      ).toBe(16);
    });

    it("an effect seen on a summon only is no observation: null, the official length stands", () => {
      const { caster, combat } = sceneWithSummon(
        CombatUnitType.Guardian,
        [],
        [
          [LogEvent.SPELL_AURA_APPLIED, 10],
          [LogEvent.SPELL_AURA_REMOVED, 13],
        ],
      );
      expect(
        observedEffectEndSeconds(caster, AVATAR, 10, Infinity, combat),
      ).toBeNull();
    });
  });

  it("another caster's aura, or one that belongs to the next press, is not this cast's", () => {
    const other = scene([
      [LogEvent.SPELL_AURA_APPLIED, 10, "Someone"],
      [LogEvent.SPELL_AURA_REMOVED, 14, "Someone"],
    ]);
    expect(
      observedEffectEndSeconds(
        other.caster,
        AVATAR,
        10,
        Infinity,
        other.combat,
      ),
    ).toBeNull();
    const next = scene([
      [LogEvent.SPELL_AURA_APPLIED, 40],
      [LogEvent.SPELL_AURA_REMOVED, 44],
    ]);
    // pressed at 39 and again at 40: the aura at 40 is the second press's
    expect(
      observedEffectEndSeconds(next.caster, AVATAR, 39, 40, next.combat),
    ).toBeNull();
  });
});

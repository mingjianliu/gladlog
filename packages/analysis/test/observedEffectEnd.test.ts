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
    // a re-statement at the removal's own instant is no occurrence of its
    // own (`auraOffensiveOccurrences` lists none) — the chain continues
    const kept = scene([
      [LogEvent.SPELL_AURA_APPLIED, 10],
      [LogEvent.SPELL_AURA_REMOVED, 30],
      [LogEvent.SPELL_AURA_APPLIED, 30.001],
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

  it("a re-application inside the gap that the timeline lists as its own (no press) occurrence ends the press's span (fact11 D24 / D30 / D41)", () => {
    // Soul Immolation's shape: removed, then a cast-less proc 0.26 s later —
    // `auraOffensiveOccurrences` prints it as its own occurrence, so the
    // press's span must not run on into it (the burst ledger credited the
    // proc twice)
    const proc = scene([
      [LogEvent.SPELL_AURA_APPLIED, 10],
      [LogEvent.SPELL_AURA_REMOVED, 30],
      [LogEvent.SPELL_AURA_APPLIED, 30.3],
      [LogEvent.SPELL_AURA_REMOVED, 41],
    ]);
    expect(
      observedEffectEndSeconds(proc.caster, AVATAR, 10, Infinity, proc.combat),
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

  it("round-1 retest idx 64: removed after the combat's end and past its official length → still up at the end", () => {
    // Avatar 20 s pressed at 150 s, REMOVED at 201 s (after the 200 s end):
    // the log shows it outliving 170 s, so it ran at least to 200
    const { caster, combat } = scene([
      [LogEvent.SPELL_AURA_APPLIED, 150],
      [LogEvent.SPELL_AURA_REMOVED, 201],
    ]);
    expect(
      observedEffectEndSeconds(caster, AVATAR, 150, Infinity, combat),
    ).toBe(200);
    // control (the Kingsbane case): pressed at 190 s, its official end 210 s
    // lies past the combat's end — the clamp says nothing, the official stands
    const late = scene([
      [LogEvent.SPELL_AURA_APPLIED, 190],
      [LogEvent.SPELL_AURA_REMOVED, 205],
    ]);
    expect(
      observedEffectEndSeconds(late.caster, AVATAR, 190, Infinity, late.combat),
    ).toBeNull();
  });

  it("round-1 retest idx 46: another effect id of the cast on the same unit does not continue the chain (Kingsbane 385627 / 394095)", () => {
    const caster = makeUnit("c1", {
      name: "Caster",
      auraEvents: [
        {
          ...makeAuraEvent(
            LogEvent.SPELL_AURA_APPLIED,
            "385627",
            T0 + 131_000,
            "c1",
            "c1",
            "BUFF",
          ),
          srcUnitName: "Caster",
        },
        {
          ...makeAuraEvent(
            LogEvent.SPELL_AURA_APPLIED,
            "394095",
            T0 + 142_000,
            "c1",
            "c1",
            "BUFF",
          ),
          srcUnitName: "Caster",
        },
        {
          ...makeAuraEvent(
            LogEvent.SPELL_AURA_REMOVED,
            "385627",
            T0 + 145_000,
            "c1",
            "c1",
            "BUFF",
          ),
          srcUnitName: "Caster",
        },
        {
          ...makeAuraEvent(
            LogEvent.SPELL_AURA_REMOVED,
            "394095",
            T0 + 149_700,
            "c1",
            "c1",
            "BUFF",
          ),
          srcUnitName: "Caster",
        },
      ],
    } as never);
    const combat = {
      startTime: T0,
      endTime: T0 + 200_000,
      units: { c1: caster },
    } as never;
    expect(
      observedEffectEndSeconds(caster, "385627", 131, Infinity, combat),
    ).toBe(145);
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

  // fact10 D11 / D27 (11890839 1:34): a press whose triggered auras include
  // a root — Predator's Wake 1246167's root 370970 logged 1 ms before its
  // damage aura 1246168 — reads its span from the non-root aura, whatever
  // order the log wrote them in
  describe("a triggered root is no chain head (fact10 D11 / D27)", () => {
    const CAST = "1246167";
    const ROOT = "370970";
    const DOT = "1246168";
    const run = (rootFirst: boolean) => {
      const caster = makeUnit("c1", { name: "Caster" } as never);
      const row = (ev: LogEvent, id: string, s: number) => ({
        ...makeAuraEvent(ev, id, T0 + s * 1000, "c1", "t1", "DEBUFF"),
        srcUnitName: "Caster",
      });
      const applies = rootFirst
        ? [
            row(LogEvent.SPELL_AURA_APPLIED, ROOT, 94.5),
            row(LogEvent.SPELL_AURA_APPLIED, DOT, 94.501),
          ]
        : [
            row(LogEvent.SPELL_AURA_APPLIED, DOT, 94.5),
            row(LogEvent.SPELL_AURA_APPLIED, ROOT, 94.501),
          ];
      const target = makeUnit("t1", {
        name: "Target",
        auraEvents: [
          ...applies,
          row(LogEvent.SPELL_AURA_REMOVED, ROOT, 96.5),
          row(LogEvent.SPELL_AURA_REMOVED, DOT, 101.5),
        ],
      } as never);
      const combat = {
        startTime: T0,
        endTime: T0 + 200_000,
        units: { c1: caster, t1: target },
      } as never;
      return observedEffectEndSeconds(caster, CAST, 94.4, Infinity, combat);
    };
    it("root logged first: the damage aura's end", () => {
      expect(run(true)).toBeCloseTo(101.5, 3);
    });
    it("damage aura logged first: the same end", () => {
      expect(run(false)).toBeCloseTo(101.5, 3);
    });
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

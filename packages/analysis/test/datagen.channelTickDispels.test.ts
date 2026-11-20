/**
 * Pipeline T215: `CHANNEL_TICK_DISPEL_IDS` is generated
 * (genChannelTickDispels → data/channelTickDispelsGenerated.ts). Pinned
 * here: the rule (aura 23 whose trigger dispels, both ends observed), and
 * that the generated table still holds the edge the readers' measurements
 * were made on — a datagen run that changes it has to be read.
 */
import { describe, expect, it } from "vitest";

import { channelTickDispelEdges } from "../scripts/datagen/genChannelTickDispels";
import { CHANNEL_TICK_DISPEL_IDS } from "../src/data/channelTickDispelsGenerated";
import observed from "../src/data/observedSpellIdsGenerated.json";
import { spellEffectData } from "../src/data/spellEffectData";

const row = (
  SpellID: string,
  Effect: string,
  EffectAura: string,
  EffectTriggerSpell: string,
) => ({ SpellID, Effect, EffectAura, EffectTriggerSpell });

describe("channelTickDispelEdges(SpellEffect 周期触发光环 → 触发的驱散 id)", () => {
  const obs = new Set(["10", "11", "20", "21", "30", "31", "40", "41"]);

  it("只收光环 23 且触发技能带驱散 / 偷取效果(38 / 126)的行", () => {
    expect(
      channelTickDispelEdges(
        [
          row("10", "6", "23", "11"),
          row("11", "126", "0", "0"), // a steal
          row("20", "6", "23", "21"),
          row("21", "38", "0", "0"), // a dispel
          row("30", "6", "23", "31"),
          row("31", "2", "0", "0"), // periodic damage, not a dispel
          row("40", "64", "0", "41"), // an instant trigger of a dispel
          row("41", "38", "0", "0"),
        ],
        obs,
      ),
    ).toEqual([
      ["10", ["11"]],
      ["20", ["21"]],
    ]);
  });

  it("两端都必须在观测集里", () => {
    expect(
      channelTickDispelEdges(
        [
          row("10", "6", "23", "999"),
          row("999", "38", "0", "0"),
          row("998", "6", "23", "11"),
          row("11", "38", "0", "0"),
        ],
        obs,
      ),
    ).toEqual([]);
  });
});

describe("channelTickDispelsGenerated(生成表)", () => {
  it("12.1.5.70391 上只有 Kleptomania → Spellsteal 一条边(变了要人读)", () => {
    expect([...CHANNEL_TICK_DISPEL_IDS]).toEqual([["198100", ["1231112"]]]);
  });

  it("每条边的两端都在观测集里,按键有官方时长", () => {
    const obs = new Set((observed as number[]).map(String));
    for (const [press, ticks] of CHANNEL_TICK_DISPEL_IDS) {
      expect(obs.has(press)).toBe(true);
      expect(spellEffectData[press]?.durationSeconds).toBeGreaterThan(0);
      for (const id of ticks) expect(obs.has(id)).toBe(true);
    }
  });
});

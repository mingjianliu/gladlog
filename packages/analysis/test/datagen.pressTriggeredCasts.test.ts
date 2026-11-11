/**
 * GH #167.21: `PRESS_TRIGGERED_CAST_IDS` is generated (genPressTriggeredCasts
 * → data/pressTriggeredCastsGenerated.ts), no longer a hand copy of the DB2
 * query. Pinned here: the rule (charge effects with a trigger, both ends
 * observed), and that the generated table still holds the edges the readers'
 * measurements were made on — a datagen run that changes it has to be read.
 */
import { describe, expect, it } from "vitest";

import { pressTriggeredEdges } from "../scripts/datagen/genPressTriggeredCasts";
import observed from "../src/data/observedSpellIdsGenerated.json";
import { PRESS_TRIGGERED_CAST_IDS } from "../src/data/pressTriggeredCastsGenerated";
import { PRESS_TRIGGERED_CAST_IDS as viaReader } from "../src/utils/castMissRows";

const row = (SpellID: string, Effect: string, EffectTriggerSpell: string) => ({
  SpellID,
  Effect,
  EffectTriggerSpell,
});

describe("pressTriggeredEdges(SpellEffect 冲锋效果 → 触发的命中 id)", () => {
  const obs = new Set(["10", "11", "12", "20", "21", "30", "31"]);

  it("只收冲锋效果(96 / 149)且带触发技能的行", () => {
    expect(
      pressTriggeredEdges(
        [
          row("10", "96", "11"),
          row("20", "149", "21"),
          row("30", "64", "31"), // a proc trigger, not a charge
          row("30", "6", "31"), // an aura
          row("12", "96", "0"), // a charge with no impact spell
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
      pressTriggeredEdges(
        [row("10", "96", "999"), row("998", "96", "11"), row("20", "96", "21")],
        obs,
      ),
    ).toEqual([["20", ["21"]]]);
  });

  it("同一按键的多条边合并去重,键与值都按数值升序", () => {
    expect(
      pressTriggeredEdges(
        [
          row("20", "96", "21"),
          row("10", "96", "12"),
          row("10", "149", "11"),
          row("10", "96", "12"),
        ],
        obs,
      ),
    ).toEqual([
      ["10", ["11", "12"]],
      ["20", ["21"]],
    ]);
  });
});

describe("pressTriggeredCastsGenerated(生成表)", () => {
  it("与 2026-10-29 手抄表逐项相同(5 条边;变了要人读)", () => {
    expect([...PRESS_TRIGGERED_CAST_IDS]).toEqual([
      ["370965", ["370966"]],
      ["432113", ["432120"]],
      ["1244088", ["1244091"]],
      ["1246167", ["1246169"]],
      ["1259431", ["1246169"]],
    ]);
  });

  it("读者拿到的就是生成表本身(castMissRows 只转出,不另存一份)", () => {
    expect(viaReader).toBe(PRESS_TRIGGERED_CAST_IDS);
  });

  it("每条边的两端都在观测集里", () => {
    const obs = new Set((observed as number[]).map(String));
    for (const [press, impacts] of PRESS_TRIGGERED_CAST_IDS) {
      expect(obs.has(press)).toBe(true);
      for (const id of impacts) expect(obs.has(id)).toBe(true);
    }
  });
});

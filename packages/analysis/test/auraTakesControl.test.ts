/**
 * T177: `auraTakesControl` asks the aura's own DB2 effects (MOD_CONFUSE /
 * MOD_CHARM / MOD_FEAR / MOD_STUN), not the spell's mechanic label — an
 * aura that takes no control carries the label too. T225: the control aura
 * types also hold MOD_POSSESS, MOD_PACIFY_SILENCE, AOE_CHARM and type 298.
 */
import { describe, expect, it } from "vitest";

import { ccSpellIds } from "../src/data/spellTags";
import {
  auraTakesControl,
  ccMechanicOf,
  STUNNED_MECHANIC,
} from "../src/utils/spellMechanics";

describe("auraTakesControl", () => {
  it("同一个技能名下,只有真正控制的光环回答 true", () => {
    // Binding Shot: the tether and the stun both carry mechanic 12
    expect(ccMechanicOf("117405")).toBe(STUNNED_MECHANIC);
    expect(ccMechanicOf("117526")).toBe(STUNNED_MECHANIC);
    expect(auraTakesControl("117405")).toBe(false);
    expect(auraTakesControl("117526")).toBe(true);
    // Snowdrift: the per-pulse periodic aura and the stun
    expect(ccMechanicOf("390171")).toBe(STUNNED_MECHANIC);
    expect(auraTakesControl("390171")).toBe(false);
    expect(auraTakesControl("389831")).toBe(true);
  });

  it("恐惧、魅惑、迷惑类光环也回答 true", () => {
    expect(auraTakesControl("358861")).toBe(true); // Cascading Horrors, fear aura
    expect(auraTakesControl("8122")).toBe(true); // Psychic Scream
    expect(auraTakesControl("118")).toBe(true); // Polymorph, confuse aura
  });

  it("T225:妖术(沉默兼缴械光环)、精神控制(附身光环)、窒息(298 类光环)也回答 true", () => {
    for (const hex of [
      "51514",
      "210873",
      "211004",
      "211015",
      "269352",
      "277778",
      "277784",
      "309328",
    ])
      expect(auraTakesControl(hex), hex).toBe(true);
    expect(auraTakesControl("605")).toBe(true); // Mind Control
    expect(auraTakesControl("221562")).toBe(true); // Asphyxiate (Blood)
  });

  it("T225:沉默、定身、缴械不是夺取控制的光环", () => {
    expect(auraTakesControl("15487")).toBe(false); // Silence
    expect(auraTakesControl("47476")).toBe(false); // Strangulate
    expect(auraTakesControl("339")).toBe(false); // Entangling Roots
    expect(auraTakesControl("207777")).toBe(false); // Dismantle
  });

  it("T225:控制集里每个有光环效果的 id,光环自身都回答 true(除了已知的非控制光环类型)", () => {
    // the forward check behind the type list: an id of the product's control
    // set that the table knows and that answers false carries no aura row of
    // its own (a cast id whose control runs under another id) — or it is a
    // new control aura type the list lacks
    const CAST_IDS_WITH_NO_AURA_ROW = new Set([
      "5782", // Fear
      "22570", // Maim
      "46968", // Shockwave
      "88625", // Holy Word: Chastise
      "107570", // Storm Bolt
      "192058", // Capacitor Totem
      "347008", // Axe Toss
    ]);
    const unexplained = [...ccSpellIds].filter(
      (id) =>
        auraTakesControl(id) === false && !CAST_IDS_WITH_NO_AURA_ROW.has(id),
    );
    expect(unexplained).toEqual([]);
  });

  it("表里没有的技能回答 undefined,不当成 false", () => {
    expect(auraTakesControl("999999999")).toBeUndefined();
  });

  it("带标签但光环不控制的两个 id 不在控制集里", () => {
    expect(ccSpellIds.has("117405")).toBe(false);
    expect(ccSpellIds.has("390171")).toBe(false);
  });
});

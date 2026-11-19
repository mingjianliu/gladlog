/**
 * T177: `auraTakesControl` asks the aura's own DB2 effects (MOD_CONFUSE /
 * MOD_CHARM / MOD_FEAR / MOD_STUN), not the spell's mechanic label — an
 * aura that takes no control carries the label too.
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

  it("表里没有的技能回答 undefined,不当成 false", () => {
    expect(auraTakesControl("999999999")).toBeUndefined();
  });

  it("带标签但光环不控制的两个 id 不在控制集里", () => {
    expect(ccSpellIds.has("117405")).toBe(false);
    expect(ccSpellIds.has("390171")).toBe(false);
  });
});

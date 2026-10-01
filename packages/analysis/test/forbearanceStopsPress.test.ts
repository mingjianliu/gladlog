import { CombatUnitClass, CombatUnitSpec } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { forbearanceStopsPress } from "../src/utils/cooldowns";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

/**
 * Review of cd-hoarded F-W6 (2026-10-03): Forbearance sits on the unit that
 * RECEIVES the button — the holder for Divine Shield, the target for Lay on
 * Hands / Blessing of Protection — so "can this save still be pressed" asks
 * the recipient, for cd-hoarded's ready set and the kill sequence alike.
 */

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const DIVINE_SHIELD = "642";
const LAY_ON_HANDS = "633";

const paladin = (casts: Array<[string, number, string]>) =>
  makeUnit("P", {
    class: CombatUnitClass.Paladin,
    spec: CombatUnitSpec.Paladin_Holy,
    spellCastEvents: casts.map(([id, s, dest]) =>
      makeSpellCastEvent(id, T0 + s * 1000, dest, `${dest}-R`, "P"),
    ) as never,
  });
const mate = makeUnit("M");

describe("forbearanceStopsPress", () => {
  it("a self Lay on Hands puts Forbearance on the paladin: Divine Shield is stopped, Lay on Hands for a fresh teammate is not", () => {
    const p = paladin([[LAY_ON_HANDS, 10, "P"]]);
    const all = [p, mate];
    expect(forbearanceStopsPress(p, DIVINE_SHIELD, p, all, 20, T0)).toBe(true);
    // the Divine Shield question is about the holder whoever is in crisis
    expect(forbearanceStopsPress(p, DIVINE_SHIELD, mate, all, 20, T0)).toBe(
      true,
    );
    expect(forbearanceStopsPress(p, LAY_ON_HANDS, mate, all, 20, T0)).toBe(
      false,
    );
    // …but not for the paladin, who carries Forbearance
    expect(forbearanceStopsPress(p, LAY_ON_HANDS, p, all, 20, T0)).toBe(true);
  });

  it("a Divine Shield cast stops a Lay on Hands on the paladin, not on a teammate", () => {
    const p = paladin([[DIVINE_SHIELD, 10, "nil"]]);
    const all = [p, mate];
    expect(forbearanceStopsPress(p, LAY_ON_HANDS, mate, all, 25, T0)).toBe(
      false,
    );
    expect(forbearanceStopsPress(p, LAY_ON_HANDS, p, all, 25, T0)).toBe(true);
  });

  it("nothing pressed, or a button Forbearance does not gate → never stopped", () => {
    const p = paladin([]);
    expect(forbearanceStopsPress(p, DIVINE_SHIELD, p, [p], 20, T0)).toBe(false);
    expect(forbearanceStopsPress(p, "498", p, [p], 20, T0)).toBe(false);
  });
});

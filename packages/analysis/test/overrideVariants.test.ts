/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * F20 D23 (fact6, 2026-10-28) — a DB2 override variant (aura 332 onto a
 * spell that draws on the same cooldown) is a PRESS of that cooldown:
 * Predator's Wake 1259431 is the The Hunt 1246167 button under Demonsurge
 * (Category 2427, both 90 s). 1263fff6 pressed it at 2:26 and 2:33 and the
 * timeline had neither.
 */
import { CombatUnitClass, CombatUnitSpec } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { OVERRIDE_VARIANTS_GENERATED } from "../src/data/overrideVariantsGenerated";
import {
  canonicalSpellId,
  castSpellName,
  extractMajorCooldowns,
  spellAliasIds,
} from "../src/utils/cooldowns";
import {
  isEnemyCdWindowSpell,
  reconstructEnemyCDTimeline,
} from "../src/utils/enemyCDs";
import { GAP_CLOSER_BUTTONS } from "../src/utils/gapClosers";
import {
  isOffensiveSpell,
  offensiveEffectCdId,
} from "../src/utils/spellDanger";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

const START = 1_000_000;

describe("override variants — one button, one cooldown", () => {
  it("Predator's Wake is The Hunt's press: canonical id, offensive effect, window spell", () => {
    expect(OVERRIDE_VARIANTS_GENERATED["1259431"]).toBe("1246167");
    expect(canonicalSpellId("1259431")).toBe("1246167");
    expect(spellAliasIds("1246167")).toContain("1259431");
    expect(offensiveEffectCdId("1259431")).toBe("1246167");
    expect(isOffensiveSpell("1259431")).toBe(true);
    expect(isEnemyCdWindowSpell("1259431")).toBe(true);
    expect(
      GAP_CLOSER_BUTTONS.some(
        (b) => b.includes("1246167") && b.includes("1259431"),
      ),
    ).toBe(true);
  });

  it("Orbital Strike's Celestial Alignment / Incarnation are the same buttons", () => {
    expect(offensiveEffectCdId("383410")).toBe("194223");
    expect(offensiveEffectCdId("390414")).toBe("102560");
  });

  it("the hand rows keep their direction (Bladestorm 227847 → 446035), and a stage / cancel of the spell's own aura is no variant (Time Stop 383332)", () => {
    expect(canonicalSpellId("227847")).toBe("446035");
    expect(canonicalSpellId("446035")).toBe("446035");
    expect(OVERRIDE_VARIANTS_GENERATED["383332"]).toBeUndefined();
    expect(canonicalSpellId("383332")).toBe("383332");
  });

  it("the enemy timeline keeps the log's own name and prices the press on The Hunt's cooldown", () => {
    const dh = makeUnit("e1", {
      name: "Dh",
      spec: CombatUnitSpec.DemonHunter_Devourer,
      spellCastEvents: [
        makeSpellCastEvent("1259431", START + 146_000, "p1", "Mate", "e1"),
      ],
    });
    const tl = reconstructEnemyCDTimeline([dh], {
      startTime: START,
      endTime: START + 200_000,
    } as any);
    const [cd] = tl.players[0]!.offensiveCDs;
    expect(cd!.spellId).toBe("1259431");
    expect(cd!.spellName).toBe("Predator's Wake");
    expect(cd!.cooldownSeconds).toBe(90);
    expect(cd!.availableAgainAtSeconds).not.toBeNull();
  });
});

/**
 * F20 D23 residual (605 cap-int, 2026-10-28): a friendly Devourer who
 * pressed ONLY Predator's Wake in a round had no The Hunt row — the
 * press-only offensive path admits a member on its own cast id, and The Hunt
 * is on no class roster — so 4 presses in 2 rounds (a70ff89c r2 0:28 / 1:30
 * owner, 8c70dc85 r1 teammate) had no [YOU] / [TEAM] [CD] line.
 */
describe("override variants — the friendly ledger", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });
  const dh = (casts: Array<[string, number]>) =>
    makeUnit("player-1", {
      class: CombatUnitClass.DemonHunter,
      spec: CombatUnitSpec.DemonHunter_Devourer,
      info: { talents: [], pvpTalents: [] } as any,
      spellCastEvents: casts.map(([id, s]) =>
        makeSpellCastEvent(id, START + s * 1000, "player-1"),
      ),
    });
  const ledger = (u: any) =>
    extractMajorCooldowns(u, {
      startTime: START,
      endTime: START + 200_000,
      units: { [u.id]: u },
    } as any);

  // user 2026-10-28: a variant sharing a cooldown counts with its base
  // spell under its own name — the key is The Hunt's, the name what was
  // pressed
  it("only the variant pressed → one row keyed on The Hunt, named Predator's Wake", () => {
    const rows = ledger(
      dh([
        ["1259431", 28],
        ["1259431", 90],
      ]),
    ).filter((c) => canonicalSpellId(c.spellId) === "1246167");
    expect(rows.map((r) => [r.spellId, r.spellName])).toEqual([
      ["1246167", "Predator's Wake"],
    ]);
    expect(rows[0]!.casts.map((c) => Math.round(c.timeSeconds))).toEqual([
      28, 90,
    ]);
    expect(rows[0]!.casts.map((c) => castSpellName(rows[0]!, c))).toEqual([
      "Predator's Wake",
      "Predator's Wake",
    ]);
  });

  it("both ids pressed → still one row (unchanged)", () => {
    const rows = ledger(
      dh([
        ["1246167", 10],
        ["1259431", 100],
      ]),
    ).filter((c) => canonicalSpellId(c.spellId) === "1246167");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.spellName).toBe("The Hunt");
    expect(rows[0]!.casts.map((c) => Math.round(c.timeSeconds))).toEqual([
      10, 100,
    ]);
    // each press line names its own press
    expect(rows[0]!.casts.map((c) => castSpellName(rows[0]!, c))).toEqual([
      "The Hunt",
      "Predator's Wake",
    ]);
  });

  // GH #167: the id each press logged, for the reader that pairs the press
  // with its own aura (`[BUFF FADED]`)
  it("each press carries the variant id it logged", () => {
    const both = ledger(
      dh([
        ["1246167", 10],
        ["1259431", 100],
      ]),
    ).find((c) => canonicalSpellId(c.spellId) === "1246167")!;
    expect(both.casts.map((c) => c.pressedId)).toEqual([undefined, "1259431"]);
    const only = ledger(dh([["1259431", 28]])).find(
      (c) => canonicalSpellId(c.spellId) === "1246167",
    )!;
    expect(only.casts.map((c) => c.pressedId)).toEqual(["1259431"]);
  });
});

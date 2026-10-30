/**
 * B-tier D10 B15a step 2 (user ruling 2026-10-06, wording approved
 * 2026-10-07): a self-save that puts a heal absorb on its caster (Death Pact)
 * says on its press line what the absorb ate, and a death under it quotes
 * that. Everything is read off the log — the aura row's `amount`, the
 * SPELL_HEAL_ABSORBED rows — and nothing is estimated when a row is missing.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import observed from "../src/data/observedSpellIdsGenerated.json";
import {
  HEAL_ABSORB_SELF_SAVE_IDS,
  healAbsorbDeathLine,
  healAbsorbPressClause,
  healAbsorbUseOf,
  healerCreditOf,
  UNATTRIBUTED_HEALER,
} from "../src/utils/healAbsorbSave";

const DEATH_PACT = "48743";
const at = (s: number) => 1_000_000 + s * 1000;
const fmt = (ms: number) => {
  const s = Math.floor((ms - at(0)) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const label = (id: string) => (id === "h" ? "3(DPriest)" : id);

const aura = (event: LogEvent, s: number, amount?: number): any => ({
  spellId: DEATH_PACT,
  destUnitId: "o",
  timestamp: at(s),
  logLine: { event, timestamp: at(s) },
  ...(amount === undefined ? {} : { amount }),
});
const eat = (s: number, healerId: string, absorbedAmount: number): any => ({
  absorbSpellId: DEATH_PACT,
  timestamp: at(s),
  healerId,
  absorbedAmount,
});
const heal = (
  s: number,
  spellId: string,
  amount: number,
  effectiveAmount = amount,
): any => ({ spellId, timestamp: at(s), amount, effectiveAmount });

function dk(over: {
  auras?: any[];
  eaten?: any[];
  heals?: any[];
  deathS?: number;
}): any {
  return {
    id: "o",
    auraEvents: over.auras ?? [],
    healAbsorbsIn: over.eaten ?? [],
    healIn: over.heals ?? [],
    deathRecords:
      over.deathS === undefined ? [] : [{ timestamp: at(over.deathS) }],
  };
}

describe("HEAL_ABSORB_SELF_SAVE_IDS", () => {
  it("every id is one the corpus casts (a dead id never fires)", () => {
    const seen = new Set(
      (observed as unknown as Array<string | number>).map(String),
    );
    for (const id of HEAL_ABSORB_SELF_SAVE_IDS) expect(seen.has(id)).toBe(true);
  });
});

describe("healAbsorbUseOf / healAbsorbPressClause", () => {
  it("a death under the absorb: what it ate, from whom, no healing landed, the rest unspent (82a2d681 round 5, 2:45)", () => {
    const unit = dk({
      auras: [aura(LogEvent.SPELL_AURA_APPLIED, 165, 283_511)],
      eaten: [
        eat(166, "h", 100_000),
        eat(168, "h", 53_400),
        eat(169, "o", 46_200),
      ],
      heals: [heal(165, DEATH_PACT, 215_000)],
      deathS: 173.5,
    });
    const use = healAbsorbUseOf(unit, DEATH_PACT, at(165), at(300))!;
    expect(use).toMatchObject({
      ownHeal: 215_000,
      absorbAmount: 283_511,
      eaten: 199_600,
      heals: 3,
      ended: "death",
      endMs: at(173.5),
      healingLanded: 0,
      unspentAmount: 83_911,
    });
    expect(use.byHealer).toEqual([
      { healerId: "h", amount: 153_400 },
      { healerId: "o", amount: 46_200 },
    ]);
    expect(healAbsorbPressClause(use, "o", label, fmt)).toBe(
      " | healed 215k · heal absorb 284k: ate 200k of healing (3 heals — 3(DPriest) 153k、own 46k) through 2:53 · no healing landed after the press · 84k of it unspent at death",
    );
    expect(healAbsorbDeathLine(use, "Death Pact", "o", () => "1", fmt)).toBe(
      "Heal absorb: own Death Pact (pressed 2:45) ate 200k of the healing aimed at 1 before the death — 1 153k、own 46k; healing that landed after 2:45: 0",
    );
  });

  it("a summon's eaten healing counts for its owner; a source the roster cannot name is `unattributed` — no summon name, no GUID (605 capture: s0/149-6, s0/134-1)", () => {
    const unit = dk({
      auras: [aura(LogEvent.SPELL_AURA_APPLIED, 165, 300_000)],
      eaten: [
        eat(166, "h", 100_000),
        // two totems of the healer's with one name, a Treant of the DK's
        // teammate "d", a creature the roster does not hold, the nil source
        eat(166.5, "Creature-0-1-2-3-TOTEM-A", 17_000),
        eat(167, "Creature-0-1-2-3-TOTEM-B", 17_000),
        eat(167.5, "Creature-0-1-2-3-TREANT", 30_000),
        eat(168, "Creature-0-1631-980-41115-60849-0000093BE5", 6_000),
        eat(168.5, "0000000000000000", 2_000),
        eat(169, "o", 46_000),
      ],
      heals: [heal(165, DEATH_PACT, 215_000)],
      deathS: 173.5,
    });
    const creditTo = healerCreditOf(
      [
        { id: "o", name: "Dk-Realm" },
        { id: "h", name: "Priest-Realm" },
        { id: "d", name: "Druid-Realm" },
      ],
      new Map([
        ["Creature-0-1-2-3-TOTEM-A", "Priest-Realm"],
        ["Creature-0-1-2-3-TOTEM-B", "Priest-Realm"],
        ["Creature-0-1-2-3-TREANT", "Druid-Realm"],
        // an owner the roster does not hold names nobody
        ["Creature-0-1631-980-41115-60849-0000093BE5", "Stranger-Realm"],
      ]),
    );
    const use = healAbsorbUseOf(unit, DEATH_PACT, at(165), at(300), creditTo)!;
    expect(use.byHealer).toEqual([
      { healerId: "h", amount: 134_000 },
      { healerId: "o", amount: 46_000 },
      { healerId: "d", amount: 30_000 },
      { healerId: UNATTRIBUTED_HEALER, amount: 8_000 },
    ]);
    expect(use.eaten).toBe(218_000);
    expect(use.heals).toBe(7);
    const who = (id: string) =>
      id === "h" ? "3(DPriest)" : id === "d" ? "2(RDruid)" : id;
    const clause = healAbsorbPressClause(use, "o", who, fmt);
    expect(clause).toContain(
      "(7 heals — 3(DPriest) 134k、own 46k、2(RDruid) 30k、unattributed 8k)",
    );
    expect(clause).not.toMatch(/Creature-|0000000000000000/);
    // a share that rounds to 0k is left out of the list, never the largest
    const tiny = healAbsorbUseOf(
      dk({
        auras: [aura(LogEvent.SPELL_AURA_APPLIED, 165, 300_000)],
        eaten: [eat(166, "h", 258_000), eat(167, "o", 300)],
      }),
      DEATH_PACT,
      at(165),
      at(300),
    )!;
    expect(healAbsorbPressClause(tiny, "o", who, fmt)).toContain(
      "(2 heals — 3(DPriest) 258k)",
    );
    const onlyTiny = healAbsorbUseOf(
      dk({
        auras: [aura(LogEvent.SPELL_AURA_APPLIED, 165, 300_000)],
        eaten: [eat(166, "o", 300)],
      }),
      DEATH_PACT,
      at(165),
      at(300),
    )!;
    expect(healAbsorbPressClause(onlyTiny, "o", who, fmt)).toContain(
      "(1 heal — own 0k)",
    );
    // without the fold every healer id stands for itself (the raw reading)
    expect(
      healAbsorbUseOf(unit, DEATH_PACT, at(165), at(300))!.byHealer,
    ).toHaveLength(7);
  });

  it("healing that got through before the death is counted, and the line does not say none landed", () => {
    const unit = dk({
      auras: [aura(LogEvent.SPELL_AURA_APPLIED, 10, 200_000)],
      eaten: [eat(11, "h", 50_000)],
      heals: [
        heal(10, DEATH_PACT, 100_000),
        // an overheal-clipped heal: only what reached the unit counts
        heal(12, "2061", 90_000, 30_000),
      ],
      deathS: 14,
    });
    const use = healAbsorbUseOf(unit, DEATH_PACT, at(10), at(300))!;
    expect(use.healingLanded).toBe(30_000);
    const clause = healAbsorbPressClause(use, "o", label, fmt);
    expect(clause).not.toContain("no healing landed");
    expect(clause).toContain("through 0:14 · 150k of it unspent at death");
    expect(healAbsorbDeathLine(use, "Death Pact", "o", label, fmt)).toContain(
      "healing that landed after 0:10: 30k",
    );
  });

  it("the absorb ran out: `used up at` the removal (1:02 in the same round)", () => {
    const unit = dk({
      auras: [
        aura(LogEvent.SPELL_AURA_APPLIED, 62, 283_511),
        aura(LogEvent.SPELL_AURA_REMOVED, 67.2),
      ],
      eaten: [eat(63, "h", 279_511), eat(66, "o", 4_000)],
      heals: [heal(62, DEATH_PACT, 425_000)],
      // a death long after the aura is gone is not a death under it
      deathS: 173,
    });
    const use = healAbsorbUseOf(unit, DEATH_PACT, at(62), at(300))!;
    expect(use.ended).toBe("used-up");
    expect(healAbsorbPressClause(use, "o", label, fmt)).toBe(
      " | healed 425k · heal absorb 284k: ate 284k of healing (2 heals — 3(DPriest) 280k、own 4k) · used up at 1:07",
    );
  });

  it("removed with some left (it timed out): says how much was unspent", () => {
    const unit = dk({
      auras: [
        aura(LogEvent.SPELL_AURA_APPLIED, 20, 100_000),
        aura(LogEvent.SPELL_AURA_REMOVED, 35),
      ],
      eaten: [eat(22, "h", 40_000)],
    });
    const use = healAbsorbUseOf(unit, DEATH_PACT, at(20), at(300))!;
    expect(use.ended).toBe("removed");
    expect(healAbsorbPressClause(use, "o", label, fmt)).toBe(
      " | healed 0k · heal absorb 100k: ate 40k of healing (1 heal — 3(DPriest) 40k) · ended at 0:35 with 60k unspent",
    );
  });

  it("still up when the round ends, having eaten nothing", () => {
    const unit = dk({
      auras: [aura(LogEvent.SPELL_AURA_APPLIED, 20, 100_000)],
    });
    const use = healAbsorbUseOf(unit, DEATH_PACT, at(20), at(25))!;
    expect(use.ended).toBe("round-end");
    expect(healAbsorbPressClause(use, "o", label, fmt)).toBe(
      " | healed 0k · heal absorb 100k: ate no healing through the end of the round · 100k of it unspent",
    );
  });

  it("eaten healing of ANOTHER heal absorb, or after the aura ended, is not this press's", () => {
    const unit = dk({
      auras: [
        aura(LogEvent.SPELL_AURA_APPLIED, 20, 100_000),
        aura(LogEvent.SPELL_AURA_REMOVED, 30),
      ],
      eaten: [
        eat(22, "h", 10_000),
        { ...eat(23, "h", 70_000), absorbSpellId: "1" },
        eat(31, "h", 5_000),
      ],
    });
    expect(healAbsorbUseOf(unit, DEATH_PACT, at(20), at(300))!.eaten).toBe(
      10_000,
    );
  });

  it("nothing is estimated: not a listed id, no aura row at the press, or an aura row without an amount → null", () => {
    const withAura = dk({
      auras: [aura(LogEvent.SPELL_AURA_APPLIED, 20, 100_000)],
    });
    expect(healAbsorbUseOf(withAura, "48792", at(20), at(300))).toBeNull();
    expect(healAbsorbUseOf(withAura, DEATH_PACT, at(40), at(300))).toBeNull();
    expect(
      healAbsorbUseOf(
        dk({ auras: [aura(LogEvent.SPELL_AURA_APPLIED, 20)] }),
        DEATH_PACT,
        at(20),
        at(300),
      ),
    ).toBeNull();
  });
});

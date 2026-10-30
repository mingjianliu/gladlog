/**
 * fact6 F20 (pets) — the three text gates over summon facts:
 *  - `checkOwnKickNotContradictedByInterrupt` (D3, 4caab013 2:41);
 *  - `checkPetCommandMissPrintedOnce` (D30, bbd5e632 0:37 + 0:38);
 *  - `checkKillCreditNotOwnSide` (D22, 114a4df7-r0 1:02).
 * Each case pairs the old rendered shape (fails) with the fixed one (passes).
 */
import { describe, expect, it } from "vitest";

import {
  checkKillCreditNotOwnSide,
  checkOwnKickNotContradictedByInterrupt,
  checkPetCommandMissPrintedOnce,
} from "../src/quality/promptQualityCheck";

const roster = [
  '  <unit id="1" name="Galadrion-DunModr-EU" spec="Retribution Paladin" role="log owner">',
  '  <unit id="2" name="Teammate-DunModr-EU" spec="Destruction Warlock" role="teammate">',
  '  <unit id="5" name="Enemy-DunModr-EU" spec="Affliction Warlock" role="enemy">',
  '  <unit id="6" name="Other-DunModr-EU" spec="Holy Druid" role="enemy">',
];

describe("checkOwnKickNotContradictedByInterrupt (fact6 D3)", () => {
  const interrupt =
    "2:41  [KICK]   1(RPaladin) interrupted 5(AWarlock)'s pet's Seduction (Rebuke)";

  it("the old shape fails: `hit nothing` beside the owner's own interrupt line, timeline and Kicks: line", () => {
    const failures = checkOwnKickNotContradictedByInterrupt([
      ...roster,
      "  Kicks: 2:41 Rebuke → hit nothing | 2:59 Rebuke → interrupted Unstable Affliction",
      "2:41  [KICK]   your Rebuke on 5(AWarlock)'s pet — hit nothing",
      interrupt,
    ]);
    expect(failures).toHaveLength(2);
    expect(failures[0]).toContain("Rebuke");
  });

  it("a JUKED verdict beside the owner's interrupt fails too", () => {
    expect(
      checkOwnKickNotContradictedByInterrupt([
        ...roster,
        "2:41  [KICK]   your Rebuke on 5(AWarlock)'s pet — JUKED by fake Seduction",
        interrupt,
      ]),
    ).toHaveLength(1);
  });

  it("the fixed shape passes: the kick reads as landed", () => {
    expect(
      checkOwnKickNotContradictedByInterrupt([
        ...roster,
        "  Kicks: 2:41 Rebuke → interrupted Seduction | 2:59 Rebuke → interrupted Unstable Affliction",
        interrupt,
      ]),
    ).toEqual([]);
  });

  it("another kicker's interrupt, another second or another kick is no contradiction", () => {
    expect(
      checkOwnKickNotContradictedByInterrupt([
        ...roster,
        "2:41  [KICK]   your Rebuke on 5(AWarlock)'s pet — hit nothing",
        "2:41  [KICK]   2(DWarlock)'s pet interrupted 5(AWarlock)'s pet's Seduction (Spell Lock)",
        "2:42  [KICK]   1(RPaladin) interrupted 6(HDruid)'s Regrowth (Rebuke)",
      ]),
    ).toEqual([]);
  });
});

describe("checkPetCommandMissPrintedOnce (fact6 D30)", () => {
  const press =
    "0:37  [CC NOT LANDED]   5(HDHunter) ← Seduction (by 2(DWarlock)) — logged IMMUNE (1(FDruid)'s Cyclone was on the target)";
  const pet =
    "0:38  [CC NOT LANDED]   5(HDHunter) ← Seduction (by 2(DWarlock)'s pet) — logged IMMUNE (1(FDruid)'s Cyclone was on the target)";

  it("the old shape fails: the press and the pet's cast each print a line", () => {
    const failures = checkPetCommandMissPrintedOnce([press, pet]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("line 2");
  });

  it("the fixed shape passes: one line, the pet's", () => {
    expect(checkPetCommandMissPrintedOnce([pet])).toEqual([]);
    // a command with no pet row prints once, as the pet's
    expect(
      checkPetCommandMissPrintedOnce([
        "1:38  [CC NOT LANDED]   6(SPriest) ← Axe Toss (by 1(DWarlock)'s pet) — logged IMMUNE (3(RDruid)'s Cyclone was on the target)",
      ]),
    ).toEqual([]);
  });

  it("an IMMUNE kick printed for the press and for the pet fails", () => {
    expect(
      checkPetCommandMissPrintedOnce([
        "1:10  [KICK]   5(AWarlock)'s Spell Lock on 1(RPaladin) missed — IMMUNE (Divine Shield)",
        "1:10  [KICK]   5(AWarlock)'s pet's Spell Lock on 1(RPaladin) missed — IMMUNE (Divine Shield)",
      ]),
    ).toHaveLength(1);
  });

  it("another target, another type, another owner or a gap past 3 s passes", () => {
    expect(
      checkPetCommandMissPrintedOnce([
        press,
        "0:38  [CC NOT LANDED]   6(HDruid) ← Seduction (by 2(DWarlock)'s pet) — logged IMMUNE",
        "0:38  [CC NOT LANDED]   5(HDHunter) ← Seduction (by 3(DWarlock)'s pet) — logged IMMUNE",
        "0:38  [CC NOT LANDED]   5(HDHunter) ← Seduction (by 2(DWarlock)'s pet) — logged MISS",
        "0:41  [CC NOT LANDED]   5(HDHunter) ← Seduction (by 2(DWarlock)'s pet) — logged IMMUNE",
      ]),
    ).toEqual([]);
  });
});

describe("checkKillCreditNotOwnSide (fact6 D22)", () => {
  it("the old shape fails: a pet killed by its own warlock's Soul Link", () => {
    expect(
      checkKillCreditNotOwnSide([
        ...roster,
        "1:02  [UNIT DESTROYED]   5(AWarlock)'s Sayaad (Enemy) killed by: 5(AWarlock) — Soul Link [Nature/Arcane]",
      ]),
    ).toHaveLength(1);
    expect(
      checkKillCreditNotOwnSide([
        ...roster,
        "3:02  [KILL]                 6(HDruid) (Holy Druid) dead (killing blow: 5(AWarlock) — Soul Link [Shadow]; most damage in final 5s: 1(RPaladin) — Melee [Physical] (65k))",
      ]),
    ).toHaveLength(1);
  });

  it("the fixed shape passes: the attacker's blow", () => {
    expect(
      checkKillCreditNotOwnSide([
        ...roster,
        "1:02  [UNIT DESTROYED]   5(AWarlock)'s Sayaad (Enemy) killed by: 2(DWarlock) — Shadowburn [Shadow]",
        "0:51  [UNIT DESTROYED]   Psyfiend (Enemy) killed by: 1(RPaladin) — Judgment [Holy], 3.6 s after it was summoned",
        "3:02  [KILL]                 6(HDruid) (Holy Druid) dead (killing blow: 1(RPaladin) — Templar's Verdict [Holy]; most damage in final 5s: 1(RPaladin) — Melee [Physical] (65k))",
      ]),
    ).toEqual([]);
  });

  it("the top-sources form and a mind-controlled credit are not read", () => {
    expect(
      checkKillCreditNotOwnSide([
        ...roster,
        "1:02  [UNIT DESTROYED]   5(AWarlock)'s Sayaad (Enemy) killed by: 5(AWarlock) — Soul Link [Nature] (40k), 1(RPaladin) — Melee [Physical] (30k)",
        "5:15  [UNIT DESTROYED]   Tremor Totem (Enemy) killed by: 6(HDruid) (mind-controlled) — Wrath [Nature], 2.3 s after it was summoned",
      ]),
    ).toEqual([]);
  });

  it("a player's own self-damage tick as its killing blow is not read (Cauterize, Refraction)", () => {
    expect(
      checkKillCreditNotOwnSide([
        ...roster,
        "1:26  [KILL]                 5(AWarlock) (Affliction Warlock) dead (killing blow: 5(AWarlock) — Cauterize [Fire]; most damage in final 5s: 1(RPaladin) — Melee [Physical] (65k))",
      ]),
    ).toEqual([]);
  });
});

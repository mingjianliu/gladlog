/**
 * FT R03 — `checkEnemyCcKitLanded`: the `ENEMY CC KIT` line's `(landed N×)`
 * entries and the `[CC ON TEAM]` lines on the kit's unit are one list, both
 * ways. The prompt below is f4647408 round 5 as the product renders it
 * (roster, kit line, the round's `[CC ON TEAM]` lines), then mutated.
 */
import { describe, expect, it } from "vitest";

import { checkEnemyCcKitLanded } from "../src/quality/promptQualityCheck";

const ROSTER = [
  '  <unit id="1" name="Thoughtfull-ShadowCouncil-US" spec="Elemental Shaman" role="log owner">',
  '  <unit id="2" name="Babyoil-Dragonmaw-US" spec="Destruction Warlock" role="teammate">',
  '  <unit id="3" name="Àsk-Khaz\'goroth-US" spec="Restoration Druid" role="teammate">',
  '  <unit id="4" name="Mikehuntzz-Tichondrius-US" spec="Beast Mastery Hunter" role="enemy">',
  '  <unit id="5" name="Bibisho-Stormrage-US" spec="Arms Warrior" role="enemy">',
  '  <unit id="6" name="Pozzi-EmeraldDream-US" spec="Holy Priest" role="enemy">',
];
const KIT =
  "ENEMY CC KIT (threats to your healer 3(RDruid) at enemy burst windows, plus every control that landed on them this round, marked `landed N×`): Arms Warrior (Bibisho-Stormrage-US): Storm Bolt [Stun], Intimidating Shout [Disorient] (landed 1×), Shockwave [Stun] (landed 1×); Beast Mastery Hunter (Mikehuntzz-Tichondrius-US): Freezing Trap [Incapacitate] (landed 2×); Holy Priest (Pozzi-EmeraldDream-US): Holy Word: Chastise [Stun] (landed 2×), Psychic Scream [Disorient] (landed 1×)";
const TIMELINE = [
  "0:18  [CC ON TEAM]   2(DWarlock) ← Intimidation (by 4(BMHunter)'s pet) | 3s [DR: Stun Full]",
  "0:29  [CC ON TEAM]   2(DWarlock) ← Intimidating Shout (by 5(AWarrior)) | 1s [DR: Disorient Full] | 4.1yd from caster",
  "0:29  [CC ON TEAM]   3(RDruid) ← Intimidating Shout (by 5(AWarrior)) | 6s [DR: Disorient Full] | 10yd from caster | broken by 5(AWarrior)'s Mortal Strike",
  "0:33  [CC ON TEAM]   3(RDruid) ← Shockwave (by 5(AWarrior)) | 2s [DR: Stun Full] | 4.4yd from caster",
  "0:35  [CC ON TEAM]   3(RDruid) ← Freezing Trap (by 4(BMHunter)) | 1s [DR: Incapacitate Full] | 25.1yd from caster | broken by 5(AWarrior)'s Overpower",
  "0:38  [CC ON TEAM]   3(RDruid) ← Holy Word: Chastise (by 6(HPriest)) | 2s [DR: Stun 50%] | 32.9yd from caster",
  "0:41  [CC ON TEAM]   1(EShaman) ← Storm Bolt (by 5(AWarrior)) | 3s [DR: Stun Full] | 12.5yd from caster",
  "1:14  [CC ON TEAM]   3(RDruid) ← Freezing Trap (by 4(BMHunter)) | 6s [DR: Incapacitate Full] | 12.7yd from caster",
  "1:26  [CC ON TEAM]   3(RDruid) ← Holy Word: Chastise (by 6(HPriest)) [DR: Stun Full] | 26yd from caster | trinket broke this CC after 1s (cut short — it had not expired)",
  "1:54  [CC ON TEAM]   3(RDruid) ← Psychic Scream (by 6(HPriest)) | still on them when the round ended, 6s in [DR: Disorient Full] | 9.7yd from caster",
  // a legend line that names the tag is no data line
  "  `| pressed during it: X ×N` on a [CC ON TEAM] / [SILENCE] line of yours = you pressed X",
];
const prompt = (kit = KIT, timeline = TIMELINE) => [
  ...ROSTER,
  "",
  kit,
  "",
  ...timeline,
];

describe("checkEnemyCcKitLanded (FT R03)", () => {
  it("the generated prompt passes", () => {
    expect(checkEnemyCcKitLanded(prompt())).toEqual([]);
  });

  it("a prompt with no kit line has nothing to check", () => {
    expect(checkEnemyCcKitLanded([...ROSTER, ...TIMELINE])).toEqual([]);
  });

  it("mutation: the old line — the burst-window list alone — fails", () => {
    const out = checkEnemyCcKitLanded(
      prompt(
        "ENEMY CC KIT (threats to your healer 3(RDruid) at enemy burst windows): Arms Warrior (Bibisho-Stormrage-US): Storm Bolt [Stun], Intimidating Shout [Disorient]",
      ),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("landed N×");
  });

  it("mutation: a control that landed on the unit and is not on the line fails", () => {
    const out = checkEnemyCcKitLanded(
      prompt(KIT.replace(", Psychic Scream [Disorient] (landed 1×)", "")),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("Psychic Scream");
    expect(out[0]).toContain("landed 0×");
  });

  it("mutation: a wrong count fails, in either direction", () => {
    expect(
      checkEnemyCcKitLanded(
        prompt(
          KIT.replace(
            "Freezing Trap [Incapacitate] (landed 2×)",
            "Freezing Trap [Incapacitate] (landed 1×)",
          ),
        ),
      ),
    ).toHaveLength(1);
    expect(
      checkEnemyCcKitLanded(
        prompt(
          KIT.replace(
            "Shockwave [Stun] (landed 1×)",
            "Shockwave [Stun] (landed 3×)",
          ),
        ),
      ),
    ).toHaveLength(1);
  });

  it("mutation: a `landed` mark with no [CC ON TEAM] line on that unit fails — it landed on a teammate only", () => {
    const out = checkEnemyCcKitLanded(
      prompt(
        KIT.replace("Storm Bolt [Stun],", "Storm Bolt [Stun] (landed 1×),"),
      ),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("Storm Bolt");
  });

  it("mutation: the control credited to the wrong enemy fails for both", () => {
    const out = checkEnemyCcKitLanded(
      prompt(
        KIT.replace(", Shockwave [Stun] (landed 1×)", "").replace(
          "Freezing Trap [Incapacitate] (landed 2×)",
          "Freezing Trap [Incapacitate] (landed 2×), Shockwave [Stun] (landed 1×)",
        ),
      ),
    );
    expect(out).toHaveLength(2);
  });

  it("a summon's control counts under its owner", () => {
    const withPet = [
      ...TIMELINE,
      "1:58  [CC ON TEAM]   3(RDruid) ← Intimidation (by 4(BMHunter)'s pet) | 3s [DR: Stun Full]",
    ];
    expect(checkEnemyCcKitLanded(prompt(KIT, withPet))).toHaveLength(1);
    expect(
      checkEnemyCcKitLanded(
        prompt(
          KIT.replace(
            "Freezing Trap [Incapacitate] (landed 2×)",
            "Freezing Trap [Incapacitate] (landed 2×), Intimidation [Stun] (landed 1×)",
          ),
          withPet,
        ),
      ),
    ).toEqual([]);
  });

  it("a control reflected back names no enemy and is not asked of the line", () => {
    expect(
      checkEnemyCcKitLanded(
        prompt(KIT, [
          ...TIMELINE,
          "1:40  [CC ON TEAM]   3(RDruid) ← Cyclone (reflected back) | 4s [DR: Disorient Full]",
        ]),
      ),
    ).toEqual([]);
  });

  it("the owner form reads the log owner's lines", () => {
    const ownerKit =
      "ENEMY CC KIT (threats to you, plus every control that landed on you this round, marked `landed N×`): Arms Warrior (Bibisho-Stormrage-US): Storm Bolt [Stun] (landed 1×), Intimidating Shout [Disorient]";
    expect(checkEnemyCcKitLanded(prompt(ownerKit))).toEqual([]);
    expect(
      checkEnemyCcKitLanded(prompt(ownerKit.replace(" (landed 1×)", ""))),
    ).toHaveLength(1);
  });

  it("mutation: a spec default marked not seen beside the same control landed fails; an enemy the roster does not list fails", () => {
    expect(
      checkEnemyCcKitLanded(
        prompt(
          KIT.replace(
            "Psychic Scream [Disorient] (landed 1×)",
            "Psychic Scream [Disorient] (landed 1×), Psychic Scream [Disorient] (spec default, not seen)",
          ),
        ),
      ),
    ).toHaveLength(1);
    expect(
      checkEnemyCcKitLanded(
        prompt(KIT.replace("Pozzi-EmeraldDream-US", "Nobody-Nowhere-US")),
      ).length,
    ).toBeGreaterThan(0);
  });
});

/**
 * FT R03 (user ruling 2026-10-11, option b — it reopens A17's "labels
 * only") — the `ENEMY CC KIT` line is the burst-window threats ∪ every
 * control that landed on the kit's unit this round, each landed one marked
 * `(landed N×)`.
 *
 * The shape below is f4647408 round 5 (healer 3(RDruid)): the line read
 * `Arms Warrior (…): Storm Bolt [Stun], Intimidating Shout [Disorient]` while
 * seven controls landed on the healer, six of them not on it — the Hunter
 * and the Priest were on no burst-window list at all.
 */
import { CombatUnitReaction, CombatUnitSpec } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import observed from "../src/data/observedSpellIdsGenerated.json";
import { rendersCcOnTeamLine } from "../src/utils/ccTrinketAnalysis";
import {
  formatEnemyCCKitHeader,
  landedControlsForKit,
  parseEnemyCcKitLine,
} from "../src/utils/healerExposureAnalysis";
import { makeUnit } from "./ported/testHelpers";

const warrior = makeUnit("e-war", {
  name: "Bibisho-Stormrage-US",
  reaction: CombatUnitReaction.Hostile,
  spec: CombatUnitSpec.Warrior_Arms,
});
const hunter = makeUnit("e-hunt", {
  name: "Mikehuntzz-Tichondrius-US",
  reaction: CombatUnitReaction.Hostile,
  spec: CombatUnitSpec.Hunter_BeastMastery,
});
const priest = makeUnit("e-priest", {
  name: "Pozzi-EmeraldDream-US",
  reaction: CombatUnitReaction.Hostile,
  spec: CombatUnitSpec.Priest_Holy,
});
const pet = makeUnit("pet-1", {
  name: "Cat",
  reaction: CombatUnitReaction.Hostile,
  ownerId: "e-hunt",
});
const enemies = [hunter, priest, warrior];
const allUnits = [...enemies, pet];

const cc = (
  atSeconds: number,
  spellId: string,
  spellName: string,
  source: { id: string; name: string },
  durationSeconds = 3,
) => ({
  atSeconds,
  durationSeconds,
  spellId,
  spellName,
  sourceName: source.name,
  sourceId: source.id,
});
const summary = (ccInstances: Array<ReturnType<typeof cc>>) =>
  ({ ccInstances }) as never;

// f4647408 r5, the healer's seven [CC ON TEAM] lines
const landedOnHealer = [
  cc(29, "5246", "Intimidating Shout", warrior, 6),
  cc(33, "132168", "Shockwave", warrior, 2),
  cc(35, "3355", "Freezing Trap", hunter, 1),
  cc(38, "200200", "Holy Word: Chastise", priest, 2),
  cc(74, "3355", "Freezing Trap", hunter, 6),
  cc(86, "200200", "Holy Word: Chastise", priest, 1),
  cc(114, "8122", "Psychic Scream", priest, 6),
];

const threat = (over: object) => ({
  enemyName: warrior.name,
  enemySpec: "Arms Warrior",
  ccCategory: "Stun",
  ccSpellName: "Storm Bolt",
  healerDRLevel: "Full" as const,
  losBlocked: false,
  ...over,
});
const exposures = [
  {
    atSeconds: 33,
    threats: [
      threat({}),
      threat({ ccCategory: "Disorient", ccSpellName: "Intimidating Shout" }),
    ],
  },
] as never;

describe("landedControlsForKit — the [CC ON TEAM] instances, per enemy and control", () => {
  it("every id used here is alive in the corpus", () => {
    const seen = new Set((observed as number[]).map(String));
    for (const id of [
      "5246",
      "132168",
      "3355",
      "200200",
      "8122",
      "24394",
      "196364",
      "22703",
    ])
      expect(seen.has(id), id).toBe(true);
  });

  it("counts one per instance, in order of first landing, with the DR family of the landed aura", () => {
    expect(
      landedControlsForKit(summary(landedOnHealer), enemies, allUnits),
    ).toEqual([
      {
        enemyName: warrior.name,
        enemySpec: "Arms Warrior",
        spellName: "Intimidating Shout",
        category: "Disorient",
        count: 1,
      },
      {
        enemyName: warrior.name,
        enemySpec: "Arms Warrior",
        spellName: "Shockwave",
        category: "Stun",
        count: 1,
      },
      {
        enemyName: hunter.name,
        enemySpec: "Beast Mastery Hunter",
        spellName: "Freezing Trap",
        category: "Incapacitate",
        count: 2,
      },
      {
        enemyName: priest.name,
        enemySpec: "Holy Priest",
        spellName: "Holy Word: Chastise",
        category: "Stun",
        count: 2,
      },
      {
        enemyName: priest.name,
        enemySpec: "Holy Priest",
        spellName: "Psychic Scream",
        category: "Disorient",
        count: 1,
      },
    ]);
  });

  it("a pet's control is its owner's (ruling pets R1 = A)", () => {
    const out = landedControlsForKit(
      summary([cc(18, "24394", "Intimidation", pet)]),
      enemies,
      allUnits,
    );
    expect(out).toEqual([
      {
        enemyName: hunter.name,
        enemySpec: "Beast Mastery Hunter",
        spellName: "Intimidation",
        category: "Stun",
        count: 1,
      },
    ]);
  });

  it("a control no DR family claims is listed without one", () => {
    const [ua] = landedControlsForKit(
      summary([cc(16, "22703", "Infernal Awakening", priest)]),
      enemies,
      allUnits,
    );
    expect(ua).toEqual({
      enemyName: priest.name,
      enemySpec: "Holy Priest",
      spellName: "Infernal Awakening",
      count: 1,
    });
  });

  it("fact3 D37: a dispel-backlash silence is a [SILENCE] line, not a landed control", () => {
    expect(
      landedControlsForKit(
        summary([cc(16, "196364", "Unstable Affliction", priest)]),
        enemies,
        allUnits,
      ),
    ).toEqual([]);
  });

  it("shares the emitter's test: an instance that prints no line is not counted", () => {
    const zero = cc(40, "8122", "Psychic Scream", priest, 0);
    expect(rendersCcOnTeamLine(zero)).toBe(false);
    expect(landedControlsForKit(summary([zero]), enemies, allUnits)).toEqual(
      [],
    );
  });

  it("a source that is no enemy player or enemy summon is on no list — the unit's own control reflected back, an unplaced unit", () => {
    expect(
      landedControlsForKit(
        summary([
          cc(10, "33786", "Cyclone", { id: "me", name: "Me" }),
          cc(12, "24394", "Intimidation", { id: "pet-9", name: "Stray" }),
        ]),
        enemies,
        allUnits,
      ),
    ).toEqual([]);
  });
});

describe("formatEnemyCCKitHeader — burst-window threats ∪ what landed", () => {
  const landed = landedControlsForKit(
    summary(landedOnHealer),
    enemies,
    allUnits,
  );

  it("f4647408 r5: a threat that landed gets its count, a control and an enemy the windows never listed are appended", () => {
    expect(formatEnemyCCKitHeader(exposures, "3(RDruid)", landed)).toEqual([
      "ENEMY CC KIT (threats to your healer 3(RDruid) at enemy burst windows, plus every control that landed on them this round, marked `landed N×`): Arms Warrior (Bibisho-Stormrage-US): Storm Bolt [Stun], Intimidating Shout [Disorient] (landed 1×), Shockwave [Stun] (landed 1×); Beast Mastery Hunter (Mikehuntzz-Tichondrius-US): Freezing Trap [Incapacitate] (landed 2×); Holy Priest (Pozzi-EmeraldDream-US): Holy Word: Chastise [Stun] (landed 2×), Psychic Scream [Disorient] (landed 1×)",
    ]);
  });

  it("a healer owner reads `you`", () => {
    expect(formatEnemyCCKitHeader(exposures, undefined, landed)[0]).toMatch(
      /^ENEMY CC KIT \(threats to you, plus every control that landed on you this round, marked `landed N×`\): Arms Warrior /,
    );
  });

  it("a spec default never seen landing keeps its mark beside a landed control of the same enemy", () => {
    const withDefault = [
      {
        atSeconds: 30,
        threats: [
          threat({
            enemyName: priest.name,
            enemySpec: "Holy Priest",
            ccCategory: "Disorient",
            ccSpellName: "Psychic Scream",
            fromTemplate: true,
          }),
        ],
      },
    ] as never;
    expect(
      formatEnemyCCKitHeader(
        withDefault,
        "3(RDruid)",
        landedControlsForKit(
          summary([cc(16, "22703", "Infernal Awakening", priest)]),
          enemies,
          allUnits,
        ),
      )[0],
    ).toContain(
      "): Holy Priest (Pozzi-EmeraldDream-US): Psychic Scream [Disorient] (spec default, not seen), Infernal Awakening (landed 1×)",
    );
  });

  it("nothing landed: the header still promises the landed controls and no entry is marked", () => {
    expect(formatEnemyCCKitHeader(exposures, "3(RDruid)", [])).toEqual([
      "ENEMY CC KIT (threats to your healer 3(RDruid) at enemy burst windows, plus every control that landed on them this round, marked `landed N×`): Arms Warrior (Bibisho-Stormrage-US): Storm Bolt [Stun], Intimidating Shout [Disorient]",
    ]);
  });

  it("whether the line prints is the burst windows' alone: no threat, no line — also when controls landed", () => {
    expect(formatEnemyCCKitHeader([], "3(RDruid)", landed)).toEqual([]);
  });

  it("without the landed controls the line and its header are the burst-window list alone", () => {
    expect(formatEnemyCCKitHeader(exposures, "3(RDruid)")).toEqual([
      "ENEMY CC KIT (threats to your healer 3(RDruid) at enemy burst windows): Arms Warrior (Bibisho-Stormrage-US): Storm Bolt [Stun], Intimidating Shout [Disorient]",
    ]);
  });
});

describe("parseEnemyCcKitLine — the gate's reader", () => {
  const landed = landedControlsForKit(
    summary(landedOnHealer),
    enemies,
    allUnits,
  );

  it("reads the generated line back", () => {
    const kit = parseEnemyCcKitLine(
      formatEnemyCCKitHeader(exposures, "3(RDruid)", landed)[0]!,
    )!;
    expect(kit.healerLabel).toBe("3(RDruid)");
    expect(kit.statesLanded).toBe(true);
    expect(kit.enemies.map((e) => [e.spec, e.name])).toEqual([
      ["Arms Warrior", warrior.name],
      ["Beast Mastery Hunter", hunter.name],
      ["Holy Priest", priest.name],
    ]);
    expect(kit.enemies[0]!.entries).toEqual([
      {
        spellName: "Storm Bolt",
        category: "Stun",
        landed: 0,
        specDefault: false,
      },
      {
        spellName: "Intimidating Shout",
        category: "Disorient",
        landed: 1,
        specDefault: false,
      },
      {
        spellName: "Shockwave",
        category: "Stun",
        landed: 1,
        specDefault: false,
      },
    ]);
    expect(kit.enemies[2]!.entries[0]).toEqual({
      spellName: "Holy Word: Chastise",
      category: "Stun",
      landed: 2,
      specDefault: false,
    });
  });

  it("reads the owner form, the spec default and an entry with no DR family", () => {
    const kit = parseEnemyCcKitLine(
      "ENEMY CC KIT (threats to you, plus every control that landed on you this round, marked `landed N×`): Holy Priest (Pozzi-EmeraldDream-US): Psychic Scream [Disorient] (spec default, not seen), Unstable Affliction (landed 1×)",
    )!;
    expect(kit.healerLabel).toBeNull();
    expect(kit.enemies[0]!.entries).toEqual([
      {
        spellName: "Psychic Scream",
        category: "Disorient",
        landed: 0,
        specDefault: true,
      },
      { spellName: "Unstable Affliction", landed: 1, specDefault: false },
    ]);
  });

  it("the burst-window-only line reads back as not stating the landed controls", () => {
    expect(
      parseEnemyCcKitLine(formatEnemyCCKitHeader(exposures, "3(RDruid)")[0]!)!
        .statesLanded,
    ).toBe(false);
  });

  it("a line off the generated format is not read", () => {
    const ok = formatEnemyCCKitHeader(exposures, "3(RDruid)", landed)[0]!;
    expect(
      parseEnemyCcKitLine(
        ok.replace("on them this round", "on you this round"),
      ),
    ).toBeNull();
    expect(
      parseEnemyCcKitLine(
        ok.replace("ENEMY CC KIT (threats", "ENEMY CC KIT (dangers"),
      ),
    ).toBeNull();
    expect(
      parseEnemyCcKitLine(
        ok.replace("Arms Warrior (Bibisho-Stormrage-US): ", ""),
      ),
    ).toBeNull();
  });
});

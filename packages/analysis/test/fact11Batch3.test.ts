/**
 * fact11 (F26) batch 3 — the held items the user cleared on 2026-11-06.
 * P1 (codex 20-F26-03 #1, B3iii): a healer's own offensive cooldown makes no
 * kill window's team "ready" unless it is Power Infusion.
 * D34: an immunity save pressed with no aura logged has a line.
 * D45: the teammates an immunity's own press covered are named.
 * D42: a press that logs only its aura (Rain from Above) is a press.
 * D38: Essence Break's debuff runs 5 s.
 * D11: a trinket-equivalent racial the target holds ready is named beside
 * PRIME (the reading, `readyTrinketRacialNameAt`).
 */
import {
  type AtomicArenaCombat,
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src";
import { emitEnemyDefEntries } from "../src/context/timelineSections/enemyDef";
import {
  AURA_ONLY_ACTIVATION_IDS,
  NO_CAST_LOG_PRESS_IDS,
} from "../src/data/auraActivation";
import { spellEffectData } from "../src/data/spellEffectData";
import { readyTrinketRacialNameAt } from "../src/utils/ccTrinketAnalysis";
import {
  ENEMY_DEF_END_NOT_LOGGED,
  ENEMY_DEF_END_NOT_LOGGED_SLOT_RE,
  enemyDefAlsoOnClause,
  immunityAlsoOn,
  immunityPressesWithoutAura,
} from "../src/utils/enemyDefensives";
import { createKillWindowFactsComputer } from "../src/utils/killWindowFacts";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_000_000;
const at = (s: number) => T0 + Math.round(s * 1000);
const MASS_INVIS = "414664";

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("P1 — a healer's own offensive cooldown is no team burst (B3iii)", () => {
  const AW = "31884";
  const target = makeUnit("E1");
  const factsWith = (spec: CombatUnitSpec) => {
    const paladin = makeUnit("P1", {
      class: CombatUnitClass.Paladin,
      spec,
      spellCastEvents: [
        makeSpellCastEvent(
          AW,
          at(5),
          "P1",
          "P1",
          "P1",
          "P1",
          0,
          "Avenging Wrath",
        ),
      ],
    });
    return createKillWindowFactsComputer(
      {
        startTime: T0,
        endTime: T0 + 300_000,
        units: { P1: paladin, E1: target },
      } as unknown as AtomicArenaCombat,
      [paladin],
      [target],
    ).facts(target, 200, 210);
  };

  it("a Holy Paladin's ready Avenging Wrath is not in the team's ready list", () => {
    const f = factsWith(CombatUnitSpec.Paladin_Holy);
    expect(f.readyOffCds).not.toContain("Avenging Wrath");
  });

  it("a Holy Paladin's Avenging Wrath pressed inside is still named there", () => {
    const paladin = makeUnit("P1", {
      class: CombatUnitClass.Paladin,
      spec: CombatUnitSpec.Paladin_Holy,
      spellCastEvents: [
        makeSpellCastEvent(
          AW,
          at(205),
          "P1",
          "P1",
          "P1",
          "P1",
          0,
          "Avenging Wrath",
        ),
      ],
    });
    const f = createKillWindowFactsComputer(
      {
        startTime: T0,
        endTime: T0 + 300_000,
        units: { P1: paladin, E1: target },
      } as unknown as AtomicArenaCombat,
      [paladin],
      [target],
    ).facts(target, 200, 210);
    expect(f.pressedInside?.map((p) => p.name)).toContain("Avenging Wrath");
  });

  it("a Retribution Paladin's still is", () => {
    const f = factsWith(CombatUnitSpec.Paladin_Retribution);
    expect(f.readyOffCds).toContain("Avenging Wrath");
  });
});

describe("D34 — an immunity press the log wrote no aura for", () => {
  const press = makeSpellCastEvent(
    MASS_INVIS,
    at(108.575),
    "",
    "",
    "E5",
    "Mage",
    0,
    "Mass Invisibility",
  );

  it("is listed when no aura row of it exists", () => {
    const mage = makeUnit("E5", { name: "Mage", spellCastEvents: [press] });
    expect(
      immunityPressesWithoutAura(mage, [], { startTime: T0 }, at(300)),
    ).toEqual([
      {
        atSeconds: 108.575,
        auraId: MASS_INVIS,
        spellId: MASS_INVIS,
        spellName: "Mass Invisibility",
      },
    ]);
  });

  it("is not, when its aura is on the unit or an event already reads it", () => {
    const withAura = makeUnit("E5", {
      name: "Mage",
      spellCastEvents: [press],
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          MASS_INVIS,
          at(108.58),
          "E5",
          "E5",
          "BUFF",
        ),
      ],
    });
    expect(
      immunityPressesWithoutAura(withAura, [], { startTime: T0 }, at(300)),
    ).toEqual([]);
    const mage = makeUnit("E5", { name: "Mage", spellCastEvents: [press] });
    expect(
      immunityPressesWithoutAura(
        mage,
        [{ spellId: MASS_INVIS, atSeconds: 108.6 }],
        { startTime: T0 },
        at(300),
      ),
    ).toEqual([]);
  });

  it("a school-limited one prints its schools (codex 20-F26-06 #1)", () => {
    const CLOAK = "31224";
    const rogue = makeUnit("E5", {
      name: "Rogue",
      reaction: CombatUnitReaction.Hostile,
      spellCastEvents: [
        makeSpellCastEvent(
          CLOAK,
          at(50),
          "",
          "",
          "E5",
          "Rogue",
          0,
          "Cloak of Shadows",
        ),
      ],
    });
    const lines: string[] = [];
    emitEnemyDefEntries({
      matchStartMs: T0,
      matchEndSeconds: 180,
      enemies: [rogue],
      enemyPid: (n: string) => `E:${n}`,
      friends: [],
      roundBounds: undefined,
      pid: (n: string) => `F:${n}`,
      actorLabel: (n: string) => `E:${n}`,
      addEntry: (_t: number, line: string) => lines.push(line),
      _allUnits: [rogue],
    } as never);
    expect(lines.find((l) => l.includes("Cloak of Shadows"))).toContain(
      "(immune to magic, no aura logged)",
    );
  });

  it("carries [friendly offensive CD active] at its press (fact12 D14)", () => {
    // 60bfdea9 1:12: Mass Invisibility pressed under a warrior's Recklessness
    const linesWith = (reckEndS: number) => {
      const mage = makeUnit("E5", {
        name: "Mage",
        reaction: CombatUnitReaction.Hostile,
        spellCastEvents: [press],
      });
      const warrior = makeUnit("f1", {
        name: "Warrior",
        auraEvents: [
          makeAuraEvent(
            LogEvent.SPELL_AURA_APPLIED,
            "1719",
            at(100),
            "f1",
            "f1",
            "BUFF",
          ),
          makeAuraEvent(
            LogEvent.SPELL_AURA_REMOVED,
            "1719",
            at(reckEndS),
            "f1",
            "f1",
            "BUFF",
          ),
        ],
      });
      const lines: string[] = [];
      emitEnemyDefEntries({
        matchStartMs: T0,
        matchEndSeconds: 180,
        enemies: [mage],
        enemyPid: (n: string) => `E:${n}`,
        friends: [warrior],
        roundBounds: { startTime: T0, endTime: at(180) },
        pid: (n: string) => `F:${n}`,
        actorLabel: (n: string) => `E:${n}`,
        addEntry: (_t: number, line: string) => lines.push(line),
        _allUnits: [mage, warrior],
      } as never);
      return lines.find((l) => l.includes("Mass Invisibility")) ?? "";
    };
    // up at the press millisecond, gone 0.1 s before it inside the same second
    expect(linesWith(112)).toContain(
      "(immune, no aura logged) [friendly offensive CD active]",
    );
    expect(linesWith(108.475)).not.toContain("[friendly offensive CD active]");
  });

  it("is not after the round's end", () => {
    const mage = makeUnit("E5", { name: "Mage", spellCastEvents: [press] });
    expect(
      immunityPressesWithoutAura(mage, [], { startTime: T0 }, at(100)),
    ).toEqual([]);
  });
});

describe("D45 — the teammates one immunity press covered", () => {
  const applied = (dest: string, s: number, src = "E5") =>
    makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED,
      MASS_INVIS,
      at(s),
      src,
      dest,
      "BUFF",
    );

  it("names the allies whose copy went up with the caster's", () => {
    const mage = makeUnit("E5", {
      name: "Mage",
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [applied("E5", 35.456)],
    });
    const monk = makeUnit("E4", {
      name: "Brew",
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [applied("E4", 35.456)],
    });
    const warrior = makeUnit("E6", {
      name: "Wing",
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [applied("E6", 35.457)],
    });
    // another unit's copy, and a copy well after the press, are not it
    const late = makeUnit("E7", {
      name: "Late",
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [applied("E7", 36.5)],
    });
    const other = makeUnit("E8", {
      name: "Other",
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [applied("E8", 35.456, "E9")],
    });
    expect(
      immunityAlsoOn(
        mage,
        MASS_INVIS,
        35.456,
        [mage, monk, warrior, late, other],
        { startTime: T0 },
      ).map((u) => u.name),
    ).toEqual(["Brew", "Wing"]);
  });

  it("the slot readers parse the clause the producer writes", () => {
    const line = `0:18  [ENEMY DEF]   5(FMage) (Fire Mage): Mass Invisibility (immune, ${ENEMY_DEF_END_NOT_LOGGED}${enemyDefAlsoOnClause(["4(HPriest)", "6(SRogue)"])}) (at 99% HP)`;
    expect(ENEMY_DEF_END_NOT_LOGGED_SLOT_RE.test(line)).toBe(true);
    expect(enemyDefAlsoOnClause([])).toBe("");
  });

  it("reads nothing for an aura that is no immunity", () => {
    const mage = makeUnit("E5", { name: "Mage" });
    expect(immunityAlsoOn(mage, "1022x", 1, [mage], { startTime: T0 })).toEqual(
      [],
    );
  });
});

describe("D42 / D38 — the data rows", () => {
  it("Rain from Above's aura is its press (DB2 NO_CAST_LOG)", () => {
    expect(AURA_ONLY_ACTIVATION_IDS["206803"]).toEqual(["206803"]);
  });

  it("only a no-cast-log button's aura is printed as a press (codex 20-F26-06 #2)", () => {
    expect([...NO_CAST_LOG_PRESS_IDS]).toEqual(["206803"]);
    // a Riptide-proc Ascendance is an aura-only activation, never a press
    expect(AURA_ONLY_ACTIVATION_IDS["114052"]).toBeDefined();
    expect(NO_CAST_LOG_PRESS_IDS.has("114052")).toBe(false);
  });

  it("Essence Break's debuff keeps DB2's 4 s; the 5th second is the Havoc 4pc (GH #197)", () => {
    expect(spellEffectData["320338"]?.durationSeconds).toBe(4);
  });
});

describe("D11 — a ready trinket-equivalent racial, by name", () => {
  const WTS = "59752";
  const MEDALLION = "336126";
  const paladin = (casts: Array<[string, number, string]>) =>
    makeUnit("E1", {
      class: CombatUnitClass.Paladin,
      spec: CombatUnitSpec.Paladin_Retribution,
      spellCastEvents: casts.map(([id, s, name]) =>
        makeSpellCastEvent(id, at(s), "E1", "E1", "", "", 0, name),
      ),
    });

  it("is back 180 s after its last press (16bc5861 3:35)", () => {
    const u = paladin([[WTS, 12.484, "Will to Survive"]]);
    expect(readyTrinketRacialNameAt(u, at(215.8))).toBe("Will to Survive");
    expect(readyTrinketRacialNameAt(u, at(150))).toBeUndefined();
  });

  it("is held by a Medallion press's shared lock", () => {
    const u = paladin([
      [WTS, 12.484, "Will to Survive"],
      [MEDALLION, 200, "Gladiator's Medallion"],
    ]);
    expect(readyTrinketRacialNameAt(u, at(215.8))).toBeUndefined();
  });

  it("is nothing for a unit seen pressing no such racial", () => {
    expect(readyTrinketRacialNameAt(paladin([]), at(215.8))).toBeUndefined();
  });
});

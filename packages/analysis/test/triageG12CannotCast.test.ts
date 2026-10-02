/**
 * Triage 2026-09-29, group G12 — inputs of the one cannot-cast predicate
 * (`castBlockingAuraIntervals` / `buildCannotCastIntervals`):
 *  - cc-dr F-BK1: the dispel-backlash auras (196364 Unstable Affliction's
 *    silence, 87204 Vampiric Touch's horror) lock the dispeller;
 *  - cc-dr F-SR1 (ruling A52): a CC / silence the unit's own reflect sent
 *    back to it locks it, and a friendly holder's `[CC ON TEAM]` instance
 *    exists for it;
 *  - kick-eaten F-K8 (ruling A23): Storm Conduit shortens the lockout of an
 *    interrupted Lightning Bolt / Chain Lightning ×0.6.
 */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { kickLockoutSeconds } from "../src/data/spellEffectData";
import {
  buildCannotCastIntervals,
  castBlockingAuraIntervals,
} from "../src/utils/cannotCastIntervals";
import { analyzePlayerCCAndTrinket } from "../src/utils/ccTrinketAnalysis";
import { kickLockoutSecondsFor } from "../src/utils/kickLockout";
import {
  makeAuraEvent,
  makeInterruptEvent,
  makeUnit,
} from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const START = 1_000_000;
const aura = (
  event: LogEvent,
  spellId: string,
  s: number,
  src: string,
  dest: string,
) => ({
  ...makeAuraEvent(event, spellId, START + s * 1000, src, dest),
  spellName: spellId,
});
const enemies = new Set(["enemy-1"]);

describe("cc-dr F-BK1 — a dispel backlash locks the dispeller", () => {
  it.each([
    ["196364", "Unstable Affliction silence"],
    ["87204", "Sin and Punishment horror"],
  ])("%s (%s) from the enemy is an interval; from a friend it is not", (id) => {
    const enemySourced = makeUnit("player-1", {
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, id, 254.142, "enemy-1", "player-1"),
        aura(LogEvent.SPELL_AURA_REMOVED, id, 258.153, "enemy-1", "player-1"),
      ],
    });
    expect(buildCannotCastIntervals(enemySourced, enemies)).toEqual([
      { from: START + 254_142, to: START + 258_153 },
    ]);
    const friendSourced = makeUnit("player-1", {
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, id, 254.142, "friend-1", "player-1"),
        aura(LogEvent.SPELL_AURA_REMOVED, id, 258.153, "friend-1", "player-1"),
      ],
    });
    expect(buildCannotCastIntervals(friendSourced, enemies)).toEqual([]);
  });
});

describe("cc-dr F-SR1 — a CC sent back onto its caster locks the caster", () => {
  // Strangulate 47476 reflected back onto the Death Knight (82a2d681 0:57)
  const reflected = (reaction: CombatUnitReaction) =>
    makeUnit("player-1", {
      reaction,
      class: CombatUnitClass.DeathKnight,
      spec: CombatUnitSpec.DeathKnight_Unholy,
      auraEvents: [
        aura(
          LogEvent.SPELL_AURA_APPLIED,
          "47476",
          57.33,
          "player-1",
          "player-1",
        ),
        aura(
          LogEvent.SPELL_AURA_REMOVED,
          "47476",
          60.306,
          "player-1",
          "player-1",
        ),
      ],
    });

  it("the holder's own reflected silence is a cast-blocking interval, named with its source", () => {
    const u = reflected(CombatUnitReaction.Friendly);
    const ivs = castBlockingAuraIntervals(u, enemies);
    expect(ivs).toHaveLength(1);
    expect(ivs[0]).toMatchObject({
      spellId: "47476",
      srcUnitId: "player-1",
      from: START + 57_330,
      to: START + 60_306,
    });
    // an enemy's own reflected silence locks it too (a per-unit fact)
    expect(
      castBlockingAuraIntervals(reflected(CombatUnitReaction.Hostile), enemies),
    ).toHaveLength(1);
  });

  it("a reflected CC is a friendly holder's CC instance, never an enemy holder's", () => {
    // Freezing Trap 3355 reflected back onto the Hunter (1c12961d 0:15)
    const trap = (reaction: CombatUnitReaction) =>
      makeUnit("player-1", {
        reaction,
        auraEvents: [
          aura(LogEvent.SPELL_AURA_APPLIED, "3355", 15, "player-1", "player-1"),
          aura(LogEvent.SPELL_AURA_REMOVED, "3355", 18, "player-1", "player-1"),
        ],
      });
    const combat = {
      startTime: START,
      endTime: START + 300_000,
      startInfo: { zoneId: "1672" },
    };
    const enemy = makeUnit("enemy-1", { reaction: CombatUnitReaction.Hostile });
    const friendly = analyzePlayerCCAndTrinket(
      trap(CombatUnitReaction.Friendly),
      [enemy],
      combat,
    ).ccInstances;
    expect(friendly.map((c) => [c.spellId, c.sourceId])).toEqual([
      ["3355", "player-1"],
    ]);
    const hostile = analyzePlayerCCAndTrinket(
      trap(CombatUnitReaction.Hostile),
      [enemy],
      combat,
    ).ccInstances;
    expect(hostile).toEqual([]);
  });
});

describe("kick-eaten F-K8 — Storm Conduit shortens an interrupted Lightning Bolt's lockout", () => {
  const shaman = (pvpTalents: string[]) =>
    makeUnit("player-1", {
      class: CombatUnitClass.Shaman,
      spec: CombatUnitSpec.Shaman_Restoration,
      info: { pvpTalents, talents: [] } as never,
    });
  const WIND_SHEAR = "57994";
  const base = () => kickLockoutSeconds(WIND_SHEAR);

  it("holder + Lightning Bolt / Chain Lightning → ×0.6 (1b930c17: Wind Shear 2.0 → 1.2 s)", () => {
    const holder = shaman(["0", "290250", "204336", "1217092"]);
    expect(kickLockoutSecondsFor(WIND_SHEAR, holder, "188196")).toBeCloseTo(
      base() * 0.6,
      6,
    );
    expect(kickLockoutSecondsFor(WIND_SHEAR, holder, "188443")).toBeCloseTo(
      base() * 0.6,
      6,
    );
  });

  it("controls: another spell, a victim without the talent, or no victim → the kick's own lockout", () => {
    expect(
      kickLockoutSecondsFor(WIND_SHEAR, shaman(["1217092"]), "77472"),
    ).toBe(base());
    expect(
      kickLockoutSecondsFor(WIND_SHEAR, shaman(["204336"]), "188196"),
    ).toBe(base());
    expect(kickLockoutSecondsFor(WIND_SHEAR, undefined, "188196")).toBe(base());
  });

  it("the cannot-cast lockout interval reads the victim's lockout", () => {
    const holder = makeUnit("player-1", {
      class: CombatUnitClass.Shaman,
      spec: CombatUnitSpec.Shaman_Restoration,
      info: { pvpTalents: ["1217092"], talents: [] } as never,
      actionIn: [
        makeInterruptEvent(
          WIND_SHEAR,
          "Wind Shear",
          "188196",
          "Lightning Bolt",
          START + 154_570,
          "enemy-1",
          "Enemy",
        ),
      ],
    });
    const [iv] = buildCannotCastIntervals(holder, enemies);
    expect((iv!.to - iv!.from) / 1000).toBeCloseTo(base() * 0.6, 6);
  });
});

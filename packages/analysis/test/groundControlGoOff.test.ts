/**
 * corpusFactScan2 immuneCause notUp:inResolveWindow (2026-10-22): a ground
 * control that went off — its first landing from the caster on ANY unit —
 * is not dodged by a move pressed after it. 26-5-159 0:41: Capacitor Totem
 * pulsed 2.0 s after the cast, Shadowmeld 2.53 s; 12 of the 30 held-out
 * credits had this shape.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { getEnglishSpellName } from "../src/data/spellEffectData";
import { analyzePlayerCCAndTrinket } from "../src/utils/ccTrinketAnalysis";
import {
  makeAdvancedAction,
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const MATCH_START = 1_000_000;
const CAST_AT = MATCH_START + 60_000;
const CAPACITOR_TOTEM = "192058";
const STATIC_CHARGE = "118905";
const ROLL = "109132";
const FREEZING_TRAP = "187650";
const FREEZING_TRAP_AURA = "3355";

function avoidedWithRollAt(
  rollAfterMs: number,
  mateYards = 3,
  control: { cast: string; aura: string; spec: CombatUnitSpec } = {
    cast: CAPACITOR_TOTEM,
    aura: STATIC_CHARGE,
    spec: CombatUnitSpec.Shaman_Restoration,
  },
) {
  const enemy = makeUnit("enemy-1", {
    name: "Enemy",
    spec: control.spec,
    reaction: CombatUnitReaction.Hostile,
    spellCastEvents: [
      makeSpellCastEvent(
        control.cast,
        CAST_AT,
        "0000000000000000",
        "nil",
        "enemy-1",
        "Enemy",
        0,
        getEnglishSpellName(control.cast),
      ),
    ],
  });
  // the pulse stuns a teammate 2.0 s after the cast
  // F20 D28: where both stood when it went off on the mate — the credit
  // needs the player inside 2 × radius + 2 yd of a victim
  const at = (x: number) =>
    Array.from({ length: 13 }, (_, i) =>
      makeAdvancedAction(CAST_AT - 1_000 + i * 500, x, 0),
    );
  const mate = makeUnit("player-2", {
    name: "Mate",
    reaction: CombatUnitReaction.Friendly,
    advancedActions: at(mateYards),
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        control.aura,
        CAST_AT + 2_000,
        "enemy-1",
        "player-2",
      ),
    ],
  });
  const player = makeUnit("player-1", {
    name: "Monk",
    spec: CombatUnitSpec.Monk_Windwalker,
    reaction: CombatUnitReaction.Friendly,
    advancedActions: at(0),
    spellCastEvents: [
      makeSpellCastEvent(
        ROLL,
        CAST_AT + rollAfterMs,
        "0000000000000000",
        "nil",
        "player-1",
        "Monk",
      ),
    ],
  });
  const combat = {
    startTime: MATCH_START,
    endTime: MATCH_START + 300_000,
    startInfo: { zoneId: "1672" },
    units: { "enemy-1": enemy, "player-1": player, "player-2": mate },
  };
  return analyzePlayerCCAndTrinket(
    player,
    [enemy],
    combat as never,
  ).ccAvoidedInstances.map((a) => `${a.spellName}/${a.avoidanceSpellName}`);
}

describe("a ground control's go-off bounds the move that dodged it", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });
  it("a Roll before the pulse is credited; one after it is not", () => {
    expect(avoidedWithRollAt(1_500)).toEqual(["Capacitor Totem/Roll"]);
    expect(avoidedWithRollAt(2_400)).toEqual([]);
  });
});

describe("F20 D28 — a ground control that went off on another unit credits only a player it could have caught", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });
  // Capacitor Totem's radius is 8 yd (DB2): within 2 × 8 + 2 = 18 yd of the
  // stunned mate the Roll is credited; farther, nothing was dodged
  // (4caab013 3:14: a Freezing Trap caught the healer 14.5 yd from the
  // paladin whose Divine Steed was credited)
  it("17 yd from the victim: credited; 19 yd: not", () => {
    expect(avoidedWithRollAt(1_500, 17)).toEqual(["Capacitor Totem/Roll"]);
    expect(avoidedWithRollAt(1_500, 19)).toEqual([]);
  });
  // Freezing Trap goes off on its FIRST victim, where that victim stood:
  // its 3 yd radius + 2 yd from the victim is the whole reach (5 yd), not
  // 2 × 3 + 2 = 8 yd (coordinator ruling 2026-10-28)
  it("a single-victim trap: 4.5 yd from the victim credited; 6 yd not", () => {
    const trap = {
      cast: FREEZING_TRAP,
      aura: FREEZING_TRAP_AURA,
      spec: CombatUnitSpec.Hunter_BeastMastery,
    };
    expect(avoidedWithRollAt(1_500, 4.5, trap)).toEqual(["Freezing Trap/Roll"]);
    expect(avoidedWithRollAt(1_500, 6, trap)).toEqual([]);
  });
});

/**
 * F20 D28 residual (605 cap-int, 2026-10-28): a go-off belongs to its press
 * only until the caster presses the control again. A Freezing Trap's 60.5 s
 * landing window reached the NEXT trap's landing: 90c01e7f r3 1:17, the trap
 * caught the priest 47 yd from the paladin, and the 2:15 trap's landing
 * 4.4 yd from him credited his Blessing of Freedom with dodging the first.
 */
describe("F20 D28 residual — a later press's landing is not this press's", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });
  function twoTraps(secondTrap: boolean) {
    const castRow = (ms: number) =>
      makeSpellCastEvent(
        FREEZING_TRAP,
        ms,
        "0000000000000000",
        "nil",
        "enemy-1",
        "Enemy",
        0,
        getEnglishSpellName(FREEZING_TRAP),
      );
    const enemy = makeUnit("enemy-1", {
      name: "Enemy",
      spec: CombatUnitSpec.Hunter_BeastMastery,
      reaction: CombatUnitReaction.Hostile,
      spellCastEvents: [
        castRow(CAST_AT),
        ...(secondTrap ? [castRow(CAST_AT + 30_000)] : []),
      ],
    });
    // the mate is caught 40 yd away by the first trap, and stands 3 yd from
    // the player when the second one catches it
    const samples = Array.from({ length: 81 }, (_, i) => {
      const ms = CAST_AT - 1_000 + i * 500;
      return makeAdvancedAction(ms, ms < CAST_AT + 20_000 ? 40 : 3, 0);
    });
    const mate = makeUnit("player-2", {
      name: "Mate",
      reaction: CombatUnitReaction.Friendly,
      advancedActions: samples,
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          FREEZING_TRAP_AURA,
          CAST_AT + 2_000,
          "enemy-1",
          "player-2",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          FREEZING_TRAP_AURA,
          CAST_AT + 30_200,
          "enemy-1",
          "player-2",
        ),
      ],
    });
    const player = makeUnit("player-1", {
      name: "Monk",
      spec: CombatUnitSpec.Monk_Windwalker,
      reaction: CombatUnitReaction.Friendly,
      advancedActions: samples.map((a) =>
        makeAdvancedAction(a.timestamp, 0, 0),
      ),
      spellCastEvents: [
        makeSpellCastEvent(
          ROLL,
          CAST_AT + 1_500,
          "0000000000000000",
          "nil",
          "player-1",
          "Monk",
        ),
      ],
    });
    const combat = {
      startTime: MATCH_START,
      endTime: MATCH_START + 300_000,
      startInfo: { zoneId: "1672" },
      units: { "enemy-1": enemy, "player-1": player, "player-2": mate },
    };
    return analyzePlayerCCAndTrinket(
      player,
      [enemy],
      combat as never,
    ).ccAvoidedInstances.map(
      (a) => `${a.spellName}/${a.avoidanceSpellName}@${a.castAtSeconds}`,
    );
  }
  it("the first trap's own landing was 40 yd off: no credit, whatever the second trap caught", () => {
    expect(twoTraps(true)).toEqual([]);
  });
});

/**
 * codex 20-F20-15 P2 (2026-10-28): the next-press cut above must not take a
 * pulse away from the press that owns it. Capacitor Totems pressed at 10 s and
 * 12 s pulse at 12 s and 14 s on a mate 40 yd away while the player's
 * Nullifying Shroud runs 11–13 s: the 12 s pulse is the FIRST totem's (the
 * per-cast pulse `controlHitInstant` reads), so that totem went off on the
 * mate, out of the player's reach — nothing was avoided. Cut at the second
 * press, the first totem had no go-off and the Shroud was credited.
 */
describe("codex 20-F20-15 — a pulse belongs to the press that owns it, not to the next press", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });
  const SHROUD = "378464";
  it("totems at 10 s / 12 s, pulses at 12 s / 14 s on a mate 40 yd off, Shroud 11–13 s: no credit", () => {
    const T0 = MATCH_START;
    const cast = (atMs: number) =>
      makeSpellCastEvent(
        CAPACITOR_TOTEM,
        T0 + atMs,
        "0000000000000000",
        "nil",
        "enemy-1",
        "Shaman",
        0,
        getEnglishSpellName(CAPACITOR_TOTEM),
      );
    const enemy = makeUnit("enemy-1", {
      name: "Shaman",
      spec: CombatUnitSpec.Shaman_Enhancement,
      reaction: CombatUnitReaction.Hostile,
      spellCastEvents: [cast(10_000), cast(12_000)],
    });
    const totem = makeUnit("totem-1", { name: "Totem", ownerId: "enemy-1" });
    const at = (x: number) =>
      Array.from({ length: 15 }, (_, i) =>
        makeAdvancedAction(T0 + 9_000 + i * 500, x, 0),
      );
    const selfAura = (event: LogEvent, atMs: number) => ({
      ...makeAuraEvent(event, SHROUD, T0 + atMs, "player-1", "player-1"),
    });
    const player = makeUnit("player-1", {
      name: "Player",
      spec: CombatUnitSpec.Evoker_Preservation,
      reaction: CombatUnitReaction.Friendly,
      advancedActions: at(0),
      auraEvents: [
        selfAura(LogEvent.SPELL_AURA_APPLIED, 11_000),
        selfAura(LogEvent.SPELL_AURA_REMOVED, 13_000),
      ],
    });
    const mate = makeUnit("mate-1", {
      name: "Mate",
      reaction: CombatUnitReaction.Friendly,
      advancedActions: at(40),
      auraEvents: [12_000, 14_000].map((ms) =>
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          STATIC_CHARGE,
          T0 + ms,
          "totem-1",
          "mate-1",
        ),
      ),
    });
    const combat = {
      startTime: T0,
      endTime: T0 + 60_000,
      startInfo: { zoneId: "1672" },
      units: {
        [player.id]: player,
        [enemy.id]: enemy,
        [totem.id]: totem,
        [mate.id]: mate,
      },
    };
    expect(
      analyzePlayerCCAndTrinket(player, [enemy], combat as never, [totem])
        .ccAvoidedInstances,
    ).toEqual([]);
  });
});

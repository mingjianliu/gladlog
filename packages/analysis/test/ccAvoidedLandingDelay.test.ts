/**
 * FT-T16 (user decision D14, 2026-10-10): a control that lands seconds after
 * its cast — Capacitor Totem, Sigil of Misery, Ring of Frost — is paired with
 * its landing inside the spell's own landing window (`AOE_CC_LANDING_WINDOW_S`)
 * and is then no avoidance. 141470d0 printed, for one totem,
 *   6:56  [CC AVOIDED?]   1(PEvoker): Capacitor Totem (by 6(RShaman)) did not land; Nullifying Shroud (own) active
 *   6:58  [CC ON TEAM]   1(PEvoker) ← Capacitor Totem (by 6(RShaman)'s totem) | 1s …
 * (cast 01:01:50.336, stun 01:01:52.351 — 2.015 s, outside the 1.5 s window).
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { getEnglishSpellName } from "../src/data/spellEffectData";
import {
  analyzePlayerCCAndTrinket,
  CC_LANDED_MATCH_WINDOW_MS,
  ccLandedMatchWindowMs,
} from "../src/utils/ccTrinketAnalysis";
import { AOE_CC_LANDING_WINDOW_S } from "../src/utils/drAnalysis";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const MATCH_START = 1_000_000;
const CAST_AT = MATCH_START + 60_000;
const combat = {
  startTime: MATCH_START,
  endTime: MATCH_START + 300_000,
  startInfo: { zoneId: "1672" },
};
const BLADESTORM = "227847"; // an avoidance buff the real lines name
const CAPACITOR_TOTEM = "192058";
const STATIC_CHARGE = "118905";
const SIGIL_OF_MISERY = "207684";
const SIGIL_OF_MISERY_AURA = "207685";
const RING_OF_FROST = "113724";
const RING_OF_FROST_AURA = "82691";
const POLYMORPH = "118";

/** An enemy casts `castId` un-aimed at CAST_AT while the player has Bladestorm
 *  up; `landsAfterMs` = when `auraId` starts on the player (undefined: never). */
function analyze(
  castId: string,
  auraId: string,
  landsAfterMs: number | undefined,
  aimed = false,
) {
  const enemy = makeUnit("enemy-1", {
    name: "Enemy",
    spec: CombatUnitSpec.Shaman_Restoration,
    reaction: CombatUnitReaction.Hostile,
    spellCastEvents: [
      makeSpellCastEvent(
        castId,
        CAST_AT,
        aimed ? "player-1" : "0000000000000000",
        aimed ? "PlayerWarrior" : "nil",
        "enemy-1",
        "Enemy",
        0,
        getEnglishSpellName(castId),
      ),
    ],
  });
  const landing =
    landsAfterMs === undefined
      ? []
      : [
          makeAuraEvent(
            LogEvent.SPELL_AURA_APPLIED,
            auraId,
            CAST_AT + landsAfterMs,
            "enemy-1",
            "player-1",
          ),
          makeAuraEvent(
            LogEvent.SPELL_AURA_REMOVED,
            auraId,
            CAST_AT + landsAfterMs + 3_000,
            "enemy-1",
            "player-1",
          ),
        ];
  const player = makeUnit("player-1", {
    name: "PlayerWarrior",
    spec: CombatUnitSpec.Warrior_Arms,
    reaction: CombatUnitReaction.Friendly,
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        BLADESTORM,
        CAST_AT - 1_000,
        "player-1",
        "player-1",
        "BUFF",
      ),
      ...landing,
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        BLADESTORM,
        CAST_AT + 20_000,
        "player-1",
        "player-1",
        "BUFF",
      ),
    ].sort((a, b) => a.timestamp - b.timestamp),
  });
  const r = analyzePlayerCCAndTrinket(player, [enemy], combat as never);
  return {
    landed: r.ccInstances.map((c) => c.spellName),
    avoided: r.ccAvoidedInstances.map((a) => a.spellName),
  };
}

describe("ccLandedMatchWindowMs — the cast ↔ landing window, one function for the producer and the gate", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("a spell with no landing delay keeps CC_LANDED_MATCH_WINDOW_MS both ways", () => {
    expect(CC_LANDED_MATCH_WINDOW_MS).toBe(1500);
    for (const name of ["Polymorph", "Hammer of Justice", "no such spell"])
      expect(ccLandedMatchWindowMs(name), name).toEqual({
        beforeMs: 1500,
        afterMs: 1500,
      });
  });

  it("a delayed control is matched as far after its cast as the landing table says", () => {
    expect(ccLandedMatchWindowMs("Capacitor Totem")).toEqual({
      beforeMs: 1500,
      afterMs: 4500,
    });
    expect(ccLandedMatchWindowMs("Sigil of Misery")).toEqual({
      beforeMs: 1500,
      afterMs: 3000,
    });
    expect(ccLandedMatchWindowMs("Ring of Frost")).toEqual({
      beforeMs: 1500,
      afterMs: 10500,
    });
  });

  it("reads AOE_CC_LANDING_WINDOW_S — every entry with a window, by the name its cast id prints", () => {
    const entries = Object.entries(AOE_CC_LANDING_WINDOW_S);
    expect(entries.length).toBeGreaterThan(0);
    for (const [castId, landing] of entries) {
      const name = getEnglishSpellName(castId);
      // a name, not the id echoed back: the gate only has the printed name
      expect(name, castId).not.toBe(castId);
      expect(ccLandedMatchWindowMs(name).afterMs, name).toBe(
        landing
          ? Math.max(CC_LANDED_MATCH_WINDOW_MS, landing.toS * 1000)
          : CC_LANDED_MATCH_WINDOW_MS,
      );
    }
  });
});

describe("[CC AVOIDED?] — a delayed control that landed is not an avoidance", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("141470d0 6:56: Capacitor Totem's stun 2.015 s after the cast — landed, no avoidance", () => {
    expect(analyze(CAPACITOR_TOTEM, STATIC_CHARGE, 2_015)).toEqual({
      landed: ["Capacitor Totem"],
      avoided: [],
    });
  });

  it("a totem that stunned nobody is still an avoidance line; so is a stun outside the totem's window", () => {
    expect(analyze(CAPACITOR_TOTEM, STATIC_CHARGE, undefined)).toEqual({
      landed: [],
      avoided: ["Capacitor Totem"],
    });
    // 4.5 s is the table's bound — not "any later stun"
    expect(analyze(CAPACITOR_TOTEM, STATIC_CHARGE, 5_000).avoided).toEqual([
      "Capacitor Totem",
    ]);
  });

  it("74f541c0: Sigil of Misery triggers 2.093 s after the cast — landed; 3.5 s is past its window", () => {
    expect(analyze(SIGIL_OF_MISERY, SIGIL_OF_MISERY_AURA, 2_093)).toEqual({
      landed: ["Sigil of Misery"],
      avoided: [],
    });
    expect(
      analyze(SIGIL_OF_MISERY, SIGIL_OF_MISERY_AURA, 3_500).avoided,
    ).toEqual(["Sigil of Misery"]);
  });

  it("4f36fe3a / 1b7f19cc: Ring of Frost freezes a player who walks in 7.009 s and 9.395 s after the cast — landed; 11 s is past the ring's life", () => {
    for (const afterMs of [7_009, 9_395])
      expect(
        analyze(RING_OF_FROST, RING_OF_FROST_AURA, afterMs),
        `${afterMs}`,
      ).toEqual({ landed: ["Ring of Frost"], avoided: [] });
    expect(analyze(RING_OF_FROST, RING_OF_FROST_AURA, 11_000).avoided).toEqual([
      "Ring of Frost",
    ]);
  });

  it("a control with no landing delay is not given one: Polymorph 2 s after its cast is another cast's", () => {
    expect(analyze(POLYMORPH, POLYMORPH, 1_400, true).avoided).toEqual([]);
    expect(analyze(POLYMORPH, POLYMORPH, 2_000, true).avoided).toEqual([
      "Polymorph",
    ]);
  });
});

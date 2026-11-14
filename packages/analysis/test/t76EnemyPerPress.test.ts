/**
 * T76 (batch review 80-PIPE-64-B62): the enemy timeline prices an effect
 * from its own application, so the presses that extend it while it is up
 * are in its length. A Capacitance holder pressed Avatar at 10 s and Thunder
 * Blast at 14 s and 22 s: the duration predicate, the aura cap and
 * `[BUFF FADED]` end it at 34 s (24 s long), the enemy timeline at 30 s — `[RES]` at 28 s said
 * `2s left` for 6. The same when the aura's REMOVED is past the slice's end.
 */
import {
  CombatUnitClass,
  CombatUnitSpec,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  buffDurationOfApplication,
  buffFullDurationForCaster,
} from "../src/utils/buffDuration";
import {
  enemyEffectOwnEndSeconds,
  reconstructEnemyCDTimeline,
} from "../src/utils/enemyCDs";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_700_000_000_000;
const at = (s: number) => T0 + Math.round(s * 1000);
const AVATAR = "107574";
const THUNDER_BLAST = "435222";
const CAPACITANCE = "1270724";

beforeAll(async () => {
  await ensureAnalysisData();
});

const warrior = (opts: {
  blasts: number[];
  removedS?: number;
  holder?: boolean;
}): ICombatUnit =>
  makeUnit("player-1", {
    name: "War",
    class: CombatUnitClass.Warrior,
    spec: CombatUnitSpec.Warrior_Fury,
    info: { talents: [], pvpTalents: [] } as never,
    spellCastEvents: [
      ...(opts.holder === false
        ? []
        : [makeSpellCastEvent(CAPACITANCE, at(1), "player-1")]),
      makeSpellCastEvent(AVATAR, at(10), "player-1"),
      ...opts.blasts.map((s) =>
        makeSpellCastEvent(THUNDER_BLAST, at(s), "player-1"),
      ),
    ],
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        AVATAR,
        at(10),
        "player-1",
        "player-1",
        "BUFF",
      ),
      ...(opts.removedS === undefined
        ? []
        : [
            makeAuraEvent(
              LogEvent.SPELL_AURA_REMOVED,
              AVATAR,
              at(opts.removedS),
              "player-1",
              "player-1",
              "BUFF",
            ),
          ]),
    ],
  });

const avatarOf = (u: ICombatUnit, endS: number) =>
  reconstructEnemyCDTimeline([u], {
    startTime: T0,
    endTime: at(endS),
    units: { [u.id]: u },
  } as never).players[0]!.offensiveCDs.find((c) => c.spellName === "Avatar")!;

describe("T76 — the enemy timeline prices an effect from its own application", () => {
  it("the entry point is the duration predicate at the application's time", () => {
    const u = warrior({ blasts: [14, 22] });
    expect(buffFullDurationForCaster(AVATAR, u)).toBe(20);
    expect(buffDurationOfApplication(AVATAR, u, at(10))).toBe(24);
    expect(buffDurationOfApplication(AVATAR, u, at(10))).toBe(
      buffFullDurationForCaster(AVATAR, u, at(10)),
    );
  });

  it("Avatar with two Thunder Blasts and no REMOVED ends at 34 s, as the duration predicate reads (80-PIPE-64-B62)", () => {
    const cast = avatarOf(warrior({ blasts: [14, 22] }), 120);
    expect(cast.buffEndSeconds).toBeCloseTo(34, 3);
    // `[RES]` at 28 s: 6 s left of the effect, not 2
    expect(enemyEffectOwnEndSeconds(cast) - 28).toBeCloseTo(6, 3);
  });

  it("the same with the REMOVED past the slice's end: its own end is 34 s", () => {
    const cast = avatarOf(warrior({ blasts: [14, 22], removedS: 34 }), 28);
    expect(enemyEffectOwnEndSeconds(cast)).toBeCloseTo(34, 3);
  });

  it("without the talent, and without a Thunder Blast, it is the 20 s it was", () => {
    expect(
      avatarOf(warrior({ blasts: [14, 22], holder: false }), 120)
        .buffEndSeconds,
    ).toBeCloseTo(30, 3);
    expect(avatarOf(warrior({ blasts: [] }), 120).buffEndSeconds).toBeCloseTo(
      30,
      3,
    );
    expect(
      enemyEffectOwnEndSeconds(
        avatarOf(warrior({ blasts: [], removedS: 31 }), 25),
      ),
    ).toBeCloseTo(30, 3);
  });
});

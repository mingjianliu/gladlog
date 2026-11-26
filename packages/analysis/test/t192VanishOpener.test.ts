/**
 * Pipeline T192 (user ruling R121, 2026-11-25): the stealth a Vanish leaves
 * (11327) that came off right after its holder pressed something stealth
 * does not allow was ended by that press — the opener. It read `ended after
 * 0.4 of 1.5s — no dispel logged`. A press stealth allows (Shadowstep) ends
 * nothing (review 85-tk-L5-T192-2: an enemy Flare took the aura in a
 * Shadowstep's millisecond).
 */
import {
  CombatUnitClass,
  CombatUnitSpec,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  CHARGE_CAST_MS,
  extractOwnerCDBuffExpiry,
} from "../src/context/timelineHelpers";
import { ensureAnalysisData } from "../src/data/ensure";
import { pressEndsStealth } from "../src/utils/stealthActionEnd";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_700_000_000_000;
const ME = "player-1";
const VANISH = "1856";
const VANISH_AURA = "11327";
const CHEAP_SHOT = "1833";
const SHADOWSTEP = "36554";

beforeAll(async () => {
  await ensureAnalysisData();
});

const rogue = (
  removedS: number,
  openerS?: number,
  opener: [string, string] = [CHEAP_SHOT, "Cheap Shot"],
) =>
  makeUnit(ME, {
    class: CombatUnitClass.Rogue,
    spec: CombatUnitSpec.Rogue_Subtlety,
    spellCastEvents: [
      makeSpellCastEvent(VANISH, T0 + 30_000, ME),
      ...(openerS === undefined
        ? []
        : [
            makeSpellCastEvent(
              opener[0],
              T0 + openerS * 1000,
              "enemy-1",
              "Enemy",
              ME,
              "Me",
              0,
              opener[1],
            ),
          ]),
    ],
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        VANISH_AURA,
        T0 + 30_000,
        ME,
        ME,
        "BUFF",
      ),
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        VANISH_AURA,
        T0 + removedS * 1000,
        ME,
        ME,
        "BUFF",
      ),
    ],
  }) as ICombatUnit;

const fade = (u: ICombatUnit) =>
  extractOwnerCDBuffExpiry(
    [
      {
        spellId: VANISH,
        spellName: "Vanish",
        tag: "Defensive",
        casts: [{ timeSeconds: 30 }],
        cooldownSeconds: 120,
        neverUsed: false,
        availableWindows: [],
      },
    ] as never,
    ME,
    [u],
    T0,
    u,
  )[0]!;

describe("[BUFF FADED] — a Vanish its opener took (T192)", () => {
  it("the predicate: an opener ends the stealth, a press stealth allows does not, another aura is no stealth", () => {
    expect(pressEndsStealth(VANISH_AURA, CHEAP_SHOT)).toBe(true);
    expect(pressEndsStealth(VANISH_AURA, SHADOWSTEP)).toBe(false);
    expect(pressEndsStealth("334581", CHEAP_SHOT)).toBe(false);
    expect(CHARGE_CAST_MS).toBe(100);
  });

  it("a Shadowstep at the removal ended nothing: the line keeps its length", () => {
    const e = fade(rogue(31.0, 30.99, [SHADOWSTEP, "Shadowstep"]));
    expect(e.cause).toBe("ended_early");
    expect(e.endedByOwnPress).toBeUndefined();
    expect(e.ranForS).toBeCloseTo(1.0);
  });

  it("the opener ≤ 100 ms before the removal ended it", () => {
    const e = fade(rogue(30.42, 30.4));
    expect(e.cause).toBe("ended_early");
    expect(e.endedByOwnPress).toBe("Cheap Shot");
  });

  it("no cast at the removal: the early end keeps its length and no cause", () => {
    const e = fade(rogue(30.42));
    expect(e.cause).toBe("ended_early");
    expect(e.endedByOwnPress).toBeUndefined();
    expect(e.ranForS).toBeCloseTo(0.42);
  });

  it("an opener more than 100 ms before the removal is not at it", () => {
    expect(fade(rogue(30.6, 30.4)).endedByOwnPress).toBeUndefined();
  });

  it("an aura that ran its 1.5 s beside a cast expired", () => {
    const e = fade(rogue(31.5, 31.45));
    expect(e.cause).toBe("expired");
    expect(e.endedByOwnPress).toBeUndefined();
  });
});

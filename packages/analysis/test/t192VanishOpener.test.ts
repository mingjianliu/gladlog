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

import { extractOwnerCDBuffExpiry } from "../src/context/timelineHelpers";
import { ensureAnalysisData } from "../src/data/ensure";
import { STEALTH_OPENER_CAST_MS } from "../src/utils/stealthActionEnd";
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
const SHADOWSTRIKE = "185438";
const STEALTH = "115191";
const EVISCERATE = "196819";

beforeAll(async () => {
  await ensureAnalysisData();
});

interface Opener {
  id: string;
  name: string;
  atS: number;
  /** cast at the rogue itself (the Stealth button) */
  self?: boolean;
  /** the opener's own damage row, logged with the cast */
  damage?: boolean;
}
const rogue = (removedS: number, openers: Opener[] = [], appliedS = 30) =>
  makeUnit(ME, {
    class: CombatUnitClass.Rogue,
    spec: CombatUnitSpec.Rogue_Subtlety,
    spellCastEvents: [
      makeSpellCastEvent(VANISH, T0 + 30_000, ME),
      ...openers.map((o) =>
        makeSpellCastEvent(
          o.id,
          T0 + o.atS * 1000,
          o.self ? ME : "enemy-1",
          o.self ? "Me" : "Enemy",
          ME,
          "Me",
          0,
          o.name,
        ),
      ),
    ].sort((a, b) => a.logLine.timestamp - b.logLine.timestamp),
    damageOut: openers
      .filter((o) => o.damage)
      .map((o) => ({
        spellId: o.id,
        spellName: o.name,
        srcUnitId: ME,
        destUnitId: "enemy-1",
        timestamp: T0 + o.atS * 1000,
        logLine: {
          event: LogEvent.SPELL_DAMAGE,
          timestamp: T0 + o.atS * 1000,
          parameters: [],
        },
      })) as never,
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        VANISH_AURA,
        T0 + appliedS * 1000,
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

const cheap = (atS: number): Opener => ({
  id: CHEAP_SHOT,
  name: "Cheap Shot",
  atS,
});

describe("[BUFF FADED] — a Vanish its opener took (T192)", () => {
  it("the opener ≤ 100 ms before the removal ended it", () => {
    const e = fade(rogue(30.42, [cheap(30.4)]));
    expect(e.cause).toBe("ended_early");
    expect(e.endedByOwnPress).toBe("Cheap Shot");
    expect(STEALTH_OPENER_CAST_MS).toBe(100);
  });

  it("no cast at the removal: the early end keeps its length and no cause", () => {
    const e = fade(rogue(30.42));
    expect(e.cause).toBe("ended_early");
    expect(e.endedByOwnPress).toBeUndefined();
    expect(e.ranForS).toBeCloseTo(0.42);
  });

  it("an opener more than 100 ms before the removal is not at it", () => {
    expect(fade(rogue(30.6, [cheap(30.4)])).endedByOwnPress).toBeUndefined();
  });

  it("an aura that ran its 1.5 s beside a cast expired", () => {
    const e = fade(rogue(31.5, [cheap(31.45)]));
    expect(e.cause).toBe("expired");
    expect(e.endedByOwnPress).toBeUndefined();
  });

  it("a Shadowstep at the removal ended nothing (an enemy Flare took the aura): the line keeps its length", () => {
    const e = fade(
      rogue(31.0, [{ id: SHADOWSTEP, name: "Shadowstep", atS: 30.99 }]),
    );
    expect(e.cause).toBe("ended_early");
    expect(e.endedByOwnPress).toBeUndefined();
    expect(e.ranForS).toBeCloseTo(1.0);
  });

  it("Shadowstrike needs stealth and ends it: named when its damage landed, not without", () => {
    const strike = (damage: boolean): Opener => ({
      id: SHADOWSTRIKE,
      name: "Shadowstrike",
      atS: 30.9,
      damage,
    });
    expect(fade(rogue(30.97, [strike(true)])).endedByOwnPress).toBe(
      "Shadowstrike",
    );
    expect(fade(rogue(30.97, [strike(false)])).endedByOwnPress).toBeUndefined();
  });

  it("the Stealth button in the Shadowstrike's millisecond is no opener (codex 85-tk-L5-T192-2b #1)", () => {
    const e = fade(
      rogue(30.97, [
        { id: STEALTH, name: "Stealth", atS: 30.9, self: true },
        { id: SHADOWSTRIKE, name: "Shadowstrike", atS: 30.9, damage: true },
      ]),
    );
    expect(e.endedByOwnPress).toBe("Shadowstrike");
    expect(
      fade(
        rogue(30.97, [{ id: STEALTH, name: "Stealth", atS: 30.9, self: true }]),
      ).endedByOwnPress,
    ).toBeUndefined();
  });

  it("a press logged before the Vanish went up is no opener of it (same review #2)", () => {
    // Eviscerate 56 ms before the aura's APPLIED, the aura off 25 ms after it
    const e = fade(
      rogue(
        30.081,
        [{ id: EVISCERATE, name: "Eviscerate", atS: 30.0, damage: true }],
        30.056,
      ),
    );
    expect(e.endedByOwnPress).toBeUndefined();
    // the same press after it went up is one
    expect(
      fade(
        rogue(
          30.081,
          [{ id: EVISCERATE, name: "Eviscerate", atS: 30.07 }],
          30.056,
        ),
      ).endedByOwnPress,
    ).toBe("Eviscerate");
  });
});

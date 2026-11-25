/**
 * Pipeline T192 (user ruling R121, 2026-11-25): a one-charge aura (DB2
 * SpellAuraOptions.ProcCharges, `PROC_CHARGE_AURA_IDS`) that came off right
 * after its holder's own cast was ended by that cast. Vanish's 11327 goes
 * with the opener and read `ended after 0.4 of 1.5s — no dispel logged`.
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
import { PROC_CHARGE_AURA_IDS } from "../src/data/procChargeAurasGenerated";
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

beforeAll(async () => {
  await ensureAnalysisData();
});

const rogue = (removedS: number, openerS?: number) =>
  makeUnit(ME, {
    class: CombatUnitClass.Rogue,
    spec: CombatUnitSpec.Rogue_Subtlety,
    spellCastEvents: [
      makeSpellCastEvent(VANISH, T0 + 30_000, ME),
      ...(openerS === undefined
        ? []
        : [
            makeSpellCastEvent(
              CHEAP_SHOT,
              T0 + openerS * 1000,
              "enemy-1",
              "Enemy",
              ME,
              "Me",
              0,
              "Cheap Shot",
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

describe("[BUFF FADED] — a one-charge aura ended by its holder's cast (T192)", () => {
  it("the table is DB2's: Vanish's aura carries a charge", () => {
    expect(PROC_CHARGE_AURA_IDS.has(VANISH_AURA)).toBe(true);
    expect(CHARGE_CAST_MS).toBe(100);
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

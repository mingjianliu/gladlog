/**
 * Pipeline T113 (fact13 D21): the end of a stealth-kind immunity the log
 * never shows. A Mass Invisibility at 0:11.03 with no REMOVED, its holder
 * beginning a Polymorph bar 9.0 s in (feared off — no SUCCESS), read
 * `immune, 10.8s — ended by a hit`: the first aimed hit, searched as far as
 * the aura's official 12 s.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  enemyDefensiveEvents,
  holderFirstOwnActionAfterMs,
  ownSaveSpanS,
  saveAuraIntervals,
  untargetableEndS,
} from "../src/utils/enemyDefensives";
import { makeAuraEvent, makeUnit } from "./ported/testHelpers";

const START = 1_000_000;
const at = (s: number) => START + Math.round(s * 1000);
const MASS_INVIS = "414664";

beforeAll(async () => {
  await ensureAnalysisData();
});

const barBegun = (s: number) =>
  ({
    spellId: "118",
    spellName: "Polymorph",
    timestamp: at(s),
    srcUnitId: "e1",
    logLine: { event: "SPELL_CAST_START", timestamp: at(s) },
  }) as never;
const ownHit = (s: number) =>
  ({
    srcUnitId: "e1",
    spellId: "30451",
    logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: at(s) },
  }) as never;
const holder = (over: Record<string, unknown>) =>
  ({ id: "e1", spellCastEvents: [], damageOut: [], ...over }) as never;

describe("the holder's first own action after an unseen-end aura (T113)", () => {
  it("a cast bar begun is one, though no SUCCESS follows", () => {
    expect(
      holderFirstOwnActionAfterMs(
        holder({ castStartEvents: [barBegun(20.017)] }),
        at(11.03),
        MASS_INVIS,
      ),
    ).toBe(at(20.017));
  });
  it("a hit it dealt in the aura's first second was already on its way", () => {
    expect(
      holderFirstOwnActionAfterMs(
        holder({ damageOut: [ownHit(11.08)] }),
        at(11.03),
        MASS_INVIS,
      ),
    ).toBe(Infinity);
    // past the first second it is the holder acting
    expect(
      holderFirstOwnActionAfterMs(
        holder({ damageOut: [ownHit(11.08), ownHit(14.5)] }),
        at(11.03),
        MASS_INVIS,
      ),
    ).toBe(at(14.5));
  });
  it("a melee swing in the first second is never in flight: it is one", () => {
    const swing = {
      srcUnitId: "e1",
      spellId: "",
      logLine: { event: LogEvent.SWING_DAMAGE, timestamp: at(11.5) },
    } as never;
    expect(
      holderFirstOwnActionAfterMs(
        holder({ damageOut: [swing] }),
        at(11.03),
        MASS_INVIS,
      ),
    ).toBe(at(11.5));
    // its landed row, and a swing a shield ate whole (no attacking spell)
    for (const row of [
      {
        srcUnitId: "e1",
        spellId: "",
        logLine: { event: LogEvent.SWING_DAMAGE_LANDED, timestamp: at(11.5) },
      },
      {
        srcUnitId: "e1",
        spellId: "",
        logLine: { event: LogEvent.SPELL_ABSORBED, timestamp: at(11.5) },
      },
    ])
      expect(
        holderFirstOwnActionAfterMs(
          holder({ damageOut: [row] }),
          at(11.03),
          MASS_INVIS,
        ),
      ).toBe(at(11.5));
    // an absorbed spell hit in the first second stays in flight
    expect(
      holderFirstOwnActionAfterMs(
        holder({
          damageOut: [
            {
              srcUnitId: "e1",
              spellId: "",
              attackSpellId: "30451",
              logLine: { event: LogEvent.SPELL_ABSORBED, timestamp: at(11.5) },
            },
          ],
        }),
        at(11.03),
        MASS_INVIS,
      ),
    ).toBe(Infinity);
  });
  it("untargetableEndS reads the same end", () => {
    expect(
      untargetableEndS(
        holder({ castStartEvents: [barBegun(20.017)] }),
        { spellId: MASS_INVIS, fromS: 11.03, toS: 23.03, inferredEnd: true },
        START,
      ),
    ).toBeCloseTo(20.017);
  });
});

describe("saveAuraIntervals — the aimed hit that ends a stealth-kind immunity (T113)", () => {
  const swing = (s: number) => ({
    srcUnitId: "f1",
    destUnitId: "e1",
    timestamp: at(s),
    logLine: { event: LogEvent.SWING_DAMAGE, timestamp: at(s), lineIndex: 900 },
  });
  const run = (castStartEvents: unknown[]) => {
    const mage = makeUnit("e1", {
      name: "Mage",
      spec: CombatUnitSpec.Mage_Arcane,
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          MASS_INVIS,
          at(11.03),
          "e1",
          "e1",
          "BUFF",
        ),
      ],
    });
    Object.assign(mage, { castStartEvents, damageIn: [swing(21.83)] });
    const friend = makeUnit("f1", {
      name: "Warrior",
      spec: CombatUnitSpec.Warrior_Arms,
      reaction: CombatUnitReaction.Friendly,
    });
    const combat = {
      startTime: START,
      endTime: START + 300_000,
      units: { e1: mage, f1: friend },
    };
    return saveAuraIntervals(mage, [mage], combat as never).find(
      (iv) => iv.spellId === MASS_INVIS,
    )!;
  };
  it("with no own action before it, the hit 10.8 s in is the end", () => {
    const iv = run([]);
    expect(iv.endedByHit).toBe(true);
    expect(iv.overBeforeHit).toBeUndefined();
    expect(iv.toS).toBeCloseTo(21.83);
  });
  it("a cast bar begun 9.0 s in: the interval is still cut at the hit, and says the immunity was over before it", () => {
    const iv = run([barBegun(20.017)]);
    // what every other reader of the interval had (the attackers reached
    // the unit there)…
    expect(iv.endedByHit).toBe(true);
    expect(iv.toS).toBeCloseTo(21.83);
    // …and what keeps the line from stating 10.8 s
    expect(iv.overBeforeHit).toBe(true);
    expect(iv.inferredEnd).toBe(true);
  });
});

describe("the protection ends at the holder's action for every span reader (T113, batch review 80-PIPE-104-B91)", () => {
  // Mass Invisibility up at 20 s, no REMOVED; a Polymorph bar begun at 22 s
  // with no SUCCESS; an incoming swing at 30 s
  it("the [ENEMY DEF] event's length and the kill window's own-save span end at 22 s, not at the hit", () => {
    const mage = makeUnit("e1", {
      name: "Mage",
      spec: CombatUnitSpec.Mage_Arcane,
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          MASS_INVIS,
          at(20),
          "e1",
          "e1",
          "BUFF",
        ),
      ],
    });
    Object.assign(mage, {
      castStartEvents: [barBegun(22)],
      damageIn: [
        {
          srcUnitId: "f1",
          destUnitId: "e1",
          timestamp: at(30),
          logLine: {
            event: LogEvent.SWING_DAMAGE,
            timestamp: at(30),
            lineIndex: 900,
          },
        },
      ],
    });
    const friend = makeUnit("f1", {
      name: "Warrior",
      spec: CombatUnitSpec.Warrior_Arms,
      reaction: CombatUnitReaction.Friendly,
    });
    const combat = {
      startTime: START,
      endTime: START + 300_000,
      units: { e1: mage, f1: friend },
    };
    const iv = saveAuraIntervals(mage, [mage], combat as never).find(
      (x) => x.spellId === MASS_INVIS,
    )!;
    // the attribution cut stays at the hit
    expect(iv.toS).toBeCloseTo(30);
    expect(iv.untargetableToS).toBeCloseTo(22);
    const d = enemyDefensiveEvents(mage, [mage], combat as never).find(
      (e) => e.spellId === MASS_INVIS,
    )!;
    expect(d.endNotLogged).toBe(true);
    expect(d.atSeconds + d.observedSeconds!).toBeCloseTo(22);
    expect(ownSaveSpanS(d, false)?.to).toBeCloseTo(22);
  });
});

describe("…with no later hit too (T113, batch review 80-PIPE-107-B94)", () => {
  // Mass Invisibility up at 20 s, no REMOVED; a Polymorph bar begun at 22 s
  // with no SUCCESS; no incoming hit afterwards
  it("the [ENEMY DEF] length and the kill window's own-save span end at 22 s, not at the 12 s cap", () => {
    const mage = makeUnit("e1", {
      name: "Mage",
      spec: CombatUnitSpec.Mage_Arcane,
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          MASS_INVIS,
          at(20),
          "e1",
          "e1",
          "BUFF",
        ),
      ],
    });
    Object.assign(mage, { castStartEvents: [barBegun(22)], damageIn: [] });
    const combat = {
      startTime: START,
      endTime: START + 300_000,
      units: { e1: mage },
    };
    const iv = saveAuraIntervals(mage, [mage], combat as never).find(
      (x) => x.spellId === MASS_INVIS,
    )!;
    // no hit: the interval keeps the builder's cap, and says where the
    // protection ended
    expect(iv.endedByHit).toBeUndefined();
    expect(iv.toS).toBeCloseTo(32);
    expect(iv.untargetableToS).toBeCloseTo(22);
    const d = enemyDefensiveEvents(mage, [mage], combat as never).find(
      (e) => e.spellId === MASS_INVIS,
    )!;
    expect(d.endNotLogged).toBe(true);
    expect(d.atSeconds + d.observedSeconds!).toBeCloseTo(22);
    expect(ownSaveSpanS(d, false)?.to).toBeCloseTo(22);
  });
});

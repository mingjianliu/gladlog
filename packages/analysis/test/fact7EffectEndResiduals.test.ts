/**
 * fact7 F21, the 605-corpus residuals of class 8 (when an effect ended and
 * why): what a press or debuff in a channel or a stealth does, per DB2
 * attribute, and the kick cooldown a later event reduction shortened.
 */
import type { ICombatUnit } from "@gladlog/parser-compat";
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  ALLOWED_WHILE_STEALTHED_SPELL_IDS,
  CAST_WHILE_CHANNELING_SPELL_IDS,
} from "../src/data/spellStateAttrsGenerated";
import {
  channelEndSeconds,
  channelOverBeforeRoundEnd,
  nextPressEndingChannelMs,
} from "../src/utils/castCommitSpans";
import { holderFirstOwnActionAfterMs } from "../src/utils/enemyDefensives";
import {
  interruptBackAtMs,
  interruptCooldownRemainingMs,
} from "../src/utils/enemyInterrupts";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const ms = (s: number) => T0 + s * 1000;
const NO_UNIT = "0000000000000000";
const press = (spellId: string, s: number, destUnitId = "enemy") =>
  ({
    spellId,
    spellName: "x",
    srcUnitId: "h",
    destUnitId,
    timestamp: ms(s),
    logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: ms(s) },
  }) as never;

describe("the attribute tables are DB2's", () => {
  it("Allow Cast While Channeling: Shimmer yes; Pain Suppression, Power Infusion, Fade no", () => {
    expect(CAST_WHILE_CHANNELING_SPELL_IDS.has("212653")).toBe(true);
    for (const id of ["33206", "10060", "586"])
      expect(CAST_WHILE_CHANNELING_SPELL_IDS.has(id), id).toBe(false);
  });
  it("Allow While Stealthed: Sap, Blind yes; Cheap Shot, Garrote, Gouge no", () => {
    for (const id of ["6770", "2094"])
      expect(ALLOWED_WHILE_STEALTHED_SPELL_IDS.has(id), id).toBe(true);
    for (const id of ["1833", "703", "1776"])
      expect(ALLOWED_WHILE_STEALTHED_SPELL_IDS.has(id), id).toBe(false);
  });
});

describe("fact7 channelOutlived — what an off-GCD press does to a channel", () => {
  const UP = "421453";
  const PAIN_SUPPRESSION = "33206";
  const SHIMMER = "212653";
  const bolt = (s: number) =>
    ({
      spellId: "421543",
      spellName: "Ultimate Penitence",
      srcUnitId: "h",
      logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: ms(s) },
    }) as never;

  it("off the GCD without Allow Cast While Channeling: it ends the channel (ff310053: Pain Suppression 3.47 s in)", () => {
    expect(
      nextPressEndingChannelMs(
        {
          spellCastEvents: [press(UP, 0), press(PAIN_SUPPRESSION, 3.47)],
        },
        UP,
        ms(0),
      ),
    ).toBe(ms(3.47));
  });
  it("off the GCD with it: Shimmer leaves the channel running", () => {
    expect(
      nextPressEndingChannelMs(
        { spellCastEvents: [press(UP, 0), press(SHIMMER, 3.47)] },
        UP,
        ms(0),
      ),
    ).toBe(Infinity);
  });
  it("a bolt in the air after the press does not stretch it: the press wins", () => {
    const unit = {
      id: "h",
      spellCastEvents: [press(UP, 0), press(PAIN_SUPPRESSION, 3.47)],
      damageOut: [bolt(3.4), bolt(4.16)],
      healOut: [],
    };
    expect(channelEndSeconds(unit, UP, 0, 6.5, T0, "Ultimate Penitence")).toBe(
      3.47,
    );
  });
  it("a press before the first bolt, the bolts running on after it, ended nothing (T284: acc115f2 r0, Shadow Word: Death 1 ms in, bolts 1.08–5.88 s)", () => {
    const unit = {
      id: "h",
      spellCastEvents: [press(UP, 0), press("32379", 0.001), press("586", 6.2)],
      damageOut: [bolt(1.08), bolt(3), bolt(5.88)],
      healOut: [],
    };
    expect(nextPressEndingChannelMs(unit, UP, ms(0))).toBe(ms(6.2));
    expect(channelEndSeconds(unit, UP, 0, 6.5, T0, "Ultimate Penitence")).toBe(
      5.88,
    );
  });
  it("a press before the first bolt ends it when no bolt follows (T284: a real cancel)", () => {
    const cancelled = {
      id: "h",
      spellCastEvents: [press(UP, 0), press("32379", 0.05)],
      damageOut: [],
      healOut: [],
    };
    expect(nextPressEndingChannelMs(cancelled, UP, ms(0))).toBe(ms(0.05));
  });
  it("an effect row in the channel's own millisecond, a press, effects after: the press ends it (codex 85-tk-L5-T284-1 #1)", () => {
    const unit = {
      id: "h",
      spellCastEvents: [press(UP, 0), press("32379", 0.084)],
      damageOut: [bolt(0), bolt(0.5), bolt(2.5)],
      healOut: [],
    };
    expect(nextPressEndingChannelMs(unit, UP, ms(0))).toBe(ms(0.084));
  });
  it("an instant cast with its START row, a Penance 1 ms in, bolts after: it runs on (codex 85-tk-L5-T284-1c #1 / #3)", () => {
    const shadowMend = press("186263", 0.001);
    const begun = {
      id: "h",
      spellCastEvents: [press(UP, 0), shadowMend],
      castStartEvents: [shadowMend],
      damageOut: [bolt(0.84), bolt(3), bolt(5.274)],
      healOut: [],
    };
    expect(nextPressEndingChannelMs(begun, UP, ms(0))).toBe(Infinity);
    // the round ends 1.5 s in: six heals in 0.9 s are the channel's
    const cut = {
      id: "h",
      spellCastEvents: [press(UP, 0), press("47540", 0.001)],
      damageOut: [0.611, 0.8, 1.0, 1.2, 1.4, 1.524].map(bolt),
      healOut: [],
    };
    expect(nextPressEndingChannelMs(cut, UP, ms(0))).toBe(Infinity);
  });
  it("presses in the ascent before the bolts, all 25 after them, end nothing (codex 85-tk-L5-T284-1b #1: Shadow Word: Pain 132 ms, a shield 236 ms in)", () => {
    const unit = {
      id: "h",
      spellCastEvents: [
        press(UP, 0),
        press("589", 0.132),
        press("17", 0.236),
        press("586", 5.2),
      ],
      damageOut: [bolt(0.8), bolt(2.5), bolt(4.6)],
      healOut: [],
    };
    expect(nextPressEndingChannelMs(unit, UP, ms(0))).toBe(ms(5.2));
  });
  it("a channel DB2 marks is ended by the press whatever its rows do (Penance: codex 85-tk-L5-T284-1b #4, its one late volley after a Fade)", () => {
    const PENANCE = "47540";
    const unit = {
      id: "h",
      spellCastEvents: [press(PENANCE, 0), press("586", 0.087)],
      damageOut: [
        { ...(bolt(1.1) as object), spellId: "47666", spellName: "Penance" },
        { ...(bolt(2.4) as object), spellId: "47666", spellName: "Penance" },
      ] as never[],
      healOut: [],
    };
    expect(nextPressEndingChannelMs(unit, PENANCE, ms(0))).toBe(ms(0.087));
  });
  it("Ultimate Penitence's aura is the 6.5 s shield: its last bolt ends the channel (7a404f6a: bolts to 5.05 s, Fade at 5.25 s)", () => {
    const unit = {
      id: "h",
      spellCastEvents: [press(UP, 0), press("586", 5.25)],
      damageOut: [bolt(4.87), bolt(5.05)],
      healOut: [],
    };
    expect(channelEndSeconds(unit, UP, 0, 6.5, T0, "Ultimate Penitence")).toBe(
      5.05,
    );
  });
  it("a shield used up before the bolts ends no channel: the last bolt does (T284: 605 cover ec1fd439 r6, 421453 REMOVED 0.72 s in, bolts 0.82–5.82 s)", () => {
    const unit = {
      id: "h",
      spellCastEvents: [press(UP, 0)],
      damageOut: [bolt(0.82), bolt(3.1), bolt(5.82)],
      healOut: [],
    };
    expect(channelEndSeconds(unit, UP, 0, 0.72, T0, "Ultimate Penitence")).toBe(
      5.82,
    );
  });

  it("the bolts are read to the next press of it, not past", () => {
    const unit = {
      id: "h",
      spellCastEvents: [press(UP, 0), press(UP, 4)],
      damageOut: [bolt(0.82), bolt(3.1), bolt(4.5)],
      healOut: [],
    };
    expect(channelEndSeconds(unit, UP, 0, 0.72, T0, "Ultimate Penitence")).toBe(
      3.1,
    );
  });

  it("a bolt that missed or that a shield ate is a bolt (7a404f6a 1:01: into a Grounding Totem from 3.0 s)", () => {
    const missed = {
      spellId: "421543",
      spellName: "Ultimate Penitence",
      srcUnitId: "h",
      logLine: { event: LogEvent.SPELL_MISSED, timestamp: ms(5.05) },
    } as never;
    const absorbed = {
      spellId: "17",
      spellName: "Power Word: Shield",
      attackSpellId: "421543",
      attackSpellName: "Ultimate Penitence",
      srcUnitId: "h",
      logLine: { event: LogEvent.SPELL_ABSORBED, timestamp: ms(4.4) },
    } as never;
    const unit = {
      id: "h",
      spellCastEvents: [press(UP, 0), press("586", 5.25)],
      damageOut: [bolt(3), absorbed],
      healOut: [],
    };
    expect(channelEndSeconds(unit, UP, 0, 6.5, T0, "Ultimate Penitence")).toBe(
      4.4,
    );
    expect(
      channelEndSeconds(
        { ...unit, missesOut: [missed] },
        UP,
        0,
        6.5,
        T0,
        "Ultimate Penitence",
      ),
    ).toBe(5.05);
  });
  it("over before the round's end: a press that stopped it, or a last bolt more than a bolt before (codex 01-3)", () => {
    const pressed = {
      id: "h",
      // 44-6-278's shape: Shadow Word: Death 4.14 s in, the round ends 0.4 s on
      spellCastEvents: [press(UP, 0), press("32379", 4.14)],
      damageOut: [bolt(4)],
      healOut: [],
    };
    expect(
      channelOverBeforeRoundEnd(pressed, UP, 0, 4.5, T0, "Ultimate Penitence"),
    ).toBe(true);
    const lastBolt = (s: number) => ({
      id: "h",
      spellCastEvents: [press(UP, 0)],
      damageOut: [bolt(s)],
      healOut: [],
    });
    // 93-4-657's shape: the last bolt 1.9 s before the round's end
    expect(
      channelOverBeforeRoundEnd(
        lastBolt(3.3),
        UP,
        0,
        5.2,
        T0,
        "Ultimate Penitence",
      ),
    ).toBe(true);
    expect(
      channelOverBeforeRoundEnd(
        lastBolt(5.05),
        UP,
        0,
        5.2,
        T0,
        "Ultimate Penitence",
      ),
    ).toBe(false);
  });
  it("a spell DB2 calls a channel keeps its aura's end", () => {
    const unit = { id: "h", spellCastEvents: [], damageOut: [], healOut: [] };
    expect(channelEndSeconds(unit, "47540", 0, 2, T0, "Penance")).toBe(2);
  });
});

describe("fact7 unseenEndOpener — what ends a stealth nobody saw end", () => {
  const VANISH = "11327";
  const GREATER_INVISIBILITY = "110960";
  const debuff = (spellId: string, s: number) =>
    ({
      spellId,
      spellName: "x",
      srcUnitId: "h",
      destUnitId: "enemy",
      auraType: "DEBUFF",
      logLine: { event: LogEvent.SPELL_AURA_APPLIED, timestamp: ms(s) },
    }) as never;
  const holder = (casts: never[] = []) =>
    ({ id: "h", spellCastEvents: casts, damageOut: [] }) as never;
  const units = (...rows: never[]) =>
    [{ id: "h" }, { id: "enemy", auraEvents: rows }] as never as ICombatUnit[];

  it("a press stealth allows leaves Vanish up; Cheap Shot does not", () => {
    expect(
      holderFirstOwnActionAfterMs(holder([press("6770", 11)]), ms(10), VANISH),
    ).toBe(Infinity);
    expect(
      holderFirstOwnActionAfterMs(holder([press("1833", 11)]), ms(10), VANISH),
    ).toBe(ms(11));
  });
  it("an invisibility is not a stealth: the same press ends it", () => {
    expect(
      holderFirstOwnActionAfterMs(
        holder([press("6770", 11)]),
        ms(10),
        GREATER_INVISIBILITY,
      ),
    ).toBe(ms(11));
  });
  it("Sap's aura is no opener; Cheap Shot's is", () => {
    expect(
      holderFirstOwnActionAfterMs(
        holder(),
        ms(10),
        VANISH,
        units(debuff("6770", 10.7)),
      ),
    ).toBe(Infinity);
    expect(
      holderFirstOwnActionAfterMs(
        holder(),
        ms(10),
        VANISH,
        units(debuff("1833", 10.5)),
      ),
    ).toBe(ms(10.5));
  });
  it("a snare is a rider, not an opener (Chilled)", () => {
    expect(
      holderFirstOwnActionAfterMs(
        holder(),
        ms(10),
        GREATER_INVISIBILITY,
        units(debuff("205708", 10.5)),
      ),
    ).toBe(Infinity);
  });
  it("a Garrote pressed on a player 15.5 s earlier stands nowhere (a7c8de4c): its aura ends the Vanish", () => {
    expect(
      holderFirstOwnActionAfterMs(
        holder([press("703", 0.5)]),
        ms(16),
        VANISH,
        units(debuff("703", 16.34)),
      ),
    ).toBe(ms(16.34));
  });
  it("a Ring of Frost down before it does (no unit on its press row)", () => {
    expect(
      holderFirstOwnActionAfterMs(
        holder([press("113724", 8, NO_UNIT)]),
        ms(10),
        GREATER_INVISIBILITY,
        units(debuff("82691", 11)),
      ),
    ).toBe(Infinity);
  });
  it("T261: a Polymorph that came off above Greater Invisibility's APPLIED in its millisecond is no action after it (0c2f3878 16:20:00.769)", () => {
    const at = (row: object, s: number, line: number) =>
      ({
        ...row,
        logLine: {
          ...(row as { logLine: object }).logLine,
          timestamp: ms(s),
          lineIndex: line,
        },
      }) as never;
    const poly = at(press("118", 67.3), 67.3, 1);
    const polyDebuff = at(debuff("118", 67.3), 67.3, 5);
    // the raw order: Polymorph SUCCESS (1), invisibility APPLIED (2), its two
    // cast rows (3, 4), the Polymorph DEBUFF APPLIED (5)
    expect(
      holderFirstOwnActionAfterMs(
        holder([poly]),
        ms(67.3),
        GREATER_INVISIBILITY,
        units(polyDebuff),
        2,
      ),
    ).toBe(Infinity);
    // a Polymorph pressed below the APPLIED is the mage acting again
    const polyBelow = at(press("118", 67.3), 67.3, 4);
    expect(
      holderFirstOwnActionAfterMs(
        holder([polyBelow]),
        ms(67.3),
        GREATER_INVISIBILITY,
        units(polyDebuff),
        2,
      ),
    ).toBe(ms(67.3));
    // no press row at all (fact7 D59, a lost cast row): the debuff still ends it
    expect(
      holderFirstOwnActionAfterMs(
        holder(),
        ms(67.3),
        GREATER_INVISIBILITY,
        units(polyDebuff),
        2,
      ),
    ).toBe(ms(67.3));
    // a cast row of the application's millisecond with no row index says
    // nothing about its order (codex 85-mac-minifix-T261-1 #2)
    const polyNoIndex = {
      ...(press("118", 67.3) as object),
      logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: ms(67.3) },
    } as never;
    expect(
      holderFirstOwnActionAfterMs(
        holder([polyNoIndex]),
        ms(67.3),
        GREATER_INVISIBILITY,
        units(polyDebuff),
        2,
      ),
    ).toBe(ms(67.3));
    // a press on another unit is not this debuff's press
    expect(
      holderFirstOwnActionAfterMs(
        holder([at(press("118", 67.3, "other"), 67.3, 1)]),
        ms(67.3),
        GREATER_INVISIBILITY,
        units(polyDebuff),
        2,
      ),
    ).toBe(ms(67.3));
  });
});

describe("fact7 kickBackVsNextPress — the back of a kick a later event shortened", () => {
  const cast = (spellId: string, s: number) => ({
    spellId,
    spellName: "x",
    logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: ms(s) },
  });
  it("18703d63 1:50: Storm Conduit's bolts after the kick bring it back when [RES] says", () => {
    const shaman = {
      id: "s",
      name: "Sham-R-US",
      class: 7,
      spec: "262",
      info: { pvpTalents: ["1217092"], talents: [] },
      spellCastEvents: [
        cast("57994", 10),
        cast("188196", 12),
        cast("188196", 14),
        cast("188196", 16),
      ],
      petSpellCastEvents: [],
    } as unknown as ICombatUnit;
    const back = interruptBackAtMs(shaman, "57994", ms(10), 12);
    expect(back).toBeLessThan(ms(22));
    expect(back).toBe(
      ms(17) + interruptCooldownRemainingMs(shaman, "57994", ms(17)),
    );
  });
});

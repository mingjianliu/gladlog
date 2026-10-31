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

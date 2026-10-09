/**
 * B-tier D1, the facts (user rulings 2026-10-06) — none adds an accusation:
 *  - B21b kickAudit: a channel the kick's target stopped itself at most
 *    STOPPED_JUST_BEFORE_S before the kick is the bait, ahead of an earlier
 *    unfinished hardcast (0e0663e6 @44: "JUKED by fake Benediction" named a
 *    bar from 3.4 s earlier; Divine Hymn had stopped 0.1 s before the kick);
 *  - B6 kick-eaten `sameKicker`: the round's kicks on the player by this
 *    line's kicker, every kick counted (141470d0: Counter Shot ×7);
 *  - B7b kick-priority-missed `youChannelling`: what the player was casting
 *    or channelling while the heal was being cast (2abc9185 @62.3).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { kickEatenEvents } from "../src/analysis/candidateFindings";
import {
  type IKickPriorityPoint,
  kickPriorityMissedEvents,
} from "../src/analysis/candidates/kickPriority";
import { ensureAnalysisData } from "../src/data/ensure";
import { formatBurstLedgerForContext } from "../src/utils/burstLedger";
import { STOPPED_JUST_BEFORE_S } from "../src/utils/castStopEvidence";
import {
  analyzeKickAudit,
  CHANNEL_STOPPED_MAX_SHARE,
  jukedByStoppedChannelText,
} from "../src/utils/kickAudit";
import {
  makeAuraEvent,
  makeInterruptEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const MIND_FREEZE = "47528";
const DIVINE_HYMN = "64843"; // channelled (channeledGenerated), official 8 s
const BENEDICTION = "2061"; // any hardcast id: Flash Heal
const HAMMER_OF_JUSTICE = "853"; // a stun (ccSpellIds)
const combat = { startTime: T0, endTime: T0 + 120_000 } as any;
const info = { teamId: "0", specId: "x" } as any;

const kicker = (kickS: number) =>
  makeUnit("p1", {
    name: "Knight",
    info,
    spellCastEvents: [
      makeSpellCastEvent(
        MIND_FREEZE,
        T0 + kickS * 1000,
        "e1",
        "Priest",
        "p1",
        "Knight",
        0,
        "Mind Freeze",
      ),
    ],
  } as any);

const castStart = (spellId: string, s: number): any => {
  const e = makeSpellCastEvent(spellId, T0 + s * 1000, "e1", "e1", "e1", "e1");
  e.logLine.event = LogEvent.SPELL_CAST_START;
  return e;
};

/** An enemy priest who channelled Divine Hymn over [fromS, toS]. */
const priest = (fromS: number, toS: number, extra: Record<string, any> = {}) =>
  makeUnit("e1", {
    name: "Priest",
    info,
    spellCastEvents: [
      makeSpellCastEvent(
        DIVINE_HYMN,
        T0 + fromS * 1000,
        "e1",
        "Priest",
        "e1",
        "Priest",
        0,
        "Divine Hymn",
      ),
    ],
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        DIVINE_HYMN,
        T0 + fromS * 1000,
        "e1",
        "e1",
        "BUFF",
      ),
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        DIVINE_HYMN,
        T0 + toS * 1000,
        "e1",
        "e1",
        "BUFF",
      ),
      ...(extra.auraEvents ?? []),
    ],
    castStartEvents: extra.castStartEvents ?? [castStart(BENEDICTION, 1)],
    actionIn: extra.actionIn ?? [],
  } as any);

describe("kickAudit: a channel the target stopped just before the kick (B21b)", () => {
  it("is the bait, ahead of an unfinished hardcast from earlier in the lookback (0e0663e6 @44)", () => {
    const enemy = priest(44.01, 44.648, {
      castStartEvents: [castStart(BENEDICTION, 41.368)],
    });
    const [k] = analyzeKickAudit(kicker(44.751), [enemy], combat);
    expect(k!.result).toBe("juked");
    expect(k!.jukedBySpellName).toBe("Divine Hymn");
    expect(k!.jukedChannelStoppedAgoS).toBeCloseTo(0.103, 3);
    expect(jukedByStoppedChannelText(k!)).toBe(
      "JUKED — their Divine Hymn channel stopped 0.1s before the kick",
    );
    const lines = formatBurstLedgerForContext([], [], [k!]).join("\n");
    expect(lines).toContain(
      "0:44 Mind Freeze → JUKED — their Divine Hymn channel stopped 0.1s before the kick",
    );
  });

  it("turns a kick that found no hardcast at all from missed into juked", () => {
    const enemy = priest(44.01, 44.648, {
      castStartEvents: [castStart(BENEDICTION, 1)],
    });
    expect(analyzeKickAudit(kicker(44.751), [enemy], combat)[0]!.result).toBe(
      "juked",
    );
  });

  it("reads the 0.5 s of kick-eaten's stoppedJustBefore: 0.5 s before counts, 0.6 s does not", () => {
    expect(STOPPED_JUST_BEFORE_S).toBe(0.5);
    const at = (kickS: number) =>
      analyzeKickAudit(kicker(kickS), [priest(44, 44.6)], combat)[0]!;
    expect(at(45.1).result).toBe("juked");
    expect(at(45.2).result).toBe("missed");
  });

  it("a channel that ran half its official duration or more is not a stop", () => {
    expect(CHANNEL_STOPPED_MAX_SHARE).toBe(0.5);
    // official 8 s: 3.9 s is a stop, 4.1 s may be a hasted natural end
    const at = (toS: number) =>
      analyzeKickAudit(kicker(toS + 0.1), [priest(40, toS)], combat)[0]!;
    expect(at(43.9).result).toBe("juked");
    expect(at(44.1).result).toBe("missed");
  });

  it("a channel still running at the kick is not the bait", () => {
    const [k] = analyzeKickAudit(kicker(44.3), [priest(44, 44.6)], combat);
    expect(k!.result).toBe("missed");
  });

  it("a channel a stun ended is not a stop of the target's own (ruling A′17's rule, this side)", () => {
    const enemy = priest(44, 44.6, {
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          HAMMER_OF_JUSTICE,
          T0 + 44_550,
          "p2",
          "e1",
        ),
      ],
    });
    const [k] = analyzeKickAudit(kicker(44.7), [enemy], combat);
    expect(k!.jukedChannelStoppedAgoS).toBeUndefined();
    expect(k!.result).toBe("missed");
  });

  it("a stun that lands after the channel ended forced nothing: the kick was still juked (codex 45-FT-95)", () => {
    // Divine Hymn 44.010–44.648, Mind Freeze misses at 44.751, Hammer of
    // Justice lands at 44.800 — after both
    const enemy = priest(44.01, 44.648, {
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          HAMMER_OF_JUSTICE,
          T0 + 44_800,
          "p2",
          "e1",
        ),
      ],
    });
    const [k] = analyzeKickAudit(kicker(44.751), [enemy], combat);
    expect(k!.result).toBe("juked");
    expect(k!.jukedBySpellName).toBe("Divine Hymn");
    expect(k!.jukedChannelStoppedAgoS).toBeCloseTo(0.103, 3);
    // a stun logged in the channel's last ms (or 1 ms across the boundary)
    // still forced it
    for (const stunMs of [44_648, 44_649]) {
      const forced = priest(44.01, 44.648, {
        auraEvents: [
          makeAuraEvent(
            LogEvent.SPELL_AURA_APPLIED,
            HAMMER_OF_JUSTICE,
            T0 + stunMs,
            "p2",
            "e1",
          ),
        ],
      });
      const [f] = analyzeKickAudit(kicker(44.751), [forced], combat);
      expect(f!.jukedChannelStoppedAgoS).toBeUndefined();
    }
  });

  it("a channel somebody else interrupted is not a stop either", () => {
    const enemy = priest(44, 44.6, {
      actionIn: [
        {
          ...makeInterruptEvent(
            "1766",
            "Kick",
            DIVINE_HYMN,
            "Divine Hymn",
            T0 + 44_600,
            "p2",
            "Rogue",
          ),
          destUnitId: "e1",
        },
      ],
    });
    const [k] = analyzeKickAudit(kicker(44.9), [enemy], combat);
    expect(k!.jukedChannelStoppedAgoS).toBeUndefined();
  });

  it("under a tenth of a second the wording says so, never '0.0s'", () => {
    expect(
      jukedByStoppedChannelText({
        jukedBySpellName: "Disintegrate",
        jukedChannelStoppedAgoS: 0.03,
      }),
    ).toBe(
      "JUKED — their Disintegrate channel stopped under 0.1s before the kick",
    );
  });
});

describe("kick-eaten sameKicker (B6)", () => {
  const kick = (atSeconds: number, sourceName: string, spell: string) => ({
    atSeconds,
    lockoutDurationSeconds: 3,
    kickSpellName: "Counter Shot",
    interruptedSpellName: spell,
    sourceName,
    postKick: "idle" as const,
    firstActionDelayS: null,
    switchSpellName: null,
    switchDelayS: null,
    switchWasHardCast: null,
    nearestKickerDistYd: null,
    kickersInRange: null,
    kickDepthPct: null,
    ccInWindowS: null,
  });
  const owner = { id: "o", name: "Owner" };

  it("counts every kick by the line's kicker, the ones the cap drops included", () => {
    const kicks = [
      kick(60, "Zujo", "Sleep Walk"),
      kick(170, "Zujo", "Sleep Walk"),
      kick(198, "Zujo", "Sleep Walk"),
      kick(226, "Zujo", "Disintegrate"),
      kick(363, "Zujo", "Disintegrate"),
      kick(387, "Zujo", "Sleep Walk"),
      kick(448, "Zujo", "Disintegrate"),
      kick(400, "Shammy", "Sleep Walk"),
    ] as any[];
    const out = kickEatenEvents(kicks, owner);
    // the cap (2, no pressure closure) decides what is listed — unchanged
    expect(out).toHaveLength(2);
    for (const e of out)
      expect(e.facts["sameKicker"]).toBe(
        "Zujo ×7 (Sleep Walk ×4 + Disintegrate ×3)",
      );
  });

  it("is absent for a kicker's only kick", () => {
    const out = kickEatenEvents(
      [
        kick(60, "Zujo", "Sleep Walk"),
        kick(90, "Shammy", "Sleep Walk"),
      ] as any[],
      owner,
    );
    expect(out).toHaveLength(2);
    expect(out.every((e) => e.facts["sameKicker"] === undefined)).toBe(true);
  });

  it("does not change which kicks are listed", () => {
    const kicks = [
      kick(60, "Zujo", "Sleep Walk"),
      kick(170, "Zujo", "Sleep Walk"),
      kick(198, "Zujo", "Disintegrate"),
    ] as any[];
    expect(kickEatenEvents(kicks, owner).map((e) => e.id)).toEqual([
      "kick-eaten:o:60",
      "kick-eaten:o:170",
    ]);
  });
});

describe("kick-priority-missed youChannelling (B7b)", () => {
  const owner = { id: "P1", name: "Monk" };
  const friend = {
    id: "P1",
    name: "Monk",
    kickSpellId: "116705",
    kickSpellName: "Spear Hand Strike",
    cdRemainingS: 0,
    neverObserved: true,
    locked: false,
    distanceYd: 14,
    inRange: true,
    feasible: true,
    reachableBeforeLanding: true,
    rootedThroughCast: false,
    rangeYd: 5,
    reachYd: 16,
    kickReadyForS: null,
  };
  const point = {
    healerId: "E3",
    healerName: "Priest",
    spellId: "2061",
    spellName: "Benediction",
    castStartS: 62.4,
    castEndS: 63.67,
    durationS: 1.3,
    outcome: "completed",
    interruptedById: null,
    interruptedByName: null,
    targetId: "E1",
    targetName: "Hunter",
    targetHpPct: 43,
    healAmount: 140_000,
    healOtherName: null,
    healOtherAmount: 0,
    healCasts: 1,
    windowFromS: 55,
    windowToS: 70,
    friends: [friend],
  } as unknown as IKickPriorityPoint;
  const ref = {
    nCompleted: 1000,
    nInterrupted: 400,
    deathCompletedPct: 12,
    deathInterruptedPct: 31,
  };

  it("asks the probe about the heal's own cast span and prints what it returns", () => {
    const asked: Array<[number, number]> = [];
    const ev = kickPriorityMissedEvents([point], owner, {
      lookup: () => ref,
      ownerBusyWith: (from, to) => {
        asked.push([from, to]);
        return "Fists of Fury";
      },
    });
    expect(asked).toEqual([[62.4, 63.67]]);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.facts["youChannelling"]).toBe("Fists of Fury");
  });

  it("is absent when the player's hands were free, and without the probe — the accusation stands either way", () => {
    const free = kickPriorityMissedEvents([point], owner, {
      lookup: () => ref,
      ownerBusyWith: () => "",
    });
    expect(free).toHaveLength(1);
    expect("youChannelling" in free[0]!.facts).toBe(false);
    const none = kickPriorityMissedEvents([point], owner, {
      lookup: () => ref,
    });
    expect(none).toHaveLength(1);
    expect("youChannelling" in none[0]!.facts).toBe(false);
  });
});

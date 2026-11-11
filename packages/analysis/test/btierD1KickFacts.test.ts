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
  kickMissTag,
  missedKickText,
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

describe("kickAudit: the miss line the log wrote for the kick (FT-T11)", () => {
  const missEvent = (
    spellId: string,
    atS: number,
    dest: [string, string],
    missType: string,
  ): any => ({
    spellId,
    spellName: spellId,
    timestamp: T0 + atS * 1000,
    srcUnitId: "p1",
    srcUnitName: "Knight",
    destUnitId: dest[0],
    destUnitName: dest[1],
    missType,
    amount: 0,
    logLine: { event: LogEvent.SPELL_MISSED, timestamp: T0 + atS * 1000 },
  });
  const kickerWith = (kickS: number, misses: any[]) => {
    const k = kicker(kickS);
    (k as any).missesOut = misses;
    return k;
  };
  const label = (name: string) => `<${name}>`;

  it("被反射的打断:事实挂在条目上,判定不变;文案 [REFLECTED by X]", () => {
    // no cast was open: the kick "hit nothing" — and the log says why
    const enemy = priest(10, 20);
    const [k] = analyzeKickAudit(
      kickerWith(30, [missEvent(MIND_FREEZE, 30, ["e1", "Priest"], "REFLECT")]),
      [enemy],
      combat,
    );
    expect(k!.result).toBe("missed");
    expect(k!.kickMiss).toEqual({
      missType: "REFLECT",
      targetId: "e1",
      targetName: "Priest",
    });
    expect(kickMissTag(k!, label)).toBe(" [REFLECTED by <Priest>]");
  });

  it("免疫 / 未命中各有各的词;吸收不算打断的落空;超出配对窗口的不算", () => {
    const run = (misses: any[]) =>
      analyzeKickAudit(kickerWith(30, misses), [priest(10, 20)], combat)[0]!;
    expect(
      kickMissTag(
        run([missEvent(MIND_FREEZE, 30.004, ["e1", "Priest"], "IMMUNE")]),
        label,
      ),
    ).toBe(" [IMMUNE: <Priest>]");
    expect(
      kickMissTag(
        run([missEvent(MIND_FREEZE, 30, ["e1", "Priest"], "MISS")]),
        label,
      ),
    ).toBe(" [MISSED on <Priest>]");
    expect(
      run([missEvent(MIND_FREEZE, 30, ["e1", "Priest"], "ABSORB")]).kickMiss,
    ).toBeUndefined();
    // fact12 D3 (pipeline T11): the cast lines' window (`missBelongsToCast`)
    // — an IMMUNE 200 ms after the kick is its own, 3 s after it is not
    expect(
      run([missEvent(MIND_FREEZE, 30.2, ["e1", "Priest"], "IMMUNE")]).kickMiss
        ?.missType,
    ).toBe("IMMUNE");
    expect(
      run([missEvent(MIND_FREEZE, 33, ["e1", "Priest"], "IMMUNE")]).kickMiss,
    ).toBeUndefined();
    // another spell's miss in the same ms is not the kick's
    expect(
      run([missEvent("49998", 30, ["e1", "Priest"], "IMMUNE")]).kickMiss,
    ).toBeUndefined();
  });

  it("codex 40-FT-38 P2: 瞄准的目标免疫、沉默落在另一个人身上 —— silenced 的条目也带着那条免疫", () => {
    const SILENCE = "31935";
    const silencer = makeUnit("p1", {
      name: "Knight",
      info,
      spellCastEvents: [
        makeSpellCastEvent(
          SILENCE,
          T0 + 30_000,
          "e1",
          "Priest",
          "p1",
          "Knight",
        ),
      ],
    } as any);
    (silencer as any).missesOut = [
      missEvent(SILENCE, 30, ["e1", "Priest"], "IMMUNE"),
    ];
    const other = makeUnit("e2", {
      name: "Mage",
      info,
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          SILENCE,
          T0 + 30_050,
          "p1",
          "e2",
          "DEBUFF",
        ),
      ],
    } as any);
    const [k] = analyzeKickAudit(silencer, [priest(10, 20), other], combat);
    expect(k!.result).toBe("silenced");
    expect(k!.silencedTargetName).toBe("Mage");
    expect(k!.kickMiss).toEqual({
      missType: "IMMUNE",
      targetId: "e1",
      targetName: "Priest",
    });
  });

  it("T52: 目标读条还在走时被拒绝(免疫)的打断 —— 不是「hit nothing」,只留落空标签", () => {
    // bd7f386f 0:43: Polymorph begun 42.58, Mind Freeze 43.39 logged IMMUNE,
    // the Polymorph off at 43.74
    const POLYMORPH = "118";
    const mage = () =>
      priest(10, 20, {
        castStartEvents: [castStart(POLYMORPH, 42.58)],
      }) as any;
    const withCast = (offS: number | null) => {
      const u = mage();
      if (offS !== null)
        u.spellCastEvents.push(
          makeSpellCastEvent(
            POLYMORPH,
            T0 + offS * 1000,
            "p9",
            "Healer",
            "e1",
            "Priest",
            0,
            "Polymorph",
          ),
        );
      return u;
    };
    const immune = [missEvent(MIND_FREEZE, 43.392, ["e1", "Priest"], "IMMUNE")];
    const [k] = analyzeKickAudit(
      kickerWith(43.391, immune),
      [withCast(43.744)],
      combat,
    );
    expect(k!.result).toBe("missed");
    expect(k!.refusedAtCastSpellName).toBe("Polymorph");
    expect(missedKickText(k!)).toBe("");
    expect(
      formatBurstLedgerForContext([], [], [k!], (n) => n).find((l) =>
        l.includes("Kicks:"),
      ),
    ).toBe("  Kicks: 0:43 Mind Freeze → [IMMUNE: Priest]");
    // no miss row: the log does not say the kick was refused
    const [bare] = analyzeKickAudit(kicker(43.391), [withCast(43.744)], combat);
    expect(bare!.result).toBe("missed");
    expect(bare!.refusedAtCastSpellName).toBeUndefined();
    expect(missedKickText(bare!)).toBe("hit nothing");
    // the bar had gone off before the kick: nothing was running
    const [late] = analyzeKickAudit(
      kickerWith(44.5, [
        missEvent(MIND_FREEZE, 44.5, ["e1", "Priest"], "IMMUNE"),
      ]),
      [withCast(43.744)],
      combat,
    );
    expect(late!.refusedAtCastSpellName).toBeUndefined();
    expect(
      formatBurstLedgerForContext([], [], [late!], (n) => n).find((l) =>
        l.includes("Kicks:"),
      ),
    ).toBe("  Kicks: 0:44 Mind Freeze → hit nothing [IMMUNE: Priest]");
    // the bar never went off: the audit's juke reading, as before
    const [juked] = analyzeKickAudit(
      kickerWith(43.391, immune),
      [withCast(null)],
      combat,
    );
    expect(juked!.result).toBe("juked");
    expect(juked!.refusedAtCastSpellName).toBeUndefined();
  });

  describe("T52 review (codex 85-tk-F-T52-1)", () => {
    const POLYMORPH = "118";
    const FROSTBOLT = "116";
    const off = (spellId: string, s: number) =>
      makeSpellCastEvent(
        spellId,
        T0 + s * 1000,
        "p9",
        "Healer",
        "e1",
        "Priest",
      );
    const mage = (extra: Record<string, any>, casts: any[] = []) => {
      const u = priest(10, 20, extra) as any;
      u.spellCastEvents.push(...casts);
      return u;
    };
    const immuneAt = (s: number, lineIndex?: number) => {
      const m = missEvent(MIND_FREEZE, s, ["e1", "Priest"], "IMMUNE");
      if (lineIndex !== undefined) m.logLine.lineIndex = lineIndex;
      return m;
    };

    it("#3: a bar somebody interrupted after the refusal was running at it", () => {
      const [k] = analyzeKickAudit(
        kickerWith(43.391, [immuneAt(43.392)]),
        [
          mage({
            castStartEvents: [castStart(POLYMORPH, 42.581)],
            actionIn: [
              makeInterruptEvent(
                "57994",
                "Wind Shear",
                POLYMORPH,
                "Polymorph",
                T0 + 43_600,
                "p2",
                "Mate",
              ),
            ],
          }),
        ],
        combat,
      );
      expect(k!.result).toBe("missed");
      expect(k!.refusedAtCastSpellName).toBe("Polymorph");
    });

    it("#4: an interrupt before a bar that was running at the kick is not why it missed", () => {
      const [k] = analyzeKickAudit(
        kickerWith(43.391, [immuneAt(43.392)]),
        [
          mage(
            {
              castStartEvents: [
                castStart(FROSTBOLT, 42.5),
                castStart(POLYMORPH, 43.2),
              ],
              actionIn: [
                makeInterruptEvent(
                  "57994",
                  "Wind Shear",
                  FROSTBOLT,
                  "Frostbolt",
                  T0 + 43_000,
                  "p2",
                  "Mate",
                ),
              ],
            },
            [off(POLYMORPH, 44.5)],
          ),
        ],
        combat,
      );
      expect(k!.refusedAtCastSpellName).toBe("Polymorph");
      expect(k!.beatenBy).toBeUndefined();
    });

    it("#5: a START of the miss row's millisecond counts only when logged before it", () => {
      const startAt = (lineIndex: number) => {
        const s = castStart(POLYMORPH, 43.392);
        s.logLine.lineIndex = lineIndex;
        return s;
      };
      const run = (startLine: number) =>
        analyzeKickAudit(
          kickerWith(43.391, [immuneAt(43.392, 102)]),
          [
            mage({ castStartEvents: [startAt(startLine)] }, [
              off(POLYMORPH, 44),
            ]),
          ],
          combat,
        )[0]!;
      expect(run(103).refusedAtCastSpellName).toBeUndefined();
      expect(run(101).refusedAtCastSpellName).toBe("Polymorph");
    });

    it("#2: a kick with no target is bound to the unit its miss row names", () => {
      const beam = makeUnit("p1", {
        name: "Knight",
        info,
        spellCastEvents: [
          makeSpellCastEvent(
            MIND_FREEZE,
            T0 + 43_391,
            "",
            "",
            "p1",
            "Knight",
            0,
            "Mind Freeze",
          ),
        ],
      } as any);
      (beam as any).spellCastEvents[0].destUnitId = undefined;
      (beam as any).missesOut = [immuneAt(43.392)];
      // the miss names e1, whose last bar ended long before; e2 has one up
      const idle = mage({ castStartEvents: [castStart(POLYMORPH, 40)] }, [
        off(POLYMORPH, 41),
      ]);
      const other = makeUnit("e2", {
        name: "Mage",
        info,
        castStartEvents: [
          (() => {
            const e = makeSpellCastEvent(
              POLYMORPH,
              T0 + 42_581,
              "e2",
              "e2",
              "e2",
              "e2",
            );
            e.logLine.event = LogEvent.SPELL_CAST_START;
            return e;
          })(),
        ],
        spellCastEvents: [
          makeSpellCastEvent(
            POLYMORPH,
            T0 + 43_744,
            "p9",
            "Healer",
            "e2",
            "Mage",
          ),
        ],
      } as any);
      const [k] = analyzeKickAudit(beam, [idle, other], combat);
      expect(k!.kickMiss?.targetId).toBe("e1");
      expect(k!.refusedAtCastSpellName).toBeUndefined();
    });
  });

  it("没有落空行 → 没有这个事实;juke 的判定带着落空事实一起留着", () => {
    const [plain] = analyzeKickAudit(kicker(30), [priest(10, 20)], combat);
    expect(plain!.kickMiss).toBeUndefined();
    expect(kickMissTag(plain!, label)).toBe("");
    // a channel the target stopped 0.1 s before the kick, and the kick itself IMMUNE
    const [juked] = analyzeKickAudit(
      kickerWith(44.751, [
        missEvent(MIND_FREEZE, 44.751, ["e1", "Priest"], "IMMUNE"),
      ]),
      [priest(44.01, 44.648)],
      combat,
    );
    expect(juked!.result).toBe("juked");
    expect(juked!.kickMiss?.missType).toBe("IMMUNE");
  });
});

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
    // official 5 s (DB2; the hand 8 s left with fact4 D30): 2.4 s is a
    // stop, 2.6 s may be a hasted natural end
    const at = (toS: number) =>
      analyzeKickAudit(kicker(toS + 0.1), [priest(40, toS)], combat)[0]!;
    expect(at(42.4).result).toBe("juked");
    expect(at(42.6).result).toBe("missed");
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

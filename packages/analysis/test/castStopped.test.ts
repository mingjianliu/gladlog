/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src";
import {
  ccUseSummary,
  formatCcUseCount,
  ownerControlCastBars,
} from "../src/context/ccUse";
import {
  buildMatchTimeline,
  type BuildMatchTimelineParams,
} from "../src/context/matchTimeline";
import {
  CAST_REFUSED_OTHER_REASON,
  CAST_STOPPED_LEGEND,
  CAST_STOPPED_NEAR_TEXT,
  CAST_STOPPED_TAG,
  castStoppedText,
} from "../src/context/timelineSections/castStopped";
import {
  ownerCastBarOutcomes,
  ownerCastCancels,
} from "../src/utils/castCancels";
import { PRESS_HP_LINE_TAGS } from "../src/utils/cooldowns";
import type { RawStreams } from "../src/utils/rawStreams";
import {
  makeAuraEvent,
  makeInterruptEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

// FT-T16 D15 "2b" (user approval 2026-10-10): one `[CAST STOPPED]` line per
// control cast bar the log owner began that did not go off and was not
// kicked — every wording form, and every "no line" case.

const T0 = 1_000_000;
const at = (s: number) => T0 + s * 1000;
const CYCLONE = "33786";
const WRATH = "190984"; // a cast time, not a control
const barStart = (spellId: string, s: number, name: string) => ({
  ...makeSpellCastEvent(spellId, at(s), "e1", "Rogue", "p1", "Owner", 0, name),
  logLine: {
    event: LogEvent.SPELL_CAST_START,
    timestamp: at(s),
    parameters: [],
  },
});
const wentOff = (spellId: string, s: number, name: string) =>
  makeSpellCastEvent(spellId, at(s), "e1", "Rogue", "p1", "Owner", 0, name);
const fail = (spellId: string, s: number, reason: string, unit = "p1") => ({
  tSeconds: s,
  unitGuid: unit,
  spellId: Number(spellId),
  spellName: spellId,
  reason,
});

// The owner's Cyclone bars, by the second they began:
//    0  SUCCESS 1.5                                   → went off
//   10  "Interrupted" 10.5, nothing on the owner      → stopped
//   20  "Interrupted" 20.4, a stun on the owner 20.3  → stopped, a control
//   30  "Interrupted" 30.3, Typhoon's daze 30.3       → stopped, a knockback
//   40  SPELL_INTERRUPT 40.8 (+ its "Interrupted")    → kicked
//   50  "Your vision of the target is obscured" 50.9  → refused, Smoke Bomb
//   60  "Not yet recovered" 60.3, SUCCESS 61.5        → went off (key spam)
//   70  "Another action is in progress" 70.02,
//       "Interrupted" 70.6                            → stopped (key spam)
//   80  Wrath begins 81.0, Cyclone SUCCESS 81.05      → went off, queued
//   90  no row at all, next bar at 100                → none
//  100  "Another action is in progress" 100.02,
//       "Invalid target" 101.2                        → refused, other reason
//  110  "超出范围" 110.5 (a zh client's text)           → refused, out of range
//  112  "Out of range" 113.0 (+ the rows of `rejects`) → refused
//  118  no row; the round ends at 120                 → the round ended
// and two Wrath bars: 5 ("Interrupted" 5.3) and 81 (SUCCESS 82.5).
const CYCLONE_BARS = [
  0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 112, 118,
];
function fixture(rejects: number[] = [113.0]) {
  const owner = makeUnit("p1", {
    name: "Owner",
    spec: CombatUnitSpec.Druid_Balance,
    class: CombatUnitClass.Druid,
    reaction: CombatUnitReaction.Friendly,
    info: {} as never,
    castStartEvents: [
      ...CYCLONE_BARS.map((s) => barStart(CYCLONE, s, "Cyclone")),
      barStart(WRATH, 5, "Wrath"),
      barStart(WRATH, 81, "Wrath"),
    ],
    spellCastEvents: [
      wentOff(CYCLONE, 1.5, "Cyclone"),
      wentOff(CYCLONE, 61.5, "Cyclone"),
      wentOff(CYCLONE, 81.05, "Cyclone"),
      wentOff(WRATH, 82.5, "Wrath"),
    ],
    actionIn: [
      makeInterruptEvent("1766", "Kick", CYCLONE, "Cyclone", at(40.8), "e1"),
    ],
    auraEvents: [
      makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "853", at(20.3), "e1", "p1"),
      makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "61391", at(30.3), "e1", "p1"),
    ],
  });
  const rogue = makeUnit("e1", {
    name: "Rogue",
    spec: CombatUnitSpec.Rogue_Assassination,
    reaction: CombatUnitReaction.Hostile,
    info: {} as never,
  });
  const combat: any = {
    startTime: T0,
    endTime: at(120),
    startInfo: { zoneId: "" },
    units: { p1: owner, e1: rogue },
  };
  const rawStreams: RawStreams = {
    available: true,
    manaSamples: [],
    castFailed: [
      fail(WRATH, 5.3, "Interrupted"),
      fail(CYCLONE, 10.5, "Interrupted"),
      fail(CYCLONE, 20.4, "Interrupted"),
      fail(CYCLONE, 30.3, "Interrupted"),
      fail(CYCLONE, 40.8, "Interrupted"),
      fail(CYCLONE, 50.9, "Your vision of the target is obscured"),
      fail(CYCLONE, 60.3, "Not yet recovered"),
      fail(CYCLONE, 70.02, "Another action is in progress"),
      fail(CYCLONE, 70.6, "Interrupted"),
      fail(CYCLONE, 100.02, "Another action is in progress"),
      fail(CYCLONE, 101.2, "Invalid target"),
      fail(CYCLONE, 110.5, "超出范围"),
      ...rejects.map((s) => fail(CYCLONE, s, "Out of range")),
    ],
  };
  return { owner, rogue, combat, rawStreams };
}

function timelineParams(
  f: ReturnType<typeof fixture>,
  // null = the round has no raw streams at all
  streams: RawStreams | null = f.rawStreams,
): BuildMatchTimelineParams {
  return {
    owner: f.owner,
    ownerSpec: "Druid_Balance",
    ownerCDs: [],
    teammateCDs: [],
    enemyCDTimeline: { players: [], alignedBurstWindows: [] },
    ccTrinketSummaries: [],
    dispelSummary: {
      allyCleanse: [],
      ourPurges: [],
      hostilePurges: [],
      missedCleanseWindows: [],
      lateCleanseWindows: [],
      ccEfficiency: [],
      missedPurgeWindows: [],
    },
    friendlyDeaths: [],
    enemyDeaths: [],
    pressureWindows: [],
    healingGaps: [],
    friends: [f.owner],
    enemies: [f.rogue],
    allUnits: [f.owner, f.rogue],
    matchStartMs: f.combat.startTime,
    matchEndMs: f.combat.endTime,
    isHealer: false,
    criticalWindowSeconds: new Set<number>(),
    rawStreams: streams ?? undefined,
    ownerControlCastBars: ownerControlCastBars(f.owner, f.combat),
  };
}
function timelineOf(
  f: ReturnType<typeof fixture>,
  streams: RawStreams | null = f.rawStreams,
): string[] {
  return buildMatchTimeline(timelineParams(f, streams)).split("\n");
}
const stoppedLines = (lines: string[]) =>
  lines.filter((l) => /^\d+:\d{2}\s+\[CAST STOPPED\]/.test(l));

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("ownerCastBarOutcomes — how each cast bar ended", () => {
  const f = fixture();
  const outcomes = ownerCastBarOutcomes({
    owner: f.owner,
    startMs: T0,
    rawStreams: f.rawStreams,
  })!;
  const of = (spellId: string, s: number) =>
    outcomes.find((o) => o.id === spellId && o.t === s)!;

  it("reads every ending the log can show", () => {
    expect(of(CYCLONE, 0).end).toEqual({ kind: "completed", atS: 1.5 });
    expect(of(CYCLONE, 10).end).toEqual({
      kind: "stopped",
      atS: 10.5,
      near: null,
    });
    expect(of(CYCLONE, 20).end).toMatchObject({ kind: "stopped", near: "cc" });
    expect(of(CYCLONE, 30).end).toMatchObject({
      kind: "stopped",
      near: "displaced",
    });
    // a kick writes its own "Interrupted" row: the SPELL_INTERRUPT decides
    expect(of(CYCLONE, 40).end).toEqual({ kind: "kicked", atS: 40.8 });
    expect(of(CYCLONE, 50).end).toMatchObject({ kind: "refused", atS: 50.9 });
    expect(of(CYCLONE, 90).end).toEqual({ kind: "none" });
    expect(of(CYCLONE, 100).end).toMatchObject({ kind: "refused" });
    expect(of(CYCLONE, 118).end).toEqual({ kind: "none" });
  });

  it("a key pressed again inside the bar is not the bar's end", () => {
    // "Not yet recovered" 0.3 s in, and the cast went off anyway
    expect(of(CYCLONE, 60)).toMatchObject({
      end: { kind: "completed", atS: 61.5 },
      earlierFailure: true,
    });
    // … or was stopped 0.6 s in: the stop is the end, not the refused press
    expect(of(CYCLONE, 70)).toMatchObject({
      end: { kind: "stopped", atS: 70.6, near: null },
      earlierFailure: true,
    });
    expect(of(CYCLONE, 10).earlierFailure).toBe(false);
  });

  it("a press refused while a bar was running is not what refused the bar", () => {
    // "Another action is in progress" 20 ms into the bar of 100 s: this log
    // shows that reason on a press before a bar's interruption row (70 s),
    // so the row that refused the bar is the "Invalid target" 1.2 s in
    expect(of(CYCLONE, 100)).toMatchObject({
      end: { kind: "refused", atS: 101.2 },
      earlierFailure: true,
    });
    // a log that never shows the reason on a running bar has only the rows'
    // order to go by: the first refusal is read as the bar's
    const alone = ownerCastBarOutcomes({
      owner: f.owner,
      startMs: T0,
      rawStreams: {
        ...f.rawStreams,
        castFailed: f.rawStreams.castFailed.filter((r) => r.tSeconds !== 70.02),
      },
    })!.find((o) => o.id === CYCLONE && o.t === 100)!;
    expect(alone.end).toMatchObject({ kind: "refused", atS: 100.02 });
  });

  it("a completion logged just after the next bar began is a completion, not a missing end", () => {
    const o = of(CYCLONE, 80);
    expect(o.end).toMatchObject({ kind: "completed", queued: true });
  });

  it("is null for a unit that did not record the log", () => {
    expect(
      ownerCastBarOutcomes({
        owner: f.owner,
        startMs: T0,
        rawStreams: { ...f.rawStreams, castFailed: [] },
      }),
    ).toBeNull();
    expect(ownerCastBarOutcomes({ owner: f.owner, startMs: T0 })).toBeNull();
  });

  it("ownerCastCancels reads the same outcomes, every stopped bar", () => {
    const r = ownerCastCancels({
      owner: f.owner,
      friends: [f.owner],
      enemies: [f.rogue],
      combat: f.combat,
      rawStreams: f.rawStreams,
    })!;
    expect(r.hardcasts).toBe(outcomes.length);
    // a cancel = a `stopped` bar with nothing landing on the owner, and
    // nothing else: the bar with a refused press before its stop (70 s,
    // `earlierFailure`) is one — until 2026-10-11 the ledger left it out
    expect(r.cancels.map((c) => c.startS)).toEqual(
      outcomes
        .filter((o) => o.end.kind === "stopped" && o.end.near === null)
        .map((o) => o.t),
    );
    expect(r.cancels.map((c) => c.startS)).toEqual([5, 10, 70]);
    // the median completed bar takes every completed bar: the plain one
    // (0 s → 1.5 s), the one with a refused press before its SUCCESS (60 s →
    // 1.5 s) and the queued completion (80 s → 1.05 s). Median 1.5 s, so the
    // 0.5 s / 0.6 s stops read 33 % / 40 %.
    expect(
      r.cancels.filter((c) => c.spellId === CYCLONE).map((c) => c.progressPct),
    ).toEqual([33, 40]);
  });

  it("the median completed bar counts a queued completion and a bar with a refused press", () => {
    // without the plain bar of 0 s the only completed Cyclone bars are the
    // two the ledger used to skip; it still has a median to measure against
    const g = fixture();
    g.owner.castStartEvents = (g.owner.castStartEvents ?? []).filter(
      (e) => e.logLine.timestamp !== T0,
    );
    const r = ownerCastCancels({
      owner: g.owner,
      friends: [g.owner],
      enemies: [g.rogue],
      combat: g.combat,
      rawStreams: g.rawStreams,
    })!;
    // bars of 60 s (1.5 s) and 80 s (1.05 s): the median of two is their
    // mean, 1.275 s (work order 2026-10-14c #3 — it read the upper one, 1.5)
    expect(
      r.cancels.filter((c) => c.spellId === CYCLONE).map((c) => c.progressPct),
    ).toEqual([39, 47]);
  });
});

describe("castStoppedText — the wording of each ending", () => {
  const f = fixture();
  const outcomes = ownerCastBarOutcomes({
    owner: f.owner,
    startMs: T0,
    rawStreams: f.rawStreams,
  })!;
  const text = (s: number, stated: ReadonlySet<any> = new Set()) => {
    const i = outcomes.findIndex((o) => o.id === CYCLONE && o.t === s);
    return castStoppedText(outcomes[i]!, 120, outcomes[i + 1]?.t, stated);
  };

  it("a stopped bar says how far in, and what landed on the owner then", () => {
    expect(text(10)).toBe(
      "cast bar stopped after 0.5s; not kicked; no control, silence or knockback landed on you then",
    );
    expect(text(20)).toBe(
      "cast bar stopped after 0.4s as a control or silence landed on you",
    );
    expect(text(30)).toBe(
      "cast bar stopped after 0.3s as an enemy knockback or pull landed on you",
    );
    expect(text(70)).toBe(
      `cast bar stopped after 0.6s${CAST_STOPPED_NEAR_TEXT.none}`,
    );
    // never a claim the log cannot make
    for (const s of [10, 20, 30, 70])
      expect(text(s)).not.toMatch(/cancel|moved|fake|juke/i);
  });

  it("a refused bar words the four known reasons in any client language, and quotes no other", () => {
    expect(text(50)).toBe("refused 0.9s in: vision obscured (Smoke Bomb)");
    expect(text(110)).toBe("refused 0.5s in: out of range");
    expect(text(112)).toBe("refused 1.0s in: out of range");
    expect(text(100)).toBe(`refused 1.2s in ${CAST_REFUSED_OTHER_REASON}`);
    expect(text(100)).not.toContain("Invalid target");
  });

  it("no text for a bar that went off, was kicked, or has no end row", () => {
    for (const s of [0, 40, 60, 80, 90]) expect(text(s)).toBeNull();
  });

  it("a bar the round ended on says so instead of how it ended", () => {
    expect(text(118)).toBe(
      "no end logged; the round ended 2.0s after it began",
    );
    // an end row past the round's end is not this round's: same form
    const i = outcomes.findIndex((o) => o.id === CYCLONE && o.t === 0);
    expect(
      castStoppedText(outcomes[i]!, 1.2, outcomes[i + 1]?.t, new Set()),
    ).toBe("no end logged; the round ended 1.2s after it began");
    // … but not when the owner's next bar began inside the round
    const j = outcomes.findIndex((o) => o.id === CYCLONE && o.t === 80);
    expect(
      castStoppedText(outcomes[j]!, 81.02, outcomes[j + 1]?.t, new Set()),
    ).toBeNull();
  });

  // FT I11 (b): a stop the player did not choose is not worded as one.
  it("a bar the owner's own death ended has no line — the [DEATH] line states it", () => {
    const g = fixture();
    (g.owner as any).deathRecords = [{ timestamp: at(10.52) }];
    const o = ownerCastBarOutcomes({
      owner: g.owner,
      startMs: T0,
      rawStreams: g.rawStreams,
    })!;
    const i = o.findIndex((b) => b.id === CYCLONE && b.t === 10);
    expect(o[i]!.end).toMatchObject({ kind: "stopped", near: "death" });
    expect(castStoppedText(o[i]!, 120, o[i + 1]?.t, new Set())).toBeNull();
    // the ledger does not count it, the line does not say it: one reading
    const led = ownerCastCancels({
      owner: g.owner,
      friends: [g.owner],
      enemies: [g.rogue],
      combat: g.combat,
      rawStreams: g.rawStreams,
    })!;
    expect(led.cancels.map((c) => c.startS)).toEqual([5, 70]);
    expect(
      stoppedLines(timelineOf(g)).filter((l) => l.startsWith("0:10")),
    ).toEqual([]);
  });

  it("a stop at or after the round's end is the round ending, and a bar begun after it has no line", () => {
    const i = outcomes.findIndex((o) => o.id === CYCLONE && o.t === 10);
    // the stop row is at 10.5 s: a round that ended at 10.5 s ended first
    expect(castStoppedText(outcomes[i]!, 10.5, outcomes[i + 1]?.t, new Set())).toBe(
      "no end logged; the round ended 0.5s after it began",
    );
    expect(castStoppedText(outcomes[i]!, 10.51, outcomes[i + 1]?.t, new Set())).toBe(
      `cast bar stopped after 0.5s${CAST_STOPPED_NEAR_TEXT.none}`,
    );
    // begun at or after the round's end: not the round's bar
    expect(castStoppedText(outcomes[i]!, 10, outcomes[i + 1]?.t, new Set())).toBeNull();
    expect(castStoppedText(outcomes[i]!, 9.2, outcomes[i + 1]?.t, new Set())).toBeNull();
  });

  it("a Solo Shuffle round's lines and cancels end at its first death, not at the log's end", () => {
    const g = fixture();
    g.combat.startInfo = { zoneId: "", bracket: "Rated Solo Shuffle" };
    // the rogue dies at 70.3 s: the Cyclone of 70 s is stopped at 70.6 s,
    // after the round; every later bar was begun after it
    (g.rogue as any).deathRecords = [{ timestamp: at(70.3) }];
    const lines = stoppedLines(
      buildMatchTimeline({
        ...timelineParams(g),
        bracket: "Rated Solo Shuffle",
      }).split("\n"),
    );
    expect(lines.filter((l) => /^1:\d\d/.test(l))).toEqual([
      "1:10  [CAST STOPPED]   Cyclone — no end logged; the round ended 0.3s after it began",
    ]);
    const led = ownerCastCancels({
      owner: g.owner,
      friends: [g.owner],
      enemies: [g.rogue],
      combat: g.combat,
      rawStreams: g.rawStreams,
    })!;
    expect(led.cancels.map((c) => c.startS)).toEqual([5, 10]);
  });

  it("a refusal a [REJECTED] line states is not said again", () => {
    const row = f.rawStreams.castFailed.find((r) => r.tSeconds === 113.0)!;
    expect(text(112, new Set([row]))).toBeNull();
    // only that row: another bar's refusal still has its text
    expect(text(110, new Set([row]))).toBe("refused 0.5s in: out of range");
  });
});

describe("[CAST STOPPED] on the timeline", () => {
  it("prints one line per control bar that did not go off and was not kicked", () => {
    const lines = timelineOf(fixture());
    expect(stoppedLines(lines)).toEqual([
      "0:10  [CAST STOPPED]   Cyclone — cast bar stopped after 0.5s; not kicked; no control, silence or knockback landed on you then",
      "0:20  [CAST STOPPED]   Cyclone — cast bar stopped after 0.4s as a control or silence landed on you",
      "0:30  [CAST STOPPED]   Cyclone — cast bar stopped after 0.3s as an enemy knockback or pull landed on you",
      "0:50  [CAST STOPPED]   Cyclone — refused 0.9s in: vision obscured (Smoke Bomb)",
      "1:10  [CAST STOPPED]   Cyclone — cast bar stopped after 0.6s; not kicked; no control, silence or knockback landed on you then",
      "1:40  [CAST STOPPED]   Cyclone — refused 1.2s in (client reason not translated)",
      "1:50  [CAST STOPPED]   Cyclone — refused 0.5s in: out of range",
      "1:52  [CAST STOPPED]   Cyclone — refused 1.0s in: out of range",
      "1:58  [CAST STOPPED]   Cyclone — no end logged; the round ended 2.0s after it began",
    ]);
    // the kicked bar has its [KICK] line and no [CAST STOPPED]
    expect(lines.some((l) => /^0:40\s+\[KICK\]/.test(l))).toBe(true);
    // a cast bar of a spell that is no control (Wrath, stopped at 0:05)
    expect(lines.some((l) => l.includes("Wrath —"))).toBe(false);
    // the legend, once
    expect(lines.filter((l) => l === CAST_STOPPED_LEGEND[0])).toHaveLength(1);
  });

  it("carries no HP and is not a press line", () => {
    for (const l of stoppedLines(timelineOf(fixture()))) {
      expect(l).not.toMatch(/\d+% HP|\(self:/);
      expect(PRESS_HP_LINE_TAGS.some((tag) => l.includes(tag))).toBe(false);
    }
    expect(PRESS_HP_LINE_TAGS).not.toContain(CAST_STOPPED_TAG);
  });

  it("says nothing of a refusal the [REJECTED] line of that run states", () => {
    // three "Out of range" presses of Cyclone from 113.0: a [REJECTED] run
    const lines = timelineOf(fixture([113.0, 113.3, 113.6]));
    expect(
      lines.filter((l) => l.includes("[REJECTED]")).map((l) => l.trim()),
    ).toEqual(["1:53  [REJECTED]   your Cyclone ×3 — out of range"]);
    expect(stoppedLines(lines).some((l) => l.startsWith("1:52"))).toBe(false);
    // the other eight lines are untouched
    expect(stoppedLines(lines)).toHaveLength(8);
  });

  it("names the spell as its CC USE entry does, and never more bars than the entry leaves", () => {
    const f = fixture();
    const bars = ownerControlCastBars(f.owner, f.combat);
    expect(bars.map((b) => [b.entryName, b.t])).toEqual(
      CYCLONE_BARS.map((s) => ["Cyclone", s]),
    );
    const summary = ccUseSummary({
      combat: f.combat,
      owner: f.owner,
      friends: [f.owner],
      enemies: [f.rogue],
      enemyCC: [],
      burstLedger: [],
      pressureWindows: [],
    });
    const entry = summary.counts.find((c) => c.spellName === "Cyclone")!;
    expect(formatCcUseCount(entry)).toBe(
      "Cyclone cast bar started 14×, went off 3× (first 0:01)",
    );
    // 14 begun − 3 went off − 1 kicked − 1 with no end row = 9 lines
    expect(stoppedLines(timelineOf(f))).toHaveLength(9);
  });

  it("no line, and no legend, for an owner who did not record the log", () => {
    const f = fixture();
    for (const streams of [
      null,
      { ...f.rawStreams, castFailed: [] },
      {
        ...f.rawStreams,
        // every row is another player's
        castFailed: f.rawStreams.castFailed.map((r) => ({
          ...r,
          unitGuid: "p2",
        })),
      },
    ]) {
      const lines = timelineOf(f, streams);
      expect(lines.some((l) => l.includes(CAST_STOPPED_TAG))).toBe(false);
    }
  });
});

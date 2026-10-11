/**
 * User ruling 2026-10-11: a buff that was still up when the round ended gets
 * NO line — neither the `expired` / `ended early` / bare end a Solo Shuffle
 * log's post-round strip used to print (126 `[BUFF FADED]` lines of the
 * 605-file capture of 8c3275fa) nor the `(still up when the round ended)`
 * label PV373 put in its place (1,132 `[BUFF FADED]` and 350
 * `[ENEMY BUFF END]` lines of the capture of ae42aa6f). A `[BUFF FADED]` /
 * `[ENEMY BUFF END]` line exists only for a buff that ended inside the round;
 * an `[ENEMY BUFF]` start line with no end line is a buff that did not.
 */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { buildMatchTimeline } from "../src/context/matchTimeline";
import {
  extractEnemyMajorBuffIntervals,
  extractOwnerCDBuffExpiry,
} from "../src/context/timelineHelpers";
import { emitBuffFadedEntries } from "../src/context/timelineSections/buffFaded";
import { emitEnemyBuffEntries } from "../src/context/timelineSections/enemyBuff";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  ROUND_ENDED_WORDS,
  roundEndLegend,
  roundEndMs,
  SOLO_SHUFFLE_BRACKET,
} from "../src/utils/roundEnd";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_700_000_000_000;
const at = (s: number) => T0 + Math.round(s * 1000);
/** The round-ending death, and the end of the log 2 s later. */
const DEATH_S = 105;
const LOG_END_S = 107;
/** A Solo Shuffle log strips every aura a second or two after the death. */
const STRIP_S = 106.4;

const AS = "108271"; // Astral Shift, 12 s
const PI = "10060"; // Power Infusion — ENEMY_MAJOR_BUFF_SPELL_IDS

beforeAll(async () => {
  await ensureAnalysisData();
});

/** The teammate whose death ends the Solo Shuffle round (`roundEndMs`). */
const victim = () =>
  makeUnit("player-2", {
    name: "Mate",
    class: CombatUnitClass.Warrior,
    spec: CombatUnitSpec.Warrior_Arms,
    info: {},
    deathRecords: [{ timestamp: at(DEATH_S) }],
  });

/** The owner with one Astral Shift pressed at `castS`, removed at `removedS`
 * (null = the log has no REMOVED for it). */
const shaman = (castS: number, removedS: number | null) =>
  makeUnit("player-1", {
    name: "You",
    class: CombatUnitClass.Shaman,
    spec: CombatUnitSpec.Shaman_Restoration,
    info: {},
    spellCastEvents: [makeSpellCastEvent(AS, at(castS), "player-1")],
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        AS,
        at(castS),
        "player-1",
        "player-1",
        "BUFF",
      ),
      ...(removedS === null
        ? []
        : [
            makeAuraEvent(
              LogEvent.SPELL_AURA_REMOVED,
              AS,
              at(removedS),
              "player-1",
              "player-1",
              "BUFF",
            ),
          ]),
    ],
  });

const shift = (castS: number) => [
  {
    spellId: AS,
    spellName: "Astral Shift",
    tag: "Defensive",
    casts: [{ timeSeconds: castS }],
    cooldownSeconds: 120,
    neverUsed: false,
    availableWindows: [],
  },
];

/** An enemy holding Power Infusion from `fromS` to `toS` (null = no REMOVED). */
const infused = (id: string, fromS: number, toS: number | null) =>
  makeUnit(id, {
    name: id,
    class: CombatUnitClass.Mage,
    spec: CombatUnitSpec.Mage_Frost,
    reaction: CombatUnitReaction.Hostile,
    info: {},
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        PI,
        at(fromS),
        "enemy-priest",
        id,
        "BUFF",
      ),
      ...(toS === null
        ? []
        : [
            makeAuraEvent(
              LogEvent.SPELL_AURA_REMOVED,
              PI,
              at(toS),
              "enemy-priest",
              id,
              "BUFF",
            ),
          ]),
    ],
  });

/** The round's end as the timeline derives it (`prepareTimelineSetup`). */
const roundEndOf = (bracket: string, players: ICombatUnit[]) =>
  roundEndMs({ endTime: at(LOG_END_S), startInfo: { bracket } }, players);

describe("[BUFF FADED] — no line for a buff the round ended on", () => {
  const run = (owner: ICombatUnit, castS: number, bracket: string) => {
    const roundEnd = roundEndOf(bracket, [owner, victim()]);
    const events = extractOwnerCDBuffExpiry(
      shift(castS) as never,
      owner.id,
      [owner],
      T0,
      owner,
      [],
      roundEnd,
    );
    const lines: string[] = [];
    emitBuffFadedEntries({
      cdExpiryEvents: events,
      addEntry: (_t: number, ...l: unknown[]) => {
        lines.push(...(l as string[]));
        return true;
      },
      actorLabel: (name: string) => name,
    } as never);
    return { events, lines, roundEnd };
  };

  it("the round's end is the death, 2 s before the log's (Solo Shuffle)", () => {
    expect(run(shaman(100, null), 100, SOLO_SHUFFLE_BRACKET).roundEnd).toBe(
      at(DEATH_S),
    );
    expect(run(shaman(100, null), 100, "3v3").roundEnd).toBe(at(LOG_END_S));
  });

  it("no REMOVED in the log, its length reaching the round's end → no line", () => {
    const { events, lines } = run(shaman(100, null), 100, SOLO_SHUFFLE_BRACKET);
    // the buff is seen (it is what the channel suffix reads) — it is the
    // LINE that is not printed
    expect(events).toMatchObject([
      { cause: "round_end", expiresAtSeconds: 105 },
    ]);
    expect(lines).toEqual([]);
  });

  it("the Solo Shuffle strip after the round-ending death → no line (it read `ended early — no dispel logged` at 1:46)", () => {
    const { events, lines } = run(
      shaman(100, STRIP_S),
      100,
      SOLO_SHUFFLE_BRACKET,
    );
    expect(events).toMatchObject([{ cause: "round_end" }]);
    expect(lines).toEqual([]);
    // a strip of a buff that had run its length read `expired` the same way
    expect(
      run(shaman(94.5, STRIP_S), 94.5, SOLO_SHUFFLE_BRACKET).lines,
    ).toEqual([]);
  });

  it("removed one second before the round's end → its normal line", () => {
    // pressed 0:92, ran its 12 s
    expect(run(shaman(92, 104), 92, SOLO_SHUFFLE_BRACKET).lines).toEqual([
      "1:44  [BUFF FADED]   Astral Shift (expired)",
    ]);
    // pressed 1:40, gone 4 s later
    expect(run(shaman(100, 104), 100, SOLO_SHUFFLE_BRACKET).lines).toEqual([
      "1:44  [BUFF FADED]   Astral Shift (ended early — no dispel logged)",
    ]);
  });

  it("removed in the millisecond of the round's end → no line; a millisecond before it → its line", () => {
    expect(run(shaman(100, DEATH_S), 100, SOLO_SHUFFLE_BRACKET).lines).toEqual(
      [],
    );
    expect(
      run(shaman(100, DEATH_S - 0.001), 100, SOLO_SHUFFLE_BRACKET).lines,
    ).toEqual([
      "1:44  [BUFF FADED]   Astral Shift (ended early — no dispel logged)",
    ]);
  });

  it("another bracket ends where its log does: the same removal at 1:46 is inside the round", () => {
    expect(run(shaman(100, STRIP_S), 100, "3v3").lines).toEqual([
      "1:46  [BUFF FADED]   Astral Shift (ended early — no dispel logged)",
    ]);
    expect(run(shaman(100, null), 100, "3v3").lines).toEqual([]);
  });
});

describe("[ENEMY BUFF END] — no line for a buff the round ended on", () => {
  const run = (enemy: ICombatUnit, bracket: string) => {
    const roundEnd = roundEndOf(bracket, [enemy, victim()]);
    const lines: string[] = [];
    emitEnemyBuffEntries({
      enemyBuffIntervals: extractEnemyMajorBuffIntervals(
        [enemy],
        T0,
        at(LOG_END_S),
      ),
      droppedBuffIntervals: new Set(),
      buffPurgeAnnotations: new Map(),
      addEntry: (_t: number, ...l: unknown[]) => {
        lines.push(...(l as string[]));
        return true;
      },
      enemyPid: () => "5(FMage)",
      matchStartMs: T0,
      roundEndAtMs: roundEnd,
    } as never);
    return lines;
  };
  const START_LINE = "1:25  [ENEMY BUFF]   5(FMage): Power Infusion";

  it("no REMOVED in the log (the interval is closed at the log's end) → the start line only", () => {
    expect(run(infused("e1", 85, null), SOLO_SHUFFLE_BRACKET)).toEqual([
      START_LINE,
    ]);
    expect(run(infused("e1", 85, null), "3v3")).toEqual([START_LINE]);
  });

  it("the Solo Shuffle strip after the round-ending death → the start line only (it read a bare end at 1:46)", () => {
    expect(run(infused("e1", 85, STRIP_S), SOLO_SHUFFLE_BRACKET)).toEqual([
      START_LINE,
    ]);
  });

  it("removed one second before the round's end → its normal end line", () => {
    expect(run(infused("e1", 85, 104), SOLO_SHUFFLE_BRACKET)).toEqual([
      START_LINE,
      "1:44  [ENEMY BUFF END]   5(FMage): Power Infusion",
    ]);
  });

  it("removed in the millisecond of the round's end → no end line; a millisecond before it → its line", () => {
    expect(run(infused("e1", 85, DEATH_S), SOLO_SHUFFLE_BRACKET)).toEqual([
      START_LINE,
    ]);
    expect(
      run(infused("e1", 85, DEATH_S - 0.001), SOLO_SHUFFLE_BRACKET),
    ).toEqual([
      START_LINE,
      "1:44  [ENEMY BUFF END]   5(FMage): Power Infusion",
    ]);
  });

  it("another bracket ends where its log does: the same removal at 1:46 is inside the round", () => {
    expect(run(infused("e1", 85, STRIP_S), "3v3")).toEqual([
      START_LINE,
      "1:46  [ENEMY BUFF END]   5(FMage): Power Infusion",
    ]);
  });

  it("a buff that went up after the round's end has no end line either", () => {
    expect(
      run(infused("e1", 105.5, STRIP_S), SOLO_SHUFFLE_BRACKET).filter((l) =>
        l.includes("[ENEMY BUFF END]"),
      ),
    ).toEqual([]);
  });
});

describe("the rendered timeline of a Solo Shuffle round", () => {
  const emptyDispel = {
    allyCleanse: [],
    ourPurges: [],
    hostilePurges: [],
    missedCleanseWindows: [],
    missedPurgeWindows: [],
  };
  const render = (
    owner: ICombatUnit,
    ownerSpec: string,
    ownerCDs: unknown,
    enemies: ICombatUnit[],
  ) =>
    buildMatchTimeline({
      owner,
      ownerSpec,
      ownerCDs: ownerCDs as never,
      teammateCDs: [],
      enemyCDTimeline: { players: [], alignedBurstWindows: [] } as never,
      ccTrinketSummaries: [],
      dispelSummary: emptyDispel as never,
      enemyDispelSummary: emptyDispel as never,
      enemyCCSummaries: [],
      friendlyDeaths: [],
      enemyDeaths: [],
      pressureWindows: [],
      healingGaps: [],
      friends: [owner, victim()],
      enemies,
      allUnits: [owner, victim(), ...enemies],
      matchStartMs: T0,
      matchEndMs: at(LOG_END_S),
      bracket: SOLO_SHUFFLE_BRACKET,
      isHealer: true,
      playerIdMap: new Map([
        ["You", 1],
        ["Mate", 2],
      ]),
      enemyIdMap: new Map([
        ["e1", 4],
        ["e2", 5],
      ]),
      criticalWindowSeconds: new Set(),
    });
  const buffLines = (text: string) =>
    text
      .split("\n")
      .filter((l) => /\[(BUFF FADED|ENEMY BUFF|ENEMY BUFF END)\]/.test(l));
  /** The timeline's own lines — the legend's static text is not one. */
  const timed = (text: string) =>
    text.split("\n").filter((l) => /^\d+:\d{2}\s/.test(l));
  const hasRoundEndLegend = (text: string) =>
    roundEndLegend(SOLO_SHUFFLE_BRACKET).every((l) =>
      text.split("\n").includes(l),
    );

  it("buffs the round ended on: the press and the [ENEMY BUFF] start stay, no end line, and no line says `the round ended` — so no legend for it", () => {
    const text = render(
      shaman(100, STRIP_S),
      "Restoration Shaman",
      shift(100),
      [infused("e1", 85, STRIP_S), infused("e2", 90, null)],
    );
    expect(text).toContain("1:40  [YOU] [CD]   Astral Shift");
    expect(buffLines(text)).toEqual([
      "1:25  [ENEMY BUFF]   4(FMage): Power Infusion (purgeable)",
      "1:30  [ENEMY BUFF]   5(FMage): Power Infusion (purgeable)",
    ]);
    expect(timed(text).filter((l) => l.includes(ROUND_ENDED_WORDS))).toEqual(
      [],
    );
    expect(hasRoundEndLegend(text)).toBe(false);
    for (const legend of roundEndLegend(SOLO_SHUFFLE_BRACKET))
      expect(text).not.toContain(legend);
  });

  it("buffs that ended a second before it: their normal lines", () => {
    const text = render(shaman(92, 104), "Restoration Shaman", shift(92), [
      infused("e1", 85, 104),
      infused("e2", 90, 104.9),
    ]);
    expect(buffLines(text)).toEqual([
      "1:25  [ENEMY BUFF]   4(FMage): Power Infusion (purgeable)",
      "1:30  [ENEMY BUFF]   5(FMage): Power Infusion (purgeable)",
      "1:44  [BUFF FADED]   Astral Shift (expired)",
      "1:44  [ENEMY BUFF END]   4(FMage): Power Infusion",
      "1:44  [ENEMY BUFF END]   5(FMage): Power Infusion",
    ]);
  });

  it("a channel the round ended on keeps its press-line suffix (the `round_end` cause is still read) and the legend it needs — with no [BUFF FADED] line", () => {
    const HYMN = "64843";
    const priest = makeUnit("player-1", {
      name: "You",
      class: CombatUnitClass.Priest,
      spec: CombatUnitSpec.Priest_Holy,
      info: {},
      spellCastEvents: [makeSpellCastEvent(HYMN, at(103), "player-1")],
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          HYMN,
          at(103),
          "player-1",
          "player-1",
          "BUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          HYMN,
          at(STRIP_S),
          "player-1",
          "player-1",
          "BUFF",
        ),
      ],
    });
    const text = render(
      priest,
      "Holy Priest",
      [
        {
          spellId: HYMN,
          spellName: "Divine Hymn",
          tag: "Defensive",
          casts: [{ timeSeconds: 103 }],
          cooldownSeconds: 180,
          neverUsed: false,
          availableWindows: [],
        },
      ],
      [],
    );
    const stated = timed(text).filter((l) => l.includes(ROUND_ENDED_WORDS));
    expect(stated).toHaveLength(1);
    expect(stated[0]).toContain(
      "1:43  [YOU] [CD]   Divine Hymn (still channeling when the round ended, 2.0s in)",
    );
    expect(buffLines(text)).toEqual([]);
    expect(hasRoundEndLegend(text)).toBe(true);
  });
});

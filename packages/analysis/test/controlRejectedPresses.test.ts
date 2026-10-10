/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * FT-T16 (user decision D13, 2026-10-10): the log owner's major cooldowns
 * pressed into a control and refused because of it are stated on that
 * control's own line — ` | pressed during it: Fade ×15, Psychic Scream ×4`.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { NOT_READY_REASONS } from "../src/analysis/candidates/shared";
import {
  CONTROL_REJECT_REASONS,
  controlRejectKindOf,
  formatPressedDuringNote,
  ownerControlPressKit,
  ownerPressesRejectedDuring,
  PRESSED_DURING_ITEM_RE_SRC,
  PRESSED_DURING_NOTE_HEAD,
  PRESSED_DURING_NOTE_RE_SRC,
} from "../src/context/controlRejectedPresses";
import { buildMatchTimeline } from "../src/context/matchTimeline";
import { REJECT_REASONS } from "../src/context/spellOutcomeLines";
import { emitSilenceEntries } from "../src/context/timelineSections/silence";
import { ensureAnalysisData } from "../src/data/ensure";
import { IPlayerCCTrinketSummary } from "../src/utils/ccTrinketAnalysis";
import type { CastFailedEvent, RawStreams } from "../src/utils/rawStreams";

const OWNER = "Player-57-0DFEE1C9";
const STUNNED_ZH = "无法在昏迷时那样做";
const FADE = 586;
const SCREAM = 8122;
const PW_SHIELD = 17;
const DESPERATE_PRAYER = 19236;
const kit = new Map([
  [String(FADE), "Fade"],
  [String(SCREAM), "Psychic Scream"],
  [String(DESPERATE_PRAYER), "Desperate Prayer"],
]);
const press = (
  tSeconds: number,
  spellId: number,
  reason: string,
  unitGuid = OWNER,
): CastFailedEvent => ({
  tSeconds,
  unitGuid,
  spellId,
  spellName: `#${spellId}`,
  reason,
});
const span = (w: { from: number; to: number }) => ({
  fromSeconds: w.from,
  toSeconds: w.to,
});

describe("CONTROL_REJECT_REASONS — the reason table", () => {
  const control = CONTROL_REJECT_REASONS.control;
  const silence = CONTROL_REJECT_REASONS.silence;

  it("no text is listed twice, in one kind or across the two", () => {
    const all = [...control, ...silence];
    expect(new Set(all).size).toBe(all.length);
  });

  it("no text is also a not-ready reason or a [REJECTED] reason — those families read their own tables", () => {
    const others = new Set([
      ...NOT_READY_REASONS,
      ...Object.values(REJECT_REASONS).flat(),
    ]);
    expect([...control, ...silence].filter((t) => others.has(t))).toEqual([]);
  });

  it("classes a reason by its text, whatever the client locale", () => {
    expect(controlRejectKindOf("Can't do that while stunned")).toBe("control");
    expect(controlRejectKindOf(STUNNED_ZH)).toBe("control");
    expect(controlRejectKindOf("无法在放逐时那样做")).toBe("control"); // Cyclone
    expect(controlRejectKindOf("기절 중에는 불가능합니다.")).toBe("control");
    expect(controlRejectKindOf("Can't do that while silenced")).toBe("silence");
    expect(controlRejectKindOf("无法在沉默时那样做")).toBe("silence");
  });

  it("not ready, range, and the look-alikes left out on purpose are no control reason", () => {
    for (const reason of [
      "Not yet recovered",
      "尚未恢复",
      "Out of range",
      "Interrupted",
      // the player's own immunity, a pacify, a root, no cause stated
      "Can't do that while invulnerable",
      "Can't use that ability while pacified",
      "You are unable to move",
      "You can't do that right now.",
    ])
      expect(controlRejectKindOf(reason), reason).toBeUndefined();
  });
});

describe("ownerPressesRejectedDuring", () => {
  // 6062daf2 (D13's example): a Discipline Priest in a 6 s Rake stun,
  // 0:21.7–0:26.4 — Power Word: Shield ×16, Fade ×15, Psychic Scream ×4
  const stun = { from: 20.9, to: 26.9 };
  const failed: CastFailedEvent[] = [
    ...Array.from({ length: 16 }, (_, i) =>
      press(21.7 + i * 0.3, PW_SHIELD, STUNNED_ZH),
    ),
    ...Array.from({ length: 15 }, (_, i) =>
      press(21.8 + i * 0.3, FADE, STUNNED_ZH),
    ),
    ...Array.from({ length: 4 }, (_, i) =>
      press(25.0 + i * 0.3, SCREAM, STUNNED_ZH),
    ),
  ];

  it("counts the kit's cooldowns refused for the control, in order of first press; another button (Power Word: Shield) is not a major cooldown", () => {
    const got = ownerPressesRejectedDuring(
      failed,
      OWNER,
      kit,
      "control",
      [stun],
      span,
    );
    expect(got.get(stun)).toEqual([
      { spellId: "586", spellName: "Fade", count: 15, firstSeconds: 21.8 },
      {
        spellId: "8122",
        spellName: "Psychic Scream",
        count: 4,
        firstSeconds: 25.0,
      },
    ]);
    expect(formatPressedDuringNote(got.get(stun))).toBe(
      " | pressed during it: Fade ×15, Psychic Scream ×4",
    );
  });

  it("a press refused as not ready (cooldown / GCD) inside the control is not counted", () => {
    const got = ownerPressesRejectedDuring(
      [
        press(22, FADE, "Not yet recovered"),
        press(22.2, FADE, "尚未恢复"),
        press(22.4, FADE, "Out of range"),
      ],
      OWNER,
      kit,
      "control",
      [stun],
      span,
    );
    expect(got.size).toBe(0);
  });

  it("one refused press is stated — there is no count threshold", () => {
    const got = ownerPressesRejectedDuring(
      [press(23, DESPERATE_PRAYER, "Can't do that while stunned")],
      OWNER,
      kit,
      "control",
      [stun],
      span,
    );
    expect(formatPressedDuringNote(got.get(stun))).toBe(
      " | pressed during it: Desperate Prayer ×1",
    );
  });

  it("a press outside the window, and another unit's press, are not this control's", () => {
    const got = ownerPressesRejectedDuring(
      [
        press(20.8, FADE, STUNNED_ZH),
        press(27.0, FADE, STUNNED_ZH),
        press(23, FADE, STUNNED_ZH, "Player-1-OTHER"),
      ],
      OWNER,
      kit,
      "control",
      [stun],
      span,
    );
    expect(got.size).toBe(0);
  });

  it("the bounds are inclusive on the log's millisecond grid", () => {
    // 5.137 + 0.3 is 5.436999999999999 as a float: still the window's end
    const w = { from: 5.137, to: 5.137 + 0.3 };
    const got = ownerPressesRejectedDuring(
      [press(5.137, FADE, STUNNED_ZH), press(5.437, FADE, STUNNED_ZH)],
      OWNER,
      kit,
      "control",
      [w],
      span,
    );
    expect(got.get(w)?.[0]?.count).toBe(2);
  });

  it("a silence reason is a [SILENCE] fact, a control reason a [CC ON TEAM] fact — neither family claims the other's", () => {
    const failedBoth = [
      press(22, FADE, "Can't do that while silenced"),
      press(23, SCREAM, "Can't do that while stunned"),
    ];
    const asControl = ownerPressesRejectedDuring(
      failedBoth,
      OWNER,
      kit,
      "control",
      [stun],
      span,
    );
    const asSilence = ownerPressesRejectedDuring(
      failedBoth,
      OWNER,
      kit,
      "silence",
      [stun],
      span,
    );
    expect(asControl.get(stun)?.map((p) => p.spellName)).toEqual([
      "Psychic Scream",
    ]);
    expect(asSilence.get(stun)?.map((p) => p.spellName)).toEqual(["Fade"]);
  });

  it("two controls overlapping: a press is on ONE line, the earliest-started control that holds it", () => {
    const fear = { from: 24, to: 30 };
    const got = ownerPressesRejectedDuring(
      [
        press(25, FADE, STUNNED_ZH), // inside both
        press(28, FADE, "Can't do that while fleeing"), // the fear alone
      ],
      OWNER,
      kit,
      "control",
      [fear, stun],
      span,
    );
    expect(got.get(stun)).toEqual([
      { spellId: "586", spellName: "Fade", count: 1, firstSeconds: 25 },
    ]);
    expect(got.get(fear)).toEqual([
      { spellId: "586", spellName: "Fade", count: 1, firstSeconds: 28 },
    ]);
  });

  it("two kit ids that print one name are one item of the clause", () => {
    const got = ownerPressesRejectedDuring(
      [press(22, 51514, STUNNED_ZH), press(23, 210873, STUNNED_ZH)],
      OWNER,
      new Map([
        ["51514", "Hex"],
        ["210873", "Hex"],
      ]),
      "control",
      [stun],
      span,
    );
    expect(formatPressedDuringNote(got.get(stun))).toBe(
      " | pressed during it: Hex ×2",
    );
  });

  it("the kit is the cooldown ledger without its entries that have no button", () => {
    expect([
      ...ownerControlPressKit([
        { spellId: "586", spellName: "Fade" },
        { spellId: "31884", spellName: "Avenging Wrath", isProcOnly: true },
      ]).entries(),
    ]).toEqual([["586", "Fade"]]);
  });
});

describe("the clause and the pattern the gate reads it with", () => {
  it("round-trips, a comma inside a spell name included", () => {
    const note = formatPressedDuringNote([
      {
        spellId: "123904",
        spellName: "Invoke Xuen, the White Tiger",
        count: 2,
        firstSeconds: 1,
      },
      { spellId: "586", spellName: "Fade", count: 12, firstSeconds: 2 },
    ]);
    expect(note.startsWith(PRESSED_DURING_NOTE_HEAD)).toBe(true);
    const line = `0:20  [CC ON TEAM]   1(WMonk) ← Rake (by 3(FDruid)) | 6s [DR: Stun Full]${note}`;
    const list = line.match(new RegExp(PRESSED_DURING_NOTE_RE_SRC))?.[1];
    expect(list).toBe("Invoke Xuen, the White Tiger ×2, Fade ×12");
    expect(
      [...list!.matchAll(new RegExp(PRESSED_DURING_ITEM_RE_SRC, "g"))].map(
        (m) => [m[1], m[2]],
      ),
    ).toEqual([
      ["Invoke Xuen, the White Tiger", "2"],
      ["Fade", "12"],
    ]);
  });

  it("no presses, no clause", () => {
    expect(formatPressedDuringNote(undefined)).toBe("");
    expect(formatPressedDuringNote([])).toBe("");
  });
});

// ── on the rendered lines ───────────────────────────────────────────────────

const T0 = 1_000_000;
function unit(
  id: string,
  name: string,
  over: Partial<ICombatUnit> = {},
): ICombatUnit {
  return {
    id,
    name,
    type: CombatUnitType.Player,
    spec: CombatUnitSpec.Priest_Discipline,
    reaction: CombatUnitReaction.Friendly,
    spellCastEvents: [],
    auraEvents: [],
    damageIn: [],
    damageOut: [],
    healIn: [],
    healOut: [],
    absorbsIn: [],
    absorbsOut: [],
    missesIn: [],
    missesOut: [],
    advancedActions: [],
    ...over,
  } as ICombatUnit;
}
const emptyDispel = {
  allyCleanse: [],
  ourPurges: [],
  hostilePurges: [],
  missedCleanseWindows: [],
  missedPurgeWindows: [],
};
const stunOn = (playerName: string): IPlayerCCTrinketSummary =>
  ({
    playerName,
    playerSpec: "Discipline Priest",
    trinketType: "Gladiator",
    trinketCooldownSeconds: 120,
    ccInstances: [
      {
        atSeconds: 20.9,
        durationSeconds: 6,
        spellId: "163505",
        spellName: "Rake",
        sourceName: "EnemyDruid",
        sourceId: "E1",
        sourceSpec: "Feral Druid",
        damageTakenDuring: 0,
        trinketState: "available_unused",
        drInfo: { category: "Stun", level: "Full" },
        distanceYards: 5,
        losBlocked: null,
      },
    ],
    trinketUseTimes: [],
    missedTrinketWindows: [],
    rootInstances: [],
    disarmInstances: [],
    interruptInstances: [],
    ccAvoidedInstances: [],
  }) as any;
const fade = {
  spellId: String(FADE),
  spellName: "Fade",
  tag: "Defensive",
  cooldownSeconds: 20,
  casts: [],
  availableWindows: [],
  neverUsed: true,
};
function timeline(rawStreams: RawStreams | undefined): string {
  const owner = unit(OWNER, "Owner");
  const mate = unit("P2", "Mate", { spec: CombatUnitSpec.Mage_Frost });
  const enemy = unit("E1", "EnemyDruid", {
    reaction: CombatUnitReaction.Hostile,
    spec: CombatUnitSpec.Druid_Feral,
  });
  return buildMatchTimeline({
    owner,
    ownerSpec: "Discipline Priest",
    friends: [owner, mate],
    enemies: [enemy],
    allUnits: [owner, mate, enemy],
    playerIdMap: new Map([
      ["Owner", 1],
      ["Mate", 2],
    ]),
    enemyIdMap: new Map([["EnemyDruid", 3]]),
    matchStartMs: T0,
    matchEndMs: T0 + 60_000,
    isHealer: true,
    ownerCDs: [fade],
    teammateCDs: [],
    enemyCDTimeline: { players: [], alignedBurstWindows: [] },
    // the same stun on the owner and on a teammate
    ccTrinketSummaries: [stunOn("Owner"), stunOn("Mate")],
    enemyCCSummaries: [],
    dispelSummary: emptyDispel as any,
    enemyDispelSummary: emptyDispel as any,
    pressureWindows: [],
    healingGaps: [],
    friendlyDeaths: [],
    enemyDeaths: [],
    criticalWindowSeconds: new Set(),
    outgoingCCChains: [],
    rawStreams,
  } as any);
}
/** the timeline's own lines of that tag (a legend line names tags too) */
const linesOf = (text: string, tag: string) =>
  text.split("\n").filter((l) => /^\d+:\d{2} {2}\[/.test(l) && l.includes(tag));

describe("[CC ON TEAM] — the owner's line of that control gains the clause", () => {
  const raw: RawStreams = {
    available: true,
    manaSamples: [],
    castFailed: [
      ...Array.from({ length: 15 }, (_, i) =>
        press(21.8 + i * 0.3, FADE, STUNNED_ZH),
      ),
      press(22, PW_SHIELD, STUNNED_ZH),
      press(23, FADE, "Not yet recovered"),
    ],
  };

  it("the owner's stun line states the refused presses; the teammate's line of the same stun does not", () => {
    const cc = linesOf(timeline(raw), "[CC ON TEAM]");
    expect(cc).toHaveLength(2);
    const own = cc.find((l) => l.includes("1(")) ?? "";
    const mates = cc.find((l) => l.includes("2(")) ?? "";
    expect(own).toMatch(
      /^0:20 {2}\[CC ON TEAM\] {3}1\(\w+\) ← Rake \(by 3\(\w+\)\) \| 6s \[DR: Stun Full\] \| 5yd from caster \| pressed during it: Fade ×15$/,
    );
    expect(mates).not.toContain("pressed during it");
  });

  it("the clause brings its legend line; a round without it prints neither", () => {
    const withNote = timeline(raw);
    expect(withNote).toContain("`| pressed during it: X ×N` on a [CC ON TEAM]");
    for (const rawStreams of [
      undefined,
      { available: false, manaSamples: [], castFailed: [] },
      { available: true, manaSamples: [], castFailed: [] },
    ]) {
      const without = timeline(rawStreams);
      expect(without).not.toContain("pressed during it");
      // and the line itself is the one printed before FT-T16
      expect(linesOf(without, "[CC ON TEAM]")[0]).toMatch(
        / \| 5yd from caster$/,
      );
    }
  });
});

describe("[SILENCE] — a press refused as silenced is on the owner's silence line", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });
  const SILENCE = "15487"; // Priest: Silence
  const aura = (event: LogEvent, atS: number, dest: string): any => ({
    spellId: SILENCE,
    spellName: "Silence",
    srcUnitId: "e1",
    srcUnitName: "e1",
    destUnitId: dest,
    destUnitName: dest,
    timestamp: T0 + atS * 1000,
    logLine: { event, timestamp: T0 + atS * 1000, parameters: [] },
    auraType: "DEBUFF",
  });
  const silenced = (id: string): any => ({
    id,
    name: id,
    spellCastEvents: [],
    actionIn: [],
    deathRecords: [],
    auraEvents: [
      aura(LogEvent.SPELL_AURA_APPLIED, 20, id),
      aura(LogEvent.SPELL_AURA_REMOVED, 23, id),
    ],
  });
  function render(rawStreams: RawStreams | undefined): string[] {
    const lines: string[] = [];
    const owner = silenced(OWNER);
    emitSilenceEntries({
      allUnits: [],
      friends: [owner, silenced("f2")],
      enemies: [{ id: "e1", name: "e1", spellCastEvents: [], auraEvents: [] }],
      ccTrinketSummaries: [],
      matchStartMs: T0,
      matchEndMs: T0 + 120_000,
      pid: (n: string) => `F:${n}`,
      enemyPid: (n: string) => `E:${n}`,
      actorLabel: (n: string, side: "friendly" | "enemy") =>
        side === "friendly" ? `F:${n}` : `E:${n}`,
      addEntry: (_t: number, line: string) => lines.push(line),
      silenceLineCount: 0,
      owner,
      ownerCDs: [fade],
      rawStreams,
    } as never);
    return lines;
  }

  it("silenced presses of a kit cooldown are stated; a stun reason is not this line's", () => {
    expect(
      render({
        available: true,
        manaSamples: [],
        castFailed: [
          press(20.5, FADE, "Can't do that while silenced"),
          press(21.5, FADE, "无法在沉默时那样做"),
          press(22, FADE, "Can't do that while stunned"),
          press(22.5, PW_SHIELD, "Can't do that while silenced"),
        ],
      }),
    ).toEqual([
      `0:20  [SILENCE]   F:${OWNER} ← Silence (by E:e1) | 3s | pressed during it: Fade ×2`,
      "0:20  [SILENCE]   F:f2 ← Silence (by E:e1) | 3s",
    ]);
  });

  it("no raw stream: the lines are the ones printed before", () => {
    expect(render(undefined)).toEqual([
      `0:20  [SILENCE]   F:${OWNER} ← Silence (by E:e1) | 3s`,
      "0:20  [SILENCE]   F:f2 ← Silence (by E:e1) | 3s",
    ]);
  });
});

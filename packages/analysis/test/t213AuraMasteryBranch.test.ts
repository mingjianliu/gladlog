/**
 * Pipeline T213 (fact14 D37 / D38, user ruling R53, 2026-11-18): an Aura
 * Mastery pressed under Concentration Aura gives 8 s of silence / interrupt
 * immunity (aura 317929) and no reduction. It is not a wall in any reader;
 * its `[ENEMY DEF]` line reads `Aura Mastery (silence / interrupt immunity,
 * 8.0s)` and our own `[CD]` press lines carry `(silence / interrupt
 * immunity)`. Under Devotion Aura nothing changes.
 */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { buildMatchTimeline } from "../src/context/matchTimeline";
import { ensureAnalysisData } from "../src/data/ensure";
import { immunityMechanics } from "../src/data/spellSchools";
import { buildAuraIntervals } from "../src/utils/auraIntervals";
import {
  AURA_MASTERY_ID,
  AURA_MASTERY_IMMUNITY_AURA_ID,
  auraMasteryImmunityLabelWords,
  auraMasteryIsNoWallOf,
  auraMasteryKitTag,
  auraMasteryPressIsImmunityBranch,
  auraMasteryPressSwitchedToWall,
  auraMasteryPressTag,
  auraMasteryPressWallStartMs,
  CONCENTRATION_AURA_ID,
  isAuraMasterySwitchWallEvent,
  isNoWallButtonOf,
  isNoWallPress,
  kitNameCarriesNoWallTag,
  kitNameWithoutNoWallTag,
  kitTextWithoutNoWallTags,
  withoutImmunityBranchWalls,
} from "../src/utils/auraMasteryBranch";
import { auraOnlyActivations } from "../src/utils/auraOnlyActivations";
import {
  enemyDefensiveEvents,
  ownSaveSpanS,
  ownWallSpanS,
  saveAuraIntervals,
} from "../src/utils/enemyDefensives";
import { kwPressProtectionStartS } from "../src/utils/offensiveWindows";
import {
  immunityLegendsWithoutCarrier,
  selfDefensiveLabelLegends,
  statesSelfDefensiveLabel,
  TIMED_IMMUNITY_LABEL_RE,
  TIMED_IMMUNITY_LEGEND,
} from "../src/utils/selfDefensiveMechanism";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_000_000;
const at = (s: number) => T0 + Math.round(s * 1000);
const DEVOTION_AURA = "465";

beforeAll(async () => {
  await ensureAnalysisData();
});

const aura = (ev: LogEvent, id: string, s: number) =>
  makeAuraEvent(ev, id, at(s), "e1", "e1", "BUFF");

/** a Holy Paladin that presses Aura Mastery at 20 s (or never) under the
 * running aura `running`, which has been up since 1 s */
const paladin = (
  running: typeof CONCENTRATION_AURA_ID | typeof DEVOTION_AURA,
  pressed = true,
) =>
  makeUnit("e1", {
    name: "EnemyPaladin",
    class: CombatUnitClass.Paladin,
    spec: CombatUnitSpec.Paladin_Holy,
    reaction: CombatUnitReaction.Hostile,
    info: { talents: [], pvpTalents: [] } as never,
    spellCastEvents: pressed
      ? [
          makeSpellCastEvent(
            AURA_MASTERY_ID,
            at(20),
            "e1",
            "EnemyPaladin",
            "e1",
            "EnemyPaladin",
          ),
        ]
      : [],
    auraEvents: [
      aura(LogEvent.SPELL_AURA_APPLIED, running, 1),
      ...(pressed
        ? [
            aura(LogEvent.SPELL_AURA_APPLIED, AURA_MASTERY_ID, 20),
            aura(LogEvent.SPELL_AURA_REMOVED, AURA_MASTERY_ID, 28),
            ...(running === CONCENTRATION_AURA_ID
              ? [
                  aura(
                    LogEvent.SPELL_AURA_APPLIED,
                    AURA_MASTERY_IMMUNITY_AURA_ID,
                    20,
                  ),
                  aura(
                    LogEvent.SPELL_AURA_REMOVED,
                    AURA_MASTERY_IMMUNITY_AURA_ID,
                    28,
                  ),
                ]
              : []),
          ]
        : []),
    ],
  });
const round = { startTime: T0, endTime: at(120) };
const combatOf = (u: ReturnType<typeof paladin>) =>
  ({ ...round, units: { e1: u } }) as never;
const linesOf = (u: ReturnType<typeof paladin>) =>
  enemyDefensiveEvents(u, [u], combatOf(u)).filter(
    (d) => d.spellName === "Aura Mastery",
  );

describe("T213 — Aura Mastery under Concentration Aura is silence / interrupt immunity, not a wall (ruling R53)", () => {
  it("the label's mechanics are DB2's (aura 77 of 317929: 9 silence, 26 interrupt)", () => {
    expect(immunityMechanics(AURA_MASTERY_IMMUNITY_AURA_ID)).toEqual(
      expect.arrayContaining([9, 26]),
    );
    expect(auraMasteryImmunityLabelWords()).toBe(
      "silence / interrupt immunity",
    );
  });

  it("the branch is the press's own 317929 row", () => {
    expect(
      auraMasteryPressIsImmunityBranch(paladin(CONCENTRATION_AURA_ID), at(20)),
    ).toBe(true);
    expect(
      auraMasteryPressIsImmunityBranch(paladin(DEVOTION_AURA), at(20)),
    ).toBe(false);
    // not a press 5 s away from the row
    expect(
      auraMasteryPressIsImmunityBranch(paladin(CONCENTRATION_AURA_ID), at(25)),
    ).toBe(false);
  });

  it("[ENEMY DEF]: one line, a self-save with the timed immunity mechanism — no wall, no percentage", () => {
    const [d, ...rest] = linesOf(paladin(CONCENTRATION_AURA_ID));
    expect(rest).toEqual([]);
    expect(d).toMatchObject({
      kind: "self-save",
      spellId: AURA_MASTERY_ID,
      atSeconds: 20,
      pressSeconds: 20,
      mechanism: {
        kind: "mechanic immunity",
        mechanics: ["silence", "interrupt"],
        timed: true,
      },
    });
    expect(d!.observedSeconds).toBeCloseTo(8);
    expect(d!.pct).toBeUndefined();
    // no span reader counts it
    expect(ownWallSpanS(d!, true)).toBeUndefined();
    expect(ownSaveSpanS(d!, true)).toBeUndefined();
    // the gate's reader of the label takes the timed form
    expect(
      statesSelfDefensiveLabel(
        "(silence / interrupt immunity, 8.0s)",
        d!.mechanism!,
      ),
    ).toBe(true);
  });

  it("a press with no cast row (pressed while unseen) keeps its line, as the immunity", () => {
    const u = paladin(CONCENTRATION_AURA_ID);
    u.spellCastEvents = [];
    // the log re-lists the paladin's auras in one ms as it comes back into
    // view (`hiddenPressMs`: a re-stating batch)
    for (const id of ["21562", "1126", "6673", "381748", "32223", "462854"])
      u.auraEvents.push(aura(LogEvent.SPELL_AURA_APPLIED, id, 20) as never);
    const [d, ...rest] = linesOf(u);
    expect(rest).toEqual([]);
    expect(d).toMatchObject({
      kind: "self-save",
      atSeconds: 20,
      unseenPress: true,
      mechanism: { kind: "mechanic immunity", timed: true },
    });
    expect(d!.pressSeconds).toBeUndefined();
    expect(d!.pct).toBeUndefined();
  });

  it("a switch to Devotion Aura while the press runs: the press stays the immunity, the wall runs from the switch (80-PIPE-170-B156 #1)", () => {
    const u = paladin(CONCENTRATION_AURA_ID);
    // 1.3 s in: the immunity aura and Concentration Aura leave, Devotion goes up
    u.auraEvents = u.auraEvents.filter(
      (a) =>
        !(
          a.spellId === AURA_MASTERY_IMMUNITY_AURA_ID &&
          a.logLine.event === LogEvent.SPELL_AURA_REMOVED
        ),
    );
    (u.auraEvents as unknown[]).push(
      aura(LogEvent.SPELL_AURA_REMOVED, AURA_MASTERY_IMMUNITY_AURA_ID, 21.3),
      aura(LogEvent.SPELL_AURA_REMOVED, CONCENTRATION_AURA_ID, 21.3),
      aura(LogEvent.SPELL_AURA_APPLIED, DEVOTION_AURA, 21.3),
    );
    u.auraEvents.sort((a, b) => a.logLine.timestamp - b.logLine.timestamp);
    const walls = saveAuraIntervals(u, [u], combatOf(u)).filter(
      (iv) => iv.spellId === AURA_MASTERY_ID,
    );
    expect(walls).toHaveLength(1);
    // the wall runs from the switch, not from the press (assembly review
    // 80-PIPE-170-B156 #1)
    expect(walls[0]!.fromS).toBeCloseTo(21.3);
    expect(walls[0]!.toS).toBeCloseTo(28);
    // the press is read by the aura it was pressed under: immunity
    expect(auraMasteryPressSwitchedToWall(u, at(20))).toBe(true);
    expect(auraMasteryPressIsImmunityBranch(u, at(20))).toBe(true);
    expect(auraMasteryPressTag(AURA_MASTERY_ID, u, at(20))).toBe(
      " (silence / interrupt immunity)",
    );
    // the round has a wall: the kit entry is not tagged immunity-only
    expect(auraMasteryIsNoWallOf(u, round)).toBe(false);
    expect(auraMasteryKitTag(AURA_MASTERY_ID, u, round)).toBe("");
    // two lines, as the log has it: the press, an immunity until the
    // switch; then the wall, which no press of its own put up
    const ls = linesOf(u);
    expect(ls).toHaveLength(2);
    expect(ls[0]).toMatchObject({ kind: "self-save", atSeconds: 20 });
    expect(ls[0]!.mechanism?.kind).toBe("mechanic immunity");
    expect(ls[0]!.observedSeconds).toBeCloseTo(1.3);
    expect(ls[1]).toMatchObject({ kind: "self", pct: 24, noPressLogged: true });
    expect(ls[1]!.atSeconds).toBeCloseTo(21.3);
    expect(ls[1]!.observedSeconds).toBeCloseTo(6.7);
    // the wall has no timeline line of its own on either side (the press
    // was spent at its own line; no tag a press-less line has is true of
    // it) — the event above stays for the wall readers
    expect(isAuraMasterySwitchWallEvent(u, ls[1]!, at(21.3))).toBe(true);
    expect(isAuraMasterySwitchWallEvent(u, ls[0]!, at(20))).toBe(false);
    expect(
      auraOnlyActivations(u, [u], at(0), at(120)).filter(
        (a) => a.spellId === AURA_MASTERY_ID,
      ),
    ).toEqual([]);
    // the plain immunity press is untouched
    const plain = paladin(CONCENTRATION_AURA_ID);
    expect(auraMasteryPressSwitchedToWall(plain, at(20))).toBe(false);
    expect(auraMasteryPressIsImmunityBranch(plain, at(20))).toBe(true);
  });

  it("under Devotion Aura the wall line is as before", () => {
    const [d, ...rest] = linesOf(paladin(DEVOTION_AURA));
    expect(rest).toEqual([]);
    expect(d).toMatchObject({ kind: "self", spellId: AURA_MASTERY_ID });
    expect(d!.pct).toBeGreaterThan(0);
    expect(ownWallSpanS(d!, true)).toEqual({ from: 20, to: 28 });
  });

  it("the wall readers' intervals: the 31821 interval is out under Concentration, in under Devotion", () => {
    const c = paladin(CONCENTRATION_AURA_ID);
    const d = paladin(DEVOTION_AURA);
    const ids = (u: ReturnType<typeof paladin>) =>
      saveAuraIntervals(u, [u], combatOf(u)).map((iv) => iv.spellId);
    expect(ids(c)).not.toContain(AURA_MASTERY_ID);
    expect(ids(c)).toContain(AURA_MASTERY_IMMUNITY_AURA_ID);
    expect(ids(d)).toContain(AURA_MASTERY_ID);
    // the builder itself keeps the aura (the report's uptime reads it)
    expect(
      buildAuraIntervals(c, combatOf(c)).map((iv) => iv.spellId),
    ).toContain(AURA_MASTERY_ID);
    expect(
      withoutImmunityBranchWalls(c, buildAuraIntervals(c, combatOf(c)), T0).map(
        (iv) => iv.spellId,
      ),
    ).not.toContain(AURA_MASTERY_ID);
  });

  it("in hand over a round: every press the immunity branch, or — unpressed — Concentration Aura at the end and no Devotion Aura in the round", () => {
    expect(auraMasteryIsNoWallOf(paladin(CONCENTRATION_AURA_ID), round)).toBe(
      true,
    );
    expect(auraMasteryIsNoWallOf(paladin(DEVOTION_AURA), round)).toBe(false);
    expect(
      auraMasteryIsNoWallOf(paladin(CONCENTRATION_AURA_ID, false), round),
    ).toBe(true);
    expect(auraMasteryIsNoWallOf(paladin(DEVOTION_AURA, false), round)).toBe(
      false,
    );
    // a paladin whose running aura the log does not show keeps the wall
    const unseen = paladin(DEVOTION_AURA, false);
    unseen.auraEvents = [];
    expect(auraMasteryIsNoWallOf(unseen, round)).toBe(false);
    // swapped to Devotion mid-round, never pressed: read both ways → wall
    const swapped = paladin(CONCENTRATION_AURA_ID, false);
    swapped.auraEvents = [
      ...swapped.auraEvents,
      aura(LogEvent.SPELL_AURA_REMOVED, CONCENTRATION_AURA_ID, 60),
      aura(LogEvent.SPELL_AURA_APPLIED, DEVOTION_AURA, 60),
    ] as never;
    expect(auraMasteryIsNoWallOf(swapped, round)).toBe(false);
    // …and back again: still read both ways
    swapped.auraEvents = [
      ...swapped.auraEvents,
      aura(LogEvent.SPELL_AURA_REMOVED, DEVOTION_AURA, 90),
      aura(LogEvent.SPELL_AURA_APPLIED, CONCENTRATION_AURA_ID, 90),
    ] as never;
    expect(auraMasteryIsNoWallOf(swapped, round)).toBe(false);
    // only Aura Mastery is ever answered for
    expect(isNoWallButtonOf("498", paladin(CONCENTRATION_AURA_ID), round)).toBe(
      false,
    );
  });

  it("the kit entry's tag (R74): on the unit whose Aura Mastery is no wall over the round, pressed or not", () => {
    const tag = " (silence / interrupt immunity)";
    for (const pressed of [true, false]) {
      expect(
        auraMasteryKitTag(
          AURA_MASTERY_ID,
          paladin(CONCENTRATION_AURA_ID, pressed),
          round,
        ),
      ).toBe(tag);
      expect(
        auraMasteryKitTag(
          AURA_MASTERY_ID,
          paladin(DEVOTION_AURA, pressed),
          round,
        ),
      ).toBe("");
    }
    // another button of the same unit carries nothing
    expect(
      auraMasteryKitTag("498", paladin(CONCENTRATION_AURA_ID), round),
    ).toBe("");
    expect(kitNameCarriesNoWallTag(`Aura Mastery${tag}`)).toBe(true);
    expect(kitNameCarriesNoWallTag("Aura Mastery")).toBe(false);
    expect(kitNameWithoutNoWallTag(`Aura Mastery${tag}`)).toBe("Aura Mastery");
    expect(kitNameWithoutNoWallTag("Divine Shield")).toBe("Divine Shield");
  });

  it("per press: a round's Devotion press does not turn its immunity press into a wall (codex 85-tk-WIN-T213-2 #3)", () => {
    const u = paladin(CONCENTRATION_AURA_ID);
    // 60 s: switches to Devotion Aura; 100 s: a second, Devotion press
    (u.auraEvents as unknown[]).push(
      aura(LogEvent.SPELL_AURA_REMOVED, CONCENTRATION_AURA_ID, 60),
      aura(LogEvent.SPELL_AURA_APPLIED, DEVOTION_AURA, 60),
      aura(LogEvent.SPELL_AURA_APPLIED, AURA_MASTERY_ID, 100),
      aura(LogEvent.SPELL_AURA_REMOVED, AURA_MASTERY_ID, 108),
    );
    (u.spellCastEvents as unknown[]).push(
      makeSpellCastEvent(
        AURA_MASTERY_ID,
        at(100),
        "e1",
        "EnemyPaladin",
        "e1",
        "EnemyPaladin",
      ),
    );
    expect(isNoWallPress(AURA_MASTERY_ID, u, at(20))).toBe(true);
    expect(isNoWallPress(AURA_MASTERY_ID, u, at(100))).toBe(false);
    expect(isNoWallPress("498", u, at(20))).toBe(false);
    // over the round the button is a wall (one press was), so no kit tag
    expect(auraMasteryKitTag(AURA_MASTERY_ID, u, round)).toBe("");
  });

  it("one reading of a press's wall for every wall reader: the press, the switch, or none (80-PIPE-170b-B156)", () => {
    const wall = paladin(DEVOTION_AURA);
    const immunity = paladin(CONCENTRATION_AURA_ID);
    const switched = paladin(CONCENTRATION_AURA_ID);
    (switched.auraEvents as unknown[]).push(
      aura(LogEvent.SPELL_AURA_REMOVED, CONCENTRATION_AURA_ID, 21.3),
      aura(LogEvent.SPELL_AURA_APPLIED, DEVOTION_AURA, 21.3),
      // a later press under Devotion Aura keeps the button a tracked wall
      aura(LogEvent.SPELL_AURA_APPLIED, AURA_MASTERY_ID, 100),
      aura(LogEvent.SPELL_AURA_REMOVED, AURA_MASTERY_ID, 108),
    );
    switched.auraEvents.sort(
      (a, b) => a.logLine.timestamp - b.logLine.timestamp,
    );
    expect(auraMasteryPressWallStartMs(wall, at(20))).toBe(at(20));
    expect(auraMasteryPressWallStartMs(immunity, at(20))).toBeUndefined();
    expect(auraMasteryPressWallStartMs(switched, at(20))).toBe(at(21.3));
    expect(auraMasteryPressWallStartMs(switched, at(100))).toBe(at(100));
    // the kill-window state machine: the switched press is tracked (it
    // holds a wall), its protection starts at the switch — the 1.3 s before
    // it are no wall — and the immunity press holds nothing
    expect(isNoWallPress(AURA_MASTERY_ID, switched, at(20))).toBe(false);
    expect(kwPressProtectionStartS(switched, AURA_MASTERY_ID, 20, T0)).toBe(
      21.3,
    );
    expect(kwPressProtectionStartS(switched, AURA_MASTERY_ID, 100, T0)).toBe(
      100,
    );
    expect(
      kwPressProtectionStartS(immunity, AURA_MASTERY_ID, 20, T0),
    ).toBeUndefined();
    expect(kwPressProtectionStartS(wall, AURA_MASTERY_ID, 20, T0)).toBe(20);
    expect(kwPressProtectionStartS(immunity, "498", 20, T0)).toBe(20);
  });

  it("rendered, the enemy side: the switched press prints its own line and no line at the switch (80-PIPE-170b-B156 note 3)", () => {
    const foe = paladin(CONCENTRATION_AURA_ID);
    // 4 s in: the immunity and Concentration Aura leave, Devotion goes up
    foe.auraEvents = foe.auraEvents.filter(
      (a) =>
        !(
          a.spellId === AURA_MASTERY_IMMUNITY_AURA_ID &&
          a.logLine.event === LogEvent.SPELL_AURA_REMOVED
        ),
    );
    (foe.auraEvents as unknown[]).push(
      aura(LogEvent.SPELL_AURA_REMOVED, AURA_MASTERY_IMMUNITY_AURA_ID, 24),
      aura(LogEvent.SPELL_AURA_REMOVED, CONCENTRATION_AURA_ID, 24),
      aura(LogEvent.SPELL_AURA_APPLIED, DEVOTION_AURA, 24),
    );
    foe.auraEvents.sort((a, b) => a.logLine.timestamp - b.logLine.timestamp);
    const owner = makeUnit("PlayerYou", {
      spec: CombatUnitSpec.Shaman_Restoration,
    });
    const empty = {
      allyCleanse: [],
      ourPurges: [],
      hostilePurges: [],
      missedCleanseWindows: [],
      missedPurgeWindows: [],
    } as never;
    const text = buildMatchTimeline({
      owner,
      ownerSpec: "Restoration Shaman",
      ownerCDs: [],
      teammateCDs: [],
      enemyCDTimeline: { players: [], alignedBurstWindows: [] } as never,
      ccTrinketSummaries: [],
      dispelSummary: empty,
      enemyDispelSummary: empty,
      enemyCCSummaries: [],
      friendlyDeaths: [],
      enemyDeaths: [],
      pressureWindows: [],
      healingGaps: [],
      friends: [owner],
      enemies: [foe],
      allUnits: [owner, foe],
      matchStartMs: T0,
      matchEndMs: at(120),
      isHealer: true,
      playerIdMap: new Map([["PlayerYou", 1]]),
      enemyIdMap: new Map([["EnemyPaladin", 4]]),
      outgoingCCChains: [],
      criticalWindowSeconds: new Set<number>(),
    } as never);
    const lines = text
      .split("\n")
      .filter((l) => l.includes("[ENEMY DEF]") && l.includes("Aura Mastery"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^0:20 {2}\[ENEMY DEF\]/);
    expect(lines[0]).toContain("silence / interrupt immunity");
    // the immunity ended at the switch; the wall that began there has no
    // line of its own (its press was spent here)
    expect(lines[0]).toBe(
      "0:20  [ENEMY DEF]   4(HPaladin) (Holy Paladin): Aura Mastery (silence / interrupt immunity, 4.0s — removed early)",
    );
  });

  it("a kit text read by name loses the tag (`kitTextWithoutNoWallTags`)", () => {
    expect(
      kitTextWithoutNoWallTags(
        "Divine Shield [210s, lasts 8s], Aura Mastery (silence / interrupt immunity) [150s, lasts 8s] [UNUSED], Lay on Hands [420s]",
      ),
    ).toBe(
      "Divine Shield [210s, lasts 8s], Aura Mastery [150s, lasts 8s] [UNUSED], Lay on Hands [420s]",
    );
  });

  it("our own press line's tag", () => {
    expect(
      auraMasteryPressTag(
        AURA_MASTERY_ID,
        paladin(CONCENTRATION_AURA_ID),
        at(20),
      ),
    ).toBe(" (silence / interrupt immunity)");
    expect(
      auraMasteryPressTag(AURA_MASTERY_ID, paladin(DEVOTION_AURA), at(20)),
    ).toBe("");
    expect(
      auraMasteryPressTag("498", paladin(CONCENTRATION_AURA_ID), at(20)),
    ).toBe("");
  });
  it("the legend (R56): its own sentence beside the timed label, never the plain immunity sentence", () => {
    const timed =
      "0:12  [ENEMY DEF]   6(HPaladin) (Holy Paladin): Aura Mastery (silence / interrupt immunity, 8.0s)";
    const plain =
      "0:30  [ENEMY DEF]   5(BMHunter) (Beast Mastery Hunter): Master's Call (root / snare immunity)";
    expect(TIMED_IMMUNITY_LEGEND).toBe(
      "`(silence / interrupt immunity, Ts)` = immune to silences and interrupts while it is up; it reduces no damage and is not one of the walls;",
    );
    expect(TIMED_IMMUNITY_LABEL_RE.test(timed)).toBe(true);
    expect(TIMED_IMMUNITY_LABEL_RE.test(plain)).toBe(false);
    expect(selfDefensiveLabelLegends([timed])).toEqual([TIMED_IMMUNITY_LEGEND]);
    const plainLegends = selfDefensiveLabelLegends([plain]);
    expect(plainLegends).toHaveLength(1);
    expect(plainLegends[0]).toContain("one already on it is removed");
    // the gate: either sentence with no line of its own label form
    expect(
      immunityLegendsWithoutCarrier([timed, `    ${plainLegends[0]}`]),
    ).toEqual(plainLegends);
    expect(
      immunityLegendsWithoutCarrier([plain, `    ${TIMED_IMMUNITY_LEGEND}`]),
    ).toEqual([TIMED_IMMUNITY_LEGEND]);
    expect(
      immunityLegendsWithoutCarrier([
        timed,
        plain,
        `    ${TIMED_IMMUNITY_LEGEND}`,
        `    ${plainLegends[0]}`,
      ]),
    ).toEqual([]);
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
import { ensureAnalysisData } from "@gladlog/analysis";
import {
  buildDpsKillWindowLines,
  createKillWindowFactsComputer,
} from "@gladlog/analysis/src/utils/killWindowFacts";
import { computeOffensiveWindows } from "@gladlog/analysis/src/utils/offensiveWindows";
import { fmtTime } from "@gladlog/analysis/src/utils/renderGrid";
import {
  roundEndMs,
  SOLO_SHUFFLE_BRACKET,
} from "@gladlog/analysis/src/utils/roundEnd";
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { checkKillWindowWithinRound } from "../src/quality/promptQualityCheck";

// T12 ① a (user ruling 2026-10-10): a kill window does not run past the
// round's end. The gate reads the round's end off the prompt: `[MATCH END]`,
// and for a Solo Shuffle round the first `[DEATH]` line.
const header = (bracket: string) =>
  `  Spec: Restoration Shaman (Healer)  |  Bracket: ${bracket}  |  Result: Win  |  Duration: 1:40  |  Map: Tol'viron Arena`;
const DEATH =
  "1:38  [DEATH]  5(AWarrior) (Arms Warrior — enemy) | dampening: 25%";
const MATCH_END = "1:40  [MATCH END]   damp: 27%";
// the three line shapes, as the 605-file capture prints them (1-2-4 / 1-2-5)
const healerVulnerable = (span: string) =>
  `  [VULNERABLE] ${span} (12s) on Arcane Mage (Aesque-DefiasBrotherhood-EU): no major defensives, not punished — not accountable (no offensive CD was ready) (team damage 1k total); team offensive CDs ready at 1:28: none; your CC on cooldown; you cast no CC; your damage on it 0k; free 9s of 12s.`;
const healerKillWindow = (span: string, defenseless: string) =>
  `  [KILL WINDOW] ${span} on Restoration Druid (Chrisyo-TwistingNether-EU): team offensive CDs ready at 1:22: none; your CC on cooldown; you cast CC in this window; your damage on it 71k; free 12s of 17s, team min HP 58%; target defenseless ${defenseless}.`;
const dpsKillWindow = (span: string, defenseless: string) =>
  `  [KILL WINDOW] ${span} on Restoration Druid (Chrisyo-TwistingNether-EU): team burst 355k (defenseless ${defenseless}); team offensive CDs ready at 0:29: none.`;
const prompt = (bracket: string, ...lines: string[]) => [
  header(bracket),
  ...lines,
  DEATH,
  MATCH_END,
];

describe("checkKillWindowWithinRound", () => {
  it("Solo Shuffle: a span that ends at or before the first [DEATH] line passes", () => {
    expect(
      checkKillWindowWithinRound(
        prompt(
          SOLO_SHUFFLE_BRACKET,
          healerVulnerable("1:28–1:38"),
          healerKillWindow("1:22–1:38", "0:28–1:38"),
          dpsKillWindow("0:29–0:49", "0:28–1:38"),
        ),
      ),
    ).toEqual([]);
  });

  it("Solo Shuffle: a span that ends after the first [DEATH] line fails — the line's own span and the defenseless span it names", () => {
    // 1-2-4, before the cut: the log ran 2 s past the round-ending death
    const fails = checkKillWindowWithinRound(
      prompt(
        SOLO_SHUFFLE_BRACKET,
        healerVulnerable("1:28–1:40"),
        healerKillWindow("1:22–1:39", "0:28–1:40"),
        dpsKillWindow("0:29–0:49", "0:28–1:40"),
      ),
    );
    expect(fails).toHaveLength(4);
    expect(fails[0]).toContain("line 2: [VULNERABLE] 的区间 1:28–1:40");
    expect(fails[0]).toContain("第一条 [DEATH] 行在 1:38");
    expect(fails[1]).toContain("line 3: [KILL WINDOW] 的区间 1:22–1:39");
    expect(fails[2]).toContain("line 3: defenseless 区间 0:28–1:40");
    expect(fails[3]).toContain("line 4: defenseless 区间 0:28–1:40");
  });

  it("the first [DEATH] line is the earliest one, wherever it sits in the text", () => {
    const fails = checkKillWindowWithinRound([
      header(SOLO_SHUFFLE_BRACKET),
      healerVulnerable("1:20–1:32"),
      DEATH,
      "1:30  [DEATH]  2(FMage) (Frost Mage — friendly) | dampening: 24%",
      MATCH_END,
    ]);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("第一条 [DEATH] 行在 1:30");
  });

  it("any other bracket: the round goes on after a death — only [MATCH END] binds", () => {
    expect(
      checkKillWindowWithinRound(prompt("3v3", healerVulnerable("1:28–1:40"))),
    ).toEqual([]);
    const fails = checkKillWindowWithinRound(
      prompt("3v3", healerVulnerable("1:28–1:41")),
    );
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("[MATCH END]在 1:40");
  });

  it("a Solo Shuffle round nobody died in ends at [MATCH END]", () => {
    const lines = (span: string) => [
      header(SOLO_SHUFFLE_BRACKET),
      healerVulnerable(span),
      MATCH_END,
    ];
    expect(checkKillWindowWithinRound(lines("1:28–1:40"))).toEqual([]);
    expect(checkKillWindowWithinRound(lines("1:28–1:41"))).toHaveLength(1);
  });

  it("reads timeline lines only: a legend's mention of the tags has no span, and a prompt that states no end binds nothing", () => {
    expect(
      checkKillWindowWithinRound([
        header(SOLO_SHUFFLE_BRACKET),
        "  [KILL WINDOW] = a team damage burst on an enemy with no major defensive up; [VULNERABLE] = such a span nobody punished.",
        DEATH,
        MATCH_END,
      ]),
    ).toEqual([]);
    expect(
      checkKillWindowWithinRound([
        header(SOLO_SHUFFLE_BRACKET),
        healerVulnerable("1:28–1:40"),
      ]),
    ).toEqual([]);
  });
});

// Producer → gate, end to end: the windows `computeOffensiveWindows` returns,
// rendered by the DPS view's own formatter, under the `[DEATH]` / `[MATCH END]`
// lines of the same round.
describe("computeOffensiveWindows ⇄ checkKillWindowWithinRound", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  const T0 = 1_000_000;
  const at = (s: number) => T0 + s * 1000;
  const BARKSKIN = "22812";
  const unit = (id: string, over: Record<string, unknown>): any => ({
    id,
    isWellFormed: true,
    name: id,
    ownerId: "",
    reaction: CombatUnitReaction.Friendly,
    spec: CombatUnitSpec.None,
    info: {},
    damageIn: [],
    damageOut: [],
    healIn: [],
    healOut: [],
    absorbsIn: [],
    absorbsOut: [],
    actionIn: [],
    actionOut: [],
    auraEvents: [],
    spellCastEvents: [],
    castStartEvents: [],
    petSpellCastEvents: [],
    advancedActions: [],
    deathRecords: [],
    ...over,
  });
  const round = (bracket: string) => {
    const enemy = unit("e1", {
      name: "EnemyDruid",
      spec: CombatUnitSpec.Druid_Feral,
      reaction: CombatUnitReaction.Hostile,
      spellCastEvents: [
        {
          logLine: {
            event: LogEvent.SPELL_CAST_SUCCESS,
            timestamp: at(50),
            parameters: [],
          },
          timestamp: at(50),
          spellId: BARKSKIN,
          spellName: "Barkskin",
          srcUnitId: "e1",
          srcUnitName: "EnemyDruid",
          destUnitId: "e1",
          destUnitName: "EnemyDruid",
        },
      ],
    });
    // the round-ending death is a teammate's — the window's target lives on
    const fallen = unit("p2", {
      name: "Fallen",
      deathRecords: [{ timestamp: at(98.4) }],
    });
    const combat: any = {
      startTime: T0,
      endTime: at(100.7),
      startInfo: { bracket },
      units: { e1: enemy, p2: fallen },
    };
    const windows = computeOffensiveWindows([enemy], [], combat);
    const lines = [
      header(bracket),
      ...buildDpsKillWindowLines(
        windows,
        [enemy],
        createKillWindowFactsComputer(combat, [], [enemy]),
      ),
      `${fmtTime(98.4)}  [DEATH]  2(Fallen) (Frost Mage — friendly)`,
      `${fmtTime(100.7)}  [MATCH END]`,
    ];
    return { windows, lines, combat };
  };

  it("Solo Shuffle: the rendered span ends in the first [DEATH] line's second, and the gate passes", () => {
    const { windows, lines, combat } = round(SOLO_SHUFFLE_BRACKET);
    expect(windows).toHaveLength(1);
    expect(windows[0]!.toSeconds).toBe((roundEndMs(combat) - T0) / 1000);
    expect(lines[1]).toContain("[VULNERABLE]");
    expect(lines[1]).toContain(`–${fmtTime(98.4)} on `);
    expect(checkKillWindowWithinRound(lines)).toEqual([]);
  });

  it("negative control: the same window left running to the log's end fails the gate", () => {
    const { windows, lines, combat } = round(SOLO_SHUFFLE_BRACKET);
    const uncut = windows.map((w) => ({ ...w, toSeconds: 100.7 }));
    const enemy = combat.units.e1;
    lines[1] = buildDpsKillWindowLines(
      uncut,
      [enemy],
      createKillWindowFactsComputer(combat, [], [enemy]),
    )[0]!;
    const fails = checkKillWindowWithinRound(lines);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("[VULNERABLE] 的区间");
    expect(fails[0]).toContain(`–${fmtTime(100.7)} 结束于回合结束之后`);
  });

  it("3v3: the same round runs to the log's end, and the gate reads [MATCH END]", () => {
    const { windows, lines } = round("3v3");
    expect(windows[0]!.toSeconds).toBe(100.7);
    expect(checkKillWindowWithinRound(lines)).toEqual([]);
  });
});

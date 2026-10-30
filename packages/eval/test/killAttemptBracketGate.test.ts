/* eslint-disable @typescript-eslint/no-explicit-any */
import { ensureAnalysisData } from "@gladlog/analysis";
import {
  extractKillAttempts,
  formatKillAttemptsForContext,
} from "@gladlog/analysis/src/utils/killAttempts";
import { fmtTime } from "@gladlog/analysis/src/utils/renderGrid";
import { SOLO_SHUFFLE_BRACKET } from "@gladlog/analysis/src/utils/roundEnd";
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { checkKillAttemptBracketEnd } from "../src/quality/promptQualityCheck";

// T12 ① d (user ruling 2026-10-10): a kill-attempt line does not run past the
// target's death or the round's end.
const header = (bracket: string) =>
  `  Spec: Arms Warrior  |  Bracket: ${bracket}  |  Result: Win  |  Duration: 1:40  |  Map: Tol'viron Arena`;
const ROSTER = [
  '  <unit id="1" name="Owner-Realm-EU" spec="Arms Warrior" role="log owner">',
  '  <unit id="4" name="Mage-Realm-EU" spec="Arcane Mage" role="enemy">',
  '  <unit id="5" name="Rogue-Realm-EU" spec="Subtlety Rogue" role="enemy">',
];
const attempt = (span: string, target: string, outcome: string) =>
  `  [${span}] on ${target} — Recklessness burst (no stun) | opportunity: PRIME (no trinket, no 20-99% wall in hand) | team focus 94% (1.19M on target inside it, 1.19M incl. the 5 s after) | ${outcome}`;
const death = (at: string, unit: string) =>
  `${at}  [DEATH]  ${unit} (Subtlety Rogue — enemy) | dampening: 25%`;
const MATCH_END = "1:40  [MATCH END]   damp: 27%";

describe("checkKillAttemptBracketEnd", () => {
  it("passes: a KILL that ends at the death, a FAILED row that ended before it, a row on another target that runs across it", () => {
    expect(
      checkKillAttemptBracketEnd([
        header("3v3"),
        ...ROSTER,
        attempt("0:10–0:18", "Rogue-Realm-EU", "FAILED: not enough damage"),
        attempt("0:20–0:24", "Rogue-Realm-EU", "KILL"),
        // the Mage lives: a bracket across the Rogue's death is not about it
        attempt("0:15–0:30", "Mage-Realm-EU", "FAILED: healed through"),
        death("0:24", "5(SRogue)"),
        MATCH_END,
      ]),
    ).toEqual([]);
  });

  it("fails: a bracket that holds its target's death and runs on — FAILED (the reviewed line) or KILL", () => {
    const fails = checkKillAttemptBracketEnd([
      header("3v3"),
      ...ROSTER,
      attempt("0:10–0:30", "Rogue-Realm-EU", "FAILED: not enough damage"),
      attempt("0:20–0:26", "Rogue-Realm-EU", "KILL"),
      death("0:24", "5(SRogue)"),
      MATCH_END,
    ]);
    expect(fails).toHaveLength(2);
    expect(fails[0]).toContain(
      "line 5: KILL ATTEMPTS [0:10–0:30] on Rogue-Realm-EU 越过了目标的死亡(0:24 的 [DEATH] 行)",
    );
    expect(fails[1]).toContain("line 6: KILL ATTEMPTS [0:20–0:26]");
  });

  it("the target's FIRST [DEATH] line is the one a bracket is held to; a bracket opened after it is not judged against it", () => {
    expect(
      checkKillAttemptBracketEnd([
        header("3v3"),
        ...ROSTER,
        attempt("0:30–0:40", "Rogue-Realm-EU", "FAILED: not enough damage"),
        death("0:24", "5(SRogue)"),
        MATCH_END,
      ]),
    ).toEqual([]);
  });

  it("fails: a bracket that ends after the round's end — [MATCH END], or a Solo Shuffle round's first [DEATH] line", () => {
    const past = checkKillAttemptBracketEnd([
      header("3v3"),
      ...ROSTER,
      attempt("1:35–1:41", "Mage-Realm-EU", "FAILED: not enough damage"),
      MATCH_END,
    ]);
    expect(past).toHaveLength(1);
    expect(past[0]).toContain("结束于回合结束之后([MATCH END]在 1:40)");

    const lines = (bracket: string) => [
      header(bracket),
      ...ROSTER,
      // on the Mage, across the Rogue's death at 0:24
      attempt("0:15–0:30", "Mage-Realm-EU", "FAILED: healed through"),
      death("0:24", "5(SRogue)"),
      MATCH_END,
    ];
    expect(checkKillAttemptBracketEnd(lines("3v3"))).toEqual([]);
    const shuffle = checkKillAttemptBracketEnd(lines(SOLO_SHUFFLE_BRACKET));
    expect(shuffle).toHaveLength(1);
    expect(shuffle[0]).toContain("第一条 [DEATH] 行在 0:24");
  });

  it("a prompt with no KILL ATTEMPTS line, or with no stated end and no death of the target, has nothing to fail", () => {
    expect(
      checkKillAttemptBracketEnd([header("3v3"), ...ROSTER, MATCH_END]),
    ).toEqual([]);
    expect(
      checkKillAttemptBracketEnd([
        ...ROSTER,
        attempt("0:10–0:30", "Rogue-Realm-EU", "FAILED: not enough damage"),
      ]),
    ).toEqual([]);
  });
});

// Producer → gate: `extractKillAttempts` rows through the block's own
// formatter, under the target's `[DEATH]` line.
describe("extractKillAttempts ⇄ checkKillAttemptBracketEnd", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  const T0 = Date.UTC(2026, 7, 15);
  const ms = (s: number) => T0 + s * 1000;
  const unit = (id: string, over: Record<string, unknown> = {}): any => ({
    id,
    name: id,
    type: 1,
    spec: "265",
    reaction: 2,
    info: {},
    spellCastEvents: [],
    auraEvents: [],
    damageOut: [],
    damageIn: [],
    healIn: [],
    deathRecords: [],
    advancedActions: [],
    actionIn: [],
    actionOut: [],
    ...over,
  });
  const KIDNEY = "408";
  const stun = (fromS: number, durS: number): any[] =>
    [
      [LogEvent.SPELL_AURA_APPLIED, fromS],
      [LogEvent.SPELL_AURA_REMOVED, fromS + durS],
    ].map(([event, s]) => ({
      spellId: KIDNEY,
      spellName: "Kidney Shot",
      srcUnitId: "f1",
      srcUnitName: "f1",
      destUnitId: "e1",
      destUnitName: "e1",
      timestamp: ms(s as number),
      logLine: { event, timestamp: ms(s as number), parameters: [] },
      auraType: "DEBUFF",
    }));
  const hit = (atS: number): any => ({
    destUnitId: "e1",
    effectiveAmount: 60_000,
    logLine: {
      event: LogEvent.SPELL_DAMAGE,
      timestamp: ms(atS),
      parameters: [],
    },
  });
  // Kidney 40–45 (credit to 50), Recklessness at 46, the target dead at 48.4:
  // one death, two rows credited with it — the KILL and the row before it
  const round = () => {
    const e1 = unit("e1", {
      auraEvents: stun(40, 5),
      deathRecords: [{ timestamp: ms(48.4) }],
    });
    const f1 = unit("f1", {
      reaction: 1,
      spellCastEvents: [
        {
          spellId: "1719",
          spellName: "Recklessness",
          logLine: {
            event: LogEvent.SPELL_CAST_SUCCESS,
            timestamp: ms(46),
            parameters: [],
          },
        },
      ],
      damageOut: [hit(42), hit(47)],
    });
    const attempts = extractKillAttempts([f1], [e1], {
      startTime: T0,
      endTime: T0 + 300_000,
      startInfo: { zoneId: "1505" },
      units: { f1, e1 },
    } as any);
    const lines = (rows: typeof attempts) => [
      header("3v3"),
      '  <unit id="1" name="f1" spec="Arms Warrior" role="log owner">',
      '  <unit id="4" name="e1" spec="Subtlety Rogue" role="enemy">',
      ...formatKillAttemptsForContext(rows, [48.4]),
      `${fmtTime(48.4)}  [DEATH]  4(SRogue) (Subtlety Rogue — enemy)`,
      "5:00  [MATCH END]",
    ];
    return { attempts, lines };
  };

  it("the two rows of one death render inside the target's life, and the gate passes", () => {
    const { attempts, lines } = round();
    expect(attempts.map((a) => [a.anchor, a.killed, a.toSeconds])).toEqual([
      ["stun", false, 45],
      ["burst", true, 48.4],
    ]);
    const text = lines(attempts);
    expect(text.join("\n")).toContain("[0:40–0:45] on e1 — ");
    expect(text.join("\n")).toContain("[0:46–0:48] on e1 — ");
    expect(checkKillAttemptBracketEnd(text)).toEqual([]);
  });

  it("negative control: either row left running past the death fails the gate", () => {
    const { attempts, lines } = round();
    for (const i of [0, 1]) {
      const uncut = attempts.map((a, j) =>
        j === i ? { ...a, toSeconds: 52 } : a,
      );
      const fails = checkKillAttemptBracketEnd(lines(uncut));
      expect(fails).toHaveLength(1);
      expect(fails[0]).toContain(
        "–0:52] on e1 越过了目标的死亡(0:48 的 [DEATH] 行)",
      );
    }
  });
});

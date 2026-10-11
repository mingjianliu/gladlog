/* eslint-disable @typescript-eslint/no-explicit-any */
import { ensureAnalysisData } from "@gladlog/analysis";
import {
  extractSpiritOfRedemptionIntervals,
  isGhostAtRenderSecond,
} from "@gladlog/analysis/src/utils/combatStates";
import {
  extractKillAttempts,
  formatKillAttemptsForContext,
} from "@gladlog/analysis/src/utils/killAttempts";
import {
  buildDpsKillWindowLines,
  createKillWindowFactsComputer,
} from "@gladlog/analysis/src/utils/killWindowFacts";
import { computeOffensiveWindows } from "@gladlog/analysis/src/utils/offensiveWindows";
import { fmtTime } from "@gladlog/analysis/src/utils/renderGrid";
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { checkNoWindowAcrossSpiritOfRedemption } from "../src/quality/promptQualityCheck";

// F17 (user ruling 2026-10-11, option b): a Holy Priest in Spirit of
// Redemption form cannot be hit — no kill window and no kill-attempt bracket
// on that priest runs across the form. The shape is 174-1-1061's: the priest
// in the form 0:58–1:07, `[VULNERABLE] 1:06–1:26` on them.
const ROSTER = [
  '  <unit id="1" name="Owner-Realm-US" spec="Holy Paladin" role="log owner">',
  '  <unit id="5" name="Blessedxx-Tichondrius-US" spec="Holy Priest" role="enemy">',
  '  <unit id="6" name="Seleriss-Exodar-US" spec="Affliction Warlock" role="enemy">',
];
const state = (at: string, enemies: string) =>
  `${at}  [STATE]   friends 1(HPaladin):88 / enemies ${enemies}`;
const vulnerable = (
  span: string,
  who = "Holy Priest (Blessedxx-Tichondrius-US)",
) =>
  `  [VULNERABLE] ${span} (20s) on ${who}: no major defensives, never punished (team damage 5k total); team offensive CDs ready at 1:06: Zenith.`;
const killWindow = (span: string, defenseless: string) =>
  `  [KILL WINDOW] ${span} on Holy Priest (Blessedxx-Tichondrius-US): team burst 355k (defenseless ${defenseless}); team offensive CDs ready at 0:29: none.`;
const attempt = (span: string, target = "Blessedxx-Tichondrius-US") =>
  `  [${span}] on ${target} — Hammer of Justice opener (Full DR), 2 stuns | opportunity: trinket up (no softer target) | team focus 3% (0.09M on target inside it, 0.09M incl. the 5 s after) | FAILED: not enough damage`;
const GHOST_TICKS = [
  state("1:00", "5(HPriest):ghost 6(AWarlock):91"),
  state("1:04", "5(HPriest):ghost"),
  state("1:07", "5(HPriest):ghost 6(AWarlock):80"),
  state("1:10", "5(HPriest):95 6(AWarlock):80"),
];

describe("checkNoWindowAcrossSpiritOfRedemption", () => {
  it("passes: spans that stop at the form or start at its end (the boundary second is shared), and spans on the other enemy", () => {
    expect(
      checkNoWindowAcrossSpiritOfRedemption([
        ...ROSTER,
        vulnerable("0:40–1:00"),
        vulnerable("1:07–1:26"),
        killWindow("1:10–1:20", "1:07–1:26"),
        attempt("0:52–1:00"),
        attempt("1:07–1:12"),
        // the warlock is no ghost: a span across those seconds is its own
        vulnerable("0:40–1:26", "Affliction Warlock (Seleriss-Exodar-US)"),
        attempt("0:52–1:12", "Seleriss-Exodar-US"),
        ...GHOST_TICKS,
      ]),
    ).toEqual([]);
  });

  it("fails: 174-1-1061's window as it printed, a `defenseless` span and a bracket across the form", () => {
    const fails = checkNoWindowAcrossSpiritOfRedemption([
      ...ROSTER,
      vulnerable("1:06–1:26"),
      killWindow("1:10–1:20", "0:39–1:27"),
      attempt("0:52–1:12"),
      ...GHOST_TICKS,
    ]);
    expect(fails).toHaveLength(3);
    expect(fails[0]).toContain(
      "line 4: [VULNERABLE] 的区间 1:06–1:26 的目标 Blessedxx-Tichondrius-US 在其中 1:07 的 [STATE] 行上是 :ghost",
    );
    expect(fails[1]).toContain("line 5: defenseless 区间 0:39–1:27");
    expect(fails[1]).toContain("1:00、1:04、1:07");
    expect(fails[2]).toContain("line 6: KILL ATTEMPTS 括号 0:52–1:12");
  });

  it("no `:ghost` tick, or a target the roster does not resolve: nothing to read", () => {
    expect(
      checkNoWindowAcrossSpiritOfRedemption([
        ...ROSTER,
        vulnerable("1:06–1:26"),
        state("1:07", "5(HPriest):40"),
      ]),
    ).toEqual([]);
    expect(
      checkNoWindowAcrossSpiritOfRedemption([
        vulnerable("1:06–1:26"),
        ...GHOST_TICKS,
      ]),
    ).toEqual([]);
  });
});

// Producer → gate, end to end: the windows and the attempts the producers
// return, rendered by their own formatters, over `[STATE]` ticks built from
// the tick's own predicate for every second of the round.
describe("computeOffensiveWindows / extractKillAttempts ⇄ checkNoWindowAcrossSpiritOfRedemption", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  const T0 = Date.UTC(2026, 7, 15);
  const at = (s: number) => T0 + s * 1000;
  const BARKSKIN = "22812";
  const FORM = "215769";
  const KIDNEY = "408";
  const unit = (id: string, over: Record<string, unknown>): any => ({
    id,
    isWellFormed: true,
    name: id,
    ownerId: "",
    type: 1,
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
  const aura = (
    event: LogEvent,
    spellId: string,
    s: number,
    src: string,
    auraType: "BUFF" | "DEBUFF",
  ): any => ({
    spellId,
    spellName: spellId,
    srcUnitId: src,
    srcUnitName: src,
    destUnitId: "EnemyPriest",
    destUnitName: "EnemyPriest",
    timestamp: at(s),
    logLine: { event, timestamp: at(s), parameters: [] },
    auraType,
  });
  const span = (id: string, from: number, to: number, src: string, t: any) => [
    aura(LogEvent.SPELL_AURA_APPLIED, id, from, src, t),
    aura(LogEvent.SPELL_AURA_REMOVED, id, to, src, t),
  ];
  // Barkskin at 2 s (the only tracked wall: defenseless from its end); the
  // form 28.39–37.42 s; a Kidney Shot before the form and one after it
  const priest = (withForm: boolean) =>
    unit("EnemyPriest", {
      spec: CombatUnitSpec.Priest_Holy,
      reaction: CombatUnitReaction.Hostile,
      spellCastEvents: [
        {
          logLine: {
            event: LogEvent.SPELL_CAST_SUCCESS,
            timestamp: at(2),
            parameters: [],
          },
          timestamp: at(2),
          spellId: BARKSKIN,
          spellName: "Barkskin",
          srcUnitId: "EnemyPriest",
          srcUnitName: "EnemyPriest",
          destUnitId: "EnemyPriest",
          destUnitName: "EnemyPriest",
        },
      ],
      auraEvents: [
        ...span(KIDNEY, 22, 26, "Owner", "DEBUFF"),
        ...(withForm ? span(FORM, 28.39, 37.42, "EnemyPriest", "BUFF") : []),
        ...span(KIDNEY, 39, 42, "Owner", "DEBUFF"),
      ].sort((a, b) => a.timestamp - b.timestamp),
    });
  const render = (withForm: boolean) => {
    const enemy = priest(withForm);
    const hit = (s: number): any => ({
      destUnitId: "EnemyPriest",
      effectiveAmount: 60_000,
      logLine: {
        event: LogEvent.SPELL_DAMAGE,
        timestamp: at(s),
        parameters: [],
      },
    });
    const owner = unit("Owner", { damageOut: [hit(23), hit(40)] });
    const combat: any = {
      startTime: T0,
      endTime: at(60),
      startInfo: { bracket: "3v3", zoneId: "1505" },
      units: { Owner: owner, EnemyPriest: enemy },
    };
    const windows = computeOffensiveWindows([enemy], [owner], combat);
    const attempts = extractKillAttempts([owner], [enemy], combat);
    // the form as the `[STATE]` tick reads it — of the round WITH the form
    const forms = extractSpiritOfRedemptionIntervals(priest(true), combat);
    const ticks: string[] = [];
    for (let s = 0; s <= 60; s++)
      ticks.push(
        `${fmtTime(s)}  [STATE]   friends 1(X):90 / enemies 4(HPriest):${isGhostAtRenderSecond(forms, s) ? "ghost" : "80"}`,
      );
    const lines = [
      '  <unit id="1" name="Owner" spec="Subtlety Rogue" role="log owner">',
      '  <unit id="4" name="EnemyPriest" spec="Holy Priest" role="enemy">',
      ...buildDpsKillWindowLines(
        windows,
        [enemy],
        createKillWindowFactsComputer(combat, [owner], [enemy]),
      ),
      ...formatKillAttemptsForContext(attempts),
      ...ticks,
    ];
    return { windows, attempts, lines };
  };

  it("with the form: the spans stop at it and resume after it, the stun chain is two attempts, and the gate passes", () => {
    const { windows, attempts, lines } = render(true);
    expect(windows.map((w) => [w.fromSeconds, w.toSeconds])).toEqual([
      [10, 28.39],
      [37.42, 60],
    ]);
    expect(attempts.map((a) => [a.fromSeconds, a.toSeconds])).toEqual([
      [22, 26],
      [39, 42],
    ]);
    expect(lines.filter((l) => l.includes(":ghost"))).toHaveLength(9);
    expect(checkNoWindowAcrossSpiritOfRedemption(lines)).toEqual([]);
  });

  it("negative control: the spans and the bracket the same round has WITHOUT the cut, over the same ticks, fail the gate", () => {
    const { windows, attempts, lines } = render(false);
    expect(windows.map((w) => [w.fromSeconds, w.toSeconds])).toEqual([
      [10, 60],
    ]);
    expect(attempts.map((a) => [a.fromSeconds, a.toSeconds])).toEqual([
      [22, 42],
    ]);
    const fails = checkNoWindowAcrossSpiritOfRedemption(lines);
    // the window line (its own span, or its burst's `defenseless` span) and
    // the attempt's bracket
    expect(fails.length).toBeGreaterThanOrEqual(2);
    expect(fails.some((f) => f.includes("KILL ATTEMPTS 括号"))).toBe(true);
    expect(
      fails.some(
        (f) => f.includes("defenseless 区间") || f.includes("的区间 0:10–1:00"),
      ),
    ).toBe(true);
  });
});

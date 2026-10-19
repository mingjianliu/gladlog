/* eslint-disable @typescript-eslint/no-explicit-any */
import { ensureAnalysisData } from "@gladlog/analysis";
import { emitEnemyDefEntries } from "@gladlog/analysis/src/context/timelineSections/enemyDef";
import {
  buildDpsKillWindowLines,
  createKillWindowFactsComputer,
} from "@gladlog/analysis/src/utils/killWindowFacts";
import { computeOffensiveWindows } from "@gladlog/analysis/src/utils/offensiveWindows";
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  checkNoWindowAcrossOwnSave,
  checkNoWindowAcrossOwnWall,
} from "../src/quality/promptQualityCheck";

// R08 (d), gap 1 (2026-10-13): "defenseless" says nothing was up — no kill
// window on a unit runs across a 20–99 % wall that unit put up itself. The
// shape is f4da82c5 round 5's: `defenseless 1:35–2:51` on a hunter whose
// Survival of the Fittest line sits at 2:04.
const ROSTER = [
  '  <unit id="1" name="Owner-Realm-US" spec="Frost Mage" role="log owner">',
  '  <unit id="4" name="Bärröw-DunModr-EU" spec="Beast Mastery Hunter" role="enemy">',
  '  <unit id="5" name="Shadowsdoom-Haomarush-EU" spec="Restoration Druid" role="enemy">',
];
const HUNTER = "Beast Mastery Hunter (Bärröw-DunModr-EU)";
const DRUID = "Restoration Druid (Shadowsdoom-Haomarush-EU)";
const killWindow = (span: string, defenseless: string, who = HUNTER) =>
  `  [KILL WINDOW] ${span} on ${who}: team burst 1092k (defenseless ${defenseless}); team offensive CDs ready at 1:58: none.`;
const healerKillWindow = (span: string, defenseless: string) =>
  `  [KILL WINDOW] ${span} on ${HUNTER}: team offensive CDs ready at 1:58: none; your damage on it 3k; target defenseless ${defenseless}.`;
const vulnerable = (span: string, who = HUNTER) =>
  `  [VULNERABLE] ${span} (76s) on ${who}: no major defensives, never punished (team damage 5k total); team offensive CDs ready at 1:35: none.`;
const own = (
  at: string,
  label: string,
  who = "4(BMHunter) (Beast Mastery Hunter)",
) => `${at}  [ENEMY DEF]   ${who}: ${label} (at 60% HP)`;
const SOTF = own("2:04", "Survival of the Fittest (25%, 8.0s)");

describe("checkNoWindowAcrossOwnWall", () => {
  it("fails: f4da82c5 round 5 as it printed — the `defenseless` span and a burst's own span across the hunter's Survival of the Fittest", () => {
    const fails = checkNoWindowAcrossOwnWall([
      ...ROSTER,
      killWindow("1:58–2:12", "1:35–2:51"),
      killWindow("2:11–2:26", "1:35–2:51"),
      healerKillWindow("1:58–2:12", "1:35–2:51"),
      vulnerable("1:35–2:51"),
      SOTF,
    ]);
    expect(fails).toHaveLength(6);
    expect(fails[0]).toContain(
      "line 4: [KILL WINDOW] 的区间 1:58–2:12 的目标 Bärröw-DunModr-EU 在其中 2:04 Survival of the Fittest 自己开了 20–99% 的墙",
    );
    expect(fails[1]).toContain("line 4: defenseless 区间 1:35–2:51");
    // the second burst starts after the wall's line: only its defenseless span
    expect(fails[2]).toContain("line 5: defenseless 区间 1:35–2:51");
    expect(fails[3]).toContain("line 6: [KILL WINDOW] 的区间 1:58–2:12");
    expect(fails[4]).toContain("line 6: defenseless 区间 1:35–2:51");
    expect(fails[5]).toContain("line 7: [VULNERABLE] 的区间 1:35–2:51");
  });

  it("passes: the spans as the cut leaves them — ending on the wall's second, starting again in the second the wall ended", () => {
    expect(
      checkNoWindowAcrossOwnWall([
        ...ROSTER,
        vulnerable("1:35–2:04"),
        killWindow("2:13–2:26", "2:12–2:51"),
        // the druid pressed nothing: a span across those seconds is its own
        vulnerable("1:35–2:51", DRUID),
        SOTF,
      ]),
    ).toEqual([]);
  });

  it("a wall on the span's first or last printed second is the cut itself; one second further in is not", () => {
    // 2c6e85ec round 1's shape: a wall that lasted 1.0 s — the next span
    // starts in the second after the line's
    const brief = own("1:38", "Divine Protection (20%, 1.0s — removed early)");
    expect(
      checkNoWindowAcrossOwnWall([
        ...ROSTER,
        vulnerable("1:20–1:38"),
        vulnerable("1:38–1:50"),
        brief,
      ]),
    ).toEqual([]);
    expect(
      checkNoWindowAcrossOwnWall([...ROSTER, vulnerable("1:20–1:39"), brief]),
    ).toHaveLength(1);
    expect(
      checkNoWindowAcrossOwnWall([...ROSTER, vulnerable("1:37–1:50"), brief]),
    ).toHaveLength(1);
  });

  it("every wall form is read: an aura whose end the log never showed, one still up at the round's end, one dispelled", () => {
    for (const label of [
      "Greater Invisibility (60%, end not logged)",
      "Barkskin (30%, 7.1s — still up when the round ended)",
      "Ancient of Lore (30%, 10.0s — removed early)",
      "Blur (25%, 3.2s — dispelled by 1(FMage)'s Spellsteal)",
    ])
      expect(
        checkNoWindowAcrossOwnWall([
          ...ROSTER,
          vulnerable("1:35–2:51"),
          own("2:04", label),
        ]),
        label,
      ).toHaveLength(1);
  });

  it("not read: a redirect that prints a percentage (Roar of Sacrifice), an immunity, an external, another unit's wall, a wall with no interval", () => {
    for (const line of [
      // rulings A20 + U3: no wall, whatever its line looks like
      own("2:04", "Roar of Sacrifice (25%, 10.0s)"),
      own("2:04", "Aspect of the Turtle (immune, 8.0s)"),
      "2:04  [ENEMY DEF]   5(RDruid) (Restoration Druid): Ironbark → 4(BMHunter) (12.0s) (target at 60% HP)",
      own("2:04", "Barkskin (20%, 12.0s)", "5(RDruid) (Restoration Druid)"),
      // went up as the round ended: no length is printed
      own("2:04", "Survival of the Fittest (25%)"),
      // a length that prints 0.0s is no interval
      own("2:04", "Survival of the Fittest (25%, 0.0s — removed early)"),
    ])
      expect(
        checkNoWindowAcrossOwnWall([...ROSTER, vulnerable("1:35–2:51"), line]),
        line,
      ).toEqual([]);
  });

  it("a target the roster does not resolve, or a prompt with no wall line: nothing to read", () => {
    expect(checkNoWindowAcrossOwnWall([vulnerable("1:35–2:51"), SOTF])).toEqual(
      [],
    );
    expect(
      checkNoWindowAcrossOwnWall([...ROSTER, vulnerable("1:35–2:51")]),
    ).toEqual([]);
  });
});

// Producer → gate, end to end: the windows `computeOffensiveWindows` returns
// and the `[ENEMY DEF]` lines of the same round, each through its own
// renderer.
describe("computeOffensiveWindows + [ENEMY DEF] ⇄ checkNoWindowAcrossOwnWall", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  const T0 = Date.UTC(2026, 7, 19);
  const at = (s: number) => T0 + s * 1000;
  const BARKSKIN = "22812";
  const SURVIVAL_OF_THE_FITTEST = "264735";
  const ANCIENT_OF_LORE = "473909";
  const ROAR_OF_SACRIFICE = "53480";
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
  const aura = (event: LogEvent, spellId: string, s: number): any => ({
    spellId,
    spellName: spellId,
    srcUnitId: "EnemyHunter",
    srcUnitName: "EnemyHunter",
    destUnitId: "EnemyHunter",
    destUnitName: "EnemyHunter",
    timestamp: at(s),
    logLine: { event, timestamp: at(s), parameters: [] },
    auraType: "BUFF",
  });
  const up = (id: string, from: number, to: number) => [
    aura(LogEvent.SPELL_AURA_APPLIED, id, from),
    aura(LogEvent.SPELL_AURA_REMOVED, id, to),
  ];
  const cast = (spellId: string, s: number): any => ({
    logLine: {
      event: LogEvent.SPELL_CAST_SUCCESS,
      timestamp: at(s),
      parameters: [],
    },
    timestamp: at(s),
    spellId,
    spellName: spellId,
    srcUnitId: "EnemyHunter",
    srcUnitName: "EnemyHunter",
    destUnitId: "EnemyHunter",
    destUnitName: "EnemyHunter",
  });
  // Barkskin at 2 s is the one roster wall the unit pressed — a press the
  // state machine times (8 s for this unit): defenseless from its end. Then
  // what the unit put up inside that span.
  const hunter = (auras: any[], casts: any[] = []) =>
    unit("EnemyHunter", {
      spec: CombatUnitSpec.Hunter_BeastMastery,
      reaction: CombatUnitReaction.Hostile,
      spellCastEvents: [cast(BARKSKIN, 2), ...casts],
      auraEvents: [...up(BARKSKIN, 2, 10), ...auras].sort(
        (a, b) => a.timestamp - b.timestamp,
      ),
    });
  const render = (windowsOf: any, linesOf: any) => {
    const owner = unit("Owner", {});
    const combat = (enemy: any): any => ({
      startTime: T0,
      endTime: at(60),
      startInfo: { bracket: "3v3", zoneId: "1505" },
      units: { Owner: owner, EnemyHunter: enemy },
    });
    const windows = computeOffensiveWindows(
      [windowsOf],
      [owner],
      combat(windowsOf),
    );
    const def: string[] = [];
    emitEnemyDefEntries({
      matchStartMs: T0,
      matchEndSeconds: 60,
      enemies: [linesOf],
      enemyPid: () => "4(BMHunter)",
      friends: [owner],
      roundBounds: undefined,
      pid: () => "1(FMage)",
      actorLabel: () => "1(FMage)",
      addEntry: (_t: number, line: string) => def.push(line),
      _allUnits: [owner, linesOf],
    } as never);
    const lines = [
      '  <unit id="1" name="Owner" spec="Frost Mage" role="log owner">',
      '  <unit id="4" name="EnemyHunter" spec="Beast Mastery Hunter" role="enemy">',
      ...buildDpsKillWindowLines(
        windows,
        [windowsOf],
        createKillWindowFactsComputer(combat(windowsOf), [owner], [windowsOf]),
      ),
      ...def,
    ];
    return { windows, def, lines };
  };
  // a pressed wall the roster does not hold, an aura of a roster wall with
  // no cast behind it, and a redirect that is no wall
  const pressed = hunter(
    [
      ...up(SURVIVAL_OF_THE_FITTEST, 24.6, 32.6),
      ...up(ANCIENT_OF_LORE, 40.4, 44.2),
      ...up(ROAR_OF_SACRIFICE, 50, 55),
    ],
    [cast(SURVIVAL_OF_THE_FITTEST, 24.6), cast(ROAR_OF_SACRIFICE, 50)],
  );

  it("the spans stop where each wall's aura begins and resume where it ends; the redirect cuts nothing; the gate passes", () => {
    const { windows, def, lines } = render(pressed, pressed);
    expect(
      def.map((l) => l.slice(0, l.indexOf(")", l.indexOf("): ") + 3) + 1)),
    ).toEqual([
      "0:02  [ENEMY DEF]   4(BMHunter) (Beast Mastery Hunter): Barkskin (20%, 8.0s)",
      "0:24  [ENEMY DEF]   4(BMHunter) (Beast Mastery Hunter): Survival of the Fittest (25%, 8.0s)",
      "0:40  [ENEMY DEF]   4(BMHunter) (Beast Mastery Hunter): Ancient of Lore (30%, 3.8s)", // a copy no press put up: never early on length (F15 C5)
      "0:50  [ENEMY DEF]   4(BMHunter) (Beast Mastery Hunter): Roar of Sacrifice (25%, 5.0s — removed early)",
    ]);
    expect(windows.map((w) => [w.fromSeconds, w.toSeconds])).toEqual([
      [10, 24.6],
      [32.6, 40.4],
      [44.2, 60],
    ]);
    expect(checkNoWindowAcrossOwnWall(lines)).toEqual([]);
  });

  it("negative control: the span the same round has WITHOUT the walls, over the lines of the round with them, fails the gate once per wall line it runs across", () => {
    const { windows, lines } = render(hunter([]), pressed);
    expect(windows.map((w) => [w.fromSeconds, w.toSeconds])).toEqual([
      [10, 60],
    ]);
    const fails = checkNoWindowAcrossOwnWall(lines);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain(
      "0:24 Survival of the Fittest、0:40 Ancient of Lore 自己开了",
    );
    expect(fails[0]).not.toContain("Roar of Sacrifice");
  });
});

// fact1215 R7 (2026-10-18, user approved): the same invariant for the
// target's own immunity and absorb shield — 3867e9ef's Vanish inside
// `defenseless 1:27–2:21`, 1120cb61's 494k Anti-Magic Shell.
describe("checkNoWindowAcrossOwnSave", () => {
  const VANISH = own("2:04", "Vanish (immune, end not logged)");
  it("fails: an immunity and an absorb shield inside the spans", () => {
    expect(
      checkNoWindowAcrossOwnSave([
        ...ROSTER,
        killWindow("1:58–2:12", "1:35–2:51"),
        VANISH,
      ]),
    ).toHaveLength(2);
    expect(
      checkNoWindowAcrossOwnSave([
        ...ROSTER,
        vulnerable("1:35–2:51"),
        own("2:04", "Anti-Magic Shell (absorb 494k, 3.5s)"),
        own("2:30", "Cloak of Shadows (immune to magic, 5.0s)"),
      ]),
    ).toHaveLength(1);
  });
  it("passes: the cut spans; a heal, a rewind, an external and another unit's save", () => {
    expect(
      checkNoWindowAcrossOwnSave([
        ...ROSTER,
        vulnerable("1:35–2:04"),
        killWindow("2:13–2:26", "2:07–2:51"),
        VANISH,
        own("2:30", "Crimson Vial (heal, 4.0s)"),
        own("2:31", "Alter Time (rewind, 3.0s)"),
        vulnerable("1:35–2:51", DRUID),
      ]),
    ).toEqual([]);
  });
});

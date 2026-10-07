import { describe, expect, it } from "vitest";

import {
  checkBrokeOutRefConsistency,
  checkEnemyDefRefConsistency,
  checkGuardianSpiritSaveClause,
} from "../src/quality/promptQualityCheck";

/**
 * GH #97: KILL ATTEMPTS `popped X` / `saved by external (X)` ⇒ an
 * `[ENEMY DEF]` line naming X inside the attribution span. Keyed on the
 * legend line so prompts rendered with the flag off are not accused.
 * Triage 2026-09-29 (enemy-def F-E22 / crisis-external F-E22b): the span is
 * the attempt itself, `[from, to]` — a save pressed in the kill-credit slack
 * is no longer a cause — or the second of an `X [up since m:ss]` mark.
 */
const LEGEND =
  "  [ENEMY DEF] = an enemy pressed a defensive at that second: `(N%, Ts)` = official damage reduction and the";
const ATTEMPT = (span: string, tail: string) =>
  `  [${span}] on Osiklm-Archimonde-EU — Avatar burst (no stun) | opportunity: trinket up (no softer target) | team focus 55% (1.23M on target) | FAILED: ${tail}`;

/** the roster lines a rendered unit name is resolved through */
const ROSTER = [
  '  <unit id="4" name="Osiklm-Archimonde-EU" spec="Outlaw Rogue" role="enemy">',
  '  <unit id="5" name="Chrisyo-TwistingNether-EU" spec="Restoration Druid" role="enemy">',
  '  <unit id="6" name="Aesque-DefiasBrotherhood-EU" spec="Holy Priest" role="enemy">',
];

describe("checkEnemyDefRefConsistency", () => {
  it("B4a (2026-09-25): `self-saved (X)` needs a `(self-save)` [ENEMY DEF] line for X in the span", () => {
    const ok = [
      LEGEND,
      "2:16  [ENEMY DEF]   4(HPriest) (Holy Priest): Guardian Spirit (self-save) (at 50% HP)",
      "2:20  [ENEMY DEF]   4(HPriest) (Holy Priest): Desperate Prayer (self-save) (at 75% HP)",
      ATTEMPT("2:14–2:24", "self-saved (Guardian Spirit/Desperate Prayer)"),
    ];
    expect(checkEnemyDefRefConsistency(ok)).toEqual([]);
    const missing = [
      LEGEND,
      ATTEMPT("2:14–2:24", "self-saved (Guardian Spirit)"),
    ];
    expect(checkEnemyDefRefConsistency(missing)).toHaveLength(1);
  });

  it("passes when the named wall / external has a line inside the span (± the cast/aura pairing slack)", () => {
    const lines = [
      LEGEND,
      "0:25  [ENEMY DEF]   4(ORogue) (Outlaw Rogue): Cloak of Shadows (immune, 5.0s)",
      "1:03  [ENEMY DEF]   5(RDruid) (Restoration Druid): Ironbark → 4(ORogue) (6.6s)",
      "1:44  [ENEMY DEF]   5(RDruid) (Restoration Druid): Barkskin (20%, 12.0s)",
      "2:37  [ENEMY DEF]   4(ORogue) (Outlaw Rogue): Cloak of Shadows (immune, 2.4s — removed early)",
      ATTEMPT("0:42–1:02", "popped Ironbark"), // 1:03 = to + 1, inside the 2 s pairing slack
      ATTEMPT("1:41–1:44", "popped Barkskin"),
      ATTEMPT("2:30–2:36", "saved by external (Ironbark/Cloak of Shadows)"), // 2:37 = to + 1; Ironbark at 2:35
      "1:03  [ENEMY DEF]   5(RDruid) (Restoration Druid): Ironbark → 4(ORogue) (6.6s)",
      "2:35  [ENEMY DEF]   5(RDruid) (Restoration Druid): Ironbark → 4(ORogue)",
    ];
    expect(checkEnemyDefRefConsistency(lines)).toEqual([]);
  });

  it("`forced a full immunity [up since m:ss]` needs an [ENEMY DEF] line at that second", () => {
    const tail =
      "forced a full immunity [up since 0:04] (a win — re-open after it drops)";
    const ok = [
      LEGEND,
      "0:05  [ENEMY DEF]   5(HPaladin) (Holy Paladin): Blessing of Protection → 4(ORogue) (10.0s)",
      ATTEMPT("0:10–0:15", tail),
      ATTEMPT("0:10–0:15", `target trinketed out; ${tail}`),
    ];
    expect(checkEnemyDefRefConsistency(ok)).toEqual([]);
    const missing = [
      LEGEND,
      "0:12  [ENEMY DEF]   5(HPaladin) (Holy Paladin): Blessing of Protection → 4(ORogue) (10.0s)",
      ATTEMPT("0:10–0:15", tail),
    ];
    expect(checkEnemyDefRefConsistency(missing)).toHaveLength(1);
    // without the mark the immunity cause names nothing and is not checked
    expect(
      checkEnemyDefRefConsistency([
        LEGEND,
        ATTEMPT(
          "0:10–0:15",
          "forced a full immunity (a win — re-open after it drops)",
        ),
      ]),
    ).toEqual([]);
  });

  it("fails when the wall named by KILL ATTEMPTS has no [ENEMY DEF] line in the span", () => {
    const lines = [
      LEGEND,
      "1:44  [ENEMY DEF]   5(RDruid) (Restoration Druid): Barkskin (20%, 12.0s)",
      ATTEMPT("0:42–1:02", "popped Ironbark"),
      ATTEMPT("0:10–0:20", "popped Barkskin"), // Barkskin exists, but at 1:44
    ];
    const f = checkEnemyDefRefConsistency(lines);
    expect(f).toHaveLength(2);
    expect(f[0]).toContain('"Ironbark"');
    expect(f[1]).toContain('"Barkskin"');
    expect(f[1]).toContain("[0:10–0:20]"); // the attempt's own span
  });

  it("a save whose only line sits in the kill-credit slack after the span is not a valid cause (F-E22 rule 3′)", () => {
    const lines = [
      LEGEND,
      // fa5e6c66: the attempt ran 1:39–1:59, Divine Protection went up at 2:02
      "2:02  [ENEMY DEF]   5(HPaladin) (Holy Paladin): Divine Protection (20%, 8.0s)",
      ATTEMPT("1:39–1:59", "popped Divine Protection"),
    ];
    const f = checkEnemyDefRefConsistency(lines);
    expect(f).toHaveLength(1);
    expect(f[0]).toContain('"Divine Protection"');
  });

  it("`X [up since m:ss]` needs the [ENEMY DEF] line at that second, not inside the span (F-E22 rule 2)", () => {
    const ok = [
      LEGEND,
      "0:18  [ENEMY DEF]   6(FDruid) (Feral Druid): Barkskin (30%, 12.0s)",
      ATTEMPT("0:25–0:29", "popped Barkskin [up since 0:18]"),
      "3:31  [ENEMY DEF]   4(HPriest) (Holy Priest): Guardian Spirit (self-save)",
      ATTEMPT(
        "3:39–3:58",
        "self-saved (Guardian Spirit [up since 3:31]/Desperate Prayer)",
      ),
      "3:45  [ENEMY DEF]   4(HPriest) (Holy Priest): Desperate Prayer (self-save)",
    ];
    expect(checkEnemyDefRefConsistency(ok)).toEqual([]);
    const wrongSecond = [
      LEGEND,
      "0:26  [ENEMY DEF]   6(FDruid) (Feral Druid): Barkskin (30%, 12.0s)",
      ATTEMPT("0:25–0:29", "popped Barkskin [up since 0:18]"),
    ];
    const f = checkEnemyDefRefConsistency(wrongSecond);
    expect(f).toHaveLength(1);
    expect(f[0]).toContain("[0:18–0:18]");
  });

  it("stamp-mode names (`X@m:ss`) are compared without the stamp; other FAILED reasons are ignored", () => {
    const lines = [
      LEGEND,
      "1:44  [ENEMY DEF]   5(RDruid) (Restoration Druid): Barkskin (20%, 12.0s)",
      ATTEMPT("1:41–1:44", "popped Barkskin@1:44"),
      ATTEMPT("1:55–2:10", "healed through"),
      ATTEMPT(
        "2:24–2:44",
        "forced a full immunity (a win — re-open after it drops)",
      ),
      ATTEMPT("2:41–2:42", "target trinketed out"),
    ];
    expect(checkEnemyDefRefConsistency(lines)).toEqual([]);
  });

  it("is silent without the legend (the [ENEMY DEF] line is off)", () => {
    expect(
      checkEnemyDefRefConsistency([ATTEMPT("0:42–1:02", "popped Ironbark")]),
    ).toEqual([]);
  });
  it("compares the unit when the roster resolves the target: the same spell on ANOTHER enemy is no cause", () => {
    const wall = (pid: string) =>
      `1:44  [ENEMY DEF]   ${pid} (Restoration Druid): Barkskin (20%, 12.0s)`;
    const external = (to: string) =>
      `1:42  [ENEMY DEF]   5(RDruid) (Restoration Druid): Ironbark → ${to} (6.6s)`;
    const run = (...defs: string[]) =>
      checkEnemyDefRefConsistency([
        LEGEND,
        ...ROSTER,
        ...defs,
        ATTEMPT("1:41–1:44", "popped Barkskin/Ironbark"),
      ]);
    // the target (Osiklm = unit 4) pressed the wall and received the external
    expect(run(wall("4(ORogue)"), external("4(ORogue)"))).toEqual([]);
    // the druid's own Barkskin, and an Ironbark thrown on unit 6
    const f = run(wall("5(RDruid)"), external("6(HPriest)"));
    expect(f).toHaveLength(2);
    expect(f[0]).toContain('"Barkskin"');
    expect(f[1]).toContain('"Ironbark"');
    // an area save is on nobody in particular: not compared
    expect(
      checkEnemyDefRefConsistency([
        LEGEND,
        ...ROSTER,
        "1:42  [ENEMY DEF]   5(RDruid) (Restoration Druid): Rallying Cry (area)",
        ATTEMPT("1:41–1:44", "popped Rallying Cry"),
      ]),
    ).toEqual([]);
    // no roster → the name cannot be resolved → spell and time only
    expect(
      checkEnemyDefRefConsistency([
        LEGEND,
        wall("5(RDruid)"),
        ATTEMPT("1:41–1:44", "popped Barkskin"),
      ]),
    ).toEqual([]);
  });
});

/** Triage 2026-09-29, enemy-def F-E21: `broke out (X)` ⇒ an `[ENEMY TRINKET]`
 * line showing X breaking a control inside the attempt's credit window. */
describe("checkBrokeOutRefConsistency", () => {
  it("passes when the break line sits in [from, to + slack], names the ability and says what it broke", () => {
    const lines = [
      "3:12  [ENEMY TRINKET]   4(HPaladin) used Will to Survive out of Leg Sweep (by 1(MMonk)) (target at 80% HP)",
      ATTEMPT("3:11–3:12", "broke out (Will to Survive)"),
      "2:21  [ENEMY TRINKET]   3(FWarrior) used Berserker Shout out of Paralysis (by 1(MMonk)) [friendly offensive CD active] (target at 62% HP)",
      ATTEMPT(
        "2:15–2:19",
        "broke out (Berserker Shout); forced a full immunity (a win — re-open after it drops)",
      ),
    ];
    expect(checkBrokeOutRefConsistency(lines)).toEqual([]);
  });

  it("fails when the only line is a trinket, is outside the window, or broke nothing", () => {
    const lines = [
      "3:12  [ENEMY TRINKET]   4(HPaladin) used PvP trinket out of Leg Sweep (by 1(MMonk))",
      "4:40  [ENEMY TRINKET]   4(HPaladin) used Will to Survive out of Maim (by 2(FDruid))",
      "3:13  [ENEMY TRINKET]   5(DPriest) used Will of the Forsaken (target at 80% HP)",
      ATTEMPT("3:11–3:12", "broke out (Will to Survive)"),
      ATTEMPT("3:11–3:12", "broke out (Will of the Forsaken)"),
    ];
    const f = checkBrokeOutRefConsistency(lines);
    expect(f).toHaveLength(2);
    expect(f[0]).toContain('"Will to Survive"');
    expect(f[1]).toContain('"Will of the Forsaken"');
  });

  it("compares the unit when the roster resolves the target: another enemy's break is not this target's", () => {
    const line = (pid: string) =>
      `3:12  [ENEMY TRINKET]   ${pid} used Blink out of Leg Sweep (by 1(MMonk)) (target at 80% HP)`;
    const attempt = ATTEMPT("3:11–3:12", "broke out (Blink)");
    expect(
      checkBrokeOutRefConsistency([...ROSTER, line("4(ORogue)"), attempt]),
    ).toEqual([]);
    const f = checkBrokeOutRefConsistency([
      ...ROSTER,
      line("6(HPriest)"),
      attempt,
    ]);
    expect(f).toHaveLength(1);
    expect(f[0]).toContain("that unit");
    // no roster → not compared
    expect(checkBrokeOutRefConsistency([line("6(HPriest)"), attempt])).toEqual(
      [],
    );
  });

  it("ignores every other FAILED cause", () => {
    expect(
      checkBrokeOutRefConsistency([
        ATTEMPT("0:42–1:02", "target trinketed out"),
        ATTEMPT("1:41–1:44", "popped Barkskin"),
      ]),
    ).toEqual([]);
  });
});

describe("checkGuardianSpiritSaveClause (B18)", () => {
  const ok = [
    "2:12  [TEAM] [CD]   3(HPriest) (Holy Priest): Guardian Spirit → 1(AWarrior) | save triggered 0.5s later (2:12): a killing blow was prevented, healed 353k",
    "0:21  [TEAM] [CD]   3(HPriest) (Holy Priest): Guardian Spirit → 2(SHunter) | save triggered 5.4s later (0:26): a killing blow was prevented, healed 348k",
    "2:44  [ENEMY DEF]   4(HPriest) (Holy Priest): Guardian Spirit → 5(FDKnight) (8.3s — removed early) [friendly offensive CD active] (target at 29% HP) | save triggered 5.8s later (2:49): a killing blow was prevented, healed 172k | during it: 1(AWarrior) 0k on target · no damage on any enemy player · 0 of 8 s",
    "0:33  [YOU] [CD]   Guardian Spirit → 2(SHunter) (41% HP) | save triggered 2.0s later (0:35): a killing blow was prevented | dampening: 20%",
    // the legend quotes the shape and is not a clause
    "  `| save triggered Ns later (m:ss)` on a Guardian Spirit line = at m:ss the buff absorbed a hit that would have",
    // a Guardian Spirit line with no clause is not checked
    "1:08  [ENEMY DEF]   4(HPriest) (Holy Priest): Guardian Spirit → 5(FDKnight) (12.0s) (target at 58% HP)",
  ];
  it("passes the rendered forms", () => {
    expect(checkGuardianSpiritSaveClause(ok)).toEqual([]);
  });
  it.each([
    [
      "a stamp that is not the line's second plus the delay",
      "0:21  [TEAM] [CD]   3(HPriest) (Holy Priest): Guardian Spirit → 2(SHunter) | save triggered 5.4s later (0:36): a killing blow was prevented, healed 348k",
    ],
    [
      "a delay past the predicate's window",
      "0:21  [TEAM] [CD]   3(HPriest) (Holy Priest): Guardian Spirit → 2(SHunter) | save triggered 16.0s later (0:37): a killing blow was prevented, healed 348k",
    ],
    [
      "the clause on another spell's line",
      "0:21  [TEAM] [CD]   3(HPriest) (Holy Priest): Pain Suppression → 2(SHunter) | save triggered 5.4s later (0:26): a killing blow was prevented, healed 348k",
    ],
    [
      "a heal of 0k",
      "0:21  [TEAM] [CD]   3(HPriest) (Holy Priest): Guardian Spirit → 2(SHunter) | save triggered 5.4s later (0:26): a killing blow was prevented, healed 0k",
    ],
    [
      "a clause the gate cannot read",
      "0:21  [TEAM] [CD]   3(HPriest) (Holy Priest): Guardian Spirit → 2(SHunter) | save triggered later (0:26): a killing blow was prevented",
    ],
  ])("fails %s", (_why, line) => {
    expect(checkGuardianSpiritSaveClause([line])).toHaveLength(1);
  });
});

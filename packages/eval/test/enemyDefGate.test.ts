import { describe, expect, it } from "vitest";

import {
  checkBrokeOutRefConsistency,
  checkEnemyDefEndNotLogged,
  checkEnemyDefRefConsistency,
  checkEnemyDefSaveEffect,
  checkGuardianSpiritSaveClause,
  checkKarmaFedClause,
  checkResReturnAnnounced,
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

  it("ruling D8 (2026-10-10): `self-saved (Feign Death)` / a proc is found on its effect-form [ENEMY DEF] line — in the span, or at its `[up since]` second", () => {
    const ok = [
      LEGEND,
      ...ROSTER,
      "0:09  [ENEMY DEF]   4(ORogue) (Outlaw Rogue): Feign Death (absorb 64k, 2.0s) (at 67% HP)",
      "0:52  [ENEMY DEF]   4(ORogue) (Outlaw Rogue): Cheat Death (cheat-death proc) (at 7% HP)",
      "1:13  [ENEMY DEF]   4(ORogue) (Outlaw Rogue): Nature's Guardian (heal proc) (at 31% HP)",
      ATTEMPT("0:10–0:15", "self-saved (Feign Death [up since 0:09])"),
      ATTEMPT("0:50–0:55", "self-saved (Cheat Death)"),
      ATTEMPT(
        "1:10–1:15",
        "popped Barkskin; saved by external (Ironbark); self-saved (Nature's Guardian)",
      ),
      "1:11  [ENEMY DEF]   4(ORogue) (Outlaw Rogue): Barkskin (20%, 12.0s)",
      "1:12  [ENEMY DEF]   5(RDruid) (Restoration Druid): Ironbark → 4(ORogue) (6.6s)",
    ];
    expect(checkEnemyDefRefConsistency(ok)).toEqual([]);
    // the effect line sits 5 s after the span: the old immunity window, not a self-save's
    const late = [
      LEGEND,
      ...ROSTER,
      "0:20  [ENEMY DEF]   4(ORogue) (Outlaw Rogue): Feign Death (absorb, 2.0s)",
      ATTEMPT("0:10–0:15", "self-saved (Feign Death)"),
    ];
    expect(checkEnemyDefRefConsistency(late)).toHaveLength(1);
    // …and on another unit it is not this target's save
    const other = [
      LEGEND,
      ...ROSTER,
      "0:12  [ENEMY DEF]   6(HPriest) (Holy Priest): Feign Death (absorb, 2.0s)",
      ATTEMPT("0:10–0:15", "self-saved (Feign Death)"),
    ];
    expect(checkEnemyDefRefConsistency(other)).toHaveLength(1);
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

  it("B16b: a cause of several clauses (`popped X; saved by external (Y)`) is read clause by clause", () => {
    const DEFS = [
      "5:17  [ENEMY DEF]   3(FWarrior) (Fury Warrior): Enraged Regeneration (30%, 11.0s) (at 22% HP)",
      "5:19  [ENEMY DEF]   4(HPaladin) (Holy Paladin): Lay on Hands → 3(FWarrior) (target at 12% HP)",
    ];
    const both = ATTEMPT(
      "5:07–5:22",
      "popped Enraged Regeneration; saved by external (Lay on Hands)",
    );
    expect(checkEnemyDefRefConsistency([LEGEND, ...DEFS, both])).toEqual([]);
    // the external has no line: the second clause is checked, not skipped
    const noExternal = checkEnemyDefRefConsistency([LEGEND, DEFS[0]!, both]);
    expect(noExternal).toHaveLength(1);
    expect(noExternal[0]).toContain('"Lay on Hands"');
    // three clauses, one name already up before the span
    const three = ATTEMPT(
      "5:07–5:22",
      "popped Barkskin [up since 5:00]; saved by external (Lay on Hands); self-saved (Renewal/Frenzied Regeneration)",
    );
    const res = checkEnemyDefRefConsistency([
      LEGEND,
      "5:00  [ENEMY DEF]   3(FDruid) (Feral Druid): Barkskin (20%, 12.0s)",
      DEFS[1]!,
      "5:12  [ENEMY DEF]   3(FDruid) (Feral Druid): Renewal (self-save) (at 30% HP)",
      three,
    ]);
    expect(res).toHaveLength(1);
    expect(res[0]).toContain('"Frenzied Regeneration"');
  });

  it("B16b: a clause the gate cannot read is a failure, never a silent pass", () => {
    const res = checkEnemyDefRefConsistency([
      LEGEND,
      "5:17  [ENEMY DEF]   3(FWarrior) (Fury Warrior): Enraged Regeneration (30%, 11.0s)",
      ATTEMPT("5:07–5:22", "popped Enraged Regeneration; and then something"),
    ]);
    expect(res).toHaveLength(1);
    expect(res[0]).toContain("cannot read");
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

/**
 * FT-T07, user ruling D8 (2026-10-10): an `[ENEMY DEF]` line names Feign
 * Death, Nature's Guardian, Cheat Death and Cauterize by their effect, never
 * as `(immune …)`; no other ability carries an effect note.
 */
describe("checkEnemyDefSaveEffect (FT-T07, ruling D8)", () => {
  const D = (who: string, rest: string) =>
    `0:21  [ENEMY DEF]   ${who}: ${rest}`;
  const HUNTER = "6(BMHunter) (Beast Mastery Hunter)";

  it("passes the four effect forms, with every tail the line can carry", () => {
    expect(
      checkEnemyDefSaveEffect([
        D(
          HUNTER,
          "Feign Death (absorb 64k, 2.0s) [friendly offensive CD active] (at 67% HP)",
        ),
        D(HUNTER, "Feign Death (absorb, 2.0s) (at 67% HP)"),
        D(HUNTER, "Feign Death (absorb <1k, 0.4s — removed early)"),
        D(HUNTER, "Feign Death (absorb 594k, 1.2s — used up) (at 12% HP)"),
        D(
          HUNTER,
          "Feign Death (absorb 20k, 0.9s — dispelled by 1(HPriest)'s Mass Dispel)",
        ),
        D(
          "5(RShaman) (Restoration Shaman)",
          "Nature's Guardian (heal proc) (at 31% HP)",
        ),
        D(
          "4(SRogue) (Subtlety Rogue)",
          "Cheat Death (cheat-death proc) (at 7% HP)",
        ),
        D(
          "4(FMage) (Fire Mage)",
          "Cauterize (cheat-death proc) [friendly offensive CD active] (at 35% HP)",
        ),
        // every other kind is none of this gate's business
        D("4(FMage) (Fire Mage)", "Ice Block (immune, 10.0s) (at 20% HP)"),
        D("5(RDruid) (Restoration Druid)", "Barkskin (20%, 12.0s)"),
        D(
          "5(RDruid) (Restoration Druid)",
          "Ironbark → 4(FMage) (6.6s) (target at 40% HP)",
        ),
        D(
          "5(HPriest) (Holy Priest)",
          "Desperate Prayer (self-save) (at 75% HP)",
        ),
        D("5(HPriest) (Holy Priest)", "Power Word: Barrier (area)"),
        "0:21  [STATE]   friends 1(HPriest):99 / enemies 6(BMHunter):67",
      ]),
    ).toEqual([]);
  });

  it.each([
    ["the wording ruling D8 retired", "Feign Death (immune, 2.0s) (at 67% HP)"],
    [
      "Nature's Guardian as an immunity",
      "Nature's Guardian (immune) (at 31% HP)",
    ],
    ["Cauterize with the burn's duration", "Cauterize (immune, 6.0s)"],
    ["Cheat Death as a plain self-save", "Cheat Death (self-save) (at 7% HP)"],
    ["the wrong effect for the ability", "Feign Death (cheat-death proc)"],
    ["a proc called an absorb", "Cauterize (absorb 12k, 6.0s)"],
  ])("fails %s", (_why, rest) => {
    const f = checkEnemyDefSaveEffect([D(HUNTER, rest)]);
    expect(f).toHaveLength(1);
    expect(f[0]).toContain("something other than its effect");
  });

  it("fails an effect note on an ability that has none", () => {
    const f = checkEnemyDefSaveEffect([
      D("4(FMage) (Fire Mage)", "Ice Block (absorb 12k, 10.0s)"),
      D("5(HPriest) (Holy Priest)", "Desperate Prayer (heal proc)"),
    ]);
    expect(f).toHaveLength(2);
    expect(f[0]).toContain("no claim to");
  });

  it("ruling D6: Feign Death's shield with no logged end still reads as its effect", () => {
    expect(
      checkEnemyDefSaveEffect([
        D(HUNTER, "Feign Death (absorb, end not logged) (at 67% HP)"),
        D(HUNTER, "Feign Death (absorb 64k, end not logged)"),
        D("4(FMage) (Fire Mage)", "Mass Invisibility (immune, end not logged)"),
      ]),
    ).toEqual([]);
    expect(
      checkEnemyDefSaveEffect([
        D(HUNTER, "Feign Death (immune, end not logged)"),
      ]),
    ).toHaveLength(1);
  });
});

/**
 * FT-T07 / T15 ③, user ruling D6 (2026-10-10): an `[ENEMY DEF]` aura whose
 * end the log never showed prints `end not logged` in the duration's slot —
 * alone there, with no `during it` window, and defined by the legend.
 */
describe("checkEnemyDefEndNotLogged (FT-T07 / T15, ruling D6)", () => {
  const D = (who: string, rest: string) =>
    `0:04  [ENEMY DEF]   ${who}: ${rest}`;
  const MAGE = "4(AMage) (Arcane Mage)";
  const DRUID = "5(RDruid) (Restoration Druid)";
  const END_LEGEND =
    "    `end not logged` in place of Ts = the log never shows that aura end (an enemy who goes invisible takes the";

  it("passes every rendered form, and a prompt that never prints the phrase", () => {
    expect(
      checkEnemyDefEndNotLogged([
        LEGEND,
        END_LEGEND,
        D(MAGE, "Mass Invisibility (immune, end not logged) (at 100% HP)"),
        D(
          MAGE,
          "Greater Invisibility (60%, end not logged) [friendly offensive CD active] (at 41% HP)",
        ),
        D("4(SRogue) (Subtlety Rogue)", "Vanish (immune, end not logged)"),
        D(DRUID, "Ironbark → 4(AMage) (end not logged) (target at 40% HP)"),
        D(
          "6(BMHunter) (Beast Mastery Hunter)",
          "Feign Death (absorb 64k, end not logged) (at 67% HP)",
        ),
        // lines with a logged end are none of this gate's business
        D(MAGE, "Mass Invisibility (immune, 0.7s — removed early)"),
        D(
          DRUID,
          "Ironbark → 4(AMage) (12.0s) | during it: 1 40k on target · 100% of their enemy-player damage · direct 40k / periodic 0k · damage in 2 of 12 s · longest gap 9 s",
        ),
      ]),
    ).toEqual([]);
    expect(
      checkEnemyDefEndNotLogged([
        LEGEND,
        D(MAGE, "Ice Block (immune, 10.0s) (at 20% HP)"),
      ]),
    ).toEqual([]);
  });

  it.each([
    [
      "the official length left beside it",
      "Mass Invisibility (immune, 12.0s, end not logged)",
    ],
    [
      "an end note on an end the log never showed",
      "Greater Invisibility (60%, end not logged — removed early)",
    ],
    [
      "the phrase outside the duration's slot",
      "Vanish (immune, 1.5s) — end not logged",
    ],
  ])("fails %s", (_why, rest) => {
    const f = checkEnemyDefEndNotLogged([LEGEND, END_LEGEND, D(MAGE, rest)]);
    expect(f).toHaveLength(1);
    expect(f[0]).toContain("not alone in the duration's slot");
  });

  it("fails a `during it` window on an external whose end is not logged", () => {
    const f = checkEnemyDefEndNotLogged([
      LEGEND,
      END_LEGEND,
      D(
        DRUID,
        "Ironbark → 4(AMage) (end not logged) | during it: 1 40k on target · 100% of their enemy-player damage · direct 40k / periodic 0k · damage in 2 of 12 s · longest gap 9 s",
      ),
    ]);
    expect(f).toHaveLength(1);
    expect(f[0]).toContain("during it");
  });

  it("fails a prompt that prints the phrase without a legend line for it", () => {
    const f = checkEnemyDefEndNotLogged([
      LEGEND,
      D(MAGE, "Mass Invisibility (immune, end not logged) (at 100% HP)"),
    ]);
    expect(f).toHaveLength(1);
    expect(f[0]).toContain("no legend line defines it");
  });
});

describe("checkKarmaFedClause (B20a)", () => {
  const P =
    "4:24  [ENEMY DEF]   5(WMonk) (Windwalker Monk): Touch of Karma (self-save) (at 58% HP)";
  const ok = [
    `${P} | fed by (pressed 1 s or more after it went up): 2(ARogue) 122k · 3(FMage) 5k · DoTs already ticking: 66k · pressed before that: 207k · procs / auto-attacks / pets: 152k · absorbed 551k in all by 4:31 · sent back: 229k onto 3(FMage)`,
    `${P} | fed by: nobody pressed into it 1 s or more after it went up · DoTs already ticking: 61k · pressed before that: 103k · procs / auto-attacks / pets: 21k · absorbed 185k in all by 2:40 · sent back: 0`,
    `${P} | fed by (pressed 1 s or more after it went up): 2(ARogue) 40k · absorbed 40k in all by 4:26 · sent back: 0`,
    // nothing absorbed, damage still sent back
    `${P} | fed by: nobody pressed into it 1 s or more after it went up · sent back: 12k onto 1(RDruid)`,
    `${P}`,
  ];
  it("passes the rendered forms", () => {
    expect(checkKarmaFedClause(ok)).toEqual([]);
  });
  it.each([
    [
      "parts that do not add up to the total",
      `${P} | fed by (pressed 1 s or more after it went up): 2(ARogue) 122k · DoTs already ticking: 66k · absorbed 551k in all by 4:31 · sent back: 0`,
    ],
    [
      "a player listed twice",
      `${P} | fed by (pressed 1 s or more after it went up): 2(ARogue) 100k · 2(ARogue) 22k · absorbed 122k in all by 4:31 · sent back: 0`,
    ],
    [
      "the clause on another spell's line",
      `4:24  [ENEMY DEF]   5(WMonk) (Windwalker Monk): Fortifying Brew (20%, 15.0s) | fed by: nobody pressed into it 1 s or more after it went up · sent back: 0`,
    ],
    [
      "a clause with no `sent back`",
      `${P} | fed by (pressed 1 s or more after it went up): 2(ARogue) 40k · absorbed 40k in all by 4:26`,
    ],
    [
      "`nobody pressed into it` beside a player's figure",
      `${P} | fed by: nobody pressed into it 1 s or more after it went up · 2(ARogue) 100k · absorbed 100k in all by 4:26 · sent back: 0`,
    ],
    [
      "a part the gate cannot read",
      `${P} | fed by (pressed 1 s or more after it went up): 2(ARogue) 40k · something else 3k · absorbed 43k in all by 4:26 · sent back: 0`,
    ],
  ])("fails %s", (_why, line) => {
    expect(checkKarmaFedClause([line])).toHaveLength(1);
  });

  it("parts under 0.5k are not printed: a small total with no printed part still adds up (review 37-BD-39)", () => {
    expect(
      checkKarmaFedClause([
        `${P} | fed by: nobody pressed into it 1 s or more after it went up · absorbed 1k in all by 4:26 · sent back: 0`,
      ]),
    ).toEqual([]);
    // … but the allowance is three unprinted parts, not a free pass
    expect(
      checkKarmaFedClause([
        `${P} | fed by: nobody pressed into it 1 s or more after it went up · absorbed 5k in all by 4:26 · sent back: 0`,
      ]),
    ).toHaveLength(1);
  });
});

describe("checkResReturnAnnounced (the [RES] delta chain, b19)", () => {
  const FULL =
    "      [RES] rdy:Barkskin,2:Ice Block  cd:Ironbark(3s),2:Alter Time(40s)  focus:2";
  const chain = (...rows: string[]) => [
    "0:10  [YOU] [CD]   Ironbark → 2(FMage)",
    FULL,
    ...rows,
  ];

  it("a cooldown back at 0:13 that the next row (0:20) does not hold as ready is a failure", () => {
    const f = checkResReturnAnnounced(
      chain(
        "0:20  [YOU] [CD]   Barkskin",
        "      [RES] rdy:Δ -Barkskin  cd:Barkskin(34s)",
      ),
    );
    expect(f).toHaveLength(1);
    expect(f[0]).toContain("never shows Ironbark coming back");
    expect(f[0]).toContain("back at 0:13");
  });

  it("`+X` on that row, or on an earlier one, satisfies it", () => {
    expect(
      checkResReturnAnnounced(
        chain(
          "0:20  [YOU] [CD]   Barkskin",
          "      [RES] rdy:Δ +Ironbark -Barkskin  cd:Barkskin(34s)",
        ),
      ),
    ).toEqual([]);
  });

  it("a row inside the cooldown, or in the second it returns, is too early to judge; the judgement falls on the next row", () => {
    const early = chain(
      "0:13  [YOU] [CD]   Barkskin",
      "      [RES] rdy:Δ -Barkskin  cd:Barkskin(34s)",
    );
    expect(checkResReturnAnnounced(early)).toEqual([]);
    expect(
      checkResReturnAnnounced([
        ...early,
        "0:30  [TEAM] [CD]   2(FMage): Ice Block",
        "      [RES] rdy:Δ -2:Ice Block  cd:2:Ice Block(240s)",
      ]),
    ).toHaveLength(1);
  });

  it("pressed again by that row (listed under cd: again) is not a missing return", () => {
    expect(
      checkResReturnAnnounced(
        chain(
          "0:20  [YOU] [CD]   Ironbark → 2(FMage)",
          "      [RES] rdy:Δ  cd:Ironbark(90s)",
        ),
      ),
    ).toEqual([]);
  });

  it("a full row restates both lists and restarts the chain: nothing earlier is judged at it or after it", () => {
    expect(
      checkResReturnAnnounced(
        chain(
          "1:10  [YOU] [CD]   Barkskin",
          "      [RES] rdy:Ironbark,2:Ice Block,2:Alter Time  cd:Barkskin(34s)",
          "1:20  [TEAM] [CD]   2(FMage): Ice Block",
          "      [RES] rdy:Δ -2:Ice Block  cd:2:Ice Block(240s)",
        ),
      ),
    ).toEqual([]);
  });

  it("only exact `(Ns)` entries are followed: a range, `≤`, a charge suffix are not; a name with a comma is one name", () => {
    expect(
      checkResReturnAnnounced([
        "0:10  [YOU] [CD]   Avatar",
        "      [RES] rdy:Pummel  cd:Avatar(3–20s),Bladestorm(≤4s),2:Blur(2s)[0/2],Invoke Chi-Ji, the Red Crane(3s)",
        "0:30  [YOU] [CD]   Pummel",
        "      [RES] rdy:Δ +Invoke Chi-Ji, the Red Crane -Pummel  cd:Pummel(15s)",
      ]),
    ).toEqual([]);
  });

  it("stops at the first friendly death: a dead holder's entries leave without a `-X`", () => {
    expect(
      checkResReturnAnnounced(
        chain(
          "0:15  [DEATH]  2(FMage) (Frost Mage — friendly) | dampening: 10%",
          "      [RES] rdy:Barkskin  cd:—",
          "0:20  [YOU] [CD]   Barkskin",
          "      [RES] rdy:Δ -Barkskin  cd:Barkskin(34s)",
        ),
      ),
    ).toEqual([]);
  });
});

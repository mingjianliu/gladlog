import { describe, expect, it } from "vitest";

import { checkEnemyDefRefConsistency } from "../src/quality/promptQualityCheck";

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
});

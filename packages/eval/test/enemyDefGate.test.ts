import { KILL_CREDIT_SLACK_S } from "@gladlog/analysis/src/utils/burstLedger";
import { describe, expect, it } from "vitest";

import { checkEnemyDefRefConsistency } from "../src/quality/promptQualityCheck";

/**
 * GH #97: KILL ATTEMPTS `popped X` / `saved by external (X)` ⇒ an
 * `[ENEMY DEF]` line naming X inside the attribution span. Keyed on the
 * legend line so prompts rendered with the flag off are not accused.
 */
const LEGEND =
  "  [ENEMY DEF] = an enemy pressed a defensive at that second: `(N%, Ts)` = official damage reduction and the";
const ATTEMPT = (span: string, tail: string) =>
  `  [${span}] on Osiklm-Archimonde-EU — Avatar burst (no stun) | opportunity: locked (trinket up) | team focus 55% (1.23M on target) | FAILED: ${tail}`;

describe("checkEnemyDefRefConsistency", () => {
  it("passes when the named wall / external has a line inside the span (+ kill-credit slack)", () => {
    expect(KILL_CREDIT_SLACK_S).toBe(5);
    const lines = [
      LEGEND,
      "0:25  [ENEMY DEF]   4(ORogue) (Outlaw Rogue): Cloak of Shadows (immune, 5.0s)",
      "1:03  [ENEMY DEF]   5(RDruid) (Restoration Druid): Ironbark → 4(ORogue) (6.6s)",
      "1:44  [ENEMY DEF]   5(RDruid) (Restoration Druid): Barkskin (20%, 12.0s)",
      "2:37  [ENEMY DEF]   4(ORogue) (Outlaw Rogue): Cloak of Shadows (immune, 2.4s — removed early)",
      ATTEMPT("0:42–1:02", "popped Ironbark"), // 1:03 = to + 1 ≤ to + 5
      ATTEMPT("1:41–1:44", "popped Barkskin"),
      ATTEMPT("2:30–2:36", "saved by external (Ironbark/Cloak of Shadows)"), // 2:37 within slack; Ironbark? see below
      "1:03  [ENEMY DEF]   5(RDruid) (Restoration Druid): Ironbark → 4(ORogue) (6.6s)",
      "2:35  [ENEMY DEF]   5(RDruid) (Restoration Druid): Ironbark → 4(ORogue)",
    ];
    expect(checkEnemyDefRefConsistency(lines)).toEqual([]);
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
    expect(f[1]).toContain("[0:10–0:25]"); // to + KILL_CREDIT_SLACK_S
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

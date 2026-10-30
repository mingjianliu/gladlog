import { ensureAnalysisData } from "@gladlog/analysis";
import { KILL_ATTEMPTS_OWN_CONTROL_LEGEND } from "@gladlog/analysis/src/utils/killAttempts";
import { beforeAll, describe, expect, it } from "vitest";

import {
  checkEnemyDefRefConsistency,
  checkKillAttemptOwnControlClause,
} from "../src/quality/promptQualityCheck";

// I10 (user ruling 2026-10-11, option b): a KILL ATTEMPTS line whose bracket
// meets our own Cyclone on its target ends with `| target in your team's
// Cyclone a–b`. The shape is 2c6e85ec's: a Kidney Shot on the priest at 0:40,
// the owner's Cyclone on the same priest at 0:42.
const ROSTER = [
  '  <unit id="1" name="Owner-Realm-EU" spec="Balance Druid" role="log owner">',
  '  <unit id="4" name="Penvon-Ravencrest-EU" spec="Discipline Priest" role="enemy">',
  '  <unit id="5" name="Mage-Realm-EU" spec="Frost Mage" role="enemy">',
];
const attempt = (span: string, target: string, tail: string) =>
  `  [${span}] on ${target} — Kidney Shot opener (Full DR), 1 stun | opportunity: gated (Pain Suppression in hand; no softer target) | team focus 5% (0.04M on target inside it, 0.06M incl. the 5 s after) | ${tail}`;
const cyclone = (at: string, unit: string, span = "5s") =>
  `${at}  [CC ON ENEMY]   ${unit} ← Cyclone (by 1(BDruid)) (${span}) [DR: Disorient Full]`;
const CLAUSE = "target in your team's Cyclone 0:42–0:47";

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("checkKillAttemptOwnControlClause", () => {
  it("passes: the clause where the bracket meets the Cyclone, none where it does not — another unit's Cyclone, a `<1s` one, one after the bracket", () => {
    expect(
      checkKillAttemptOwnControlClause([
        ...ROSTER,
        KILL_ATTEMPTS_OWN_CONTROL_LEGEND,
        attempt(
          "0:40–0:45",
          "Penvon-Ravencrest-EU",
          `FAILED: not enough damage | ${CLAUSE}`,
        ),
        attempt("0:40–0:45", "Mage-Realm-EU", "FAILED: healed through"),
        attempt("1:10–1:14", "Penvon-Ravencrest-EU", "KILL"),
        attempt("2:00–2:04", "Penvon-Ravencrest-EU", "FAILED: healed through"),
        cyclone("0:42", "4(DPriest)"),
        cyclone("1:20", "4(DPriest)"),
        cyclone("2:01", "4(DPriest)", "<1s"),
        // a Polymorph over the bracket is not this fact
        "1:10  [CC ON ENEMY]   4(DPriest) ← Polymorph (by 2(FMage)) (6s) [DR: Incapacitate Full]",
      ]),
    ).toEqual([]);
  });

  it("passes: a KILL row and a round-end Cyclone carry it too; two Cyclones are one clause", () => {
    expect(
      checkKillAttemptOwnControlClause([
        ...ROSTER,
        KILL_ATTEMPTS_OWN_CONTROL_LEGEND,
        attempt(
          "0:40–0:52",
          "Penvon-Ravencrest-EU",
          "KILL | target in your team's Cyclone 0:42–0:47, 0:50–0:53",
        ),
        cyclone("0:42", "4(DPriest)"),
        cyclone(
          "0:50",
          "4(DPriest)",
          "still on them when the round ended, 3s in",
        ),
      ]),
    ).toEqual([]);
  });

  it("fails: 2c6e85ec's line as it printed — the Cyclone on the timeline, nothing on the attempt", () => {
    const fails = checkKillAttemptOwnControlClause([
      ...ROSTER,
      attempt("0:40–0:45", "Penvon-Ravencrest-EU", "FAILED: not enough damage"),
      cyclone("0:42", "4(DPriest)"),
    ]);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain(
      `line 4: KILL ATTEMPTS [0:40–0:45] on Penvon-Ravencrest-EU 应以 "| ${CLAUSE}" 结尾`,
    );
  });

  it("fails: a clause with no such Cyclone line, another interval, the other unit's Cyclone", () => {
    const withClause = attempt(
      "0:40–0:45",
      "Penvon-Ravencrest-EU",
      `FAILED: not enough damage | ${CLAUSE}`,
    );
    const head = [...ROSTER, KILL_ATTEMPTS_OWN_CONTROL_LEGEND, withClause];
    expect(checkKillAttemptOwnControlClause(head)).toHaveLength(1);
    expect(
      checkKillAttemptOwnControlClause([
        ...head,
        cyclone("0:43", "4(DPriest)"),
      ]),
    ).toHaveLength(1);
    expect(
      checkKillAttemptOwnControlClause([
        ...head,
        cyclone("0:42", "4(DPriest)", "4s"),
      ]),
    ).toHaveLength(1);
    expect(
      checkKillAttemptOwnControlClause([...head, cyclone("0:42", "5(FMage)")]),
    ).toHaveLength(1);
  });

  it("fails: the legend sentence without a line that carries the clause, and a line without the legend", () => {
    expect(
      checkKillAttemptOwnControlClause([
        ...ROSTER,
        KILL_ATTEMPTS_OWN_CONTROL_LEGEND,
        attempt("0:40–0:45", "Penvon-Ravencrest-EU", "KILL"),
      ]),
    ).toHaveLength(1);
    expect(
      checkKillAttemptOwnControlClause([
        ...ROSTER,
        attempt("0:40–0:45", "Penvon-Ravencrest-EU", `KILL | ${CLAUSE}`),
        cyclone("0:42", "4(DPriest)"),
      ]),
    ).toHaveLength(1);
  });

  it("a target the roster does not resolve is not compared", () => {
    expect(
      checkKillAttemptOwnControlClause([
        attempt("0:40–0:45", "Penvon-Ravencrest-EU", "KILL"),
        cyclone("0:42", "4(DPriest)"),
      ]),
    ).toEqual([]);
  });
});

describe("the clause after FAILED does not hide the cause from the [ENEMY DEF] gate", () => {
  const LEGEND = "  [ENEMY DEF] = an enemy's defensive";
  const popped = (tail: string) =>
    attempt(
      "0:40–0:45",
      "Penvon-Ravencrest-EU",
      `FAILED: popped Desperate Prayer${tail}`,
    );
  it("`popped X | target in your team's Cyclone …` is still read as `popped X`", () => {
    const def =
      "0:43  [ENEMY DEF]   4(DPriest) (Discipline Priest): Desperate Prayer (self-save)";
    for (const tail of ["", ` | ${CLAUSE}`]) {
      expect(
        checkEnemyDefRefConsistency([...ROSTER, LEGEND, popped(tail), def]),
      ).toEqual([]);
      // mutation: the same line with no [ENEMY DEF] line behind the cause
      expect(
        checkEnemyDefRefConsistency([...ROSTER, LEGEND, popped(tail)]),
      ).toHaveLength(1);
    }
  });
});

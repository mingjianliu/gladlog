/**
 * scan5/t184 `readPrintedAnswer`: the printed answer of a `[BURST ANSWERED]`
 * line, with the real line shapes the Mac job T184-2 tripped on — a spell
 * whose own name holds " on " (Lay on Hands), beside a true control target
 * clause, a two-target control and the before-it-opened form.
 */
import { describe, expect, it } from "vitest";

import { readPrintedAnswer } from "../scripts/scan5/t184";

const line = (answer: string) =>
  `1:40  [BURST ANSWERED]   enemy opened Avatar (+Colossus Smash 1s later) (5(AWarrior)): ${answer}; 3(FMage) bottomed at 23% at 1:44`;

describe("scan5 t184 readPrintedAnswer", () => {
  it("a spell name holding ' on ' is one name, not a spell and a target", () => {
    expect(
      readPrintedAnswer(line("2(HPaladin) answered with Lay on Hands in 3.2s")),
    ).toMatchObject({
      answerer: "2(HPaladin)",
      spellName: "Lay on Hands",
      controlOn: [],
      latencySec: 3.2,
    });
  });
  it("a control's target clause stays a target clause, with its span", () => {
    expect(
      readPrintedAnswer(
        line("1(RShaman) answered with Earthgrab on 5(AWarrior) (2s) in 1.1s"),
      ),
    ).toMatchObject({
      spellName: "Earthgrab",
      controlOn: [{ target: "5(AWarrior)", span: "2s" }],
      latencySec: 1.1,
    });
  });
  it("two targets, and a time before the opener", () => {
    expect(
      readPrintedAnswer(
        line(
          "1(RShaman) answered with Earthgrab on 5(AWarrior) (2s) and 6(HPriest) 14.0s before it opened",
        ),
      ),
    ).toMatchObject({
      spellName: "Earthgrab",
      controlOn: [
        { target: "5(AWarrior)", span: "2s" },
        { target: "6(HPriest)" },
      ],
      latencySec: -14,
    });
  });
  it("a line that is not a credit line reads as null", () => {
    expect(readPrintedAnswer("1:40  [STATE]   friends 1(FMage):23")).toBeNull();
  });
});

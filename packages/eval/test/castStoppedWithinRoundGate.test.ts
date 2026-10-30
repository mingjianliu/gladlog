/**
 * FT I11 (b) — `checkCastStoppedWithinRound`: a `[CAST STOPPED]` line states
 * nothing past the round's end as the prompt states it. f0a10402 round 3
 * printed `1:44 [CAST STOPPED] Mind Control — cast bar stopped after 0.5s;
 * not kicked; …` under a Solo Shuffle round's first `[DEATH]` at 1:43: the
 * bar was begun 0.08 s after the round-ending death and broken by the round
 * ending, and the ledger counted it as a cancel (2 such lines on the
 * 605-file capture of 8c3275fa are provable on the whole-second grid).
 */
import {
  CAST_STOPPED_NEAR_TEXT,
  castStoppedLine,
} from "@gladlog/analysis/src/context/timelineSections/castStopped";
import { SOLO_SHUFFLE_BRACKET } from "@gladlog/analysis/src/utils/roundEnd";
import { describe, expect, it } from "vitest";

import { checkCastStoppedWithinRound } from "../src/quality/promptQualityCheck";

const header = (bracket: string) =>
  `  Spec: Shadow Priest  |  Bracket: ${bracket}  |  Result: Loss  |  Duration: 1:45  |  Map: Nagrand Arena`;
const DEATH =
  "1:43  [DEATH]  4(ARogue) (Assassination Rogue — enemy) | dampening: 20%";
const MATCH_END = "1:45  [MATCH END]   damp: 20%";
const stopped = (startS: number, afterS: string) =>
  castStoppedLine(
    startS,
    "Mind Control",
    `cast bar stopped after ${afterS}s${CAST_STOPPED_NEAR_TEXT.none}`,
  );
const roundEnded = (startS: number, afterS: string) =>
  castStoppedLine(
    startS,
    "Mind Control",
    `no end logged; the round ended ${afterS}s after it began`,
  );
const shuffle = (...body: string[]) => [
  header(SOLO_SHUFFLE_BRACKET),
  ...body,
  DEATH,
  MATCH_END,
];

describe("checkCastStoppedWithinRound (FT I11)", () => {
  it("lines inside the round pass, on either side of a second boundary", () => {
    expect(
      checkCastStoppedWithinRound(
        shuffle(
          stopped(60, "0.5"),
          // begun 102.9, stopped 103.9 — before a death at 103.98
          stopped(102, "1.0"),
          stopped(103, "0.9"),
          // begun 102.6, the round ended 1.4 s later at 103.98
          roundEnded(102, "1.4"),
          roundEnded(103, "0.3"),
          castStoppedLine(101, "Mind Control", "refused 1.6s in: out of range"),
        ),
      ),
    ).toEqual([]);
  });

  it("mutation: a bar begun in a second after the round-ending death fails", () => {
    const out = checkCastStoppedWithinRound(shuffle(stopped(104, "0.5")));
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("回合结束之后");
  });

  it("mutation: a stop or a refusal that can only be after the round's end fails", () => {
    expect(
      checkCastStoppedWithinRound(shuffle(stopped(103, "1.2"))),
    ).toHaveLength(1);
    expect(
      checkCastStoppedWithinRound(
        shuffle(
          castStoppedLine(102, "Mind Control", "refused 2.2s in: out of range"),
        ),
      ),
    ).toHaveLength(1);
  });

  it("mutation: `the round ended N.Ns after it began` measured to the LOG's end fails", () => {
    // begun 103.6: the round ended 0.4 s later; the log's end is 2 s on
    expect(
      checkCastStoppedWithinRound(shuffle(roundEnded(103, "2.4"))),
    ).toHaveLength(1);
    // … and one that ends before the stated second cannot be right either
    expect(
      checkCastStoppedWithinRound(shuffle(roundEnded(100, "1.0"))),
    ).toHaveLength(1);
  });

  it("another bracket's round runs to [MATCH END]: a death ends nothing", () => {
    const threes = (...body: string[]) => [
      header("3v3"),
      DEATH,
      ...body,
      MATCH_END,
    ];
    expect(
      checkCastStoppedWithinRound(
        threes(stopped(104, "0.5"), roundEnded(104, "1.6")),
      ),
    ).toEqual([]);
    expect(
      checkCastStoppedWithinRound(threes(stopped(105, "1.2"))),
    ).toHaveLength(1);
  });

  it("a prompt that states no round end is not judged", () => {
    expect(
      checkCastStoppedWithinRound([header("3v3"), stopped(104, "0.5")]),
    ).toEqual([]);
  });
});

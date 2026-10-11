/**
 * `logIsFrom` — the one comparison of a log timestamp with a dated game
 * change (utils/logEra.ts). The 12.1 gates read it; so does every later
 * rule that depends on when the match was played.
 */
import { describe, expect, it } from "vitest";

import { STORM_CONDUIT_HOTFIX_EPOCH_MS } from "../src/data/talentScriptedCooldowns";
import {
  DR_RESET_CUTOVER_EPOCH_MS,
  DR_RESET_MS_121,
  DR_RESET_MS_PRE_121,
  drResetMsAt,
  PATCH_121_GOLIVE_EPOCH_MS,
} from "../src/utils/drAnalysis";
import { logDatedNumberAt, logIsFrom } from "../src/utils/logEra";
import { parseRawTimestamp, rawLineInstantMs } from "../src/utils/rawStreams";

describe("logIsFrom", () => {
  it("the cutover instant itself is already the new rule", () => {
    expect(logIsFrom(99, 100)).toBe(false);
    expect(logIsFrom(100, 100)).toBe(true);
    expect(logIsFrom(101, 100)).toBe(true);
  });
  it("a timestamp that is not a number is on neither side — it reads false", () => {
    expect(logIsFrom(Number.NaN, 100)).toBe(false);
    expect(logIsFrom(undefined as unknown as number, 100)).toBe(false);
  });
  it("the DR reset window is asked through it and flips exactly at 12.1 go-live", () => {
    expect(DR_RESET_CUTOVER_EPOCH_MS).toBe(PATCH_121_GOLIVE_EPOCH_MS);
    expect(PATCH_121_GOLIVE_EPOCH_MS).toBe(Date.UTC(2026, 7, 11, 22, 0, 0));
    expect(drResetMsAt(PATCH_121_GOLIVE_EPOCH_MS - 1)).toBe(
      DR_RESET_MS_PRE_121,
    );
    expect(drResetMsAt(PATCH_121_GOLIVE_EPOCH_MS)).toBe(DR_RESET_MS_121);
    // a fixture's small synthetic epoch is a date long before the cutover
    expect(drResetMsAt(1_000_000)).toBe(DR_RESET_MS_PRE_121);
  });
});

describe("logDatedNumberAt — a number the game changed on a date", () => {
  const dated = { cutoverEpochMs: 100, before: 7, since: 3 };
  it("`before` up to the cutover, `since` from the cutover instant on (logIsFrom's boundary)", () => {
    expect(logDatedNumberAt(dated, 99)).toBe(7);
    expect(logDatedNumberAt(dated, 100)).toBe(3);
    expect(logDatedNumberAt(dated, 101)).toBe(3);
    for (const at of [99, 100, 101])
      expect(logDatedNumberAt(dated, at)).toBe(
        logIsFrom(at, dated.cutoverEpochMs) ? dated.since : dated.before,
      );
  });
  it("a timestamp that is not a number takes the CURRENT value, never the old one", () => {
    for (const notADate of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      undefined as unknown as number,
    ])
      expect(logDatedNumberAt(dated, notADate)).toBe(3);
  });
});

describe("which side of a cutover a real line is on — the instant it states for itself (rawLineInstantMs) against the parser's date of it", () => {
  // the parser's date of an offset written without a sign depends on the
  // zone it is given; a US Eastern machine is the one the corpus is read on
  const onUsEastern = (datePart: string) =>
    parseRawTimestamp(datePart, { timezone: "America/New_York" })!;

  it("an Oceanic line of the hotfix day (file 097c4ae3): local 18:56:32 at +10 is 08:56:32 UTC — after the cutover's instant by either reading", () => {
    const line = "8/18/2026 18:56:32.16710";
    expect(rawLineInstantMs(line)).toBe(Date.UTC(2026, 7, 18, 8, 56, 32, 167));
    expect(
      logIsFrom(rawLineInstantMs(line)!, STORM_CONDUIT_HOTFIX_EPOCH_MS),
    ).toBe(true);
    // the US Eastern reading of the same line is 14 hours later
    expect(onUsEastern(line) - rawLineInstantMs(line)!).toBe(14 * 3_600_000);
    expect(logIsFrom(onUsEastern(line), STORM_CONDUIT_HOTFIX_EPOCH_MS)).toBe(
      true,
    );
  });

  it("a Korean line of the evening before (file c67114fb): 14:58 UTC on the 17th, BEFORE the cutover — a US Eastern parser dates it 03:58 UTC on the 18th, after it", () => {
    const line = "8/17/2026 23:58:29.2909";
    expect(rawLineInstantMs(line)).toBe(Date.UTC(2026, 7, 17, 14, 58, 29, 290));
    expect(
      logIsFrom(rawLineInstantMs(line)!, STORM_CONDUIT_HOTFIX_EPOCH_MS),
    ).toBe(false);
    // the open gap (utils/logEra.ts): the dated rules are asked with this one
    expect(onUsEastern(line)).toBe(Date.UTC(2026, 7, 18, 3, 58, 29, 290));
    expect(logIsFrom(onUsEastern(line), STORM_CONDUIT_HOTFIX_EPOCH_MS)).toBe(
      true,
    );
    // on the machine that recorded it the two readings are one instant
    expect(parseRawTimestamp(line, { timezone: "Asia/Seoul" })).toBe(
      rawLineInstantMs(line),
    );
  });

  it("a US line carries its sign, so the two readings are one number on every machine", () => {
    const before = "8/17/2026 19:59:59.999-4";
    const since = "8/17/2026 20:00:00.000-4";
    for (const timezone of ["America/New_York", "Australia/Sydney", "UTC"]) {
      expect(parseRawTimestamp(before, { timezone })).toBe(
        rawLineInstantMs(before),
      );
      expect(parseRawTimestamp(since, { timezone })).toBe(
        rawLineInstantMs(since),
      );
    }
    expect(
      logIsFrom(rawLineInstantMs(before)!, STORM_CONDUIT_HOTFIX_EPOCH_MS),
    ).toBe(false);
    expect(rawLineInstantMs(since)).toBe(STORM_CONDUIT_HOTFIX_EPOCH_MS);
    expect(
      logIsFrom(rawLineInstantMs(since)!, STORM_CONDUIT_HOTFIX_EPOCH_MS),
    ).toBe(true);
  });

  it("12.1 go-live: an Oceanic line of the morning after is half an hour BEFORE it in UTC", () => {
    // synthetic — the new-season archive starts two days after go-live
    const line = "8/12/2026 07:30:00.00010";
    expect(rawLineInstantMs(line)).toBe(Date.UTC(2026, 7, 11, 21, 30, 0, 0));
    expect(drResetMsAt(rawLineInstantMs(line)!)).toBe(DR_RESET_MS_PRE_121);
    expect(drResetMsAt(onUsEastern(line))).toBe(DR_RESET_MS_121);
  });

  it("a line that states no offset has no stated instant — the parser's date is the only one", () => {
    expect(rawLineInstantMs("8/18/2026 18:56:32.167")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import {
  classifyExit,
  DAILY_SHUFFLE_SHARE,
  EXIT_AUTH,
  parseFreshCount,
  planSteps,
  remainingToday,
} from "./dailyPull";

describe("remainingToday", () => {
  const now = new Date("2026-09-15T18:30:00Z");
  it("is the full quota with no state or a stale day", () => {
    expect(remainingToday(undefined, now, 15)).toBe(15);
    expect(
      remainingToday(
        { utcDay: "2026-09-14", downloadsUsedToday: 15, downloadsQuota: 15 },
        now,
        15,
      ),
    ).toBe(15);
  });
  it("subtracts today's recorded usage, floored at zero", () => {
    expect(
      remainingToday(
        { utcDay: "2026-09-15", downloadsUsedToday: 6, downloadsQuota: 15 },
        now,
        15,
      ),
    ).toBe(9);
    expect(
      remainingToday(
        { utcDay: "2026-09-15", downloadsUsedToday: 15, downloadsQuota: 15 },
        now,
        15,
      ),
    ).toBe(0);
  });
  it("trusts the server's quota over the local default when they differ", () => {
    expect(
      remainingToday(
        { utcDay: "2026-09-15", downloadsUsedToday: 2, downloadsQuota: 10 },
        now,
        15,
      ),
    ).toBe(8);
  });
});

describe("planSteps", () => {
  it("gives Solo Shuffle its share first and 3v3 the rest (user ruling 2026-09-15: 10 + 5)", () => {
    expect(planSteps(15)).toEqual([
      { bracket: "Rated Solo Shuffle", limit: DAILY_SHUFFLE_SHARE },
      { bracket: "3v3", limit: 15 - DAILY_SHUFFLE_SHARE },
    ]);
    expect(DAILY_SHUFFLE_SHARE).toBe(10);
  });
  it("shrinks the shuffle share when little is left and drops empty steps", () => {
    expect(planSteps(3)).toEqual([{ bracket: "Rated Solo Shuffle", limit: 3 }]);
    expect(planSteps(12)).toEqual([
      { bracket: "Rated Solo Shuffle", limit: 10 },
      { bracket: "3v3", limit: 2 },
    ]);
    expect(planSteps(0)).toEqual([]);
  });
});

describe("parseFreshCount", () => {
  it("reads the fetch script's done line", () => {
    expect(
      parseFreshCount("...\ndone: 14 new logs (scanned 50 stubs over 1 pages), manifest 14 entries\n"),
    ).toBe(14);
  });
  it("is zero when the script exited before downloading anything", () => {
    expect(parseFreshCount("today's upstream quota is already spent")).toBe(0);
  });
});

describe("classifyExit", () => {
  it("maps the fetch script's exit codes to a run status", () => {
    expect(classifyExit(0)).toBe("ok");
    expect(classifyExit(EXIT_AUTH)).toBe("auth-expired");
    expect(classifyExit(1)).toBe("error");
    expect(classifyExit(null)).toBe("error");
  });
});

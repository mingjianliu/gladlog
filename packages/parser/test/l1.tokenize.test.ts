import { parseTimestamp } from "../src/l1/timestamp";
import { splitTopLevel, splitLine } from "../src/l1/splitTopLevel";

describe("parseTimestamp", () => {
  it("parses current-format timestamp with year to epoch ms (UTC given)", () => {
    const ms = parseTimestamp("6/30/2026 19:10:31.7312", { timezone: "UTC" });
    // 2026-06-30T19:10:31.731Z
    expect(ms).toBe(Date.UTC(2026, 5, 30, 19, 10, 31, 731));
  });
  it("respects timezone offset", () => {
    const utc = parseTimestamp("6/30/2026 19:10:31.0000", { timezone: "UTC" })!;
    const berlin = parseTimestamp("6/30/2026 19:10:31.0000", {
      timezone: "Europe/Berlin",
    })!;
    expect(utc - berlin).toBe(2 * 3600 * 1000); // 6 月柏林 = UTC+2
  });
  it("returns null on garbage", () => {
    expect(parseTimestamp("not a date")).toBeNull();
    expect(
      parseTimestamp("13/45/2026 99:99:99.0000", { timezone: "UTC" }),
    ).toBeNull();
  });
});

describe("splitTopLevel", () => {
  it("splits plain params", () => {
    expect(splitTopLevel("1825,41,3v3,1")).toEqual(["1825", "41", "3v3", "1"]);
  });
  it("keeps commas inside double quotes and strips the quotes", () => {
    expect(splitTopLevel('123,"Name-With,Comma",0x512')).toEqual([
      "123",
      "Name-With,Comma",
      "0x512",
    ]);
  });
  it("keeps commas inside [] and () nesting, brackets preserved", () => {
    expect(splitTopLevel("71,[(90269,112121,1),(90270,112122,1)],9")).toEqual([
      "71",
      "[(90269,112121,1),(90270,112122,1)]",
      "9",
    ]);
  });
  it("handles nested [[...],[...]]", () => {
    expect(splitTopLevel("[[1,2],[3,4]],x")).toEqual(["[[1,2],[3,4]]", "x"]);
  });
  it("empty params become empty strings", () => {
    expect(splitTopLevel("a,,b")).toEqual(["a", "", "b"]);
  });
});

describe("splitLine", () => {
  it("splits a real line into date/event/params", () => {
    const r = splitLine(
      "6/30/2026 19:10:31.7312  ARENA_MATCH_START,1825,41,3v3,1",
    )!;
    expect(r.datePart).toBe("6/30/2026 19:10:31.7312");
    expect(r.eventName).toBe("ARENA_MATCH_START");
    expect(r.params).toEqual(["1825", "41", "3v3", "1"]);
  });
  it("returns null when there is no double-space separator or no comma", () => {
    expect(splitLine("garbage line without structure")).toBeNull();
    expect(splitLine("")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import { buildSegmentKey, parseSegmentKey } from "./segments";

describe("segment keys (length-encoded)", () => {
  it("round-trips host/file/gen/offset/length", () => {
    const key = buildSegmentKey("pc", "WoWCombatLog.txt", "abcd1234", 100, 50);
    expect(key).toBe(
      "raw/pc/WoWCombatLog.txt/abcd1234/000000000100_000000000050.seg",
    );
    const ref = parseSegmentKey(key);
    expect(ref).toEqual({
      hostname: "pc",
      logFileName: "WoWCombatLog.txt",
      gen8: "abcd1234",
      startOffset: 100,
      length: 50,
      key,
    });
  });
  it("rejects the old offset-only name and Drive conflict copies", () => {
    expect(parseSegmentKey("raw/pc/f/abcd1234/000000000100.seg")).toBeNull();
    expect(parseSegmentKey("raw/pc/f/abcd1234/100_50 (1).seg")).toBeNull();
    expect(parseSegmentKey("status/pc.json")).toBeNull();
  });
});

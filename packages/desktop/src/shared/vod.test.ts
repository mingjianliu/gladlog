import { describe, expect, it } from "vitest";

import { parseRange, vodUrl, vodUrlToPath } from "./vod";

describe("vodUrl 往返", () => {
  it("Windows 路径 + 中文 + 大小写全部保真", () => {
    for (const p of [
      "C:\\Users\\玩家\\Videos\\2026-07-28 20-11-05.mp4",
      "/Users/a/Movies/OBS/Match.MP4",
    ]) {
      expect(vodUrlToPath(vodUrl(p))).toBe(p);
    }
  });
  it("非法 url → null", () => {
    expect(vodUrlToPath("vod://v/%%%")).toBeNull();
    expect(vodUrlToPath("http://x/")).toBeNull();
  });
});

describe("parseRange", () => {
  it("常规区间/开区间/尾部区间", () => {
    expect(parseRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
  });
  it("越界 end 截到 size-1;start 越界/倒置/无头 → null", () => {
    expect(parseRange("bytes=0-5000", 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange("bytes=1000-", 1000)).toBeNull();
    expect(parseRange("bytes=9-3", 1000)).toBeNull();
    expect(parseRange(null, 1000)).toBeNull();
    expect(parseRange("chunks=0-1", 1000)).toBeNull();
  });
});

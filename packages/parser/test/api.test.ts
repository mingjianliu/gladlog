import { GladLogParser } from "../src/api";
import type { Segment, ShuffleClose } from "../src/l2/types";
import { vi } from "vitest";
import * as compose from "../src/l3/compose";

const LINES = [
  "6/30/2026 12:00:00.000  ARENA_MATCH_START,1825,41,3v3,1",
  '6/30/2026 12:00:01.000  SPELL_CAST_SUCCESS,Player-1-A,"Alice-X",0x512,0x80000000,0000000000000000,nil,0x80000000,0x80000000,2983,"Sprint",0x1,Player-1-A,0000000000000000,100,100,0,0,0,0,0,0,3,10,10,0,1.00,-1.00,0,1.0,70',
  "this line is garbage and must be counted as dropped",
  "6/30/2026 12:00:02.000  ARENA_MATCH_END,1,30,1500,1501",
];

describe("GladLogParser shell (L1+L2 wiring)", () => {
  it("push lines → matchSegment event + stats", () => {
    const p = new GladLogParser({ timezone: "UTC" });
    const segs: Segment[] = [];
    const shuffles: ShuffleClose[] = [];
    p.on("matchSegment", (s: Segment) => segs.push(s));
    p.on("shuffleSegments", (s: ShuffleClose) => shuffles.push(s));
    for (const l of LINES) p.push(l);
    p.end();
    expect(segs).toHaveLength(1);
    expect(shuffles).toHaveLength(0);
    expect(segs[0]!.bracket).toBe("3v3");
    const st = p.stats();
    expect(st.linesTotal).toBe(4);
    expect(st.linesDropped).toBe(1);
  });

  it("diagnostic event surfaces segment drops", () => {
    const p = new GladLogParser({ timezone: "UTC" });
    const diags: { code: string }[] = [];
    p.on("diagnostic", (d: { code: string }) => diags.push(d));
    p.push("6/30/2026 12:00:00.000  ARENA_MATCH_START,1825,41,3v3,1");
    p.end();
    expect(diags.some((d) => d.code === "UNCLOSED_SEGMENT")).toBe(true);
    expect(p.stats().segmentsDropped).toBe(1);
  });

  it("empty lines are ignored (not counted as dropped)", () => {
    const p = new GladLogParser({ timezone: "UTC" });
    p.push("");
    p.push("   ");
    p.end();
    const st = p.stats();
    expect(st.linesDropped).toBe(0);
  });

  it("trailing \\r (CRLF logs split on \\n) is stripped before parsing and hashing", () => {
    // UNIT_DIED 的假死位是最后一个参数;残留 \r 会让 "1\r" !== "1",假死误判为真死
    const run = (suffix: string) => {
      const p = new GladLogParser({ timezone: "UTC" });
      const segs: Segment[] = [];
      p.on("matchSegment", (s: Segment) => segs.push(s));
      const lines = [
        ...LINES.slice(0, 2),
        '6/30/2026 12:00:01.500  UNIT_DIED,0000000000000000,nil,0x80000000,0x80000000,Player-1-A,"Alice-X",0x512,0x80000000,1',
        ...LINES.slice(2),
      ];
      for (const l of lines) p.push(l + suffix);
      p.end();
      return segs;
    };
    const clean = run("");
    const crlf = run("\r");
    expect(crlf).toHaveLength(1);
    const died = crlf[0]!.records.find((r) => r.eventName === "UNIT_DIED");
    expect(died?.unitDied?.unconscious).toBe(true);
    // rawLines 已归一化,内容哈希与 LF 日志一致(与桌面端 tailReader 剥 \r 的行为对齐)
    expect(crlf[0]!.rawLines).toEqual(clean[0]!.rawLines);
  });

  it("diagnostic event surfaces BUILD_FAILED when buildMatch throws", () => {
    const p = new GladLogParser({ timezone: "UTC" });
    const diags: { code: string }[] = [];
    p.on("diagnostic", (d: { code: string }) => diags.push(d));

    const spy = vi.spyOn(compose, "buildMatch").mockImplementation(() => {
      throw new Error("Mocked failure");
    });

    p.push("6/30/2026 12:00:00.000  ARENA_MATCH_START,1825,41,3v3,1");
    p.push("6/30/2026 12:00:02.000  ARENA_MATCH_END,1,30,1500,1501");

    expect(diags.some((d) => d.code === "BUILD_FAILED")).toBe(true);
    spy.mockRestore();
  });

  it("diagnostic event surfaces BUILD_FAILED when buildShuffle throws", () => {
    const p = new GladLogParser({ timezone: "UTC" });
    const diags: { code: string }[] = [];
    p.on("diagnostic", (d: { code: string }) => diags.push(d));

    const spy = vi.spyOn(compose, "buildShuffle").mockImplementation(() => {
      throw new Error("Mocked failure");
    });

    p.push(
      "6/30/2026 12:00:00.000  ARENA_MATCH_START,1504,40,Rated Solo Shuffle,0",
    );
    p.push("6/30/2026 12:00:02.000  ARENA_MATCH_END,0,155,1729,1730");

    expect(diags.some((d) => d.code === "BUILD_FAILED")).toBe(true);
    spy.mockRestore();
  });
});

import { GladLogParser } from "../src/api";

function line(i: number, s: string): string {
  return `6/30/2026 12:00:${String(i).padStart(2, "0")}.000  ${s}`;
}
const CAST =
  'SPELL_CAST_SUCCESS,Player-1-A,"Alice-X",0x512,0x80000000,0000000000000000,nil,0x80000000,0x80000000,2983,"Sprint",0x1,Player-1-A,0000000000000000,100,100,0,0,0,0,0,0,3,10,10,0,1.00,-1.00,0,1.0,70';

describe("hasOpenSegment", () => {
  it("IDLE→false, in match→true, after END→false", () => {
    const p = new GladLogParser({ timezone: "UTC" });
    expect(p.hasOpenSegment()).toBe(false);
    p.push(line(0, "ARENA_MATCH_START,1825,41,3v3,1"));
    expect(p.hasOpenSegment()).toBe(true);
    p.push(line(1, CAST));
    expect(p.hasOpenSegment()).toBe(true);
    p.push(line(2, "ARENA_MATCH_END,1,30,1500,1501"));
    expect(p.hasOpenSegment()).toBe(false);
  });

  it("shuffle 回合间隙仍为 open(序列未闭合)", () => {
    const p = new GladLogParser({ timezone: "UTC" });
    p.push(line(0, "ARENA_MATCH_START,1504,40,Rated Solo Shuffle,0"));
    p.push(line(1, CAST));
    p.push(line(2, "ARENA_MATCH_START,1504,40,Rated Solo Shuffle,0"));
    // 回合 1 结束但 shuffle 未闭合
    expect(p.hasOpenSegment()).toBe(true);
  });
});

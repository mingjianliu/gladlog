import { deriveTimeline } from "../src/renderer/src/report/derive/timeline";
import { loadMatchFixture } from "./fixtures/loadFixture";

describe("deriveTimeline", () => {
  const m = loadMatchFixture();
  it("fixture(advanced 日志):每个 Player 一条序列,点按时间升序", () => {
    const t = deriveTimeline(m);
    expect(t.hasAdvanced).toBe(true);
    expect(t.series.length).toBeGreaterThan(0);
    for (const s of t.series) {
      for (let i = 1; i < s.points.length; i++)
        expect(s.points[i]!.t).toBeGreaterThanOrEqual(s.points[i - 1]!.t);
      for (const p of s.points) expect(p.maxHp).toBeGreaterThan(0);
    }
  });
  it("死亡标记数量=非假死 deaths 总数,时间在对局范围内", () => {
    const t = deriveTimeline(m);
    const expected = Object.values(m.units)
      .filter((u) => u.kind === "Player")
      .reduce((a, u) => a + u.deaths.filter((d) => !d.unconscious).length, 0);
    expect(t.deaths).toHaveLength(expected);
    for (const d of t.deaths) {
      expect(d.t).toBeGreaterThanOrEqual(t.start);
      expect(d.t).toBeLessThanOrEqual(t.end);
    }
  });
  it("hasAdvanced=false → series 空", () => {
    const noAdv = { ...m, hasAdvancedLogging: false };
    expect(deriveTimeline(noAdv).series).toEqual([]);
  });
});

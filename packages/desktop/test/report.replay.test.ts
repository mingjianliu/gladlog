import {
  deathPosition,
  deriveReplay,
  pathUpTo,
  type ReplayTrack,
  sampleAt,
} from "../src/renderer/src/report/derive/replay";
import { loadMatchFixture } from "./fixtures/loadFixture";

describe("deriveReplay", () => {
  const m = loadMatchFixture();
  const data = deriveReplay(m);

  it("每个有坐标样本的玩家一条轨迹,样本升序", () => {
    const expected = Object.values(m.units).filter(
      (u) => u.kind === "Player" && u.advancedSamples.length > 0,
    ).length;
    expect(data.tracks.length).toBe(expected);
    expect(data.tracks.length).toBeGreaterThan(0);
    for (const tr of data.tracks) {
      expect(tr.samples.length).toBeGreaterThan(0);
      for (let i = 1; i < tr.samples.length; i++)
        expect(tr.samples[i]!.t).toBeGreaterThanOrEqual(tr.samples[i - 1]!.t);
    }
  });

  it("bounds 包围所有样本坐标", () => {
    for (const tr of data.tracks) {
      for (const s of tr.samples) {
        expect(s.x).toBeGreaterThanOrEqual(data.bounds.minX);
        expect(s.x).toBeLessThanOrEqual(data.bounds.maxX);
        expect(s.y).toBeGreaterThanOrEqual(data.bounds.minY);
        expect(s.y).toBeLessThanOrEqual(data.bounds.maxY);
      }
    }
    expect(data.startTime).toBe(m.startTime);
    expect(data.endTime).toBe(m.endTime);
  });
});

describe("sampleAt(插值)", () => {
  const track: ReplayTrack = {
    unitId: "u1",
    name: "T",
    classId: 1,
    specId: 1,
    reaction: "Friendly",
    samples: [
      { t: 1000, x: 0, y: 0, hp: 100, maxHp: 100 },
      { t: 2000, x: 10, y: 20, hp: 50, maxHp: 100 },
    ],
    deathT: null,
  };

  it("端点外钳制到首/尾样本", () => {
    expect(sampleAt(track, 0)).toMatchObject({ x: 0, y: 0 });
    expect(sampleAt(track, 5000)).toMatchObject({ x: 10, y: 20 });
  });

  it("中点线性插值坐标与血量", () => {
    const at = sampleAt(track, 1500)!;
    expect(at.x).toBeCloseTo(5);
    expect(at.y).toBeCloseTo(10);
    expect(at.hp).toBeCloseTo(75);
  });

  it("阵亡后返回 null", () => {
    const dead: ReplayTrack = { ...track, deathT: 1800 };
    expect(sampleAt(dead, 1900)).toBeNull();
    expect(sampleAt(dead, 1500)).not.toBeNull();
  });

  it("空轨迹返回 null", () => {
    expect(sampleAt({ ...track, samples: [] }, 1500)).toBeNull();
  });
});

describe("pathUpTo(尾迹) / deathPosition", () => {
  const track: ReplayTrack = {
    unitId: "u1",
    name: "T",
    classId: 1,
    specId: 1,
    reaction: "Friendly",
    samples: [
      { t: 1000, x: 0, y: 0, hp: 100, maxHp: 100 },
      { t: 2000, x: 10, y: 0, hp: 100, maxHp: 100 },
      { t: 3000, x: 20, y: 0, hp: 100, maxHp: 100 },
    ],
    deathT: null,
  };

  it("只含窗口内样本 + 当前插值点", () => {
    const pts = pathUpTo(track, 2500, 1000); // 窗口 [1500,2500]
    // 样本 2000 在窗口内;1000 被裁掉;末尾追加 t=2500 的插值点(x=15)
    expect(pts[0]).toEqual({ x: 10, y: 0 });
    expect(pts[pts.length - 1]!.x).toBeCloseTo(15);
  });

  it("阵亡冻结尾迹,不越过死亡时刻", () => {
    const dead: ReplayTrack = { ...track, deathT: 2000 };
    const pts = pathUpTo(dead, 5000, 10000);
    expect(pts.every((p) => p.x <= 10)).toBe(true); // 死于 t=2000(x=10)
  });

  it("deathPosition = 死亡前最后样本;未阵亡 null", () => {
    expect(deathPosition(track)).toBeNull();
    expect(deathPosition({ ...track, deathT: 2500 })).toEqual({ x: 10, y: 0 });
  });
});

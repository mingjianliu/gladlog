import { positionKnownAt, type ReplayTrack } from "./replay";

const track = (
  sampleTs: number[],
  deathT: number | null = null,
): ReplayTrack => ({
  unitId: "u1",
  name: "U",
  classId: 1,
  specId: 1,
  reaction: "Friendly",
  deathT,
  samples: sampleTs.map((t) => ({ t, x: 0, y: 0, hp: 100, maxHp: 100 })),
});

describe("positionKnownAt", () => {
  it("首样本之前 → 未知(那段时间日志里没有该单位的任何坐标)", () => {
    const tr = track([1000, 2000]);
    expect(positionKnownAt(tr, 0)).toBe(false);
    expect(positionKnownAt(tr, 999)).toBe(false);
  });

  it("正好落在首样本 → 已知", () => {
    expect(positionKnownAt(track([1000]), 1000)).toBe(true);
  });

  it("首样本之后 → 已知", () => {
    expect(positionKnownAt(track([1000, 2000]), 1500)).toBe(true);
    expect(positionKnownAt(track([1000, 2000]), 99999)).toBe(true);
  });

  it("完全没有样本 → 未知", () => {
    expect(positionKnownAt(track([]), 500)).toBe(false);
  });

  it("阵亡之后 → 未知(交给阵亡残影渲染,不走存活分支)", () => {
    const tr = track([1000, 2000], 1800);
    expect(positionKnownAt(tr, 1500)).toBe(true);
    expect(positionKnownAt(tr, 1800)).toBe(false);
    expect(positionKnownAt(tr, 1900)).toBe(false);
  });
});

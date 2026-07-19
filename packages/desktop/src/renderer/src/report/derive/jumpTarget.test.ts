import type { CandidateEvent } from "@gladlog/analysis";

import { resolveJumpTarget } from "./jumpTarget";

const ev = (id: string, t: number, unitNames: string[] = []): CandidateEvent =>
  ({ id, t, type: "death", unitNames }) as unknown as CandidateEvent;

describe("resolveJumpTarget", () => {
  it("命中不到候选事件 → null(调用方据此不跳转,而不是跳到 0:00)", () => {
    expect(resolveJumpTarget([ev("a", 5)], ["nope"])).toBeNull();
    expect(resolveJumpTarget([], ["a"])).toBeNull();
  });

  it("取引用事件里最早的时刻", () => {
    const cands = [ev("a", 30), ev("b", 12), ev("c", 44)];
    expect(resolveJumpTarget(cands, ["a", "b", "c"])?.t).toBe(12);
  });

  it("只看被引用的事件,不被更早的无关事件带偏", () => {
    const cands = [ev("early", 1), ev("a", 30), ev("b", 20)];
    expect(resolveJumpTarget(cands, ["a", "b"])?.t).toBe(20);
  });

  it("合并涉及单位并去重", () => {
    const cands = [ev("a", 10, ["甲", "乙"]), ev("b", 20, ["乙", "丙"])];
    expect(resolveJumpTarget(cands, ["a", "b"])?.unitNames).toEqual([
      "甲",
      "乙",
      "丙",
    ]);
  });
});

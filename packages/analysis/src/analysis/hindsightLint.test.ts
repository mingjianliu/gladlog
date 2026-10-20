import { describe, expect, it } from "vitest";

import {
  HINDSIGHT_CLUSTER_SLACK_S,
  hindsightViolations,
} from "./hindsightLint";
import type { CandidateEvent } from "./types";

const mk = (id: string, type: string, t?: number): CandidateEvent => ({
  id,
  type,
  t: t ?? 0,
  unitNames: [],
  facts: t === undefined ? {} : { t: String(t) },
});
const byId = (...es: CandidateEvent[]) => new Map(es.map((e) => [e.id, e]));

describe("hindsightViolations", () => {
  it("跨类型且超出聚簇窗 ⇒ 违规,理由含三个具体值", () => {
    const m = byId(
      mk("a", "kick-eaten", 130),
      mk("b", "death-unused-defensive", 161),
    );
    const v = hindsightViolations(["a", "b"], m);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("130");
    expect(v[0]).toContain("161");
    expect(v[0]).toContain("death-unused-defensive");
  });
  it("恰好 30s 边界 ⇒ 通过(> 才违规)", () => {
    const m = byId(mk("a", "kick-eaten", 100), mk("b", "cc-locked", 130));
    expect(hindsightViolations(["a", "b"], m)).toEqual([]);
  });
  it("同 type 跨时段 ⇒ 通过(模式豁免)", () => {
    const m = byId(mk("a", "kick-eaten", 10), mk("b", "kick-eaten", 200));
    expect(hindsightViolations(["a", "b"], m)).toEqual([]);
  });
  it("whole-round 引用不参与锚点、也不豁免其余引用", () => {
    const m = byId(
      mk("w", "cd-waste"),
      mk("a", "kick-eaten", 130),
      mk("b", "cc-locked", 200),
    );
    expect(hindsightViolations(["w", "a", "b"], m)).toHaveLength(1);
  });
  it("有时刻事件不足 2 个 ⇒ 通过", () => {
    const m = byId(mk("w", "cd-waste"), mk("a", "kick-eaten", 130));
    expect(hindsightViolations(["w", "a"], m)).toEqual([]);
    expect(hindsightViolations(["a"], m)).toEqual([]);
  });
  it("锚点并列多 type:远期事件 type 在聚簇内出现过 ⇒ 通过", () => {
    const m = byId(
      mk("a", "kick-eaten", 10),
      mk("b", "cc-locked", 12),
      mk("c", "cc-locked", 300),
    );
    expect(hindsightViolations(["a", "b", "c"], m)).toEqual([]);
  });
  it("多个远期跨类型引用逐条报告", () => {
    const m = byId(
      mk("a", "kick-eaten", 10),
      mk("b", "cc-locked", 100),
      mk("c", "wasted-trinket", 200),
    );
    expect(hindsightViolations(["a", "b", "c"], m)).toHaveLength(2);
  });
  it("常量导出为 30", () => {
    expect(HINDSIGHT_CLUSTER_SLACK_S).toBe(30);
  });
});

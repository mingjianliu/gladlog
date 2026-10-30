import { selfReviewNote } from "../src/renderer/src/report/derive/selfReviewNote";

// AI 自查标注(2026-10-15):按存下的原版逐条比,不信模型自报的改动日志。
const f = (id: string, explanation: string, severity = "med") => ({
  category: "survival",
  eventIds: [id],
  severity,
  title: "t",
  explanation,
});

describe("selfReviewNote", () => {
  it("没开 / 跳过 → 不显示", () => {
    expect(selfReviewNote({ findings: [f("a", "x")] })).toBeNull();
    expect(
      selfReviewNote({ findings: [], selfReview: { status: "skipped" } }),
    ).toBeNull();
  });
  it("失败 → 未自查", () => {
    expect(
      selfReviewNote({ findings: [f("a", "x")], selfReview: { status: "failed" } }),
    ).toBe("未自查 · AI 自查没有成功,显示的是原始结果");
  });
  it("自查过:数改了几条、删了几条;severity 变了也算改动", () => {
    const original = [f("a", "x"), f("b", "y"), f("c", "z", "high")];
    expect(
      selfReviewNote({
        findings: [f("a", "x2"), f("c", "z", "med")],
        selfReview: { status: "reviewed", original },
      }),
    ).toBe("已 AI 自查 · 2 条结论有改动 · 删去 1 条");
    expect(
      selfReviewNote({
        findings: original,
        selfReview: { status: "reviewed", original },
      }),
    ).toBe("已 AI 自查 · 没有改动");
  });
  it("深挖之后(带 deepDive 字段)照样按原文比", () => {
    const original = [f("a", "x")];
    expect(
      selfReviewNote({
        findings: [{ ...f("a", "x"), deepDive: { text: "d", chips: [] } }],
        selfReview: { status: "reviewed", original },
      } as never),
    ).toBe("已 AI 自查 · 没有改动");
  });
});

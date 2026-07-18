// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { KeyMomentAxis } from "../src/renderer/src/report/components/KeyMomentAxis";
import type { KeyMoment } from "../src/renderer/src/report/derive/keyMoments";

const moments: KeyMoment[] = [
  {
    t: 10,
    kind: "defensive",
    side: "friendly",
    title: "交饰品",
    unitNames: ["A"],
    jumpT: 10,
  },
  {
    t: 90,
    kind: "death",
    side: "friendly",
    title: "阵亡",
    unitNames: ["B"],
    jumpT: 90,
  },
];
const candidates = [
  { id: "e1", type: "death", t: 41, unitNames: ["B"], facts: {} },
] as never[];
const findings = [
  {
    eventIds: ["e1"],
    severity: "high",
    category: "survival",
    title: "被秒",
    explanation: "x",
  },
  {
    eventIds: ["nope"],
    severity: "low",
    category: "cooldowns",
    title: "整场未用",
    explanation: "y",
  },
] as never[];

describe("KeyMomentAxis", () => {
  it("按 t 归并排序,finding 挂在解析出的时刻;无 t finding 不渲染", () => {
    render(
      <KeyMomentAxis
        moments={moments}
        findings={findings}
        candidates={candidates}
        onSelectEvidence={() => {}}
      />,
    );
    const nodes = screen.getAllByTestId("axis-node");
    // 10s 饰品 → 41s finding → 90s 死亡
    expect(nodes.length).toBe(3);
    expect(nodes[1]!.textContent).toContain("被秒");
    expect(screen.queryByText("整场未用")).toBeNull();
  });

  it("相邻 >30s 插省略标;点击节点回调 onSeek", () => {
    const onSeek = vi.fn();
    render(
      <KeyMomentAxis
        moments={moments}
        findings={[]}
        candidates={[]}
        onSeek={onSeek}
        onSelectEvidence={() => {}}
      />,
    );
    expect(screen.getAllByTestId("axis-gap").length).toBe(1); // 10→90 = 80s
    fireEvent.click(screen.getAllByTestId("axis-node")[0]!);
    expect(onSeek).toHaveBeenCalledWith(10, ["A"]);
  });
});

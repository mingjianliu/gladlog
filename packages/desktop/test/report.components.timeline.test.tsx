// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";

import { Timeline } from "../src/renderer/src/report/components/Timeline";
import {
  deriveFlowSeries,
  type FlowMetric,
} from "../src/renderer/src/report/derive/flowSeries";
import {
  activeRuns,
  deriveTimeline,
} from "../src/renderer/src/report/derive/timeline";
import { loadMatchFixture } from "./fixtures/loadFixture";

const m = loadMatchFixture();

describe("Timeline", () => {
  it("每个序列一条 path,死亡标记数量正确", () => {
    const data = deriveTimeline(m);
    const { container } = render(<Timeline data={data} />);
    expect(container.querySelectorAll("path.rpt-tl-line")).toHaveLength(
      data.series.length,
    );
    expect(container.querySelectorAll(".rpt-tl-death")).toHaveLength(
      data.deaths.length,
    );
  });
  it("series 空(无 advanced)也能渲染", () => {
    const data = deriveTimeline({ ...m, hasAdvancedLogging: false });
    const { container } = render(<Timeline data={data} />);
    expect(
      container.querySelector("[data-testid='rpt-timeline']"),
    ).toBeTruthy();
  });
  it("⚠ 聚簇(P1-4):tS 相近的 3 个 marks 并为 1 个 ⚠3 节点;相距远的独立", () => {
    const data = deriveTimeline(m);
    const durS = (data.end - data.start) / 1000;
    // Neighbours are 4 viewBox pixels apart (within the 8px threshold); the
    // 4th is far away
    const step = (durS * 4) / 800;
    const marks = [
      { tS: 10, label: "a", severity: "minor" },
      { tS: 10 + step, label: "b", severity: "major" },
      { tS: 10 + 2 * step, label: "c", severity: "average" },
      { tS: durS * 0.8, label: "d", severity: "minor" },
    ];
    const { container } = render(<Timeline data={data} marks={marks} />);
    const nodes = container.querySelectorAll("[data-testid='tl-mistake']");
    expect(nodes).toHaveLength(2);
    expect(nodes[0]!.textContent).toContain("⚠3");
    // The group takes the colour of its most severe member
    expect(nodes[0]!.getAttribute("class")).toContain("rpt-tl-mistake-major");
  });
  it("图例(P1-4):每系列一项,点击回调 onSelectUnit;隐藏系列降透明", () => {
    const data = deriveTimeline(m);
    const hidden = new Set([data.series[0]!.unitId]);
    const calls: string[] = [];
    const { container } = render(
      <Timeline
        data={data}
        hidden={hidden}
        onSelectUnit={(id) => calls.push(id)}
      />,
    );
    const items = container.querySelectorAll(".rpt-tl-legend-item");
    expect(items).toHaveLength(data.series.length);
    expect(items[0]!.className).toContain("off");
    fireEvent.click(items[0]!);
    expect(calls).toEqual([data.series[0]!.unitId]);
  });
  it("dampening 泳道(#10 T2):不传无 rect,传入按 pct 变化分段渲染 + 悬浮显示百分比", () => {
    const data = deriveTimeline(m);
    const { container: noDamp } = render(<Timeline data={data} />);
    expect(
      noDamp.querySelectorAll("[data-testid='rpt-damp-lane']"),
    ).toHaveLength(0);

    const dampening = [
      { tS: 0, pct: 10 },
      { tS: 1, pct: 10 },
      { tS: 2, pct: 25 },
      { tS: 3, pct: 25 },
    ];
    const { container } = render(
      <Timeline data={data} dampening={dampening} />,
    );
    const rects = container.querySelectorAll("[data-testid='rpt-damp-lane']");
    // Consecutive equal pct values merge into one span: 10/10/25/25 -> 2
    // spans (not 4 rects drawn second by second)
    expect(rects).toHaveLength(2);
    expect(rects[1]!.getAttribute("opacity")).toBe("0.25");
    expect(rects[1]!.textContent).toContain("25%");
  });

  it("dampening 泳道:pct=0 的段也画(透明)并带「Dampening 0%」悬浮 —— 消灭开局的悬浮死区(#10 残留,2026-09-02)", () => {
    const data = deriveTimeline(m);
    const dampening = [
      { tS: 0, pct: 0 },
      { tS: 1, pct: 0 },
      { tS: 2, pct: 10 },
    ];
    const { container } = render(
      <Timeline data={data} dampening={dampening} />,
    );
    const rects = container.querySelectorAll("[data-testid='rpt-damp-lane']");
    // 0/0/10 -> two runs; the zero run is a real (hoverable) rect at opacity 0
    expect(rects).toHaveLength(2);
    expect(rects[0]!.getAttribute("opacity")).toBe("0");
    expect(rects[0]!.textContent).toContain("Dampening 0%");
    expect(rects[1]!.textContent).toContain("10%");
  });
});

describe("Timeline 指标下拉(每秒堆叠柱)", () => {
  const data = deriveTimeline(m);
  const flowOf = (metric: FlowMetric) => deriveFlowSeries(m, metric);

  it("不传 onMetric 时不渲染下拉(下拉出现前的调用点原样)", () => {
    const { container } = render(<Timeline data={data} />);
    expect(container.querySelector("[data-testid='tl-metric']")).toBeNull();
    expect(
      container.querySelectorAll("path.rpt-tl-line").length,
    ).toBeGreaterThan(0);
  });

  it("五个选项、默认血量、切换回调", () => {
    const onMetric = vi.fn();
    render(<Timeline data={data} metric="hp" onMetric={onMetric} />);
    const select = screen.getByTestId("tl-metric") as HTMLSelectElement;
    expect(
      Array.from(select.querySelectorAll("option")).map((o) => o.textContent),
    ).toEqual(["血量", "伤害", "治疗", "承伤", "被治疗"]);
    expect(select.value).toBe("hp");
    fireEvent.change(select, { target: { value: "taken" } });
    expect(onMetric).toHaveBeenCalledWith("taken");
  });

  it("切到流量指标:血量曲线消失,每个有数据的单位一条柱子 path", () => {
    const flow = flowOf("damage");
    const withData = flow.units.filter((u) => u.total > 0);
    expect(withData.length).toBeGreaterThan(0);
    const { container } = render(
      <Timeline data={data} metric="damage" onMetric={() => {}} flow={flow} />,
    );
    expect(container.querySelectorAll("path.rpt-tl-line")).toHaveLength(0);
    // A unit with no damage contributes no rectangles at all — an empty `d`
    // would still be a node, so the count is over units that actually have data
    const bars = Array.from(
      container.querySelectorAll<SVGPathElement>("[data-testid='tl-flow-bar']"),
    ).filter((p) => (p.getAttribute("d") ?? "").length > 0);
    expect(bars).toHaveLength(withData.length);
    // 轴换成金额刻度(与榜单同一个缩写函数),不再是百分比
    const axis = Array.from(container.querySelectorAll(".rpt-tl-axis")).map(
      (t) => t.textContent,
    );
    expect(axis.some((t) => t?.includes("%"))).toBe(false);
    expect(axis.filter((t) => t && t !== "0").length).toBeGreaterThan(0);
  });

  it("隐藏单位:柱子随之消失,纵轴按剩下的单位重新缩放", () => {
    const flow = flowOf("damage");
    const top = [...flow.units].sort((a, b) => b.total - a.total)[0]!;
    const axisOf = (el: HTMLElement) =>
      Array.from(el.querySelectorAll(".rpt-tl-axis"))
        .map((t) => t.textContent ?? "")
        .join("|");
    const { container: all } = render(
      <Timeline data={data} metric="damage" onMetric={() => {}} flow={flow} />,
    );
    const { container: less } = render(
      <Timeline
        data={data}
        metric="damage"
        onMetric={() => {}}
        flow={flow}
        hidden={new Set([top.unitId])}
      />,
    );
    const barsOf = (el: HTMLElement) =>
      Array.from(
        el.querySelectorAll<SVGPathElement>("[data-testid='tl-flow-bar']"),
      ).filter((p) => (p.getAttribute("d") ?? "").length > 0).length;
    expect(barsOf(less)).toBe(barsOf(all) - 1);
    expect(axisOf(less)).not.toBe(axisOf(all));
    // 图例仍列出全部单位(否则隐藏了就再也点不回来)
    expect(less.querySelectorAll(".rpt-tl-legend-item")).toHaveLength(
      flow.units.length,
    );
  });

  it("该指标全场无数据 → 空态提示,不画空图", () => {
    const flow = flowOf("healed");
    const blank = {
      ...flow,
      units: flow.units.map((u) => ({
        ...u,
        total: 0,
        buckets: u.buckets.map(() => 0),
      })),
    };
    const { container } = render(
      <Timeline data={data} metric="healed" onMetric={() => {}} flow={blank} />,
    );
    expect(
      container.querySelectorAll("[data-testid='tl-flow-bar']"),
    ).toHaveLength(0);
    expect(screen.getByTestId("tl-flow-empty").textContent).toContain("被治疗");
  });

  it("没有 advanced logging(HP 序列为空)时,流量图与图例照样有内容", () => {
    const noAdv = deriveTimeline({ ...m, hasAdvancedLogging: false });
    expect(noAdv.series).toHaveLength(0);
    const flow = flowOf("damage");
    const { container } = render(
      <Timeline data={noAdv} metric="damage" onMetric={() => {}} flow={flow} />,
    );
    expect(
      Array.from(
        container.querySelectorAll<SVGPathElement>(
          "[data-testid='tl-flow-bar']",
        ),
      ).filter((p) => (p.getAttribute("d") ?? "").length > 0).length,
    ).toBeGreaterThan(0);
    expect(
      container.querySelectorAll(".rpt-tl-legend-item").length,
    ).toBeGreaterThan(0);
  });
});

describe("HP curve plateau fade + hover focus (UI review #2)", () => {
  it("每序列一条基线 path + 每个活跃段一条 rpt-tl-seg;hover 图例给其他序列加 dim", () => {
    const data = deriveTimeline(m);
    const { container } = render(<Timeline data={data} />);
    expect(container.querySelectorAll("path.rpt-tl-line")).toHaveLength(
      data.series.length,
    );
    const segs = container.querySelectorAll("path.rpt-tl-seg").length;
    const expected = data.series.reduce(
      (a, s) => a + activeRuns(s.points).length,
      0,
    );
    expect(segs).toBe(expected);
    const legend = screen
      .getByTestId("tl-legend")
      .querySelectorAll(".rpt-tl-legend-item");
    fireEvent.mouseEnter(legend[0]!);
    expect(
      container.querySelectorAll("path.rpt-tl-line.rpt-tl-dim"),
    ).toHaveLength(data.series.length - 1);
    fireEvent.mouseLeave(legend[0]!);
    expect(container.querySelectorAll(".rpt-tl-dim")).toHaveLength(0);
  });
});

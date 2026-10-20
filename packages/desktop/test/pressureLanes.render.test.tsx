// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Timeline } from "../src/renderer/src/report/components/Timeline";

// Minimal data: neither series nor deaths are required -- only start/end need
// to be valid
const data = { start: 0, end: 90_000, series: [], deaths: [] } as never;

describe("Timeline 承压泳道", () => {
  const pressure = {
    spikes: [
      {
        fromS: 30,
        toS: 40,
        targetName: "P2-R",
        totalDamage: 1_200_000,
        dpsK: 120,
      },
    ],
    exposures: [
      {
        tS: 35,
        label: "Critical" as const,
        title: "治疗暴露(Critical)· 2 威胁在 LoS · 饰品转 CD",
      },
    ],
  };

  it("有 pressure 时渲染 spike 块与 exposure 标记;缺省不渲染", () => {
    const { container, rerender } = render(
      <Timeline
        data={data}
        hidden={new Set()}
        onSelectUnit={() => {}}
        pressure={pressure}
      />,
    );
    expect(
      container.querySelectorAll('[data-testid="pressure-spike"]'),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll('[data-testid="pressure-exposure"]'),
    ).toHaveLength(1);
    rerender(
      <Timeline data={data} hidden={new Set()} onSelectUnit={() => {}} />,
    );
    expect(
      container.querySelector('[data-testid="pressure-spike"]'),
    ).toBeNull();
  });

  it("点击 spike 块 → onRangeSelect(fromS, toS)", () => {
    const onRangeSelect = vi.fn();
    const { container } = render(
      <Timeline
        data={data}
        hidden={new Set()}
        onSelectUnit={() => {}}
        pressure={pressure}
        onRangeSelect={onRangeSelect}
      />,
    );
    fireEvent.click(container.querySelector('[data-testid="pressure-spike"]')!);
    expect(onRangeSelect).toHaveBeenCalledWith(30, 40);
  });

  it("spike 块 title 含承压方与量级;exposure title 原样透传", () => {
    const { container } = render(
      <Timeline
        data={data}
        hidden={new Set()}
        onSelectUnit={() => {}}
        pressure={pressure}
      />,
    );
    expect(
      container.querySelector('[data-testid="pressure-spike"] title')
        ?.textContent,
    ).toMatch(/P2.*1\.20M.*120k/);
    expect(
      container.querySelector('[data-testid="pressure-exposure"] title')
        ?.textContent,
    ).toContain("治疗暴露");
  });
});

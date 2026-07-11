// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { Timeline } from "../src/renderer/src/report/components/Timeline";
import { UnitPanel } from "../src/renderer/src/report/components/UnitPanel";
import { deriveTimeline } from "../src/renderer/src/report/derive/timeline";
import { deriveCasts } from "../src/renderer/src/report/derive/casts";
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
});

describe("UnitPanel", () => {
  it("渲染选中单位的名字与施法行数", () => {
    const u = Object.values(m.units).find(
      (x) => x.kind === "Player" && x.casts.length > 0,
    )!;
    render(<UnitPanel source={m} unitId={u.id} />);
    expect(screen.getAllByText(u.name).length).toBeGreaterThan(0);
    const casts = deriveCasts(m, u.id);
    expect(screen.getByText(`施法(${casts.length})`)).toBeTruthy(); // 面板显示条数
  });
});

// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";

import { FindingsList } from "../src/renderer/src/report/components/FindingsList";
import { ReplayView } from "../src/renderer/src/report/components/ReplayView";
import { deriveReplay } from "../src/renderer/src/report/derive/replay";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const m = loadRealMatchFixture();

const findings = [
  {
    eventIds: ["e1"],
    severity: "high",
    category: "survival",
    title: "Death",
    explanation: "You died at 30s.",
  },
];

describe("证据链跳转(evidence → replay seek)", () => {
  it("FindingsList:传 onJump 时渲染「回放此刻」按钮并带 eventIds 回调", () => {
    const jumped: string[][] = [];
    render(
      <FindingsList
        findings={findings as never}
        onSelect={() => {}}
        onJump={(ids) => jumped.push(ids)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /回放此刻/ }));
    expect(jumped).toEqual([["e1"]]);
  });

  it("FindingsList:不传 onJump 时没有跳转按钮(旧行为不变)", () => {
    render(<FindingsList findings={findings as never} onSelect={() => {}} />);
    expect(screen.queryByRole("button", { name: /回放此刻/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Evidence/ })).toBeTruthy();
  });

  it("ReplayView:seekReq 定位时钟到目标时刻并暂停(时间显示为目标 mm:ss)", () => {
    const { startTime } = deriveReplay(m);
    // 目标 = 开场 +42s
    const { container } = render(
      <ReplayView
        source={m}
        seekReq={{ tMs: startTime + 42_000, unitNames: [], nonce: 1 }}
      />,
    );
    const time = container.querySelector(".rpt-replay-time");
    expect(time?.textContent).toMatch(/^0:42 \//);
    // 未在播放(按钮是「播放」不是「暂停」)
    expect(screen.getByRole("button", { name: /播放/ })).toBeTruthy();
  });

  it("ReplayView:seekReq 超出末尾时收编到 endTime(不越界)", () => {
    const { startTime, endTime } = deriveReplay(m);
    const { container } = render(
      <ReplayView
        source={m}
        seekReq={{ tMs: endTime + 60_000, unitNames: [], nonce: 2 }}
      />,
    );
    const time = container.querySelector(".rpt-replay-time");
    const end = Math.max(0, (endTime - startTime) / 1000);
    const mmss = `${Math.floor(end / 60)}:${Math.floor(end % 60)
      .toString()
      .padStart(2, "0")}`;
    expect(time?.textContent?.startsWith(`${mmss} /`)).toBe(true);
  });

  it("ReplayView:同 nonce 不重复消费(用户 seek 后 scrub 不被拉回)", () => {
    const { startTime } = deriveReplay(m);
    const { container } = render(
      <ReplayView
        source={m}
        seekReq={{ tMs: startTime + 42_000, unitNames: [], nonce: 3 }}
      />,
    );
    const scrub = container.querySelector(
      ".rpt-replay-scrub",
    ) as HTMLInputElement;
    fireEvent.change(scrub, { target: { value: String(startTime + 5_000) } });
    const time = container.querySelector(".rpt-replay-time");
    expect(time?.textContent).toMatch(/^0:05 \//);
  });
});

import { TimelineStrip } from "../src/renderer/src/report/components/TimelineStrip";
import { deriveVulnBands } from "../src/renderer/src/report/derive/vulnWindows";

const candidates = [
  { id: "e1", type: "death", t: 30, unitNames: ["A"], facts: { t: "0:30" } },
  { id: "e2", type: "cc", t: 60, unitNames: ["B"], facts: { t: "1:00" } },
];

describe("#8 收尾:strip 跳转 + 窗口色带", () => {
  it("TimelineStrip:有选中标记且传 onJump 时显示「回放此刻」,跳最早选中的 t", () => {
    const jumps: number[] = [];
    render(
      <TimelineStrip
        candidates={candidates as never}
        activeEventIds={["e2", "e1"]}
        onSelect={() => {}}
        onJump={(t) => jumps.push(t)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /回放此刻/ }));
    expect(jumps).toEqual([30]);
  });

  it("TimelineStrip:无选中标记时不显示跳转按钮;色带按 kind 渲染", () => {
    const { container } = render(
      <TimelineStrip
        candidates={candidates as never}
        activeEventIds={[]}
        onSelect={() => {}}
        onJump={() => {}}
        bands={[
          { kind: "burst", fromS: 10, toS: 20, targetName: "X", damage: 90000 },
          {
            kind: "vulnerable",
            fromS: 40,
            toS: 55,
            targetName: "Y",
            damage: 8000,
          },
        ]}
      />,
    );
    expect(screen.queryByRole("button", { name: /回放此刻/ })).toBeNull();
    const bands = container.querySelectorAll('[data-testid="strip-band"]');
    expect(bands.length).toBe(2);
    expect(bands[0]!.className).toContain("burst");
    expect(bands[1]!.className).toContain("vulnerable");
  });

  it("deriveVulnBands:真实 fixture 出带且时间升序、kind 合法", () => {
    const bands = deriveVulnBands(m);
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i]!.fromS).toBeGreaterThanOrEqual(bands[i - 1]!.fromS);
    }
    for (const b of bands) {
      expect(["burst", "vulnerable"]).toContain(b.kind);
      expect(b.toS).toBeGreaterThanOrEqual(b.fromS);
    }
  });

  it("回放 scrubber:真实 fixture 渲染出色带容器", () => {
    const { container } = render(<ReplayView source={m} />);
    expect(container.querySelector(".rpt-replay-bands")).toBeTruthy();
  });

  it("色带可点:scrubber 色带点击 → 时钟定位到带起点;strip 色带点击 → onJump(fromS)", () => {
    // scrubber 侧
    const { container } = render(<ReplayView source={m} />);
    const band = container.querySelector(".rpt-replay-band") as HTMLElement;
    expect(band).toBeTruthy();
    fireEvent.click(band);
    const time = container.querySelector(".rpt-replay-time");
    expect(time?.textContent?.startsWith("0:00 /")).toBe(false);

    // strip 侧
    const jumps: number[] = [];
    const { container: c2 } = render(
      <TimelineStrip
        candidates={candidates as never}
        activeEventIds={[]}
        onSelect={() => {}}
        onJump={(t) => jumps.push(t)}
        bands={[
          { kind: "burst", fromS: 12, toS: 20, targetName: "X", damage: 90000 },
        ]}
      />,
    );
    fireEvent.click(c2.querySelector('[data-testid="strip-band"]')!);
    expect(jumps).toEqual([12]);
  });
});

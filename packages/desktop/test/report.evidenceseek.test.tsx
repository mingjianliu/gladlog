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
    // Target = match start +42s
    const { container } = render(
      <ReplayView
        source={m}
        seekReq={{ tMs: startTime + 42_000, unitNames: [], nonce: 1 }}
      />,
    );
    const time = container.querySelector(".rpt-replay-time");
    expect(time?.textContent).toMatch(/^0:42 \//);
    // Not playing (the button reads "play", not "pause")
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

import { deriveVulnBands } from "../src/renderer/src/report/derive/vulnWindows";

describe("#8 收尾:窗口色带", () => {
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

  it("色带可点:scrubber 色带点击 → 时钟定位到带起点", () => {
    const { container } = render(<ReplayView source={m} />);
    const band = container.querySelector(".rpt-replay-band") as HTMLElement;
    expect(band).toBeTruthy();
    fireEvent.click(band);
    const time = container.querySelector(".rpt-replay-time");
    expect(time?.textContent?.startsWith("0:00 /")).toBe(false);
  });
});

describe("战报 HP 时间轴色带", () => {
  it("真实 fixture:时间轴渲染色带,点击切到回放并定位", async () => {
    const { MatchReport } = await import(
      "../src/renderer/src/report/components/MatchReport"
    );
    const { container } = render(<MatchReport source={m} matchId="t" />);
    const band = container.querySelector('[data-testid="tl-band"]');
    expect(band).toBeTruthy();
    fireEvent.click(band!);
    // Switched to the replay view and the clock is not at 0:00 (it seeked to
    // the band's start)
    const time = container.querySelector(".rpt-replay-time");
    expect(time).toBeTruthy();
    expect(time?.textContent?.startsWith("0:00 /")).toBe(false);
  });
});

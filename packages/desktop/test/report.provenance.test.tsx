// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";

import { EventsPanel } from "../src/renderer/src/report/components/EventsPanel";
import { FindingsList } from "../src/renderer/src/report/components/FindingsList";
import { deriveVulnBands } from "../src/renderer/src/report/derive/vulnWindows";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const m = loadRealMatchFixture();

describe("B2 溯源深链(finding → 原始事件)", () => {
  it("FindingsList:⛏ 按钮以最早证据事件为锚回调", () => {
    const calls: Array<[number, string[]]> = [];
    render(
      <FindingsList
        findings={
          [
            {
              severity: "high",
              title: "T",
              explanation: "E",
              eventIds: ["ev-b", "ev-a"],
            },
          ] as never[]
        }
        onSelect={() => {}}
        onInspect={(t, names) => calls.push([t, names])}
        candidates={
          [
            { id: "ev-a", t: 42, unitNames: ["Player1-Test"], facts: {} },
            { id: "ev-b", t: 55, unitNames: ["Player2-Test"], facts: {} },
          ] as never[]
        }
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /原始事件/ }));
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe(42); // 最早证据
    expect(calls[0]![1]).toEqual(["Player1-Test"]);
  });

  it("EventsPanel:溯源请求落地为 ±窗口 + 单位过滤,行全部在窗口内", () => {
    const bands = deriveVulnBands(m);
    const { container } = render(
      <EventsPanel
        source={m}
        bands={bands}
        globalRange={null}
        inspectReq={{ fromS: 30, toS: 60, unitName: "Player1", nonce: 1 }}
      />,
    );
    const selects = container.querySelectorAll("select");
    // 单位下拉选中 Player1;锚定下拉选中 custom(溯源窗口)
    expect((selects[0] as HTMLSelectElement).value).toBe("Player1");
    expect((selects[1] as HTMLSelectElement).value).toBe("custom");
    expect(
      screen.getByRole("option", { name: /溯源窗口 0:30–1:00/ }),
    ).toBeTruthy();
    const times = [
      ...container.querySelectorAll(".rpt-events-table tbody td:first-child"),
    ].map((td) => td.textContent!);
    expect(times.length).toBeGreaterThan(0);
    for (const t of times) {
      const [mm, ss] = t.split(":").map(Number);
      const s = mm! * 60 + ss!;
      expect(s).toBeGreaterThanOrEqual(30);
      expect(s).toBeLessThanOrEqual(60);
    }
  });
});

describe("B2 溯源深链(事件 → raw.txt 原始行)", () => {
  it("行带 lineIndex 且有 matchId → ㏒ 按钮取原始行并展示", async () => {
    const clone = JSON.parse(JSON.stringify(m)) as typeof m;
    // 全量注入 lineIndex(裁剪 fixture 解析自旧档,无此字段;首屏 300 行
    // 分页,单点注入不保证可见)
    for (const u of Object.values(clone.units) as unknown as Record<
      string,
      { lineIndex?: number }[]
    >[]) {
      for (const k of ["damageOut", "healOut", "casts", "auraEvents"]) {
        for (const e of u[k] ?? []) e.lineIndex = 42;
      }
    }

    const calls: unknown[] = [];
    (window as never as { __gladlogFixture: unknown }).__gladlogFixture = {
      matches: {
        rawLine: async (...args: unknown[]) => {
          calls.push(args);
          return { line: "RAW,SPELL_DAMAGE,demo", fileLine: 42 };
        },
      },
    };
    const { findByText } = render(
      <EventsPanel
        source={clone}
        bands={[]}
        globalRange={null}
        matchId="store-id-1"
      />,
    );
    const btns = await screen.findAllByTitle("查看原始日志行");
    fireEvent.click(btns[0]!);
    expect(await findByText(/RAW,SPELL_DAMAGE,demo/)).toBeTruthy();
    expect(calls).toEqual([["store-id-1", { roundSeq: null, lineIndex: 42 }]]);
    delete (window as never as { __gladlogFixture?: unknown }).__gladlogFixture;
  });

  it("无 matchId(fixture/测试台)→ ㏒ 按钮不渲染", () => {
    const clone = JSON.parse(JSON.stringify(m)) as typeof m;
    const u = Object.values(clone.units).find(
      (x) => (x as { damageOut?: unknown[] }).damageOut?.length,
    ) as { damageOut: { lineIndex?: number }[] };
    u.damageOut[0]!.lineIndex = 7;
    const { container } = render(
      <EventsPanel source={clone} bands={[]} globalRange={null} />,
    );
    expect(container.querySelector('[title="查看原始日志行"]')).toBeNull();
  });
});

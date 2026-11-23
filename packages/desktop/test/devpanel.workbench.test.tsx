// @vitest-environment jsdom
import { act, fireEvent, render, waitFor } from "@testing-library/react";

import type { StoredMatchMeta } from "../src/main/matchStore";
import { DevPanel } from "../src/renderer/src/components/DevPanel";
import { installDevFixture } from "./support/devPanelFixture";

const meta = (over: Partial<StoredMatchMeta>): StoredMatchMeta =>
  ({
    id: "m1",
    kind: "match",
    bracket: "3v3",
    zoneId: "1505",
    startTime: 1_700_000_000_000,
    endTime: 1_700_000_180_000,
    result: "Win",
    storedAt: 1_700_000_200_000,
    ...over,
  }) as StoredMatchMeta;

async function mount(opts: Parameters<typeof installDevFixture>[0] = {}) {
  const h = installDevFixture(opts);
  const view = render(<DevPanel />, { container: h.container });
  await waitFor(() =>
    expect(view.container.querySelector("[data-testid=dev-rail]")).toBeTruthy(),
  );
  return { ...h, view };
}

describe("导航 rail:四区各占全高工作区", () => {
  it("默认停在监控状态区", async () => {
    const { view } = await mount();
    expect(
      view.container
        .querySelector("[data-testid=dev-nav-watch]")!
        .className.includes("active"),
    ).toBe(true);
    expect(
      view.container.querySelector("[data-testid=dev-zone-watch]"),
    ).toBeTruthy();
  });

  it("切区只渲染当前区(旧实现五卡同屏挤在两列里)", async () => {
    const { view } = await mount();
    fireEvent.click(
      view.container.querySelector("[data-testid=dev-nav-diag]")!,
    );
    await waitFor(() =>
      expect(
        view.container.querySelector("[data-testid=dev-zone-diag]"),
      ).toBeTruthy(),
    );
    expect(
      view.container.querySelector("[data-testid=dev-zone-watch]"),
    ).toBeNull();
  });

  it("AI 调用与诊断在 rail 上带计数徽标", async () => {
    const { view, emitDiagnostic } = await mount({
      aiCalls: [
        {
          kind: "analysis",
          matchId: "m1",
          at: 1,
          model: "x",
          prompt: "p",
          raw: "r",
        },
      ],
    });
    await waitFor(() =>
      expect(
        view.container.querySelector("[data-testid=dev-nav-ai] .dev-badge")!
          .textContent,
      ).toBe("1"),
    );
    act(() => emitDiagnostic({ code: "monotonic", at: 2 }));
    await waitFor(() =>
      expect(
        view.container.querySelector("[data-testid=dev-nav-diag] .dev-badge")!
          .textContent,
      ).toBe("1"),
    );
  });
});

describe("底部状态条:全区共用", () => {
  it("显示监控态与 tail 进度", async () => {
    const { view } = await mount({
      status: {
        watching: true,
        logsDir: "/wow/Logs",
        files: [
          { fileKey: "WoWCombatLog-1.txt", offset: 120, size: 400 } as never,
        ],
      },
    });
    const bar = view.container.querySelector("[data-testid=dev-statusbar]")!;
    expect(bar.textContent).toContain("● 监控中");
    expect(bar.textContent).toContain("WoWCombatLog-1.txt");
    expect(bar.textContent).toContain("120");
  });

  it("有 quarantine 文件时状态条转黄(带告警类名)", async () => {
    const { view } = await mount({
      status: {
        watching: true,
        logsDir: "/wow/Logs",
        files: [
          {
            fileKey: "bad.txt",
            offset: 0,
            size: 10,
            quarantined: true,
          } as never,
        ],
      },
    });
    expect(
      view.container
        .querySelector("[data-testid=dev-statusbar]")!
        .className.includes("warn"),
    ).toBe(true);
    await waitFor(() =>
      expect(view.container.textContent).toContain("🧪 已隔离"),
    );
  });

  it("点状态条跳到监控区", async () => {
    const { view } = await mount();
    fireEvent.click(
      view.container.querySelector("[data-testid=dev-nav-diag]")!,
    );
    await waitFor(() =>
      expect(
        view.container.querySelector("[data-testid=dev-zone-diag]"),
      ).toBeTruthy(),
    );
    fireEvent.click(
      view.container.querySelector("[data-testid=dev-statusbar]")!,
    );
    await waitFor(() =>
      expect(
        view.container.querySelector("[data-testid=dev-zone-watch]"),
      ).toBeTruthy(),
    );
  });
});

describe("重建索引:行内进度替代 alert", () => {
  it("进度事件显示成 x/n,全程不弹 alert", async () => {
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    let resolveRebuild: (v: {
      updated: number;
      failed: number;
    }) => void = () => {};
    const { view, emitRebuildProgress } = await mount({
      rebuild: () =>
        new Promise((res) => {
          resolveRebuild = res;
        }),
    });

    fireEvent.click(view.container.querySelector("[data-testid=dev-rebuild]")!);
    act(() => emitRebuildProgress({ i: 3, n: 142, id: "m3" }));

    await waitFor(() =>
      expect(
        view.container.querySelector("[data-testid=dev-rebuild-progress]")!
          .textContent,
      ).toContain("3/142"),
    );

    await act(async () => {
      resolveRebuild({ updated: 142, failed: 0 });
    });
    await waitFor(() =>
      expect(
        view.container.querySelector("[data-testid=dev-rebuild-progress]")!
          .textContent,
      ).toContain("142"),
    );
    expect(alertSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("重建期间仍可切区浏览(验收③)", async () => {
    const { view } = await mount({ rebuild: () => new Promise(() => {}) });
    fireEvent.click(view.container.querySelector("[data-testid=dev-rebuild]")!);
    fireEvent.click(view.container.querySelector("[data-testid=dev-nav-ai]")!);
    await waitFor(() =>
      expect(
        view.container.querySelector("[data-testid=dev-zone-ai]"),
      ).toBeTruthy(),
    );
  });
});

describe("对局检查器:列表筛选与右栏动作", () => {
  const metas = [
    meta({ id: "a1", bracket: "3v3", zoneId: "1505", result: "Win" }),
    meta({ id: "b2", bracket: "2v2", zoneId: "1552", result: "Loss" }),
    meta({ id: "c3", kind: "shuffle", bracket: "Solo Shuffle", result: "3-3" }),
  ];

  async function inspect(opts: Parameters<typeof installDevFixture>[0] = {}) {
    const h = await mount({ metas, ...opts });
    fireEvent.click(
      h.view.container.querySelector("[data-testid=dev-nav-inspect]")!,
    );
    await waitFor(() =>
      expect(
        h.view.container.querySelector("[data-testid=dev-match-list]"),
      ).toBeTruthy(),
    );
    return h;
  }

  it("筛选框按 kind/bracket/zone/result 模糊过滤并报筛出数", async () => {
    const { view } = await inspect();
    expect(
      view.container.querySelectorAll("[data-testid=dev-match-row]").length,
    ).toBe(3);

    fireEvent.change(
      view.container.querySelector("[data-testid=dev-match-filter]")!,
      { target: { value: "2v2" } },
    );
    await waitFor(() =>
      expect(
        view.container.querySelectorAll("[data-testid=dev-match-row]").length,
      ).toBe(1),
    );
    expect(
      view.container.querySelector("[data-testid=dev-match-count]")!
        .textContent,
    ).toContain("筛出 1");
  });

  it("右栏动作按 id 发 IPC(打开目录 / 重新解析)", async () => {
    const { view, calls } = await inspect({ detail: { kind: "match" } });
    fireEvent.click(
      view.container.querySelector("[data-testid=dev-match-row]")!,
    );
    await waitFor(() =>
      expect(
        view.container.querySelector("[data-testid=dev-node-actions]"),
      ).toBeTruthy(),
    );

    fireEvent.click(
      view.container.querySelector("[data-testid=dev-open-dir]")!,
    );
    await waitFor(() => expect(calls.openDir).toEqual(["a1"]));

    fireEvent.click(view.container.querySelector("[data-testid=dev-reparse]")!);
    await waitFor(() => expect(calls.reparse).toEqual(["a1"]));
  });

  it("导出脱敏 fixture:递给主进程的文本里没有真名", async () => {
    const doc = {
      kind: "match",
      rawLines: ["real log line with Realname-Area52"],
      units: { u1: { kind: "Player", name: "Realname-Area52" } },
    };
    const { view, calls } = await inspect({ detail: doc });
    fireEvent.click(
      view.container.querySelector("[data-testid=dev-match-row]")!,
    );
    await waitFor(() =>
      expect(
        view.container.querySelector("[data-testid=dev-export-fixture]"),
      ).toBeTruthy(),
    );
    fireEvent.click(
      view.container.querySelector("[data-testid=dev-export-fixture]")!,
    );

    await waitFor(() => expect(calls.saveText).toHaveLength(1));
    const arg = calls.saveText[0] as { defaultName: string; text: string };
    expect(arg.text).not.toContain("Realname");
    expect(arg.text).toContain("PlayerA-Test");
    expect(arg.defaultName).toContain("a1");
  });

  /**
   * The on-disk doc has the shape `{schemaVersion, kind, data}` (both
   * matchStore's writes and doRebuildIndex's reads follow it), and the
   * fact fields live inside `data` — reading from the outer level yields
   * nothing but a row of dashes, making the right pane's fact card
   * pointless.
   */
  it("右栏事实卡认得 {kind,data} 包装,不是从最外层瞎读", async () => {
    const doc = {
      schemaVersion: 1,
      kind: "match",
      data: { linesTotal: 4321, linesDropped: 7, hasAdvancedLogging: true },
    };
    const { view } = await inspect({ detail: doc });
    fireEvent.click(
      view.container.querySelector("[data-testid=dev-match-row]")!,
    );
    await waitFor(() =>
      expect(
        view.container.querySelector("[data-testid=dev-doc-facts]"),
      ).toBeTruthy(),
    );
    const facts = view.container.querySelector("[data-testid=dev-doc-facts]")!;
    expect(facts.textContent).toContain("4321");
    expect(facts.textContent).toContain("7");
    expect(facts.textContent).toContain("true");
  });

  it("shuffle 的事实取 rounds[0](与 rebuildIndex 同一取法)", async () => {
    const doc = {
      kind: "shuffle",
      data: { rounds: [{ linesTotal: 999, hasAdvancedLogging: false }] },
    };
    const { view } = await inspect({ detail: doc });
    fireEvent.click(
      view.container.querySelector("[data-testid=dev-match-row]")!,
    );
    await waitFor(() =>
      expect(
        view.container.querySelector("[data-testid=dev-doc-facts]")!
          .textContent,
      ).toContain("999"),
    );
  });

  /**
   * The event count is not computed from the doc on the fly — that would
   * mean walking the whole 62MB, exactly the long task the lazy tree
   * exists to eliminate. It is computed into meta at write time; here we
   * only read meta.
   */
  it("事件数读 meta.eventCount,不遍历 doc", async () => {
    const withCount = [meta({ id: "a1", eventCount: 12345 })];
    const { view } = await inspect({
      metas: withCount,
      detail: { kind: "match", data: { units: {} } },
    });
    fireEvent.click(
      view.container.querySelector("[data-testid=dev-match-row]")!,
    );
    await waitFor(() =>
      expect(
        view.container.querySelector("[data-testid=dev-doc-facts]")!
          .textContent,
      ).toContain("12345"),
    );
  });

  it("旧行没算过 → 「—(可重建索引)」,不是 0 —— 别把缺字段说成没事件", async () => {
    const { view } = await inspect({ detail: { kind: "match" } });
    fireEvent.click(
      view.container.querySelector("[data-testid=dev-match-row]")!,
    );
    await waitFor(() =>
      expect(
        view.container.querySelector("[data-testid=dev-doc-facts]"),
      ).toBeTruthy(),
    );
    expect(
      view.container.querySelector("[data-testid=dev-fact-events]")!
        .textContent,
    ).toContain("重建索引");
  });

  /**
   * The "parser version" the spec calls for is absent from the on-disk
   * doc, and the parser package version has long been stuck at 0.0.1,
   * never bumped when the parser changes — displaying it would just be a
   * constant masquerading as provenance. What actually answers "how was
   * this document stored" is the doc's own schemaVersion plus
   * meta.slimmed.
   */
  it("存储形态给 schemaVersion 与 slimmed,不给假的解析器版本", async () => {
    const { view } = await inspect({
      metas: [meta({ id: "a1", slimmed: true })],
      detail: { schemaVersion: 3, kind: "match", data: {} },
    });
    fireEvent.click(
      view.container.querySelector("[data-testid=dev-match-row]")!,
    );
    await waitFor(() =>
      expect(
        view.container.querySelector("[data-testid=dev-doc-facts]")!
          .textContent,
      ).toContain("3"),
    );
    const facts = view.container.querySelector("[data-testid=dev-doc-facts]")!;
    expect(facts.textContent).toContain("slim");
    expect(facts.textContent).not.toContain("解析器版本");
  });

  it("key path 搜索命中后自动展开到该节点", async () => {
    const doc = { rounds: [{ deaths: [{ victim: "PlayerA-Test" }] }] };
    const { view } = await inspect({ detail: doc });
    fireEvent.click(
      view.container.querySelector("[data-testid=dev-match-row]")!,
    );
    await waitFor(() =>
      expect(
        view.container.querySelector("[data-testid=dev-json-search]"),
      ).toBeTruthy(),
    );

    fireEvent.change(
      view.container.querySelector("[data-testid=dev-json-search]")!,
      { target: { value: "rounds[0].deaths" } },
    );
    fireEvent.submit(
      view.container.querySelector("[data-testid=dev-json-search-form]")!,
    );

    await waitFor(() =>
      expect(
        view.container.querySelector("[data-node-path='rounds[0].deaths']"),
      ).toBeTruthy(),
    );
    expect(
      view.container
        .querySelector("[data-node-path='rounds[0].deaths']")!
        .className.includes("hit"),
    ).toBe(true);
  });
});

describe("诊断区:等级筛选", () => {
  async function diag() {
    const h = await mount();
    fireEvent.click(
      h.view.container.querySelector("[data-testid=dev-nav-diag]")!,
    );
    await waitFor(() =>
      expect(
        h.view.container.querySelector("[data-testid=dev-diag-list]"),
      ).toBeTruthy(),
    );
    act(() => {
      h.emitDiagnostic({ code: "monotonic", at: 1, detail: "w1" });
      h.emitDiagnostic({ code: "BUILD_FAILED", at: 2, detail: "e1" });
    });
    return h;
  }

  it("默认显示全部", async () => {
    const { view } = await diag();
    await waitFor(() =>
      expect(
        view.container.querySelectorAll("[data-testid=dev-diag-row]").length,
      ).toBe(2),
    );
  });

  it("按 error 筛只留 error 行", async () => {
    const { view } = await diag();
    await waitFor(() =>
      expect(
        view.container.querySelectorAll("[data-testid=dev-diag-row]").length,
      ).toBe(2),
    );
    fireEvent.click(
      view.container.querySelector("[data-testid=dev-diag-level-error]")!,
    );
    await waitFor(() =>
      expect(
        view.container.querySelectorAll("[data-testid=dev-diag-row]").length,
      ).toBe(1),
    );
    expect(view.container.textContent).toContain("BUILD_FAILED");
    expect(view.container.textContent).not.toContain("monotonic");
  });

  it("code 文本过滤与清空", async () => {
    const { view } = await diag();
    await waitFor(() =>
      expect(
        view.container.querySelectorAll("[data-testid=dev-diag-row]").length,
      ).toBe(2),
    );
    fireEvent.change(
      view.container.querySelector("[data-testid=dev-diag-filter]")!,
      {
        target: { value: "mono" },
      },
    );
    await waitFor(() =>
      expect(
        view.container.querySelectorAll("[data-testid=dev-diag-row]").length,
      ).toBe(1),
    );
    fireEvent.click(
      view.container.querySelector("[data-testid=dev-diag-clear]")!,
    );
    await waitFor(() =>
      expect(
        view.container.querySelectorAll("[data-testid=dev-diag-row]").length,
      ).toBe(0),
    );
  });
});

describe("监控区:AI 后端下拉已挪走", () => {
  it("开发者页不再自带后端选择器(设置页是单源,那边还多一个 deepseek)", async () => {
    const { view } = await mount();
    expect(view.container.querySelector("select")).toBeNull();
  });
});

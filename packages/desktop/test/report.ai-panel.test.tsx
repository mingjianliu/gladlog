// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AIAnalysisPanel } from "../src/renderer/src/report/components/AIAnalysisPanel";
import { loadMatchFixture } from "./fixtures/loadFixture";

type DeltaCb = (d: { matchId: string; text: string }) => void;
type DoneCb = (d: { matchId: string; content: string }) => void;

function installBridge(opts: {
  key?: string | null;
  cached?: { content: string; model: string; createdAt: number } | null;
}) {
  let deltaCb: DeltaCb = () => {};
  let doneCb: DoneCb = () => {};
  const analyze = vi.fn(async () => {});
  window.__gladlogFixture = {
    logs: {
      getStatus: async () => null,
      onStatusChanged: () => () => {},
      onMatchStored: () => () => {},
      onDiagnostic: () => () => {},
    },
    matches: { list: async () => [], get: async () => null },
    settings: {
      get: async () => ({
        wowDirectory: null,
        anthropicApiKey: opts.key === undefined ? "sk-x" : opts.key,
        anthropicModel: null,
      }),
      save: async (p: any) => ({
        wowDirectory: null,
        anthropicApiKey: null,
        anthropicModel: null,
        ...p,
      }),
    },
    app: {
      getVersion: async () => "t",
      selectDirectory: async () => null,
      openExternal: async () => {},
    },
    ai: {
      analyze,
      cancel: async () => {},
      getCached: async () => opts.cached ?? null,
      onDelta: (cb: DeltaCb) => {
        deltaCb = cb;
        return () => {};
      },
      onDone: (cb: DoneCb) => {
        doneCb = cb;
        return () => {};
      },
      onError: () => () => {},
    },
  } as unknown as Window["gladlog"];
  return {
    analyze,
    fireDelta: (d: Parameters<DeltaCb>[0]) => deltaCb(d),
    fireDone: (d: Parameters<DoneCb>[0]) => doneCb(d),
  };
}

const m = loadMatchFixture();

describe("AIAnalysisPanel", () => {
  it("无 key → 引导文案,分析按钮禁用", async () => {
    installBridge({ key: null });
    render(<AIAnalysisPanel source={m} matchId="x1" />);
    await waitFor(() => expect(screen.getByText(/API key/i)).toBeTruthy());
    expect(
      (screen.getByRole("button", { name: /分析/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("点击分析 → 调用 bridge 并渐进渲染 delta", async () => {
    const b = installBridge({});
    render(<AIAnalysisPanel source={m} matchId="x2" />);
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: /分析/ }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: /分析/ }));
    await waitFor(() => expect(b.analyze).toHaveBeenCalledTimes(1));
    b.fireDelta({ matchId: "x2", text: "第一段。" });
    b.fireDelta({ matchId: "x2", text: "第二段。" });
    await waitFor(() =>
      expect(screen.getByText(/第一段。第二段。/)).toBeTruthy(),
    );
    b.fireDone({ matchId: "x2", content: "第一段。第二段。" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /重新分析/ })).toBeTruthy(),
    );
  });

  it("缓存命中 → 直接显示缓存内容与重新分析按钮", async () => {
    installBridge({
      cached: { content: "旧分析内容", model: "m", createdAt: 1 },
    });
    render(<AIAnalysisPanel source={m} matchId="x3" />);
    await waitFor(() => expect(screen.getByText("旧分析内容")).toBeTruthy());
    expect(screen.getByRole("button", { name: /重新分析/ })).toBeTruthy();
  });
});

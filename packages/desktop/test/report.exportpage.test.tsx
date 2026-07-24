// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";

import {
  ExportReportPage,
  parseExportHash,
} from "../src/renderer/src/report/ExportReportPage";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const m = loadRealMatchFixture();

describe("C3 导出页(离屏渲染 + 就绪信号)", () => {
  it("parseExportHash:完整参数 / 无参数 / 非导出 hash", () => {
    expect(
      parseExportHash("#export-report=abc%2F1&round=2&from=10&to=40"),
    ).toEqual({ matchId: "abc/1", roundSeq: 2, range: { fromS: 10, toS: 40 } });
    expect(parseExportHash("#export-report=abc")).toEqual({
      matchId: "abc",
      roundSeq: null,
      range: null,
    });
    expect(parseExportHash("#other")).toBeNull();
    expect(parseExportHash("")).toBeNull();
  });

  it("加载 doc → 渲染战报 → 置 __gladlogExportReady", async () => {
    (window as never as { __gladlogFixture: unknown }).__gladlogFixture = {
      matches: {
        get: async () => ({ schemaVersion: 1, kind: "match", data: m }),
      },
      icon: { get: async () => null },
    };
    (
      window as unknown as { __gladlogExportReady?: boolean }
    ).__gladlogExportReady = undefined;

    render(
      <ExportReportPage matchId="fixture-match" roundSeq={null} range={null} />,
    );
    // 战报核心元素在(时间窗工具条的导出按钮)
    expect(await screen.findByText("导出图片")).toBeTruthy();
    await waitFor(
      () =>
        expect(
          (window as unknown as { __gladlogExportReady?: boolean })
            .__gladlogExportReady,
        ).toBe(true),
      { timeout: 3000 },
    );
    delete (window as never as { __gladlogFixture?: unknown }).__gladlogFixture;
  });

  it("对局不存在 → 错误文案,仍置就绪(别让导出窗口挂死等待)", async () => {
    (window as never as { __gladlogFixture: unknown }).__gladlogFixture = {
      matches: { get: async () => null },
    };
    (
      window as unknown as { __gladlogExportReady?: boolean }
    ).__gladlogExportReady = undefined;
    render(<ExportReportPage matchId="nope" roundSeq={null} range={null} />);
    expect(await screen.findByText(/不存在/)).toBeTruthy();
    await waitFor(
      () =>
        expect(
          (window as unknown as { __gladlogExportReady?: boolean })
            .__gladlogExportReady,
        ).toBe(true),
      { timeout: 3000 },
    );
    delete (window as never as { __gladlogFixture?: unknown }).__gladlogFixture;
  });
});

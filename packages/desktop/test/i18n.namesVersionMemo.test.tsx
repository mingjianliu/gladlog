// @vitest-environment jsdom
// codex B1#4 / B2#7: the AI panel's key-moment axis and the recording tab's
// moment feed derive titles that read English spell names in en; those names
// load after first paint, so both memos must re-derive when the provider's
// namesVersion bumps (no remount).
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LangProvider } from "../src/renderer/src/i18n/LangProvider";
import { StructuredAnalysisPanel } from "../src/renderer/src/report/components/StructuredAnalysisPanel";
import { VideoTab } from "../src/renderer/src/report/components/VideoTab";
import { deriveKeyMoments } from "../src/renderer/src/report/derive/keyMoments";
import type { ReportSource } from "../src/renderer/src/report/derive/types";
import { deriveVideoMoments } from "../src/renderer/src/report/derive/videoMoments";

const gate = vi.hoisted(() => {
  const g = {
    loaded: true,
    resolve: () => {},
    promise: Promise.resolve(),
    reset() {
      g.loaded = false;
      g.promise = new Promise<void>((r) => {
        g.resolve = () => {
          g.loaded = true;
          r();
        };
      });
    },
  };
  return g;
});
vi.mock("@gladlog/analysis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@gladlog/analysis")>();
  return {
    ...actual,
    ensureSpellNames: () => (gate.loaded ? Promise.resolve() : gate.promise),
    spellNamesReady: () => gate.loaded,
  };
});
vi.mock("../src/renderer/src/report/derive/keyMoments", async (orig) => ({
  ...(await orig<
    typeof import("../src/renderer/src/report/derive/keyMoments")
  >()),
  deriveKeyMoments: vi.fn(() => []),
}));
vi.mock("../src/renderer/src/report/derive/videoMoments", async (orig) => ({
  ...(await orig<
    typeof import("../src/renderer/src/report/derive/videoMoments")
  >()),
  deriveVideoMoments: vi.fn(() => []),
}));

function installBridge() {
  const surface = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, prop: string) => {
          if (name === "settings" && prop === "get")
            return async () => ({ language: "en" });
          if (prop.startsWith("on")) return () => () => {};
          return async () => null;
        },
      },
    );
  (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture =
    new Proxy({}, { get: (_t, ns: string) => surface(ns) });
}

const source = {
  units: {},
  startInfo: {},
  startTime: 0,
  endTime: 60_000,
} as unknown as ReportSource;

afterEach(() => {
  cleanup();
  gate.loaded = true;
});

describe("namesVersion 让关键时刻 memo 重新派生(codex B1#4 / B2#7)", () => {
  it("AI 卡片的关键时刻轴", async () => {
    gate.reset();
    installBridge();
    const spy = vi.mocked(deriveKeyMoments);
    spy.mockClear();
    render(
      <LangProvider firstRunPicker={false}>
        <StructuredAnalysisPanel source={source} matchId="m1" />
      </LangProvider>,
    );
    await waitFor(() => expect(spy).toHaveBeenCalled());
    // let mount-time effects settle (they may re-derive once on their own)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const before = spy.mock.calls.length;
    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(before));
  });

  it("录像页的时刻列表", async () => {
    gate.reset();
    installBridge();
    const spy = vi.mocked(deriveVideoMoments);
    spy.mockClear();
    render(
      <LangProvider firstRunPicker={false}>
        <VideoTab url="file:///rec.mp4" startedAt={0} source={source} />
      </LangProvider>,
    );
    await waitFor(() => expect(spy).toHaveBeenCalled());
    // let mount-time effects settle (they may re-derive once on their own)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const before = spy.mock.calls.length;
    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(before));
  });
});

/**
 * gladlog:matches:getRawStreams IPC handler (BACKLOG #26 Task 2 review,
 * Important finding: no test in packages/desktop exercised any of this
 * task's new plumbing). Mocks `electron` minimally (ipcMain.handle as a
 * vi.fn() so its `.mock.calls` capture the registered handler — no prior
 * ipc.ts test file existed to mirror, so this establishes the pattern) and
 * calls `registerIpc` with a stub `deps` where only `store.readRawText`
 * matters for this handler.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: vi.fn(() => "/tmp"), getVersion: vi.fn(() => "0.0.0") },
  dialog: {},
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn() },
}));

import { ipcMain } from "electron";

import { registerIpc } from "./ipc";
import type { MatchStore } from "./matchStore";

function minimalDeps(readRawText: (id: string) => Promise<string | null>) {
  return {
    store: { readRawText } as unknown as MatchStore,
    settings: {} as never,
    getStatus: () => null,
    getWindow: () => null,
    onWowDirectoryChanged: () => {},
    compare: {} as never,
    analysis: {} as never,
    learning: {} as never,
    recorder: {} as never,
    updater: {} as never,
    chat: {} as never,
    installObs: vi.fn(),
    getObsInstallState: () => ({ installed: false, platformSupported: false }),
    listAudioDevices: async () => ({ output: [], input: [] }),
    icons: { get: vi.fn() },
    exportImage: vi.fn(),
  };
}

/** Pulls the handler function registered for a given channel — `ipcMain` is
 * shared across the whole mocked module, so each test registers fresh via
 * `registerIpc` and reads the LAST matching call (handle() re-registers the
 * same channel name every time). */
function handlerFor(channel: string): (...args: unknown[]) => unknown {
  const calls = vi.mocked(ipcMain.handle).mock.calls;
  const match = [...calls].reverse().find(([name]) => name === channel);
  if (!match) throw new Error(`no handler registered for ${channel}`);
  return match[1] as (...args: unknown[]) => unknown;
}

// A real SPELL_CAST_FAILED line (field-for-field shape copied from
// packages/analysis/test/rawStreams.test.ts's own fixture — single-source the
// line format rather than re-deriving it).
const GUID = "Player-57-0E0CB0B6";
const rawLine = (ts: string, reason: string) =>
  `7/19/2026 ${ts}-4  SPELL_CAST_FAILED,${GUID},"Minilay-Illidan-US",0x10511,0x80000000,0000000000000000,nil,0x80000000,0x80000000,20473,"神圣震击",0x2,"${reason}"`;
const BASE_MS = Date.UTC(2026, 6, 19, 8, 10, 46, 833);

describe("gladlog:matches:getRawStreams", () => {
  it("store.readRawText 命中 → 返回 parseRawStreams 后的结构化 RawStreams(不是原始文本)", async () => {
    const readRawText = vi
      .fn()
      .mockResolvedValue(rawLine("04:10:47.150", "尚未恢复"));
    registerIpc(minimalDeps(readRawText));
    const handler = handlerFor("gladlog:matches:getRawStreams");
    const result = (await handler({}, "m1", BASE_MS)) as {
      available: boolean;
      castFailed: Array<{ reason: string; unitGuid: string }>;
    };
    expect(readRawText).toHaveBeenCalledWith("m1");
    expect(result.available).toBe(true);
    expect(result.castFailed).toHaveLength(1);
    expect(result.castFailed[0].reason).toBe("尚未恢复");
    expect(result.castFailed[0].unitGuid).toBe(GUID);
  });

  it("store.readRawText → null(missing/unreadable raw.txt)→ available:false,不抛", async () => {
    const readRawText = vi.fn().mockResolvedValue(null);
    registerIpc(minimalDeps(readRawText));
    const handler = handlerFor("gladlog:matches:getRawStreams");
    const result = await handler({}, "nope", BASE_MS);
    expect(result).toEqual({
      available: false,
      manaSamples: [],
      castFailed: [],
    });
  });

  it("baseMs 原样透传给 parseRawStreams(id 与 baseMs 都来自 renderer 调用参数,不是 store 自己推导)", async () => {
    const readRawText = vi
      .fn()
      .mockResolvedValue(rawLine("04:10:47.150", "法力值不足"));
    registerIpc(minimalDeps(readRawText));
    const handler = handlerFor("gladlog:matches:getRawStreams");
    // Same raw line, different baseMs → different tSeconds (proves baseMs is
    // actually used, not silently defaulted to 0).
    const atRealBase = (await handler({}, "m1", BASE_MS)) as {
      castFailed: Array<{ tSeconds: number }>;
    };
    const atZeroBase = (await handler({}, "m1", 0)) as {
      castFailed: Array<{ tSeconds: number }>;
    };
    expect(atRealBase.castFailed[0].tSeconds).not.toBe(
      atZeroBase.castFailed[0].tSeconds,
    );
  });

  it("roundDurationS(3rd arg,BACKLOG #32)原样透传给 parseRawStreams 的轮边界钳制", async () => {
    // Two lines: one inside a 5s round (t=0.317), one clearly beyond it
    // (t=9.067, mirroring a later shuffle round's own data on the same
    // raw.txt). Omitting the 3rd arg must stay unbounded (both survive);
    // passing it must clamp (only the in-round one survives).
    const readRawText = vi
      .fn()
      .mockResolvedValue(
        [
          rawLine("04:10:47.150", "尚未恢复"),
          rawLine("04:10:55.900", "法力值不足"),
        ].join("\n"),
      );
    registerIpc(minimalDeps(readRawText));
    const handler = handlerFor("gladlog:matches:getRawStreams");

    const unbounded = (await handler({}, "m1", BASE_MS)) as {
      castFailed: unknown[];
    };
    expect(unbounded.castFailed).toHaveLength(2);

    const clamped = (await handler({}, "m1", BASE_MS, 5)) as {
      castFailed: Array<{ reason: string }>;
    };
    expect(clamped.castFailed).toHaveLength(1);
    expect(clamped.castFailed[0].reason).toBe("尚未恢复");
  });
});

import { describe, expect, it, vi } from "vitest";

import type { WorkerToMain } from "../shared/protocol";
import type { StoredMatchMeta } from "./matchStore";
import { createWorkerMessageHandler } from "./workerMessageHandler";

const META: StoredMatchMeta = {
  id: "m1",
  kind: "match",
  bracket: "3v3",
  zoneId: "1825",
  startTime: 1000,
  endTime: 2000,
  result: "win",
  storedAt: 3000,
};

function makeDeps(
  overrides: {
    storeResult?: { stored: boolean; meta: StoredMatchMeta | null };
  } = {},
) {
  const emit = vi.fn();
  const setStatus = vi.fn();
  const logWarn = vi.fn();
  const recorder = {
    associate: vi.fn(),
    onSegmentOpen: vi.fn(),
    onSegmentClose: vi.fn(),
  };
  const storeResult = overrides.storeResult ?? { stored: true, meta: META };
  const store = { store: vi.fn(() => storeResult) };
  return { emit, setStatus, logWarn, recorder, store };
}

describe("createWorkerMessageHandler(实时路径 live 标志)", () => {
  it("match 入库成功 → matchStored 事件带 live:true,recorder.associate 被调", () => {
    const deps = makeDeps();
    const handler = createWorkerMessageHandler({
      store: deps.store,
      recorder: deps.recorder,
      emit: deps.emit,
      setStatus: deps.setStatus,
      logWarn: deps.logWarn,
    });
    const msg: WorkerToMain = {
      type: "match",
      fileKey: "a.txt",
      payload: {} as never,
    };
    handler(msg);
    expect(deps.recorder.associate).toHaveBeenCalledWith(META);
    expect(deps.emit).toHaveBeenCalledWith("gladlog:logs:matchStored", {
      ...META,
      live: true,
    });
  });

  it("shuffle 入库成功 → 同样带 live:true", () => {
    const deps = makeDeps();
    const handler = createWorkerMessageHandler({
      store: deps.store,
      recorder: deps.recorder,
      emit: deps.emit,
      setStatus: deps.setStatus,
      logWarn: deps.logWarn,
    });
    handler({ type: "shuffle", fileKey: "a.txt", payload: {} as never });
    expect(deps.emit).toHaveBeenCalledWith("gladlog:logs:matchStored", {
      ...META,
      live: true,
    });
  });

  it("去重命中(stored=false)→ 不 emit、不 associate", () => {
    const deps = makeDeps({ storeResult: { stored: false, meta: META } });
    const handler = createWorkerMessageHandler({
      store: deps.store,
      recorder: deps.recorder,
      emit: deps.emit,
      setStatus: deps.setStatus,
      logWarn: deps.logWarn,
    });
    handler({ type: "match", fileKey: "a.txt", payload: {} as never });
    expect(deps.emit).not.toHaveBeenCalled();
    expect(deps.recorder.associate).not.toHaveBeenCalled();
  });

  it("recorder 为 null(桩场景)不炸", () => {
    const deps = makeDeps();
    const handler = createWorkerMessageHandler({
      store: deps.store,
      recorder: null,
      emit: deps.emit,
      setStatus: deps.setStatus,
      logWarn: deps.logWarn,
    });
    expect(() =>
      handler({ type: "match", fileKey: "a.txt", payload: {} as never }),
    ).not.toThrow();
    expect(deps.emit).toHaveBeenCalledWith("gladlog:logs:matchStored", {
      ...META,
      live: true,
    });
  });

  it("segmentOpen/segmentClose 转发给 recorder", () => {
    const deps = makeDeps();
    const handler = createWorkerMessageHandler({
      store: deps.store,
      recorder: deps.recorder,
      emit: deps.emit,
      setStatus: deps.setStatus,
      logWarn: deps.logWarn,
    });
    handler({
      type: "segmentOpen",
      fileKey: "a.txt",
      bracket: "3v3",
      zoneId: "1825",
      isRated: true,
      startTime: 111,
    });
    expect(deps.recorder.onSegmentOpen).toHaveBeenCalledWith({
      startTime: 111,
      bracket: "3v3",
    });
    handler({
      type: "segmentClose",
      fileKey: "a.txt",
      endTime: 222,
      aborted: false,
    });
    expect(deps.recorder.onSegmentClose).toHaveBeenCalledWith({
      endTime: 222,
      aborted: false,
    });
  });

  it("status → setStatus + 事件转发", () => {
    const deps = makeDeps();
    const handler = createWorkerMessageHandler({
      store: deps.store,
      recorder: deps.recorder,
      emit: deps.emit,
      setStatus: deps.setStatus,
      logWarn: deps.logWarn,
    });
    handler({
      type: "status",
      watching: true,
      logsDir: "/dir",
      files: [],
    });
    const snapshot = { watching: true, logsDir: "/dir", files: [] };
    expect(deps.setStatus).toHaveBeenCalledWith(snapshot);
    expect(deps.emit).toHaveBeenCalledWith(
      "gladlog:logs:statusChanged",
      snapshot,
    );
  });

  it("diagnostic → logWarn + 事件转发", () => {
    const deps = makeDeps();
    const handler = createWorkerMessageHandler({
      store: deps.store,
      recorder: deps.recorder,
      emit: deps.emit,
      setStatus: deps.setStatus,
      logWarn: deps.logWarn,
    });
    handler({
      type: "diagnostic",
      fileKey: "a.txt",
      code: "quarantine",
      detail: "boom",
    });
    expect(deps.logWarn).toHaveBeenCalled();
    expect(deps.emit).toHaveBeenCalledWith(
      "gladlog:logs:diagnostic",
      expect.objectContaining({
        fileKey: "a.txt",
        code: "quarantine",
        detail: "boom",
      }),
    );
  });
});

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
  const ack = vi.fn();
  const recorder = {
    associate: vi.fn(),
    onSegmentOpen: vi.fn(),
    onSegmentClose: vi.fn(),
  };
  const storeResult = overrides.storeResult ?? { stored: true, meta: META };
  const store = {
    store: vi.fn(() => storeResult),
    commitStaged: vi.fn(() => storeResult),
  };
  return { emit, setStatus, logWarn, recorder, store, ack };
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
      ack: deps.ack,
    });
    const msg: WorkerToMain = {
      type: "match",
      fileKey: "a.txt",
      payload: {} as never,
      ackId: "k1",
    };
    handler(msg);
    expect(deps.recorder.associate).toHaveBeenCalledWith(META);
    expect(deps.emit).toHaveBeenCalledWith("gladlog:logs:matchStored", {
      ...META,
      live: true,
    });
  });

  it("matchStaged(GH #149,worker 已写好暂存目录)→ commitStaged,同样带 live:true,不走 store", () => {
    const deps = makeDeps();
    const handler = createWorkerMessageHandler({
      store: deps.store,
      recorder: deps.recorder,
      emit: deps.emit,
      setStatus: deps.setStatus,
      logWarn: deps.logWarn,
      ack: deps.ack,
    });
    const staged = { id: "m1", meta: META, stagingDir: "/x/.stage-m1-1-1" };
    handler({ type: "matchStaged", fileKey: "a.txt", staged, ackId: "k1" });
    expect(deps.store.commitStaged).toHaveBeenCalledWith(staged);
    expect(deps.store.store).not.toHaveBeenCalled();
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
      ack: deps.ack,
    });
    handler({
      type: "shuffle",
      fileKey: "a.txt",
      payload: {} as never,
      ackId: "k1",
    });
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
      ack: deps.ack,
    });
    handler({
      type: "match",
      fileKey: "a.txt",
      payload: {} as never,
      ackId: "k1",
    });
    expect(deps.emit).not.toHaveBeenCalled();
    expect(deps.recorder.associate).not.toHaveBeenCalled();
  });

  it("落盘后回 ack(入库、去重都回);store 抛错不回 ack(GH #211 复审)", () => {
    const deps = makeDeps();
    const handler = createWorkerMessageHandler({
      store: deps.store,
      recorder: deps.recorder,
      emit: deps.emit,
      setStatus: deps.setStatus,
      logWarn: deps.logWarn,
      ack: deps.ack,
    });
    const staged = { id: "m1", meta: META, stagingDir: "/x/.stage-m1-1-1" };
    handler({ type: "matchStaged", fileKey: "a.txt", staged, ackId: "s1" });
    expect(deps.ack).toHaveBeenLastCalledWith("a.txt", "s1");
    deps.store.store.mockReturnValueOnce({ stored: false, meta: META });
    handler({
      type: "match",
      fileKey: "b.txt",
      payload: {} as never,
      ackId: "m2",
    });
    expect(deps.ack).toHaveBeenLastCalledWith("b.txt", "m2");
    deps.store.commitStaged.mockImplementationOnce(() => {
      throw new Error("rename failed");
    });
    expect(() =>
      handler({ type: "matchStaged", fileKey: "a.txt", staged, ackId: "s3" }),
    ).toThrow();
    expect(deps.ack).toHaveBeenCalledTimes(2);
  });

  it("recorder 为 null(桩场景)不炸", () => {
    const deps = makeDeps();
    const handler = createWorkerMessageHandler({
      store: deps.store,
      recorder: null,
      emit: deps.emit,
      setStatus: deps.setStatus,
      logWarn: deps.logWarn,
      ack: deps.ack,
    });
    expect(() =>
      handler({
        type: "match",
        fileKey: "a.txt",
        payload: {} as never,
        ackId: "k1",
      }),
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
      ack: deps.ack,
    });
    handler({
      type: "segmentOpen",
      fileKey: "a.txt",
      bracket: "3v3",
      zoneId: "1825",
      isRated: true,
      startTime: 111,
    });
    // fileKey 一并转发:recorder 用它判断「这个 close 是不是开这扇窗的那个文件的」
    expect(deps.recorder.onSegmentOpen).toHaveBeenCalledWith({
      startTime: 111,
      bracket: "3v3",
      fileKey: "a.txt",
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
      fileKey: "a.txt",
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
      ack: deps.ack,
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
      ack: deps.ack,
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

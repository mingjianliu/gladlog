import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createManagedObsBackend } from "./managedObsBackend";
import type { ManagedObsWs } from "./managedObsClient";

/** POISON marker: task-4 brief rule 1 — StopRecord.outputPath keeps
 * returning the FIRST chunk after any split and must NEVER be read by the
 * backend. Modeled as a throwing getter so any access — not just a wrong
 * value slipping through — fails the test immediately ("读了就炸"). */
function poisonOutputPath(): { readonly outputPath: string } {
  return {
    get outputPath(): string {
      throw new Error(
        "POISON: StopRecord.outputPath 被读取了(规则1:分片后它只返回第一个分片,绝不可信)",
      );
    },
  };
}

/** Minimal writable 24bpp BMP encoder — just enough for captureProbe's
 * decoder to round-trip a fixed luminance. Real OBS writes the file at
 * imageFilePath as a side effect of SaveSourceScreenshot resolving; this
 * fake does the same so captureProbe's disk-read path is exercised for
 * real, not mocked away. */
function writeSolidBmp(
  path: string,
  width: number,
  height: number,
  gray: number,
): void {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowSize * height;
  const fileSize = 54 + pixelBytes;
  const buf = Buffer.alloc(fileSize);
  buf.write("BM", 0);
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(0, 6);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(0, 30);
  buf.writeUInt32LE(pixelBytes, 34);
  for (let y = 0; y < height; y++) {
    const rowStart = 54 + y * rowSize;
    for (let x = 0; x < width; x++) {
      const off = rowStart + x * 3;
      buf[off] = gray; // B
      buf[off + 1] = gray; // G
      buf[off + 2] = gray; // R
    }
    // Remaining bytes in the row (padding to a 4-byte boundary) are already
    // zero from Buffer.alloc — nothing further to write.
  }
  writeFileSync(path, buf);
}

/** Records call/on ordering globally so tests can assert "listeners attached
 * before StartRecord" (task-4 brief rule 1). */
class FakeManagedObsWs implements ManagedObsWs {
  connectCalls: Array<{ url: string; password: string }> = [];
  callLog: Array<{ req: string; data?: Record<string, unknown> }> = [];
  onLog: string[] = [];
  callOrder: string[] = [];
  disconnectCalls = 0;
  listeners = new Map<string, Array<(d: Record<string, unknown>) => void>>();

  /** Test hook: what call() should do for a given request. Defaults below;
   * individual tests override entries to simulate failures/timeouts/side
   * effects (e.g. emitting an event synchronously, matching how close in
   * time obs-websocket's request-response and event delivery really are). */
  handlers: Record<
    string,
    (data?: Record<string, unknown>) => Promise<Record<string, unknown>>
  > = {
    StartRecord: async () => ({}),
    StopRecord: async () =>
      poisonOutputPath() as unknown as Record<string, unknown>,
    SplitRecordFile: async () => ({}),
    CreateInput: async () => ({ inputUuid: "fake-uuid" }),
    CreateRecordChapter: async () => ({}),
    SaveSourceScreenshot: async () => ({}),
    GetInputSettings: async () => ({ inputSettings: {} }),
    SetInputSettings: async () => ({}),
  };

  async connect(url: string, password: string): Promise<void> {
    this.connectCalls.push({ url, password });
  }

  async call(
    req: string,
    data?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    this.callLog.push({ req, data });
    this.callOrder.push(`call:${req}`);
    const h = this.handlers[req];
    if (!h) throw new Error(`FakeManagedObsWs: 未预设的请求 ${req}`);
    return h(data);
  }

  on(event: string, cb: (data: Record<string, unknown>) => void): void {
    this.onLog.push(event);
    this.callOrder.push(`on:${event}`);
    const arr = this.listeners.get(event) ?? [];
    arr.push(cb);
    this.listeners.set(event, arr);
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls++;
  }

  /** Test-only: fire every registered listener for `event`. */
  emit(event: string, data: Record<string, unknown>): void {
    for (const cb of this.listeners.get(event) ?? []) cb(data);
  }
}

let recDir: string;
let fake: FakeManagedObsWs;
let ensureProcess: ReturnType<typeof vi.fn>;
let nowMs: number;
let now: () => number;

beforeEach(() => {
  recDir = mkdtempSync(join(tmpdir(), "gladlog-managed-obs-backend-"));
  fake = new FakeManagedObsWs();
  ensureProcess = vi.fn(async () => ({
    wsUrl: "ws://127.0.0.1:4466",
    wsPassword: "pw",
  }));
  nowMs = 1_000_000;
  now = () => nowMs;
});

afterEach(() => {
  rmSync(recDir, { recursive: true, force: true });
  vi.useRealTimers();
});

function makeBackend() {
  return createManagedObsBackend({
    ensureProcess,
    recDir,
    clientFactory: () => fake,
    now,
  });
}

describe("startContinuous — 监听顺序 + 首分片", () => {
  it("attaches RecordStateChanged/RecordFileChanged listeners BEFORE calling StartRecord", async () => {
    fake.handlers.StartRecord = async () => {
      fake.emit("RecordStateChanged", {
        outputState: "OBS_WEBSOCKET_OUTPUT_STARTED",
        outputPath: "/rec/chunk1.mp4",
      });
      return {};
    };
    const backend = makeBackend();
    await backend.startContinuous();
    const onIdx = fake.callOrder.indexOf("on:RecordStateChanged");
    const callIdx = fake.callOrder.indexOf("call:StartRecord");
    expect(onIdx).toBeGreaterThanOrEqual(0);
    expect(callIdx).toBeGreaterThanOrEqual(0);
    expect(onIdx).toBeLessThan(callIdx);
    const onFileIdx = fake.callOrder.indexOf("on:RecordFileChanged");
    expect(onFileIdx).toBeGreaterThanOrEqual(0);
    expect(onFileIdx).toBeLessThan(callIdx);
  });

  it("takes the first chunk's path from RecordStateChanged STARTED (undocumented outputPath), never from a directory scan when the event is present", async () => {
    fake.handlers.StartRecord = async () => {
      fake.emit("RecordStateChanged", {
        outputState: "OBS_WEBSOCKET_OUTPUT_STARTED",
        outputActive: true,
        outputPath: "/rec/chunk-from-event.mp4",
      });
      return {};
    };
    // Poison the directory scan path: if the backend falls back to scanning
    // despite having a perfectly good event, it would pick this file up and
    // get the WRONG path.
    writeFileSync(join(recDir, "decoy.mp4"), "decoy");

    const backend = makeBackend();
    const opened: Array<{ videoPath: string }> = [];
    backend.onChunkOpened((c) => opened.push(c));
    await backend.startContinuous();

    expect(opened).toHaveLength(1);
    expect(opened[0]!.videoPath).toBe("/rec/chunk-from-event.mp4");
  });

  it("falls back to scanning recDir for the newest mp4 when STARTED never carries outputPath", async () => {
    // StartRecord succeeds but (unlike the happy-path fake above) never
    // emits RecordStateChanged at all — simulating the undocumented
    // behavior simply not showing up.
    writeFileSync(join(recDir, "older.mp4"), "old");
    // Deterministic mtime ordering (no real-time sleep, which would be
    // pointless once fake timers freeze the clock below): backdate the
    // "older" file explicitly instead of racing the filesystem's clock
    // resolution.
    utimesSync(join(recDir, "older.mp4"), new Date(0), new Date(0));
    writeFileSync(join(recDir, "newest.mp4"), "new");

    vi.useFakeTimers();
    const backend = makeBackend();
    const opened: Array<{ videoPath: string }> = [];
    backend.onChunkOpened((c) => opened.push(c));
    const p = backend.startContinuous();
    await vi.runAllTimersAsync();
    await p;

    expect(opened).toHaveLength(1);
    expect(opened[0]!.videoPath).toBe(join(recDir, "newest.mp4"));
  });

  it("is idempotent: calling startContinuous twice only calls StartRecord once", async () => {
    fake.handlers.StartRecord = async () => {
      fake.emit("RecordStateChanged", {
        outputState: "OBS_WEBSOCKET_OUTPUT_STARTED",
        outputPath: "/rec/chunk1.mp4",
      });
      return {};
    };
    const backend = makeBackend();
    await backend.startContinuous();
    await backend.startContinuous();
    const startCalls = fake.callLog.filter((c) => c.req === "StartRecord");
    expect(startCalls).toHaveLength(1);
  });
});

describe("splitChunk — 等事件才 resolve", () => {
  async function openFirstChunk(backend: ReturnType<typeof makeBackend>) {
    fake.handlers.StartRecord = async () => {
      fake.emit("RecordStateChanged", {
        outputState: "OBS_WEBSOCKET_OUTPUT_STARTED",
        outputPath: "/rec/chunk1.mp4",
      });
      return {};
    };
    await backend.startContinuous();
  }

  it("waits for RecordFileChanged before resolving, and the closed chunk's stoppedAt/videoPath are correct", async () => {
    const backend = makeBackend();
    await openFirstChunk(backend);
    nowMs = 1_000_500;

    fake.handlers.SplitRecordFile = async () => {
      // Event arrives asynchronously, after the request resolves —
      // exercising the "wait" path for real rather than a synchronous emit.
      queueMicrotask(() =>
        fake.emit("RecordFileChanged", { newOutputPath: "/rec/chunk2.mp4" }),
      );
      return {};
    };

    const closed = await backend.splitChunk();
    expect(closed).not.toBeNull();
    expect(closed!.videoPath).toBe("/rec/chunk1.mp4");
    expect(closed!.startedAt).toBe(1_000_000);
    expect(closed!.stoppedAt).toBe(1_000_500);
  });

  it("chains correctly across two splits: second split's closed chunk is chunk2, not chunk1", async () => {
    const backend = makeBackend();
    await openFirstChunk(backend);

    fake.handlers.SplitRecordFile = async () => {
      queueMicrotask(() =>
        fake.emit("RecordFileChanged", { newOutputPath: "/rec/chunk2.mp4" }),
      );
      return {};
    };
    nowMs = 1_000_500;
    const closed1 = await backend.splitChunk();
    expect(closed1!.videoPath).toBe("/rec/chunk1.mp4");

    fake.handlers.SplitRecordFile = async () => {
      queueMicrotask(() =>
        fake.emit("RecordFileChanged", { newOutputPath: "/rec/chunk3.mp4" }),
      );
      return {};
    };
    nowMs = 1_001_000;
    const closed2 = await backend.splitChunk();
    expect(closed2!.videoPath).toBe("/rec/chunk2.mp4");
    expect(closed2!.startedAt).toBe(1_000_500);
    expect(closed2!.stoppedAt).toBe(1_001_000);
  });

  it("times out after 5s if RecordFileChanged never arrives, and records lastError", async () => {
    vi.useFakeTimers();
    const backend = makeBackend();
    await openFirstChunk(backend);

    fake.handlers.SplitRecordFile = async () => ({}); // never emits the event

    const splitPromise = backend.splitChunk();
    await vi.advanceTimersByTimeAsync(5_001);
    const closed = await splitPromise;

    expect(closed).toBeNull();
    const health = await backend.probe();
    expect(health.lastError).toMatch(/RecordFileChanged|超时/);
  });

  it("serializes two concurrent splitChunk() calls: distinct chunks in order, not the same chunk twice", async () => {
    // Review Important #2(a): without serialization, two concurrent calls
    // both capture currentChunk=chunk1 as their expectation and the first
    // incoming event used to satisfy BOTH of them with the same closed
    // chunk. Fired without awaiting in between, on purpose.
    const backend = makeBackend();
    await openFirstChunk(backend);

    let splitCount = 0;
    fake.handlers.SplitRecordFile = async () => {
      splitCount++;
      const path = splitCount === 1 ? "/rec/chunk2.mp4" : "/rec/chunk3.mp4";
      queueMicrotask(() =>
        fake.emit("RecordFileChanged", { newOutputPath: path }),
      );
      return {};
    };

    const p1 = backend.splitChunk();
    const p2 = backend.splitChunk(); // concurrent — no await on p1 first

    const closed1 = await p1;
    const closed2 = await p2;

    expect(closed1).not.toBeNull();
    expect(closed2).not.toBeNull();
    expect(closed1!.videoPath).toBe("/rec/chunk1.mp4");
    expect(closed2!.videoPath).toBe("/rec/chunk2.mp4"); // NOT chunk1 again
    expect(closed1!.videoPath).not.toBe(closed2!.videoPath);

    const splitCalls = fake.callLog.filter((c) => c.req === "SplitRecordFile");
    expect(splitCalls).toHaveLength(2); // p2's request only went out after p1 settled
  });

  it("a late event from a timed-out split does not satisfy the NEXT split's wait with the wrong (older) chunk", async () => {
    // Review Important #2(b): A's SplitRecordFile request succeeds but its
    // RecordFileChanged never arrives inside A's 5s window — currentChunk is
    // still chunk1 when A gives up. B is then issued and (since nothing else
    // has moved currentChunk) also expects to close chunk1. When A's real,
    // late answer finally shows up, it must update the ledger but must NOT
    // be handed to B as if it were B's own answer.
    vi.useFakeTimers();
    const backend = makeBackend();
    await openFirstChunk(backend);

    fake.handlers.SplitRecordFile = async () => ({}); // test drives RecordFileChanged manually

    const pA = backend.splitChunk();
    await vi.advanceTimersByTimeAsync(5_001);
    expect(await pA).toBeNull(); // A gave up client-side

    const pB = backend.splitChunk();
    let bSettled = false;
    let bResult: unknown;
    pB.then((v) => {
      bSettled = true;
      bResult = v;
    });
    // Let doSplitOnce's synchronous prefix (capturing expectedClosingPath,
    // registering the waiter, issuing SplitRecordFile) actually run before
    // firing the orphan event.
    await Promise.resolve();
    await Promise.resolve();

    // A's real (late) answer arrives now — closes chunk1, opens chunk2.
    fake.emit("RecordFileChanged", { newOutputPath: "/rec/chunk2.mp4" });
    await Promise.resolve();
    await Promise.resolve();

    expect(bSettled).toBe(false); // must NOT have resolved to chunk1's data

    await vi.advanceTimersByTimeAsync(5_001);
    expect(bSettled).toBe(true);
    expect(bResult).toBeNull(); // safely times out rather than getting the wrong chunk

    const health = await backend.probe();
    expect(health.lastError).toMatch(/RecordFileChanged|超时/);
  });
});

describe("stopContinuous — 绝不读 StopRecord.outputPath", () => {
  it("returns the tracked current chunk (poisoned outputPath never accessed)", async () => {
    const backend = makeBackend();
    fake.handlers.StartRecord = async () => {
      fake.emit("RecordStateChanged", {
        outputState: "OBS_WEBSOCKET_OUTPUT_STARTED",
        outputPath: "/rec/chunk1.mp4",
      });
      return {};
    };
    await backend.startContinuous();
    nowMs = 1_002_000;

    const closed = await backend.stopContinuous();
    expect(closed).not.toBeNull();
    expect(closed!.videoPath).toBe("/rec/chunk1.mp4");
    expect(closed!.stoppedAt).toBe(1_002_000);
    // If the implementation had touched `.outputPath` on StopRecord's
    // response, the poisoned getter above would have thrown synchronously
    // inside the call and this test would already have failed loudly.
  });

  it("ignores a RecordFileChanged that arrives WHILE StopRecord is in flight — returns the pre-stop chunk, drops the phantom", async () => {
    // Review Important #1: a chunk event that lands mid-stop (e.g. a split
    // whose event was late past its own 5s timeout, then WoW exits right
    // after) must not silently become "the" chunk stopContinuous() reports.
    const backend = makeBackend();
    fake.handlers.StartRecord = async () => {
      fake.emit("RecordStateChanged", {
        outputState: "OBS_WEBSOCKET_OUTPUT_STARTED",
        outputPath: "/rec/chunk1.mp4",
      });
      return {};
    };
    await backend.startContinuous();
    nowMs = 1_002_000;

    const opened: string[] = [];
    backend.onChunkOpened((c) => opened.push(c.videoPath));

    fake.handlers.StopRecord = async () => {
      // Simulate the race: this event arrives synchronously as part of
      // processing StopRecord, i.e. strictly during the backend's await.
      fake.emit("RecordFileChanged", { newOutputPath: "/rec/phantom.mp4" });
      return poisonOutputPath() as unknown as Record<string, unknown>;
    };

    const closed = await backend.stopContinuous();
    expect(closed).not.toBeNull();
    expect(closed!.videoPath).toBe("/rec/chunk1.mp4");
    expect(closed!.stoppedAt).toBe(1_002_000);
    // The phantom open must never have reached onChunkOpened subscribers —
    // stopInFlight makes the handler a no-op, not just "return the right
    // value from stopContinuous while still notifying about the phantom".
    expect(opened).toEqual([]);
  });
});

describe("markChapter — 失败静默", () => {
  it("does not throw and does not surface an error when CreateRecordChapter rejects", async () => {
    const backend = makeBackend();
    fake.handlers.StartRecord = async () => {
      fake.emit("RecordStateChanged", {
        outputState: "OBS_WEBSOCKET_OUTPUT_STARTED",
        outputPath: "/rec/chunk1.mp4",
      });
      return {};
    };
    await backend.startContinuous();
    const before = (await backend.probe()).lastError;

    fake.handlers.CreateRecordChapter = async () => {
      throw new Error("hybrid_mp4 only, this container doesn't support it");
    };
    await expect(backend.markChapter("first blood")).resolves.toBeUndefined();

    const after = (await backend.probe()).lastError;
    expect(after).toBe(before);
  });

  it("calls CreateRecordChapter with the chapter name on success", async () => {
    const backend = makeBackend();
    fake.handlers.StartRecord = async () => {
      fake.emit("RecordStateChanged", {
        outputState: "OBS_WEBSOCKET_OUTPUT_STARTED",
        outputPath: "/rec/chunk1.mp4",
      });
      return {};
    };
    await backend.startContinuous();
    await backend.markChapter("first blood");
    const call = fake.callLog.find((c) => c.req === "CreateRecordChapter");
    expect(call?.data).toEqual({ chapterName: "first blood" });
  });
});

describe("onChunkOpened — 退订生效", () => {
  it("stops receiving callbacks after unsubscribing", async () => {
    const backend = makeBackend();
    const opened: string[] = [];
    const unsubscribe = backend.onChunkOpened((c) => opened.push(c.videoPath));

    fake.handlers.StartRecord = async () => {
      fake.emit("RecordStateChanged", {
        outputState: "OBS_WEBSOCKET_OUTPUT_STARTED",
        outputPath: "/rec/chunk1.mp4",
      });
      return {};
    };
    await backend.startContinuous();
    expect(opened).toEqual(["/rec/chunk1.mp4"]);

    unsubscribe();

    fake.handlers.SplitRecordFile = async () => {
      queueMicrotask(() =>
        fake.emit("RecordFileChanged", { newOutputPath: "/rec/chunk2.mp4" }),
      );
      return {};
    };
    await backend.splitChunk();
    expect(opened).toEqual(["/rec/chunk1.mp4"]); // unchanged — no chunk2 entry
  });
});

describe("configureSession + captureProbe — 黑帧判定进 sourceActive", () => {
  it("configureSession creates the game_capture input with the pinned settings", async () => {
    const backend = makeBackend();
    fake.handlers.SaveSourceScreenshot = async (data) => {
      writeSolidBmp(data!.imageFilePath as string, 4, 4, 0); // black
      return {};
    };
    await backend.configureSession();

    const create = fake.callLog.find((c) => c.req === "CreateInput");
    expect(create?.data).toMatchObject({
      inputKind: "game_capture",
      inputSettings: {
        capture_mode: "any_fullscreen",
        priority: 2,
        anti_cheat_hook: true,
      },
    });
    const health = await backend.probe();
    expect(health.encoder).toBe("obs_x264");
  });

  it("captureProbe calls SaveSourceScreenshot and a black screenshot flips sourceActive to false", async () => {
    const backend = makeBackend();
    fake.handlers.SaveSourceScreenshot = async (data) => {
      writeSolidBmp(data!.imageFilePath as string, 4, 4, 0); // all-black
      return {};
    };
    await backend.configureSession();

    const shotCall = fake.callLog.find((c) => c.req === "SaveSourceScreenshot");
    expect(shotCall).toBeDefined();

    const { black } = await backend.captureProbe();
    expect(black).toBe(true);
    const health = await backend.probe();
    expect(health.sourceActive).toBe(false);
  });

  it("captureProbe with a normal (bright) screenshot flips sourceActive to true", async () => {
    const backend = makeBackend();
    fake.handlers.SaveSourceScreenshot = async (data) => {
      writeSolidBmp(data!.imageFilePath as string, 4, 4, 180); // bright
      return {};
    };
    await backend.configureSession();

    const { black } = await backend.captureProbe();
    expect(black).toBe(false);
    const health = await backend.probe();
    expect(health.sourceActive).toBe(true);
  });

  it("re-entrancy: treats CreateInput's 'already exists' failure as success via GetInputSettings", async () => {
    // Review Important #3: reconnecting to a still-running managed OBS
    // instance hits this on every configureSession() after the first —
    // the game_capture input from the earlier connect() is still there.
    const backend = makeBackend();
    fake.handlers.CreateInput = async () => {
      throw new Error("already exists");
    };
    fake.handlers.GetInputSettings = async () => ({
      inputSettings: { capture_mode: "any_fullscreen" },
    });
    fake.handlers.SaveSourceScreenshot = async (data) => {
      writeSolidBmp(data!.imageFilePath as string, 4, 4, 180); // bright
      return {};
    };

    await backend.configureSession();

    const health = await backend.probe();
    expect(health.ready).toBe(true);
    expect(health.encoder).toBe("obs_x264");
    // The CreateInput failure was recovered — it must not linger as the
    // reported error once GetInputSettings confirms the input is fine.
    expect(health.lastError).toBeNull();

    const getCall = fake.callLog.find((c) => c.req === "GetInputSettings");
    expect(getCall?.data).toEqual({ inputName: "gladlog-capture" });
    // The probe screenshot still happens — configuration succeeded, capture
    // is fine, sourceActive should reflect the (bright) screenshot.
    const shotCall = fake.callLog.find((c) => c.req === "SaveSourceScreenshot");
    expect(shotCall).toBeDefined();
    expect(health.sourceActive).toBe(true);
  });

  it("re-entrancy: a genuine CreateInput failure (input truly doesn't exist and GetInputSettings also fails) stays unconfigured", async () => {
    const backend = makeBackend();
    fake.handlers.CreateInput = async () => {
      throw new Error("some real websocket error");
    };
    fake.handlers.GetInputSettings = async () => {
      throw new Error("no source was found by the name of gladlog-capture");
    };

    await backend.configureSession();

    const health = await backend.probe();
    expect(health.ready).toBe(false);
    expect(health.encoder).toBeNull();
    expect(health.lastError).toMatch(/GetInputSettings/);
  });
});

describe("listAudioDevices (managed-OBS prefs, 2026-09-04)", () => {
  it("每种 kind:建禁用的探针输入 → 查 device_id 列表 → 删探针;禁用项与空 id 过滤", async () => {
    fake.handlers.GetInputPropertiesListPropertyItems = async (data) => {
      const name = String(data?.["inputName"]);
      return name.endsWith("wasapi_output_capture")
        ? {
            propertyItems: [
              { itemName: "默认", itemValue: "default", itemEnabled: true },
              { itemName: "Speakers", itemValue: "{out}", itemEnabled: true },
              { itemName: "Gone", itemValue: "{gone}", itemEnabled: false },
            ],
          }
        : {
            propertyItems: [
              { itemName: "Mic", itemValue: "{mic}", itemEnabled: true },
              { itemName: "Empty", itemValue: "", itemEnabled: true },
            ],
          };
    };
    fake.handlers.RemoveInput = async () => ({});
    const b = makeBackend();
    const r = await b.listAudioDevices();
    expect(r).toEqual({
      output: [
        { id: "default", name: "默认" },
        { id: "{out}", name: "Speakers" },
      ],
      input: [{ id: "{mic}", name: "Mic" }],
    });
    const probeCreates = fake.callLog.filter(
      (c) =>
        c.req === "CreateInput" &&
        String(c.data?.["inputName"]).startsWith("gladlog-audio-probe-"),
    );
    expect(probeCreates).toHaveLength(2);
    for (const c of probeCreates) {
      expect(c.data).toMatchObject({
        sceneName: "gladlog",
        sceneItemEnabled: false,
      });
    }
    const removes = fake.callLog.filter((c) => c.req === "RemoveInput");
    expect(removes.map((c) => c.data?.["inputName"])).toEqual(
      probeCreates.map((c) => c.data?.["inputName"]),
    );
  });

  it("枚举失败 → 空列表,探针仍被删除,且不污染 probe().lastError", async () => {
    fake.handlers.GetInputPropertiesListPropertyItems = async () => {
      throw new Error("boom");
    };
    fake.handlers.RemoveInput = async () => ({});
    const b = makeBackend();
    await b.configureSession();
    const before = (await b.probe()).lastError;
    const r = await b.listAudioDevices();
    expect(r).toEqual({ output: [], input: [] });
    expect(fake.callLog.filter((c) => c.req === "RemoveInput")).toHaveLength(2);
    expect((await b.probe()).lastError).toBe(before);
  });

  it("(agy #4) 枚举期间落下的真实失败不会被枚举收尾抹掉", async () => {
    const b = makeBackend();
    await b.configureSession();
    fake.handlers.GetInputPropertiesListPropertyItems = async () => {
      // A concurrent, lastError-bearing call fails while enumeration is in
      // flight (captureProbe goes through callWithTimeout; markChapter is
      // deliberately silent and would not exercise this).
      fake.handlers.SaveSourceScreenshot = async () => {
        throw new Error("shot boom");
      };
      await b.captureProbe();
      return { propertyItems: [] };
    };
    fake.handlers.RemoveInput = async () => ({});
    await b.listAudioDevices();
    expect((await b.probe()).lastError).toMatch(/shot boom/);
  });

  it("(agy #1) 录制进行中 → 不建探针、不发任何 websocket 请求,直接空列表", async () => {
    fake.handlers.StartRecord = async () => {
      fake.emit("RecordStateChanged", {
        outputState: "OBS_WEBSOCKET_OUTPUT_STARTED",
        outputPath: "/rec/chunk1.mp4",
      });
      return {};
    };
    const b = makeBackend();
    await b.startContinuous();
    const callsBefore = fake.callLog.length;
    expect(await b.listAudioDevices()).toEqual({ output: [], input: [] });
    expect(fake.callLog.length).toBe(callsBefore);
  });
});

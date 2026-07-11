import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { MainToWorker, WorkerToMain } from "../src/shared/protocol";
import {
  createWorkerRuntime,
  type WorkerTransport,
} from "../src/worker/runtime";

function harness() {
  const out: WorkerToMain[] = [];
  let deliver: ((m: MainToWorker) => void) | null = null;
  let fsWatchCb: ((ev: string, f: string) => void) | null = null;
  const transport: WorkerTransport = {
    post: (m) => out.push(m),
    onMessage: (cb) => {
      deliver = cb;
    },
  };
  const watchFn = ((_dir: string, cb: (ev: string, f: string) => void) => {
    fsWatchCb = cb;
    return { close() {} };
  }) as unknown as typeof import("fs").watch;
  return {
    out,
    transport,
    watchFn,
    send: (m: MainToWorker) => deliver!(m),
    fileEvent: (f: string) => fsWatchCb!("change", f),
  };
}

const CAST =
  'SPELL_CAST_SUCCESS,Player-1-A,"Alice-X",0x512,0x80000000,0000000000000000,nil,0x80000000,0x80000000,2983,"Sprint",0x1,Player-1-A,0000000000000000,100,100,0,0,0,0,0,0,3,10,10,0,1.00,-1.00,0,1.0,70';
const MATCH =
  [
    "6/30/2026 12:00:00.000  ARENA_MATCH_START,1825,41,3v3,1",
    `6/30/2026 12:00:01.000  ${CAST}`,
    "6/30/2026 12:00:02.000  ARENA_MATCH_END,1,30,1500,1501",
  ].join("\n") + "\n";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "gl-rt-"));
  const logsDir = join(root, "Logs");
  mkdirSync(logsDir);
  const config = {
    logsDir,
    checkpointsPath: join(root, "cp.json"),
    quarantined: [],
    flushIntervalMs: 50,
    quietPeriodMs: 100,
  };
  return { root, logsDir, config };
}

describe("createWorkerRuntime", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("configure → initial scan 已有文件并发出 match + status", () => {
    const { logsDir, config } = setup();
    writeFileSync(join(logsDir, "WoWCombatLog-1.txt"), MATCH);
    const h = harness();
    const rt = createWorkerRuntime({
      transport: h.transport,
      watchFn: h.watchFn,
    });
    h.send({ type: "configure", config });
    expect(h.out.some((m) => m.type === "match")).toBe(true);
    const status = h.out.filter((m) => m.type === "status").at(-1)!;
    expect(status.type === "status" && status.watching).toBe(true);
    rt.dispose();
  });

  it("watcher 事件驱动增量解析新对局", async () => {
    const { logsDir, config } = setup();
    const f = join(logsDir, "WoWCombatLog-1.txt");
    writeFileSync(f, "");
    const h = harness();
    const rt = createWorkerRuntime({
      transport: h.transport,
      watchFn: h.watchFn,
    });
    h.send({ type: "configure", config });
    appendFileSync(f, MATCH);
    h.fileEvent("WoWCombatLog-1.txt");
    await vi.advanceTimersByTimeAsync(50);
    expect(h.out.some((m) => m.type === "match")).toBe(true);
    rt.dispose();
  });

  it("quarantined 文件被跳过", () => {
    const { logsDir, config } = setup();
    writeFileSync(join(logsDir, "WoWCombatLog-1.txt"), MATCH);
    const h = harness();
    const rt = createWorkerRuntime({
      transport: h.transport,
      watchFn: h.watchFn,
    });
    h.send({
      type: "configure",
      config: { ...config, quarantined: ["WoWCombatLog-1.txt"] },
    });
    expect(h.out.some((m) => m.type === "match")).toBe(false);
    const status = h.out.filter((m) => m.type === "status").at(-1)!;
    expect(
      status.type === "status" && status.files.some((x) => x.quarantined),
    ).toBe(true);
    rt.dispose();
  });

  it("checkpoint 持久化:重建 runtime 后不重复发已解析对局", () => {
    const { logsDir, config } = setup();
    writeFileSync(join(logsDir, "WoWCombatLog-1.txt"), MATCH);
    const h1 = harness();
    const rt1 = createWorkerRuntime({
      transport: h1.transport,
      watchFn: h1.watchFn,
    });
    h1.send({ type: "configure", config });
    rt1.dispose();
    const h2 = harness();
    const rt2 = createWorkerRuntime({
      transport: h2.transport,
      watchFn: h2.watchFn,
    });
    h2.send({ type: "configure", config });
    expect(h2.out.some((m) => m.type === "match")).toBe(false); // 从安全边界续读,无新行
    rt2.dispose();
  });

  it("logsDir 不存在 → diagnostic + watching:false,不抛", () => {
    const { config } = setup();
    const h = harness();
    const rt = createWorkerRuntime({
      transport: h.transport,
      watchFn: h.watchFn,
    });
    h.send({
      type: "configure",
      config: { ...config, logsDir: "/nonexistent-gl" },
    });
    expect(
      h.out.some(
        (m) => m.type === "diagnostic" && m.code === "LOGS_DIR_UNREADABLE",
      ),
    ).toBe(true);
    const status = h.out.filter((m) => m.type === "status").at(-1)!;
    expect(status.type === "status" && status.watching).toBe(false);
    rt.dispose();
  });

  it("parser.push 抛出异常时会调用 injectable fatal handler 且不退出进程", () => {
    const { logsDir, config } = setup();
    writeFileSync(join(logsDir, "WoWCombatLog-1.txt"), "some combat log line\n");
    const h = harness();
    let fatalCalledWith: string | null = null;
    const fatalSpy = (msg: string) => {
      fatalCalledWith = msg;
    };
    const rt = createWorkerRuntime({
      transport: h.transport,
      watchFn: h.watchFn,
      fatal: fatalSpy,
      parserFactory: () => {
        return {
          push() {
            throw new Error("mock parse error");
          },
          end() {},
          hasOpenSegment() {
            return false;
          },
          on() {
            return this;
          },
        };
      },
    });
    h.send({ type: "configure", config });
    expect(fatalCalledWith).not.toBeNull();
    expect(fatalCalledWith).toContain("[gladlog-worker] fatal parse error at WoWCombatLog-1.txt");
    expect(fatalCalledWith).toContain("mock parse error");
    rt.dispose();
  });
});

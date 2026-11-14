import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "fs";
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

  it("启动顺序按 mtime 而不是文件名(跨年:123126 先于 010127)", () => {
    const { logsDir, config } = setup();
    const older = "WoWCombatLog-123126_230000.txt";
    const newer = "WoWCombatLog-010127_010000.txt";
    writeFileSync(join(logsDir, older), MATCH);
    writeFileSync(join(logsDir, newer), MATCH);
    const now = Date.now() / 1000;
    utimesSync(join(logsDir, older), now - 7200, now - 7200);
    utimesSync(join(logsDir, newer), now - 3600, now - 3600);
    const h = harness();
    const rt = createWorkerRuntime({
      transport: h.transport,
      watchFn: h.watchFn,
    });
    h.send({ type: "configure", config });
    expect(
      h.out.filter((m) => m.type === "match").map((m) => m.fileKey),
    ).toEqual([older, newer]);
    rt.dispose();
  });

  it("parser.push 抛出异常时会调用 injectable fatal handler 且不退出进程", () => {
    const { logsDir, config } = setup();
    writeFileSync(
      join(logsDir, "WoWCombatLog-1.txt"),
      "some combat log line\n",
    );
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
    expect(fatalCalledWith).toContain(
      "[gladlog-worker] fatal parse error at WoWCombatLog-1.txt",
    );
    expect(fatalCalledWith).toContain("mock parse error");
    rt.dispose();
  });
});

// GH #211 (A2): at startup, a log that still ends inside an open segment after
// its catch-up is retired when it is both quiet for the valve's threshold and
// not the most recently modified log.
describe("启动时退役 WoW 不会再写的卡住文件(GH #211)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const at = (s: number, body: string) =>
    `6/30/2026 13:${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}.000  ${body}\n`;
  const OPEN = at(0, "ARENA_MATCH_START,1825,41,3v3,1") + at(1, CAST);
  const SHUFFLE_START = "ARENA_MATCH_START,1504,40,Rated Solo Shuffle,0";
  const OPEN_SHUFFLE =
    at(0, SHUFFLE_START) +
    at(1, CAST) +
    at(60, SHUFFLE_START) +
    at(61, CAST) +
    at(120, SHUFFLE_START) +
    at(121, CAST);

  function write(logsDir: string, name: string, body: string, ageS: number) {
    const p = join(logsDir, name);
    writeFileSync(p, body);
    const t = Date.now() / 1000 - ageS;
    utimesSync(p, t, t);
  }
  function launch(
    config: ReturnType<typeof setup>["config"],
    quietMs?: number,
  ) {
    const h = harness();
    const rt = createWorkerRuntime({
      transport: h.transport,
      watchFn: h.watchFn,
      ...(quietMs !== undefined ? { segmentQuietCloseMs: quietMs } : {}),
    });
    h.send({ type: "configure", config });
    const cps = (
      JSON.parse(readFileSync(config.checkpointsPath, "utf-8")) as {
        files: Record<string, { offset: number }>;
      }
    ).files;
    return { h, rt, cps };
  }
  const size = (logsDir: string, name: string) =>
    statSync(join(logsDir, name)).size;

  it("N 个卡住的旧文件:启动一次后 offset 0 的条目 N → 0,下次启动不再重读;最新文件不动", () => {
    const { logsDir, config } = setup();
    const stuck = [
      "WoWCombatLog-061026_200000.txt",
      "WoWCombatLog-061126_200000.txt",
      "WoWCombatLog-061226_200000.txt",
    ];
    write(logsDir, stuck[0]!, MATCH + OPEN, 3 * 3600);
    write(logsDir, stuck[1]!, OPEN, 2 * 3600);
    write(logsDir, stuck[2]!, MATCH + OPEN_SHUFFLE, 3600);
    const live = "WoWCombatLog-061326_200000.txt";
    write(logsDir, live, MATCH + OPEN, 0);

    const first = launch(config);
    for (const n of stuck) expect(first.cps[n]!.offset).toBe(size(logsDir, n));
    expect(stuck.filter((n) => first.cps[n]!.offset === 0)).toHaveLength(0);
    // The newest file may be mid-match right now: it keeps its segment and
    // resumes from the open START.
    expect(first.cps[live]!.offset).toBe(Buffer.byteLength(MATCH));

    // Messages of the retired files: the finished matches before the open
    // segment, the shuffle's two finished rounds (Unknown result), no match
    // for an unclosed ordinary match, and an aborted close pairing each open.
    const of = (t: WorkerToMain["type"], key: string) =>
      first.h.out.filter(
        (m) => m.type === t && "fileKey" in m && m.fileKey === key,
      );
    expect(of("match", stuck[0]!)).toHaveLength(1);
    expect(of("match", stuck[1]!)).toHaveLength(0);
    const sh = of("shuffle", stuck[2]!);
    expect(sh).toHaveLength(1);
    expect(
      (sh[0] as { payload: { rounds: unknown[] } }).payload.rounds,
    ).toHaveLength(2);
    for (const n of stuck) {
      const opens = of("segmentOpen", n).length;
      const closes = of("segmentClose", n);
      expect(closes.at(-1)).toMatchObject({ endTime: null, aborted: true });
      expect(closes).toHaveLength(opens);
    }
    // No aborted close for the live file: its segment stays open.
    expect(
      of("segmentClose", live).filter(
        (m) => m.type === "segmentClose" && m.aborted,
      ),
    ).toHaveLength(0);
    first.rt.dispose();

    const second = launch(config);
    for (const n of stuck) {
      expect(
        second.h.out.filter(
          (m) =>
            (m.type === "match" ||
              m.type === "shuffle" ||
              m.type === "segmentOpen") &&
            m.fileKey === n,
        ),
      ).toHaveLength(0);
    }
    second.rt.dispose();
  });

  it("两个条件缺一不可:最新文件再旧也不退役;非最新但刚写过也不退役", () => {
    const a = setup();
    write(a.logsDir, "WoWCombatLog-A.txt", OPEN, 7200);
    write(a.logsDir, "WoWCombatLog-B.txt", OPEN, 3600); // newest, but an hour quiet
    const r1 = launch(a.config, 60_000);
    expect(r1.cps["WoWCombatLog-A.txt"]!.offset).toBe(
      size(a.logsDir, "WoWCombatLog-A.txt"),
    );
    expect(r1.cps["WoWCombatLog-B.txt"]!.offset).toBe(0);
    r1.rt.dispose();

    const b = setup();
    write(b.logsDir, "WoWCombatLog-C.txt", OPEN, 10); // not newest, 10 s quiet
    write(b.logsDir, "WoWCombatLog-D.txt", MATCH, 5);
    const r2 = launch(b.config, 60_000);
    expect(r2.cps["WoWCombatLog-C.txt"]!.offset).toBe(0);
    expect(
      r2.h.out.filter(
        (m) => m.type === "segmentClose" && m.fileKey === "WoWCombatLog-C.txt",
      ),
    ).toHaveLength(0);
    r2.rt.dispose();
  });
});

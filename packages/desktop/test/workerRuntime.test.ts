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

import { MatchStore } from "../src/main/matchStore";
import { createWorkerMessageHandler } from "../src/main/workerMessageHandler";
import type { MainToWorker, WorkerToMain } from "../src/shared/protocol";
import {
  createWorkerRuntime,
  type WorkerTransport,
} from "../src/worker/runtime";

/** `main` stands in for main's side of the store messages. By default every
 * match/shuffle/matchStaged is acknowledged at once, as main does after its
 * store; `null` drops them unacknowledged (main died before handling them). */
function harness(
  main: ((m: WorkerToMain, ack: () => void) => void) | null = (_m, ack) =>
    ack(),
) {
  const out: WorkerToMain[] = [];
  let deliver: ((m: MainToWorker) => void) | null = null;
  let fsWatchCb: ((ev: string, f: string) => void) | null = null;
  const transport: WorkerTransport = {
    post: (m) => {
      out.push(m);
      if (
        main &&
        (m.type === "match" || m.type === "shuffle" || m.type === "matchStaged")
      )
        main(m, () =>
          deliver!({ type: "stored", fileKey: m.fileKey, ackId: m.ackId }),
        );
    },
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

// codex review of GH #211: the persisted checkpoint must never pass a match
// main has not durably stored. Main is the real MatchStore + message handler;
// "main died" means the worker's store messages are never handled, and the
// next start's MatchStore.init() deletes the orphaned staging directories.
describe("worker 发出后、main 落盘前崩溃:对局不丢且只存一次(GH #211 复审)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const at = (s: number, body: string) =>
    `6/30/2026 14:${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}.000  ${body}\n`;
  const OPEN = at(0, "ARENA_MATCH_START,1825,41,3v3,1") + at(1, CAST);
  const SHUFFLE_START = "ARENA_MATCH_START,1504,40,Rated Solo Shuffle,0";
  const OPEN_SHUFFLE =
    at(0, SHUFFLE_START) +
    at(1, CAST) +
    at(60, SHUFFLE_START) +
    at(61, CAST) +
    at(120, SHUFFLE_START) +
    at(121, CAST);

  function world() {
    const s = setup();
    const config = { ...s.config, matchesDir: join(s.root, "matches") };
    return { ...s, config };
  }
  function write(logsDir: string, name: string, body: string, ageS: number) {
    const p = join(logsDir, name);
    writeFileSync(p, body);
    const t = Date.now() / 1000 - ageS;
    utimesSync(p, t, t);
  }
  /** One app start: main's store init (which removes orphaned stagings),
   * then the worker's startup catch-up. Main handles the worker's messages
   * after the catch-up, as IPC delivers them, and its acks come back the
   * same way; `mainAlive: false` = main dies before handling any of them.
   * Returns what the store holds, how many stagings this start posted, and
   * the persisted checkpoints once the acks are in. */
  function launch(
    config: ReturnType<typeof world>["config"],
    mainAlive: boolean,
  ) {
    const store = new MatchStore(config.matchesDir);
    store.init();
    const inbox: WorkerToMain[] = [];
    const h = harness((m) => inbox.push(m));
    let notified = 0;
    const handler = createWorkerMessageHandler({
      store,
      recorder: null,
      emit: (ch) => {
        if (ch === "gladlog:logs:matchStored") notified++;
      },
      setStatus: () => {},
      logWarn: () => {},
      ack: (fileKey, ackId) => h.send({ type: "stored", fileKey, ackId }),
    });
    const rt = createWorkerRuntime({
      transport: h.transport,
      watchFn: h.watchFn,
    });
    h.send({ type: "configure", config });
    if (mainAlive) for (const m of inbox) handler(m);
    const cps = (
      JSON.parse(readFileSync(config.checkpointsPath, "utf-8")) as {
        files: Record<string, { offset: number }>;
      }
    ).files;
    rt.dispose();
    return {
      kinds: store
        .list()
        .map((m) => m.kind)
        .sort(),
      staged: inbox.filter((m) => m.type === "matchStaged").length,
      cps,
      notified,
      opens: (key: string) =>
        h.out.filter((m) => m.type === "segmentOpen" && m.fileKey === key)
          .length,
    };
  }

  for (const [label, body, resumeAt] of [
    ["只有一场打完的 A(基线就有的竞态)", MATCH, Buffer.byteLength(MATCH)],
    ["打完的 A + 没打完的 B", MATCH + OPEN, Buffer.byteLength(MATCH)],
  ] as const) {
    it(`最新文件:${label}`, () => {
      const w = world();
      const key = "WoWCombatLog-1.txt";
      write(w.logsDir, key, body, 0);
      const dead = launch(w.config, false);
      expect(dead.staged).toBe(1); // A was staged, then main died
      expect(dead.cps[key]!.offset).toBe(0); // not past unacknowledged A
      const alive = launch(w.config, true);
      expect(alive.kinds).toEqual(["match"]);
      expect(alive.cps[key]!.offset).toBe(resumeAt); // the ack moved it
      const again = launch(w.config, true);
      expect(again.kinds).toEqual(["match"]); // stored exactly once
      expect(again.staged).toBe(0); // not even re-read
      expect(again.cps[key]!.offset).toBe(resumeAt);
    });
  }

  it("已在库里的对局被重读(去重不发消息)也算确认,checkpoint 照样前进", () => {
    const w = world();
    const key = "WoWCombatLog-1.txt";
    write(w.logsDir, key, MATCH, 0);
    expect(launch(w.config, true).kinds).toEqual(["match"]);
    // Lose the checkpoint registry: A is re-read and is already on disk.
    writeFileSync(w.config.checkpointsPath, JSON.stringify({ files: {} }));
    const replay = launch(w.config, true);
    expect(replay.staged).toBe(0);
    expect(replay.kinds).toEqual(["match"]);
    expect(replay.cps[key]!.offset).toBe(Buffer.byteLength(MATCH));
  });

  it("退役文件的单排已完成轮次:EOF checkpoint 等 main 确认后才生效", () => {
    const w = world();
    const key = "WoWCombatLog-old.txt";
    write(w.logsDir, key, OPEN_SHUFFLE, 7200);
    write(w.logsDir, "WoWCombatLog-new.txt", "", 0);
    const dead = launch(w.config, false);
    expect(dead.staged).toBe(1);
    expect(dead.cps[key]!.offset).toBe(0); // the lobby's first START
    const alive = launch(w.config, true);
    expect(alive.kinds).toEqual(["shuffle"]);
    expect(alive.cps[key]!.offset).toBe(Buffer.byteLength(OPEN_SHUFFLE));
    const again = launch(w.config, true);
    expect(again.kinds).toEqual(["shuffle"]);
    expect(again.staged).toBe(0);
  });
});

// codex re-review of GH #211: "quiet and not the newest" is a judgement a
// second WoW client can prove wrong. A retired file that grows again is
// replayed from the retired segment's START, so a late END still closes it.
describe("退役后文件又长了:迟到的 END 照样闭合对局(GH #211 复审 2)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const at = (s: number, body: string) =>
    `6/30/2026 15:${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}.000  ${body}\n`;
  const OPEN = at(0, "ARENA_MATCH_START,1825,41,3v3,1") + at(1, CAST);
  const END = at(30, "ARENA_MATCH_END,1,30,1500,1501");
  const SHUFFLE_START = "ARENA_MATCH_START,1504,40,Rated Solo Shuffle,0";
  const OPEN_SHUFFLE =
    at(0, SHUFFLE_START) +
    at(1, CAST) +
    at(60, SHUFFLE_START) +
    at(61, CAST) +
    at(120, SHUFFLE_START) +
    at(121, CAST);

  function world() {
    const s = setup();
    const config = { ...s.config, matchesDir: join(s.root, "matches") };
    const write = (name: string, body: string, ageS: number) => {
      const p = join(s.logsDir, name);
      writeFileSync(p, body);
      const t = Date.now() / 1000 - ageS;
      utimesSync(p, t, t);
    };
    return { ...s, config, write };
  }
  type Cp = {
    offset: number;
    retired?: { segmentStart: number; size: number };
  };
  /** One app start with a live main (real store + handler, acks synchronous);
   * `during` runs while the runtime is still up. */
  async function start(
    config: ReturnType<typeof world>["config"],
    during?: (h: ReturnType<typeof harness>) => Promise<void>,
  ) {
    const store = new MatchStore(config.matchesDir);
    store.init();
    let notified = 0;
    let h: ReturnType<typeof harness> | null = null;
    const handler = createWorkerMessageHandler({
      store,
      recorder: null,
      emit: (ch) => {
        if (ch === "gladlog:logs:matchStored") notified++;
      },
      setStatus: () => {},
      logWarn: () => {},
      ack: (fileKey, ackId) => h!.send({ type: "stored", fileKey, ackId }),
    });
    h = harness((m) => handler(m));
    const rt = createWorkerRuntime({
      transport: h.transport,
      watchFn: h.watchFn,
    });
    h.send({ type: "configure", config });
    if (during) await during(h);
    rt.dispose();
    const cps = (
      JSON.parse(readFileSync(config.checkpointsPath, "utf-8")) as {
        files: Record<string, Cp>;
      }
    ).files;
    const out = h.out;
    return {
      kinds: store
        .list()
        .map((m) => m.kind)
        .sort(),
      notified,
      cps,
      reads: (key: string) =>
        out.filter(
          (m) =>
            (m.type === "segmentOpen" || m.type === "matchStaged") &&
            m.fileKey === key,
        ).length,
    };
  }

  it("下次启动:退役后补上 END → 这场入库且只入一次;没再长就不重读", async () => {
    const w = world();
    const A = "WoWCombatLog-A.txt";
    w.write(A, MATCH + OPEN, 7200);
    w.write("WoWCombatLog-B.txt", "", 0); // a second client's newer log
    const first = await start(w.config);
    expect(first.kinds).toEqual(["match"]); // only the finished one
    expect(first.cps[A]).toMatchObject({
      offset: Buffer.byteLength(MATCH + OPEN),
      retired: {
        segmentStart: Buffer.byteLength(MATCH),
        size: Buffer.byteLength(MATCH + OPEN),
      },
    });
    // No growth: nothing is re-read.
    const idle = await start(w.config);
    expect(idle.reads(A)).toBe(0);
    expect(idle.kinds).toEqual(["match"]);

    appendFileSync(join(w.logsDir, A), END);
    const late = await start(w.config);
    expect(late.kinds).toEqual(["match", "match"]);
    expect(late.notified).toBe(1);
    expect(late.cps[A]!.offset).toBe(Buffer.byteLength(MATCH + OPEN + END));
    expect(late.cps[A]!.retired).toBeUndefined();

    const after = await start(w.config);
    expect(after.kinds).toEqual(["match", "match"]); // exactly once
    expect(after.reads(A)).toBe(0);
  });

  it("同一会话里:退役后文件又写入 END → watcher 那次 flush 就闭合入库", async () => {
    const w = world();
    const A = "WoWCombatLog-A.txt";
    w.write(A, OPEN, 7200);
    w.write("WoWCombatLog-B.txt", "", 0);
    const r = await start(w.config, async (h) => {
      appendFileSync(join(w.logsDir, A), END);
      h.fileEvent(A);
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(r.kinds).toEqual(["match"]);
    expect(r.notified).toBe(1);
  });

  it("单排:退役时已存的轮次在补全后去重,不再发入库通知", async () => {
    const w = world();
    const A = "WoWCombatLog-A.txt";
    w.write(A, OPEN_SHUFFLE, 7200);
    w.write("WoWCombatLog-B.txt", "", 0);
    const first = await start(w.config);
    expect(first.kinds).toEqual(["shuffle"]); // the two finished rounds
    expect(first.notified).toBe(1);

    appendFileSync(
      join(w.logsDir, A),
      at(122, CAST) + at(150, "ARENA_MATCH_END,1,30,1500,1501"),
    );
    const late = await start(w.config);
    expect(late.kinds).toEqual(["shuffle"]);
    expect(late.notified).toBe(0);
    expect(late.cps[A]!.offset).toBe(readFileSync(join(w.logsDir, A)).length);
    expect(late.cps[A]!.retired).toBeUndefined();
  });
});

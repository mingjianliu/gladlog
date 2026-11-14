import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import type { FileCheckpoint, WorkerToMain } from "../src/shared/protocol";
import { FilePipeline, type ParserLike } from "../src/worker/pipeline";

const dir = () => mkdtempSync(join(tmpdir(), "gl-pipe-"));

function fakeParser(): ParserLike & {
  pushed: string[];
  open: boolean;
  fire: (ev: string, p: unknown) => void;
} {
  const cbs: Record<string, ((p: unknown) => void)[]> = {};
  return {
    pushed: [] as string[],
    open: false,
    push(l: string) {
      this.pushed.push(l);
    },
    end() {},
    hasOpenSegment() {
      return this.open;
    },
    on(ev: string, cb: (p: never) => void) {
      (cbs[ev] ??= []).push(cb as (p: unknown) => void);
      return this;
    },
    fire(ev: string, p: unknown) {
      for (const cb of cbs[ev] ?? []) cb(p);
    },
  };
}

describe("FilePipeline", () => {
  it("喂行;无 open segment → checkpoint 推进到行尾", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, "a\nb\n");
    const parser = fakeParser();
    const pipe = new FilePipeline({
      fileKey: "WoWCombatLog-1.txt",
      filePath: f,
      checkpoint: null,
      emit: () => {},
      parserFactory: () => parser,
    });
    pipe.processFlush();
    expect(parser.pushed).toEqual(["a", "b"]);
    expect(pipe.checkpoint.offset).toBe(4);
  });

  it("open segment → checkpoint 不动;闭合后下一次 flush 推进", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, "start\nmid\n");
    const parser = fakeParser();
    parser.open = true;
    const pipe = new FilePipeline({
      fileKey: "k",
      filePath: f,
      checkpoint: null,
      emit: () => {},
      parserFactory: () => parser,
    });
    pipe.processFlush();
    expect(pipe.checkpoint.offset).toBe(0); // 安全边界没动
    expect(pipe.currentOffset).toBe(10); // 但读进度在前面
    parser.open = false;
    appendFileSync(f, "end\n");
    pipe.processFlush();
    expect(pipe.checkpoint.offset).toBe(14);
  });

  it("轮转 → 重建 parser(新实例收到新行)", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, "aaaa\nbbbb\n");
    const instances: ReturnType<typeof fakeParser>[] = [];
    const pipe = new FilePipeline({
      fileKey: "k",
      filePath: f,
      checkpoint: null,
      emit: () => {},
      parserFactory: () => {
        const p = fakeParser();
        instances.push(p);
        return p;
      },
    });
    pipe.processFlush();
    writeFileSync(f, "new1\n"); // 截断
    pipe.processFlush();
    expect(instances).toHaveLength(2);
    expect(instances[1]!.pushed).toEqual(["new1"]);
  });

  it("parser 事件转成 WorkerToMain emit(带 fileKey)", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, "x\n");
    const parser = fakeParser();
    const out: WorkerToMain[] = [];
    new FilePipeline({
      fileKey: "k",
      filePath: f,
      checkpoint: null,
      emit: (m) => out.push(m),
      parserFactory: () => parser,
    });
    parser.fire("match", { id: "m1" });
    parser.fire("diagnostic", { code: "X" });
    expect(out[0]).toMatchObject({
      type: "match",
      fileKey: "k",
      payload: { id: "m1" },
    });
    expect(out[1]).toMatchObject({
      type: "diagnostic",
      fileKey: "k",
      code: "X",
    });
  });

  it("open segment → checkpoint 停在打开它的那一行行首(最后一个 IDLE 边界)", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, "a\nbb\nSTART\nmid\n");
    const parser = fakeParser();
    parser.push = function (l: string) {
      this.pushed.push(l);
      if (l === "START") this.open = true;
    };
    const pipe = new FilePipeline({
      fileKey: "k",
      filePath: f,
      checkpoint: null,
      emit: () => {},
      parserFactory: () => parser,
    });
    pipe.processFlush();
    expect(pipe.checkpoint.offset).toBe("a\nbb\n".length);
    expect(pipe.checkpoint.firstLineChecksum).not.toBeNull();
    // A later flush that stays inside the segment keeps that boundary.
    appendFileSync(f, "more\n");
    pipe.processFlush();
    expect(pipe.checkpoint.offset).toBe("a\nbb\n".length);
  });

  it("集成:真 GladLogParser 解析合成对局并产出 match 事件", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    const CAST =
      'SPELL_CAST_SUCCESS,Player-1-A,"Alice-X",0x512,0x80000000,0000000000000000,nil,0x80000000,0x80000000,2983,"Sprint",0x1,Player-1-A,0000000000000000,100,100,0,0,0,0,0,0,3,10,10,0,1.00,-1.00,0,1.0,70';
    const lines = [
      "6/30/2026 12:00:00.000  ARENA_MATCH_START,1825,41,3v3,1",
      `6/30/2026 12:00:01.000  ${CAST}`,
      "6/30/2026 12:00:02.000  ARENA_MATCH_END,1,30,1500,1501",
    ];
    writeFileSync(f, lines.join("\n") + "\n");
    const out: WorkerToMain[] = [];
    const pipe = new FilePipeline({
      fileKey: "k",
      filePath: f,
      checkpoint: null,
      emit: (m) => out.push(m),
    });
    pipe.processFlush();
    const match = out.find((m) => m.type === "match");
    expect(match).toBeDefined();
    // Not acknowledged yet: the persisted checkpoint must not pass the match.
    expect(pipe.checkpoint.offset).toBe(0);
    expect(pipe.acknowledge((match as { ackId: string }).ackId)).toBe(true);
    expect(pipe.checkpoint.offset).toBeGreaterThan(0); // 对局闭合且已落盘 → 安全边界已推进
  });

  it("未确认落盘的对局把 checkpoint 压在它的 START;确认后放行;轮转清空(GH #211 复审)", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    const at = (s: number, body: string) =>
      `6/30/2026 12:00:${String(s).padStart(2, "0")}.000  ${body}\n`;
    const a =
      at(0, "ARENA_MATCH_START,1825,41,3v3,1") +
      at(1, "ARENA_MATCH_END,1,30,1500,1501");
    const pre = at(2, "ZONE_CHANGE,1,x,0");
    const b =
      at(3, "ARENA_MATCH_START,1825,41,3v3,1") +
      at(4, "ARENA_MATCH_END,1,30,1500,1501");
    writeFileSync(f, a + pre + b);
    const acks: string[] = [];
    const pipe = new FilePipeline({
      fileKey: "k",
      filePath: f,
      checkpoint: null,
      emit: (m) => {
        if (m.type === "match") acks.push(m.ackId);
      },
    });
    pipe.processFlush();
    expect(acks).toHaveLength(2);
    expect(pipe.checkpoint.offset).toBe(0); // A's START
    pipe.acknowledge(acks[1]!); // B on disk, A still not
    expect(pipe.checkpoint.offset).toBe(0);
    pipe.acknowledge(acks[0]!);
    expect(pipe.checkpoint.offset).toBe(Buffer.byteLength(a + pre + b));
    expect(pipe.acknowledge(acks[0]!)).toBe(false); // already acknowledged

    // B unacknowledged again after a new flush: cap at B's START.
    appendFileSync(f, b);
    pipe.processFlush();
    expect(pipe.checkpoint.offset).toBe(Buffer.byteLength(a + pre + b));
    // A rotation drops the caps: their offsets belong to the old content.
    // Longer than the stale cap, so keeping it would show.
    const idle = Array.from({ length: 12 }, (_, i) =>
      at(10 + i, `ZONE_CHANGE,1,z${i},0`),
    ).join("");
    expect(Buffer.byteLength(idle)).toBeGreaterThan(
      Buffer.byteLength(a + pre + b),
    );
    writeFileSync(f, idle);
    pipe.processFlush();
    expect(pipe.checkpoint.offset).toBe(Buffer.byteLength(idle));
  });
});

// GH #211: the checkpoint sits at the last IDLE boundary, so a file that ends
// inside an open segment resumes from that segment's opening line instead of
// staying at byte 0 forever. Each case replays from the persisted checkpoint
// with a fresh pipeline, the way the next launch does.
describe("FilePipeline checkpoint at the last IDLE boundary (GH #211)", () => {
  const CAST =
    'SPELL_CAST_SUCCESS,Player-1-A,"Alice-X",0x512,0x80000000,0000000000000000,nil,0x80000000,0x80000000,2983,"Sprint",0x1,Player-1-A,0000000000000000,100,100,0,0,0,0,0,0,3,10,10,0,1.00,-1.00,0,1.0,70';
  const at = (s: number, body: string) =>
    `6/30/2026 12:${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}.000  ${body}\n`;
  const START = (s: number) => at(s, "ARENA_MATCH_START,1825,41,3v3,1");
  const START_2V2 = (s: number) => at(s, "ARENA_MATCH_START,1504,40,2v2,1");
  const SHUFFLE = (s: number) =>
    at(s, "ARENA_MATCH_START,1504,40,Rated Solo Shuffle,0");
  const END = (s: number) => at(s, "ARENA_MATCH_END,1,30,1500,1501");
  const cast = (s: number) => at(s, CAST);

  function run(f: string, checkpoint: FileCheckpoint | null) {
    const out: WorkerToMain[] = [];
    const pipe: FilePipeline = new FilePipeline({
      fileKey: "k",
      filePath: f,
      checkpoint,
      emit: (m) => {
        out.push(m);
        // As main does once the match is on disk.
        if (m.type === "match" || m.type === "shuffle")
          pipe.acknowledge(m.ackId);
      },
    });
    pipe.processFlush();
    const of = (t: WorkerToMain["type"]) => out.filter((m) => m.type === t);
    return { pipe, out, of };
  }

  it("退出时对局正在进行:下次从它的 START 重读,迟到的 END 照样闭合,前一场不重复", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    const before = START(0) + cast(1) + END(2) + cast(3);
    writeFileSync(f, before + START(10) + cast(11));
    const a = run(f, null);
    expect(a.of("match")).toHaveLength(1);
    expect(a.pipe.hasOpenSegment).toBe(true);
    expect(a.pipe.checkpoint.offset).toBe(Buffer.byteLength(before));

    appendFileSync(f, cast(12) + END(13));
    const b = run(f, a.pipe.checkpoint);
    // Only the second match; the first one is not re-read.
    expect(b.of("match")).toHaveLength(1);
    expect(b.of("segmentOpen")).toHaveLength(1);
    expect(b.of("segmentClose")).toEqual([
      expect.objectContaining({ aborted: false }),
    ]);
    expect(b.pipe.hasOpenSegment).toBe(false);
    expect(b.pipe.checkpoint.offset).toBe(readFileSync(f).length);
  });

  it("单排大厅:只在整个大厅之外算 IDLE → 从第一轮 START 重读,轮次不重复入库", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    const before = START(0) + END(1) + cast(2);
    writeFileSync(
      f,
      before +
        SHUFFLE(10) +
        cast(11) +
        SHUFFLE(20) +
        cast(21) +
        SHUFFLE(30) +
        cast(31),
    );
    const a = run(f, null);
    expect(a.of("shuffle")).toHaveLength(0);
    expect(a.pipe.checkpoint.offset).toBe(Buffer.byteLength(before));

    appendFileSync(f, cast(32) + END(40));
    const b = run(f, a.pipe.checkpoint);
    const shuffles = b.of("shuffle");
    expect(shuffles).toHaveLength(1);
    expect(
      (shuffles[0] as { payload: { rounds: unknown[] } }).payload.rounds,
    ).toHaveLength(3);
    expect(b.of("match")).toHaveLength(0); // the 3v3 before the lobby is not re-read
  });

  it("DOUBLE_START 不经过 IDLE:checkpoint 停在第一个 START,重读结果与不中断时一致", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    const before = cast(0);
    writeFileSync(f, before + START(1) + cast(2) + START_2V2(3) + cast(4));
    const a = run(f, null);
    expect(a.pipe.checkpoint.offset).toBe(Buffer.byteLength(before));

    appendFileSync(f, END(5));
    const b = run(f, a.pipe.checkpoint);
    const fromScratch = run(f, null);
    expect(b.of("match")).toHaveLength(1);
    expect(fromScratch.of("match")).toHaveLength(1);
    const bracket = (r: ReturnType<typeof run>) =>
      (r.of("match")[0] as { payload: { bracket?: string } }).payload.bracket;
    expect(bracket(b)).toBe(bracket(fromScratch));
    expect(
      b.of("diagnostic").map((d) => (d as { code: string }).code),
    ).toContain("DOUBLE_START");
  });

  it("WoW 仍在追加(末尾半行):checkpoint 落在完整行首;之后的轮转照样被识别", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    const before = START(0) + END(1);
    writeFileSync(
      f,
      before + START(10) + cast(11) + "6/30/2026 12:00:12.000  SPELL_CA",
    );
    const a = run(f, null);
    const cp = a.pipe.checkpoint;
    const buf = readFileSync(f);
    expect(cp.offset).toBe(Buffer.byteLength(before));
    expect(buf[cp.offset - 1]).toBe(0x0a);
    // The partial line is not consumed.
    expect(a.pipe.currentOffset).toBeLessThan(buf.length);

    // Larger file, different first line -> the checksum catches it.
    writeFileSync(f, START_2V2(0) + cast(1) + END(2) + START(3) + END(4));
    const b = run(f, cp);
    expect(b.of("match")).toHaveLength(2); // re-read from byte 0, not from cp
    expect(b.pipe.checkpoint.offset).toBe(readFileSync(f).length);

    // Same first line but smaller than the checkpoint -> size < offset
    // catches it, and the file is re-read from byte 0.
    writeFileSync(f, START(0));
    expect(readFileSync(f).length).toBeLessThan(cp.offset);
    const c = run(f, cp);
    expect(c.of("segmentOpen")).toHaveLength(1);
    expect(c.pipe.checkpoint.offset).toBe(0);
  });

  it("退役后文件被轮转:退役记录作废,之后的增长不会倒回旧偏移重读", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, START(0) + cast(1) + cast(2));
    const out: WorkerToMain[] = [];
    const pipe: FilePipeline = new FilePipeline({
      fileKey: "k",
      filePath: f,
      checkpoint: null,
      emit: (m) => {
        out.push(m);
        if (m.type === "match") pipe.acknowledge(m.ackId);
      },
    });
    pipe.processFlush();
    pipe.retire();
    expect(pipe.checkpoint.retired).toEqual({
      segmentStart: 0,
      size: readFileSync(f).length,
    });
    // Rotated to shorter, different content, then grown past the old size.
    writeFileSync(f, START_2V2(0) + END(1));
    pipe.processFlush();
    expect(pipe.checkpoint.retired).toBeUndefined();
    appendFileSync(f, START(2) + cast(3) + END(4));
    pipe.processFlush();
    // Each match exactly once: nothing was re-read from the stale offset.
    expect(out.filter((m) => m.type === "match")).toHaveLength(2);
    expect(pipe.checkpoint.offset).toBe(readFileSync(f).length);
  });
});

import { appendFileSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { WorkerToMain } from "../src/shared/protocol";
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
    expect(pipe.checkpoint.offset).toBeGreaterThan(0); // 对局闭合 → 安全边界已推进
  });
});

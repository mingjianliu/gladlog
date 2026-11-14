import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  truncateSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  initialTailState,
  readTail,
  type TailState,
} from "../src/worker/tailReader";

const dir = () => mkdtempSync(join(tmpdir(), "gl-tail-"));

/** Collects a streamed read: lines, their start offsets, and the order of
 * the rotation callback relative to them. */
function read(f: string, state: TailState, chunkSize?: number) {
  const lines: string[] = [];
  const starts: number[] = [];
  const order: string[] = [];
  const r = readTail(
    f,
    state,
    {
      rotated: (cs) => order.push(`rotated:${cs === null ? "null" : "sha"}`),
      line: (text, start) => {
        order.push("line");
        lines.push(text);
        starts.push(start);
      },
    },
    chunkSize,
  );
  return { ...r, lines, starts, order };
}

/** The offset of every line start in `buf` (the byte after each \n). */
function lineStarts(buf: Buffer): number[] {
  const out: number[] = [];
  let s = 0;
  for (;;) {
    const nl = buf.indexOf(0x0a, s);
    if (nl === -1) return out;
    out.push(s);
    s = nl + 1;
  }
}

describe("readTail", () => {
  it("全新文件从 0 读完整行,offset 停在最后完整行尾", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, "line1\nline2\npartial");
    const r = read(f, initialTailState());
    expect(r.lines).toEqual(["line1", "line2"]);
    expect(r.state.offset).toBe("line1\nline2\n".length);
    expect(r.rotated).toBe(false);
  });

  it("增量:carry 与后续追加拼成完整行", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, "line1\npar");
    let r = read(f, initialTailState());
    expect(r.lines).toEqual(["line1"]);
    appendFileSync(f, "tial\nline3\n");
    r = read(f, r.state);
    expect(r.lines).toEqual(["partial", "line3"]);
    // The carried line starts where its first bytes were, not where the
    // second read began.
    expect(r.starts).toEqual([6, 14]);
  });

  it("CRLF 行剥 \\r;UTF-8 多字节在块边界不劈坏", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, "拉格纳罗斯\r\n第二行\r\n");
    const r = read(f, initialTailState());
    expect(r.lines).toEqual(["拉格纳罗斯", "第二行"]);
  });

  it("每行起始字节偏移逐字节准确(CRLF + 多字节)", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    const content = "ab\r\n拉格\n\nxyz\r\nlast\n";
    writeFileSync(f, content);
    const r = read(f, initialTailState());
    expect(r.lines).toEqual(["ab", "拉格", "", "xyz", "last"]);
    expect(r.starts).toEqual(lineStarts(Buffer.from(content)));
    expect(r.starts).toEqual([0, 4, 11, 12, 17]);
  });

  it("任意块大小(含把 \\r\\n 和多字节字符劈在块边界)结果与默认块一致", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, "ab\r\n拉格纳罗斯\r\n\r\n第二行\nx\r\ntail");
    const ref = read(f, initialTailState());
    for (const chunk of [1, 2, 3, 4, 5, 7]) {
      const r = read(f, initialTailState(), chunk);
      expect(r.lines).toEqual(ref.lines);
      expect(r.starts).toEqual(ref.starts);
      expect(r.state.offset).toBe(ref.state.offset);
      expect(r.state.carry.toString()).toBe("tail");
    }
  });

  it("边读边交行:第一行交出时后面的块还没读(不是先攒成整个数组)", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    const all = Array.from({ length: 50 }, (_, i) => `line-${i}`);
    writeFileSync(f, all.map((l) => `${l}\n`).join(""));
    const seen: string[] = [];
    readTail(
      f,
      initialTailState(),
      {
        line: (text) => {
          // Truncating the file after the first line: a streaming reader only
          // has the first chunk in hand and reads nothing more; a reader that
          // split the whole file first would still deliver every line.
          if (seen.length === 0) truncateSync(f, 0);
          seen.push(text);
        },
      },
      16,
    );
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.length).toBeLessThan(all.length);
  });

  it("截断(size < offset)→ rotated,从 0 重读", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, "aaaa\nbbbb\ncccc\n");
    let r = read(f, initialTailState());
    writeFileSync(f, "new1\n"); // truncate and rewrite
    r = read(f, r.state);
    expect(r.rotated).toBe(true);
    expect(r.lines).toEqual(["new1"]);
  });

  it("同长换内容(首行校验和变)→ rotated", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, "aaaa\nbbbb\n");
    let r = read(f, initialTailState());
    writeFileSync(f, "zzzz\nbbbb\n"); // same size, first line changed
    r = read(f, r.state);
    expect(r.rotated).toBe(true);
    expect(r.lines).toEqual(["zzzz", "bbbb"]);
  });

  it("轮转回调先于任何新行,且只调一次;未轮转不调", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, "aaaa\nbbbb\n");
    let r = read(f, initialTailState());
    expect(r.order).toEqual(["line", "line"]);
    writeFileSync(f, "zz\nyy\n");
    r = read(f, r.state);
    expect(r.order).toEqual(["rotated:sha", "line", "line"]);
    expect(r.state.firstLineChecksum).not.toBeNull();
    expect(r.starts).toEqual([0, 3]);
  });

  it("无新内容 → 不交行,状态不变", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, "line1\n");
    const r1 = read(f, initialTailState());
    const r2 = read(f, r1.state);
    expect(r2.lines).toEqual([]);
    expect(r2.state.offset).toBe(r1.state.offset);
  });

  it("文件不存在 → 空结果不抛", () => {
    const r = read(join(dir(), "nope.txt"), initialTailState());
    expect(r.lines).toEqual([]);
    expect(r.rotated).toBe(false);
  });

  it("交出的每个起始偏移都正好落在文件里的行首", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, "α\r\nβγ\n\r\nδ\nε");
    const r = read(f, initialTailState(), 3);
    const buf = readFileSync(f);
    for (const s of r.starts) expect(s === 0 || buf[s - 1] === 0x0a).toBe(true);
  });
});

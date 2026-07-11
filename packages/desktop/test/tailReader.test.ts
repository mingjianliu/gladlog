import { appendFileSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { initialTailState, readTail } from "../src/worker/tailReader";

const dir = () => mkdtempSync(join(tmpdir(), "gl-tail-"));

describe("readTail", () => {
  it("全新文件从 0 读完整行,offset 停在最后完整行尾", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, "line1\nline2\npartial");
    const r = readTail(f, initialTailState());
    expect(r.lines).toEqual(["line1", "line2"]);
    expect(r.state.offset).toBe("line1\nline2\n".length);
    expect(r.rotated).toBe(false);
  });

  it("增量:carry 与后续追加拼成完整行", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, "line1\npar");
    let r = readTail(f, initialTailState());
    expect(r.lines).toEqual(["line1"]);
    appendFileSync(f, "tial\nline3\n");
    r = readTail(f, r.state);
    expect(r.lines).toEqual(["partial", "line3"]);
  });

  it("CRLF 行剥 \\r;UTF-8 多字节在块边界不劈坏", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, "拉格纳罗斯\r\n第二行\r\n");
    const r = readTail(f, initialTailState());
    expect(r.lines).toEqual(["拉格纳罗斯", "第二行"]);
  });

  it("截断(size < offset)→ rotated,从 0 重读", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, "aaaa\nbbbb\ncccc\n");
    let r = readTail(f, initialTailState());
    writeFileSync(f, "new1\n"); // 截断重写
    r = readTail(f, r.state);
    expect(r.rotated).toBe(true);
    expect(r.lines).toEqual(["new1"]);
  });

  it("同长换内容(首行校验和变)→ rotated", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, "aaaa\nbbbb\n");
    let r = readTail(f, initialTailState());
    writeFileSync(f, "zzzz\nbbbb\n"); // size 相同,首行变
    r = readTail(f, r.state);
    expect(r.rotated).toBe(true);
    expect(r.lines).toEqual(["zzzz", "bbbb"]);
  });

  it("无新内容 → 空 lines,状态不变", () => {
    const f = join(dir(), "WoWCombatLog-1.txt");
    writeFileSync(f, "line1\n");
    const r1 = readTail(f, initialTailState());
    const r2 = readTail(f, r1.state);
    expect(r2.lines).toEqual([]);
    expect(r2.state.offset).toBe(r1.state.offset);
  });

  it("文件不存在 → 空结果不抛", () => {
    const r = readTail(join(dir(), "nope.txt"), initialTailState());
    expect(r.lines).toEqual([]);
    expect(r.rotated).toBe(false);
  });
});

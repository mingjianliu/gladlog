import { appendFileSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";

import type { WorkerToMain } from "../shared/protocol";
import { FilePipeline } from "./pipeline";

function line(i: number, s: string): string {
  return `6/30/2026 12:00:${String(i).padStart(2, "0")}.000  ${s}\n`;
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "gladlog-pipeline-"));
  const file = join(dir, "WoWCombatLog.txt");
  writeFileSync(file, "");
  const msgs: WorkerToMain[] = [];
  const p = new FilePipeline({
    fileKey: "WoWCombatLog.txt",
    filePath: file,
    checkpoint: null,
    emit: (m) => msgs.push(m),
  });
  return { file, msgs, p };
}

describe("pipeline lifecycle forwarding", () => {
  it("START → segmentOpen;END → segmentClose(带 fileKey)", () => {
    const { file, msgs, p } = setup();
    appendFileSync(file, line(0, "ARENA_MATCH_START,1825,41,3v3,1"));
    p.processFlush();
    const open = msgs.find((m) => m.type === "segmentOpen");
    expect(open).toMatchObject({ fileKey: "WoWCombatLog.txt", bracket: "3v3" });
    appendFileSync(file, line(1, "ARENA_MATCH_END,1,30,1500,1501"));
    p.processFlush();
    const close = msgs.find((m) => m.type === "segmentClose");
    expect(close).toMatchObject({ aborted: false });
  });

  it("closeOpenSegment:对局中补合成 close,IDLE 时不发(teardown 用,agy #5)", () => {
    const { file, msgs, p } = setup();
    p.closeOpenSegment(); // IDLE
    expect(msgs.filter((m) => m.type === "segmentClose")).toHaveLength(0);
    appendFileSync(file, line(0, "ARENA_MATCH_START,1825,41,3v3,1"));
    p.processFlush();
    p.closeOpenSegment();
    expect(msgs.filter((m) => m.type === "segmentClose")).toEqual([
      expect.objectContaining({ endTime: null, aborted: true }),
    ]);
  });

  it("对局中文件轮转 → 合成 aborted close", () => {
    const { file, msgs, p } = setup();
    appendFileSync(file, line(0, "ARENA_MATCH_START,1825,41,3v3,1"));
    p.processFlush();
    // Rotation: the whole file is replaced (the first line's checksum changes)
    writeFileSync(file, line(0, "ARENA_MATCH_START,1504,40,2v2,1"));
    p.processFlush();
    const closes = msgs.filter((m) => m.type === "segmentClose");
    expect(closes).toEqual([
      expect.objectContaining({ endTime: null, aborted: true }),
    ]);
    // The new parser opens the new match as usual
    expect(msgs.filter((m) => m.type === "segmentOpen")).toHaveLength(2);
  });

  it("#21.8 shuffle 中途文件轮转 → 已完成轮通过 shuffle 消息落账,不再永久孤儿", () => {
    const { file, msgs, p } = setup();
    const SHUFFLE_START = "ARENA_MATCH_START,1504,40,Rated Solo Shuffle,0";
    // Round 1 and round 2 both complete (each closed by the next round's
    // ARENA_MATCH_START); round 3 has just started when the file rotates.
    appendFileSync(file, line(0, SHUFFLE_START));
    appendFileSync(file, line(1, SHUFFLE_START));
    appendFileSync(file, line(2, SHUFFLE_START));
    p.processFlush();
    expect(msgs.filter((m) => m.type === "shuffle")).toHaveLength(0);
    // Rotation mid-round-3: previously this silently discarded the parser
    // (no parser.end() call at all), so rounds 1-2 never reached the
    // recorder's associate() and their recording segments were permanently
    // orphaned.
    writeFileSync(file, line(0, "ARENA_MATCH_START,1825,41,3v3,1"));
    p.processFlush();
    const shuffles = msgs.filter((m) => m.type === "shuffle");
    expect(shuffles).toHaveLength(1);
    expect(
      (shuffles[0] as { payload: { rounds: unknown[] } }).payload.rounds,
    ).toHaveLength(2);
    // The recorder still gets its aborted close signal for the truncated
    // round, same as any other mid-segment rotation.
    expect(msgs.filter((m) => m.type === "segmentClose")).toEqual([
      expect.objectContaining({ endTime: null, aborted: true }),
    ]);
  });
});

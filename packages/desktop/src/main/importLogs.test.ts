import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";

import { importLogFiles } from "./importLogs";
import { MatchStore } from "./matchStore";

// 最小合法对局(取自 parser api.test 的合成行)
const MATCH_LINES = [
  "6/30/2026 12:00:00.000  ARENA_MATCH_START,1825,41,3v3,1",
  '6/30/2026 12:00:01.000  SPELL_CAST_SUCCESS,Player-1-A,"Alice-X",0x512,0x80000000,0000000000000000,nil,0x80000000,0x80000000,2983,"Sprint",0x1,Player-1-A,0000000000000000,100,100,0,0,0,0,0,0,3,10,10,0,1.00,-1.00,0,1.0,70',
  "6/30/2026 12:00:02.000  ARENA_MATCH_END,1,30,1500,1501",
].join("\n");

describe("importLogFiles(phase3 #2c)", () => {
  it("解析入库 + 进度/matchStored 事件;重复导入幂等计 dup;坏文件计 failed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-import-"));
    const logA = join(dir, "a.txt");
    writeFileSync(logA, MATCH_LINES);
    const store = new MatchStore(mkdtempSync(join(tmpdir(), "gl-store-")));
    const events: Array<{ ch: string; p: unknown }> = [];
    const emit = (ch: string, p: unknown) => events.push({ ch, p });

    const r1 = await importLogFiles([logA], store, emit);
    expect(r1).toMatchObject({ files: 1, stored: 1, dup: 0, failed: 0 });
    expect(events.some((e) => e.ch === "gladlog:logs:matchStored")).toBe(true);
    const prog = events.filter((e) => e.ch === "gladlog:import:progress");
    expect(prog.length).toBe(1);
    expect(prog[0]!.p).toMatchObject({ i: 1, n: 1, stored: 1 });

    // 再导一次:去重
    const r2 = await importLogFiles([logA], store, emit);
    expect(r2).toMatchObject({ stored: 0, dup: 1, failed: 0 });

    // 坏路径:failed
    const r3 = await importLogFiles(
      [join(dir, "missing.txt")],
      store,
      emit,
    );
    expect(r3).toMatchObject({ failed: 1, stored: 0 });
  });
});

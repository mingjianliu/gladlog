import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { MatchStore } from "../src/main/matchStore";
import { parseDocBytes } from "../src/shared/parseDocBytes";
import { composeLazyDoc, parseRoundBytes } from "../src/shared/parseLazyDoc";
import { scanRoundOffsets } from "../src/shared/roundOffsets";
import { loadMatchFixture } from "./fixtures/loadFixture";

/** perf-1 端到端判据:getLazy(shell+round0) + getRound 逐轮补齐后,与
 * get() 整档字节 → parseDocBytes 的结果深等。sidecar 由测试直写(生产由
 * roundsIdxWorker 写同一格式;格式漂移会被这里的 stat 守卫/深等抓住)。 */
describe("MatchStore 懒加载路径", () => {
  const dir = mkdtempSync(join(tmpdir(), "gl-lazy-"));
  const id = "lobby1";
  const m = loadMatchFixture();
  const doc = {
    schemaVersion: 1,
    storedAt: 1,
    kind: "shuffle",
    data: {
      kind: "shuffle",
      startTime: 1,
      endTime: 2,
      result: "3/6",
      rounds: [
        m,
        { id: "r2", sequenceNumber: 1, units: {} },
        { id: "r3", sequenceNumber: 2, units: {} },
      ],
    },
  };

  const writeSidecar = (matchDir: string, buf: Buffer) => {
    const off = scanRoundOffsets(buf)!;
    const st = statSync(join(matchDir, "match.json"));
    writeFileSync(
      join(matchDir, "rounds.idx.json"),
      JSON.stringify({
        v: 1,
        fileSize: st.size,
        mtimeMs: st.mtimeMs,
        arrayOpenEnd: off.arrayOpenEnd,
        arrayClose: off.arrayClose,
        rounds: off.rounds,
      }),
    );
  };

  const setup = () => {
    const matchDir = join(dir, id);
    mkdirSync(matchDir, { recursive: true });
    const buf = Buffer.from(JSON.stringify(doc));
    writeFileSync(join(matchDir, "match.json"), buf);
    writeFileSync(
      join(matchDir, "meta.json"),
      JSON.stringify({ id, kind: "shuffle", startTime: 1, endTime: 2 }),
    );
    writeSidecar(matchDir, buf);
    const s = new MatchStore(dir);
    (s as unknown as { index: Map<string, unknown> }).index.set(id, {
      id,
      kind: "shuffle",
      slimmed: true,
    });
    return s;
  };

  it("perRound:shell+round0+逐轮 getRound == 整档 parseDocBytes", async () => {
    const s = setup();
    const lazy = await s.getLazy(id);
    expect(lazy?.mode).toBe("perRound");
    if (lazy?.mode !== "perRound") return;
    expect(lazy.roundCount).toBe(3);
    const composed = composeLazyDoc(
      lazy.shell,
      lazy.round0,
      lazy.roundCount,
    ) as { data: { rounds: unknown[] } };
    expect(composed).not.toBeNull();
    for (let i = 1; i < lazy.roundCount; i++) {
      const rb = await s.getRound(id, i);
      expect(rb).toBeInstanceOf(Buffer);
      composed.data.rounds[i] = parseRoundBytes(rb);
    }
    const whole = parseDocBytes(await s.get(id));
    expect(composed).toEqual(whole);
  });

  it("越界轮号:null", async () => {
    const s = setup();
    expect(await s.getRound(id, 99)).toBeNull();
    expect(await s.getRound("nope", 0)).toBeNull();
  });

  it("sidecar 过期(match.json 被重写):回落整档 full 模式", async () => {
    const s = setup();
    // 重写 match.json(模拟 slim 自愈)但不更新 sidecar → stat 守卫失配
    const matchDir = join(dir, id);
    writeFileSync(
      join(matchDir, "match.json"),
      JSON.stringify({ ...doc, storedAt: 2 }),
    );
    const lazy = await s.getLazy(id);
    expect(lazy?.mode).toBe("full");
    if (lazy?.mode !== "full") return;
    expect(parseDocBytes(lazy.bytes)).toEqual(parseDocBytes(await s.get(id)));
    expect(await s.getRound(id, 1)).toBeNull();
  });

  // T220 codex #1 (folded into T200): the sidecar is validated by a stat of
  // the path, the file is opened after it. A self-heal that replaces
  // match.json in between must not have its bytes read at the old offsets.
  it("校验之后、打开之前文件被换掉:不按旧偏移读(否则读到的是另一轮的合法 JSON)", async () => {
    const s = setup();
    const matchDir = join(dir, id);
    // same byte length, rounds 2 and 3 swapped: the old offsets of round 2
    // address round 3's bytes, and they parse
    const swapped = {
      ...doc,
      data: {
        ...doc.data,
        rounds: [doc.data.rounds[0], doc.data.rounds[2], doc.data.rounds[1]],
      },
    };
    const inner = s as unknown as {
      readRoundsIdx: (id: string) => unknown;
    };
    const validate = inner.readRoundsIdx.bind(s);
    let swaps = 0;
    inner.readRoundsIdx = (x: string) => {
      const idx = validate(x);
      // the heal's atomic replace lands here
      const tmp = join(matchDir, "match.json.tmp");
      writeFileSync(tmp, JSON.stringify(swapped));
      const later = new Date(Date.now() + 5_000 + swaps++ * 1_000);
      utimesSync(tmp, later, later);
      renameSync(tmp, join(matchDir, "match.json"));
      return idx;
    };
    // before the handle check this returned {"id":"r3","sequenceNumber":2,…}
    expect(await s.getRound(id, 1)).toBeNull();
    const lazy = await s.getLazy(id);
    expect(lazy?.mode).toBe("full");
    if (lazy?.mode !== "full") return;
    // the whole document, as it is on disk now
    const now = parseDocBytes(lazy.bytes) as typeof swapped;
    expect(now.data.rounds.map((r) => (r as { id?: string }).id)).toEqual(
      swapped.data.rounds.map((r) => (r as { id?: string }).id),
    );
  });

  it("非 shuffle:full 模式", async () => {
    const s = setup();
    const mid = "arena1";
    mkdirSync(join(dir, mid), { recursive: true });
    writeFileSync(
      join(dir, mid, "match.json"),
      JSON.stringify({ schemaVersion: 1, kind: "match", data: m }),
    );
    (s as unknown as { index: Map<string, unknown> }).index.set(mid, {
      id: mid,
      kind: "match",
      slimmed: true,
    });
    const lazy = await s.getLazy(mid);
    expect(lazy?.mode).toBe("full");
  });
});

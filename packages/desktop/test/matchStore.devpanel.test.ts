import type { GladMatch } from "@gladlog/parser";
import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";

import { MatchStore } from "../src/main/matchStore";

const dir = () => mkdtempSync(join(tmpdir(), "gl-devpanel-"));

function richMatch(id: string): GladMatch {
  return {
    kind: "match",
    id,
    bracket: "3v3",
    zoneId: "1825",
    startTime: 100_000,
    endTime: 245_000,
    playerId: "a",
    playerTeamId: 0,
    winningTeamId: 1,
    result: "loss",
    linesTotal: 3,
    linesDropped: 0,
    rawLines: ["l1", "l2"],
    hasAdvancedLogging: true,
    timezone: "UTC",
    units: {
      a: {
        kind: "Player",
        specId: 105,
        classId: 11,
        info: { teamId: 0, personalRating: 2400 },
      },
      c: {
        kind: "Player",
        specId: 64,
        classId: 8,
        info: { teamId: 1, personalRating: 2500 },
      },
    },
  } as unknown as GladMatch;
}

/** The "old index" state with the rich-row fields stripped off — the input
 * precondition for rebuild/reparse. */
function stripRich(s: MatchStore, id: string): void {
  const index = (
    s as unknown as { index: Map<string, Record<string, unknown>> }
  ).index;
  const stripped = { ...index.get(id)! };
  delete stripped["durationS"];
  delete stripped["avgRating"];
  delete stripped["teams"];
  index.set(id, stripped);
}

describe("rebuildIndex 进度回调(开发者页行内进度替代 alert)", () => {
  it("逐场回报 i/n,末次 i === n", async () => {
    const s = new MatchStore(dir());
    for (const id of ["p1", "p2", "p3"]) s.store(richMatch(id));
    const seen: Array<{ i: number; n: number }> = [];

    const r = await s.rebuildIndex((p) => seen.push({ i: p.i, n: p.n }));

    expect(r.updated).toBe(3);
    expect(seen).toHaveLength(3);
    expect(seen.map((p) => p.i)).toEqual([1, 2, 3]);
    expect(seen.every((p) => p.n === 3)).toBe(true);
  });

  it("不传回调也照常跑完(既有调用点不受影响)", async () => {
    const s = new MatchStore(dir());
    s.store(richMatch("p1"));
    await expect(s.rebuildIndex()).resolves.toEqual({ updated: 1, failed: 0 });
  });

  it("跟车的第二次调用不重开循环,只等在飞的那次", async () => {
    const s = new MatchStore(dir());
    s.store(richMatch("p1"));
    let calls = 0;
    const a = s.rebuildIndex(() => calls++);
    const b = s.rebuildIndex(() => calls++);
    await Promise.all([a, b]);
    // Single-flight: only the first call's callback is fed, the loop runs once
    expect(calls).toBe(1);
  });
});

describe("reparse 单场(右栏「重新解析此对局」)", () => {
  it("重读 match.json 重提炼富行字段,只动这一场", async () => {
    const d = dir();
    const s = new MatchStore(d);
    s.store(richMatch("one"));
    s.store(richMatch("two"));
    stripRich(s, "one");
    stripRich(s, "two");

    const r = await s.reparse("one");

    expect(r.ok).toBe(true);
    expect(s.list().find((m) => m.id === "one")!.durationS).toBe(145);
    // The match that was not clicked stays as-is — a single-match action must
    // not casually rebuild the whole library
    expect(s.list().find((m) => m.id === "two")!.durationS).toBeUndefined();
  });

  it("重提炼的结果写回 meta.json,不只是内存索引", async () => {
    const d = dir();
    const s = new MatchStore(d);
    s.store(richMatch("one"));
    stripRich(s, "one");
    await s.reparse("one");
    const onDisk = JSON.parse(
      readFileSync(join(d, "one", "meta.json"), "utf-8"),
    );
    expect(onDisk.durationS).toBe(145);
  });

  it("未知 id → ok:false,不抛", async () => {
    const s = new MatchStore(dir());
    await expect(s.reparse("nope")).resolves.toEqual({ ok: false });
  });
});

describe("eventCount(开发者页事实卡「事件数」)", () => {
  /** A different count per event kind, so the test pins down *which arrays*
   * are summed instead of merely asserting "non-zero". */
  const withEvents = (id: string): GladMatch =>
    ({
      ...(richMatch(id) as unknown as Record<string, unknown>),
      units: {
        a: {
          kind: "Player",
          specId: 105,
          classId: 11,
          info: { teamId: 0 },
          damageOut: [1, 2, 3],
          // Receiving side: not counted, else the same log line counts twice
          damageIn: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          healOut: [1, 2],
          absorbsOut: [1],
          casts: [1, 2, 3, 4],
          petCasts: [1],
          auraEvents: [1, 2, 3, 4, 5],
          actionsOut: [1, 2],
          actionsIn: [1, 1, 1], // receiving side: not counted
          deaths: [1],
          unconsciousEvents: [1],
          advancedSamples: [1, 1, 1, 1], // samples are not events
        },
      },
    }) as unknown as GladMatch;

  it("store 时算入 meta:只累加施放方数组,承受侧与采样不计", () => {
    const s = new MatchStore(dir());
    const { meta } = s.store(withEvents("ev1"));
    // 3+2+1+4+1+5+2+1+1 = 20
    expect(meta!.eventCount).toBe(20);
  });

  it("旧行可由 rebuildIndex 回填(数值与 store 时一致)", async () => {
    const s = new MatchStore(dir());
    s.store(withEvents("ev2"));
    const index = (
      s as unknown as { index: Map<string, Record<string, unknown>> }
    ).index;
    const stripped = { ...index.get("ev2")! };
    delete stripped["eventCount"];
    index.set("ev2", stripped);
    expect(s.list().find((m) => m.id === "ev2")!.eventCount).toBeUndefined();

    await s.reparse("ev2");

    expect(s.list().find((m) => m.id === "ev2")!.eventCount).toBe(20);
  });

  it("无事件数组的对局 → 0,不是 undefined(区分「没事件」与「旧行没算过」)", () => {
    const s = new MatchStore(dir());
    const { meta } = s.store(richMatch("ev3"));
    expect(meta!.eventCount).toBe(0);
  });
});

describe("dirOf(对局目录定位)", () => {
  it("已入库的 id 给出目录路径", () => {
    const d = dir();
    const s = new MatchStore(d);
    s.store(richMatch("one"));
    expect(s.dirOf("one")).toBe(join(d, "one"));
  });

  it("未入库的 id → null(不给外部构造任意路径的口子)", () => {
    const s = new MatchStore(dir());
    expect(s.dirOf("../../etc")).toBeNull();
  });
});

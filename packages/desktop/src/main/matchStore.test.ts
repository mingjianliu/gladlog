import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MatchStore } from "./matchStore";
import type { GladMatch } from "@gladlog/parser";

function tmpStore() {
  return new MatchStore(mkdtempSync(join(tmpdir(), "ms-")));
}
function mkMatch(id: string, startTime: number): GladMatch {
  return {
    kind: "match",
    id,
    bracket: "2v2",
    zoneId: "0",
    startTime,
    endTime: startTime + 1,
    result: 0,
    rawLines: [],
  } as unknown as GladMatch;
}

describe("MatchStore.page", () => {
  it("returns the most-recent `limit` matches, newest first", () => {
    const s = tmpStore();
    for (const t of [100, 300, 200]) s.store(mkMatch(`m${t}`, t));
    const p = s.page({ limit: 2 });
    expect(p.map((m) => m.startTime)).toEqual([300, 200]);
  });
  it("pages older via `before` (strict <)", () => {
    const s = tmpStore();
    for (const t of [100, 200, 300]) s.store(mkMatch(`m${t}`, t));
    expect(s.page({ before: 300, limit: 10 }).map((m) => m.startTime)).toEqual([
      200, 100,
    ]);
    expect(s.page({ before: 100, limit: 10 })).toEqual([]);
  });
  it("clamps limit to [1,500]", () => {
    const s = tmpStore();
    for (const t of [1, 2, 3]) s.store(mkMatch(`m${t}`, t));
    expect(s.page({ limit: 0 })).toHaveLength(1);
  });
});

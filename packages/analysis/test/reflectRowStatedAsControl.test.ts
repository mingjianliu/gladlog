/**
 * `reflectRowStatedAsControl` (pipeline T120, codex 85-tk-L-T120-2 #1): a
 * REFLECT row's `[REFLECTED]` line prints for a control always, for any
 * other spell only when enough damage came back — only the first needs no
 * `[CC AVOIDED?]` line.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src";
import { reflectRowStatedAsControl } from "../src/utils/castMissRows";

beforeAll(async () => {
  await ensureAnalysisData();
});

const row = (spellId: string, missType = "REFLECT", src = "e1") => ({
  missType,
  spellId,
  srcUnitId: src,
  destUnitId: "p1",
});

describe("reflectRowStatedAsControl", () => {
  it("a reflected control (Polymorph) is stated by its [REFLECTED] line", () => {
    expect(reflectRowStatedAsControl(row("118"))).toBe(true);
  });
  it("a reflected Silence is not — no [REFLECTED] line prints for it", () => {
    expect(reflectRowStatedAsControl(row("15487"))).toBe(false);
  });
  it("a non-REFLECT row, or a unit's own bounce, is not", () => {
    expect(reflectRowStatedAsControl(row("118", "MISS"))).toBe(false);
    expect(reflectRowStatedAsControl(row("118", "REFLECT", "p1"))).toBe(false);
  });
});

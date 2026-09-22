import { describe, expect, it } from "vitest";

import {
  classifyNoChangeResRows,
  droppableNoChangeResRows,
  isNoChangeResLine,
  pruneZeroLossResRows,
} from "../src/context/resLedgerPrune";

// GH #99 item 5 (user ruling 2026-09-22): drop only the no-change [RES] rows
// whose every fact the surviving text already states. The renderer and the
// eval gate share these functions; these cases pin the criterion itself.
const t = (mmss: string, body: string) => `${mmss}  ${body}`;
const full = (focus: string) => `      [RES] rdy:Revival,Life Cocoon  cd:—  focus:${focus}`;
const nc = (tail: string) => `      [RES] rdy:Δ  cd:—  ${tail}`;

describe("resLedgerPrune — zero-loss no-change [RES] rows", () => {
  it("recognises the no-change shape only", () => {
    expect(isNoChangeResLine(nc("focus:2"))).toBe(true);
    expect(isNoChangeResLine(full("2"))).toBe(false);
    expect(isNoChangeResLine("      [RES] rdy:Δ +Revival  cd:—  focus:2")).toBe(false);
  });

  it("focus: droppable when either non-no-change neighbour shows the same target", () => {
    const lines = [t("0:10", "[STATE] x"), full("2"), t("0:20", "[STATE] y"), nc("focus:2"), t("0:30", "[STATE] z"), full("3")];
    expect(droppableNoChangeResRows(lines)).toEqual(new Set([3]));
    const switched = [t("0:10", "[STATE] x"), full("2"), t("0:20", "[STATE] y"), nc("focus:4"), t("0:30", "[STATE] z"), full("3")];
    expect(classifyNoChangeResRows(switched)).toEqual([{ index: 3, uniqueFacts: ["focus"] }]);
  });

  it("focus neighbours skip other no-change rows (class-deleted neighbour set; order-independent)", () => {
    // Row 3 (focus:4) is unique; row 5 (focus:2) is still droppable because its
    // nearest NON-no-change neighbours (rows 1 and 7) both show focus 2.
    const lines = [t("0:10", "[STATE] a"), full("2"), t("0:20", "[STATE] b"), nc("focus:4"), t("0:30", "[STATE] c"), nc("focus:2"), t("0:40", "[STATE] d"), full("2")];
    expect(droppableNoChangeResRows(lines)).toEqual(new Set([5]));
  });

  it("cc: covered by a same-named [CC ON …] line whose rendered duration spans the row's second", () => {
    const landing = (mmss: string) => t(mmss, "[CC ON TEAM]   3(FMage) ← Polymorph (by 4(BDruid)) | 6s [DR: Incapacitate Full]");
    const covered = [t("0:10", "[STATE] a"), full("2"), landing("0:12"), t("0:15", "[STATE] b"), nc("focus:2  cc:3/Polymorph-3s[incap]")];
    expect(droppableNoChangeResRows(covered)).toEqual(new Set([4]));
    const expired = [t("0:10", "[STATE] a"), full("2"), landing("0:12"), t("0:25", "[STATE] b"), nc("focus:2  cc:3/Polymorph-3s[incap]")];
    expect(classifyNoChangeResRows(expired)).toEqual([{ index: 4, uniqueFacts: ["cc"] }]);
    // A kick lockout has no landing line → its row is never droppable.
    const kick = [t("0:10", "[STATE] a"), full("2"), t("0:15", "[STATE] b"), nc("focus:2  cc:3/Wind Shear-1s[kick]")];
    expect(classifyNoChangeResRows(kick)).toEqual([{ index: 3, uniqueFacts: ["cc"] }]);
  });

  it("enemy: derivable from an earlier same-named [ENEMY CD] line", () => {
    const cd = t("0:05", "[ENEMY CD]   5(DDHunter) (Devourer Demon Hunter): Soul Immolation [1/6]");
    const enemy = "enemy:Soul Immolation/Devourer Demon Hunter(2s left)";
    expect(droppableNoChangeResRows([cd, t("0:10", "[STATE] a"), full("2"), t("0:15", "[STATE] b"), nc(`focus:2  ${enemy}`)])).toEqual(new Set([4]));
    expect(classifyNoChangeResRows([t("0:10", "[STATE] a"), full("2"), t("0:15", "[STATE] b"), nc(`focus:2  ${enemy}`)])).toEqual([{ index: 3, uniqueFacts: ["enemy"] }]);
  });

  it("pruneZeroLossResRows removes exactly the droppable rows and nothing else", () => {
    // Row 3 repeats its left neighbour's focus (droppable); row 5 shows a
    // target neither non-no-change neighbour shows (unique, kept). A row
    // whose focus the NEXT full row shows would be droppable too — the switch
    // is still visible there, one row later.
    const lines = [t("0:10", "[STATE] a"), full("2"), t("0:20", "[STATE] b"), nc("focus:2"), t("0:30", "[STATE] c"), nc("focus:7"), full("5")];
    const out = pruneZeroLossResRows(lines);
    expect(out).toEqual(lines.filter((_, i) => i !== 3));
    // Idempotent: the survivors are all unique-fact rows.
    expect(droppableNoChangeResRows(out).size).toBe(0);
  });
});

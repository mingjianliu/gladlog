/**
 * Pipeline T217: scan5/t217 reads an annotated `[ENEMY BUFF]` line with the
 * `[ENEMY BUFF END]` that follows it.
 */
import { describe, expect, it } from "vitest";

import { outlastsOwnBuff, unpurgedBuffLines } from "../scripts/scan5/t217";

const BEFORE = [
  "2:18  [ENEMY BUFF]   5(DWarlock): Power Infusion (purgeable; unpurged for 15s; no purger without a cooldown had range/line of sight until 2:23 (11s of the buff left); 4 purgeable buffs on it then)",
  "2:18  [ENEMY BUFF END]   5(DWarlock): Power Infusion",
  "2:18  [ENEMY BUFF]   5(DWarlock): Power Infusion (purgeable)",
  "2:33  [ENEMY BUFF END]   4(SPriest): Power Infusion",
  "2:33  [ENEMY BUFF END]   5(DWarlock): Power Infusion",
];
const AFTER = [
  "2:18  [ENEMY BUFF]   5(DWarlock): Power Infusion (purgeable)",
  "2:18  [ENEMY BUFF END]   5(DWarlock): Power Infusion",
  "2:18  [ENEMY BUFF]   5(DWarlock): Power Infusion (purgeable; unpurged for 15s; 4 purgeable buffs on it then)",
  "2:33  [ENEMY BUFF END]   4(SPriest): Power Infusion",
  "2:33  [ENEMY BUFF END]   5(DWarlock): Power Infusion",
];

describe("scan5/t217 — 未驱散窗口不长过所在行自己的增益", () => {
  it("7cadec17 r0 修复前:15 秒窗口挂在 0 秒后就结束的那一行", () => {
    const rows = unpurgedBuffLines(BEFORE);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      unit: "5(DWarlock)",
      spell: "Power Infusion",
      startS: 138,
      unpurgedS: 15,
      endS: 138,
    });
    expect(outlastsOwnBuff(rows[0]!)).toBe(true);
  });

  it("修复后:窗口挂在 2:33 结束的那一行,别的单位的 END 行不算", () => {
    const rows = unpurgedBuffLines(AFTER);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.endS).toBe(153);
    expect(outlastsOwnBuff(rows[0]!)).toBe(false);
  });

  it("取整:14.5 秒的窗口印 15s,END 行晚 14 秒不算违规;没有 END 行不判", () => {
    const [r] = unpurgedBuffLines([
      "0:10  [ENEMY BUFF]   4(X): Power Infusion (purgeable; unpurged for 15s)",
      "0:24  [ENEMY BUFF END]   4(X): Power Infusion",
    ]);
    expect(outlastsOwnBuff(r!)).toBe(false);
    const [open] = unpurgedBuffLines([
      "0:10  [ENEMY BUFF]   4(X): Power Infusion (purgeable; unpurged for 15s)",
    ]);
    expect(open!.endS).toBeUndefined();
    expect(outlastsOwnBuff(open!)).toBe(false);
  });
});

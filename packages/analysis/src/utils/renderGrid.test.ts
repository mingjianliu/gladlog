import { describe, expect, it } from "vitest";

import { resCcRemainingText } from "../context/resLedgerPrune";
import { renderedCcDuration } from "./ccTrinketAnalysis";
import {
  fmtTime,
  fmtWholeSeconds,
  fmtWholeSecondsOrZero,
  parseWholeSeconds,
  toRenderSecond,
  WHOLE_SECONDS_RE_SRC,
} from "./renderGrid";

/**
 * A duration or gap under half a second is not zero. `0s` remained on 713
 * lines of the 605-file capture after FT-T04 / FT-T09 had fixed the control
 * lines: the `next spike in` note of a press line (545), `free 0s of Ns` on
 * `[KILL WINDOW]` / `[VULNERABLE]` (68), `[CC REMOVED]` (59), `[DR CLASH]`
 * (41, on its own tenth-second grid — `drClashGapText`).
 */
describe("fmtWholeSeconds:四舍五入为 0 的时长印 <1s,不印 0s", () => {
  it("不足半秒 → <1s;半秒起按四舍五入的整秒印", () => {
    expect(fmtWholeSeconds(0.3)).toBe("<1s");
    expect(fmtWholeSeconds(0.49)).toBe("<1s");
    expect(fmtWholeSeconds(0)).toBe("<1s");
    expect(fmtWholeSeconds(0.5)).toBe("1s");
    expect(fmtWholeSeconds(1)).toBe("1s");
    expect(fmtWholeSeconds(1.4)).toBe("1s");
    expect(fmtWholeSeconds(12.6)).toBe("13s");
  });

  it("fmtWholeSecondsOrZero:真的为 0 才印 0s,正的零头印 <1s", () => {
    expect(fmtWholeSecondsOrZero(0)).toBe("0s");
    expect(fmtWholeSecondsOrZero(-0.2)).toBe("0s");
    expect(fmtWholeSecondsOrZero(0.3)).toBe("<1s");
    expect(fmtWholeSecondsOrZero(0.5)).toBe("1s");
    expect(fmtWholeSecondsOrZero(7)).toBe("7s");
  });

  it("parseWholeSeconds 读回两个格式化函数印出的每一种写法,别的一律不认", () => {
    for (const s of [0, 0.3, 0.5, 1, 7.4, 120]) {
      expect(parseWholeSeconds(fmtWholeSeconds(s))).toBe(Math.round(s));
      expect(parseWholeSeconds(fmtWholeSecondsOrZero(s))).toBe(Math.round(s));
    }
    const re = new RegExp(`^${WHOLE_SECONDS_RE_SRC}$`);
    for (const text of ["<1s", "0s", "3s", "120s"]) {
      expect(re.test(text)).toBe(true);
      expect(parseWholeSeconds(text)).not.toBeUndefined();
    }
    for (const text of ["0.3s", "<2s", "<1", "3", "~3s", "s", ""]) {
      expect(re.test(text)).toBe(false);
      expect(parseWholeSeconds(text)).toBeUndefined();
    }
  });

  it("控制行与 [RES] cc: 的两个旧格式化函数就是它(同一规则,不是各写一份)", () => {
    for (const s of [0, 0.2, 0.49, 0.5, 0.9, 1, 2.5, 3.49, 6]) {
      expect(renderedCcDuration({ durationSeconds: s })).toBe(
        fmtWholeSeconds(s),
      );
      expect(resCcRemainingText(s)).toBe(fmtWholeSeconds(s));
    }
  });
});

/**
 * Regression guard for the render-grid predicate.
 *
 * Measured on 2026-07-20 (class A, 26/50 matches, 33 occurrences): `[STATE]`
 * sampled on whole seconds while `[DMG SPIKE]` sampled at `pw.fromSeconds`
 * (fractional seconds), yet both rendered into the same displayed second — so
 * two HP numbers under one timestamp contradicted each other (median 7pp, max
 * 25pp).
 *
 * Key lesson: **this is not a sampling-radius problem**. getUnitHpAtTimestamp
 * picks the nearest sample first and only then uses the radius to accept or
 * reject it — changing the radius can only turn the value into null, it never
 * changes the value. The version that "unified the radius" measured
 * 26/50 → 26/50, not a single number moved; aligning the query instants is what
 * took it to 26/50 → 0/50. For any "two places disagree on a number" problem,
 * first ask whether they are querying the same instant.
 */
describe("toRenderSecond:采样网格必须与渲染网格一致", () => {
  it("与 fmtTime 同一取整规则 —— 这是它存在的全部意义", () => {
    for (const t of [0, 0.001, 0.4, 0.999, 1, 27.4, 59.9, 60, 108.6, 3599.99]) {
      expect(fmtTime(t)).toBe(fmtTime(toRenderSecond(t)));
    }
  });

  it("向下取整,不是四舍五入", () => {
    expect(toRenderSecond(27.9)).toBe(27);
    expect(toRenderSecond(27.1)).toBe(27);
    expect(toRenderSecond(27)).toBe(27);
  });

  it("已在网格上的整数秒是不动点(幂等)", () => {
    for (const t of [0, 1, 42, 300]) {
      expect(toRenderSecond(t)).toBe(t);
      expect(toRenderSecond(toRenderSecond(t))).toBe(t);
    }
  });

  it("**核心不变量**:渲染成同一秒的任意两个时刻,采样网格也必须相同", () => {
    // This is exactly the shape of the class-A defect: 27.0 and 27.9 both render
    // as "0:27", but sampling each at its raw value would hit a different
    // advancedAction.
    const pairs: Array<[number, number]> = [
      [27.0, 27.9],
      [108.2, 108.75],
      [59.0, 59.99],
    ];
    for (const [a, b] of pairs) {
      expect(fmtTime(a)).toBe(fmtTime(b));
      expect(toRenderSecond(a)).toBe(toRenderSecond(b));
    }
  });
});

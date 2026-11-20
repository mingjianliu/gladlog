/**
 * Pipeline T164, user ruling R99: a pressed shield the log applied, emptied
 * and removed in one millisecond was up for that instant when its ABSORBED
 * row says so — its span is the instant, and the instant breaks a
 * `defenseless` span without removing time from it.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { ownPressedShieldSpansMs } from "../src/utils/enemyDefensives";
import { subtractIntervals } from "../src/utils/offensiveWindows";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T = 1_000_000;
const PWS = "17";
const absorb = (srcUnitId: string, ms: number, spellId = PWS) => ({
  spellId,
  srcUnitId,
  absorbedAmount: 31_091,
  timestamp: ms,
  logLine: { timestamp: ms },
});
const cast = (ms: number, destUnitId: string, spellId = PWS) => ({
  spellId,
  destUnitId,
  logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: ms },
});
const holder = (absorbsIn: unknown[], casts: unknown[] = []) =>
  ({ id: "target", absorbsIn, spellCastEvents: casts }) as never;
const priest = (casts: unknown[]) =>
  ({ id: "priest", spellCastEvents: casts }) as never;

describe("T164 / R99 — a shield eaten in the millisecond it went up", () => {
  it("队友按的盾:同一毫秒有 ABSORBED 行 → 一个瞬时区间", () => {
    expect(
      ownPressedShieldSpansMs(
        holder([absorb("priest", T)]),
        PWS,
        T,
        T,
        priest([cast(T - 23, "target")]),
      ),
    ).toEqual([{ fromMs: T, toMs: T }]);
  });
  it("日志把光环写在施法行前面 1 毫秒:按键仍在配对容差内,照样算 (codex 85-tk-WIN-T164-4 #2,合成)", () => {
    expect(
      ownPressedShieldSpansMs(
        holder([absorb("priest", T)]),
        PWS,
        T,
        T,
        priest([cast(T + 1, "target")]),
      ),
    ).toEqual([{ fromMs: T, toMs: T }]);
  });
  it("晚于整段光环的按键只在光环先于施法行的时差内算;更晚的按键挂的是自己的盾 (codex 85-tk-WIN-T164-5 #2,合成)", () => {
    // a proc shield 30.0–30.8 s; Prayer of Mending pressed at 30.9 s
    expect(
      ownPressedShieldSpansMs(
        holder([absorb("priest", T + 400)]),
        PWS,
        T,
        T + 800,
        priest([cast(T + 900, "target")]),
      ),
    ).toEqual([]);
    // a one-ms run whose cast row is 151 ms later is not that press's
    expect(
      ownPressedShieldSpansMs(
        holder([absorb("priest", T)]),
        PWS,
        T,
        T,
        priest([cast(T + 151, "target")]),
      ),
    ).toEqual([]);
  });
  it("没有 ABSORBED 行的一毫秒盾不算挂过;吸收行在别的毫秒也不算", () => {
    expect(
      ownPressedShieldSpansMs(
        holder([]),
        PWS,
        T,
        T,
        priest([cast(T - 23, "target")]),
      ),
    ).toEqual([]);
    expect(
      ownPressedShieldSpansMs(
        holder([absorb("priest", T - 5_000)]),
        PWS,
        T,
        T,
        priest([cast(T - 23, "target")]),
      ),
    ).toEqual([]);
  });
  it("没有按键(按在别人身上)的一毫秒盾不算", () => {
    expect(
      ownPressedShieldSpansMs(
        holder([absorb("priest", T)]),
        PWS,
        T,
        T,
        priest([cast(T - 23, "somebody-else")]),
      ),
    ).toEqual([]);
  });
  it("自己的裁决 (1) 盾:一毫秒且有吸收行才算,没有吸收行不算", () => {
    expect(
      ownPressedShieldSpansMs(holder([absorb("target", T)]), PWS, T, T),
    ).toEqual([{ fromMs: T, toMs: T }]);
    expect(ownPressedShieldSpansMs(holder([]), PWS, T, T)).toEqual([]);
  });
  it("对照:有时长的盾读法不变", () => {
    expect(
      ownPressedShieldSpansMs(
        holder([absorb("priest", T + 100)]),
        PWS,
        T,
        T + 300,
        priest([cast(T - 23, "target")]),
      ),
    ).toEqual([{ fromMs: T, toMs: T + 300 }]);
  });
});

describe("subtractIntervals — a point cut", () => {
  const span = [{ from: 34, to: 59 }];
  it("瞬时保护点把窗口切成两段;那一毫秒归后一段,前一段早 1 毫秒收", () => {
    expect(
      subtractIntervals(span, [{ from: 41.723, to: 41.723, point: true }]),
    ).toEqual([
      { from: 34, to: 41.722 },
      { from: 41.723, to: 59 },
    ]);
  });
  it("打掉盾的那一下只落在一段里(窗口两端都含:codex 85-tk-WIN-T164-4 #1,d5c8aca1 的 Mortal Strike 被算了两次)", () => {
    const pieces = subtractIntervals(span, [
      { from: 41.723, to: 41.723, point: true },
    ]);
    const hit = 41.723;
    expect(pieces.filter((w) => hit >= w.from && hit <= w.to)).toEqual([
      { from: 41.723, to: 59 },
    ]);
  });
  it("没标 point 的空区间照旧什么都不切;窗口外或端点上的点也不切", () => {
    expect(subtractIntervals(span, [{ from: 41.723, to: 41.723 }])).toEqual(
      span,
    );
    for (const at of [20, 34, 59, 70])
      expect(
        subtractIntervals(span, [{ from: at, to: at, point: true }]),
        String(at),
      ).toEqual(span);
  });
});

import { describe, expect, it, vi } from "vitest";

// #10 T2 correction: deriveDampeningSeries has a LIVE consumer
// (ReplayView.tsx's "Dampening N%" scrub display on the replay page, via dampeningAt —
// backlog #11). The first version of this fix swapped the internals to
// computeDampeningTimeline's 30s change-point sampling, which is fine for
// its original AI-summary consumer but regressed the replay scrub to
// up-to-29s-stale. Correct fix: build the per-second series directly from
// buildDampeningEvents (raw sorted 110310 dose events, exported, same
// source getDampeningPercentage itself uses) + getInitialDampening (same
// initial-value rule, exported so this file doesn't fork a second copy),
// forward-filled with a single monotonic pointer — event-time-exact AND
// O(events) (build once) + O(seconds) (fill), not O(events × seconds).
const state = vi.hoisted(() => ({ buildCalls: 0, getPctCalls: 0 }));

vi.mock("@gladlog/analysis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@gladlog/analysis")>();
  return {
    ...actual,
    buildDampeningEvents: (
      ...args: Parameters<typeof actual.buildDampeningEvents>
    ) => {
      state.buildCalls++;
      return actual.buildDampeningEvents(...args);
    },
    getDampeningPercentage: (
      ...args: Parameters<typeof actual.getDampeningPercentage>
    ) => {
      state.getPctCalls++;
      return actual.getDampeningPercentage(...args);
    },
  };
});

import {
  dampeningAt,
  deriveDampeningSeries,
} from "../src/renderer/src/report/derive/dampeningSeries";
import type { ReportSource } from "../src/renderer/src/report/derive/types";
import { loadMatchFixture, loadRealMatchFixture } from "./fixtures/loadFixture";

type NativeUnit = { auraEvents: Array<Record<string, unknown>> };

function pushDoseEvent(
  clone: ReturnType<typeof loadRealMatchFixture>,
  timestamp: number,
  stacks: number,
): void {
  const anyUnit = Object.values(clone.units)[0] as unknown as NativeUnit;
  anyUnit.auraEvents.push({
    timestamp,
    eventName: "SPELL_AURA_APPLIED_DOSE",
    spellId: 110310,
    spellName: "Dampening",
    srcId: "src",
    srcName: "src",
    destId: "dst",
    destName: "dst",
    auraType: "DEBUFF",
    params: [...Array(12).fill("0"), String(stacks)], // index 12 = dose stacks
  });
}

describe("deriveDampeningSeries — O(events×seconds) → O(events), event-time exact (#10 T2 correction)", () => {
  it("只建一次事件表(buildDampeningEvents),完全不再逐秒调 getDampeningPercentage", () => {
    const base = loadRealMatchFixture();
    state.buildCalls = 0;
    state.getPctCalls = 0;
    const series = deriveDampeningSeries(base as unknown as ReportSource);
    expect(series.length).toBeGreaterThan(30); // 90s fixture; confirms the logic really ran
    expect(state.buildCalls).toBe(1);
    expect(state.getPctCalls).toBe(0);
  });

  it("精确到秒:t=37s 的 dose 事件必须在 s=37 就反映出来(30s 网格会漏到 s=60 才变,此断言能抓住那个回归)", () => {
    const base = loadRealMatchFixture();
    const clone = JSON.parse(JSON.stringify(base)) as typeof base;
    pushDoseEvent(clone, clone.startTime + 37_000, 42);
    const series = deriveDampeningSeries(clone as unknown as ReportSource);
    const fallback = series[0]!.pct;
    expect(fallback).not.toBe(42);
    expect(series.find((p) => p.tS === 36)!.pct).toBe(fallback);
    expect(series.find((p) => p.tS === 37)!.pct).toBe(42);
    expect(series.find((p) => p.tS === 38)!.pct).toBe(42);
  });

  it("末尾 <1s 余量窗口内的变化也要反映在最后一格(durationS 是 floor 过的整数秒,比赛可能在整秒后还有零头)", () => {
    const base = loadRealMatchFixture();
    const clone = JSON.parse(JSON.stringify(base)) as typeof base;
    // The fixture's startTime→endTime is exactly 90000ms (a whole 90s); add 500ms
    // of slack deliberately to create a window "after the whole-second boundary
    // but before the real endTime".
    clone.endTime = base.endTime + 500;
    const durationS = Math.floor((clone.endTime - clone.startTime) / 1000); // still 90
    expect(durationS).toBe(90);
    // The event lands after 90000ms (the 90-second boundary) and before 90500ms (= endTime)
    pushDoseEvent(clone, clone.startTime + 90_250, 77);
    const series = deriveDampeningSeries(clone as unknown as ReportSource);
    const fallback = series[0]!.pct;
    expect(series.find((p) => p.tS === 89)!.pct).toBe(fallback); // before the boundary, it has not happened yet
    expect(series.find((p) => p.tS === 90)!.pct).toBe(77); // the last bucket queries the exact endTime and catches it
  });
});

describe("deriveDampeningSeries — 2v2 没有开局读数,曲线从第一次日志读数开始(FT-T13 D11)", () => {
  // The fixture is a 3v3 round; relabelled "2v2" it runs under the 2v2 rule:
  // getInitialDampening states no value before the first logged stack.
  const as2v2 = () => {
    const clone = JSON.parse(
      JSON.stringify(loadRealMatchFixture()),
    ) as ReturnType<typeof loadRealMatchFixture>;
    (clone as unknown as { bracket: string }).bracket = "2v2";
    return clone;
  };

  it("第一次读数(0:11,42)之前没有点;之后逐秒连续,数值照日志", () => {
    const clone = as2v2();
    pushDoseEvent(clone, clone.startTime + 11_200, 42);
    pushDoseEvent(clone, clone.startTime + 21_200, 43);
    const series = deriveDampeningSeries(clone as unknown as ReportSource);
    // 11.2 s is first visible on the 0:12 cell (cells sample at whole seconds)
    expect(series[0]).toEqual({ tS: 12, pct: 42 });
    for (let i = 1; i < series.length; i++)
      expect(series[i]!.tS).toBe(series[i - 1]!.tS + 1);
    expect(series.find((p) => p.tS === 21)!.pct).toBe(42);
    expect(series.find((p) => p.tS === 22)!.pct).toBe(43);
    expect(series[series.length - 1]!.tS).toBe(90);
    // the scrub readout: nothing before the first point, the value from it on
    expect(dampeningAt(series, 0)).toBeNull();
    expect(dampeningAt(series, 11.9)).toBeNull();
    expect(dampeningAt(series, 12)).toBe(42);
    expect(dampeningAt(series, 60)).toBe(43);
  });

  it("整局没有任何日志读数 → 空序列(泳道与读数都不画),不再用手表值 30 / 10 垫底", () => {
    const series = deriveDampeningSeries(as2v2() as unknown as ReportSource);
    expect(series).toEqual([]);
    expect(dampeningAt(series, 30)).toBeNull();
  });

  it("3v3 不变:从 0 秒起就有读数(10)", () => {
    const series = deriveDampeningSeries(
      loadRealMatchFixture() as unknown as ReportSource,
    );
    expect(series[0]).toEqual({ tS: 0, pct: 10 });
    expect(dampeningAt(series, 0)).toBe(10);
  });

  it('旧解析存档(层数存成 "42\\r")照样读得到:report-match.json 这场真实 2v2 的泳道从第一次读数开始(WP-H 3)', () => {
    // report-match.json was stored by a parser older than the CRLF fix: its
    // four dose lines carry the stack as "42\r" (at 12.1 / 12.5 / 15.0 /
    // 15.2 s of a 15.5 s round). Unread, this 2v2 round had no dampening
    // point at all; read, its series starts at the first cell at or after
    // the first logged stack (cells sample at whole seconds: 12.1 s → 0:13).
    const m = loadMatchFixture();
    expect((m as unknown as { bracket: string }).bracket).toBe("2v2");
    const stored = Object.values(m.units).flatMap((u) =>
      (u as unknown as NativeUnit).auraEvents.filter(
        (a) =>
          String(a.spellId) === "110310" &&
          a.eventName === "SPELL_AURA_APPLIED_DOSE",
      ),
    );
    expect(stored).toHaveLength(4);
    for (const a of stored) expect((a.params as string[])[12]).toBe("42\r");

    const series = deriveDampeningSeries(m as unknown as ReportSource);
    expect(series).toEqual([
      { tS: 13, pct: 42 },
      { tS: 14, pct: 42 },
      { tS: 15, pct: 42 },
    ]);
    expect(dampeningAt(series, 12.9)).toBeNull();
    expect(dampeningAt(series, 13)).toBe(42);
  });
});

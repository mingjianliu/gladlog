import {
  ensureAnalysisData,
  extractCandidateFindings,
} from "@gladlog/analysis";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { buildAnalysisInput } from "../src/renderer/src/report/derive/analysisInput";
import { deriveBurstLedger } from "../src/renderer/src/report/derive/burstLedger";
import { deriveDeathRecaps } from "../src/renderer/src/report/derive/deathRecap";
import { deriveKeyMoments } from "../src/renderer/src/report/derive/keyMoments";
import { deriveMistakes } from "../src/renderer/src/report/derive/mistakes";
import {
  resetSourceMemoForTest,
  SOURCE_MEMO_MAX,
  sourceMemo,
  sourceMemoWith,
} from "../src/renderer/src/report/derive/sourceMemo";
import { deriveStatsTable } from "../src/renderer/src/report/derive/statsTable";
import type { ReportSource } from "../src/renderer/src/report/derive/types";
import { deriveUncoveredHighlights } from "../src/renderer/src/report/derive/uncoveredHighlights";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

// T80: leaving the matches page and coming back remounts MatchReport, and
// every whole-match derive ran again over a match that had not changed
// (measured 0.55-1.4 s per return on a 1,100-match library). The spy wraps the
// real implementation, so return values are untouched; counting calls is the
// deterministic form of that budget — it does not move with the runner.
vi.mock("@gladlog/analysis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@gladlog/analysis")>();
  return {
    ...actual,
    extractCandidateFindings: vi.fn(actual.extractCandidateFindings),
  };
});
const candidatesSpy = extractCandidateFindings as unknown as ReturnType<
  typeof vi.fn
>;

const src = (): ReportSource => ({}) as unknown as ReportSource;

beforeAll(async () => {
  await ensureAnalysisData();
});

beforeEach(() => {
  resetSourceMemoForTest(true);
  candidatesSpy.mockClear();
});

describe("sourceMemo", () => {
  it("同一 source + key 只算一次,不同 key / 不同 source 各算各的", () => {
    const a = src();
    const b = src();
    const compute = vi.fn(() => ({}));
    const first = sourceMemo(a, "k", compute);
    expect(sourceMemo(a, "k", compute)).toBe(first);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(sourceMemo(a, "other", compute)).not.toBe(first);
    expect(sourceMemo(b, "k", compute)).not.toBe(first);
    expect(compute).toHaveBeenCalledTimes(3);
  });

  it(`只留最近 ${SOURCE_MEMO_MAX} 个 source(与 toLegacySafe 同上限),命中会续命`, () => {
    const [a, b, c] = [src(), src(), src()];
    const compute = vi.fn(() => ({}));
    sourceMemo(a, "k", compute);
    sourceMemo(b, "k", compute);
    sourceMemo(a, "k", compute); // touch a: b is now the oldest
    sourceMemo(c, "k", compute); // evicts b
    expect(compute).toHaveBeenCalledTimes(3);
    sourceMemo(a, "k", compute);
    expect(compute).toHaveBeenCalledTimes(3);
    sourceMemo(b, "k", compute);
    expect(compute).toHaveBeenCalledTimes(4);
  });

  it("分析数据表没载完之前什么都不存(回退值不能被钉住)", () => {
    resetSourceMemoForTest(false);
    const a = src();
    const compute = vi.fn(() => ({}));
    sourceMemo(a, "k", compute);
    sourceMemo(a, "k", compute);
    expect(compute).toHaveBeenCalledTimes(2);
    resetSourceMemoForTest(true);
    sourceMemo(a, "k", compute);
    sourceMemo(a, "k", compute);
    expect(compute).toHaveBeenCalledTimes(3);
  });

  it("缓存住的 undefined / null 也算命中", () => {
    const a = src();
    const compute = vi.fn(() => null);
    expect(sourceMemo(a, "k", compute)).toBeNull();
    expect(sourceMemo(a, "k", compute)).toBeNull();
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("sourceMemoWith:附加输入逐个 Object.is 相同才命中,变了就重算并替换", () => {
    const a = src();
    const streams = {};
    const compute = vi.fn(() => ({}));
    const first = sourceMemoWith(a, "k", [90, "1,2", undefined], compute);
    expect(sourceMemoWith(a, "k", [90, "1,2", undefined], compute)).toBe(first);
    expect(compute).toHaveBeenCalledTimes(1);
    // the raw streams arrived
    const second = sourceMemoWith(a, "k", [90, "1,2", streams], compute);
    expect(second).not.toBe(first);
    expect(sourceMemoWith(a, "k", [90, "1,2", streams], compute)).toBe(second);
    // one slot per key: going back recomputes
    sourceMemoWith(a, "k", [90, "1,2", undefined], compute);
    expect(compute).toHaveBeenCalledTimes(3);
  });
});

describe("整场 derive 跨挂载复用(T80 的确定性预算)", () => {
  const m = loadRealMatchFixture();
  const durationS = (m.endTime - m.startTime) / 1000;
  /** What one mount of the report page plus its AI view asks for. */
  const mountOnce = () => ({
    mistakes: deriveMistakes(m),
    ledger: deriveBurstLedger(m),
    recaps: deriveDeathRecaps(m),
    stats: deriveStatsTable(m, null),
    moments: deriveKeyMoments(m),
    uncovered: deriveUncoveredHighlights(m, durationS, []),
    input: buildAnalysisInput(m, m.id),
  });

  it("第二次挂载不再进分析层:extractCandidateFindings 调用数 N → 0,结果同一引用", () => {
    const first = mountOnce();
    const callsFirst = candidatesSpy.mock.calls.length;
    expect(callsFirst).toBeGreaterThan(0);
    candidatesSpy.mockClear();
    const second = mountOnce();
    expect(candidatesSpy).toHaveBeenCalledTimes(0);
    for (const k of Object.keys(first) as Array<keyof typeof first>)
      expect(second[k]).toBe(first[k]);
  });

  it("缓存结果与不走缓存的结果逐值相等(同一对局的另一个对象)", () => {
    const cached = mountOnce();
    mountOnce();
    resetSourceMemoForTest(false); // nothing stored: every call computes
    const fresh = mountOnce();
    expect(fresh.mistakes).not.toBe(cached.mistakes);
    expect(fresh).toEqual(cached);
  });

  it("带时间范围的调用不进缓存,也不污染整场结果", () => {
    const whole = deriveMistakes(m);
    const ranged = deriveMistakes(m, { fromS: 0, toS: 10 });
    expect(ranged).not.toBe(whole);
    expect(deriveMistakes(m, { fromS: 0, toS: 10 })).not.toBe(ranged);
    expect(deriveMistakes(m)).toBe(whole);
    expect(deriveStatsTable(m, { fromS: 0, toS: 10 })).not.toBe(
      deriveStatsTable(m, null),
    );
  });

  it("换了锚点的滑窗重算,同一组锚点(新数组)命中", () => {
    const a = deriveUncoveredHighlights(m, durationS, [5, 15]);
    expect(deriveUncoveredHighlights(m, durationS, [5, 15])).toBe(a);
    expect(deriveUncoveredHighlights(m, durationS, [5])).not.toBe(a);
  });
});

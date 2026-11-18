import {
  ensureAnalysisData,
  extractCandidateFindings,
} from "@gladlog/analysis";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { buildAnalysisInput } from "../src/renderer/src/report/derive/analysisInput";
import { deriveBurstLedger } from "../src/renderer/src/report/derive/burstLedger";
import { deriveDeathRecaps } from "../src/renderer/src/report/derive/deathRecap";
import { deriveKeyMoments } from "../src/renderer/src/report/derive/keyMoments";
import { toLegacySafe } from "../src/renderer/src/report/derive/legacySource";
import { deriveMistakes } from "../src/renderer/src/report/derive/mistakes";
import {
  beginSourceFill,
  isSourceFilled,
  markSourceFilled,
  resetSourceMemoForTest,
  setSourceMemoReadyForTest,
  SOURCE_MEMO_MAX,
  sourceMemo,
  sourceMemoHas,
  sourceMemoPut,
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

  // pipeline T199: the mark means "every result this fill computed is in the
  // entry", not "every step has run"
  describe("已填完标记只给真的填全的条目", () => {
    it("全程数据表已就绪:填完即标记", () => {
      const a = src();
      beginSourceFill(a);
      sourceMemo(a, "step1", () => 1);
      sourceMemo(a, "step2", () => 2);
      markSourceFilled(a);
      expect(isSourceFilled(a)).toBe(true);
    });

    it("数据表在填到一半时才就绪:前面的步骤没存进去,不标记;下一次填全了才标记", () => {
      resetSourceMemoForTest(false);
      const a = src();
      const step1 = vi.fn(() => 1);
      beginSourceFill(a);
      sourceMemo(a, "step1", step1); // computed, not kept
      setSourceMemoReadyForTest(true);
      sourceMemo(a, "step2", () => 2); // kept: the entry exists now
      markSourceFilled(a);
      expect(isSourceFilled(a)).toBe(false);
      // the next mount fills in steps again; this time everything is kept
      beginSourceFill(a);
      sourceMemo(a, "step1", step1);
      sourceMemo(a, "step2", () => 2);
      markSourceFilled(a);
      expect(isSourceFilled(a)).toBe(true);
      expect(step1).toHaveBeenCalledTimes(2);
      sourceMemo(a, "step1", step1);
      expect(step1).toHaveBeenCalledTimes(2);
    });

    it("同一次填充里先没存、后来又算了一遍并存上的键不挡标记", () => {
      resetSourceMemoForTest(false);
      const a = src();
      beginSourceFill(a);
      sourceMemo(a, "k", () => 1);
      setSourceMemoReadyForTest(true);
      sourceMemo(a, "k", () => 1);
      markSourceFilled(a);
      expect(isSourceFilled(a)).toBe(true);
    });

    // codex 80-PIPE-122 (T199-2): a shuffle read as one document, rounds
    // A -> B -> C visited before the worker answered. The replies are filed
    // with sourceMemoPut, as offThreadDerive does.
    it("填到一半条目被淘汰、又被迟到的结果重建:只有后半段,不标记;下一次填全了才标记", () => {
      const [a, b, c] = [src(), src(), src()];
      const step1 = vi.fn(() => 1);
      beginSourceFill(c);
      sourceMemo(c, "step1", step1); // C's steps 1-2, kept
      sourceMemo(c, "step2", () => 2);
      sourceMemoPut(a, "mistakes", "A's reply"); // late replies of the
      sourceMemoPut(b, "mistakes", "B's reply"); // rounds left: C is evicted
      expect(sourceMemoHas(c, "step1")).toBe(false);
      sourceMemoPut(c, "mistakes", "C's reply"); // starts C's entry again
      sourceMemo(c, "step3", () => 3); // the fill goes on to its end
      markSourceFilled(c);
      // steps 1-2 live in the component's memo only: the entry is not whole
      expect(sourceMemoHas(c, "step1")).toBe(false);
      expect(isSourceFilled(c)).toBe(false);
      // the next visit fills in steps again and leaves everything
      beginSourceFill(c);
      sourceMemo(c, "step1", step1);
      sourceMemo(c, "step2", () => 2);
      sourceMemo(c, "step3", () => 3);
      markSourceFilled(c);
      expect(isSourceFilled(c)).toBe(true);
      expect(step1).toHaveBeenCalledTimes(2);
    });

    it("填充开始之前的淘汰不挡标记(正常的「被挤掉后再回来」)", () => {
      const [a, b, c] = [src(), src(), src()];
      sourceMemo(c, "step1", () => 1);
      sourceMemo(a, "k", () => 1);
      sourceMemo(b, "k", () => 1); // C evicted, no fill running
      beginSourceFill(c);
      sourceMemo(c, "step1", () => 1);
      markSourceFilled(c);
      expect(isSourceFilled(c)).toBe(true);
    });

    it("数据表一直没就绪:没有条目,也没有标记", () => {
      resetSourceMemoForTest(false);
      const a = src();
      beginSourceFill(a);
      sourceMemo(a, "k", () => 1);
      markSourceFilled(a);
      expect(isSourceFilled(a)).toBe(false);
    });
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

  // codex 85-tk-I-T80-1: the two caches each kept their own recency order, so
  // a round served from sourceMemo alone aged out of toLegacySafe's cache
  // while its results still pointed into the evicted copy — three inflated
  // matches alive under a bound of two.
  it("sourceMemo 命中也给 legacy 副本续命:两份缓存留的是同两个 source", () => {
    const [a, b, c] = [{ ...m }, { ...m }, { ...m }];
    const legacyA = toLegacySafe(a);
    sourceMemo(a, "k", () => ({ legacy: legacyA }));
    toLegacySafe(b);
    sourceMemo(a, "k", () => ({ legacy: legacyA })); // a hit: b is the oldest
    toLegacySafe(c); // evicts b, not a
    expect(toLegacySafe(a)).toBe(legacyA);
  });

  it("legacy 副本被淘汰时,sourceMemo 里那个 source 的结果一起丢", () => {
    const [a, b, c] = [{ ...m }, { ...m }, { ...m }];
    const compute = vi.fn(() => ({ legacy: toLegacySafe(a) }));
    sourceMemo(a, "k", compute);
    toLegacySafe(b);
    toLegacySafe(c); // evicts a's copy
    sourceMemo(a, "k", compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("换了锚点的滑窗重算,同一组锚点(新数组)命中", () => {
    const a = deriveUncoveredHighlights(m, durationS, [5, 15]);
    expect(deriveUncoveredHighlights(m, durationS, [5, 15])).toBe(a);
    expect(deriveUncoveredHighlights(m, durationS, [5])).not.toBe(a);
  });
});

import {
  ensureAnalysisData,
  extractCandidateFindings,
} from "@gladlog/analysis";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  deriveMistakes,
  timedAnchorsFromMistakes,
} from "../src/renderer/src/report/derive/mistakes";
import {
  ANCHOR_TOLERANCE_S,
  deriveUncoveredHighlights,
  SWEEP_STRIDE_S,
  SWEEP_WINDOW_S,
} from "../src/renderer/src/report/derive/uncoveredHighlights";
import { loadRealMatchFixtureWithUncoveredWindow } from "./fixtures/loadFixture";

// Review-round fix (performance): extractCandidateFindings walks the whole
// match log (measured ~2.36ms per call), and previously every window's
// buildWindowAnalysisRequest called it again. The spy wraps the real
// implementation (return values are unchanged, so no other test's assertions
// are affected) purely to verify that deriveUncoveredHighlights calls it
// exactly once in the 9-window scenario — a structural regression sentinel that
// does not vary with the window count, which is far more stable than a
// millisecond threshold and holds for matches of any size.
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

const m = loadRealMatchFixtureWithUncoveredWindow();

beforeAll(async () => {
  // Pack-building precondition: spell names in the prompt must not degrade
  // (same contract as analysisInput.test.ts)
  await ensureAnalysisData();
});

beforeEach(() => {
  candidatesSpy.mockClear();
});

// Real-fixture integration: proves we genuinely reuse the #16 gate
// (buildWindowPack) and reimplement no judgement of our own. The precise
// boundary geometry (hits / dedup / merging / ranking truncation) lives in
// uncoveredHighlights.geometry.test.ts, which mocks the signal gate and does
// not depend on the fixture's contents.
describe("deriveUncoveredHighlights —— 真实 fixture 集成", () => {
  it("anchors=[]:9 个滑窗里除 20–40s(门不过)外全部命中,相邻窗全链重叠 → 合并成单一 0–90 高亮", () => {
    const durationS = (m.endTime - m.startTime) / 1000;
    expect(durationS).toBe(90);
    const highlights = deriveUncoveredHighlights(m, durationS, []);
    expect(highlights).toHaveLength(1);
    expect(highlights[0]!.range).toEqual({ fromS: 0, toS: 90 });
    expect(highlights[0]!.itemCount).toBeGreaterThan(0);
    expect(highlights[0]!.summary.length).toBeGreaterThan(0);
  });

  it("去重:真实失误清单的 timed 锚点(与 MatchReport 生产接线一致)—— 幸存的只有 0–30s(其余窗口都被 ±5s 容差内的某条失误覆盖)", () => {
    // timedAnchorsFromMistakes rather than a bare .map(mk => mk.tS): a
    // review-round fix — sentinel tS values from "whole-match observation"
    // classes such as cd-waste must not enter the anchor set (see the red→green
    // case in report.mistakes.test.tsx). On this fixture the result happens to
    // be identical with or without the filter (the 0s sentinel anchor already
    // falls inside the tolerance of the real 24s anchor), but we deliberately
    // use the same criterion production does rather than coincidentally
    // bypassing the fix.
    const anchors = timedAnchorsFromMistakes(deriveMistakes(m));
    // precondition: the fixture really does produce real timed anchors
    expect(anchors.length).toBeGreaterThan(0);
    // cd-waste's own sentinel tS is filtered out by identity (see
    // report.mistakes.test.tsx), not by "0 can never be a legitimate anchor"
    // — signal-expansion batch 1 (2026-08-06) added cc-held, whose window can
    // legitimately start at t=0 (a CC major never used the whole match), and
    // this fixture's owner has exactly that, so 0 now correctly appears here.
    const cdWaste = deriveMistakes(m).find((mk) => mk.type === "cd-waste");
    if (cdWaste) expect(cdWaste.timed).toBe(false);
    const durationS = (m.endTime - m.startTime) / 1000;

    // The "80–90s is the only survivor" premise is derived here rather than
    // merely asserted in the test name (2026-08-17 fix): commit e027c06c gave
    // 145 previously-unknown spells their official dispelType, Prayer of
    // Mending among them, and its four extra missed-purge anchors buried the
    // last window — this test then failed with a bare "expected [] to have
    // length 1", which says nothing about WHICH window moved. Recomputing the
    // per-window coverage from the same three exported constants the sweep
    // itself uses (no literal 20/10/5 anywhere) makes the next such data shift
    // name the offending window instead.
    const coverage: Array<{ window: string; covered: boolean }> = [];
    for (let fromS = 0; fromS < durationS; fromS += SWEEP_STRIDE_S) {
      const toS = Math.min(fromS + SWEEP_WINDOW_S, durationS);
      coverage.push({
        window: `${fromS}-${toS}`,
        covered: anchors.some(
          (a) =>
            a >= fromS - ANCHOR_TOLERANCE_S && a <= toS + ANCHOR_TOLERANCE_S,
        ),
      });
    }
    // GH #96 (2026-09-24, coverage door 30 % → 60 %): the opener's
    // burst-into-mitigation no longer fires on this fixture (its wall covered
    // less than 60 % of the burst), so its anchor is gone and 0–20 / 10–30
    // are uncovered again. Verified: at the old 0.3 door this list was
    // exactly ["80-90"].
    // GH #106 (2026-09-24): the Ret paladin's spec passive takes 60 s off
    // Avenging Wrath (corpus floor exactly 60 s, n = 161), so it is ready
    // during the 85 s Freezing Trap on the enemy healer and a
    // missed-sync-window anchor now covers 80–90.
    expect(coverage.filter((c) => !c.covered).map((c) => c.window)).toEqual([
      "0-20",
      "10-30",
    ]);

    const highlights = deriveUncoveredHighlights(m, durationS, anchors);
    expect(highlights.map((h) => h.range)).toEqual([{ fromS: 0, toS: 30 }]);
  });

  it("零亮点(零噪音):锚点每 10s 密布全场 → 每个滑窗 ±5s 容差内必有锚点,全丢", () => {
    const durationS = (m.endTime - m.startTime) / 1000;
    const denseAnchors = Array.from(
      { length: Math.ceil(durationS / 10) + 1 },
      (_, i) => i * 10,
    );
    expect(deriveUncoveredHighlights(m, durationS, denseAnchors)).toEqual([]);
  });

  it("durationS<=0 → 空数组,不抛(防御)", () => {
    expect(deriveUncoveredHighlights(m, 0, [])).toEqual([]);
    expect(deriveUncoveredHighlights(m, -5, [])).toEqual([]);
  });

  it("性能回归哨兵(复核轮修复,替换脆弱的 ms 阈值):extractCandidateFindings 全场只调用一次,不随滑窗窗口数变化", () => {
    const durationS = (m.endTime - m.startTime) / 1000;
    // 90s at a 10s step = 9 sliding windows (the merge phase makes a second
    // round of buildWindowPack calls, but that step does not re-derive the
    // candidates — it reuses the same set)
    expect(durationS).toBe(90);
    deriveUncoveredHighlights(m, durationS, []);
    expect(candidatesSpy).toHaveBeenCalledTimes(1);
  });
});

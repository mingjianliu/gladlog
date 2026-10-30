import type { PackItem } from "@gladlog/analysis";
import { buildWindowPack } from "@gladlog/analysis";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { deriveUncoveredHighlights } from "../src/renderer/src/report/derive/uncoveredHighlights";

// The exact geometry of hits / dedup boundaries / merging / ranking is verified
// against a MOCKED signal gate — the real gate's hit distribution is a fact
// determined by the fixture's contents, and precise boundary cases are hard to
// stage on a real fixture (90s / 9 windows is too short to lay out several
// independent islands). The mock keeps these geometric assertions independent
// of what the fixture happens to contain (swapping the fixture or tweaking the
// gate must not change pure-geometry assertions). For real-gate coverage see
// the "real fixture integration" describe in uncoveredHighlights.test.ts.
//
// Review-round fix: the mocked target moved down from
// `buildWindowAnalysisRequest` (the wrapper on the click path, which redoes
// toLegacySafe/resolveOwner/extractCandidateFindings on every call) to
// `buildWindowPack` (#16's real signal-gate primitive, which derive calls
// directly after the sliding-window performance fix) — the mocked target must
// follow the implementation, otherwise the mock hangs off nothing and these
// cases test nothing at all (they would pass silently, because
// deriveUncoveredHighlights already fails in place at buildSweepContext and
// returns [] — see the helper mocks for legacySource/analysisInput below).
vi.mock("@gladlog/analysis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@gladlog/analysis")>();
  return { ...actual, buildWindowPack: vi.fn() };
});
// The two steps buildSweepContext depends on (toLegacySafe/resolveOwner) have
// nothing to do with sliding-window geometry, so we give them minimal fake
// implementations that let buildSweepContext obtain a ctx — what is actually
// under test is only the dedup/merge/ranking logic after the gate
// (buildWindowPack).
vi.mock("../src/renderer/src/report/derive/legacySource", () => ({
  toLegacySafe: (source: unknown) => source,
}));
vi.mock("../src/renderer/src/report/derive/analysisInput", () => ({
  resolveOwner: () => ({ id: "owner-1", name: "Owner" }),
}));

const mockGate = buildWindowPack as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockGate.mockReset();
});

function packItem(kind: PackItem["kind"]): PackItem {
  return { key: "p1", kind, t: 0, label: "", unitNames: [], facts: {} };
}

function hitOf(n: number) {
  return () => ({
    pack: { items: Array.from({ length: n }, () => packItem("hp")) },
    kind: "survival" as const,
  });
}

const src = { endTime: 0, startTime: 0 } as never;

describe("deriveUncoveredHighlights —— mock 信号门:几何断言", () => {
  it("命中:门过的窗口原样保留,摘要按 kind 计数中文渲染(出现顺序,不按频次重排)", () => {
    mockGate.mockImplementation(() => ({
      pack: {
        items: [packItem("hp"), packItem("hp"), packItem("defensive")],
      },
      kind: "survival",
    }));
    const highlights = deriveUncoveredHighlights(src, 20, []);
    expect(highlights).toHaveLength(1);
    expect(highlights[0]).toEqual({
      range: { fromS: 0, toS: 20 },
      // The real wording from the single-source PACK_ITEM_KIND_ZH table
      // (@gladlog/analysis), not a second copy maintained here —
      // hp→"HP 轨迹", defensive→"防御施放".
      summary: "2 次HP 轨迹 · 1 次防御施放",
      itemCount: 3,
    });
  });

  it("去重:锚点落在窗口 ±5s 容差内 → 命中窗被丢弃,且门从未被调用(去重先于 gate)", () => {
    mockGate.mockImplementation(hitOf(1));
    // The only sliding window is [0,20]; the anchor at t=24 is inside the
    // tolerance boundary (20+5=25 >= 24).
    const highlights = deriveUncoveredHighlights(src, 20, [24]);
    expect(highlights).toEqual([]);
    expect(mockGate).not.toHaveBeenCalled();
  });

  it("去重容差边界:锚点恰好在 ±5s 边界外 → 不丢", () => {
    mockGate.mockImplementation(hitOf(1));
    // Window [0,20], tolerance boundary [-5,25]; the anchor at 25.1 is just
    // outside it.
    const highlights = deriveUncoveredHighlights(src, 20, [25.1]);
    expect(highlights).toHaveLength(1);
  });

  it("合并:相邻/重叠命中窗取并集边界(链式重叠合并成一整块,不各自独立展示)", () => {
    mockGate.mockImplementation(hitOf(1));
    // A 40s match, 20s windows stepped by 10s → [0,20][10,30][20,40]; all hit
    // and overlap in a chain.
    const highlights = deriveUncoveredHighlights(src, 40, []);
    expect(highlights).toHaveLength(1);
    expect(highlights[0]!.range).toEqual({ fromS: 0, toS: 40 });
  });

  it("合并边界:命中窗间隔了两个门不过的窗口 → 两座独立孤岛(不是并成一整块)", () => {
    // A 60s match, windows at fromS = 0,10,20,30,40. Drop the windows at 10
    // and 20 (they fail the gate) — [0,20] is then an island on its own, and
    // [30,50] ∪ [40,60] merge into a second island {30,60}. Between the two,
    // toS=20 < fromS=30 is strictly non-overlapping (the merge test uses <=,
    // so dropping only one window would leave 20 touching 30 and still count
    // as overlapping; two must be dropped to prove they really split).
    mockGate.mockImplementation((_combat: unknown, fromS: number) =>
      fromS === 10 || fromS === 20 ? null : hitOf(1)(),
    );
    const highlights = deriveUncoveredHighlights(src, 60, []);
    const ranges = highlights
      .map((h) => h.range)
      .sort((a, b) => a.fromS - b.fromS);
    expect(ranges).toEqual([
      { fromS: 0, toS: 20 },
      { fromS: 30, toS: 60 },
    ]);
  });

  it("排名 top3:4 座互不重叠的孤岛只留信号密度最高的 3 座,按 itemCount 降序", () => {
    // A 120s match hitting only at fromS ∈ {0,30,60,90} (30s apart > the 20s
    // window width, so they never overlap and pure ranking/truncation can be
    // tested without merging). itemCount is deliberately out of order relative
    // to fromS, to prove the sort is not "first come, first served".
    const ITEM_COUNT: Record<number, number> = { 0: 4, 30: 1, 60: 3, 90: 2 };
    mockGate.mockImplementation((_combat: unknown, fromS: number) => {
      const n = ITEM_COUNT[fromS];
      return n === undefined ? null : hitOf(n)();
    });
    const highlights = deriveUncoveredHighlights(src, 120, []);
    expect(highlights).toHaveLength(3); // top3 drops fromS=30 (itemCount=1)
    expect(highlights.map((h) => h.itemCount)).toEqual([4, 3, 2]);
    expect(highlights.map((h) => h.range.fromS)).toEqual([0, 60, 90]);
  });

  it("零亮点:全场门都不过 → 空数组", () => {
    mockGate.mockReturnValue(null);
    expect(deriveUncoveredHighlights(src, 90, [])).toEqual([]);
  });

  it("owner 解析失败(resolveOwner 返回 undefined)→ 空数组,门从未被调用", async () => {
    vi.resetModules();
    vi.doMock("../src/renderer/src/report/derive/analysisInput", () => ({
      resolveOwner: () => undefined,
    }));
    const { deriveUncoveredHighlights: deriveWithNoOwner } =
      await import("../src/renderer/src/report/derive/uncoveredHighlights");
    expect(deriveWithNoOwner(src, 20, [])).toEqual([]);
    expect(mockGate).not.toHaveBeenCalled();
  });
});

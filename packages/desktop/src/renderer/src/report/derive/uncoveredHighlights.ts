import {
  buildWindowPack,
  type CandidateEvent,
  extractCandidateFindings,
  PACK_ITEM_KIND_ZH,
  type PackItem,
} from "@gladlog/analysis";

import { resolveOwner } from "./analysisInput";
import { toLegacySafe } from "./legacySource";
import { getRawStreamsSync } from "./rawStreamsCache";
import type { TimeRange } from "./timeRange";
import type { ReportSource } from "./types";

/**
 * BACKLOG #13 wrap-up: automatic sliding window over uncovered highlights. A
 * deterministic sweep across the whole match that reuses #16's existing signal
 * gate (`buildWindowPack` returning non-null = hit) — no gate is reimplemented
 * (single-source predicate; see "gate predicates are the spec" in CLAUDE.md).
 * The sweep itself costs zero model calls: hit detection is entirely existing
 * deterministic predicates, and only clicking the button on the card actually
 * triggers one model call (the caller reuses #16's runWindowAi, which goes
 * through the separate `buildWindowAnalysisRequest`).
 *
 * Performance (review-round fix): the sweep calls `buildWindowPack` directly
 * (#16's real signal-gate primitive) rather than calling the click path's
 * `buildWindowAnalysisRequest` once per window — the latter internally redoes
 * `toLegacySafe` + `resolveOwner` + `extractCandidateFindings` (a whole-match
 * log traversal), and those three steps have nothing to do with "which window
 * we are scanning", so recomputing them per window is pure waste: measured on a
 * 90s fixture with 9 windows, one `extractCandidateFindings` takes ~2.36ms, and
 * longer matches (spec estimate ~17 windows) accumulate that linearly into
 * noticeable synchronous blocking. Here those three steps are hoisted out of
 * the loop and computed once (`buildSweepContext`), and each window only calls
 * `buildWindowPack` with the same candidates — the test asserts that
 * `extractCandidateFindings` is called exactly once regardless of window count
 * (a structural regression sentinel, not a brittle ms threshold).
 */

interface SweepContext {
  legacy: ReturnType<typeof toLegacySafe>;
  ownerName: string;
  candidates: CandidateEvent[];
}

/** Derived state computed once for the whole match (independent of which sweep
 * window we are on). Any failed step (owner cannot be resolved / the legacy
 * conversion throws) is treated as "this match cannot be swept", returning null
 * so the caller produces an empty highlight list — same defensive posture as
 * `buildWindowAnalysisRequest` returning null on error; exceptions never
 * bubble. */
function buildSweepContext(source: ReportSource): SweepContext | null {
  try {
    const legacy = toLegacySafe(source);
    const owner = resolveOwner(legacy);
    if (!owner) return null;
    return {
      legacy,
      ownerName: owner.name,
      // Intent guard (BACKLOG #26 Task 2): pure synchronous read, same as
      // analysisInput.ts — see rawStreamsCache.ts's doc comment for why this
      // never triggers its own fetch.
      candidates: extractCandidateFindings(
        legacy,
        owner.id,
        getRawStreamsSync(source.id),
      ),
    };
  } catch {
    return null;
  }
}

/** Window width (seconds). A product-decided fixed value; v1 is not
 * configurable (spec boundary: no configurable window width/stride). */
export const SWEEP_WINDOW_S = 20;
/** Stride (seconds). */
export const SWEEP_STRIDE_S = 10;
/**
 * De-duplication tolerance (seconds): a window that overlaps an existing anchor
 * (first-round finding time anchors / deterministic mistake-list tS) counts as
 * "already covered". This is this card's own deterministic UI display
 * threshold; it takes no part in the positioningScan/qualityCheck gate
 * recomputation, so it is not the kind of value that must equal an
 * identically-named constant on the eval side in the "shared predicate" sense —
 * but it is still exported from a single source: consumers and tests import it
 * from here, and no one may spell out a literal 5 elsewhere.
 */
export const ANCHOR_TOLERANCE_S = 5;
/** Cap on how many entries are finally displayed (top N by signal density). */
const TOP_N = 3;

export interface UncoveredHighlight {
  range: TimeRange;
  /** zh signal summary, e.g. "2 次 HP 轨迹 · 1 次防御施放" (counts per kind,
   * ordered by first appearance — not re-sorted alphabetically or by
   * frequency, so it matches the time order of items and reads like a
   * timeline; for the kind→Chinese wording table see `PACK_ITEM_KIND_ZH` in
   * `@gladlog/analysis`). */
  summary: string;
  /** Ranking basis: number of pack.items (signal density). */
  itemCount: number;
}

/** kind→Chinese uses the single-source `PACK_ITEM_KIND_ZH` table from
 * `@gladlog/analysis` (review-round fix: this file used to keep its own local
 * copy with different wording, inconsistent with the one
 * `buildWindowAnchorFinding` uses to compose the prompt body). */
function summarizeKinds(items: readonly PackItem[]): string {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const item of items) {
    const label = PACK_ITEM_KIND_ZH[item.kind] ?? item.kind;
    if (!counts.has(label)) order.push(label);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return order.map((label) => `${counts.get(label)} 次${label}`).join(" · ");
}

interface RawHit {
  fromS: number;
  toS: number;
}

/** Merge adjacent/overlapping hit windows (any overlap merges, taking the union
 * bounds). hits must already be sorted by ascending fromS. */
function mergeOverlapping(hits: readonly RawHit[]): RawHit[] {
  const merged: RawHit[] = [];
  for (const hit of hits) {
    const last = merged[merged.length - 1];
    if (last && hit.fromS <= last.toS) {
      last.toS = Math.max(last.toS, hit.toS);
    } else {
      merged.push({ ...hit });
    }
  }
  return merged;
}

/**
 * Automatic sliding window over uncovered highlights: sweep the whole match
 * with a 20s window and a 10s stride through #16's same signal gate; discard
 * windows overlapping an existing anchor (±5s tolerance) so only stretches
 * "existing analysis never touched" remain; merge hit windows (taking union
 * bounds), rank by signal density (pack.items count) descending, take top 3.
 *
 * @param source Report data source.
 * @param durationS Whole-match duration (seconds) — supplied by the caller
 *   (same source as rangeDurationS(source); we do not re-parse
 *   source.startTime/endTime here, to keep the two duration bases from
 *   diverging).
 * @param anchors Existing anchor timestamps (seconds): the first-round
 *   findings' time anchors ∪ the deterministic mistake list's (deriveMistakes)
 *   tS, assembled by the caller — this function only does de-duplication
 *   geometry and does not care where anchors come from (single-source
 *   predicates stay in the caller's assembly; this stays a pure, testable
 *   function).
 */
export function deriveUncoveredHighlights(
  source: ReportSource,
  durationS: number,
  anchors: readonly number[],
): UncoveredHighlight[] {
  if (!(durationS > 0)) return [];
  const ctx = buildSweepContext(source);
  if (!ctx) return [];
  // The same legacy/candidates/ownerName is fed to every window's
  // buildWindowPack — #16's signal-gate primitive, zero reimplementation; we
  // just stop re-deriving those three whole-match values per window.
  const gate = (fromS: number, toS: number) => {
    try {
      return buildWindowPack(
        ctx.legacy,
        fromS,
        toS,
        ctx.candidates,
        ctx.ownerName,
      );
    } catch {
      return null;
    }
  };

  const raw: RawHit[] = [];
  for (let fromS = 0; fromS < durationS; fromS += SWEEP_STRIDE_S) {
    const toS = Math.min(fromS + SWEEP_WINDOW_S, durationS);
    const covered = anchors.some(
      (a) => a >= fromS - ANCHOR_TOLERANCE_S && a <= toS + ANCHOR_TOLERANCE_S,
    );
    if (covered) continue;
    if (!gate(fromS, toS)) continue;
    raw.push({ fromS, toS });
  }
  const merged = mergeOverlapping(raw);
  const ranked = merged
    .map((m): UncoveredHighlight | null => {
      // Rebuild the pack after merging: the summary/counts are computed over
      // the merged window, not by summing the sub-windows' counts (sub-window
      // evidence overlaps, so adding them would double-count). In theory
      // widening a window cannot flip the gate from pass to fail (items only
      // grow), so the null branch here is defense in depth, not an expected
      // path. Window bounds come straight from the merged m.fromS/toS
      // (produced by this function's for loop, so naturally within
      // [0, durationS] — no second clamp needed).
      const r = gate(m.fromS, m.toS);
      if (!r) return null;
      return {
        range: { fromS: m.fromS, toS: m.toS },
        summary: summarizeKinds(r.pack.items),
        itemCount: r.pack.items.length,
      };
    })
    .filter((h): h is UncoveredHighlight => h !== null)
    .sort((a, b) => b.itemCount - a.itemCount);
  return ranked.slice(0, TOP_N);
}

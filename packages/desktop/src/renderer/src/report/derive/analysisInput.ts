import {
  buildDeepDivePack,
  buildMatchContext,
  buildWindowPack,
  DEEP_DIVE_MAX,
  type DeepDivePack,
  extractCandidateFindings,
  type Finding,
  hasCoachableSignal,
  isHealerSpec,
  type RawStreams,
  SEVERITY_RANK,
  specToString,
} from "@gladlog/analysis";
import { CombatUnitReaction, type ICombatUnit } from "@gladlog/parser-compat";

import { idMemo } from "./idMemo";
import { toLegacySafe } from "./legacySource";
import { getRawStreamsSync } from "./rawStreamsCache";
import { sourceMemoWith } from "./sourceMemo";
import type { ReportSource } from "./types";

/**
 * owner = the log recorder (playerId); falls back to the friendly healer when
 * not found (legacy behaviour).
 * Lifted into its own export so buildAnalysisInput and
 * buildWindowAnalysisRequest (#16) share it; moved verbatim (zero behaviour
 * change — the existing analysisInput.test.ts must stay green).
 */
export function resolveOwner(legacy: {
  units: Record<string, ICombatUnit>;
  playerId?: string;
}): ICombatUnit | undefined {
  const players = Object.values(legacy.units).filter((u) => u.info);
  return (
    players.find(
      (u) =>
        u.id === legacy.playerId && u.reaction === CombatUnitReaction.Friendly,
    ) ??
    players.find(
      (u) => isHealerSpec(u.spec) && u.reaction === CombatUnitReaction.Friendly,
    )
  );
}

export type AnalysisRunInput = {
  matchId: string;
  candidates: ReturnType<typeof extractCandidateFindings>;
  richContext: string;
  spec: string;
  ownerName: string;
  enemySpecs: number[];
  /** Spec ids of every player on both teams — auditFindings' roster lint
   * (a finding naming a class nobody plays is dropped). */
  rosterSpecs: string[];
};

/**
 * Input construction for single-match analysis — the one entry point shared by
 * StructuredAnalysisPanel and the batch driver (single-source predicate: owner
 * resolution, candidates and richContext must not diverge between the two
 * consumers).
 *
 * Precondition: await ensureAnalysisData() before calling (prompt spell names
 * must never degrade; see analysis's data/ensure.ts). The panel gates on
 * dataReady; the batch driver awaits it once before starting.
 */
export function buildAnalysisInput(
  source: ReportSource,
  matchId: string,
): AnalysisRunInput | null {
  // Kept across mounts (sourceMemo.ts): the AI view rebuilt the whole prompt
  // input on every entry. Nothing is stored before the analysis tables are
  // loaded, and an entry built against other raw streams (or none yet) is
  // rebuilt, so what a run sends is what an uncached call would build.
  const rawStreams = getRawStreamsSync(source.id);
  const inputs = analysisInputKey(matchId, rawStreams);
  // per object (sourceMemo), and per match across re-opens (idMemo; the raw
  // streams are cached per source id, so a re-open hands back the same
  // object and the slot still matches)
  return sourceMemoWith(source, "buildAnalysisInput", inputs, () =>
    idMemo(source, "buildAnalysisInput", inputs, () =>
      buildAnalysisInputWith(source, matchId, rawStreams),
    ),
  );
}

/** The sourceMemoWith inputs of buildAnalysisInput's slot: what an entry was
 * built against. Shared with offThreadDerive.ts, which files a result built
 * off the main thread under the same slot. */
export function analysisInputKey(
  matchId: string,
  rawStreams: RawStreams | undefined,
): readonly unknown[] {
  return [matchId, rawStreams];
}

/**
 * buildAnalysisInput's computation with the raw streams passed in instead of
 * read from the page's cache — the one body both the page and the off-thread
 * derive worker run (offThreadDerive.ts), so the two cannot diverge. The
 * page passes `getRawStreamsSync(source.id)`.
 */
export function buildAnalysisInputWith(
  source: ReportSource,
  matchId: string,
  rawStreams: RawStreams | undefined,
): AnalysisRunInput | null {
  try {
    const legacy = toLegacySafe(source);
    const owner = resolveOwner(legacy);
    if (!owner) return null;

    const players = Object.values(legacy.units).filter((u) => u.info);
    // Intent guard (BACKLOG #26 Task 2): the caller's raw streams come from
    // a pure, synchronous cache read that never triggers its own fetch (see
    // rawStreamsCache.ts's doc comment for why: this function doesn't know
    // the correct on-disk storage id for a shuffle round 2-6, only
    // `MatchReport.tsx`/`batchAnalysis.ts` do). A cold cache degrades to
    // `undefined`, which `extractCandidateFindings` already treats as "no
    // guard" (silent, Global Constraint).
    const candidates = extractCandidateFindings(legacy, owner.id, rawStreams);
    const friends = players.filter((u) => u.reaction === owner.reaction);
    const enemies = players.filter((u) => u.reaction !== owner.reaction);

    // Same raw pass: the [MANA] lines fall back to it on documents stored
    // without power samples (reliability audit D2).
    const richContext = buildMatchContext(legacy, friends, enemies, {
      owner,
      rawStreams,
    });
    const spec = specToString(owner.spec);

    return {
      matchId,
      candidates,
      richContext,
      spec,
      ownerName: owner.name,
      enemySpecs: enemies.map((u) => Number(u.spec)).filter((s) => s > 0),
      rosterSpecs: players.map((u) => String(u.spec)),
    };
  } catch {
    return null;
  }
}

/**
 * Evidence-pack construction for the deep-dive round (first-round findings →
 * ≤DEEP_DIVE_MAX survival seats); also the
 * shared path for the panel's deep-dive effect and the batch driver. Returns an
 * empty array when pack construction fails (a failed deep dive is not fatal —
 * the first round stands).
 */
export function buildDeepenPacks(
  source: ReportSource,
  findings: Finding[],
  candidates: AnalysisRunInput["candidates"],
  ownerName?: string,
): DeepDivePack[] {
  try {
    const legacy = toLegacySafe(source);
    const ranked = findings
      .map((f, i) => ({ f, i }))
      .sort(
        (a, b) =>
          (SEVERITY_RANK[a.f.severity] ?? 9) -
            (SEVERITY_RANK[b.f.severity] ?? 9) || a.i - b.i,
      );
    // Survival seats: take up to DEEP_DIVE_MAX death-class packs that pass the
    // gate, in severity order. (Findings no longer get an offensive seat: the
    // four candidate types that routed there are deleted; the offensive pack
    // survives only in window mode, buildWindowPack.)
    const survivalPacks: DeepDivePack[] = [];
    for (const { f, i } of ranked) {
      if (survivalPacks.length >= DEEP_DIVE_MAX) break;
      const pack = buildDeepDivePack(legacy, f, i, candidates, ownerName);
      // Coachable-signal gate: do not deep-dive a clean window, which would
      // only produce boilerplate
      if (pack && hasCoachableSignal(pack.items)) survivalPacks.push(pack);
    }
    return survivalPacks;
  } catch {
    return [];
  }
}

/** Window-analysis request (#16): pack construction and gating both happen in
 * the renderer; returns null when the gate fails (no IPC is sent).
 * Precondition: await ensureAnalysisData() before calling (prompt spell names
 * must never degrade). */
export function buildWindowAnalysisRequest(
  source: ReportSource,
  fromS: number,
  toS: number,
): {
  pack: DeepDivePack;
  kind: "survival" | "offensive";
  spec: string;
  ownerName: string;
  /** The clamped window bounds (see clampedFromS/clampedToS below) — both the
   * IPC payload sent to main and the result card's title must use these
   * clamped values, never the raw fromS/toS the caller passed in (measure
   * divergence: the pack is built from the clamped window, so a card or request
   * still reporting the raw values would not match its own content). */
  fromS: number;
  toS: number;
} | null {
  try {
    const legacy = toLegacySafe(source);
    const owner = resolveOwner(legacy);
    if (!owner) return null;
    // Clamp the window to [0, match duration]: inWinIds filters on the raw
    // values, so an out-of-range window would pull in out-of-bounds candidates
    // (left over from Task 1; a TimeRangeBar drag is naturally in range, so the
    // clamp is defensive).
    const durationS = (source.endTime - source.startTime) / 1000;
    const clampedFromS = Math.max(0, Math.min(fromS, durationS));
    const clampedToS = Math.max(0, Math.min(toS, durationS));
    // Intent guard (BACKLOG #26 Task 2): same pure synchronous read as
    // buildAnalysisInput above — see rawStreamsCache.ts's doc comment.
    const candidates = extractCandidateFindings(
      legacy,
      owner.id,
      getRawStreamsSync(source.id),
    );
    const r = buildWindowPack(
      legacy,
      clampedFromS,
      clampedToS,
      candidates,
      owner.name,
    );
    if (!r) return null;
    return {
      pack: r.pack,
      kind: r.kind,
      spec: specToString(owner.spec),
      ownerName: owner.name,
      fromS: clampedFromS,
      toS: clampedToS,
    };
  } catch {
    return null;
  }
}

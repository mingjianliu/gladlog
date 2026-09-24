import { analyzeCcBreaks, type ICcBreakEvent } from "@gladlog/analysis";
import { CombatUnitReaction } from "@gladlog/parser-compat";

import { toLegacySafe } from "./legacySource";
import { displaySpellName } from "./spellDisplay";
import { tInRange, type TimeRange } from "./timeRange";
import type { ReportSource } from "./types";
import { shortUnitName } from "./teamSide";

/** A single CC-break instance; tS = relative seconds. */
export interface CcBreakRow {
  tS: number;
  label: string;
  /** The unit the ▶ jump centers the camera on (breaker / CC'd unit). */
  unitName: string;
}

export interface CcBreakDash {
  /** Self-inflicted breaks (teachable): our own damage broke CC on an enemy
   * with ≥2s remaining. */
  friendly: CcBreakRow[];
  /** Enemy mistakes (positive signal): enemy damage broke the CC they had put
   * on our side. */
  enemy: CcBreakRow[];
  /** Count of root breaks, kept as a separate footnote so it isn't mixed in
   * with hard CC. */
  rootBreakCount: number;
}

const EMPTY: CcBreakDash = { friendly: [], enemy: [], rootBreakCount: 0 };

const fmtName = (id: string, fallback: string): string =>
  id ? displaySpellName(id, fallback) : "近战";

const remainTag = (e: ICcBreakEvent): string =>
  e.remainingSeconds !== null ? `(剩 ${e.remainingSeconds.toFixed(1)}s)` : "";

/**
 * CC-break statistics (2026-08-02 user request): every judgment is consumed
 * from analysis's analyzeCcBreaks (log ground truth
 * SPELL_AURA_BROKEN_SPELL); the render layer only does the wording.
 * Corpus baseline: 6.14 per combat, 48.2% self-inflicted vs 46.6% enemy
 * mistakes.
 */
export function deriveCcBreakDash(
  source: ReportSource,
  range?: TimeRange | null,
): CcBreakDash {
  try {
    const legacy = toLegacySafe(source);
    const players = Object.values(legacy.units).filter((u) => u.info);
    const friends = players.filter(
      (u) => u.reaction === CombatUnitReaction.Friendly,
    );
    const enemies = players.filter(
      (u) => u.reaction === CombatUnitReaction.Hostile,
    );
    if (friends.length === 0 || enemies.length === 0) return EMPTY;

    // Pet breaks are attributed to the owner (same pets parameter as B45)
    const petsOf = (owners: typeof players) => {
      const ids = new Set(owners.map((o) => o.id));
      return Object.values(legacy.units).filter(
        (u) => u.ownerId && ids.has(u.ownerId),
      );
    };
    const stats = analyzeCcBreaks(
      friends,
      enemies,
      { startTime: legacy.startTime, endTime: legacy.endTime },
      petsOf(friends),
      petsOf(enemies),
    );

    const friendly: CcBreakRow[] = stats.friendlySquander
      .filter((e) => tInRange(e.atSeconds, range))
      .map((e) => ({
        tS: e.atSeconds,
        label: `${shortUnitName(e.breakerName)} 的 ${fmtName(e.breakSpellId, e.breakSpellName)} 打破了 ${shortUnitName(e.casterName)} 给 ${shortUnitName(e.holderName)} 上的 ${fmtName(e.ccSpellId, e.ccSpellName)}${remainTag(e)}`,
        unitName: e.breakerName,
      }));

    const enemy: CcBreakRow[] = stats.enemySquander
      .filter((e) => tInRange(e.atSeconds, range))
      .map((e) => ({
        tS: e.atSeconds,
        label: `敌方 ${shortUnitName(e.breakerName)} 的 ${fmtName(e.breakSpellId, e.breakSpellName)} 提前打破了 ${shortUnitName(e.holderName)} 身上的 ${fmtName(e.ccSpellId, e.ccSpellName)}${remainTag(e)}`,
        unitName: e.holderName,
      }));

    return { friendly, enemy, rootBreakCount: stats.rootBreakCount };
  } catch {
    return EMPTY;
  }
}

import { analyzeCcBreaks, type ICcBreakEvent } from "@gladlog/analysis";
import { CombatUnitReaction } from "@gladlog/parser-compat";

import { type Language, translate } from "../../../../shared/i18n";
import { toLegacySafe } from "./legacySource";
import { langMemoKey, sourceMemo } from "./sourceMemo";
import { displaySpellName } from "./spellDisplay";
import { shortUnitName } from "./teamSide";
import { type TimeRange, tInRange } from "./timeRange";
import type { ReportSource } from "./types";

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

const fmtName = (id: string, fallback: string, lang: Language): string =>
  id ? displaySpellName(id, fallback) : translate(lang, "report.spell.melee");

const remainTag = (e: ICcBreakEvent, lang: Language): string =>
  e.remainingSeconds !== null
    ? translate(lang, "report.ccBreak.remaining", {
        s: e.remainingSeconds.toFixed(1),
      })
    : "";

/**
 * CC-break statistics (2026-08-02 user request): every judgment is consumed
 * from analysis's analyzeCcBreaks (log ground truth
 * SPELL_AURA_BROKEN_SPELL); the render layer only does the wording.
 * Corpus baseline: 6.14 per combat, 48.2% self-inflicted vs 46.6% enemy
 * mistakes.
 */
function deriveCcBreakDashUncached(
  source: ReportSource,
  range: TimeRange | null | undefined,
  lang: Language,
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
      {
        startTime: legacy.startTime,
        endTime: legacy.endTime,
        startInfo: legacy.startInfo,
      },
      petsOf(friends),
      petsOf(enemies),
    );

    const friendly: CcBreakRow[] = stats.friendlySquander
      .filter((e) => tInRange(e.atSeconds, range))
      .map((e) => ({
        tS: e.atSeconds,
        label: translate(lang, "report.ccBreak.friendly", {
          breaker: shortUnitName(e.breakerName),
          breakSpell: fmtName(e.breakSpellId, e.breakSpellName, lang),
          caster: shortUnitName(e.casterName),
          holder: shortUnitName(e.holderName),
          ccSpell: fmtName(e.ccSpellId, e.ccSpellName, lang),
          remain: remainTag(e, lang),
        }),
        unitName: e.breakerName,
      }));

    const enemy: CcBreakRow[] = stats.enemySquander
      .filter((e) => tInRange(e.atSeconds, range))
      .map((e) => ({
        tS: e.atSeconds,
        label: translate(lang, "report.ccBreak.enemy", {
          breaker: shortUnitName(e.breakerName),
          breakSpell: fmtName(e.breakSpellId, e.breakSpellName, lang),
          holder: shortUnitName(e.holderName),
          ccSpell: fmtName(e.ccSpellId, e.ccSpellName, lang),
          remain: remainTag(e, lang),
        }),
        unitName: e.holderName,
      }));

    return { friendly, enemy, rootBreakCount: stats.rootBreakCount };
  } catch {
    return EMPTY;
  }
}

/** deriveCcBreakDashUncached; the whole-match call (no range) is kept per source object
 * across mounts (see sourceMemo.ts). */
export function deriveCcBreakDash(
  source: ReportSource,
  range?: TimeRange | null,
  lang: Language = "zh",
): ReturnType<typeof deriveCcBreakDashUncached> {
  if (range != null) return deriveCcBreakDashUncached(source, range, lang);
  return sourceMemo(source, langMemoKey("deriveCcBreakDash", lang), () =>
    deriveCcBreakDashUncached(source, range, lang),
  );
}

/**
 * coverageManifest.ts
 *
 * Ground-truth coverage manifest for a parsed combat, computed ONLY from raw
 * parser event arrays plus static spell tables (spellTags). It must never call
 * the prompt-building/analysis utilities (buildMatchContext, criticalMoments,
 * reconstructEnemyCDTimeline, …): the manifest exists to check the prompt
 * builder's output from the outside, and sharing code with the builder would
 * make the check circular — a builder bug that drops events would silently
 * drop them from the manifest too.
 *
 * Consumed by promptQualityCheck.ts (deterministic sufficiency check) and
 * written per-match by buildHealerPromptCorpus.ts as manifests/NNN.json.
 */

import { CombatUnitReaction, CombatUnitType, ICombatUnit } from '@gladlog/parser-compat';
import type { IArenaMatch, IShuffleRound } from '@gladlog/parser-compat';

import { ccSpellIds, trinketSpellIds, specToString, getEnglishSpellName } from '@gladlog/analysis';

export type ParsedCombat = IArenaMatch | IShuffleRound;

export interface ManifestEvent {
  /** Seconds relative to combat start, rounded to 1 decimal. */
  tRelSec: number;
  srcUnitName: string;
  destUnitName: string;
  spellId: string | null;
  /** Spell name as logged — localized to the log's client language (may be Chinese, German, …). */
  spellName: string | null;
  /** Canonical English name derived from the spellId; what EN-rendered prompts print. */
  spellNameEn: string | null;
}

export interface ManifestDeath {
  tRelSec: number;
  unitName: string;
  reaction: 'friendly' | 'hostile';
}

export interface CoverageManifest {
  matchId: string;
  durationSec: number;
  players: { name: string; spec: string; reaction: 'friendly' | 'hostile' }[];
  /** UNIT_DIED records for player units (excludes feign-style conscious deaths). */
  deaths: ManifestDeath[];
  /** SPELL_AURA_APPLIED of CC-typed spells (spellTags ccSpellIds) landing on player units. */
  ccApplied: ManifestEvent[];
  /** SPELL_INTERRUPT events between player units. */
  interrupts: ManifestEvent[];
  /** SPELL_DISPEL events between player units. */
  dispels: ManifestEvent[];
  /** PvP-trinket spell casts (spellTags trinketSpellIds). */
  trinketCasts: ManifestEvent[];
  counts: {
    deaths: number;
    friendlyDeaths: number;
    ccApplied: number;
    interrupts: number;
    dispels: number;
    trinketCasts: number;
  };
}

const TRINKET_SPELL_ID_SET = new Set<string>(trinketSpellIds);

function playerUnits(combat: ParsedCombat): ICombatUnit[] {
  return (Object.values(combat.units) as ICombatUnit[]).filter(
    (u) =>
      u.type === CombatUnitType.Player &&
      (u.reaction === CombatUnitReaction.Friendly || u.reaction === CombatUnitReaction.Hostile),
  );
}

function reactionLabel(u: ICombatUnit): 'friendly' | 'hostile' {
  return u.reaction === CombatUnitReaction.Friendly ? 'friendly' : 'hostile';
}

export function buildCoverageManifest(combat: ParsedCombat, matchId: string): CoverageManifest {
  const startTime = combat.startTime;
  const rel = (timestamp: number) => Math.round(((timestamp - startTime) / 1000) * 10) / 10;
  const players = playerUnits(combat);
  const playerNames = new Set(players.map((p) => p.name));

  const deaths: ManifestDeath[] = [];
  const ccApplied: ManifestEvent[] = [];
  const interrupts: ManifestEvent[] = [];
  const dispels: ManifestEvent[] = [];
  const trinketCasts: ManifestEvent[] = [];

  // T5 分母卫生:位移/变形被动破根(druid 变形、Disengage/Posthaste、Phantasm 等)
  // 在日志里也发 SPELL_DISPEL,但不是"驱散决策"——不该进覆盖率分母。
  // Blessing of Sacrifice / Incarnation 的 SPELL_DISPEL 亦为形态切换/转移副作用。
  const MOVEMENT_ROOT_BREAK_DISPEL_IDS = new Set([
    "5487", // Bear Form
    "768", // Cat Form
    "165961", // Travel Form
    "781", // Disengage (Posthaste)
    "114239", // Phantasm
    "378076", // Thunderous Paws
    "409293", // Burrow
    "462820", // Jet Stream
    "159535", // Ride the Wind
    "365080", // Windwalking
    "6940", // Blessing of Sacrifice
    "33891", // Incarnation: Tree of Life
  ]);

  // De-dup: the same action can appear on both src's actionOut and dest's actionIn.
  const seen = new Set<string>();
  const pushUnique = (
    list: ManifestEvent[],
    a: {
      timestamp: number;
      srcUnitName: string;
      destUnitName: string;
      spellId: string | null;
      spellName: string | null;
    },
  ) => {
    const key = `${a.timestamp}|${a.srcUnitName}|${a.destUnitName}|${a.spellId}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push({
      tRelSec: rel(a.timestamp),
      srcUnitName: a.srcUnitName,
      destUnitName: a.destUnitName,
      spellId: a.spellId,
      spellName: a.spellName,
      spellNameEn: a.spellId ? getEnglishSpellName(a.spellId) || null : null,
    });
  };

  for (const unit of players) {
    for (const record of unit.deathRecords) {
      deaths.push({ tRelSec: rel(record.timestamp), unitName: unit.name, reaction: reactionLabel(unit) });
    }

    for (const aura of unit.auraEvents) {
      if (aura.logLine.event !== 'SPELL_AURA_APPLIED') continue;
      if (!aura.spellId || !ccSpellIds.has(aura.spellId)) continue;
      if (!playerNames.has(aura.destUnitName)) continue;
      pushUnique(ccApplied, aura);
    }

    for (const action of [...unit.actionOut, ...unit.actionIn]) {
      const event = action.logLine.event;
      if (event === 'SPELL_INTERRUPT') {
        pushUnique(interrupts, action);
      } else if (event === 'SPELL_DISPEL') {
        if (action.spellId && MOVEMENT_ROOT_BREAK_DISPEL_IDS.has(action.spellId)) continue;
        pushUnique(dispels, action);
      }
    }

    for (const cast of unit.spellCastEvents) {
      if (cast.logLine.event !== 'SPELL_CAST_SUCCESS') continue;
      if (!cast.spellId || !TRINKET_SPELL_ID_SET.has(cast.spellId)) continue;
      pushUnique(trinketCasts, cast);
    }
  }

  const byTime = <T extends { tRelSec: number }>(list: T[]) => list.sort((a, b) => a.tRelSec - b.tRelSec);

  return {
    matchId,
    durationSec: Math.round((combat.endTime - combat.startTime) / 1000),
    players: players.map((p) => ({ name: p.name, spec: specToString(p.spec), reaction: reactionLabel(p) })),
    deaths: byTime(deaths),
    ccApplied: byTime(ccApplied),
    interrupts: byTime(interrupts),
    dispels: byTime(dispels),
    trinketCasts: byTime(trinketCasts),
    counts: {
      deaths: deaths.length,
      friendlyDeaths: deaths.filter((d) => d.reaction === 'friendly').length,
      ccApplied: ccApplied.length,
      interrupts: interrupts.length,
      dispels: dispels.length,
      trinketCasts: trinketCasts.length,
    },
  };
}

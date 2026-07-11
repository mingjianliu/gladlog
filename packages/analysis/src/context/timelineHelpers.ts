import {
  CombatUnitReaction,
  CombatUnitType,
  getUnitReaction,
  getUnitType,
  ICombatUnit,
  LogEvent,
} from '@gladlog/parser-compat';

import { getEnglishSpellName, spellEffectData } from '../data/spellEffectData';
import { IPlayerCCTrinketSummary } from '../utils/ccTrinketAnalysis';
import {
  fmtTime,
  IMajorCooldownInfo,
  isHealerSpec,
  PASSIVE_SPELL_BLOCKLIST,
  specToString,
} from '../utils/cooldowns';
import { getDampeningPercentage } from '../utils/dampening';
import { IEnemyCDTimeline } from '../utils/enemyCDs';
import { getHpPercentAtTime } from '../utils/killWindowTargetSelection';
import { getSpellSchoolName } from '../utils/spellSchools';

export { PASSIVE_SPELL_BLOCKLIST };

// ── Shared helpers ─────────────────────────────────────────────────────────

/** Returns the last cast at or before `timeSeconds`, or undefined if none. */
export function lastCastBefore(cd: IMajorCooldownInfo, timeSeconds: number) {
  return cd.casts.filter((c) => c.timeSeconds <= timeSeconds).slice(-1)[0];
}

export function getNpcIdFromGuid(guid: string): string | null {
  if (!guid) return null;
  const parts = guid.split('-');
  if (
    parts.length >= 6 &&
    (guid.startsWith('Creature') ||
      guid.startsWith('Vehicle') ||
      guid.startsWith('Pet') ||
      guid.startsWith('GameObject'))
  ) {
    return parts[5];
  }
  return null;
}

export const GROUNDING_TOTEM_NPC_ID = '5925';

export const CRITICAL_NON_PLAYER_NPC_IDS = new Set<string>([
  // Shaman Totems
  '3527', // Healing Stream Totem
  '59764', // Healing Tide Totem
  '100943', // Earthen Wall Totem
  '53006', // Spirit Link Totem
  GROUNDING_TOTEM_NPC_ID, // Grounding Totem
  '5913', // Tremor Totem
  '105427', // Totem of Wrath / Skyfury Totem
  '10467', // Mana Tide Totem
  '61245', // Capacitor Totem
  '60561', // Earthgrab Totem
  '179867', // Static Field Totem
  '225409', // Surging Totem
  '108270', // Stone Bulwark Totem
  // Priest
  '62982', // Mindbender
  '19668', // Shadowfiend
  '121111', // Psyfiend
  '224466', // Voidwraith
  '189820', // Lightwell
  '198236', // Divine Image
  // Monk
  '63508', // Xuen
  // Warlock
  '103673', // Darkglare
  '135002', // Demonic Tyrant
  '179193', // Fel Obelisk
  '107024', // Fel Lord
  '196111', // Pit Lord
  '89', // Infernal
  // Death Knight
  '27829', // Gargoyle
]);

export function isCriticalNonPlayerUnit(unit: ICombatUnit): boolean {
  const npcId = getNpcIdFromGuid(unit.id);
  if (npcId && CRITICAL_NON_PLAYER_NPC_IDS.has(npcId)) return true;
  return false;
}

// ── Critical moment identification helpers ─────────────────────────────────

/**
 * Healer spell IDs that should appear as [YOU] [CAST] gap-fillers when they are NOT
 * already tracked by ownerCDs (to avoid double-counting).  Keep in sync with
 * classMetadata.ts as new specs / abilities ship.
 *
 * Sources: Wowhead / WoW API — verified against Patch 11.x spell IDs.
 */
export const HEALER_CAST_SPELL_ID_TO_NAME: Record<string, string> = {
  // ── Priest ─────────────────────────────────────────────────────────────────
  '10060': 'Power Infusion', // Holy/Disc — external DPS CD
  '33206': 'Pain Suppression', // Disc — defensive external
  '265202': 'Holy Word: Salvation', // Holy — raid/party heal CD
  '200183': 'Apotheosis', // Holy — healing amplifier
  '47788': 'Guardian Spirit', // Holy — prevent-death external
  // ── Shaman ─────────────────────────────────────────────────────────────────
  '108280': 'Healing Tide Totem', // Resto — party heal CD
  '98008': 'Spirit Link Totem', // Resto — damage redistribution
  '114052': 'Ascendance', // Resto — healing burst CD
  // ── Druid ──────────────────────────────────────────────────────────────────
  '29166': 'Innervate', // Resto — mana external / self
  '740': 'Tranquility', // Resto — AoE heal channel
  // ── Monk ───────────────────────────────────────────────────────────────────
  '116849': 'Life Cocoon', // Mistweaver — absorb external
  '115310': 'Revival', // Mistweaver — group dispel + heal
  // ── Paladin ────────────────────────────────────────────────────────────────
  '31884': 'Avenging Wrath', // Holy — healing/damage amp
  '216331': 'Avenging Crusader', // Holy alt-talent
  '114165': 'Holy Prism', // not a CD but a high-value cast tracked in some builds
  '6940': 'Blessing of Sacrifice', // Holy — damage redirect external
  '316011': 'Symbol of Hope', // Holy — mana restoration for team
  // ── Evoker ─────────────────────────────────────────────────────────────────
  '363534': 'Rewind', // Preservation — rewind time
  '370537': 'Stasis', // Preservation — store heals
};

// ── Enemy major buff tracking (F67) ──────────────────────────────────────────

// Only spells that generate SPELL_AURA_APPLIED events on enemy players in WoW combat logs.
// Mass-buff effects (Bloodlust, Heroism, Time Warp) do NOT generate individual aura events for
// enemy team members — they are already visible via [ENEMY CD] / Enemy active in the prompt.
const ENEMY_MAJOR_BUFF_SPELL_IDS: Record<string, { name: string; purgeable: boolean }> = {
  '10060': { name: 'Power Infusion', purgeable: true },
};

export interface IEnemyBuffInterval {
  spellId: string;
  spellName: string;
  startSeconds: number;
  endSeconds: number;
  purgeable: boolean;
}

/**
 * Scans each enemy unit's auraEvents and returns intervals during which a major
 * tracked buff (PI, Bloodlust, etc.) was active.  Unclosed buffs at match end are
 * clamped to matchEndMs so a buff active at the final snapshot is still visible.
 */
export function extractEnemyMajorBuffIntervals(
  enemies: ICombatUnit[],
  matchStartMs: number,
  matchEndMs: number,
): Map<string, IEnemyBuffInterval[]> {
  const result = new Map<string, IEnemyBuffInterval[]>();

  for (const enemy of enemies) {
    const intervals: IEnemyBuffInterval[] = [];
    // key: "${spellId}:${srcUnitId}" → startMs
    const openBuffs = new Map<string, number>();

    // Pre-match scan: seed buffs applied before match start that were not removed before start
    const preNetActive = new Map<string, boolean>();
    for (const event of enemy.auraEvents) {
      const ts: number = event.logLine.timestamp;
      if (ts >= matchStartMs) break; // auraEvents are chronological; stop at match start
      const spellId = event.spellId ?? '';
      if (!ENEMY_MAJOR_BUFF_SPELL_IDS[spellId]) continue;
      const stateKey = `${spellId}:${event.srcUnitId}`;
      if (event.logLine.event === LogEvent.SPELL_AURA_APPLIED) {
        preNetActive.set(stateKey, true);
      } else if (event.logLine.event === LogEvent.SPELL_AURA_REMOVED) {
        preNetActive.set(stateKey, false);
      }
    }
    for (const [stateKey, active] of preNetActive) {
      if (active) openBuffs.set(stateKey, matchStartMs);
    }

    // Main pass: process events during the match
    for (const event of enemy.auraEvents) {
      const spellId = event.spellId ?? '';
      const buffDef = ENEMY_MAJOR_BUFF_SPELL_IDS[spellId];
      if (!buffDef) continue;

      const stateKey = `${spellId}:${event.srcUnitId}`;
      const ts: number = event.logLine.timestamp;
      if (ts < matchStartMs) continue;

      if (event.logLine.event === LogEvent.SPELL_AURA_APPLIED) {
        if (!openBuffs.has(stateKey)) {
          openBuffs.set(stateKey, ts);
        }
      } else if (event.logLine.event === LogEvent.SPELL_AURA_REMOVED) {
        const startMs = openBuffs.get(stateKey);
        if (startMs !== undefined) {
          intervals.push({
            spellId,
            spellName: buffDef.name,
            startSeconds: (startMs - matchStartMs) / 1000,
            endSeconds: (ts - matchStartMs) / 1000,
            purgeable: buffDef.purgeable,
          });
          openBuffs.delete(stateKey);
        }
      }
    }

    // Clamp any unclosed buffs to match end
    for (const [stateKey, startMs] of openBuffs) {
      const spellId = stateKey.split(':')[0];
      const buffDef = ENEMY_MAJOR_BUFF_SPELL_IDS[spellId];
      if (buffDef) {
        intervals.push({
          spellId,
          spellName: buffDef.name,
          startSeconds: (startMs - matchStartMs) / 1000,
          endSeconds: (matchEndMs - matchStartMs) / 1000,
          purgeable: buffDef.purgeable,
        });
      }
    }

    if (intervals.length > 0) {
      result.set(enemy.name, intervals);
    }
  }

  return result;
}

// ── Owner CD buff expiry tracking (F70) ────────────────────────────────────────

export interface ICDExpiryEvent {
  spellId: string;
  spellName: string;
  castAtSeconds: number;
  expiresAtSeconds: number;
  /** true when no SPELL_AURA_REMOVED was found — expiry estimated from cast + known duration */
  isEstimated: boolean;
  /**
   * B129: why the buff faded. 'expired' = ran its full duration (or estimated to have). 'ended_early'
   * = removed before its natural duration (absorb consumed, dispelled, or cancelled). Distinguishing
   * these stops the model from inventing a dispel for a naturally-expired buff and lets it tell a
   * consumed absorb (e.g. Life Cocoon) from an expired one.
   */
  cause: 'expired' | 'ended_early';
}

export const CHANNELED_CD_SPELL_IDS = new Set<string>([
  '740', // Tranquility (Druid)
  '64843', // Divine Hymn (Priest)
  '370960', // Emerald Communion (Evoker)
  '421116', // Ultimate Penitence (Priest cast)
  '421453', // Ultimate Penitence (Priest aura)
  '115176', // Zen Meditation (Monk)
]);

export const SPELL_DURATION_OVERRIDES: Record<string, number> = {
  '421116': 6.5, // Ultimate Penitence
  '421453': 6.5, // Ultimate Penitence
};

// M-b: a real aura removal arrives at ~nominal duration plus minor server-tick/latency slack;
// a removal more than a couple seconds past nominal duration almost certainly belongs to a
// different (later) cast, not this one.
const BUFF_EXPIRY_PAIRING_TOLERANCE_S = 2;

// B129: a removal within this slack of the natural end still counts as a normal expiry (server-tick
// latency); earlier than this means the buff was ended early (consumed/dispelled/cancelled).
const BUFF_FADE_EARLY_TOLERANCE_S = 1.5;

/**
 * For each owner CD cast, finds when the buff actually expired by matching to the
 * chronologically-next SPELL_AURA_REMOVED event (cast by `ownerId`) across all
 * friendly units.  Falls back to `cast.timeSeconds + spellEffectData[spellId].durationSeconds`
 * when no aura event is present.  Skips CDs with no durationSeconds in spellEffectData.
 */
export function extractOwnerCDBuffExpiry(
  ownerCDs: IMajorCooldownInfo[],
  ownerId: string,
  friends: ICombatUnit[],
  matchStartMs: number,
): ICDExpiryEvent[] {
  const result: ICDExpiryEvent[] = [];

  for (const cd of ownerCDs) {
    // CC spells apply their aura to the enemy, not a friendly — SPELL_AURA_REMOVED never
    // appears in friends' events. DR also makes the estimated duration wrong. Skip entirely.
    if (cd.tag === 'Control') continue;
    const duration = SPELL_DURATION_OVERRIDES[cd.spellId] || spellEffectData[cd.spellId]?.durationSeconds;
    if (!duration || duration <= 0) continue;

    // Collect all SPELL_AURA_REMOVED timestamps for this spell cast by the owner,
    // across all friendly units, sorted ascending.
    const removalTimestampsMs: number[] = [];
    for (const friend of friends) {
      for (const event of friend.auraEvents) {
        const isMatch = event.spellId === cd.spellId || (cd.spellId === '421116' && event.spellId === '421453');
        if (
          isMatch &&
          event.srcUnitId === ownerId &&
          (event.logLine.event as LogEvent) === LogEvent.SPELL_AURA_REMOVED
        ) {
          removalTimestampsMs.push(event.logLine.timestamp as number);
        }
      }
    }
    removalTimestampsMs.sort((a, b) => a - b);

    // Match each cast (ascending) to the chronologically-next removal after the cast.
    let removalIndex = 0;
    for (const cast of cd.casts) {
      const castMs = matchStartMs + cast.timeSeconds * 1000;

      // Skip removals that happened before this cast started (orphans / prior applications).
      while (removalIndex < removalTimestampsMs.length && removalTimestampsMs[removalIndex] < castMs) {
        removalIndex++;
      }

      let expiresAtSeconds: number;
      let isEstimated: boolean;

      // M-b: only accept the chronologically-next removal as this cast's real expiry when it
      // falls within duration + tolerance of the cast. Otherwise it likely belongs to a later
      // cast (this cast's own removal is missing from the log) — fall back to estimated and
      // leave removalIndex where it is so the removal remains available for that later cast.
      const withinWindow =
        removalIndex < removalTimestampsMs.length &&
        removalTimestampsMs[removalIndex] <= castMs + (duration + BUFF_EXPIRY_PAIRING_TOLERANCE_S) * 1000;

      if (withinWindow) {
        expiresAtSeconds = (removalTimestampsMs[removalIndex] - matchStartMs) / 1000;
        isEstimated = false;
        removalIndex++;
      } else {
        expiresAtSeconds = cast.timeSeconds + duration;
        isEstimated = true;
      }

      // B129: classify the fade cause. An estimated expiry (no removal event) is assumed to have run
      // its full duration. A confirmed removal more than a tick before the natural end means the buff
      // was ended early (absorb consumed, dispelled, or cancelled) rather than expiring.
      const naturalEndSeconds = cast.timeSeconds + duration;
      const cause: ICDExpiryEvent['cause'] =
        !isEstimated && expiresAtSeconds < naturalEndSeconds - BUFF_FADE_EARLY_TOLERANCE_S ? 'ended_early' : 'expired';

      result.push({
        spellId: cd.spellId,
        spellName: cd.spellName,
        castAtSeconds: cast.timeSeconds,
        expiresAtSeconds,
        isEstimated,
        cause,
      });
    }
  }

  return result;
}

/** H13: true if a real kick (interruptInstance) or control-CC (ccInstance) landed on the
 * caster within the channel window [startSeconds, endSeconds] (±0.5s tolerance so an
 * interrupt that lands right as the channel stops still counts). Used to confirm an early-
 * ended channel was actually interrupted, vs. a self-cancel/movement. */
export function channelWasInterrupted(
  ownerSummary: Pick<IPlayerCCTrinketSummary, 'ccInstances' | 'interruptInstances'> | undefined,
  startSeconds: number,
  endSeconds: number,
): boolean {
  if (!ownerSummary) return false;
  const kickInWindow = ownerSummary.interruptInstances.some(
    (i) => i.atSeconds >= startSeconds - 0.5 && i.atSeconds <= endSeconds + 0.5,
  );
  if (kickInWindow) return true;

  return ownerSummary.ccInstances.some((cc) => {
    const landedInWindow = cc.atSeconds >= startSeconds - 0.5 && cc.atSeconds <= endSeconds + 0.5;
    const activeAtEnd = endSeconds >= cc.atSeconds - 0.5 && endSeconds <= cc.atSeconds + cc.durationSeconds + 0.5;
    return landedInWindow || activeAtEnd;
  });
}

/** Rendered timeline lines start with an `M:SS ` timestamp column (e.g. `0:13  [DMG SPIKE]   …`). */
const TIMESTAMPED_LINE_REGEX = /^(\d+):(\d{2})\s/;

/**
 * Merges pre-rendered, timestamped insert lines into rendered timeline lines by chronology.
 * Each insert goes before the first timestamped line whose time is strictly greater than
 * `atSeconds` (so at equal timestamps, existing timeline lines keep precedence); inserts
 * later than every timeline timestamp go right after the last timestamped line. Lines
 * without a leading timestamp (headers, blanks) are position anchors only — an insert is
 * never placed before the headers that precede the first timestamped line. Insert order is
 * stable for equal `atSeconds`.
 */
export function mergeTimestampedLines(
  timelineLines: string[],
  inserts: Array<{ atSeconds: number; line: string }>,
): string[] {
  if (inserts.length === 0) return [...timelineLines];

  const sortedInserts = inserts
    .map((insert, index) => ({ ...insert, index }))
    .sort((a, b) => a.atSeconds - b.atSeconds || a.index - b.index);

  const lineTimes = timelineLines.map((line) => {
    const m = TIMESTAMPED_LINE_REGEX.exec(line);
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
  });
  const lastTimestampedIndex = lineTimes.reduce((last, t, i) => (t !== null ? i : last), -1);

  const result: string[] = [];
  let nextInsert = 0;
  for (let i = 0; i < timelineLines.length; i++) {
    const t = lineTimes[i];
    if (t !== null) {
      while (nextInsert < sortedInserts.length && sortedInserts[nextInsert].atSeconds < t) {
        result.push(sortedInserts[nextInsert].line);
        nextInsert++;
      }
    }
    result.push(timelineLines[i]);
    if (i === lastTimestampedIndex) {
      while (nextInsert < sortedInserts.length) {
        result.push(sortedInserts[nextInsert].line);
        nextInsert++;
      }
    }
  }
  // No timestamped line at all — append the inserts at the end.
  while (nextInsert < sortedInserts.length) {
    result.push(sortedInserts[nextInsert].line);
    nextInsert++;
  }
  return result;
}

// ── Module-level constants shared across builders ──────────────────────────

/** Minimum total damage for a pressure window to be treated as a [DMG SPIKE] event. */
export const DMG_SPIKE_THRESHOLD = 300_000;

/**
 * Spell IDs for healing-amplifier CDs where we measure throughput during the buff window
 * and append a [HEALING] line (per-5s HPS + overheal %). Restricted to pure healing amps.
 */
export const HEALING_AMPLIFIER_SPELL_IDS = new Set([
  '10060', // Power Infusion (15s)
  '29166', // Innervate (8s)
  '114052', // Ascendance (15s)
]);

/** CD cast within this many seconds of match start is considered "early" for healing-window suppression. */
export const HEALING_WINDOW_EARLY_CD_SECONDS = 10;

/** Max per-bucket HPS below this value is treated as no meaningful healing activity. */
export const HEALING_WINDOW_MIN_HPS = 1_000;

/**
 * Computes healing throughput during a CD's active window.
 * Returns per-5s HPS buckets and overall overheal % from healOut events.
 * Returns null if no healing events fall within [fromMs, toMs].
 *
 * Bucket upper bounds are exclusive except for the last bucket (inclusive at toMs)
 * so every event in the window is counted exactly once.
 */
export function computeHealingInWindow(
  healOut: ICombatUnit['healOut'],
  fromMs: number,
  toMs: number,
): { buckets: Array<{ fromSeconds: number; toSeconds: number; hps: number }>; overhealPct: number } | null {
  const events = healOut.filter((h) => h.logLine.timestamp >= fromMs && h.logLine.timestamp <= toMs);
  if (events.length === 0) return null;

  let totalAmount = 0;
  let totalEffective = 0;
  for (const h of events) {
    totalAmount += h.amount;
    totalEffective += h.effectiveAmount;
  }

  const windowSeconds = (toMs - fromMs) / 1000;
  const BUCKET_SIZE = 5;
  const buckets: Array<{ fromSeconds: number; toSeconds: number; hps: number }> = [];

  for (let bucketStart = 0; bucketStart < windowSeconds; bucketStart += BUCKET_SIZE) {
    const bucketEnd = Math.min(bucketStart + BUCKET_SIZE, windowSeconds);
    const isLastBucket = bucketEnd >= windowSeconds;
    const bucketFromMs = fromMs + bucketStart * 1000;
    const bucketToMs = fromMs + bucketEnd * 1000;
    const bucketDuration = bucketEnd - bucketStart;

    const bucketEffective = events
      .filter(
        (h) =>
          h.logLine.timestamp >= bucketFromMs &&
          (isLastBucket ? h.logLine.timestamp <= bucketToMs : h.logLine.timestamp < bucketToMs),
      )
      .reduce((sum, h) => sum + h.effectiveAmount, 0);

    buckets.push({ fromSeconds: bucketStart, toSeconds: bucketEnd, hps: bucketEffective / bucketDuration });
  }

  const overhealPct = totalAmount > 0 ? Math.round(((totalAmount - totalEffective) / totalAmount) * 100) : 0;
  return { buckets, overhealPct };
}

/**
 * Extracts the top-N damage sources that hit `unit` within the `windowMs` window
 * ending at `deathMs`. Returns an array of formatted "source — spell (Xk)" strings.
 */
export function getTopDamageSourcesInWindow(
  unit: ICombatUnit,
  endMs: number,
  windowMs: number,
  topN = 3,
  playerIdMap?: Map<string, number>,
  enemyIdMap?: Map<string, number>,
): string[] {
  const startMs = endMs - windowMs;
  const buckets = new Map<string, number>();
  for (const d of unit.damageIn) {
    if (d.logLine.timestamp < startMs || d.logLine.timestamp > endMs) continue;
    const dmg = Math.abs(d.effectiveAmount);
    if (dmg <= 0) continue;
    // B20: exclude same-team sources (e.g. Time Dilation from Preservation Evoker buff)
    if (getUnitReaction(d.srcUnitFlags) === unit.reaction) continue;
    // B24: pet/guardian units may have localized (non-ASCII) names from non-en-US clients;
    // replace with "[pet]" to keep attribution readable without localization noise.
    const srcType = getUnitType(d.srcUnitFlags);
    const isPet = srcType === CombatUnitType.Pet || srcType === CombatUnitType.Guardian;

    let srcName = 'Unknown';
    if (!isPet && d.srcUnitName) {
      const cleanSrcName = d.srcUnitName.split('-')[0];
      const isSrcFriendly = getUnitReaction(d.srcUnitFlags) === CombatUnitReaction.Friendly;
      if (isSrcFriendly && playerIdMap) {
        const id = playerIdMap.get(d.srcUnitName) ?? playerIdMap.get(cleanSrcName);
        srcName = id !== undefined ? String(id) : cleanSrcName;
      } else if (!isSrcFriendly && enemyIdMap) {
        const id = enemyIdMap.get(d.srcUnitName) ?? enemyIdMap.get(cleanSrcName);
        srcName = id !== undefined ? String(id) : cleanSrcName;
      } else {
        srcName = cleanSrcName;
      }
    } else if (isPet) {
      srcName = '[pet]';
    }

    const baseSpellLabel = d.spellId ? getEnglishSpellName(d.spellId, d.spellName) : (d.spellName ?? 'melee');

    const schoolName = getSpellSchoolName(d.spellSchoolId);
    const spellLabel = schoolName ? `${baseSpellLabel} [${schoolName}]` : baseSpellLabel;

    const key = `${srcName} — ${spellLabel}`;
    buckets.set(key, (buckets.get(key) ?? 0) + dmg);
  }
  return [...buckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([k, v]) => `${k} (${Math.round(v / 1000)}k)`);
}

// ── [MATCH END] block (F96) ───────────────────────────────────────────────────

export function buildMatchEndBlock(params: {
  matchStartMs: number;
  matchEndMs: number;
  matchEndSeconds: number;
  bracket?: string;
  owner: ICombatUnit;
  friends: ICombatUnit[];
  enemies: ICombatUnit[];
  friendlyDeaths: Array<{ name: string; atSeconds: number }>;
  enemyDeaths: Array<{ name: string; atSeconds: number }>;
  pid: (name: string) => string;
  enemyPid: (name: string) => string;
}): string[] {
  const { matchEndMs, matchEndSeconds, bracket, owner, friends, enemies, friendlyDeaths, enemyDeaths, pid, enemyPid } =
    params;

  const lines: string[] = [];

  // Final dampening — only when bracket is available
  const finalDampPct = bracket ? getDampeningPercentage(bracket, [...friends, ...enemies], matchEndMs) : null;
  const dampStr = finalDampPct !== null ? `   damp: ${Math.round(finalDampPct)}%` : '';

  lines.push('');
  lines.push(`${fmtTime(matchEndSeconds)}  [MATCH END]${dampStr}`);

  // Build sets of dead players for quick lookup
  const deadFriendlyNames = new Set(friendlyDeaths.map((d) => d.name));
  const deadEnemyNames = new Set(enemyDeaths.map((d) => d.name));
  // For players who died multiple times, use the last death timestamp
  const friendDeathTimeByName = new Map<string, number>();
  for (const d of friendlyDeaths) friendDeathTimeByName.set(d.name, d.atSeconds);
  const enemyDeathTimeByName = new Map<string, number>();
  for (const d of enemyDeaths) enemyDeathTimeByName.set(d.name, d.atSeconds);

  // B36: stable ordering — log owner always first, then other friendlies in their original order.
  const orderedFriendsForEnd = [owner, ...friends.filter((u) => u.id !== owner.id)];
  const friendParts = orderedFriendsForEnd.map((u) => {
    if (deadFriendlyNames.has(u.name)) {
      const deathAt = friendDeathTimeByName.get(u.name) ?? 0;
      return `${pid(u.name)}:dead(${fmtTime(deathAt)})`;
    }
    const pct = getHpPercentAtTime(u, matchEndSeconds, params.matchStartMs);
    // B18/B23: clamp to 100%
    const clamped = pct !== null ? Math.min(Math.round(pct), 100) : null;
    return `${pid(u.name)}:${clamped !== null ? `${clamped}%` : '?'}`;
  });

  const enemyParts = enemies.map((u) => {
    if (deadEnemyNames.has(u.name)) {
      const deathAt = enemyDeathTimeByName.get(u.name) ?? 0;
      return `${enemyPid(u.name)}:dead(${fmtTime(deathAt)})`;
    }
    const pct = getHpPercentAtTime(u, matchEndSeconds, params.matchStartMs);
    // B18: clamp to 100%
    const clamped = pct !== null ? Math.min(Math.round(pct), 100) : null;
    return `${enemyPid(u.name)}:${clamped !== null ? `${clamped}%` : '?'}`;
  });

  const stateParts: string[] = [];
  if (friendParts.length > 0) stateParts.push(`friends ${friendParts.join(' ')}`);
  if (enemyParts.length > 0) stateParts.push(`enemies ${enemyParts.join(' ')}`);
  if (stateParts.length > 0) {
    lines.push(`  ${stateParts.join(' / ')}`);
  }

  return lines;
}

// ── [KILL SEQUENCE] block (F113) ──────────────────────────────────────────────

export function buildKillSequenceBlock(params: {
  matchStartMs: number;
  matchEndSeconds: number;
  owner: ICombatUnit;
  friends: ICombatUnit[];
  enemies: ICombatUnit[];
  ownerCDs: IMajorCooldownInfo[];
  teammateCDs: Array<{ player: ICombatUnit; spec: string; cds: IMajorCooldownInfo[] }>;
  enemyCDTimeline: IEnemyCDTimeline;
  ccTrinketSummaries: IPlayerCCTrinketSummary[];
  friendlyDeaths: Array<{ spec: string; name: string; atSeconds: number }>;
  enemyDeaths: Array<{ spec: string; name: string; atSeconds: number }>;
  isHealer: boolean;
  pid: (name: string) => string;
}): string[] {
  const {
    matchStartMs,
    matchEndSeconds,
    owner,
    friends,
    enemies,
    ownerCDs,
    teammateCDs,
    enemyCDTimeline,
    ccTrinketSummaries,
    friendlyDeaths,
    enemyDeaths,
    pid,
  } = params;

  const lines: string[] = [];

  if (matchEndSeconds < 90) {
    const firstFriendlyDeath = friendlyDeaths[0];
    const firstEnemyDeath = enemyDeaths[0];
    const firstDeath = !firstFriendlyDeath
      ? firstEnemyDeath
      : !firstEnemyDeath
        ? firstFriendlyDeath
        : firstFriendlyDeath.atSeconds < firstEnemyDeath.atSeconds
          ? firstFriendlyDeath
          : firstEnemyDeath;

    if (firstDeath) {
      const deathTime = firstDeath.atSeconds;
      const killSeqEntries: Array<{ timeSeconds: number; label: string; text: string }> = [];

      // 1. Healer CC
      const isFriendlyDeath = friends.some((f) => f.name === firstDeath.name);
      const dyingTeam = isFriendlyDeath ? friends : enemies;
      const dyingHealer = dyingTeam.find((u) => isHealerSpec(u.spec));

      if (dyingHealer) {
        // Detailed CC summary is available for friends.
        const healerSummary = ccTrinketSummaries.find((s) => s.playerName === dyingHealer.name);
        if (healerSummary) {
          const relevantCC = [...healerSummary.ccInstances]
            .filter((cc) => cc.atSeconds <= deathTime && cc.atSeconds + cc.durationSeconds >= deathTime - 12)
            .sort((a, b) => b.atSeconds - a.atSeconds)[0];
          if (relevantCC) {
            killSeqEntries.push({
              timeSeconds: relevantCC.atSeconds,
              label: '[HEALER CC]',
              text: `${pid(dyingHealer.name)} (${specToString(dyingHealer.spec)}) ← ${relevantCC.spellName} (by ${pid(relevantCC.sourceName)})`,
            });
          }
        }
      }

      // 2. Enemy CD active
      if (isFriendlyDeath) {
        const activeBurst = enemyCDTimeline.alignedBurstWindows.find(
          (w) => w.fromSeconds <= deathTime && w.toSeconds >= deathTime - 12,
        );
        if (activeBurst) {
          const cdNames = activeBurst.activeCDs.map((c) => c.spellName).join(' + ');
          killSeqEntries.push({
            timeSeconds: activeBurst.fromSeconds,
            label: '[ENEMY CD]',
            text: `${cdNames} active`,
          });
        } else {
          const individualCDs = enemyCDTimeline.players.flatMap((p) =>
            p.offensiveCDs.filter((cd) => cd.castTimeSeconds <= deathTime && cd.castTimeSeconds >= deathTime - 15),
          );
          if (individualCDs.length > 0) {
            const latest = [...individualCDs].sort((a, b) => b.castTimeSeconds - a.castTimeSeconds)[0];
            killSeqEntries.push({
              timeSeconds: latest.castTimeSeconds,
              label: '[ENEMY CD]',
              text: `${latest.spellName} active`,
            });
          }
        }
      }

      // 3. Defensive available but unused (only for friendly deaths)
      if (isFriendlyDeath) {
        const dyingUnit = friends.find((f) => f.name === firstDeath.name);
        if (dyingUnit) {
          const allFriendlyCDs = [
            ...ownerCDs.map((cd) => ({ player: owner, cd })),
            ...teammateCDs.flatMap((t) => t.cds.map((cd) => ({ player: t.player, cd }))),
          ];
          const unusedDefensives = allFriendlyCDs.filter(({ player, cd }) => {
            if (cd.tag !== 'Defensive' && cd.tag !== 'External') return false;

            // Relevant if: own CD, or an external, or any healer defensive CD (usually team-relevant)
            const isDyingPlayer = player.name === dyingUnit.name;
            const isExternal = cd.tag === 'External';
            const isHealerCD = isHealerSpec(player.spec);

            const isRelevant = isDyingPlayer || isExternal || isHealerCD;
            if (!isRelevant) return false;

            const lastCast = lastCastBefore(cd, deathTime);
            return !lastCast || lastCast.timeSeconds + cd.cooldownSeconds <= deathTime;
          });

          if (unusedDefensives.length > 0) {
            const topUnused = [...unusedDefensives]
              .sort((a, b) => b.cd.cooldownSeconds - a.cd.cooldownSeconds)
              .slice(0, 2);
            topUnused.forEach((u) => {
              killSeqEntries.push({
                timeSeconds: Math.max(0, deathTime - 1),
                label: '[DEFENSIVE AVAILABLE]',
                text: `${pid(u.player.name)}: ${u.cd.spellName} available but unused`,
              });
            });
          }
        }
      }

      // 4. Kill source
      const dyingUnit = isFriendlyDeath
        ? friends.find((f) => f.name === firstDeath.name)
        : enemies.find((e) => e.name === firstDeath.name);
      if (dyingUnit) {
        const topSources = getTopDamageSourcesInWindow(dyingUnit, matchStartMs + deathTime * 1000, 5000);
        if (topSources.length > 0) {
          killSeqEntries.push({
            timeSeconds: deathTime,
            label: '[KILL]',
            text: `${pid(firstDeath.name)} (${firstDeath.spec}) dead (Killer: ${topSources[0]})`,
          });
        }
      }

      if (killSeqEntries.length > 0) {
        lines.push('');
        lines.push('KILL SEQUENCE');
        killSeqEntries
          .sort((a, b) => a.timeSeconds - b.timeSeconds)
          .forEach((e) => {
            lines.push(`${fmtTime(e.timeSeconds)}  ${e.label.padEnd(22)} ${e.text}`);
          });
      }
    }
  }

  return lines;
}

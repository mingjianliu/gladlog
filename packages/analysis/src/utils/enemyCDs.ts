import {
  AtomicArenaCombat,
  CombatUnitType,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import {
  castAndEffectIds,
  triggeredEffectAurasOfCast,
} from "../data/castEffectAuras";
import { SPELL_CATEGORIES as spellsData } from "../data/spellCategories";
import {
  effectiveCooldownSeconds,
  spellEffectData,
} from "../data/spellEffectData";
import {
  buildAuraIntervals,
  dropAuraRebroadcasts,
  type IAuraInterval,
  supersededAuraBreaks,
} from "./auraIntervals";
import { buffFullDurationForCaster } from "./buffDuration";
import {
  canonicalSpellId,
  getUnitHpAtTimestamp,
  HP_SAMPLE_RADIUS_MS,
  isEnemyCdWindowSpell,
  isHealerSpec,
  pressReadyAgainAtSeconds,
  specToString,
  unitCooldownEntry,
  unitCooldownOf,
} from "./cooldowns";
import { pressRowsWithHidden } from "./hiddenPress";
import { fmtTime } from "./renderGrid";
import { shuffleRoundEndMs } from "./roundEnd";
import { DEATH_CASCADE_MS, firstDeathMs } from "./unitDeath";

type SpellEntry = { type: string };
const SPELLS = spellsData as Record<string, SpellEntry>;
import {
  computeDampening,
  dampeningDangerMultiplier,
  dampeningForThreatWeight,
  fmtDampening,
} from "./dampening";
import {
  AURA_EVIDENCE_WINDOW_S,
  auraOffensiveOccurrences,
  GENERIC_PRESS_AFTER_MS,
  TWIN_CAST_BEFORE_S,
} from "./offensiveAuraOccurrences";
import {
  dangerLabel,
  OFFENSIVE_EFFECT_ACTIVATION_IDS,
  offensiveDangerWeight,
  offensiveEffectCdId,
} from "./spellDanger";

/** Two offensive CD casts within this window are considered an aligned burst.
 * Shared with burstLedger (friendly-side burst grouping) — one clustering predicate for both teams. */
export const BURST_CLUSTER_SECONDS = 10;
/** A single CD with at least this danger weight forms a burst window on its own (≈ a 2-minute major).
 * Exported since 2026-08-31 (GH #60): `analysis/burstWindowDecisionPoints.ts`
 * re-applies this exact qualification rule to each per-exchange piece it cuts
 * a window into, and a second copy of the number would be a silent fork of
 * "what counts as a burst" (CLAUDE.md shared-predicate rule). */
export const SOLO_WINDOW_MIN_WEIGHT = 1.3;

export interface IEnemyCDCast {
  /** the id that was cast — an activation keeps its own (GH #115) */
  spellId: string;
  spellName: string;
  castTimeSeconds: number;
  /** pressed while the enemy was unseen (`hiddenPressMs`): the instant the
   * log showed its aura again, the latest the press can have been */
  unseenPress?: true;
  /** this id's own cooldown; 0 for an activation of another cooldown's
   * effect (Radiant Glory's 454351 has none — GH #115) */
  cooldownSeconds: number;
  /** When this CD will be available again (may exceed match duration);
   * null for an activation, which has no button to come back (GH #115) */
  availableAgainAtSeconds: number | null;
  /** `offensiveDangerWeight` — the effect's weight, the canonical cooldown's
   * for an activation. The one number window qualification and threat
   * scoring read. */
  dangerWeight: number;
  /**
   * When the effect of this cast ended: the end of its OBSERVED aura chain
   * when the log shows one (`observedEffectEndSeconds`), else the official
   * duration for the caster (spellEffectData / `buffFullDurationForCaster`),
   * else the cast time. `burstCastSpan` reads it.
   */
  buffEndSeconds: number;
  /** The observed end above is its holder's death (the effect came off in
   * the death cascade, `DEATH_CASCADE_MS`): when the effect was due to end
   * had the holder lived — the official end, what a row before the death
   * can state as time left (GH #167, 121afd91 r6 1:55: `Dark
   * Transformation (5s left)` counted down to a death 5 s later). */
  deathCutOfficialEndSeconds?: number;
  /** GH #119: "fact" = shown, never part of a burst window (a Demonic
   * Metamorphosis form under OFFENSIVE_AURA_FLAGS.demonic "fact"). Absent =
   * "burst". */
  burstRole?: "burst" | "fact";
  /** GH #119: nothing tells whether a cooldown was spent (a Metamorphosis
   * form with neither a press nor an Eye Beam) — render "?" not "[proc]" */
  availabilityUnknown?: boolean;
}

export interface IEnemyPlayerTimeline {
  readonly playerName: string;
  readonly specName: string;
  readonly offensiveCDs: readonly IEnemyCDCast[];
  /** GH #119: occurrences shown on the timeline but never a burst anywhere
   * (a Demonic Metamorphosis form under OFFENSIVE_AURA_FLAGS.demonic
   * "fact"). Kept OUT of offensiveCDs so no reader of the burst list can
   * pick one up by accident; only the [ENEMY CD] renderer reads this. */
  readonly offensiveFacts?: readonly IEnemyCDCast[];
}

export interface IAlignedBurstWindow {
  readonly fromSeconds: number;
  readonly toSeconds: number;
  readonly activeCDs: ReadonlyArray<{
    readonly playerName: string;
    readonly spellName: string;
    readonly spellId: string;
    /** The second at which this CD was actually cast inside the window --
     * rendering must include it, or the list reads as "everything popped at the
     * window start" (the 059 misreading). */
    readonly castSeconds: number;
  }>;
  /** Ex-ante threat from the stacked CDs alone (weights × alignment × dampening) — outcome-independent */
  readonly threatScore: number;
  readonly threatLabel: "Low" | "Moderate" | "High" | "Critical";
  /** Combined score including outcome factors (damage dealt, healer CC) — kept for existing consumers */
  readonly dangerScore: number;
  readonly dangerLabel: "Low" | "Moderate" | "High" | "Critical";
  /** 0–1; `null` where no value is stated — a 2v2 round that logged no
   * stack (`getInitialDampening`). */
  readonly dampeningPct: number | null;
  readonly damageInWindow: number;
  readonly damageRatio: number;
  readonly healerCCed: boolean;
  /** HP% of the most-pressured friendly at window start, midpoint, and end */
  readonly mostPressuredTarget?: {
    readonly unitName: string;
    readonly startHpPct: number | null;
    readonly midHpPct: number | null;
    readonly endHpPct: number | null;
  };
}

export interface IEnemyCDTimeline {
  readonly players: readonly IEnemyPlayerTimeline[];
  /** Windows where 2+ enemy offensive CDs were used within BURST_CLUSTER_SECONDS of each other */
  readonly alignedBurstWindows: readonly IAlignedBurstWindow[];
}

// `ENEMY_CD_MAX_SECONDS` and `isEnemyCdWindowSpell` live in `cooldowns.ts`
// since fact2 C10 (2026-10-20): the aura-evidence reader there
// (`offensiveCdOfAura`) admits an effect aura on the same window test, and
// `cooldowns.ts` cannot import this module (it imports `cooldowns.ts`).
export { ENEMY_CD_MAX_SECONDS, isEnemyCdWindowSpell } from "./cooldowns";

/**
 * For each enemy player, reconstruct when their offensive cooldowns (>= 30s) were cast
 * and when each CD will be available again. Also identifies aligned burst windows where
 * multiple enemies stacked offensive CDs together.
 */
/** A re-application this close after the previous interval's end continues
 * the same effect (triage kick-eaten F-K1, Sim R1-A: 02c8e3ac's Dragonrage
 * re-applied through 29.9 and removed at 45.4). */
export const EFFECT_CHAIN_GAP_S = 0.5;

/** A chain starts at an application in [cast − this, cast + `EFFECT_START_AFTER_S`]
 * — the entry's Sim R1-A window (an aura's APPLIED can be logged a little
 * before the cast's SUCCESS). */
export const EFFECT_START_BEFORE_S = 0.5;
export const EFFECT_START_AFTER_S = 2;

/** Every PLAYER unit's aura intervals, once per combat. A summon's auras are
 * left out (FT F13): `observedEffectEndSeconds` answers "until when was this
 * player's cooldown running", and an effect that lives on only on a pet, a
 * totem or a guardian is not that — 9c6ab747: The Hunt's DoT left its player
 * target at 83.9 and sat on a Jade Serpent Statue until 85.1, and a kick at
 * 84.7 read `ourBurst=The Hunt`. */
const AURA_INDEX = new WeakMap<
  object,
  Array<{ destId: string; iv: IAuraInterval }>
>();
function auraIndexOf(combat: AtomicArenaCombat) {
  let idx = AURA_INDEX.get(combat);
  if (!idx) {
    idx = [];
    for (const u of Object.values(combat.units ?? {})) {
      if (u.type !== CombatUnitType.Player) continue;
      for (const iv of buildAuraIntervals(u, combat))
        idx.push({ destId: u.id, iv });
    }
    AURA_INDEX.set(combat, idx);
  }
  return idx;
}

/**
 * Where one cast's effect was seen to end, in seconds from the match start —
 * or null when the log does not show it.
 *
 * Triage kick-eaten F-K1, the observed-chain half of ruling A14 = B (the
 * floor half landed 2026-10-02): `burstCastSpan` ends at the observed aura
 * chain of the cast. The cast's effect auras are its own id plus the
 * cast→effect table's (`castAndEffectIds`, CROSS-THEME G3, ruling A10), on
 * any PLAYER unit (The Hunt's DoT is on its target, Strike of the Windlord's
 * debuff too; a copy on a pet, a totem or a guardian is not read — FT F13,
 * `auraIndexOf`), applied by the caster: an interval that starts in [cast −
 * `EFFECT_START_BEFORE_S`, cast + `EFFECT_START_AFTER_S`] (before the
 * caster's next press of the same spell), extended by re-applications on the
 * same unit no more than `EFFECT_CHAIN_GAP_S` after it ended. Several chains
 * (a caster buff and a target DoT) → the one that ends last, and only when
 * THAT end was logged: a chain closed only by the official-length cap
 * (`inferredEnd`) says nothing about when the effect ended, so a longer
 * unclosed DoT is not cut short by a shorter buff's removal (codex review:
 * The Hunt's 0.4 s buff against its unclosed DoT) — null, the official
 * duration stands. Sim R1-A of the entry, rule for rule.
 */
export function observedEffectEndSeconds(
  caster: ICombatUnit,
  castSpellId: string,
  castS: number,
  nextSameCastS: number,
  combat: AtomicArenaCombat,
  /** read only this recipient's copy (a press that put one on its caster
   * and one on an ally answers for each with its own end — codex
   * 20-F17-11 #1) */
  onlyDestId?: string,
): number | null {
  return (
    observedEffectEnd(
      caster,
      castSpellId,
      castS,
      nextSameCastS,
      combat,
      onlyDestId,
    )?.endS ?? null
  );
}

/** `observedEffectEndSeconds` with the unit whose chain it read — the
 * effect's holder (codex 20-G167-02: Power Infusion's end is its target's,
 * not its caster's). */
function observedEffectEnd(
  caster: ICombatUnit,
  castSpellId: string,
  castS: number,
  nextSameCastS: number,
  combat: AtomicArenaCombat,
  onlyDestId?: string,
): {
  endS: number;
  holderId: string;
  /** the chain's aura and its last interval's start — where an official
   * end is read from (codex 20-G167-06) */
  auraId: string;
  lastFromS: number;
} | null {
  const ids = castAndEffectIds(castSpellId);
  const triggered = new Set(triggeredEffectAurasOfCast(castSpellId));
  const mine = auraIndexOf(combat).filter(
    ({ iv, destId }) =>
      ids.has(iv.spellId) &&
      iv.srcUnitName === caster.name &&
      !iv.inferredStart &&
      iv.fromS < nextSameCastS &&
      (onlyDestId === undefined || destId === onlyDestId),
  );
  const castMs = combat.startTime + castS * 1000;
  const auraRowsOf = (destId: string, orNoSource = false) =>
    (combat.units?.[destId]?.auraEvents ?? []).filter(
      (a) =>
        !!a.spellId &&
        ids.has(a.spellId) &&
        (a.srcUnitId === caster.id ||
          // a REMOVED written with no source closes the caster's interval in
          // the builder too (its source fallback)
          (orNoSource &&
            (!a.srcUnitId || a.srcUnitId === "0000000000000000"))) &&
        a.destUnitId === destId,
    );
  const refreshedAtCast = (destId: string): boolean =>
    auraRowsOf(destId).some(
      (a) =>
        (a.logLine.event === LogEvent.SPELL_AURA_REFRESH ||
          a.logLine.event === LogEvent.SPELL_AURA_APPLIED) &&
        a.logLine.timestamp >= castMs - EFFECT_START_BEFORE_S * 1000 &&
        a.logLine.timestamp <= castMs + EFFECT_START_AFTER_S * 1000,
    );
  let best: {
    end: number;
    observed: boolean;
    destId: string;
    lastFromS: number;
    auraId: string;
  } | null = null;
  for (const dest of new Set(mine.map((m) => m.destId))) {
    const ivs = mine
      .filter((m) => m.destId === dest)
      .map((m) => m.iv)
      .sort((a, b) => a.fromS - b.fromS);
    const startsAtPress = (iv: (typeof ivs)[number]) =>
      iv.fromS >= castS - EFFECT_START_BEFORE_S &&
      iv.fromS <= castS + EFFECT_START_AFTER_S;
    let first = ivs.findIndex(startsAtPress);
    // the aura the cast's effect lives on (`triggeredEffectAurasOfCast`)
    // over a side effect of it that went up first: The Hunt's 1.5 s root
    // 370970 ended its span at 1:16 while its DoT 370969 ran to 1:21 (fact5
    // cxa e38f41c9 1:15)
    if (
      first >= 0 &&
      ivs[first]!.spellId !== castSpellId &&
      !triggered.has(ivs[first]!.spellId)
    ) {
      const main = ivs.findIndex(
        (iv) => startsAtPress(iv) && triggered.has(iv.spellId),
      );
      if (main >= 0) first = main;
    }
    // F15 / fact1215 R8: a press that REFRESHed an aura already up (an
    // un-pressed application before it) starts no interval of its own — the
    // open one it refreshed is its effect (519781fd: Malevolence up from
    // 1:11.95, the 1:21.50 press refreshed it, it ran to 1:47.96; the span
    // read the official 20 s, 1:21–1:41)
    // Only with the log's word for it: this caster's REFRESH (or re-APPLIED)
    // of one of the ids on this unit at the press (codex 20-F15-08: another
    // target's older copy merely overlapping the press is not this press's)
    if (first < 0 && refreshedAtCast(dest))
      // …the interval the logged refresh lands in: open at the press, however
      // soon it closed after (codex 60-POSTHOC-10d: a Malevolence refreshed
      // at 20 s and removed at 21 read the official 20 s, 20–40 s, and made a
      // false burst kill attempt)
      first = ivs.findIndex((iv) => iv.fromS < castS && iv.toS >= castS);
    if (first < 0) continue;
    let chainEnd = ivs[first]!.toS;
    let observed = !ivs[first]!.inferredEnd;
    let lastFromS = ivs[first]!.fromS;
    for (const iv of ivs.slice(first + 1)) {
      if (iv.fromS > chainEnd + EFFECT_CHAIN_GAP_S) break;
      // a re-application of the SAME aura continues the chain; another of
      // the cast's effect ids on this unit does not (round-1 retest idx 46:
      // Kingsbane 385627 ended at 2:25.13, and its same-named stacking buff
      // 394095 — nominated by name only — stretched the span to 2:29.7)
      if (iv.spellId !== ivs[first]!.spellId) continue;
      if (iv.toS > chainEnd) {
        chainEnd = iv.toS;
        observed = !iv.inferredEnd;
        lastFromS = iv.fromS;
      }
    }
    if (best === null || chainEnd > best.end)
      best = {
        end: chainEnd,
        observed,
        destId: dest,
        lastFromS,
        auraId: ivs[first]!.spellId,
      };
  }
  // F15 / fact1215 R8: the interval builder clamps a REMOVED logged after
  // the combat's end onto that end (`buildAuraIntervals` `rel`) and still
  // calls the end observed — a clamp is no observation (26bfd4f3: Kingsbane
  // removed 1:50.78, after the round; `4s left` at 1:42 was the round's end
  // minus now). The official duration stands.
  // Read on the raw rows (codex 20-F15-08: an aura really removed at the
  // combat's end is an observation): the chain ends on the clamp only when
  // the log's own REMOVED of it came after the combat ended.
  const combatEndS = (combat.endTime - combat.startTime) / 1000;
  // The REMOVED that closed the chain's last interval: the first one at or
  // after that interval's start, from the caster or written with no source
  // (codex 20-F15-09: a duplicate REMOVED after a real one at the end, and a
  // source-less REMOVED the builder pairs, both read wrong by "any later
  // REMOVED").
  if (best !== null && best.end >= combatEndS - 0.001) {
    const fromMs = combat.startTime + best.lastFromS * 1000;
    // re-broadcast pairs dropped first, as the interval builder does
    // (codex 20-F15-10: a REMOVED + APPLIED at 26 s is not the close)
    const closing = dropAuraRebroadcasts(auraRowsOf(best.destId, true))
      .filter(
        (a) =>
          a.logLine.event === LogEvent.SPELL_AURA_REMOVED &&
          a.logLine.timestamp >= fromMs,
      )
      .sort((x, y) => x.logLine.timestamp - y.logLine.timestamp)[0];
    if (closing && closing.logLine.timestamp > combat.endTime) {
      // …unless the log shows it outliving its official length: still up
      // when the combat ended, past `cast + official`, it ran at least to the
      // combat's end (round-1 retest idx 64, a2e71187: a talent-lengthened
      // Dragonrage up 29.5 s against 18 s read as ending at cast + 18 s). A
      // clamp before the official end leaves the official end standing (the
      // Kingsbane case).
      const full = buffFullDurationForCaster(castSpellId, caster);
      return full !== undefined && castS + full < combatEndS
        ? {
            endS: combatEndS,
            holderId: best.destId,
            auraId: best.auraId,
            lastFromS: best.lastFromS,
          }
        : null;
    }
  }
  return best?.observed
    ? {
        endS: best.end,
        holderId: best.destId,
        auraId: best.auraId,
        lastFromS: best.lastFromS,
      }
    : null;
}

/**
 * GH #167: an effect whose observed end is a death — its holder's (the
 * death cascade strips it, `DEATH_CASCADE_MS`, logged either side of the
 * UNIT_DIED — codex 20-G167-02) or the Solo Shuffle round's ending one —
 * was due to run to its official end; a row before that death states that
 * time left (121afd91 r6 1:55: `Dark Transformation (5s left)` counted down
 * to a death 5 s later). Undefined otherwise.
 */
const DEATH_CUT_MIN_GAP_S = 0.5;

function deathCutOfficialEnd(
  holder: ICombatUnit | undefined,
  endS: number,
  officialEndS: number,
  combat: AtomicArenaCombat,
): number | undefined {
  // a natural expiry logs within a few hundred ms of its official end (a
  // press logged after its aura, codex 20-G167-06 #3): less than
  // DEATH_CUT_MIN_GAP_S short is no cut
  if (!(officialEndS - endS > DEATH_CUT_MIN_GAP_S)) return undefined;
  const endMs = combat.startTime + endS * 1000;
  const near = (ms: number | undefined) =>
    ms !== undefined && Math.abs(ms - endMs) <= DEATH_CASCADE_MS;
  return (holder && near(firstDeathMs(holder))) ||
    near(shuffleRoundEndMs(combat, Object.values(combat.units ?? {})))
    ? officialEndS
    : undefined;
}

const OWN_CAST_COMBAT = new WeakMap<object, AtomicArenaCombat>();

/**
 * `observedEffectEndSeconds` for a caller that has the round's players but
 * no combat object (the timeline sections), in epoch ms: where this press of
 * `spellId` by `caster` was seen to end, or null (the official length
 * stands). The next press of the same spell bounds the search. Work order
 * 2026-10-15 #8: the [HEALING] / [MANA] windows read cast + official length.
 */
export function observedCastEndMs(
  caster: ICombatUnit,
  spellId: string,
  castMs: number,
  players: readonly ICombatUnit[],
  matchStartMs: number,
  matchEndMs: number,
): number | null {
  let combat = OWN_CAST_COMBAT.get(players);
  if (!combat) {
    combat = {
      startTime: matchStartMs,
      endTime: matchEndMs,
      units: Object.fromEntries(players.map((u) => [u.id, u])),
    } as unknown as AtomicArenaCombat;
    OWN_CAST_COMBAT.set(players, combat);
  }
  const nextMs = Math.min(
    Infinity,
    ...(caster.spellCastEvents ?? [])
      .filter(
        (e) =>
          e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
          e.spellId === spellId &&
          e.timestamp > castMs + 1,
      )
      .map((e) => e.timestamp),
  );
  const end = observedEffectEndSeconds(
    caster,
    spellId,
    (castMs - matchStartMs) / 1000,
    (nextMs - matchStartMs) / 1000,
    combat,
  );
  return end === null ? null : matchStartMs + end * 1000;
}

export function reconstructEnemyCDTimeline(
  enemies: ICombatUnit[],
  combat: AtomicArenaCombat,
  owner?: ICombatUnit,
  friendlies?: ICombatUnit[],
): IEnemyCDTimeline {
  const matchStartMs = combat.startTime;
  const matchDurationSeconds = (combat.endTime - matchStartMs) / 1000;

  const players: IEnemyPlayerTimeline[] = [];

  for (const enemy of enemies) {
    const offensiveCDs: IEnemyCDCast[] = [];

    // corpusFactScan hiddenPressUnused (2026-10-21): a press made while the
    // enemy was unseen (`hiddenPressMs`) is a press too (0284fcd9 r1 0:12:
    // Tranquility; 4-3 r3 0:06: Takedown — no line, kit [UNUSED])
    const presses = pressRowsWithHidden(
      enemy,
      isEnemyCdWindowSpell,
      matchStartMs,
    );
    for (const cast of presses) {
      if (cast.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      const { spellId } = cast;
      if (!spellId) continue;
      if (!isEnemyCdWindowSpell(spellId)) continue;
      const effectData = spellEffectData[spellId]!;
      // an activation of another cooldown's effect (GH #115) has no button:
      // no cooldown of its own, nothing to come "available again". An
      // override variant (F20 D23: Predator's Wake 1259431 on The Hunt's
      // button) IS that button: priced on the cooldown it presses, under the
      // log's own id and name.
      const isActivation = OFFENSIVE_EFFECT_ACTIVATION_IDS.has(spellId);
      const cdId = offensiveEffectCdId(spellId) ?? spellId;
      // the enemy's own talent-resolved cooldown (`unitCooldownOf`: Summon
      // Infernal 90 with Inferno, not 120) — talent impact audit 2026-09-26
      const cooldownSeconds = isActivation
        ? 0
        : (unitCooldownOf(enemy, cdId)?.cooldownSeconds ??
          effectiveCooldownSeconds(cdId) ??
          0);

      const castTimeSeconds = (cast.logLine.timestamp - matchStartMs) / 1000;
      // Caster-aware: DB2 base + the caster's duration talents (the same
      // predicate the owner's ledger reads). Reliability round 3 N7 (f4da):
      // Summon Demonic Tyrant rendered 15 s while Reign of Tyranny holders run
      // 20 s (three windows 20.0 s).
      const buffDuration =
        buffFullDurationForCaster(spellId, enemy) ??
        effectData.durationSeconds ??
        0;

      // Deduplicate: same player + same spellName within 1s = one cast (guards against double-parsed events and multi-target buffs)
      const isDuplicate = offensiveCDs.some(
        (existing) =>
          existing.spellName === effectData.name &&
          Math.abs(castTimeSeconds - existing.castTimeSeconds) < 1,
      );
      if (isDuplicate) continue;

      // back in hand: the shared cooldown model's realised instant for this
      // press (`unitCooldownEntry` — per-press talent effects, charges);
      // the static sum only for a cast the model does not count as a press
      const entry = isActivation
        ? undefined
        : unitCooldownEntry(enemy, combat, cdId);
      offensiveCDs.push({
        spellId,
        spellName: effectData.name,
        castTimeSeconds,
        cooldownSeconds,
        availableAgainAtSeconds: isActivation
          ? null
          : ((entry && pressReadyAgainAtSeconds(entry, castTimeSeconds)) ??
            castTimeSeconds + cooldownSeconds),
        buffEndSeconds: castTimeSeconds + buffDuration,
        ...(cast.unseenPress ? { unseenPress: true as const } : {}),
        dangerWeight: offensiveDangerWeight(
          spellId,
          (id) => effectiveCooldownSeconds(id) ?? 0,
        ),
      });
    }

    // The span of each LOGGED cast ends where its effect was seen to end
    // (`observedEffectEndSeconds`) — before the aura-evidence merge below,
    // which keeps its own say for the effects it owns.
    // each logged press's official end (cast + duration), before any
    // observed end replaces it — what a death-cut effect was due to run to
    const officialEndOf = new Map(
      offensiveCDs.map((cd) => [cd, cd.buffEndSeconds]),
    );
    /** an observed end replaces the span's; one a death cut keeps the
     * official end beside it (`deathCutOfficialEnd`) */
    const setObservedEnd = (
      cd: IEnemyCDCast,
      endS: number,
      officialEndS: number | undefined,
      holder: ICombatUnit | undefined,
    ) => {
      cd.buffEndSeconds = endS;
      const cut =
        officialEndS === undefined
          ? undefined
          : deathCutOfficialEnd(holder, endS, officialEndS, combat);
      if (cut === undefined) delete cd.deathCutOfficialEndSeconds;
      else cd.deathCutOfficialEndSeconds = cut;
    };
    for (const cd of offensiveCDs) {
      const next = offensiveCDs.find(
        (c) =>
          canonicalSpellId(c.spellId) === canonicalSpellId(cd.spellId) &&
          c.castTimeSeconds > cd.castTimeSeconds,
      );
      const end = observedEffectEnd(
        enemy,
        cd.spellId,
        cd.castTimeSeconds,
        next?.castTimeSeconds ?? Infinity,
        combat,
      );
      if (end === null) continue;
      // the observed aura's own official length (this caster's talents —
      // Thorim's Invocation lengthens Doom Winds' aura, not its press) from
      // its own start (codex 20-G167-06 #2 / #3); the press's when the aura
      // has none
      const auraFull = buffFullDurationForCaster(end.auraId, enemy);
      setObservedEnd(
        cd,
        end.endS,
        auraFull === undefined
          ? officialEndOf.get(cd)
          : end.lastFromS + auraFull,
        combat.units?.[end.holderId] as ICombatUnit | undefined,
      );
    }

    // GH #119: effects whose only evidence is an aura (Havoc Metamorphosis —
    // the button never logs —, Demonic, a Doom Winds with no logged press),
    // from the same round-bounded aura intervals the aura path reads
    const aura = auraOffensiveOccurrences(enemy, combat);
    for (const [castMs, endMs] of aura.observedEndOfCast) {
      const auraOfficialMs = aura.officialEndOfCast.get(castMs);
      const t = (castMs - matchStartMs) / 1000;
      const cast = offensiveCDs.find(
        (c) =>
          c.spellId === "384352" && Math.abs(c.castTimeSeconds - t) < 0.001,
      );
      if (cast)
        setObservedEnd(
          cast,
          (endMs - matchStartMs) / 1000,
          auraOfficialMs === undefined
            ? officialEndOf.get(cast)
            : (auraOfficialMs - matchStartMs) / 1000,
          enemy,
        );
    }
    const offensiveFacts: IEnemyCDCast[] = [];
    // only casts that were LOGGED — never an aura occurrence appended below
    // (codex re-review: two source-unknown forms [10,11] and [12,17] merged
    // into one [10,17] when the second matched the first)
    const loggedCasts = [...offensiveCDs];
    // one logged cast takes one aura occurrence, and an occurrence the
    // helper found no press for (`unresolved` — a cast-less Avenging Wrath
    // 2 s after a pressed one) is never folded into a press (codex
    // 20-F15-34: its 12.5–20.5 s interval stretched the 10 s cast)
    const mergedInto = new Set<IEnemyCDCast>();
    for (const o of aura.occurrences) {
      const castTimeSeconds = (o.startMs - matchStartMs) / 1000;
      // the aura a press made while unseen was restated from
      // (`pressRowsWithHidden`: the press sits at the aura's own instant) is
      // that press — whatever the occurrence's provenance (fact5 b2b 92-5
      // 2:19: Arcane Surge `(cast 3 of 3) [pressed while unseen]` beside
      // `(no press)` for one APPLIED)
      if (
        loggedCasts.some(
          (c) =>
            c.unseenPress &&
            c.spellId === o.spellId &&
            Math.abs(c.castTimeSeconds - castTimeSeconds) <= 0.05,
        )
      )
        continue;
      // a cast-less application beside a press the timeline has (a press
      // made unseen, `hiddenPressMs`, re-stated with the unit) is that press
      if (
        o.generic &&
        loggedCasts.some(
          (c) =>
            c.spellId === o.spellId &&
            c.castTimeSeconds <=
              castTimeSeconds + GENERIC_PRESS_AFTER_MS / 1000 &&
            c.castTimeSeconds >= castTimeSeconds - TWIN_CAST_BEFORE_S,
        )
      )
        continue;
      // a LOGGED press of the same cooldown already stands for this effect
      // (a 191427 button cast, should one ever log): merge the aura's end
      // into it instead of adding a second occurrence (codex review)
      const logged =
        o.provenance === "unresolved"
          ? undefined
          : loggedCasts.find(
              (c) =>
                !mergedInto.has(c) &&
                c.spellId === o.spellId &&
                Math.abs(c.castTimeSeconds - castTimeSeconds) <=
                  AURA_EVIDENCE_WINDOW_S,
            );
      if (logged) {
        mergedInto.add(logged);
        // an observed aura end replaces the estimate; an INFERRED one (the
        // aura's own official length — Summon Infernal's cast row is 0.25 s)
        // may only lengthen it: a re-application closes the interval early
        // and must not cut a correct 15 s estimate to 5 s (agy review)
        const auraEnd = (o.endMs - matchStartMs) / 1000;
        // the aura is the unit's own (`auraOffensiveOccurrences`)
        if (o.endObserved)
          setObservedEnd(
            logged,
            auraEnd,
            o.officialEndMs === undefined
              ? officialEndOf.get(logged)
              : (o.officialEndMs - matchStartMs) / 1000,
            enemy,
          );
        else if (o.provenance === "press-logged")
          logged.buffEndSeconds = Math.max(logged.buffEndSeconds, auraEnd);
        continue;
      }
      // its own official end (`officialEndMs` — a Demonic form's 5 s, not
      // Metamorphosis's 20, codex 20-G167-06 #1)
      const cutOfficialEnd =
        !o.endObserved || o.officialEndMs === undefined
          ? undefined
          : deathCutOfficialEnd(
              enemy,
              (o.endMs - matchStartMs) / 1000,
              (o.officialEndMs - matchStartMs) / 1000,
              combat,
            );
      (o.burstRole === "fact" ? offensiveFacts : offensiveCDs).push({
        ...(cutOfficialEnd !== undefined
          ? { deathCutOfficialEndSeconds: cutOfficialEnd }
          : {}),
        spellId: o.spellId,
        spellName: o.spellName,
        castTimeSeconds,
        cooldownSeconds: o.cooldownSeconds,
        availableAgainAtSeconds:
          o.availableAgainAtMs === null
            ? null
            : (o.availableAgainAtMs - matchStartMs) / 1000,
        buffEndSeconds: (o.endMs - matchStartMs) / 1000,
        dangerWeight: o.dangerWeight,
        ...(o.burstRole === "fact" ? { burstRole: "fact" as const } : {}),
        ...(o.availabilityUnknown ? { availabilityUnknown: true } : {}),
      });
    }

    offensiveCDs.sort((a, b) => a.castTimeSeconds - b.castTimeSeconds);

    if (offensiveCDs.length > 0 || offensiveFacts.length > 0) {
      players.push({
        playerName: enemy.name,
        specName: specToString(enemy.spec),
        offensiveCDs,
        ...(offensiveFacts.length > 0 ? { offensiveFacts } : {}),
      });
    }
  }

  // Find aligned burst windows: clusters of 2+ casts within BURST_CLUSTER_SECONDS
  const allCastsRaw = players
    .flatMap((p) =>
      p.offensiveCDs.map((cd) => ({
        time: cd.castTimeSeconds,
        buffEndSeconds: cd.buffEndSeconds,
        playerName: p.playerName,
        spellName: cd.spellName,
        spellId: cd.spellId,
        dangerWeight: cd.dangerWeight,
      })),
    )
    .sort((a, b) => a.time - b.time);

  const allCasts = allCastsRaw;

  // Compute the match-average friendly damage RATE for ratio calculation. Rates (not fixed-width
  // sums) so windows of different spans compare fairly — the old ±10s sample around the window START
  // mis-measured the damage of 69% of windows by >25% (91% of windows outlast 10s; 2026-07-03 audit).
  const allFriendlyDamage = (friendlies ?? []).flatMap((u) => u.damageIn);
  const totalFriendlyDamage = allFriendlyDamage.reduce(
    (sum, e) => sum + Math.abs(e.effectiveAmount),
    0,
  );
  const avgDamageRate =
    matchDurationSeconds > 0 ? totalFriendlyDamage / matchDurationSeconds : 0;

  // Group casts by ACTIVE-PRESSURE OVERLAP: a cast joins the current group if it lands while any of
  // the group's buffs is still running OR within BURST_CLUSTER_SECONDS of a group cast (superset of the
  // old cast-proximity clustering). Catches rolling bursts and staggered stacks the old 10s cast-cluster
  // missed (audit: 376 overlapping pairs across 249 games). A group becomes a window when it has 2+ CDs,
  // or a single CD heavy enough to be a solo kill-window (fixes the 122 zero-window games with deaths —
  // 2v2/Shuffle single-threat comps).
  const groups: (typeof allCasts)[] = [];
  {
    let current: typeof allCasts = [];
    let reach = -Infinity;
    for (const c of allCasts) {
      if (current.length === 0 || c.time <= reach) {
        current.push(c);
      } else {
        groups.push(current);
        current = [c];
      }
      reach = Math.max(reach, c.buffEndSeconds, c.time + BURST_CLUSTER_SECONDS);
    }
    if (current.length > 0) groups.push(current);
  }

  const alignedBurstWindows: IAlignedBurstWindow[] = [];
  for (const inWindow of groups) {
    const qualifies =
      inWindow.length >= 2 ||
      inWindow.some((c) => c.dangerWeight >= SOLO_WINDOW_MIN_WEIGHT);
    if (qualifies) {
      const windowStart = inWindow[0].time;
      // toSeconds = when the last buff in this window actually expires, not just when it was cast.
      // Uses buffEndSeconds (cast + durationSeconds) when available; falls back to cast time.
      const windowEnd = Math.max(...inWindow.map((c) => c.buffEndSeconds));

      // Compute CD-based danger score
      const cdScore = inWindow.reduce((sum, c) => sum + c.dangerWeight, 0);
      const alignmentMultiplier = inWindow.length >= 3 ? 1.5 : 1.0;

      // Damage over the ACTUAL window span [start, end], compared as a rate to the match average.
      const windowDamage = allFriendlyDamage
        .filter((e) => {
          const t = (e.logLine.timestamp - matchStartMs) / 1000;
          return t >= windowStart && t <= windowEnd;
        })
        .reduce((sum, e) => sum + Math.abs(e.effectiveAmount), 0);

      const windowSpan = Math.max(windowEnd - windowStart, 1);
      const damageRatio =
        avgDamageRate > 0
          ? Math.min(
              6.0,
              Math.max(windowDamage / windowSpan / avgDamageRate, 0.5),
            )
          : 0.5;

      // Dampening at window start. The stack events are read on the units
      // this call was handed (unchanged); the bracket is classified on the
      // round's whole roster (FT-T13, D10) — half of this function's callers
      // pass no `friendlies`, and for a bracket string that names no bracket
      // one side alone never counts as a 3v3 roster.
      const bracket = combat.startInfo?.bracket ?? "3v3";
      const allPlayers = [...enemies, ...(friendlies ?? [])];
      const roundUnits = Object.values(combat.units ?? {});
      const roster = roundUnits.length > 0 ? roundUnits : allPlayers;
      const windowStartAtMs = windowStart * 1000 + matchStartMs;
      // `dampening` is the STATED value — null in a 2v2 round that logged no
      // stack (FT-T13 D11); it is what `dampeningPct` carries to anything
      // that prints it. The threat score needs a weight even there and takes
      // it from `dampeningForThreatWeight` (0 for such a round).
      // the doses of the team the burst lands on — ours, when the caller
      // passed it (fact1215 R11, codex 20-F15-32: the teams tick apart)
      const dosesOf =
        friendlies && friendlies.length > 0 ? friendlies : allPlayers;
      const dampening = computeDampening(
        windowStartAtMs,
        bracket,
        dosesOf,
        roster,
      );
      const dampeningMult = dampeningDangerMultiplier(
        dampeningForThreatWeight(windowStartAtMs, bracket, dosesOf, roster),
      );

      // Hoist window timestamps here so both the healer CC block and HP sampling share the same values
      const windowStartMs = matchStartMs + windowStart * 1000;
      const windowEndMs = matchStartMs + windowEnd * 1000;
      const windowDuration = windowEnd - windowStart;

      // Healer CC explicit check: find if the healer had an active CC aura during this window
      let healerCCed = false;
      let ccDurationMs = 0;

      if (owner && isHealerSpec(owner.spec)) {
        const ccStartBySpell = new Map<string, number>();
        const ccIntervals: { start: number; end: number }[] = [];
        // a BROKEN line its aura's own REMOVED follows is not the end (FT-T08)
        const notTheEnd = supersededAuraBreaks(owner.auraEvents);
        for (const a of owner.auraEvents) {
          if (!a.spellId || notTheEnd.has(a)) continue;
          const entry = SPELLS[a.spellId];
          if (entry?.type === "cc") {
            if (
              a.logLine.event === LogEvent.SPELL_AURA_APPLIED ||
              a.logLine.event === LogEvent.SPELL_AURA_REFRESH
            ) {
              ccStartBySpell.set(a.spellId, a.logLine.timestamp);
            } else if (
              a.logLine.event === LogEvent.SPELL_AURA_REMOVED ||
              a.logLine.event === LogEvent.SPELL_AURA_BROKEN ||
              a.logLine.event === LogEvent.SPELL_AURA_BROKEN_SPELL
            ) {
              const ccStart = ccStartBySpell.get(a.spellId) ?? 0;
              const ccEnd = a.logLine.timestamp;
              if (
                ccStart > 0 &&
                ccStart < windowEndMs &&
                ccEnd > windowStartMs
              ) {
                ccIntervals.push({
                  start: Math.max(ccStart, windowStartMs),
                  end: Math.min(ccEnd, windowEndMs),
                });
              }
              ccStartBySpell.delete(a.spellId);
            }
          }
        }

        // Active CCs at match end
        for (const ccStart of ccStartBySpell.values()) {
          if (ccStart < windowEndMs && combat.endTime > windowStartMs) {
            ccIntervals.push({
              start: Math.max(ccStart, windowStartMs),
              end: Math.min(combat.endTime, windowEndMs),
            });
          }
        }

        if (ccIntervals.length > 0) {
          ccIntervals.sort((a, b) => a.start - b.start);
          const merged: { start: number; end: number }[] = [];
          let current = ccIntervals[0];
          for (let i = 1; i < ccIntervals.length; i++) {
            const next = ccIntervals[i];
            if (next.start <= current.end) {
              current.end = Math.max(current.end, next.end);
            } else {
              merged.push(current);
              current = next;
            }
          }
          merged.push(current);

          ccDurationMs = merged.reduce(
            (sum, interval) => sum + (interval.end - interval.start),
            0,
          );
        }

        healerCCed = ccDurationMs > 0;

        // Fallback: pseudo-CCed (long window, cast nothing)
        if (!healerCCed && windowDuration >= 5) {
          const ownerCastsInWindow = owner.spellCastEvents.filter((e) => {
            const t = (e.logLine.timestamp - matchStartMs) / 1000;
            return t >= windowStart && t <= windowEnd;
          });
          if (ownerCastsInWindow.length === 0) {
            healerCCed = true;
            ccDurationMs = windowDuration * 1000;
          }
        }
      }

      const ccFraction = ccDurationMs / Math.max(windowDuration * 1000, 1);
      const healerMult = 1.0 + ccFraction * 0.8;

      // Threat (ex-ante: what the stacked CDs could do) is kept separate from outcome factors
      // (damageRatio, healer CC) so a perfectly-defended Critical burst still reads as Critical
      // threat — otherwise the coach never sees (or reinforces) the player's best defensive play.
      const threatScore = cdScore * alignmentMultiplier * dampeningMult;
      const score = threatScore * damageRatio * healerMult;

      // Find the most-pressured friendly unit (highest damageIn during the burst window).
      // B4 fix: HP endpoint readings must be sampled NEAR the endpoint they claim to
      // represent. The old radius (half the burst duration, up to ±9s+) let a "start HP"
      // reading come from mid-window, contradicting the [STATE] snapshots at the same
      // timestamp and feeding coach errors. ±3s matches the [DMG SPIKE] sampling (±2s)
      // closely; when no sample exists that near, render nothing instead of a wrong number.
      const hpLookupRadiusMs = HP_SAMPLE_RADIUS_MS;
      let mostPressuredTarget: IAlignedBurstWindow["mostPressuredTarget"];
      if (friendlies && friendlies.length > 0) {
        let topUnit: ICombatUnit | null = null;
        let topDmg = 0;
        for (const f of friendlies) {
          const dmg = f.damageIn
            .filter(
              (d) =>
                d.logLine.timestamp >= windowStartMs &&
                d.logLine.timestamp <= windowEndMs,
            )
            .reduce((sum, d) => sum + Math.abs(d.effectiveAmount), 0);
          if (dmg > topDmg) {
            topDmg = dmg;
            topUnit = f;
          }
        }
        if (topUnit && topDmg > 0) {
          const midMs = windowStartMs + (windowEndMs - windowStartMs) / 2;
          mostPressuredTarget = {
            unitName: topUnit.name,
            startHpPct: getUnitHpAtTimestamp(
              topUnit,
              windowStartMs,
              hpLookupRadiusMs,
            ),
            midHpPct: getUnitHpAtTimestamp(topUnit, midMs, hpLookupRadiusMs),
            endHpPct: getUnitHpAtTimestamp(
              topUnit,
              windowEndMs,
              hpLookupRadiusMs,
            ),
          };
        }
      }

      alignedBurstWindows.push({
        fromSeconds: windowStart,
        toSeconds: windowEnd,
        activeCDs: inWindow.map((c) => ({
          playerName: c.playerName,
          spellName: c.spellName,
          spellId: c.spellId,
          castSeconds: c.time,
        })),
        threatScore,
        threatLabel: dangerLabel(threatScore),
        dangerScore: score,
        dangerLabel: dangerLabel(score),
        dampeningPct: dampening,
        damageInWindow: windowDamage,
        damageRatio,
        healerCCed,
        mostPressuredTarget,
      });
    }
  }

  return { players, alignedBurstWindows };
}

/**
 * Renders the enemy CD timeline as plain text lines for inclusion in the AI context prompt.
 * Outputs burst window summaries only — individual per-player cast timestamps are captured
 * by MATCH ARC and would dilute LLM attention if repeated here.
 */
export function formatEnemyCDTimelineForContext(
  timeline: IEnemyCDTimeline,
  matchDurationSeconds: number,
): string[] {
  const lines: string[] = [];

  lines.push("## Enemy Cooldown Timeline");

  if (timeline.alignedBurstWindows.length === 0) {
    lines.push(
      timeline.players.length === 0
        ? "  No enemy offensive cooldown data found."
        : "  No coordinated enemy burst windows detected — sustained/individual pressure only.",
    );
    return lines;
  }

  lines.push(
    "  (Threat = strength of the stacked CDs before outcome; Outcome = what actually happened. High threat with below-average damage usually means the burst was well defended — worth crediting.)",
  );
  timeline.alignedBurstWindows.forEach((w, idx) => {
    // No `| Dampening:` where none is stated (a 2v2 round with no logged stack)
    const dampStr =
      w.dampeningPct === null
        ? ""
        : ` | Dampening: ${fmtDampening(w.dampeningPct)}`;
    // Each CD carries its own cast time: the window is the union of "earliest
    // cast -> latest buff end", and a list without times was once read as
    // everything popping at the window start (059).
    const cdNames = w.activeCDs
      .map(
        (c) =>
          `${c.spellName} (${c.playerName}, cast ${fmtTime(c.castSeconds)})`,
      )
      .join(" + ");
    const dmgM = (w.damageInWindow / 1_000_000).toFixed(2);
    const ratioStr = `${w.damageRatio.toFixed(1)}× match avg rate`;
    const healerStr = w.healerCCed ? "healer CCed" : "healer free";
    lines.push(
      `  #${idx + 1} — ${fmtTime(w.fromSeconds)}–${fmtTime(w.toSeconds)} | Threat: ${w.threatLabel} (${w.threatScore.toFixed(1)})${dampStr}`,
    );
    lines.push(`    CDs: ${cdNames}`);
    lines.push(`    Outcome: ${dmgM}M damage (${ratioStr}) | ${healerStr}`);
    if (w.mostPressuredTarget) {
      const t = w.mostPressuredTarget;
      const hpStr = [
        t.startHpPct !== null ? `${t.startHpPct}% start` : null,
        t.midHpPct !== null ? `${t.midHpPct}% mid` : null,
        t.endHpPct !== null ? `${t.endHpPct}% end` : null,
      ]
        .filter(Boolean)
        .join(" → ");
      if (hpStr) lines.push(`    Most pressured: ${t.unitName} HP: ${hpStr}`);
    }
  });

  // Include never-used offensive CDs as hallucination guard: if an enemy CD never appeared
  // in a burst window, Claude should not claim it was used as part of a coordinated burst.
  const unusedByCDId = new Set<string>();
  for (const player of timeline.players) {
    for (const cd of player.offensiveCDs) {
      if (
        cd.availableAgainAtSeconds !== null &&
        cd.availableAgainAtSeconds > matchDurationSeconds
      ) {
        unusedByCDId.add(
          `${player.specName}: ${cd.spellName} — not used again after ${fmtTime(cd.castTimeSeconds)}`,
        );
      }
    }
  }
  if (unusedByCDId.size > 0) {
    // Observational wording only: static CDs are often shortened by talents/procs (2026-07-03 audit:
    // 2062 earlier-than-static recasts across the corpus), so never claim a CD "was still unavailable" —
    // only that it was not SEEN again.
    lines.push(
      "  Not cast again before the match ended (note: talents/procs often shorten real cooldowns, so availability is not implied): " +
        [...unusedByCDId].join("; "),
    );
  }

  return lines;
}

/*
 * 2026-08-23 删除 `formatKillAttemptWindowsForContext` 与 `KILL_ATTEMPT_SPIKE_THRESHOLD`
 * (原在此处,共 73 行)—— **全仓零调用者**。
 *
 * 它想做的事(把敌方爆发窗口和随之而来的伤害峰值接在一起)现在由两处活代码承担:
 * prompt 里的 `[OFFENSIVE WINDOW]` 行(格式几乎逐字相同:`peak spike … over … | CDs: …`;
 * 255 个回合里 100% 出现、每局 2.8 行),以及 2026-08-18 击杀重设计后的
 * `killAttempts.ts#formatKillAttemptsForContext`(判据是三档机会模型 PRIME/gated/locked,
 * 不再看伤害阈值;同一批回合 100% 出现、每局 1.0 行)。
 *
 * 发现路径值得记:它是「拍脑袋常量清查」(GH #34)里被点名的绝对数值之一,查出处时
 * 才发现它守的是一段没人调的代码 —— **一个常量没有出处,有时候不是因为没人记,
 * 是因为它守的东西已经没人用了。**
 */

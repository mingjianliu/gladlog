import {
  AtomicArenaCombat,
  CombatUnitType,
  ICombatUnit,
  IMissEvent,
  LogEvent,
} from "@gladlog/parser-compat";

import {
  castAndEffectIds,
  effectSpanIdsOfCast,
  TALENT_EFFECT_AURAS_OF_CAST,
  triggeredEffectAurasOfCast,
} from "../data/castEffectAuras";
import {
  CHANNELED_SPELL_IDS,
  HASTE_DURATION_SPELL_IDS,
} from "../data/channeledGenerated";
import { isOffensivePressFactFor } from "../data/enemyHealCds";
import { isHealerHeldOffensive } from "../data/healerHeldOffensive";
import {
  PERIODIC_TRIGGER_SPELLS,
  SCRIPTED_PERIODIC_TRIGGER_AURA_IDS,
} from "../data/periodicAuraGenerated";
import { ROOT_AURA_SPELL_IDS } from "../data/rootAuraGenerated";
import { SPELL_CATEGORIES as spellsData } from "../data/spellCategories";
import {
  effectiveCooldownSeconds,
  getEnglishSpellName,
  spellEffectData,
} from "../data/spellEffectData";
import {
  buildAuraIntervals,
  dropAuraRebroadcasts,
  type IAuraInterval,
  supersededAuraBreaks,
} from "./auraIntervals";
import { buffDurationOfApplication } from "./buffDuration";
import { channelEndSeconds, channelRefusedAtCast } from "./castCommitSpans";
import {
  identityToken,
  roundFingerprint,
  roundValue,
  unitTokens,
} from "./combatMemo";
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
import { logInstantOf } from "./logEra";
import { fmtTime } from "./renderGrid";
import { roundEndMs, shuffleRoundEndMs } from "./roundEnd";
import {
  AURA_NATURAL_END_JITTER_S,
  DEATH_CASCADE_MS,
  deathTeardownWindowsMs,
  firstDeathMs,
} from "./unitDeath";

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
import { offensiveCooldownIdAt } from "./overrideVariantEra";
import {
  dangerLabel,
  OFFENSIVE_EFFECT_ACTIVATION_IDS,
  offensiveDangerWeight,
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
  /** With `deathCutOfficialEndSeconds`: the instant that cut it — the
   * caster's own death (it wore the aura), or the Solo Shuffle round's
   * ending one. From that instant's rendered second on the death is printed
   * (`[DEATH]`) and the effect is over: the official time left above is only
   * for rows before it (T03, fact12 D18). A target's death cut sets none: it
   * ends that copy, not the effect. Also set without the official end above
   * when a Solo Shuffle round's end ended an effect whatever its span
   * read (`cutAtRoundEnd`, T28). */
  deathCutAtSeconds?: number;
  /** T29: the game refused this press's effect
   * (`pressEffectRefusedAtCast`: a miss, nothing landed) — it ran for no
   * time (`buffEndSeconds` is the press). The press stays a fact (its
   * cooldown is spent); no `[RES]` entry, burst window or defensive timing
   * reads it as an effect. */
  refusedAtPress?: true;
  /** T72 attempt 2: `buffEndSeconds` is the press's delivery
   * (`pressDeliveryEndSeconds`) — the press has no effect aura and no
   * official length. What the scan counts such presses by, whatever end the
   * reading gave them (codex 81-tk-G-T72-2 #2). */
  endIsDelivery?: true;
  /** T41: the effect was still up when the analysed slice ended, and this
   * is its own end, past the slice's — what `[RES]` counts `Ns left` to
   * (`enemyEffectOwnEndSeconds`). `buffEndSeconds` stays the end every
   * other reader had before T41 (at the slice's end, or the cast's own
   * official one): a burst window's damage is a rate over its span and its
   * segments, outcome horizon and kill windows are of what the slice shows
   * (codex 80-PIPE-51-B50: with the own end in `buffEndSeconds` each reader
   * had to opt out, and `boundedBurstSegments` had not). */
  ownEndSeconds?: number;
  /** Inside `reconstructEnemyCDTimeline` only — never on a returned cast:
   * the end `buffEndSeconds` goes back to once the builder's own steps
   * (death cut, round-end cut) have read the effect's own end. */
  windowEndSeconds?: number;
  /** T29 R14: the refusing row's miss type (`pressRefusalMissType`) */
  refusedMissType?: string;
  /** T29 R14: the end the press had before the refusal cut it to the press
   * (its official / observed window) — kill attempts, which read the press
   * as an intent, keep it */
  refusedOfficialEndSeconds?: number;
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
   * pick one up by accident; only the [ENEMY CD] renderer reads this, and
   * the [RES] `enemy:` column for a row with an effect span (fact7 class 3). */
  readonly offensiveFacts?: readonly IEnemyCDCast[];
  /** The player's first death, seconds from the round's start; absent when
   * they did not die. An effect the death ended is over from its rendered
   * second on (the `[RES]` `enemy:` column, T03). */
  readonly deathSeconds?: number;
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
 * fact10 D20 (46eb2199 1:21): the longest run of `auraId` the unit put on
 * itself and the round closed before `beforeMs` — APPLIED → REMOVED, both by
 * the round's end (`roundEndMs`), no REFRESH between — in seconds, or
 * undefined when it completed none. A length that moves with haste (DB2
 * SpellMisc Attributes_8 bit 17, `HASTE_DURATION_SPELL_IDS`) has no
 * official end; the unit's own completed run is what the log says
 * this caster's haste made of it — for a haste-scaled aura, not a channel
 * its caster can stop early (Bladestorm 446035 pressed 1:19.85, its
 * REMOVED 0.2 s past the round-ending death; the round's first Bladestorm
 * ran 5.07 s of the official 6, and `[RES]` read "5s left" with 4 s left).
 * The longest run: a cancelled one is shorter, never longer.
 */
export function ownCompletedRunSeconds(
  unit: Pick<ICombatUnit, "id" | "auraEvents">,
  auraId: string,
  beforeMs: number,
  combat: AtomicArenaCombat,
): number | undefined {
  const endMs = roundEndMs(combat);
  let open: number | null = null;
  let longest: number | undefined;
  const rows = (unit.auraEvents ?? [])
    .filter(
      (a) =>
        a.spellId === auraId &&
        a.srcUnitId === unit.id &&
        a.destUnitId === unit.id &&
        a.logLine.timestamp < beforeMs &&
        a.logLine.timestamp <= endMs,
    )
    .sort((a, b) => a.logLine.timestamp - b.logLine.timestamp);
  for (const a of rows) {
    const ev = a.logLine.event as LogEvent;
    if (ev === LogEvent.SPELL_AURA_APPLIED) open = a.logLine.timestamp;
    else if (ev === LogEvent.SPELL_AURA_REMOVED && open !== null) {
      const s = (a.logLine.timestamp - open) / 1000;
      longest = Math.max(longest ?? 0, s);
      open = null;
    } else open = null;
  }
  return longest;
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
  const end = observedEffectEnd(
    caster,
    castSpellId,
    castS,
    nextSameCastS,
    combat,
    onlyDestId,
  );
  if (end !== null) return end.endS;
  // a press the game refused ran for no time at all (T29)
  return pressEffectRefusedAtCast(
    caster,
    castSpellId,
    combat.startTime + castS * 1000,
    combat.startTime + nextSameCastS * 1000,
    combat,
  )
    ? castS
    : null;
}

/**
 * T29: did the game refuse this press's effect? A SPELL_MISSED of the cast
 * or one of its effect ids (`effectSpanIdsOfCast`) by the caster inside the
 * press's start window ([press, press + `EFFECT_START_AFTER_S`]) — any miss
 * type but ABSORB: an absorbed hit landed (Takedown's own buff ran on a hit
 * a shield ate) — on the press's own target when its cast row names one (a
 * Divine Toll IMMUNE on a second enemy while its Judgment struck the cast's
 * target refused nothing: 0284fcd9 r1 2:17) — and nothing of the press
 * landed at all before the caster's next press of it (`untilMs`, or the
 * caster's next cast row of the spell, whichever is first — a row of the
 * press's own ids before its next press is its effect: Meteor's IMMUNE on a
 * Chi-Ji at the press while its impact struck two players 2.2 s later,
 * 7da6cb8d r1 0:20): no APPLIED / REFRESH /
 * APPLIED_DOSE (from `EFFECT_START_BEFORE_S` before the press), damage or
 * heal row (a fully absorbed hit's ABSORB miss included) or summon
 * (SPELL_SUMMON; any summon inside the start window — a talent's summon
 * has its own id) by the caster of those ids or of the press's English name (the
 * channel refusal's reading, `channelRefusedAtCast`: Frozen Orb's IMMUNE on
 * 84714 while its orb's 84721 hits, same name, ran on). The effect never
 * ran, so its window ends at the press. fact12 (T03-1 residual): b74d7bf6
 * r1 2:45, Deathmark met two IMMUNE and put no 360194 on anyone — `[RES]`
 * listed it to 3:00 on the official 16 s. Returns the refusing miss row
 * (its type: `pressRefusalMissType`), undefined when the press was not
 * refused.
 */
export function pressRefusalMissRow(
  caster: Pick<ICombatUnit, "id"> &
    Partial<
      Pick<
        ICombatUnit,
        "missesOut" | "damageOut" | "healOut" | "spellCastEvents"
      >
    >,
  castSpellId: string,
  castMs: number,
  /** the caster's next press of the same spell (Infinity when none; the
   * caster's own next cast row of it bounds it too) */
  untilMs: number,
  combat: { units?: Readonly<Record<string, ICombatUnit>> },
): IMissEvent | undefined {
  const ids = effectSpanIdsOfCast(castSpellId);
  const name = getEnglishSpellName(castSpellId, "");
  const mine = (r: {
    srcUnitId?: string;
    spellId?: string;
    spellName?: string;
  }) =>
    r.srcUnitId === caster.id &&
    !!r.spellId &&
    (ids.has(r.spellId) ||
      (name !== "" &&
        getEnglishSpellName(r.spellId, r.spellName ?? "") === name));
  const casts = (caster.spellCastEvents ?? []).filter(
    (e) => e.logLine.event === LogEvent.SPELL_CAST_SUCCESS,
  );
  // the next press that owns the press's effect rows — a cast row of the
  // caster of its ids or its name (codex T29-1g #1: Frostwyrm's Fury
  // 1265384 refused at 20.994, a 279302 cast at 113.470 struck 279303) —
  // bounds the window, and the rows it may log ahead of its own cast row
  // (`EFFECT_START_BEFORE_S`, the aura lead) are that press's: none of them
  // is a landing of this one (codex T29-1b #1: a Ray of Frost hit at the
  // next press's 12.168 rescued the refused 10.000; codex T29-1g #2:
  // Execution Sentence's 1234189 applied 1 ms before the next press's row)
  // (a cast row of its effect ids inside the start window is the press's
  // own: Odyn's Fury logs its 385060 / 385061 / 385062 swings as casts)
  const nextOwnMs =
    casts.find(
      (e) =>
        e.logLine.timestamp > castMs &&
        (e.spellId === castSpellId ||
          (mine(e) &&
            e.logLine.timestamp > castMs + EFFECT_START_AFTER_S * 1000)),
    )?.logLine.timestamp ?? Infinity;
  const lastMs =
    Math.min(untilMs, nextOwnMs) - EFFECT_START_BEFORE_S * 1000 - 1;
  const startToMs = Math.min(castMs + EFFECT_START_AFTER_S * 1000, lastMs);
  const toMs = lastMs;
  // the press's own target, when its cast row names one: a refusal on
  // another unit of a press that strikes several (Divine Toll) is no
  // refusal of the press
  const castDest = casts.find(
    (e) => e.logLine.timestamp === castMs && e.spellId === castSpellId,
  )?.destUnitId;
  const target =
    castDest && castDest !== "0000000000000000" ? castDest : undefined;
  const refusal = (caster.missesOut ?? []).find(
    (m) =>
      m.missType !== "ABSORB" &&
      m.srcUnitId === caster.id &&
      (target === undefined || m.destUnitId === target) &&
      !!m.spellId &&
      ids.has(m.spellId) &&
      m.logLine.timestamp >= castMs &&
      m.logLine.timestamp <= startToMs,
  );
  if (!refusal) return undefined;
  // a hit a shield ate in full is logged as an ABSORB miss: it landed
  if (
    [
      ...(caster.damageOut ?? []),
      ...(caster.healOut ?? []),
      ...(caster.missesOut ?? []).filter((m) => m.missType === "ABSORB"),
    ].some(
      (d) =>
        mine(d) && d.logLine.timestamp >= castMs && d.logLine.timestamp <= toMs,
    )
  )
    return undefined;
  for (const u of Object.values(combat.units ?? {}))
    for (const a of u.auraEvents ?? []) {
      const ev = a.logLine.event;
      if (
        mine(a) &&
        (ev === LogEvent.SPELL_AURA_APPLIED ||
          ev === LogEvent.SPELL_AURA_REFRESH ||
          ev === LogEvent.SPELL_AURA_APPLIED_DOSE) &&
        a.logLine.timestamp >= castMs - EFFECT_START_BEFORE_S * 1000 &&
        a.logLine.timestamp <= toMs
      )
        return undefined;
    }
  // a press that put down a summon ran its effect through it, whatever its
  // own row on the target read: a SPELL_SUMMON by the caster (the summoned
  // unit's `actionIn`) of the press's ids or name inside its window
  // (39-3-227 r3 2:11, Grimoire: Imp Lord IMMUNE in the same millisecond
  // its Imp Lord was summoned and fought on), or of any spell inside the
  // press's start window — a talent's summon carries its own id and name
  // (codex T29-1e, 310e5c6d r6 3:13: Soul Fire MISS, its Avatar of
  // Destruction Overfiend 434587 summoned 7 ms after the press, 7k damage).
  // An unrelated summon there keeps a refused press's official window: the
  // pre-T29 reading, the safe side.
  for (const u of Object.values(combat.units ?? {}))
    for (const a of u.actionIn ?? []) {
      if (
        a.logLine.event !== LogEvent.SPELL_SUMMON ||
        a.srcUnitId !== caster.id ||
        a.logLine.timestamp < castMs - EFFECT_START_BEFORE_S * 1000
      )
        continue;
      if (a.logLine.timestamp <= startToMs) return undefined;
      if (mine(a) && a.logLine.timestamp <= toMs) return undefined;
    }
  return refusal;
}

/** The refusing miss row's type (IMMUNE, MISS, DODGE …) of
 * `pressRefusalMissRow`, undefined when the press was not refused — the
 * reading every refusal marker prints (T29 R15). */
export function pressRefusalMissType(
  ...args: Parameters<typeof pressRefusalMissRow>
): string | undefined {
  const row = pressRefusalMissRow(...args);
  return row ? (row.missType ?? "MISS") : undefined;
}

/** `pressRefusalMissType` as a yes / no: did the game refuse this press. */
export function pressEffectRefusedAtCast(
  ...args: Parameters<typeof pressRefusalMissType>
): boolean {
  return pressRefusalMissType(...args) !== undefined;
}

/** The talent aura (`TALENT_EFFECT_AURAS_OF_CAST`) this caster applied —
 * or refreshed — on itself inside a press's start window, if any: the press
 * had the talent and its effect ran, whatever the log shows of its end. */
export function talentEffectAuraAtPress(
  caster: ICombatUnit,
  castSpellId: string,
  castS: number,
  matchStartMs: number,
): string | undefined {
  const auras = TALENT_EFFECT_AURAS_OF_CAST[castSpellId];
  if (auras === undefined) return undefined;
  const castMs = matchStartMs + castS * 1000;
  return (caster.auraEvents ?? []).find(
    (a) =>
      !!a.spellId &&
      auras.includes(a.spellId) &&
      a.srcUnitId === caster.id &&
      (a.logLine.event === LogEvent.SPELL_AURA_APPLIED ||
        a.logLine.event === LogEvent.SPELL_AURA_REFRESH) &&
      a.logLine.timestamp >= castMs - EFFECT_START_BEFORE_S * 1000 &&
      a.logLine.timestamp <= castMs + EFFECT_START_AFTER_S * 1000,
  )?.spellId;
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
  /** T41: where the chain read as ending before the clamp guard looked at
   * the chain's own aura and its own length — `windowEndSeconds` */
  out?: { windowEndS?: number },
): {
  endS: number;
  holderId: string;
  /** the chain's aura and this press's application of it
   * (`pressAppliedS`) — where an official end is read from (codex
   * 20-G167-06) */
  auraId: string;
  appliedS: number;
} | null {
  // the cast's effect auras, and a talent's aura it runs on (Divine Toll's
  // Divine Resonance, GH #184 part B)
  const ids = effectSpanIdsOfCast(castSpellId);
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
  let noPressStarts: Array<{ startMs: number; spellId: string }> | undefined;
  const ownNoPressStartsAt = (iv: { fromS: number; spellId: string }) => {
    noPressStarts ??= auraOffensiveOccurrences(caster, combat)
      .occurrences.filter((o) => o.generic)
      .map((o) => ({ startMs: o.startMs, spellId: o.spellId }));
    const ms = combat.startTime + iv.fromS * 1000;
    return noPressStarts.some(
      (o) =>
        Math.abs(o.startMs - ms) <= 1 &&
        (o.spellId === iv.spellId ||
          castAndEffectIds(o.spellId).has(iv.spellId)),
    );
  };
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
    // fact10 D11 / D27: a triggered aura that is a DB2 root
    // (`ROOT_AURA_SPELL_IDS`, aura 26 / 455) is a side effect too — The
    // Hunt's root 370970 clears the 0.9 trigger share (95 % of 1246167's
    // presses), so when the log wrote it 1 ms before the DoT 1246168 it
    // headed the chain and Predator's Wake's span stopped at the root's end
    // (11890839 1:36; the DoT ran to 1:41). Which row comes first is the
    // log's order, not the game's.
    const sideEffect = (id: string): boolean =>
      !triggered.has(id) || ROOT_AURA_SPELL_IDS.has(id);
    if (
      first >= 0 &&
      ivs[first]!.spellId !== castSpellId &&
      sideEffect(ivs[first]!.spellId)
    ) {
      const main = ivs.findIndex(
        (iv) => startsAtPress(iv) && !sideEffect(iv.spellId),
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
      // fact11 D24 / D30 / D41: a re-application the timeline lists as an
      // occurrence of its own — a cast-less `(no press)` one
      // (`auraOffensiveOccurrences`' generic branch) — is that occurrence's,
      // not this press's: Soul Immolation pressed 1:04.06, removed 1:09.06,
      // a proc 1:09.32–1:14.33 and another to 1:19.58 — the press's span
      // ran to 1:19.58 and the burst ledger credited the procs twice
      if (dest === caster.id && ownNoPressStartsAt(iv)) break;
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
  /** Where this press's own application of the chain's aura is: its
   * APPLIED / REFRESH inside the press's start window (the press that
   * refreshed an aura already up restarts it, codex 20-G167-11 #1) — not a
   * later press's refresh (20-G167-14 #1), nor an application no press made
   * (a rebroadcast, a talent re-application, #2). Else the last interval's
   * start. */
  const pressAppliedS = (b: {
    destId: string;
    auraId: string;
    lastFromS: number;
  }): number => {
    let at: number | undefined;
    // re-broadcast pairs dropped first, as the interval builder does (codex
    // 20-G167-15: a REMOVED + APPLIED at 11.5 s restarted the length)
    for (const a of dropAuraRebroadcasts(auraRowsOf(b.destId, true))) {
      if (a.spellId !== b.auraId) continue;
      if (
        a.logLine.event !== LogEvent.SPELL_AURA_APPLIED &&
        a.logLine.event !== LogEvent.SPELL_AURA_REFRESH
      )
        continue;
      const t = (a.logLine.timestamp - combat.startTime) / 1000;
      if (t < castS - EFFECT_START_BEFORE_S || t > castS + EFFECT_START_AFTER_S)
        continue;
      if (t >= nextSameCastS) continue;
      if (at === undefined || t > at) at = t;
    }
    return at ?? b.lastFromS;
  };
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
    // …of the chain's own aura: the rows hold every effect id of the cast,
    // and another one's REMOVED inside the combat hid the clamp (T41, 605
    // s0/34-2: Incarnation: Avatar of Ashamane up 104.2 s, a side aura of
    // the press off at 104.4 s, its own REMOVED at 124.2 s past the 121.3 s
    // end — `11s left` at 1:50 against 14)
    const chainAura = best.auraId;
    const closing = dropAuraRebroadcasts(
      auraRowsOf(best.destId, true).filter((a) => a.spellId === chainAura),
    )
      .filter(
        (a) =>
          a.logLine.event === LogEvent.SPELL_AURA_REMOVED &&
          a.logLine.timestamp >= fromMs,
      )
      .sort((x, y) => x.logLine.timestamp - y.logLine.timestamp)[0];
    // a REMOVED of another effect id of the press inside the combat: what
    // read as the chain's observed end, at the clamp, before T41
    const sideClosedInside = dropAuraRebroadcasts(
      auraRowsOf(best.destId, true),
    ).some(
      (a) =>
        a.logLine.event === LogEvent.SPELL_AURA_REMOVED &&
        a.logLine.timestamp >= fromMs &&
        a.logLine.timestamp <= combat.endTime,
    );
    if (closing && closing.logLine.timestamp > combat.endTime) {
      // …unless the log shows it outliving its official length: still up
      // when the combat ended, past `cast + official`, it ran at least to the
      // combat's end (round-1 retest idx 64, a2e71187: a talent-lengthened
      // Dragonrage up 29.5 s against 18 s read as ending at cast + 18 s). A
      // clamp before the official end leaves the official end standing (the
      // Kingsbane case).
      // The effect's own aura, when it is not the cast's (Feral Frenzy's
      // 1 s self aura 274837 and its 6 s bleed 274838), has its own length,
      // from this press's application of it — the official end the timeline
      // already reads off an observed chain (codex 20-G167-06): still due
      // past the combat's end, the effect runs to it (T41, 605 s0/34-2
      // 1:59: `Feral Frenzy/Feral Druid(2s left)`, the bleed refreshed at
      // 118.99 s and removed at 124.50 s, the slice over at 121.34 s).
      const auraFull =
        best.auraId === castSpellId
          ? undefined
          : buffDurationOfApplication(
              best.auraId,
              caster,
              combat.startTime + pressAppliedS(best) * 1000,
            );
      // …and only to lengthen: an effect aura shorter than the cast's own
      // length is a side effect of the press, not its span (codex
      // 85-tk-G-T41-1 #1: Summon Infernal's 30 s read as its 2 s landing
      // stun's when the stun's REMOVED fell after the slice's end)
      // each from its own application (batch review 80-PIPE-64-B62: a
      // Capacitance holder's Avatar still up at the slice's end read 30 s
      // for the 34 s its two Thunder Blasts made it)
      const castFull = buffDurationOfApplication(
        castSpellId,
        caster,
        combat.startTime + castS * 1000,
      );
      const appliedS = pressAppliedS(best);
      // …nor when the cast's own aura went up on that unit with the press:
      // that aura is the effect, and the chain's (logged a millisecond
      // ahead of it) a side one, whatever length its id reads (codex
      // 85-tk-G-T41-1b #2: Incarnation's 252071 heading the chain, removed
      // just past the slice's end, gave the form `30s left` against 20)
      const castAuraOnHolder = mine.some(
        (m) =>
          m.destId === best.destId &&
          m.iv.spellId === castSpellId &&
          m.iv.fromS >= castS - EFFECT_START_BEFORE_S &&
          m.iv.fromS <= castS + EFFECT_START_AFTER_S,
      );
      if (
        auraFull !== undefined &&
        !castAuraOnHolder &&
        (castFull === undefined ||
          Math.max(combatEndS, appliedS + auraFull) >
            Math.max(combatEndS, castS + castFull))
      ) {
        if (out && appliedS + auraFull > combatEndS) {
          // …where the chain read as ending before: at the clamp when a
          // side aura's REMOVED hid it, else the cast's own official end
          // (never before the slice's end). A cast with no length of its
          // own ran on its talent aura's already (Divine Toll's Divine
          // Resonance) — nothing to keep.
          if (sideClosedInside) out.windowEndS = combatEndS;
          else if (castFull !== undefined)
            out.windowEndS = Math.max(combatEndS, castS + castFull);
        }
        return {
          endS: Math.max(combatEndS, appliedS + auraFull),
          holderId: best.destId,
          auraId: best.auraId,
          appliedS,
        };
      }
      const full = castFull;
      if (out && sideClosedInside) out.windowEndS = combatEndS;
      return full !== undefined && castS + full < combatEndS
        ? {
            endS: combatEndS,
            holderId: best.destId,
            auraId: best.auraId,
            appliedS,
          }
        : null;
    }
  }
  return best?.observed
    ? {
        endS: lastPeriodicTriggerEndS(caster, best.auraId, best.end, combat),
        holderId: best.destId,
        auraId: best.auraId,
        appliedS: pressAppliedS(best),
      }
    : null;
}

/** How long after a periodic-trigger aura's REMOVED its last trigger is
 * still its own (fact10 D29). Cover set, 1,746 own REMOVED rows of a
 * `PERIODIC_TRIGGER_SPELLS` aura: every trigger row after one within 1 s sits
 * at ≤ 71 ms (Bladestorm 107, Immolation Aura 73, Dark Harvest 61, Fel
 * Devastation 26, Boomstick 14 …) except Remorseless Winter's ground pulses
 * at 561–911 ms, a different effect. */
export const PERIODIC_LAST_TRIGGER_SLACK_MS = 100;

/**
 * fact10 D29 (1cbbdcb3 Burst #3, 2:01.766): a periodic-trigger aura's
 * (`PERIODIC_TRIGGER_SPELLS`, DB2 effect 23 / 227) last trigger is logged
 * just after its REMOVED — Boomstick 1261193's fourth volley 1261215 1 ms
 * later, Burst #1's 12 ms — and is the effect's own: the effect ends at that
 * row, by the caster (pets merged), within
 * `PERIODIC_LAST_TRIGGER_SLACK_MS` and not past the combat's end.
 */
export function lastPeriodicTriggerEndS(
  caster: ICombatUnit,
  auraId: string,
  endS: number,
  combat: AtomicArenaCombat,
): number {
  const ids = PERIODIC_TRIGGER_SPELLS.get(auraId);
  // one the game scripts (`SCRIPTED_PERIODIC_TRIGGER_AURA_IDS`, no trigger
  // id in DB2) fires a spell of its own name — Void Ray 473728's 1214595,
  // 1 ms after its REMOVED (cover set 32-4 r4 1:05)
  const scriptedName = SCRIPTED_PERIODIC_TRIGGER_AURA_IDS.has(auraId)
    ? getEnglishSpellName(auraId, "")
    : "";
  if (!ids && !scriptedName) return endS;
  const fires = (d: { spellId?: string; spellName?: string }) =>
    !!d.spellId &&
    (ids
      ? ids.includes(d.spellId)
      : getEnglishSpellName(d.spellId, d.spellName ?? "") === scriptedName);
  const endMs = combat.startTime + endS * 1000;
  const upTo = Math.min(endMs + PERIODIC_LAST_TRIGGER_SLACK_MS, combat.endTime);
  let last = endMs;
  for (const d of [...(caster.damageOut ?? []), ...(caster.healOut ?? [])]) {
    const t = d.logLine.timestamp;
    if (t > last && t <= upTo && fires(d)) last = t;
  }
  return (last - combat.startTime) / 1000;
}

/**
 * GH #167: an effect whose observed end is a death — its holder's (the
 * death cascade strips it, `DEATH_CASCADE_MS`, logged either side of the
 * UNIT_DIED — codex 20-G167-02) or the Solo Shuffle round's ending one —
 * was due to run to its official end; a row before that death states that
 * time left (121afd91 r6 1:55: `Dark Transformation (5s left)` counted down
 * to a death 5 s later). Undefined otherwise.
 */
function deathCutOfficialEnd(
  holder: ICombatUnit | undefined,
  endS: number,
  officialEndS: number,
  combat: AtomicArenaCombat,
  caster: ICombatUnit,
  /** the cooldown's English name — the `[RES]` entry's */
  name: string,
): Pick<IEnemyCDCast, "deathCutOfficialEndSeconds" | "deathCutAtSeconds"> {
  // the official end is read from the aura's own application (a press
  // logged after its aura, codex 20-G167-06 #3, is no cut); less than
  // AURA_NATURAL_END_JITTER_S short is jitter
  if (!(officialEndS - endS > AURA_NATURAL_END_JITTER_S)) return {};
  const endMs = combat.startTime + endS * 1000;
  const near = (ms: number | undefined) =>
    ms !== undefined && Math.abs(ms - endMs) <= DEATH_CASCADE_MS;
  // the holder's death reads its whole teardown (`deathTeardownWindowsMs`,
  // fact12 D32: the auras come off from the lethal hit on, UNIT_DIED can
  // come 125 ms later), with the cascade's slack either side; the cut stays
  // at the UNIT_DIED
  const deathMs = holder ? firstDeathMs(holder) : undefined;
  const holderTornDown =
    holder !== undefined &&
    deathMs !== Infinity &&
    deathTeardownWindowsMs(holder).some(
      (w) =>
        w.deathMs === deathMs &&
        endMs >= w.fromMs - DEATH_CASCADE_MS &&
        endMs <= w.deathMs + DEATH_CASCADE_MS,
    );
  const roundEndMs = shuffleRoundEndMs(
    combat,
    Object.values(combat.units ?? {}),
  );
  const cutMs = holderTornDown ? deathMs : near(roundEndMs) ? roundEndMs : null;
  if (cutMs === null || cutMs === undefined) return {};
  // the effect is over from the cut on only when the cut ends the caster's
  // effect itself — the Solo Shuffle round's end (whoever's death it was:
  // 0284fcd9 r6 1:12, Touch of the Magi on the healer whose death ended the
  // round) or the caster's own death — and no copy of it the caster put on
  // any unit, a pet's included, outlives the cut's cascade
  // (`casterAuraOutlives`, the scan's own truth: 3ac1fefa 0:56, Bestial
  // Wrath's own aura REMOVED 21 ms before its hunter died, its pets' copies
  // 292 ms after). A target's (the aura's wearer's) death alone ends that
  // one copy: the effect can run on (B1 verify, bd473d94 r1 1:38: Strike of
  // the Windlord's debuff on the rogue went with its death, its copies on
  // two pets ran to 1:44).
  // the cut ends the round when it IS the round-ending death — a holder's
  // teardown read from its lethal hit (fact12 D32) included, whose removal
  // can sit more than DEATH_CASCADE_MS before that UNIT_DIED (codex
  // 85-tk-A-T08-2f #1)
  const cutEndsRound = cutMs === roundEndMs || near(roundEndMs);
  const endsTheEffect =
    (cutEndsRound || (holder !== undefined && holder.id === caster.id)) &&
    !casterAuraOutlives(caster, name, cutMs + DEATH_CASCADE_MS, combat)
      .outlives;
  return {
    deathCutOfficialEndSeconds: officialEndS,
    ...(endsTheEffect
      ? { deathCutAtSeconds: (cutMs - combat.startTime) / 1000 }
      : {}),
  };
}

/** Where an enemy effect ends for the `[RES]` row's `Ns left`: its own end
 * when it was still up as the analysed slice ended (`ownEndSeconds`, T41),
 * else `buffEndSeconds`. The one reader of the own end outside the builder. */
export function enemyEffectOwnEndSeconds(
  cd: Pick<IEnemyCDCast, "buffEndSeconds" | "ownEndSeconds">,
): number {
  return cd.ownEndSeconds ?? cd.buffEndSeconds;
}

/**
 * T28: does a Solo Shuffle round's end (`endMs`) end `caster`'s effect of
 * English name `name`? Every aura of that name the caster put on any unit
 * is gone by `endMs` + `DEATH_CASCADE_MS` (`casterAuraOutlives`) and at
 * least one was logged this round — with none, the log cannot say. The one
 * predicate `[RES]`'s round-end cut (`cutAtRoundEnd`) and its scans
 * (fact12 `resEnemyEffectAfterDeath` kind `round over`, singles2
 * `resEnemySameSecondPressMissing`) read.
 */
export function roundEndEndsEffect(
  caster: Pick<ICombatUnit, "id">,
  name: string,
  endMs: number,
  combat: Parameters<typeof casterAuraOutlives>[3],
): boolean {
  const r = casterAuraOutlives(caster, name, endMs + DEATH_CASCADE_MS, combat);
  return r.any && !r.outlives;
}

/**
 * T28: cut every cast of `caster` whose effect the Solo Shuffle round's end
 * (`endMs`, `shuffleRoundEndMs`) ended (`roundEndEndsEffect`) and that was
 * still due at the end's rendered second — or was pressed after it, in the
 * log's tail past the round — at that instant: `deathCutAtSeconds`, the field `[RES]` stops
 * listing an effect at. A cast already cut keeps its cut. A 3v3's deciding
 * death ends no enemy effect (the match runs on), so it is no cut here.
 */
export function cutAtRoundEnd(
  casts: readonly IEnemyCDCast[],
  endMs: number | undefined,
  combat: AtomicArenaCombat,
  caster: ICombatUnit,
): void {
  if (endMs === undefined || !(endMs < combat.endTime)) return;
  const endS = (endMs - combat.startTime) / 1000;
  for (const cd of casts) {
    // an earlier cut stands; a later one — the caster's own death after the
    // round's end (codex T28-1 #2) — the round's end comes first
    if (cd.deathCutAtSeconds !== undefined && cd.deathCutAtSeconds <= endS)
      continue;
    const dueS = Math.max(
      cd.buffEndSeconds,
      cd.deathCutOfficialEndSeconds ?? -Infinity,
    );
    // still listable on the end's own row: an effect due past the end's
    // rendered second's start (24-1-127 r1: Avatar REMOVED at 39.9 s, the
    // round over at 39.966 s, `(1s left)` on the 0:39 death row), or a press
    // in the log's tail
    if (!(dueS >= Math.floor(endS)) && !(cd.castTimeSeconds > endS)) continue;
    if (
      !roundEndEndsEffect(
        caster,
        getEnglishSpellName(cd.spellId, cd.spellName),
        endMs,
        combat,
      )
    )
      continue;
    cd.deathCutAtSeconds = endS;
    // every reader of the effect's end takes the same cut — the burst span
    // (`burstCastSpan`), the aligned burst windows — as T03's death cut does:
    // `buffEndSeconds` is the cut, the official end kept beside it for the
    // time left on rows before it (codex 80-PIPE-29-B29 #1: a Power
    // Infusion cut at the round's end at 20 s ran its burst to 25 s)
    const cutEndS = Math.max(cd.castTimeSeconds, endS);
    if (cd.buffEndSeconds > cutEndS) {
      cd.deathCutOfficialEndSeconds ??= cd.buffEndSeconds;
      cd.buffEndSeconds = cutEndS;
    }
  }
}

/** every unit's aura intervals (pets, totems and guardians included), once
 * per combat */
const ALL_AURA_INDEX = new WeakMap<object, IAuraInterval[]>();

/**
 * T03: does an aura of English name `name` that `caster` put on any unit — a
 * pet's copy included — run past `untilMs` (its intervals the builder's)?
 * Open at it, or applied up to `EFFECT_START_AFTER_S` after it and still
 * running past it (codex T28-1 #1: an Avatar pressed 50 ms before a Solo
 * Shuffle round's end, applied 150 ms after it, ran 3 s on); a later
 * application is another effect (codex T28-1b). `any`: the caster put one of that name on
 * someone this round.
 * The one predicate `[RES]`'s death cut and its scan
 * (`resEnemyEffectAfterDeath`) read.
 */
export function casterAuraOutlives(
  caster: Pick<ICombatUnit, "id">,
  name: string,
  untilMs: number,
  combat: {
    startTime: number;
    endTime: number;
    units?: Readonly<Record<string, ICombatUnit>>;
  },
): { any: boolean; outlives: boolean } {
  let all = ALL_AURA_INDEX.get(combat);
  if (!all) {
    all = [];
    for (const u of Object.values(combat.units ?? {}))
      if (u.auraEvents?.length) all.push(...buildAuraIntervals(u, combat));
    ALL_AURA_INDEX.set(combat, all);
  }
  const untilS = (untilMs - combat.startTime) / 1000;
  const combatEndS = (combat.endTime - combat.startTime) / 1000;
  let any = false;
  for (const iv of all) {
    if (iv.srcUnitId !== caster.id) continue;
    if (getEnglishSpellName(iv.spellId, iv.spellName ?? "") !== name) continue;
    // an application the builder clamped to the combat's end with no length
    // (applied past it) is no evidence of the effect inside the combat at all
    // (codex T28-1c: a lone APPLIED at 40 s in a combat ending at 17 s read
    // [17, 17] and let the round's end cut a press whose aura never showed)
    if (iv.toS <= iv.fromS && iv.fromS >= combatEndS) continue;
    any = true;
    // open at the cut, or applied after it by a press's landing lag
    // (`EFFECT_START_AFTER_S`) and running past it — not a later, unrelated
    // application, nor one the builder clamped to the combat's end with no
    // length (codex T28-1b: an Avatar retained at 40 s in a combat ending at
    // 17 s, read [17, 17], kept a dead holder's effect listed)
    if (
      iv.toS > untilS &&
      iv.toS > iv.fromS &&
      iv.fromS <= untilS + EFFECT_START_AFTER_S
    )
      return { any, outlives: true };
  }
  return { any, outlives: false };
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

/** how far around a press an aura of its name still belongs to that press */
const PRESS_EFFECT_AURA_LEAD_MS = 1000;
const PRESS_EFFECT_AURA_LAG_MS = 2000;

/** How long after a press a damage row of its own name is still that
 * press's delivery. Not a travel-time table: one bound for every button,
 * and the same button's next press ends the reading first. 605 at
 * 387cc6a70 (T72 attempt 2): 114 presses with such rows, the last one
 * 0.2–2.38 s after the press (Meteor 2.2–2.4 s, Soul Fire 0.2–1.8 s) and
 * none between 2.38 s and 20 s. */
export const PRESS_DELIVERY_REACH_S = 5;

/**
 * Pipeline T72 attempt 2: when a press with no effect aura and no official
 * length delivered — the caster's last damage row of the button's own name
 * on a player of the other side, after the press, before the same button's
 * next press and within `PRESS_DELIVERY_REACH_S` (Meteor's impact 2.3 s
 * after the press, Soul Fire's hit after its flight). The press's span runs
 * to it, for every reader of `buffEndSeconds` / `burstCastSpan`: read at
 * the press instant, the burst ledger's window was `0:08–0:08` and the
 * report's row said no damage was dealt beside a recap listing the impact.
 * A shield-eaten hit counts by its attack spell (the ledger's own damage
 * includes absorbs).
 * A differently named part of the same button (Meteor Burn) is not read:
 * nothing in the row ties it to the press. `undefined` when the log shows
 * no such row.
 */
export function pressDeliveryEndSeconds(
  caster: ICombatUnit,
  allUnits: readonly ICombatUnit[],
  spellName: string,
  pressSeconds: number,
  nextPressSeconds: number,
  matchStartMs: number,
): number | undefined {
  const pressMs = matchStartMs + pressSeconds * 1000;
  const untilMs =
    matchStartMs +
    Math.min(nextPressSeconds, pressSeconds + PRESS_DELIVERY_REACH_S) * 1000;
  const otherSide = new Set(
    allUnits
      .filter(
        (u) =>
          u.type === CombatUnitType.Player && u.reaction !== caster.reaction,
      )
      .map((u) => u.id),
  );
  let lastMs: number | undefined;
  for (const d of caster.damageOut) {
    const t = d.logLine.timestamp;
    if (t <= pressMs || t > untilMs) continue;
    if (!otherSide.has(d.destUnitId)) continue;
    // a hit a shield ate whole is a row of its own (SPELL_ABSORBED) whose
    // spell fields are the SHIELD's; the attack rides beside them (codex
    // 81-tk-G-T72-2 #1: 12 of 371 press-only presses on 605 delivered only
    // such rows — a 201k Meteor into a shield read as no delivery)
    const absorbed = (d.logLine.event as string) === LogEvent.SPELL_ABSORBED;
    const id = absorbed
      ? (d as { attackSpellId?: string }).attackSpellId
      : d.spellId;
    const name = absorbed
      ? (d as { attackSpellName?: string }).attackSpellName
      : d.spellName;
    if (
      id === undefined ||
      id === null ||
      getEnglishSpellName(String(id), name ?? "") !== spellName
    )
      continue;
    if (lastMs === undefined || t > lastMs) lastMs = t;
  }
  return lastMs === undefined ? undefined : (lastMs - matchStartMs) / 1000;
}

/**
 * fact7 class 3: when a press fact's effect ended, as the log shows it — the
 * latest close of the caster's auras of the button's name that opened around
 * the press, on any target (Odyn's Fury and Deep Breath land on their victims,
 * Tip the Scales on the caster). An aura the log never closes runs its own
 * official length, up to its wearer's death: the round can end first, and the
 * button's cast id may carry no duration (Goremaw's Bite: cast 426591, aura
 * 426593 of 14 s; 75-1-523, pressed at 2:30 of a round ending 2:39; 72-1-407,
 * the wearer dead 0.9 s in). `undefined` when no aura says: the
 * caller falls back to the button's official duration, and a button with
 * neither has no running effect to state.
 */
function pressEffectEndSeconds(
  unit: ICombatUnit,
  allUnits: readonly ICombatUnit[],
  spellName: string,
  pressMs: number,
  matchStartMs: number,
  roundEndMs: number,
):
  | { endSeconds: number; officialEndSeconds?: number; cutAtSeconds?: number }
  | undefined {
  // an aura's rows sit on the unit wearing it, not on its caster
  const own = allUnits.flatMap((u) =>
    dropAuraRebroadcasts(
      (u.auraEvents ?? []).filter(
        (a) =>
          a.srcUnitId === unit.id &&
          a.spellId !== undefined &&
          a.logLine.timestamp >= pressMs - PRESS_EFFECT_AURA_LEAD_MS &&
          getEnglishSpellName(a.spellId, a.spellName ?? "") === spellName,
      ),
    ),
  );
  let endMs: number | undefined;
  let cutOfficialMs: number | undefined;
  let cutOnCaster = false;
  for (const opened of own) {
    if (opened.logLine.event !== LogEvent.SPELL_AURA_APPLIED) continue;
    const at = opened.logLine.timestamp;
    if (at > pressMs + PRESS_EFFECT_AURA_LAG_MS) continue;
    // this application's own end: a REMOVED after the unit's next
    // application of the aura closes that one (codex 85-tk-G-T72-1b #1,
    // 89-1-473: an Odyn's Fury applied at 10.186 with no end logged took the
    // 61.957 end of the application at 57.898 — a 51.9 s effect)
    const reappliedAt = own.find(
      (a) =>
        a !== opened &&
        a.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
        a.spellId === opened.spellId &&
        a.destUnitId === opened.destUnitId &&
        a.logLine.timestamp > at,
    )?.logLine.timestamp;
    const closed = own.find(
      (a) =>
        a.logLine.event === LogEvent.SPELL_AURA_REMOVED &&
        a.spellId === opened.spellId &&
        a.destUnitId === opened.destUnitId &&
        a.logLine.timestamp >= at &&
        (reappliedAt === undefined || a.logLine.timestamp <= reappliedAt),
    );
    const officialS = closed
      ? undefined
      : spellEffectData[opened.spellId!]?.durationSeconds;
    const officialEnd =
      officialS === undefined ? undefined : at + officialS * 1000;
    const diedMs =
      officialEnd === undefined
        ? undefined
        : allUnits
            .find((u) => u.id === opened.destUnitId)
            ?.deathRecords?.find(
              (d) =>
                d.timestamp >= at &&
                d.timestamp < officialEnd &&
                d.timestamp <= roundEndMs,
            )?.timestamp;
    const end = closed?.logLine.timestamp ?? diedMs ?? officialEnd;
    if (end !== undefined && (endMs === undefined || end > endMs)) {
      endMs = end;
      cutOfficialMs = diedMs === undefined ? undefined : officialEnd;
      cutOnCaster = opened.destUnitId === unit.id;
    }
  }
  if (endMs === undefined) return undefined;
  return {
    endSeconds: (endMs - matchStartMs) / 1000,
    ...(cutOfficialMs === undefined
      ? {}
      : {
          officialEndSeconds: (cutOfficialMs - matchStartMs) / 1000,
          // the wearer's death is the end itself — the effect's, when the
          // caster wore it (a victim's death ends that copy only)
          ...(cutOnCaster
            ? { cutAtSeconds: (endMs - matchStartMs) / 1000 }
            : {}),
        }),
  };
}

/**
 * T91: the seconds a burst window's damage is a RATE over — its start to
 * its end, cut at the analysed slice's end. A window whose last effect's
 * official end runs past the slice (a press whose REMOVED the slice lost,
 * F15; a Divine Toll's 30 s Divine Resonance pressed 7 s before the end)
 * was divided by seconds the log shows no damage for — the match's own
 * average rate it is compared with (`avgDamageRate`) is over the slice —
 * and its `damageRatio`, `dangerScore` and `dangerLabel` read low. The
 * window's own `toSeconds` is not cut. Never under 1 s. The one reading for
 * the window engine and scan5/t91.
 */
/** A burst window's damage ratio is kept inside these (the engine's clamp;
 * scan5/t91 reads the log's ratio under the same two). */
export const BURST_DAMAGE_RATIO_MIN = 0.5;
export const BURST_DAMAGE_RATIO_MAX = 6;
/** What a healer controlled for the whole observed window adds to its
 * score: `1 + coverage × this` (scan5/t91 reads the coverage back off it). */
export const BURST_HEALER_CC_WEIGHT = 0.8;

export function burstWindowRateSpanSeconds(
  fromSeconds: number,
  toSeconds: number,
  sliceEndSeconds: number,
): number {
  return Math.max(Math.min(toSeconds, sliceEndSeconds) - fromSeconds, 1);
}

export function reconstructEnemyCDTimeline(
  enemies: ICombatUnit[],
  combat: AtomicArenaCombat,
  owner?: ICombatUnit,
  friendlies?: ICombatUnit[],
  opts?: {
    /** keep the presses of a healer's throughput major on the offensive
     * roster (`isHealerHeldOffensive`) — only for a reader that names them
     * as not counted (the burst ledger's Solo note, user ruling R01
     * 2026-11-08); every other reader leaves them out (fact11 D16) */
    keepHealerHeldPresses?: boolean;
  },
): IEnemyCDTimeline {
  // T81: eight readers per match ask for the same timeline; one per round
  // object and argument identity. Shared: read-only.
  return roundValue(
    combat,
    `enemyCdTimeline|${unitTokens(enemies)}|${identityToken(owner)}|${friendlies ? unitTokens(friendlies) : "-"}|${opts?.keepHealerHeldPresses ? 1 : 0}`,
    roundFingerprint(combat, enemies, owner ? [owner] : [], friendlies ?? []),
    () =>
      reconstructEnemyCDTimelineUncached(
        enemies,
        combat,
        owner,
        friendlies,
        opts,
      ),
  );
}

function reconstructEnemyCDTimelineUncached(
  enemies: ICombatUnit[],
  combat: AtomicArenaCombat,
  owner?: ICombatUnit,
  friendlies?: ICombatUnit[],
  opts?: {
    /** keep the presses of a healer's throughput major on the offensive
     * roster (`isHealerHeldOffensive`) — only for a reader that names them
     * as not counted (the burst ledger's Solo note, user ruling R01
     * 2026-11-08); every other reader leaves them out (fact11 D16) */
    keepHealerHeldPresses?: boolean;
  },
): IEnemyCDTimeline {
  const matchStartMs = combat.startTime;
  const matchDurationSeconds = (combat.endTime - matchStartMs) / 1000;

  const players: IEnemyPlayerTimeline[] = [];

  for (const enemy of enemies) {
    const offensiveCDs: IEnemyCDCast[] = [];

    // corpusFactScan hiddenPressUnused (2026-10-21): a press made while the
    // enemy was unseen (`hiddenPressMs`) is a press too (0284fcd9 r1 0:12:
    // Tranquility; 4-3 r3 0:06: Takedown — no line, kit [UNUSED])
    // the enemy's spec admits its spec-gated cooldowns (GH #184 part B:
    // a Retribution's Divine Toll, a Feral's Convoke); fact11 D16: a
    // healer's throughput major on the offensive roster (Holy Paladin
    // Avenging Wrath) is that healer's [ENEMY HEAL CD], no burst
    const isWindowSpell = (id: string) =>
      isEnemyCdWindowSpell(id, enemy.spec) &&
      (opts?.keepHealerHeldPresses === true ||
        !isHealerHeldOffensive(id, enemy.spec));
    const presses = pressRowsWithHidden(enemy, isWindowSpell, matchStartMs);
    for (const cast of presses) {
      if (cast.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      const { spellId } = cast;
      if (!spellId) continue;
      if (!isWindowSpell(spellId)) continue;
      const effectData = spellEffectData[spellId]!;
      // an activation of another cooldown's effect (GH #115) has no button:
      // no cooldown of its own, nothing to come "available again". An
      // override variant (F20 D23: Predator's Wake 1259431 on The Hunt's
      // button) IS that button: priced on the cooldown it presses, under the
      // log's own id and name.
      const isActivation = OFFENSIVE_EFFECT_ACTIVATION_IDS.has(spellId);
      // dated: a variant that is its own cooldown on this log spends its
      // own (Predator's Wake before 12.1.5, fact11 D22)
      const cdId =
        offensiveCooldownIdAt(
          spellId,
          logInstantOf(combat, matchStartMs),
          enemy.spec,
        ) ?? spellId;
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
        buffDurationOfApplication(spellId, enemy, cast.logLine.timestamp) ??
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
      delete cd.deathCutOfficialEndSeconds;
      delete cd.deathCutAtSeconds;
      if (officialEndS !== undefined)
        Object.assign(
          cd,
          deathCutOfficialEnd(
            holder,
            endS,
            officialEndS,
            combat,
            enemy,
            getEnglishSpellName(cd.spellId, cd.spellName),
          ),
        );
    };
    for (const cd of offensiveCDs) {
      const next = offensiveCDs.find(
        (c) =>
          canonicalSpellId(
            c.spellId,
            logInstantOf(combat, combat.startTime),
          ) ===
            canonicalSpellId(
              cd.spellId,
              logInstantOf(combat, combat.startTime),
            ) && c.castTimeSeconds > cd.castTimeSeconds,
      );
      const endNote: { windowEndS?: number } = {};
      const end = observedEffectEnd(
        enemy,
        cd.spellId,
        cd.castTimeSeconds,
        next?.castTimeSeconds ?? Infinity,
        combat,
        undefined,
        endNote,
      );
      if (endNote.windowEndS !== undefined)
        cd.windowEndSeconds = endNote.windowEndS;
      if (end === null) {
        // GH #184 part B (codex review 2026-11-06 P2): a press whose effect
        // runs on a talent's aura (Divine Toll → Divine Resonance) has no
        // official length of its own; with the aura applied at the press
        // and its end not logged inside the round, the aura's official
        // length is the press's, as the cast's is for any other cooldown
        const talentAura = talentEffectAuraAtPress(
          enemy,
          cd.spellId,
          cd.castTimeSeconds,
          combat.startTime,
        );
        if (talentAura !== undefined && cd.buffEndSeconds <= cd.castTimeSeconds)
          cd.buffEndSeconds =
            cd.castTimeSeconds +
            (buffDurationOfApplication(
              talentAura,
              enemy,
              matchStartMs + cd.castTimeSeconds * 1000,
            ) ??
              spellEffectData[talentAura]?.durationSeconds ??
              0);
        // pipeline T72 (codex 85-tk-G-T72-1 #1): a member whose cast has no
        // length of its own and whose effect aura the log opened and never
        // closed runs that aura's official length, up to its wearer's death
        // — the reading it had as a press fact (`pressEffectEndSeconds`;
        // Goremaw's Bite 426591 → 426593, 75-1-523: pressed at 150.128, the
        // round over at 2:39, the span read zero and `[RES]` the instant
        // member's 8 s for a 14 s effect). On players only, as the
        // observed-chain reader reads (FT F13: a copy on a pet, a totem or
        // a guardian is not the effect's span).
        if (cd.buffEndSeconds <= cd.castTimeSeconds) {
          const effectEnd = pressEffectEndSeconds(
            enemy,
            Object.values(combat.units ?? {}).filter(
              (u) => u.type === CombatUnitType.Player,
            ),
            getEnglishSpellName(cd.spellId, cd.spellName),
            matchStartMs + cd.castTimeSeconds * 1000,
            matchStartMs,
            combat.endTime,
          );
          if (effectEnd !== undefined) {
            cd.buffEndSeconds = Math.max(
              cd.castTimeSeconds,
              effectEnd.endSeconds,
            );
            if (effectEnd.officialEndSeconds !== undefined) {
              cd.deathCutOfficialEndSeconds = effectEnd.officialEndSeconds;
              if (effectEnd.cutAtSeconds !== undefined)
                cd.deathCutAtSeconds = effectEnd.cutAtSeconds;
            }
          }
        }
        // pipeline T72 attempt 2: with no effect of any kind, the press runs
        // to the delivery the log shows (`pressDeliveryEndSeconds`)
        if (cd.buffEndSeconds <= cd.castTimeSeconds && !cd.refusedAtPress) {
          const delivered = pressDeliveryEndSeconds(
            enemy,
            Object.values(combat.units ?? {}),
            getEnglishSpellName(cd.spellId, cd.spellName),
            cd.castTimeSeconds,
            next?.castTimeSeconds ?? Infinity,
            matchStartMs,
          );
          if (delivered !== undefined) {
            cd.buffEndSeconds = delivered;
            cd.endIsDelivery = true;
          }
        }
        // fact10 D20: a length that moves with haste, its end not logged by
        // the round's end, runs as long as this unit's own completed run of
        // it did — not the official length (`ownCompletedRunSeconds`). Not
        // a channel: its caster stops it at will, so a completed run says
        // nothing of the next (codex 20-F25-03 #1; cover set, 12 of 49
        // channel presses read off a clipped run — Mind Flay 0.28 s of 4.5,
        // Dark Harvest 0.53 s of 3)
        if (HASTE_DURATION_SPELL_IDS.has(cd.spellId)) {
          const run = ownCompletedRunSeconds(
            enemy,
            cd.spellId,
            matchStartMs + cd.castTimeSeconds * 1000,
            combat,
          );
          if (run !== undefined)
            cd.buffEndSeconds = Math.min(
              cd.buffEndSeconds,
              cd.castTimeSeconds + run,
            );
        }
        // fact9 D26 (a7e95468 r0 1:23): a channel whose effect the log shows
        // on no player (Ray of Frost into a Grounding Totem) ends where the
        // channel did — the press that ended it, the one reading the
        // owner's `[YOU] [CD]` uses (`channelEndSeconds`, fact7 D12). Ice
        // Lance at 80.64 ended a Ray of Frost pressed at 79.05; the window
        // read `1s left` at 1:23 on the official 4 s.
        // fact11 D39 (e4784cab r0 0:09): one caster runs one of it at a
        // time — the next press of the same channel ends this one — and a
        // channel the game refused at its press (`channelRefusedAtCast`:
        // Ray of Frost MISS into a fresh Phase Shift, no aura, no tick) never
        // ran at all.
        if (CHANNELED_SPELL_IDS.has(cd.spellId)) {
          const untilS = Math.min(
            cd.buffEndSeconds,
            next?.castTimeSeconds ?? Infinity,
          );
          const channelRefused = channelRefusedAtCast(
            enemy,
            cd.spellId,
            matchStartMs + cd.castTimeSeconds * 1000,
            matchStartMs + untilS * 1000,
            cd.spellName,
            next !== undefined && next.castTimeSeconds <= cd.buffEndSeconds,
          );
          // not `refusedAtPress`: that flag is `pressEffectRefusedAtCast`'s
          // alone (above) — this reading counts an ABSORB miss as a refusal,
          // and a fully absorbed tick landed (codex T29-1c #1)
          cd.buffEndSeconds = channelRefused
            ? cd.castTimeSeconds
            : Math.max(
                cd.castTimeSeconds,
                channelEndSeconds(
                  enemy,
                  cd.spellId,
                  cd.castTimeSeconds,
                  untilS,
                  matchStartMs,
                  cd.spellName,
                ),
              );
        }
        // T29: a press the game refused (`pressRefusalMissType`: a miss on its
        // own target, nothing landed) never ran. The end every reading above
        // gave it — the window it had before T29 — is kept for the intent
        // layer (`refusedOfficialEndSeconds`: kill attempts, user ruling R15
        // (1)); no death cut applies to a press that ran no time.
        const refusedMissType = pressRefusalMissType(
          enemy,
          cd.spellId,
          matchStartMs + cd.castTimeSeconds * 1000,
          matchStartMs + (next?.castTimeSeconds ?? Infinity) * 1000,
          combat,
        );
        if (refusedMissType !== undefined) {
          cd.refusedOfficialEndSeconds = cd.buffEndSeconds;
          cd.buffEndSeconds = cd.castTimeSeconds;
          cd.refusedAtPress = true;
          cd.refusedMissType = refusedMissType;
          continue;
        }
        // T29: the caster's own death ends a window the log shows no end of
        // when no copy of its effect the caster put on any unit outlives it
        // — T03's death cut (`deathCutOfficialEnd`) for a press-only window.
        // 52-1-311 r1 1:58: Colossus Smash pressed 0.39 s before its warrior
        // died; its debuff, 0.5 s behind the hit, never applied, and `[RES]`
        // listed it after the warrior's `[DEATH]` on the official 10 s.
        const diedMs = firstDeathMs(enemy);
        const diedS = (diedMs - matchStartMs) / 1000;
        if (
          Number.isFinite(diedMs) &&
          diedMs <= combat.endTime &&
          diedS >= cd.castTimeSeconds &&
          cd.buffEndSeconds - diedS > AURA_NATURAL_END_JITTER_S
        ) {
          const r = casterAuraOutlives(
            enemy,
            getEnglishSpellName(cd.spellId, cd.spellName),
            diedMs + DEATH_CASCADE_MS,
            combat,
          );
          if (r.any && !r.outlives) {
            cd.deathCutOfficialEndSeconds = cd.buffEndSeconds;
            cd.deathCutAtSeconds = diedS;
            cd.buffEndSeconds = diedS;
          }
        }
        continue;
      }
      // the observed aura's own official length (this caster's talents —
      // Thorim's Invocation lengthens Doom Winds' aura, not its press) from
      // its last application (codex 20-G167-06 #2 / #3, 20-G167-11 #1); the
      // press's when the aura has none
      const auraFull = buffDurationOfApplication(
        end.auraId,
        enemy,
        matchStartMs + end.appliedS * 1000,
      );
      setObservedEnd(
        cd,
        end.endS,
        auraFull === undefined
          ? officialEndOf.get(cd)
          : end.appliedS + auraFull,
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
      // fact11 D16: the healer's own (no press) Avenging Wrath is its
      // [ENEMY HEAL CD] line's (`castlessHealCdAuras`)
      if (isHealerHeldOffensive(o.spellId, enemy.spec)) continue;
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
      // an end nothing observed, at the slice's own end, with the holder
      // dead by then: the slice ends on that death and the aura's REMOVED
      // is logged in the cascade just past it — the effect is over at the
      // death (codex 85-tk-G-T41-1 #2: a Metamorphosis whose holder died on
      // the slice's last row read `14s left` on the death's own row), and
      // was due to run to its official end like any death-cut one (1b #1:
      // the row a second before the death read `1s left` against 15)
      const atSliceEnd =
        !o.endObserved &&
        o.officialEndMs !== undefined &&
        o.endMs >= combat.endTime - 1;
      const holderDeadAtSliceEnd =
        atSliceEnd && firstDeathMs(enemy) <= combat.endTime + DEATH_CASCADE_MS;
      const cut =
        o.officialEndMs === undefined ||
        !(o.endObserved || holderDeadAtSliceEnd)
          ? {}
          : deathCutOfficialEnd(
              enemy,
              (o.endMs - matchStartMs) / 1000,
              (o.officialEndMs - matchStartMs) / 1000,
              combat,
              enemy,
              getEnglishSpellName(o.spellId, o.spellName),
            );
      const upAtSliceEnd = atSliceEnd && !holderDeadAtSliceEnd;
      (o.burstRole === "fact" ? offensiveFacts : offensiveCDs).push({
        ...cut,
        spellId: o.spellId,
        spellName: o.spellName,
        castTimeSeconds,
        cooldownSeconds: o.cooldownSeconds,
        availableAgainAtSeconds:
          o.availableAgainAtMs === null
            ? null
            : (o.availableAgainAtMs - matchStartMs) / 1000,
        // an end nothing observed, at the slice's own end: the aura was
        // still up when the slice ended (the occurrences read no row past
        // it, and bound an inferred end by it), so the effect's own official
        // end stands, as it does for a logged press (`observedEffectEnd`'s
        // clamp guard, F15) — T41, 52a97230 r0: Metamorphosis up at 0:32.9,
        // the slice over at 0:35.7, `3s left` at 0:33 against 24 s
        buffEndSeconds:
          ((upAtSliceEnd ? Math.max(o.endMs, o.officialEndMs!) : o.endMs) -
            matchStartMs) /
          1000,
        ...(upAtSliceEnd && o.officialEndMs! > o.endMs
          ? { windowEndSeconds: (o.endMs - matchStartMs) / 1000 }
          : {}),
        dangerWeight: o.dangerWeight,
        ...(o.burstRole === "fact" ? { burstRole: "fact" as const } : {}),
        ...(o.availabilityUnknown ? { availabilityUnknown: true } : {}),
      });
    }

    // fact7 class 3: an offensive button whose press is a fact — the
    // [ENEMY CD] line and nothing else (`OFFENSIVE_PRESS_FACT_IDS`)
    const isPressFact = (id: string) => isOffensivePressFactFor(id, enemy.spec);
    for (const cast of pressRowsWithHidden(enemy, isPressFact, matchStartMs)) {
      if (cast.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      const { spellId } = cast;
      if (!spellId || !isPressFact(spellId)) continue;
      const castTimeSeconds = (cast.logLine.timestamp - matchStartMs) / 1000;
      const name = getEnglishSpellName(spellId, cast.spellName ?? "");
      if (
        offensiveFacts.some(
          (f) =>
            f.spellName === name &&
            Math.abs(castTimeSeconds - f.castTimeSeconds) < 1,
        )
      )
        continue;
      const cooldownSeconds =
        unitCooldownOf(enemy, spellId)?.cooldownSeconds ??
        effectiveCooldownSeconds(spellId) ??
        0;
      const entry = unitCooldownEntry(enemy, combat, spellId);
      const effectEnd = pressEffectEndSeconds(
        enemy,
        Object.values(combat.units ?? {}),
        name,
        cast.logLine.timestamp,
        matchStartMs,
        combat.endTime,
      );
      // a press the game refused never ran (T29)
      const refusedMissType =
        effectEnd === undefined
          ? pressRefusalMissType(
              enemy,
              spellId,
              cast.logLine.timestamp,
              Infinity,
              combat,
            )
          : undefined;
      const refused = refusedMissType !== undefined;
      offensiveFacts.push({
        spellId,
        spellName: name,
        castTimeSeconds,
        cooldownSeconds,
        availableAgainAtSeconds:
          (entry && pressReadyAgainAtSeconds(entry, castTimeSeconds)) ??
          castTimeSeconds + cooldownSeconds,
        buffEndSeconds:
          effectEnd?.endSeconds ??
          (refused
            ? castTimeSeconds
            : castTimeSeconds +
              (spellEffectData[spellId]?.durationSeconds ?? 0)),
        ...(refused
          ? {
              refusedAtPress: true as const,
              refusedMissType,
              refusedOfficialEndSeconds:
                castTimeSeconds +
                (spellEffectData[spellId]?.durationSeconds ?? 0),
            }
          : {}),
        ...(effectEnd?.officialEndSeconds === undefined
          ? {}
          : {
              deathCutOfficialEndSeconds: effectEnd.officialEndSeconds,
              deathCutAtSeconds: effectEnd.cutAtSeconds,
            }),
        ...(cast.unseenPress ? { unseenPress: true as const } : {}),
        dangerWeight: 0,
        burstRole: "fact",
      });
    }

    // T28: an effect a Solo Shuffle round's end ended (`roundEndEndsEffect`:
    // every aura of its name the caster put on any unit gone by the end's
    // cascade) is over from that instant's rendered second, as a death cut
    // is (`deathCutAtSeconds`) — whatever end its span read, and a press in
    // the log's tail past the round with it. f22d547e: a Power Infusion's
    // span had no observed end and `[RES]` read `Power Infusion/Discipline
    // Priest(10s left)` past the round's end; 1-6-16 r6: a Touch of the Magi
    // pressed after the round's end read `(13s left)` on the death's row.
    cutAtRoundEnd(
      [...offensiveCDs, ...offensiveFacts],
      shuffleRoundEndMs(combat, Object.values(combat.units ?? {})),
      combat,
      enemy,
    );

    offensiveCDs.sort((a, b) => a.castTimeSeconds - b.castTimeSeconds);

    if (offensiveCDs.length > 0 || offensiveFacts.length > 0) {
      players.push({
        playerName: enemy.name,
        specName: specToString(enemy.spec),
        offensiveCDs,
        ...(offensiveFacts.length > 0 ? { offensiveFacts } : {}),
        ...(Number.isFinite(firstDeathMs(enemy))
          ? { deathSeconds: (firstDeathMs(enemy) - matchStartMs) / 1000 }
          : {}),
      });
    }
  }

  // T41: the builder's steps above read an effect still up at the slice's
  // end on its own end; from here on `buffEndSeconds` is the end it had
  // before, and the own end is its own field
  for (const p of players)
    for (const cd of [...p.offensiveCDs, ...(p.offensiveFacts ?? [])]) {
      if (cd.windowEndSeconds === undefined) continue;
      if (cd.buffEndSeconds > cd.windowEndSeconds) {
        cd.ownEndSeconds = cd.buffEndSeconds;
        cd.buffEndSeconds = cd.windowEndSeconds;
      }
      delete cd.windowEndSeconds;
    }

  // Find aligned burst windows: clusters of 2+ casts within BURST_CLUSTER_SECONDS
  const allCastsRaw = players
    .flatMap((p) =>
      // a refused press (T29) put no effect in any window
      p.offensiveCDs
        .filter((cd) => !cd.refusedAtPress)
        .map((cd) => ({
          time: cd.castTimeSeconds,
          // (an effect T41 found still up when the slice ended keeps its
          // own end in `ownEndSeconds`; the window's damage is a RATE over
          // the span — a Metamorphosis due 14 s past the end halved the
          // rate of its window, `High burst` read `Moderate burst`)
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
  // …of the slice: a Solo Shuffle round's `endTime` is cut at the deciding
  // death while the unit arrays keep the rows after it, so both rates read
  // the rows up to the slice's end and no further (codex 85-tk-G-T91-1 #1:
  // 0284fcd9 r1, 57k of a window's damage fell after the end its rate's
  // seconds stopped at — ratio 0.99 against 0.92)
  const allFriendlyDamage = (friendlies ?? [])
    .flatMap((u) => u.damageIn)
    .filter((e) => e.logLine.timestamp <= combat.endTime);
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

      const windowSpan = burstWindowRateSpanSeconds(
        windowStart,
        windowEnd,
        matchDurationSeconds,
      );
      const damageRatio =
        avgDamageRate > 0
          ? Math.min(
              BURST_DAMAGE_RATIO_MAX,
              Math.max(
                windowDamage / windowSpan / avgDamageRate,
                BURST_DAMAGE_RATIO_MIN,
              ),
            )
          : BURST_DAMAGE_RATIO_MIN;

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
      // what the slice shows of the window: the healer's control is a
      // share of THESE seconds, as the damage rate is (codex 85-tk-G-T91-1
      // #2: a healer stunned for the 2 s the slice shows of a 20 s window
      // read 10 % covered)
      const observedEndMs = Math.min(windowEndMs, combat.endTime);
      const observedDuration = Math.max(
        (observedEndMs - windowStartMs) / 1000,
        0,
      );

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
              // a REFRESH of a control already up continues it: restarting
              // the run there dropped the seconds before the refresh (T91,
              // 605 scan5 burstHealerCcPastSliceEnd: one window, 6 % of the
              // score against 41 % of the 8.4 s the log shows)
              if (!ccStartBySpell.has(a.spellId))
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
                ccStart < observedEndMs &&
                ccEnd > windowStartMs
              ) {
                ccIntervals.push({
                  start: Math.max(ccStart, windowStartMs),
                  end: Math.min(ccEnd, observedEndMs),
                });
              }
              ccStartBySpell.delete(a.spellId);
            }
          }
        }

        // Active CCs at match end
        for (const ccStart of ccStartBySpell.values()) {
          if (ccStart < observedEndMs && combat.endTime > windowStartMs) {
            ccIntervals.push({
              start: Math.max(ccStart, windowStartMs),
              end: observedEndMs,
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
        if (!healerCCed && observedDuration >= 5) {
          const ownerCastsInWindow = owner.spellCastEvents.filter((e) => {
            const t = e.logLine.timestamp;
            return t >= windowStartMs && t <= observedEndMs;
          });
          if (ownerCastsInWindow.length === 0) {
            healerCCed = true;
            ccDurationMs = observedDuration * 1000;
          }
        }
      }

      const ccFraction = Math.min(
        ccDurationMs / Math.max(observedDuration * 1000, 1),
        1,
      );
      const healerMult = 1.0 + ccFraction * BURST_HEALER_CC_WEIGHT;

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

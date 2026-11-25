import {
  AtomicArenaCombat,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import { effectSpanIdsOfCast } from "../data/castEffectAuras";
import {
  castsOfEffectAura,
  ownEffectAurasKeyedBy,
} from "../data/castEffectAuras";
import {
  HEALER_HELD_OFFENSIVE_SPEC,
  isHealerHeldOffensive,
} from "../data/healerHeldOffensive";
import {
  type IResolvedMitigation,
  resolveMitigation,
} from "../data/mitigationComponents";
import {
  immunityMaskStopsSchool,
  MITIGATION_TABLE,
} from "../data/mitigationData";
import { SPELL_CATEGORIES as spellsData } from "../data/spellCategories";
import { getEnglishSpellName } from "../data/spellEffectData";
import { ENEMY_IMMUNITY_TEAM_PROC_AURAS } from "../data/spellIdLists";
import { spellSchoolMask } from "../data/spellSchools";
import { isAllyCopyWallId } from "./allyCopyWall";
import { buildAuraIntervals, pressSecondsOfAura } from "./auraIntervals";
import { withoutImmunityBranchWalls } from "./auraMasteryBranch";
import { isCasterSideLinkAura } from "./brokenRowBreaker";
import {
  combatMemo,
  identityToken,
  roundFingerprint,
  unitTokens,
} from "./combatMemo";
import {
  canonicalSpellId,
  ghostEndTroughInWindow,
  gridEndpointHpPct,
  isDeadAtRenderSecond,
  isGhostEndWindow,
  isHpTroughWorthPrinting,
  windowTroughOffGhost,
} from "./cooldowns";
import {
  casterCopyEndSeconds,
  EFFECT_START_AFTER_S,
  EFFECT_START_BEFORE_S,
  IEnemyCDCast,
  observedEffectEndSeconds,
  reconstructEnemyCDTimeline,
} from "./enemyCDs";
import {
  ALIAS_PRESS_TWIN_MS,
  AURA_BEFORE_CAST_MAX_S,
  ENEMY_DEF_NO_PRESS_TAG,
  enemyDefensiveEvents,
  FULL_IMMUNITY_IDS,
  holderFirstOwnActionAfterMs,
  type IEnemyDefensiveEvent,
  limitedImmunitySchoolMask,
  MITIGATION_AURA_MIN_PCT,
  PRESS_TO_AURA_MAX_S,
  SAVE_AURA_END_UNSEEN_IDS,
  wallTableIdOfAura,
} from "./enemyDefensives";
import {
  absorbedHitSchoolMask,
  documentRecordsAttackSpell,
  hitSchoolId,
  isDamageSentRow,
  isDamageTakenRow,
  logSchoolMask,
} from "./incomingPressure";
import {
  type IKickAuditEntry,
  jukedByFakeText,
  jukedByStoppedChannelText,
  kickMissTag,
  missedKickText,
} from "./kickAudit";
import { MIN_WINDOW_SECONDS } from "./killWindowTargetSelection";
import { logInstantOf } from "./logEra";
import { IOffensiveWindow } from "./offensiveWindows";
import { fmtTime, toRenderSecond } from "./renderGrid";
import { roundEndMs } from "./roundEnd";

type SpellEntry = { type: string };
const SPELLS = spellsData as Record<string, SpellEntry>;

/** Immunity + major-defensive ids a burst can be wasted into (same list the kill-window
 * target snapshot uses for "defensives spent"). */
// GH #31 ② (2026-09-02): shared official-face predicate replaces the hand set
// (immunities stay — immuneSchools covers most, the category term keeps parity
// for entries the face lacks).
import { abilityProfile, isMajorDefenseUp } from "../data/abilityProfile";
import { spellEffectData } from "../data/spellEffectData";
const DEF_OR_IMMUNE_CAST_IDS = new Set<string>([
  // Enumerate the official universe through the shared predicate — the
  // span state machine's roster, less the members that are no damage
  // defense while up (fact9 D21: Lichborne read "a major defensive up"
  // once fact8 D9 put it in the roster; `isMajorDefenseUp`).
  ...Object.keys(spellEffectData).filter(isMajorDefenseUp),
  ...Object.keys(SPELLS).filter((id) => SPELLS[id]?.type === "immunities"),
]);
/** …and the AURA a wall logs under when it is not its cast id — the ledger
 * matches aura intervals (F15 / fact1215 C10: 62fdbf2e Burst #2 missed
 * Vizine's Greater Invisibility 110959 → 110960 that KILL ATTEMPTS named).
 * fact2 C10 (2026-10-20): every cast's own same-named effect aura from the
 * one cast→effect table (`ownEffectAurasKeyedBy`), not the three of the
 * mitigation table's hand map — Rallying Cry 97462 → 97463 and Spirit Link
 * Totem 98008 → 325174 are kill-window major defensives the ledger never
 * named. */
/** @internal exported for eval scan5/reannounce (the defensive split of its count) */
export const DEF_OR_IMMUNE_IDS = new Set<string>([
  ...DEF_OR_IMMUNE_CAST_IDS,
  ...Object.keys(
    ownEffectAurasKeyedBy((id) => DEF_OR_IMMUNE_CAST_IDS.has(id)),
  ).filter((aura) => !isHealOnlyAura(aura)),
  // fact7 D40: an immunity a teammate's proc puts on the carrier has no cast
  // of its own to enter by. `[ENEMY DEF]` and KILL ATTEMPTS read Peaceweaver
  // (F20 ruling); the ledger read Revival's on-target minute as nothing up.
  // Aura-only, so it stays `viaLoggedAura` and out of the cast-keyed vectors.
  ...ENEMY_IMMUNITY_TEAM_PROC_AURAS,
]);

/** fact3 D59 (fe64d179): an effect aura whose official profile only heals
 * (Divine Hymn 64844, +4 % healing received on every ally of the channel)
 * is no defensive on its holder — no mitigation, no absorb, no immunity. */
function isHealOnlyAura(aura: string): boolean {
  const p = abilityProfile(aura);
  return (
    (p.healsSelf || p.healsOthers || p.healingReceivedPct !== undefined) &&
    p.mitigationPct === undefined &&
    !p.absorbs &&
    p.immuneSchools === undefined
  );
}

/** The percentage of an ally's copy of a talent-shared wall on the target
 * (`isAllyCopyWallId` + `pctOnOthers`), undefined for anything else — the
 * caster's own copy is its own wall. */
export function allyCopyPctOf(
  d: Pick<IBurstDefensiveHit, "spellId" | "appliedByOther">,
): number | undefined {
  if (!d.appliedByOther || !isAllyCopyWallId(d.spellId)) return undefined;
  const pct = MITIGATION_TABLE[d.spellId]?.pctOnOthers;
  return pct !== undefined && pct < MITIGATION_AURA_MIN_PCT ? pct : undefined;
}

/** A target death up to this long after the burst ends still credits the burst. */
/** Death within this many seconds after a span still credits the span as the
 * kill. Exported 2026-08-18: killAttempts.ts judges "did this attempt convert"
 * with the same slack — one credit predicate, not two (CLAUDE.md rule). */
export const KILL_CREDIT_SLACK_S = 5;
/** Defensive overlaps shorter than this are noise (aura edge vs burst edge).
 *
 * GH #34 batch 4 (2026-08-28), 300 matches / 2,244 DPS player-rounds / 5,895
 * bursts / 3,086 kept defensive hits: overlap [0.5,1) 112 · [1,2) 270 ·
 * [2,3) 299 · [3,5) 467 · [5,8) 744 · ≥ 8 1,194 (p50 6.4 s). Only 3.6 % of
 * kept hits sit in the first half-second above the cut, so 0.5 s trims edge
 * noise without touching the mass. Measured, not official. */
const MIN_DEFENSIVE_OVERLAP_S = 0.5;

export interface IBurstDefensiveHit {
  spellId: string;
  spellName: string;
  /** Seconds the defensive/immunity was active inside the burst span. */
  overlapSeconds: number;
  /** true = full immunity (Divine Shield / Turtle class); false = major damage reduction. */
  isImmunity: boolean;
  /** Matched through the wall's logged aura id, not its cast id
   * (`ownEffectAurasKeyedBy`, F15 C10 / fact2 C10). The ledger line states it; the
   * readers whose predicate and reference data were built on the cast-id set
   * (deepDive's coaching pack, dpsMetrics' `burstIntoDefensiveRatio`) leave
   * it out (codex 20-F15-13). */
  viaLoggedAura?: true;
  /** true = the aura was applied by a unit OTHER than the target (a talent-shared
   * wall such as Flameshaper Obsidian Scales on an ally). Consumers price it
   * through `resolveMitigation(id, { carrierIsCaster: !appliedByOther })`. Optional so hand-built
   * fixtures stay valid; absent means "the target's own". */
  appliedByOther?: boolean;
  /** name of the unit that cast the aura (GH #96 M3b: talents belong to the
   * caster). Optional for hand-built fixtures. */
  casterName?: string;
  /** Seconds from the burst's start to the aura's application, one decimal;
   *  ≤ 0 = already up when the burst opened. Reliability round 2 (a0a4,
   *  1c12): "Target had a major defensive up" was read as "you opened into
   *  it" when the wall was the target's reaction (Barkskin 1.24 s after
   *  Bestial Wrath). Optional for hand-built fixtures. */
  startOffsetSeconds?: number;
  /** The same offset, raw ms — the up-at-opening decision reads THIS, not the
   *  rounded display value (codex review of batch 12: a wall 30 ms after the
   *  opening rounded to 0.0 and read "already up"). */
  startOffsetMs?: number;
  /** Raw ms from the burst's start to the aura's end (its logged end, or the
   *  unseen-end clamp `overlapSeconds` used) — with `startOffsetMs`, the
   *  stretch the wall was on the target; burst-into-mitigation picks a split
   *  row's component from the damage inside it (codex review
   *  85-tk-C-T27-2 #2). Optional for hand-built fixtures. */
  endOffsetMs?: number;
  /** T49: no press put this aura up — the `[ENEMY DEF]` line's own reading
   *  (`enemyDefensiveEvents`' `noPressLogged`: a copy a talent or proc put
   *  up, a rider shield). The ledger line then drops "pressed" and carries
   *  that line's own tag. */
  noPressLogged?: true;
  /** Raw ms from the burst's start to the press of the wall — the instant
   * "pressed Zs after" names: its cast row (T114, fact13 D22: a Spirit Link
   * Totem pressed 4.95 s in read `pressed 6.0s`, the instant its aura
   * settled on the target), or, for an interval that began as a copy no
   * press put up, the `[ENEMY DEF]` press that followed inside it (T98,
   * fact13 D5). Negative = pressed before the burst opened, the aura
   * reaching the target after it. Absent = no press row found (a proc, an
   * aura-only wall): the interval's start. */
  pressOffsetMs?: number;
}

/** Was the wall already up when the burst opened? One predicate for the
 *  ledger line and burst-into-mitigation (user ruling 2026-09-26: only a wall
 *  up at the opening is accused). undefined when the offset is unknown. */
export function wallUpAtOpen(d: {
  startOffsetMs?: number;
  startOffsetSeconds?: number;
}): boolean | undefined {
  if (d.startOffsetMs !== undefined) return d.startOffsetMs <= 0;
  if (d.startOffsetSeconds !== undefined) return d.startOffsetSeconds <= 0;
  return undefined;
}

/** "already up when the burst opened" / "pressed 1.2s after the burst
 *  opened"; an aura no press put up (`noPressLogged`, T49 — eacff4b7 2:23:
 *  Exhilaration's 3 s Survival of the Fittest read "pressed 6.7s after")
 *  reads "6.7s after the burst opened [no press logged]" — the `[ENEMY DEF]`
 *  line's tag verbatim, no new verb (ruling R22, 2026-11-10). */
export function wallTimingPhrase(
  d:
    | {
        startOffsetMs?: number;
        startOffsetSeconds?: number;
        noPressLogged?: true;
        pressOffsetMs?: number;
      }
    | undefined,
): string {
  if (!d) return "";
  const up = wallUpAtOpen(d);
  if (up === undefined) return "";
  if (up) return "already up when the burst opened";
  // a wall pressed before the opening whose aura reached the target after
  // it (a zone, a totem): the press is before the burst, not inside it
  // (batch review 80-PIPE-83-B70c)
  if (
    d.pressOffsetMs !== undefined &&
    d.pressOffsetMs < 0 &&
    !d.noPressLogged
  ) {
    const b = Math.round(-d.pressOffsetMs / 100) / 10;
    return `pressed ${b < 0.05 ? "<0.1" : b.toFixed(1)}s before the burst opened`;
  }
  // a copy a press then refreshed (T98): the press is when it was pressed
  const s =
    d.pressOffsetMs !== undefined
      ? Math.round(d.pressOffsetMs / 100) / 10
      : (d.startOffsetSeconds ?? (d.startOffsetMs ?? 0) / 1000);
  const after = `${s < 0.05 ? "<0.1" : s.toFixed(1)}s after the burst opened`;
  return d.noPressLogged
    ? `${after} ${ENEMY_DEF_NO_PRESS_TAG}`
    : `pressed ${after}`;
}

/** Slack between an `[ENEMY DEF]` event's start and the ledger's own aura
 *  interval of the same aura (both read the holder's aura rows; a float
 *  round trip through seconds is all that separates them). */
const NO_PRESS_SAME_AURA_S = 0.05;

export interface IBurstTargetDamage {
  unitId: string;
  unitName: string;
  damage: number;
}

/** One enemy's share of a burst: `damage` is what landed plus what its
 * shields absorbed (the figure the target is chosen on); `absorbed` is the
 * absorbed part of it — the attacker's `SPELL_ABSORBED` rows (T12 ⑤). */
export interface IBurstLedgerTargetDamage extends IBurstTargetDamage {
  absorbed: number;
}

export interface IBurstLedgerEntry {
  fromSeconds: number;
  toSeconds: number;
  /** Offensive CDs opening this burst, cast order. */
  spells: Array<{
    spellId: string;
    spellName: string;
    castTimeSeconds: number;
    /** end of this CD's own active span (`burstCastSpan`) — the header's
     *  span is the union (triage sync-burst F-L4) */
    spanToSeconds: number;
  }>;
  /** Player damage to enemy players inside the span (pets excluded from targeting). */
  totalDamage: number;
  /** Every enemy player the burst damaged, largest `damage` first — the list
   * `dominantTarget` is the head of. The `Target:` line prints the second
   * entry too (T12 ⑤): the head is chosen on landed + absorbed, so it can
   * lead by a little, and on landed damage alone not at all. */
  damageByTarget: IBurstLedgerTargetDamage[];
  /** Enemy player that received the most damage; null when the burst hit nothing. */
  dominantTarget: {
    unitId: string;
    unitName: string;
    /** The `[STATE]`-grid reading (`gridHpPct`) at the burst's rendered
     * start / end second — the numbers the same-second `[STATE]` ticks print
     * (triage hp-state F-B1; the raw-millisecond samples disagreed with the
     * tick on 115 of 142 ledger targets). `hpEndPct` is 0 when the target is
     * dead at the end second; either is null on a `ghost` second (T07). */
    hpStartPct: number | null;
    hpEndPct: number | null;
    /** The lowest HP inside the rendered span and the second it happened
     * at, when it is a trough worth printing (`isHpTroughWorthPrinting`, the
     * `[DMG SPIKE]` rule); null otherwise, and whenever an endpoint is
     * unknown or dead. A TROUGH since FT-T03 (user ruling 2026-10-10, D7):
     * `hpTroughInWindow`, the true minimum of every sample in the displayed
     * seconds — not the lowest whole-second tick, so it can sit below every
     * `[STATE]` number of the span. The two endpoints above stay grid
     * readings, and nothing decides on this field (`isBurstConverted` reads
     * `died`, the cards read the endpoints). */
    hpLow: { pct: number; atSeconds: number } | null;
    /** the last second is a Spirit of Redemption (`ghost`) second: the line
     * prints `A% → ghost` (`hpEndPct` is null there; codex B9 #2) */
    hpEndGhost?: true;
    damage: number;
    /** The part of `damage` the target's shields absorbed. */
    absorbed: number;
    defensivesHit: IBurstDefensiveHit[];
    /** Target died inside [from, to + KILL_CREDIT_SLACK_S]. */
    died: boolean;
  } | null;
  /** Enemy players OTHER than the dominant target that this burst damaged and
   * that died inside [from, to + KILL_CREDIT_SLACK_S] — the window `died`
   * uses (triage sync-burst F-L1: a burst whose first victim died early was
   * named after the survivor who took the rest, and printed no death). Keyed
   * on the burst's own damage, not a cast target. `dominantTarget.died` and
   * every conversion count are unchanged. */
  otherDeaths: Array<{ unitName: string; atSeconds: number }>;
  /** Ally offensive CDs whose active span overlaps this burst IN TIME — the
   * whole of what is measured (endpoints touching count; no minimum; no
   * target test). `dpsMetrics`' `alignedBurstRatio` counts bursts with a
   * non-empty list and is not changed by the two readings below. */
  allyCDsOverlapping: Array<{
    playerName: string;
    spellName: string;
    /** Seconds the ally CD's span and this burst's span share (0 for an
     * instant cooldown, whose span has no length, and for spans that only
     * touch). */
    overlapSeconds: number;
    /** The shared seconds' own endpoints (round seconds, unrounded) — the
     * span `topTarget` is summed over, both ends included. The line prints
     * only its length; the scan's `allyOverlapDeferral` re-sums this span
     * instead of guessing one from the printed tenth of a second (T94). */
    overlapFromSeconds: number;
    overlapToSeconds: number;
    /** The enemy player that ally damaged most inside the shared seconds —
     * landed + absorbed, the measure `dominantTarget` is chosen on — or null
     * when they damaged no enemy player in them (T12 ⑦: 0e0663e6's Voidform
     * was "aligned" with a burst on the paladin while 0.73M of the priest's
     * damage went to the hunter and 0.34M to the paladin). */
    topTarget: IBurstTargetDamage | null;
  }>;
  /** A healer's throughput major on the offensive roster (`isHealerHeldOffensive`:
   * a Holy Paladin's Avenging Wrath) an ally pressed whose span overlaps this
   * burst — not an ally offensive CD (fact11 D16), so not in
   * `allyCDsOverlapping`; the Solo line names it as not counted (user ruling
   * R01, 2026-11-08). Spell names, deduplicated; absent when none. */
  healerHeldOverlapping?: string[];
}

/** The burst ledger's sentence for a burst no ally offensive cooldown
 * overlapped by the ledger's reading (`allyOverlapSpan`: a press that puts a
 * copy on its target overlaps while that copy is on the ledger's holder).
 * User ruling R94 (2026-11-19, pipeline T161): it read `Solo burst — no ally
 * offensive CD overlapped`, which claimed a solo burst of a holder whose
 * teammate was under his own Power Infusion at the time; this says only
 * what the reading shows. "you" is the ledger's holder — the ledger is the
 * owner's own audit in every view it prints in. One constant for the line
 * and for the gate that reads it back (`checkBurstSoloHealerHeld`). */
export const NO_ALLY_CD_ON_HOLDER =
  "No ally offensive CD on you during this burst";

/** The Solo-burst line's note for a healer's throughput major that
 * overlapped the burst and is not counted (user ruling R01, 2026-11-08):
 * ` (a healer's Avenging Wrath is not counted)`; empty for none. The gate
 * (`checkBurstSoloHealerHeldNote`) matches this text. */
export function healerHeldNotCountedNote(
  spellNames: readonly string[],
): string {
  if (spellNames.length === 0) return "";
  const names = spellNames.join(" / ");
  return ` (a healer's ${names} ${spellNames.length > 1 ? "are" : "is"} not counted)`;
}

/**
 * Active span of one offensive CD cast: from the cast to the end of its
 * effect (`buffEndSeconds` — where the log shows the effect ended,
 * `observedEffectEndSeconds`, else the official duration for the caster),
 * nothing more. One predicate for every reader of "is this cooldown
 * running": the burst ledger's grouping / span / ally overlap, the
 * kill-attempt burst clusters (`killAttempts.ts`), kick-eaten's
 * `enemyBurst` / `ourBurst` (`kickPressure.ts`), missed-sync-window's `castEntersWindow` (`castEndS`, since
 * work order 2026-10-14d Part 2c), and the replay burst pulse (desktop
 * `replayHighlights.ts` — the pulse covers exactly the span the ledger
 * audits).
 *
 * Until 2026-10-01 the span was `max(buffEnd, cast + 10 s)` — a 10 s floor
 * borrowed from the clustering reach (`BURST_CLUSTER_SECONDS`). User ruling
 * A14 = B (2026-09-30, triage kick-eaten F-K1 × sync-burst F-L3): the floor
 * goes, globally. It named cooldowns whose effect had ended seconds earlier
 * as "running": c2058ed4 @18.2 `enemyBurst=Boomstick` (a 3 s effect cast at
 * 10.9), and 2abc9185's `Aligned with: … (Doom Winds)` credited from the
 * tail of a Strike of the Windlord that had ended 3 s before. An instant
 * cooldown is now a zero-length span: it is "running" for nobody and groups
 * only with casts in its own instant.
 *
 * The span ends at the OBSERVED aura chain when the log shows one (the
 * second half of A14, after the cast→effect table of CROSS-THEME G3, ruling
 * A10): `buffEndSeconds` is `enemyCDs.ts` → `observedEffectEndSeconds` when
 * it is known — an effect that ended early ends the span early, one that
 * re-application kept alive (02c8e3ac Dragonrage) lengthens it — else the
 * official duration.
 * `enemyCDs.ts`' aligned-window clustering keeps its own reach
 * (`BURST_CLUSTER_SECONDS`): "which casts form one go" is a different
 * question from "how long does one cast's effect run".
 */
export function burstCastSpan(
  cd: Pick<IEnemyCDCast, "castTimeSeconds" | "buffEndSeconds">,
): { from: number; to: number } {
  return {
    from: cd.castTimeSeconds,
    to: Math.max(cd.buffEndSeconds, cd.castTimeSeconds),
  };
}

/**
 * An ALLY's press as the `Ally CDs overlapping` sentence of `holderId`'s
 * ledger reads it (T161, user ruling R89, 2026-11-19): the sentence says
 * whether the holder's burst lined up with a teammate's cooldown, so when
 * the press put a copy of its effect ON THE HOLDER (a Power Infusion, a
 * Bloodlust), the overlap runs to the end of that copy — the holder was
 * under it — and not to the end of the caster's own (a priest's copy purged
 * at 17.6 s while the rogue's ran to 31.7 s is 14.0 s of the rogue's burst,
 * no burst without an ally cooldown on the holder), earlier or later than the caster's. A press with no copy on the holder — the caster's
 * alone, or one on a third teammate — keeps `ledgerCastSpan`. Never past
 * `buffEndSeconds`, the latest copy.
 */
export function allyOverlapSpan(
  cd: Pick<
    IEnemyCDCast,
    "spellId" | "castTimeSeconds" | "buffEndSeconds" | "casterCopyEndSeconds"
  >,
  ally: ICombatUnit,
  holderId: string,
  combat: Parameters<typeof observedEffectEndSeconds>[4],
  nextSameCastS: number = Infinity,
): { from: number; to: number } {
  const own = ledgerCastSpan(cd);
  if (holderId === ally.id) return own;
  // the holder's copy in either direction (codex 85-tk-WIN-T161-2 #1): one
  // purged off the holder at 16 s while the caster's ran to 21 s is no
  // overlap with the holder's burst at 17 s
  const onHolder = observedEffectEndSeconds(
    ally,
    cd.spellId,
    cd.castTimeSeconds,
    nextSameCastS,
    combat,
    holderId,
  );
  if (onHolder !== null && onHolder > cd.castTimeSeconds)
    return { from: own.from, to: Math.min(onHolder, cd.buffEndSeconds) };
  // a copy on the holder whose end the log never wrote is still a copy:
  // it runs to the press's own end (`buffEndSeconds`, the official length
  // at most), not to the caster's earlier one — "no ally cooldown on you"
  // must not be said of a buff still up (codex 85-tk-WIN-T161-4 #1)
  const holder = combat.units?.[holderId];
  const ids = effectSpanIdsOfCast(cd.spellId);
  const unclosedOnHolder =
    !!holder &&
    buildAuraIntervals(holder, combat).some(
      (iv) =>
        ids.has(iv.spellId) &&
        iv.srcUnitName === ally.name &&
        iv.inferredEnd &&
        !iv.inferredStart &&
        iv.fromS >= cd.castTimeSeconds - EFFECT_START_BEFORE_S &&
        iv.fromS <= cd.castTimeSeconds + EFFECT_START_AFTER_S,
    );
  return unclosedOnHolder ? { from: own.from, to: cd.buffEndSeconds } : own;
}

/**
 * `burstCastSpan` as the burst ledger reads it (T161, user ruling R83): the
 * span ends where the press's effect ended on its CASTER
 * (`casterCopyEndSeconds`) — a Power Infusion purged off the priest at 0:26
 * while its copy on the hunter ran to 0:31 is a burst of the priest's to
 * 0:26. The threat readers (`[RES]`, crisis, kick pressure, kill attempts)
 * keep `burstCastSpan`: the buff is still running on someone.
 */
export function ledgerCastSpan(
  cd: Pick<
    IEnemyCDCast,
    "castTimeSeconds" | "buffEndSeconds" | "casterCopyEndSeconds"
  >,
): { from: number; to: number } {
  return {
    from: cd.castTimeSeconds,
    to: Math.max(casterCopyEndSeconds(cd), cd.castTimeSeconds),
  };
}

/**
 * Groups one player's offensive CD casts into bursts and audits each one:
 * where the damage went, whether the dominant target had an immunity/major
 * defensive running, whether any ally CD overlapped, and whether the target died.
 *
 * CD detection shares the enemy-side predicate (reconstructEnemyCDTimeline);
 * casts group while their effect spans overlap (`burstCastSpan`).
 */
/**
 * One press that puts up its cast-id aura and its own-effect aura is one
 * defensive (fact8 D1, 0272f81c 0:28: Touch of Karma's 122470 and 125174 at
 * 1 ms apart read as two identical "major defensive up" lines). Same caster,
 * starting within `ALIAS_PRESS_TWIN_MS`, a cast and its effect
 * (`castsOfEffectAura`): the longer overlap stands, under the cast's id —
 * the id the press-keyed readers count (`viaLoggedAura` skips them).
 */
export function dropOnePressAuraTwins(hits: IBurstDefensiveHit[]): void {
  for (let i = hits.length - 1; i >= 0; i--) {
    const effect = hits[i];
    const cast = hits.find(
      (x) =>
        x !== effect &&
        x.casterName === effect.casterName &&
        Math.abs((x.startOffsetMs ?? 0) - (effect.startOffsetMs ?? 0)) <=
          ALIAS_PRESS_TWIN_MS &&
        castsOfEffectAura(effect.spellId).includes(x.spellId),
    );
    if (!cast) continue;
    cast.overlapSeconds = Math.max(cast.overlapSeconds, effect.overlapSeconds);
    if (effect.endOffsetMs !== undefined)
      cast.endOffsetMs = Math.max(
        cast.endOffsetMs ?? effect.endOffsetMs,
        effect.endOffsetMs,
      );
    hits.splice(i, 1);
  }
}

/** A row of an attacker's `damageOut` the ledger counts inside
 * [fromMs, toMs]: pets are merged into it upstream, a shield's
 * `SPELL_ABSORBED` row counts, a deferral shield's row and an absorb on
 * the attacker do not (`isDamageTakenRow`: what the target took). One reading for the ledger's per-target sum and
 * `burstDamageBySchoolOn`. */
function isLedgerDamageRow(
  d: ICombatUnit["damageOut"][number],
  fromMs: number,
  toMs: number,
): boolean {
  const t = d.logLine.timestamp;
  return t >= fromMs && t <= toMs && isDamageTakenRow(d);
}

/** One `[ENEMY DEF]` event of a burst target, as the ledger reads it. */
export interface IWallDefensiveEvent {
  spellId: string;
  atS: number;
  noPress: boolean;
  pressS?: number;
  /** an external's event is at its press; its aura's start beside */
  auraS?: number;
  casterName: string;
  casterId?: string;
}

/** The `[ENEMY DEF]` events (`enemyDefensiveEvents` of every enemy) on
 * `target`: by id — two enemies can carry one name (codex 85-tk-H-T49-1
 * #1) — the name only when the event has no id. */
export function wallDefensiveEventsOn(
  events: readonly IEnemyDefensiveEvent[],
  target: { id: string; name: string },
): IWallDefensiveEvent[] {
  return events
    .filter((e) =>
      e.recipientId !== undefined
        ? e.recipientId === target.id
        : e.casterId !== undefined
          ? e.casterId === target.id
          : e.casterName === target.name,
    )
    .map((e) => ({
      spellId: e.spellId,
      atS: e.atSeconds,
      noPress: e.noPressLogged === true,
      ...(e.pressSeconds !== undefined ? { pressS: e.pressSeconds } : {}),
      ...(e.auraFromS !== undefined ? { auraS: e.auraFromS } : {}),
      casterName: e.casterName,
      ...(e.casterId !== undefined ? { casterId: e.casterId } : {}),
    }));
}

/**
 * The `[ENEMY DEF]` reading of the wall interval from `startMs` to `endMs`
 * (the caller bounds `endMs` by the burst's end too: a press after the burst
 * is not its — batch review 80-PIPE-73-B70 #1): undefined when its start is
 * no copy (T49: a copy no press put up starts there) and no `[ENEMY DEF]`
 * press of its own (T114, fact13 D22: then that press, at its
 * `pressSeconds`); a copy, unless an
 * `[ENEMY DEF]` press of the same wall from the same source starts inside
 * the interval — then the interval is a pressed wall, timed at that press
 * (T98, fact13 D5). `buildAuraIntervals` does not cut where a press
 * refreshed the copy, so the ledger's one interval holds both lines of the
 * timeline (1a2fabdb 1:25: Exhilaration's Survival of the Fittest copy
 * 0.3 s, the hunter's press 8.0 s — all 8.3 s read `[no press logged]`).
 */
export function pressReadingOf(
  defOnTarget: readonly IWallDefensiveEvent[],
  targetIntervals: ReadonlyArray<{
    spellId: string;
    fromS: number;
    srcUnitId?: string;
    srcUnitName: string;
  }>,
  combatStartMs: number,
  spellId: string,
  src: { name: string; id?: string },
  startMs: number,
  endMs: number,
): { noPress: true } | { pressMs: number } | undefined {
  const atS = (startMs - combatStartMs) / 1000;
  const endS = (endMs - combatStartMs) / 1000;
  // the interval's own source: by id when both sides carry one (two
  // units can share a name — codex 85-tk-K-T98-1 #2), the name else
  const bySource = (e: { casterName: string; casterId?: string }) =>
    src.id !== undefined && e.casterId !== undefined
      ? e.casterId === src.id
      : e.casterName === src.name;
  const copy = defOnTarget.find(
    (e) =>
      e.noPress &&
      e.spellId === spellId &&
      Math.abs(e.atS - atS) <= NO_PRESS_SAME_AURA_S,
  );
  if (!copy) {
    // T114: a pressed wall's press is the `[ENEMY DEF]` line's own — the
    // event of this aura (an external's event sits at its press, paired
    // within `SAVE_CAST_AURA_PAIR_S`, with the aura's start beside it)
    const own = defOnTarget.find(
      (e) =>
        !e.noPress &&
        e.spellId === spellId &&
        bySource(e) &&
        Math.abs((e.auraS ?? e.atS) - atS) <= NO_PRESS_SAME_AURA_S,
    );
    return own
      ? { pressMs: combatStartMs + (own.pressS ?? own.atS) * 1000 }
      : undefined;
  }
  // a press that opens another interval of the wall from the same
  // source (a lost REMOVED, then a fresh press — codex 85-tk-K-T98-1
  // #1) refreshed nothing of this one; a press in its last instant
  // still did (codex 85-tk-K-T98-1b #1)
  const opensAnother = (s: number) =>
    targetIntervals.some(
      (x) =>
        x.spellId === spellId &&
        x.fromS > copy.atS + NO_PRESS_SAME_AURA_S &&
        Math.abs(x.fromS - s) <= NO_PRESS_SAME_AURA_S &&
        (src.id !== undefined && x.srcUnitId !== undefined
          ? x.srcUnitId === src.id
          : x.srcUnitName === src.name),
    );
  const press = defOnTarget
    .filter(
      (e) =>
        !e.noPress &&
        e.spellId === spellId &&
        bySource(e) &&
        e.atS > copy.atS &&
        e.atS <= endS &&
        !opensAnother(e.atS),
    )
    .sort((x, y) => x.atS - y.atS)[0];
  return press
    ? { pressMs: combatStartMs + (press.pressS ?? press.atS) * 1000 }
    : { noPress: true };
}

/**
 * T114 (fact13 D22, batch review 80-PIPE-73-B70 #2): the instant a summon's
 * (a totem's) wall press is paired from — its first pulse on anyone (its own
 * SUCCESS rows of the aura), or its first APPLIED of the wall on `target`, or
 * `startMs`, whichever is earliest. The holder can walk into a totem's range
 * a second or more after it went down (605: Spirit Link Totem pressed 1.1 s
 * and 1.5 s before its holder was linked), and the totem's aura can flicker
 * off and on before it settles (e2047b8b 2:48).
 */
export function summonPressAnchorMs(
  summon: ICombatUnit,
  target: ICombatUnit,
  spellId: string,
  startMs: number,
): number {
  return Math.min(
    startMs,
    ...summon.spellCastEvents
      .filter(
        (c) =>
          c.spellId === spellId &&
          c.logLine.event === LogEvent.SPELL_CAST_SUCCESS,
      )
      .map((c) => c.logLine.timestamp),
    ...target.auraEvents
      .filter(
        (a) =>
          a.spellId === spellId &&
          a.srcUnitId === summon.id &&
          a.destUnitId === target.id &&
          a.logLine.event === LogEvent.SPELL_AURA_APPLIED,
      )
      .map((a) => a.logLine.timestamp),
  );
}

/**
 * T114 (fact13 D22), when the `[ENEMY DEF]` events name no press of the
 * interval (an area save's line is keyed by its cast, not by the aura on the
 * target): the cast row (ms) of the press that put up the wall interval of
 * `spellId` from `srcUnitId` starting at `startMs`, the way `[ENEMY DEF]`
 * pairs a press with its aura (`pressSecondsOfAura`: the aura's own id or a
 * cast whose effect it is, at most `PRESS_TO_AURA_MAX_S` before the anchor or
 * `AURA_BEFORE_CAST_MAX_S` after; the nearest). A summon's aura is its
 * owner's press — the totem's own SUCCESS rows are its pulse, not the button
 * — anchored at `summonPressAnchorMs`. Undefined when no press row pairs.
 */
export function pressRowOf(
  unitOf: (id: string) => ICombatUnit | undefined,
  target: ICombatUnit,
  combatStartMs: number,
  spellId: string,
  srcUnitId: string | undefined,
  startMs: number,
): number | undefined {
  if (srcUnitId === undefined) return undefined;
  const src = unitOf(srcUnitId);
  if (!src) return undefined;
  const owner =
    src.ownerId && src.ownerId !== src.id ? unitOf(src.ownerId) : undefined;
  const presser = owner ?? src;
  const anchorMs = owner
    ? summonPressAnchorMs(src, target, spellId, startMs)
    : startMs;
  const anchorS = (anchorMs - combatStartMs) / 1000;
  const press = pressSecondsOfAura(
    presser.spellCastEvents,
    spellId,
    combatStartMs,
  )
    .filter(
      (t) =>
        t - anchorS <= AURA_BEFORE_CAST_MAX_S &&
        anchorS - t <= PRESS_TO_AURA_MAX_S,
    )
    .sort((a, b) => Math.abs(a - anchorS) - Math.abs(b - anchorS))[0];
  return press === undefined ? undefined : combatStartMs + press * 1000;
}

/** How far before a source-less aura its cast may be (the cast → effect
 * table's own window, castEffectAuraScan `WINDOW_S`, T124). */
export const SOURCELESS_CAST_WINDOW_S = 60;

/** Does an aura interval carry no source (Anti-Magic Zone 145629: every row
 * of it is logged with none)? */
export function isSourcelessAura(iv: {
  srcUnitId?: string;
  srcUnitName: string;
}): boolean {
  return (
    (!iv.srcUnitId || /^0+$/.test(iv.srcUnitId)) &&
    (!iv.srcUnitName || iv.srcUnitName === "nil")
  );
}

/**
 * Batch review 80-PIPE-75-B70b #1 (T114 meeting T124): the press of a
 * source-less wall aura on `target` starting at `startMs` — the way T124
 * keys such an aura to its cast: the casts whose effect it is
 * (`castsOfEffectAura`, the cast → effect table: Anti-Magic Zone 51052 →
 * 145629) pressed by a unit of the target's side (a summon counts as its
 * owner) in the `SOURCELESS_CAST_WINDOW_S` before the aura (or a moment
 * after it, `AURA_BEFORE_CAST_MAX_S`). One such root caster: its latest such
 * cast (and the caster's id). None, or several: no press — the line must not say "pressed" (a
 * teammate's zone the target walked into 4 s after it went down read
 * `pressed 9.0s after the burst opened`, the aura's arrival).
 */
export function sourcelessPressOf(
  units: readonly ICombatUnit[],
  target: ICombatUnit,
  combatStartMs: number,
  spellId: string,
  startMs: number,
): { pressMs: number; casterId: string } | { noPress: true } {
  const lo = startMs - SOURCELESS_CAST_WINDOW_S * 1000;
  const hi = startMs + AURA_BEFORE_CAST_MAX_S * 1000;
  const byRoot = new Map<string, number[]>();
  for (const u of units) {
    if (u.reaction !== target.reaction) continue;
    const root = u.ownerId && u.ownerId !== u.id ? u.ownerId : u.id;
    for (const t of pressSecondsOfAura(
      u.spellCastEvents,
      spellId,
      combatStartMs,
    )) {
      const ms = combatStartMs + t * 1000;
      if (ms < lo || ms > hi) continue;
      byRoot.set(root, [...(byRoot.get(root) ?? []), ms]);
    }
  }
  if (byRoot.size !== 1) return { noPress: true };
  const [casterId, ms] = [...byRoot][0]!;
  return { pressMs: Math.max(...ms), casterId };
}

/** The ledger's damage of `player` on `targetId` in [fromMs, toMs], keyed
 * by the hit's school mask (decimal) — the population
 * `dominantTarget.damage` sums, split by school. A landed row reads its own
 * school (`logSchoolMask(hitSchoolId(d))`); a shield-eaten row reads the
 * absorbed hit's (`absorbedHitSchoolMask`, the death audit's reading — its
 * spell field is the shield's, and a swing absorb carries the shield
 * caster's flags there, codex review 85-tk-C-T27-2b #1) and is left out when
 * that cannot be told. What burst-into-mitigation reads to choose a split
 * wall's component (codex review 85-tk-C-T27-2 #1: a pet's physical burst
 * read as the owner's magic one). */
export function burstDamageBySchoolOn(
  player: ICombatUnit,
  targetId: string,
  fromMs: number,
  toMs: number,
  /** `documentRecordsAttackSpell` over the round's units: an absorb with no
   * attack spell is then a swing */
  recordsAttackSpell: boolean,
): Record<string, number> {
  const by: Record<string, number> = {};
  for (const d of player.damageOut) {
    if (d.destUnitId !== targetId || !isLedgerDamageRow(d, fromMs, toMs))
      continue;
    const mask =
      (d.logLine.event as string) === LogEvent.SPELL_ABSORBED
        ? absorbedHitSchoolMask(
            d as unknown as Parameters<typeof absorbedHitSchoolMask>[0],
            recordsAttackSpell,
          )
        : logSchoolMask(hitSchoolId(d));
    if (mask === undefined) continue;
    by[String(mask)] = (by[String(mask)] ?? 0) + Math.abs(d.effectiveAmount);
  }
  return by;
}

const ALL_SCHOOLS_MASK = 0x7f;
/**
 * User ruling R102 (2026-11-20, pipeline T166: "挡不到就不印"): does the
 * wall touch NONE of this damage? `res` is the wall as THIS application
 * resolved (`resolveMitigation`: the table row plus its caster's talents —
 * Cloak of Shadows with Bait and Switch carries a physical 20 %, Blessing
 * of Protection with Echoing Blessings a magic 15 %); `bySchool` is the
 * burst holder's ledger damage on the target over the stretch of the burst
 * the wall covered (`burstDamageBySchoolOn`). True only when the wall met
 * damage of a known school and no component of it reaches any of that
 * damage — Blessing of Protection over 448k of frost and arcane (605 s0 14
 * r1). An immunity component reaches a hit only when it covers every
 * school of it (`immunityMaskStopsSchool`: a physical+fire hit lands
 * through Cloak's magic immunity). False — the wall stays — for a wall
 * with no table row (an absorb or a reflect: Anti-Magic Shell, Nether Ward
 * — outside the ruling), one whose talents could not be settled, one that
 * met no damage of a known school, and one any component of which reaches
 * any part of it. One predicate for the ledger's `defensivesHit` and every
 * reader of it; what the wall REFUSED is `wallRefusedAttackOf`.
 */
export function wallTouchesNoneOf(
  res: IResolvedMitigation | undefined,
  bySchool: Readonly<Record<string, number>>,
): boolean {
  if (!res || res.unresolved.length > 0) return false;
  let total = 0;
  let touched = 0;
  for (const [school, amount] of Object.entries(bySchool)) {
    const hit = Number(school) & ALL_SCHOOLS_MASK;
    // a row whose school the log did not give says nothing either way
    if (hit === 0) continue;
    total += amount;
    if (
      res.components.some(
        (c) =>
          (c.schoolMask & hit) !== 0 &&
          (c.kind !== "immunity" || immunityMaskStopsSchool(c.schoolMask, hit)),
      )
    )
      touched += amount;
  }
  return total > 0 && touched === 0;
}

/**
 * R102's other half: did the wall REFUSE an attack of the holder's in
 * [fromMs, toMs]? A go into an immunity lands nothing in its schools — the
 * rows come back refused, which is the wall working (5c48e842 r5: Rapid
 * Fire IMMUNE on Blessing of Protection, then an Arcane Shot landing).
 * A refused row counts when
 *  - it is on the target, by one of `attackers` (the holder and its pets:
 *    a pet's damage is merged into its owner's rows, its misses are not),
 *  - an immunity component of the wall covers every school of it (a
 *    Shockwave's physical IMMUNE under Cloak of Shadows is the stun
 *    refused by something else — 60eed1bf 1:23; a percentage wall such as
 *    Anti-Magic Zone refuses nothing),
 *  - it is IMMUNE, or a spell's MISS (Cloak turns spells into misses —
 *    2de375dc 1:05; a swing's MISS is an ordinary miss), and
 *  - the attack deals damage (`isDamaging`: a swing, or a spell with a
 *    damage row somewhere in the round) — a control refused is no burst
 *    damage stopped.
 */
export function wallRefusedAttackOf(
  res: Pick<IResolvedMitigation, "components"> | undefined,
  attackers: ReadonlyArray<Pick<ICombatUnit, "missesOut">>,
  targetId: string,
  fromMs: number,
  toMs: number,
  isDamaging: (spellId: string) => boolean,
): boolean {
  const immunities = (res?.components ?? []).filter(
    (c) => c.kind === "immunity",
  );
  if (immunities.length === 0) return false;
  return attackers.some((u) =>
    (u.missesOut ?? []).some((m) => {
      if (
        m.destUnitId !== targetId ||
        m.logLine.timestamp < fromMs ||
        m.logLine.timestamp > toMs
      )
        return false;
      const swing = (m.logLine.event as string).startsWith("SWING");
      const type = (m as { missType?: string }).missType;
      if (type !== "IMMUNE" && !(type === "MISS" && !swing)) return false;
      const school = swing
        ? 0x1
        : logSchoolMask(
            hitSchoolId(
              m as { spellSchoolId?: string; damageSchoolId?: string },
            ),
          ) ||
          (spellSchoolMask(String(m.spellId)) ?? 0);
      if ((school & ALL_SCHOOLS_MASK) === 0) return false;
      if (!swing && !isDamaging(String(m.spellId))) return false;
      return immunities.some((c) =>
        immunityMaskStopsSchool(c.schoolMask, school),
      );
    }),
  );
}

/**
 * The wall as R102 reads it: this application's resolved components
 * (`resolveMitigation`), or — for an immunity with no `MITIGATION_TABLE`
 * row whose DB2 SCHOOL_IMMUNITY covers only some schools
 * (`limitedImmunitySchoolMask`: Peaceweaver, magic) — one immunity
 * component over that mask (user ruling R116, 2026-11-24: Peaceweaver
 * joins R102's school test). Undefined = outside the test (an absorb or a
 * reflect: Anti-Magic Shell, Nether Ward; a full immunity).
 */
export function wallForSchoolTest(
  wallAuraSpellId: string,
  ctx: Parameters<typeof resolveMitigation>[1],
): IResolvedMitigation | undefined {
  const id = wallTableIdOfAura(wallAuraSpellId);
  const res = resolveMitigation(id, ctx);
  if (res) return res;
  const mask = limitedImmunitySchoolMask(id);
  return mask === undefined
    ? undefined
    : {
        spellId: id,
        positional: false,
        components: [
          { kind: "immunity", schoolMask: mask, pctMin: 100, pctMax: 100 },
        ],
        unresolved: [],
      };
}

/**
 * R102 / R116 in one call, for the ledger and the gate that checks its
 * wall lines (scan5/spanFacts `ledgerProcImmunityMissing`): the wall
 * reached none of `holder`'s damage on the target in [fromMs, toMs]
 * (`wallTouchesNoneOf`) and refused none of its or its pets' attacks there
 * (`wallRefusedAttackOf`) — it is not this burst's.
 */
export function wallIsOutsideBurst(
  res: IResolvedMitigation | undefined,
  holder: ICombatUnit,
  pets: readonly ICombatUnit[],
  targetId: string,
  fromMs: number,
  toMs: number,
  recordsAttackSpell: boolean,
  isDamaging: (spellId: string) => boolean,
): boolean {
  return (
    wallTouchesNoneOf(
      res,
      burstDamageBySchoolOn(holder, targetId, fromMs, toMs, recordsAttackSpell),
    ) &&
    !wallRefusedAttackOf(
      res,
      [holder, ...pets],
      targetId,
      fromMs,
      toMs,
      isDamaging,
    )
  );
}

/** A unit's pets in the round (`ownerId`). */
export function petsOf(
  unit: Pick<ICombatUnit, "id">,
  combat: Pick<AtomicArenaCombat, "units">,
): ICombatUnit[] {
  return (Object.values(combat.units ?? {}) as unknown as ICombatUnit[]).filter(
    (u) => u.ownerId === unit.id,
  );
}

/** Does a spell of these units have a damage row somewhere in the round —
 * `wallRefusedAttackOf`'s "the attack deals damage". */
export function damagingSpellIdsOf(
  units: ReadonlyArray<Pick<ICombatUnit, "damageOut">>,
): Set<string> {
  return new Set(
    units.flatMap((u) => (u.damageOut ?? []).map((d) => String(d.spellId))),
  );
}

export function analyzeBurstLedger(
  player: ICombatUnit,
  allies: ICombatUnit[],
  enemies: ICombatUnit[],
  combat: AtomicArenaCombat,
): IBurstLedgerEntry[] {
  // One computation per round object, player and pair of sides
  // (combatMemo.ts; pipeline T201): a prompt build asked for the owner's
  // ledger twice (the candidate menu, then the context's <burst_ledger>
  // block), the report three times. The entries are shared and read-only.
  return combatMemo(
    combat,
    `burstLedger|${identityToken(player)}|${unitTokens(allies)}|${unitTokens(enemies)}`,
    roundFingerprint(combat, [player], allies, enemies),
    () => analyzeBurstLedgerUncached(player, allies, enemies, combat),
  );
}

/** `analyzeBurstLedger` without the per-round memo (the equality test reads
 * both). */
export function analyzeBurstLedgerUncached(
  player: ICombatUnit,
  allies: ICombatUnit[],
  enemies: ICombatUnit[],
  combat: AtomicArenaCombat,
): IBurstLedgerEntry[] {
  // read once per call, and only when a wall asks (T166)
  let petsMemo: ICombatUnit[] | undefined;
  const petsOfHolder = (): ICombatUnit[] =>
    (petsMemo ??= petsOf(player, combat));
  // spells of the holder's side with a damage row somewhere in the round
  let damagingIdsMemo: Set<string> | undefined;
  const isDamagingSpell = (spellId: string): boolean =>
    (damagingIdsMemo ??= damagingSpellIdsOf([
      player,
      ...allies,
      ...petsOfHolder(),
    ])).has(spellId);
  let recordsAttackSpellMemo: boolean | undefined;
  const recordsAttackSpell = (): boolean =>
    (recordsAttackSpellMemo ??= documentRecordsAttackSpell(
      Object.values(combat.units ?? {}),
    ));
  const matchStartMs = combat.startTime;
  // Work order 2026-10-14d #7: a burst ends at the ROUND's end (a Solo
  // Shuffle round ends at its first death, `roundEndMs`), not the log's —
  // 0068182d `Burst #4 — 2:55–2:59` ran past the 2:57 round-ending death and
  // counted hits after it
  const roundEndAtMs = roundEndMs(combat);
  const matchEndS = (roundEndAtMs - matchStartMs) / 1000;
  const attackingSide = new Set<string>([
    player.name,
    ...allies.map((a) => a.name),
  ]);

  // a press after the round ended is no part of it — dropped BEFORE the
  // grouping: grouped by span, a post-round press joined the burst it
  // overlapped and printed `Avatar 0:10–0:20 + Recklessness 0:21–0:20` in a
  // Solo Shuffle round that ended at 0:20 (codex post-hoc 60-POSTHOC-03 U3)
  // …and a press the game refused (`refusedAtPress`, T29: Touch of the
  // Magi into an IMMUNE, nothing of it landed) ran no burst and overlapped
  // no ally's (codex T29-1 #2: a `10–10` burst, and an ally's Avatar
  // credited with a 0 s overlap)
  const pressedInRound = (cd: {
    castTimeSeconds: number;
    refusedAtPress?: true;
  }) => cd.castTimeSeconds < matchEndS && !cd.refusedAtPress;
  const ownCDs = (
    reconstructEnemyCDTimeline([player], combat).players[0]?.offensiveCDs ?? []
  ).filter(pressedInRound);
  if (ownCDs.length === 0) return [];

  // Ally offensive CD spans, computed once (player excluded).
  // A press's span ends at the same ally's next press of the same cooldown
  // (GH #196: Soul Immolation pressed 3 s apart, both spans counted in
  // full, 9.0 + 5.8 s against the 9.0 s its aura ran) — one run at a time,
  // as `[ENEMY DEF]` / `[TEAM] [CD]` save presses read it (fact11 D33).
  const spansOf = (a: ICombatUnit, cds: IEnemyCDCast[]) =>
    cds.map((cd) => {
      const key = canonicalSpellId(
        cd.spellId,
        logInstantOf(combat, matchStartMs),
      );
      const next = cds
        .filter(
          (c) =>
            c.castTimeSeconds > cd.castTimeSeconds &&
            canonicalSpellId(c.spellId, logInstantOf(combat, matchStartMs)) ===
              key,
        )
        .reduce((m, c) => Math.min(m, c.castTimeSeconds), Infinity);
      const span = allyOverlapSpan(cd, a, player.id, combat, next);
      return {
        ally: a,
        playerName: a.name,
        spellName: cd.spellName,
        from: span.from,
        to: Math.max(span.from, Math.min(span.to, next)),
      };
    });
  const otherAllies = allies.filter((a) => a.id !== player.id);
  const allyCDSpans = otherAllies.flatMap((a) =>
    spansOf(
      a,
      (
        reconstructEnemyCDTimeline([a], combat).players[0]?.offensiveCDs ?? []
      ).filter(pressedInRound),
    ),
  );
  // User ruling R01 (2026-11-08, fact12 D22): a healer's throughput major on
  // the offensive roster (a Holy Paladin's Avenging Wrath,
  // `isHealerHeldOffensive`) is no ally burst here (fact11 D16) while KILL
  // WINDOWS' `pressed inside` lists it; neither reader changes — a Solo
  // burst it overlapped says it was not counted. Same spans, same overlap
  // test as the counted ones.
  const healerHeldSpans = otherAllies
    .filter((a) =>
      Object.keys(HEALER_HELD_OFFENSIVE_SPEC).some((id) =>
        isHealerHeldOffensive(id, a.spec),
      ),
    )
    .flatMap((a) =>
      spansOf(
        a,
        (
          reconstructEnemyCDTimeline([a], combat, undefined, undefined, {
            keepHealerHeldPresses: true,
          }).players[0]?.offensiveCDs ?? []
        ).filter(
          (cd) =>
            pressedInRound(cd) && isHealerHeldOffensive(cd.spellId, a.spec),
        ),
      ),
    );

  const enemyPlayers = enemies.filter((e) => e.info);
  const enemyById = new Map(enemyPlayers.map((e) => [e.id, e]));

  // Group own casts by active-span overlap (`burstCastSpan`: the effect's own
  // length, no floor — ruling A14).
  const groups: IEnemyCDCast[][] = [];
  {
    let current: IEnemyCDCast[] = [];
    let reach = -Infinity;
    for (const cd of ownCDs) {
      if (current.length === 0 || cd.castTimeSeconds <= reach) {
        current.push(cd);
      } else {
        groups.push(current);
        current = [cd];
      }
      reach = Math.max(reach, ledgerCastSpan(cd).to);
    }
    if (current.length > 0) groups.push(current);
  }

  const entries: IBurstLedgerEntry[] = [];
  // every enemy's `[ENEMY DEF]` events, read once for the whole ledger and
  // only when a burst asks (T39: read per burst, it was 29 s of a 50 s ×12
  // report render — the events do not depend on the burst)
  let defAll: ReturnType<typeof enemyDefensiveEvents> | undefined;
  const defEvents = () =>
    (defAll ??= enemies.flatMap((e) =>
      enemyDefensiveEvents(e, enemies, combat),
    ));
  for (const group of groups) {
    const fromSeconds = group[0].castTimeSeconds;
    if (fromSeconds >= matchEndS) continue; // pressed after the round ended
    const toSeconds = Math.min(
      Math.max(...group.map((cd) => ledgerCastSpan(cd).to)),
      matchEndS,
    );
    const fromMs = matchStartMs + fromSeconds * 1000;
    const toMs = matchStartMs + toSeconds * 1000;

    // Player damage (pet damage is merged into damageOut upstream) to enemy players.
    const damageMap = new Map<string, number>();
    // The absorbed part of each sum, kept beside it (T12 ⑤): an attacker's
    // `damageOut` carries what a shield ate as rows of their own
    // (`SPELL_ABSORBED`, parser-compat convert.ts). The target is still
    // chosen on the whole — dfcccbf2: 301k landed + 403k absorbed on the
    // paladin made him `Target: … your damage 0.70M` over a warrior who took
    // 641k landed + 27k absorbed, and the line said neither.
    const absorbedMap = new Map<string, number>();
    for (const d of player.damageOut) {
      if (!enemyById.has(d.destUnitId)) continue;
      // a deferral shield's row is no absorb (FT-T02b, `isDeferralAbsorb`;
      // F16 retest idx 2: 0457a45e's `0.40M of it absorbed` was two-thirds
      // Time Dilation — the other burst readers already skip it)
      if (!isLedgerDamageRow(d, fromMs, toMs)) continue;
      const amount = Math.abs(d.effectiveAmount);
      damageMap.set(d.destUnitId, (damageMap.get(d.destUnitId) ?? 0) + amount);
      if ((d.logLine.event as string) === LogEvent.SPELL_ABSORBED)
        absorbedMap.set(
          d.destUnitId,
          (absorbedMap.get(d.destUnitId) ?? 0) + amount,
        );
    }
    const damageByTarget: IBurstLedgerTargetDamage[] = [...damageMap.entries()]
      .map(([unitId, damage]) => ({
        unitId,
        unitName: enemyById.get(unitId)?.name ?? unitId,
        damage,
        absorbed: absorbedMap.get(unitId) ?? 0,
      }))
      .sort((a, b) => b.damage - a.damage);
    const totalDamage = damageByTarget.reduce((s, t) => s + t.damage, 0);

    let dominantTarget: IBurstLedgerEntry["dominantTarget"] = null;
    const top = damageByTarget[0];
    if (top) {
      const target = enemyById.get(top.unitId)!;

      // Defensive/immunity auras actually ACTIVE on the target during the span
      // (real aura intervals, not cast+duration estimates).
      const defensivesHit: IBurstDefensiveHit[] = [];
      // T49: the auras on this target that no press put up, as the
      // `[ENEMY DEF]` line reads them — its own events, the target's and its
      // mates' (an external). Built once, for the first wall that started
      // after the burst opened. T98: with them, the presses of the same
      // walls, to find one inside a copy's interval.
      let defOnTarget: IWallDefensiveEvent[] | undefined;
      // an Aura Mastery that took the immunity branch is no defensive up
      // (`withoutImmunityBranchWalls`, ruling R53, pipeline T213)
      const targetIntervals = withoutImmunityBranchWalls(
        target,
        buildAuraIntervals(target, combat),
        combat.startTime,
      );
      const pressReadingOfWall = (
        spellId: string,
        src: { name: string; id?: string },
        startMs: number,
        endMs: number,
      ) =>
        pressReadingOf(
          (defOnTarget ??= wallDefensiveEventsOn(defEvents(), target)),
          targetIntervals,
          combat.startTime,
          spellId,
          src,
          startMs,
          endMs,
        );
      // a re-announced aura (APPLIED again within a second of its one press)
      // is that press: `buildAuraIntervals` joins it for every reader
      // (`joinReappliedIntervals`, GH #136.3; codex R6C-05 #2: one Guardian
      // Spirit read as two pressed walls)
      for (const iv of targetIntervals
        .filter((x) => DEF_OR_IMMUNE_IDS.has(x.spellId))
        .map((x) => ({
          spellId: x.spellId,
          spellName: x.spellName,
          srcUnitName: x.srcUnitName,
          srcUnitId: x.srcUnitId,
          startMs: combat.startTime + x.fromS * 1000,
          endMs: combat.startTime + x.toS * 1000,
          inferredEnd: x.inferredEnd,
        }))
        .sort((x, y) => x.startMs - y.startMs)) {
        // An aura OUR side put on the target is not the target's defensive —
        // the owner's own Touch of Karma tether (122470, applied by the monk
        // ON the enemy) read as "Target had a major defensive up" (reliability
        // round 2 W1h, d78f). An enemy teammate's external still counts.
        if (attackingSide.has(iv.srcUnitName)) continue;
        // A redirect external (Blessing of Sacrifice) also puts an aura on its
        // CASTER — that copy means the caster is taking extra damage, not
        // mitigating (reliability round 3 N4, 483f: the Ret who gave BoSac to
        // the hunter read as "a major defensive up ON THE TARGET").
        // (fact2 C4: the one caster-side-link predicate, `isCasterSideLinkAura`)
        if (isCasterSideLinkAura(iv.spellId, iv.srcUnitName === target.name))
          continue;
        // round-1 retest (62fdbf2e-r0, D6's unseen-end auras): an
        // invisibility / stealth whose end the log does not show is over by
        // the time its holder deals damage — Greater Invisibility 110960
        // logs no REMOVED, the builder closed it at 20 s, and the mage hit
        // at 0:25.3 before a burst at 0:28.4 read "active ON THE TARGET
        // 15.1s". A logged end stands; the holder's own action is the one
        // `untargetableEndS` reads (its pet's hits and its DoT ticks are
        // not — a Water Elemental's swing cut a Greater Invisibility short)
        const endMs =
          iv.inferredEnd && SAVE_AURA_END_UNSEEN_IDS.has(iv.spellId)
            ? Math.min(
                iv.endMs,
                holderFirstOwnActionAfterMs(
                  target,
                  iv.startMs,
                  iv.spellId,
                  Object.values(combat.units ?? {}),
                ),
              )
            : iv.endMs;
        const overlapMs = Math.min(endMs, toMs) - Math.max(iv.startMs, fromMs);
        if (overlapMs / 1000 < MIN_DEFENSIVE_OVERLAP_S) continue;
        // T166 (user ruling R102): a wall that reaches none of the holder's
        // damage in the stretch it covered, and refused none of its
        // attacks there, is not this burst's
        const lo = Math.max(iv.startMs, fromMs);
        const hi = Math.min(endMs, toMs);
        const wallRes = wallForSchoolTest(iv.spellId, {
          carrierIsCaster: iv.srcUnitName === target.name,
          caster: (combat.units as Record<string, ICombatUnit> | undefined)?.[
            iv.srcUnitId ?? ""
          ],
          atMs: iv.startMs,
        });
        if (
          wallIsOutsideBurst(
            wallRes,
            player,
            petsOfHolder(),
            target.id,
            lo,
            hi,
            recordsAttackSpell(),
            isDamagingSpell,
          )
        )
          continue;
        defensivesHit.push({
          ...(DEF_OR_IMMUNE_CAST_IDS.has(iv.spellId)
            ? {}
            : { viaLoggedAura: true as const }),
          spellId: iv.spellId,
          // Aura names in a Chinese-client log are localized text — prompt/facts
          // must be English (lesson from the CJK leak audit)
          spellName: getEnglishSpellName(iv.spellId, iv.spellName),
          overlapSeconds: Math.round(overlapMs / 100) / 10,
          // User ruling F-BI-full (2026-10-02, same rule as F-K9b-B): only a
          // FULL immunity (`FULL_IMMUNITY_IDS`: Ice Block, Divine Shield) is
          // "IMMUNE". Cloak of Shadows / Blessing of Protection / Spellwarding
          // stop one kind of damage — a burst through Cloak still lands its
          // physical part — so they show as the target's defensive.
          isImmunity: FULL_IMMUNITY_IDS.has(iv.spellId),
          appliedByOther: iv.srcUnitName !== target.name,
          casterName: iv.srcUnitName,
          startOffsetSeconds: Math.round((iv.startMs - fromMs) / 100) / 10,
          startOffsetMs: iv.startMs - fromMs,
          endOffsetMs: endMs - fromMs,
          ...(() => {
            const r =
              iv.startMs > fromMs
                ? pressReadingOfWall(
                    iv.spellId,
                    { name: iv.srcUnitName, id: iv.srcUnitId },
                    iv.startMs,
                    // a press after the burst ended is not this burst's:
                    // only the unpressed copy overlapped it (batch review
                    // 80-PIPE-73-B70 #1, a T122-extended burst)
                    // (and none after the holder's own action ended an
                    // unseen-end save: `endMs`, pipeline T113)
                    Math.min(endMs, toMs),
                  )
                : undefined;
            if (r && "noPress" in r) return { noPressLogged: true as const };
            // a source-less aura (Anti-Magic Zone): its press is its one
            // root caster's cast, else none (batch review 80-PIPE-75-B70b #1)
            const sourceless =
              iv.startMs > fromMs && isSourcelessAura(iv)
                ? sourcelessPressOf(
                    Object.values(combat.units ?? {}),
                    target,
                    combat.startTime,
                    iv.spellId,
                    iv.startMs,
                  )
                : undefined;
            if (sourceless && "noPress" in sourceless)
              return { noPressLogged: true as const };
            const pressMs =
              sourceless?.pressMs ??
              r?.pressMs ??
              (iv.startMs > fromMs
                ? pressRowOf(
                    (id) => combat.units?.[id],
                    target,
                    combat.startTime,
                    iv.spellId,
                    iv.srcUnitId,
                    iv.startMs,
                  )
                : undefined);
            // a press before the opening for an aura that came after it
            // keeps its own (negative) offset: the line says it was pressed
            // before the burst (batch review 80-PIPE-83-B70c — an
            // Anti-Magic Zone cast 1 s before the opening read `pressed
            // 1.0s after`, its arrival on the target)
            return pressMs !== undefined
              ? { pressOffsetMs: pressMs - fromMs }
              : {};
          })(),
        });
      }
      defensivesHit.sort((a, b) => b.overlapSeconds - a.overlapSeconds);
      dropOnePressAuraTwins(defensivesHit);

      const died = target.deathRecords.some(
        (dr) =>
          dr.timestamp >= fromMs &&
          dr.timestamp <= toMs + KILL_CREDIT_SLACK_S * 1000,
      );

      // Endpoints on the render grid: the line prints `fmtTime(from)–
      // fmtTime(to)` (floored), so its HP pair is the `[STATE]` reading of
      // those two seconds.
      const fromSec = toRenderSecond(fromSeconds);
      const toSec = toRenderSecond(toSeconds);
      const deadAtEnd = isDeadAtRenderSecond(target, matchStartMs, toSec);
      // `gridEndpointHpPct`, shared with `[DMG SPIKE]`: the tick's reading,
      // and 0 on a second the tick reads `dead` — at the end, and at the
      // start too (a death inside the burst's first rendered second: that
      // second's [STATE] tick already reads `dead`)
      const hpStartPct = gridEndpointHpPct(target, matchStartMs, fromSec);
      const hpEndPct = gridEndpointHpPct(target, matchStartMs, toSec);
      // the low is a trough (FT-T03): the true minimum inside the displayed
      // seconds, the `[DMG SPIKE]` line's own function and window
      const low =
        hpStartPct !== null && hpEndPct !== null && !deadAtEnd
          ? // not past the round's end (fact10 D30), no low on a ghost
            // second (codex 85-tk-B-T07-2)
            windowTroughOffGhost(
              target,
              matchStartMs,
              fromSec,
              toSec,
              roundEndAtMs,
            )
          : null;

      // codex B9 #2: a burst ending on a Spirit of Redemption second
      // withholds that end only (`A% → ghost`), never the trough before it
      const ghostEnd =
        hpStartPct !== null &&
        isGhostEndWindow(target, matchStartMs, fromSec, toSec);
      const ghostLow = ghostEnd
        ? ghostEndTroughInWindow(
            target,
            matchStartMs,
            fromSec,
            toSec,
            roundEndAtMs,
            hpStartPct,
          )
        : null;

      dominantTarget = {
        unitId: top.unitId,
        unitName: top.unitName,
        hpStartPct,
        hpEndPct,
        ...(ghostEnd ? { hpEndGhost: true as const } : {}),
        hpLow:
          low !== null &&
          isHpTroughWorthPrinting(hpStartPct!, hpEndPct!, low.pct)
            ? { pct: low.pct, atSeconds: low.atSec }
            : ghostLow
              ? { pct: ghostLow.pct, atSeconds: ghostLow.atSec }
              : null,
        damage: top.damage,
        absorbed: top.absorbed,
        defensivesHit,
        died,
      };
    }

    const otherDeaths: IBurstLedgerEntry["otherDeaths"] = [];
    for (const t of damageByTarget) {
      if (t.unitId === top?.unitId) continue;
      // "also hit" means hit: a fully absorbed tick (effective damage 0) on
      // a unit the rest of the team then killed is not this burst's victim
      if (t.damage <= 0) continue;
      const death = enemyById
        .get(t.unitId)
        ?.deathRecords.map((dr) => dr.timestamp)
        .filter((ms) => ms >= fromMs && ms <= toMs + KILL_CREDIT_SLACK_S * 1000)
        .sort((a, b) => a - b)[0];
      if (death !== undefined)
        otherDeaths.push({
          unitName: t.unitName,
          atSeconds: (death - matchStartMs) / 1000,
        });
    }
    otherDeaths.sort((a, b) => a.atSeconds - b.atSeconds);

    const allyCDsOverlapping = allyCDSpans
      .filter((s) => s.from <= toSeconds && s.to >= fromSeconds)
      .map((s) => {
        // T12 ⑦ (user ruling 2026-10-10): the overlap is a fact about time
        // and nothing else — print how long it was and where that ally's
        // damage went in it, instead of a word that reads as "same target".
        const overlapFrom = Math.max(s.from, fromSeconds);
        const overlapTo = Math.min(s.to, toSeconds);
        const oFromMs = matchStartMs + overlapFrom * 1000;
        const oToMs = matchStartMs + overlapTo * 1000;
        const byEnemy = new Map<string, number>();
        for (const d of s.ally.damageOut ?? []) {
          const ts = d.logLine.timestamp;
          if (ts < oFromMs || ts > oToMs) continue;
          if (!enemyById.has(d.destUnitId) || !isDamageSentRow(d)) continue;
          byEnemy.set(
            d.destUnitId,
            (byEnemy.get(d.destUnitId) ?? 0) + Math.abs(d.effectiveAmount),
          );
        }
        let topTarget: IBurstTargetDamage | null = null;
        for (const [unitId, damage] of byEnemy) {
          if (damage <= 0) continue;
          if (!topTarget || damage > topTarget.damage)
            topTarget = {
              unitId,
              unitName: enemyById.get(unitId)?.name ?? unitId,
              damage,
            };
        }
        return {
          playerName: s.playerName,
          spellName: s.spellName,
          overlapSeconds: Math.max(0, overlapTo - overlapFrom),
          overlapFromSeconds: overlapFrom,
          overlapToSeconds: overlapTo,
          topTarget,
        };
      });

    const healerHeldOverlapping = [
      ...new Set(
        healerHeldSpans
          .filter((s) => s.from <= toSeconds && s.to >= fromSeconds)
          .map((s) => s.spellName),
      ),
    ];

    entries.push({
      ...(healerHeldOverlapping.length > 0 ? { healerHeldOverlapping } : {}),
      fromSeconds,
      toSeconds,
      spells: group.map((cd) => ({
        spellId: cd.spellId,
        spellName: cd.spellName,
        castTimeSeconds: cd.castTimeSeconds,
        // clipped like the header's own end (the round can end mid-burst)
        spanToSeconds: Math.min(ledgerCastSpan(cd).to, toSeconds),
      })),
      totalDamage,
      damageByTarget,
      dominantTarget,
      otherDeaths,
      allyCDsOverlapping,
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Kill-window targeting audit (per player)
// ---------------------------------------------------------------------------

export interface IWindowTargetingAudit {
  windowFromSeconds: number;
  windowToSeconds: number;
  windowTargetId: string;
  windowTargetName: string;
  /** Player damage to all enemy players inside the window. */
  playerDamageTotal: number;
  playerDamageToTarget: number;
  /** 0–100, rounded. */
  onTargetPct: number;
  /** Biggest non-window-target recipient of the player's damage, if any. */
  topOffTarget: IBurstTargetDamage | null;
  /** The player's damage went where the TEAM's went (the enemy receiving the
   * most friendly damage in the window), not to the window's defenseless
   * target — following the focus is not an individual off-target problem
   * (reliability round 3 24b6 / 6954: 85–87 % of team damage on Saérox while
   * the ledger named the enemy healer as "the target"). */
  followedTeamFocus?: boolean;
}

/**
 * For each offensive window (computeOffensiveWindows output), splits this player's
 * damage by enemy target and reports how much landed on the window's target.
 * Windows where the player dealt no damage are skipped — usually CC/death, which
 * the CC and death analyses already own.
 */
export function auditWindowTargeting(
  player: ICombatUnit,
  windows: IOffensiveWindow[],
  enemies: ICombatUnit[],
  combat: AtomicArenaCombat,
): IWindowTargetingAudit[] {
  const matchStartMs = combat.startTime;
  const enemyById = new Map(
    enemies.filter((e) => e.info).map((e) => [e.id, e]),
  );
  const audits: IWindowTargetingAudit[] = [];

  for (const w of windows) {
    if (w.durationSeconds < MIN_WINDOW_SECONDS) continue;
    const fromMs = matchStartMs + w.fromSeconds * 1000;
    // Damage share after the window's target dies is meaningless — truncate the
    // evaluation at the target's death (2026-07-16 DPS baseline: ≥8 matches
    // where the responder/judge called out this artifact by name).
    const target = enemyById.get(w.targetUnitId);
    // Take the **earliest** death after the window start. Using .find() to take
    // "the first in array order" would assume deathRecords is sorted ascending
    // by time — an upstream implementation detail, not a contract; out of order
    // it would truncate at a later death, stretching the window and diluting the
    // on-target share. min does not depend on ordering.
    const deathsAfter = (target?.deathRecords ?? [])
      .map((d) => d.timestamp)
      .filter((t) => t > fromMs);
    const targetDeathMs =
      deathsAfter.length > 0 ? Math.min(...deathsAfter) : undefined;
    const toMs = Math.min(
      matchStartMs + w.toSeconds * 1000,
      targetDeathMs ?? Infinity,
    );
    if ((toMs - fromMs) / 1000 < MIN_WINDOW_SECONDS) continue;

    const damageMap = new Map<string, number>();
    for (const d of player.damageOut) {
      if (d.logLine.timestamp < fromMs || d.logLine.timestamp > toMs) continue;
      if (!enemyById.has(d.destUnitId) || !isDamageSentRow(d)) continue;
      damageMap.set(
        d.destUnitId,
        (damageMap.get(d.destUnitId) ?? 0) + Math.abs(d.effectiveAmount),
      );
    }
    const total = [...damageMap.values()].reduce((s, v) => s + v, 0);
    if (total <= 0) continue;

    const onTarget = damageMap.get(w.targetUnitId) ?? 0;
    let topOffTarget: IBurstTargetDamage | null = null;
    for (const [unitId, damage] of damageMap) {
      if (unitId === w.targetUnitId) continue;
      if (!topOffTarget || damage > topOffTarget.damage) {
        topOffTarget = {
          unitId,
          unitName: enemyById.get(unitId)?.name ?? unitId,
          damage,
        };
      }
    }

    // team focus: the enemy that took the most damage from the player's side
    const teamDamage = new Map<string, number>();
    for (const u of Object.values(combat.units ?? {}) as ICombatUnit[]) {
      if (!u.info || u.reaction !== player.reaction) continue;
      for (const d of u.damageOut ?? []) {
        if (d.logLine.timestamp < fromMs || d.logLine.timestamp > toMs)
          continue;
        if (!enemyById.has(d.destUnitId) || !isDamageSentRow(d)) continue;
        teamDamage.set(
          d.destUnitId,
          (teamDamage.get(d.destUnitId) ?? 0) + Math.abs(d.effectiveAmount),
        );
      }
    }
    let teamFocusId: string | undefined;
    for (const [id, dmg] of teamDamage)
      if (teamFocusId === undefined || dmg > (teamDamage.get(teamFocusId) ?? 0))
        teamFocusId = id;
    const followedTeamFocus =
      teamFocusId !== undefined &&
      teamFocusId !== w.targetUnitId &&
      topOffTarget?.unitId === teamFocusId;

    audits.push({
      windowFromSeconds: w.fromSeconds,
      windowToSeconds: (toMs - matchStartMs) / 1000,
      windowTargetId: w.targetUnitId,
      windowTargetName: w.targetName,
      playerDamageTotal: total,
      playerDamageToTarget: onTarget,
      onTargetPct: Math.round((100 * onTarget) / total),
      topOffTarget,
      followedTeamFocus,
    });
  }

  return audits;
}

/** On-target share below this = off-target discipline problem.
 * Shared by the report card chip, the prompt block, and the off-target finding.
 *
 * GH #34 batch 4 (2026-08-28), same corpus, 6,239 kill windows audited for
 * DPS friendlies: onTargetPct < 20 2,053 · [20,40) 1,654 · [40,50) 736 ·
 * [50,60) 556 · [60,80) 841 · [80,100) 376 · 100 23 (p50 32 %). Share
 * flagged "off-target": < 40 59.4 % · **< 50 71.2 %** · < 60 80.1 %. At 50 the
 * criterion fires on nearly three windows in four — it describes the norm,
 * not a discipline problem; whether that is intended (or the kill-window
 * target itself is the wrong reference, GH #31) is a value-gate question
 * recorded on the issue. Value unchanged. Measured, not official. */
export const ON_TARGET_GOOD_PCT = 50;

// ---------------------------------------------------------------------------
// Prompt formatter (DPS owner — timeline path <burst_ledger> block)
// ---------------------------------------------------------------------------

const fmtM = (n: number): string => `${(n / 1_000_000).toFixed(2)}M`;

/** `X.XXM`, plus ` (A.AAM of it absorbed)` when the absorbed part has a figure
 * to print at the line's precision (it is not `0.00M`). */
function fmtDamageWithAbsorbed(damage: number, absorbed: number): string {
  const a = fmtM(absorbed);
  return a === fmtM(0) ? fmtM(damage) : `${fmtM(damage)} (${a} of it absorbed)`;
}

/** The label of the `Target:` line's clause for the second enemy the burst
 * damaged. The gate (`checkBurstTargetDamageParts`) reads it back. */
export const BURST_SECOND_TARGET_LABEL = "second target";

/**
 * The second entry of `damageByTarget` as the `Target:` line prints it
 * (T12 ⑤, user ruling 2026-10-10) — ` | second target: <name> X.XXM[ (A of it
 * absorbed)]` — or "" when the burst damaged one enemy player only.
 *
 * Printed when the second enemy took at least half of what the named target
 * took (`ON_TARGET_GOOD_PCT`, the off-target line's own half) — the case the
 * evidence measured: on 60 raw rounds 34 of 131 ledger targets had a second
 * enemy at half the target's figure or more, and for 2 the order flips on
 * landed damage alone. Below that it is incidental cleave: printed down to
 * the line's precision it named an enemy for 5k of a 3.5M burst (review
 * 40-FT-53 P2). From the same list and sums the target was chosen on.
 */
export function burstSecondTargetClause(
  damageByTarget: IBurstLedgerEntry["damageByTarget"],
): string {
  const top = damageByTarget[0];
  const second = damageByTarget[1];
  if (!top || !second || fmtM(second.damage) === fmtM(0)) return "";
  if (second.damage * 100 < top.damage * ON_TARGET_GOOD_PCT) return "";
  return ` | ${BURST_SECOND_TARGET_LABEL}: ${second.unitName} ${fmtDamageWithAbsorbed(second.damage, second.absorbed)}`;
}

/** The label of the line that lists the ally offensive CDs overlapping a
 * burst. It replaced `Aligned with:` (T12 ⑦) — a word the measurement, an
 * overlap in time, does not carry. */
export const BURST_ALLY_OVERLAP_LABEL = "Ally CDs overlapping";

/** What an overlap item says when that ally damaged no enemy player in it. */
const ALLY_NO_DAMAGE_IN_OVERLAP = "no damage by them on enemy players in it";

/** One item's tail on the `Ally CDs overlapping:` line, as the gate reads it
 * back (global): 1 = the overlap in seconds, 2 = that ally's top target in
 * it, 3 = their damage on it (2 and 3 absent = no damage in it). */
export const BURST_ALLY_OVERLAP_ITEM_RE_SRC = String.raw` (\d+\.\d)s \((?:${ALLY_NO_DAMAGE_IN_OVERLAP}|their top target in it: (\S+) (\d+\.\d{2})M)\)(?=; |$)`;

function formatAllyOverlaps(b: IBurstLedgerEntry): string {
  return `    ${BURST_ALLY_OVERLAP_LABEL}: ${b.allyCDsOverlapping
    .map(
      (a) =>
        `${a.playerName} ${a.spellName} ${a.overlapSeconds.toFixed(1)}s (${
          a.topTarget
            ? `their top target in it: ${a.topTarget.unitName} ${fmtM(a.topTarget.damage)}`
            : ALLY_NO_DAMAGE_IN_OVERLAP
        })`,
    )
    .join("; ")}`;
}

/** The `Target:` line from `| your damage` on, as the gate reads it back:
 * 1 = the target's figure, 2 = its absorbed part, 3 = the second target's
 * name, 4 = its figure, 5 = its absorbed part. */
export const BURST_TARGET_DAMAGE_RE_SRC = String.raw` \| your damage (\d+\.\d{2})M(?: \((\d+\.\d{2})M of it absorbed\))?(?: \| target DIED)?(?: \| ${BURST_SECOND_TARGET_LABEL}: (.+?) (\d+\.\d{2})M(?: \((\d+\.\d{2})M of it absorbed\))?)?(?: \| also hit: .*)?$`;

/** The header's CD list: with two or more CDs each carries its own span
 *  (triage sync-burst F-L4: `Dark Transformation + Army of the Dead` under
 *  one 0:11–0:41 span, while DT's own span ended at 0:26). */
function formatBurstSpells(spells: IBurstLedgerEntry["spells"]): string {
  if (spells.length < 2) return spells.map((s) => s.spellName).join(" + ");
  return spells
    .map(
      (s) =>
        `${s.spellName} ${fmtTime(s.castTimeSeconds)}–${fmtTime(s.spanToSeconds)}`,
    )
    .join(" + ");
}

/**
 * Renders the burst ledger as plain text for the AI context (DPS owners).
 * Times via fmtTime (floored render grid), percentages as ints — any future
 * gate re-parsing these lines re-derives the same values.
 */
/**
 * Whether a burst may be said to have dealt no damage: it has no damage
 * rows AND a window damage could have fallen into. A zero-length burst (a
 * press with no effect and no delivery row, `pressDeliveryEndSeconds`) says
 * nothing about its damage. One reading for the prompt's `No damage dealt`
 * line and the report card's tag (T72 attempt 2: the card tagged 108 of the
 * 605 owner bursts whose delivery the recap listed seconds later).
 */
export function burstSaysNoDamage(
  b: Pick<IBurstLedgerEntry, "dominantTarget" | "fromSeconds" | "toSeconds">,
): boolean {
  return b.dominantTarget === null && b.toSeconds > b.fromSeconds;
}

export function formatBurstLedgerForContext(
  bursts: IBurstLedgerEntry[],
  targeting: IWindowTargetingAudit[],
  kicks: IKickAuditEntry[],
  /** How a kick's miss target is named when it is not a player — a totem's
   * unit name is whatever language the log was written in (FT-T11 follow-up:
   * `[IMMUNE: 根基图腾]` on a zhCN log, `checkCjkLeak`). Absent = the name. */
  missTargetLabel: (name: string, unitId: string) => string = (name) => name,
): string[] {
  if (bursts.length + targeting.length + kicks.length === 0) return [];
  const lines: string[] = ["## BURST LEDGER (your offensive audit)"];
  // FT-T02d: what the damage figure is. T12 ⑤: what "Target" is, and the
  // two readings the one figure used to hide.
  if (bursts.length > 0)
    lines.push(
      // one line: readers index the block's lines from the top
      `  \`Target\` = the enemy player your own damage in the burst was highest on, counting what its shields absorbed. \`your damage\` = that figure: what landed plus what the shields absorbed; \`(A of it absorbed)\` = the absorbed part, printed when it is not 0.00M. \`${BURST_SECOND_TARGET_LABEL}: X N\` = the enemy player your damage was next highest on, same measure — printed when that enemy took at least half of the Target's figure; it can be close to the Target's figure, and ahead of it on landed damage alone. \`${BURST_ALLY_OVERLAP_LABEL}\` = a teammate's offensive cooldown was running during part of this burst — an overlap in time and nothing more: \`Ns\` = how long the two ran together (0.0s = an instant cooldown pressed inside the burst, or the two only touched), \`their top target in it\` = the enemy player that teammate damaged most in those seconds (landed + absorbed), which need not be this burst's Target.`,
    );
  // FT-T03 (ruling D7): the low is off the grid — legended when one prints
  // (worded without the literal line tag: tests and gates find the target
  // line by it)
  if (bursts.some((b) => b.dominantTarget?.hpEndGhost))
    lines.push(
      "  On a burst's target line, `A% → ghost` = the burst's last second is one that unit's [STATE] tick reads `ghost` (Spirit of Redemption: no HP reading).",
    );
  if (bursts.some((b) => b.dominantTarget?.hpLow))
    lines.push(
      "  On a burst's target line, `A% → B% (low L% at m:ss)` = that unit's [STATE] readings at the burst's first and last second; `low` = the lowest HP the log shows for it in between, at the second it happened (the true minimum between the ticks: it can sit below every [STATE] number of the span).",
    );

  bursts.forEach((b, i) => {
    lines.push(
      `  Burst #${i + 1} — ${fmtTime(b.fromSeconds)}–${fmtTime(b.toSeconds)} | ${formatBurstSpells(b.spells)}`,
    );
    const t = b.dominantTarget;
    if (t) {
      const lowStr = t.hpLow
        ? ` (low ${t.hpLow.pct}% at ${fmtTime(t.hpLow.atSeconds)})`
        : "";
      const hpStr =
        t.hpStartPct !== null && t.hpEndPct !== null
          ? ` ${Math.round(t.hpStartPct)}% → ${Math.round(t.hpEndPct)}%${lowStr}`
          : t.hpStartPct !== null && t.hpEndGhost
            ? ` ${Math.round(t.hpStartPct)}% → ghost${lowStr}`
            : "";
      // F-L1: the burst's other victim(s) — a fact about who else it hit
      // and killed; the target above is unchanged
      const alsoStr =
        b.otherDeaths.length > 0
          ? ` | also hit: ${b.otherDeaths
              .map(
                (d) =>
                  // `+N.Ns` is from the burst's raw start, like the
                  // dominant target's own DIED offset and `defensivesHit`:
                  // an interval, not a grid reading (the header and DIED
                  // stamps are floored, so 27.95 → 28.05 reads 0:28 (+0.1s))
                  `${d.unitName} DIED ${fmtTime(d.atSeconds)} (+${(d.atSeconds - b.fromSeconds).toFixed(1)}s)`,
              )
              .join("; ")}`
          : "";
      lines.push(
        `    Target: ${t.unitName}${hpStr} | your damage ${fmtDamageWithAbsorbed(t.damage, t.absorbed)}${t.died ? " | target DIED" : ""}${burstSecondTargetClause(b.damageByTarget)}${alsoStr}`,
      );
      for (const d of t.defensivesHit) {
        // 2026-07-16 smoke test: without spelling out "on the target", the
        // responder misreads this as one of our own externals (Pain Suppression
        // can only be cast on a teammate → it reasons "so it is not target
        // mitigation"). The subject must be explicit.
        // fact2 C1 (2026-10-20, user ruling 4): an ally's copy of a
        // talent-shared wall (Flameshaper Obsidian Scales, 15 %) is under
        // the 20 % wall floor — KILL WINDOWS' `defenseless` and KILL
        // ATTEMPTS do not count it (`isBelowWallFloorExternal`), so the
        // ledger does not call it a major defensive either
        const copyPct = allyCopyPctOf(d);
        const what = d.isImmunity
          ? "⚠ Target was IMMUNE"
          : copyPct !== undefined
            ? `Target had an ally's ${copyPct}% copy up (below the ${MITIGATION_AURA_MIN_PCT}% wall floor, not a major defensive)`
            : "Target had a major defensive up";
        lines.push(
          `    ${what}: ${d.spellName} active ON THE TARGET ${d.overlapSeconds.toFixed(1)}s of this burst${wallUpAtOpen(d) !== undefined ? ` (${wallTimingPhrase(d)})` : ""}`,
        );
      }
    } else if (burstSaysNoDamage(b)) {
      lines.push(`    No damage dealt to enemy players during this burst.`);
    }
    // A zero-length burst (an offensive cooldown with no tracked buff — Soul
    // Fire, whose hit lands after the cast) has no window damage could fall
    // into: saying "No damage dealt" there contradicted the KILL ATTEMPTS
    // row of the same cast (pre-review of the burst-span batch: 50 owner
    // files on 605). Until the observed-chain half (CROSS-THEME G3) gives
    // such a cast its effect, the line says nothing about its damage.
    lines.push(
      b.allyCDsOverlapping.length > 0
        ? formatAllyOverlaps(b)
        : `    ${NO_ALLY_CD_ON_HOLDER}${healerHeldNotCountedNote(b.healerHeldOverlapping ?? [])}.`,
    );
  });

  const offTarget = targeting.filter(
    (w) => w.onTargetPct < ON_TARGET_GOOD_PCT && !w.followedTeamFocus,
  );
  for (const w of offTarget) {
    lines.push(
      `  Off-target: window ${fmtTime(w.windowFromSeconds)}–${fmtTime(w.windowToSeconds)} target ${w.windowTargetName} — only ${w.onTargetPct}% of your damage on target` +
        (w.topOffTarget
          ? ` (largest off-target: ${w.topOffTarget.unitName} ${fmtM(w.topOffTarget.damage)})`
          : ""),
    );
  }

  if (kicks.length > 0) {
    // the target as this line names units elsewhere (`silenced <name>`)
    const missTag = (k: IKickAuditEntry) => kickMissTag(k, missTargetLabel);
    const parts = kicks.map((k) => {
      const at = fmtTime(k.atSeconds);
      switch (k.result) {
        case "landed":
          return `${at} ${k.kickSpellName} → interrupted ${k.interruptedSpellName}`;
        case "silenced":
          // "no cast interrupted" only when the target had no open cast:
          // a silence stops a bar without a SPELL_INTERRUPT row
          return `${at} ${k.kickSpellName} → silenced ${k.silencedTargetName} (${
            k.openCastSpellName
              ? `their ${k.openCastSpellName} cast did not finish`
              : "no cast interrupted"
          })${missTag(k)}`;
        case "juked":
          return k.jukedChannelStoppedAgoS !== undefined
            ? `${at} ${k.kickSpellName} → ${jukedByStoppedChannelText(k)}${missTag(k)}`
            : `${at} ${k.kickSpellName} → ${jukedByFakeText(k)}${missTag(k)}`;
        case "missed":
          // no "hit nothing" for a kick refused at a live cast (T52)
          return `${at} ${k.kickSpellName} → ${`${missedKickText(k)}${missTag(k)}`.trim()}`;
        default:
          return `${at} ${k.kickSpellName} → outcome unknown (no cast-start data)${missTag(k)}`;
      }
    });
    lines.push(`  Kicks: ${parts.join(" | ")}`);
  }

  return lines;
}

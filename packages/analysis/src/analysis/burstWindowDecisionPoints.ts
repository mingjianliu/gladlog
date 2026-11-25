/**
 * Enemy-burst-window decision points — GH #60 phase 1 (engine + reference
 * table only; nothing here is wired into the product yet).
 *
 * The shape is deliberately the same pipeline as `crisisDecisionPoints.ts`
 * (decision point → responses → feasibility gate → table-only outcomes), for
 * the same reason: the product's future "you had no answer to this burst" and
 * the corpus reference's "how often does a team that answered still lose
 * someone here" must be the SAME window, the SAME response taxonomy and the
 * SAME feasibility gate, or the two numbers are not comparable (CLAUDE.md
 * shared-predicate rule).
 *
 * The decision point is the START of an enemy burst window. Windows come from
 * the existing builder (`utils/enemyCDs.ts` → `reconstructEnemyCDTimeline`,
 * whose `alignedBurstWindows` is the one place that decides what an enemy
 * burst is), then get **bounded per exchange** here: GH #60 coarse spot 3 —
 * the builder's groups are unbounded (corpus p50 21.6 s) because a cast within
 * `BURST_CLUSTER_SECONDS` of ANY earlier group cast keeps extending the group,
 * so "inside the window" spans several exchanges. `boundBurstWindow` cuts a
 * group wherever pressure lapses (no enemy offensive CD buff running AND
 * incoming damage under a floor, for `BURST_LAPSE_SECONDS` consecutive
 * seconds) and re-qualifies each piece with the builder's own qualification
 * rule.
 *
 * Render-grid discipline (CLAUDE.md): every HP number this module produces
 * comes from `gridHpPct` — the `[STATE]` tick's own sampler — read at WHOLE
 * seconds, and never at a second `isDeadAtRenderSecond` says the unit did not
 * live to see. `tSec`/`endSec` are the seconds `fmtTime` will display.
 */
import { type ICombatUnit } from "@gladlog/parser-compat";

import { ABILITY_EFFECTS_GENERATED } from "../data/abilityEffectsGenerated";
import { AURA_ONLY_ACTIVATION_IDS } from "../data/auraActivation";
import { castAndEffectIds, isCastOrEffect } from "../data/castEffectAuras";
import { CURATED_ABILITY_FACTS } from "../data/curatedAbilityFacts";
import { HEALING_VERDICTS } from "../data/healingVerdicts";
import { getEnglishSpellName } from "../data/spellEffectData";
import spellIdLists, { ENEMY_REDIRECT_SAVE_IDS } from "../data/spellIdLists";
import {
  ccSpellIds,
  rootSpellIds,
  spells as spellMeta,
} from "../data/spellTags";
import { allyCopyRecipient } from "../utils/allyCopyWall";
import { supersededAuraBreaks } from "../utils/auraIntervals";
import { buffDurationOfApplication } from "../utils/buffDuration";
import {
  controlTargetHitPressured,
  damageTakenBetween,
  hitByAttackers,
} from "../utils/burstHit";
import {
  petCastersOf,
  pressBlockedIntervalsForSpells,
} from "../utils/cannotCastIntervals";
import { PRESS_TRIGGERED_CAST_IDS } from "../utils/castMissRows";
import { COPY_CAST_IDS } from "../utils/castPress";
import {
  auraOnlyActivationSeconds,
  canHelpAnotherUnit,
  cdHelpsRecipient,
  cdIsProcOnly,
  cdReadyInTimeAt,
  extractMajorCooldowns,
  gridHpPct,
  hpTroughInWindow,
  type IMajorCooldownInfo,
  isDeadAtRenderSecond,
  RESPONSE_ONLY_DEFENSIVE_IDS,
  roundClippedTroughSpan,
  secondsPastRoundEnd,
  specToString,
  TEAM_HEAL_CD_IDS,
} from "../utils/cooldowns";
import { externalReachYards } from "../utils/deathOutcomeAnalysis";
import { drEffectAurasOfCast } from "../utils/drAnalysis";
import {
  type IAlignedBurstWindow,
  type IEnemyCDTimeline,
  observedEffectEndSeconds,
  reconstructEnemyCDTimeline,
  SOLO_WINDOW_MIN_WEIGHT,
} from "../utils/enemyCDs";
import { isRoundLandedDamageRow } from "../utils/incomingPressure";
import { LANDED_PAIR_MS } from "../utils/kickAudit";
import { getUnitPositionAtTime } from "../utils/losAnalysis";
import { NO_PRESS_SUFFIX } from "../utils/offensiveAuraOccurrences";
import { LOS_SWEEP_GAP_MS } from "../utils/positionSampling";
import { canReachTargetAt } from "../utils/rootReachability";
import { buildRosterSides, type RosterSides } from "../utils/rosterSide";
import { roundDamageEndMs, roundEndMs } from "../utils/roundEnd";
import { selfCastRedirectIsNoSave } from "../utils/selfDefensiveMechanism";
import {
  isOffensiveSpell,
  SPEC_GATED_OFFENSIVE_CD_IDS,
} from "../utils/spellDanger";
import { summonedAtMs } from "../utils/summonLife";
import { isDeadAt } from "../utils/unitDeath";
import { buildFilteredAuraIntervals } from "../utils/utils";
import {
  CRISIS_HP_PCT_RENDERED,
  CRISIS_PROTECTIVE_ANSWER_IDS,
  KITE_GAIN_YARDS,
  kiteAttribution,
  kitedAway,
} from "./crisisDecisionPoints";

// moved to utils/burstHit.ts (B5, 2026-10-24); the burst engine's callers
// keep importing it from here
export { controlTargetHitPressured };

/** How long after the window start any friendly may answer and still count
 * (GH #60's agreed shape: "response = within 8 s of window start, by ANY
 * friendly"). Also the minimum outcome horizon — see `outcomeEndSec`. */
export const BURST_RESPONSE_WINDOW_MS = 8000;
export const BURST_RESPONSE_WINDOW_SEC = BURST_RESPONSE_WINDOW_MS / 1000;
/** A wall pressed just BEFORE the enemy's first offensive cast is a pre-wall,
 * not a non-response; the same allowance `crisisDecisionPoints` gives a
 * response that lands just before the sampled crossing (`RESPONSE_PRE_MS`),
 * kept numerically identical on purpose — two decision-point engines that
 * disagree about "how early still counts" would produce two different response
 * rates for the same log. */
export const BURST_RESPONSE_PRE_MS = 1500;
/** Consecutive lapsed seconds that end a burst window. */
export const BURST_LAPSE_SECONDS = 3;
/**
 * A second counts as "pressure" when the friendly team took at least this
 * fraction of a health bar in it (summed over friendlies, each normalised by
 * its own max HP, so the floor is bracket- and gear-independent). A second
 * carrying one of the window's own casts always counts.
 *
 * **The literal GH #60 wording — "no enemy offensive CD buff is active AND no
 * enemy damage ≥ floor" — was measured to be a no-op** and is deliberately not
 * what this implements. 605 archived 12.1 matches, 2,627 builder windows
 * (`eval-private/reports/burst-window-2026-08-31/lapse-sweep.md`): with the
 * CD-buff term ORed in, the bounded distribution is p50 20 s / p90 33 s —
 * identical to the unbounded builder's own p50 20 s / p90 33 s, across the
 * whole 4×4 grid of floors and lapse lengths. The reason is structural: the
 * builder's window ENDS at the last buff end, so "a buff is still running" is
 * true for essentially every second inside it (the median window is one 20 s
 * offensive CD), and no 3-second lapse can ever open.
 *
 * Dropping the CD-buff term makes the bounding a damage predicate, which is
 * also the coaching semantic — a 20 s buff that stopped landing damage at
 * second 8 is over as an EXCHANGE at second 8. Sweep at lapse 3 s:
 * 1% → p50 17 s, 2% → 16 s, 3% → 15 s, 5% → 10 s (window count moves only
 * 2,672 → 2,771, so the cuts trim quiet tails rather than split bursts).
 * 3% is taken: it brings the p50 down 20 s → 15 s while keeping the window
 * comfortably longer than the 8 s response horizon it is judged against —
 * at 5% half the windows are shorter than that horizon and "the window" and
 * "the response window" stop being distinguishable objects.
 */
export const BURST_LAPSE_DMG_PCT_PER_S = 0.03;

/**
 * **The one offensive-id predicate this engine consumes** (GH #60 coarse spot
 * 4, correction 3 of the 2026-09-01 approved set). The repo carries two
 * disjoint "is this an offensive cooldown" tables and this engine now names
 * the one it accepts instead of inheriting whatever the window builder used:
 * every cast that reaches `boundBurstWindow` is re-asserted against it, the
 * same structural coupling `SOLO_WINDOW_MIN_WEIGHT` gives the qualification
 * bar. Today it agrees with `reconstructEnemyCDTimeline`'s own filter (so the
 * assertion drops nothing); the point is that a future change to the builder
 * cannot silently widen what this engine calls a burst.
 *
 * The audit behind the choice (2026-09-01, both directions of the
 * Curated-List Completeness Rule, ground truth
 * `eval-private/corpus/observedSpellIds-S2-archive-2026-08-21.json`):
 *
 * | table | entries | overlap | zero S2 occurrences |
 * |---|---|---|---|
 * | `isOffensiveSpell` (spellTags ← `SPELL_CATEGORIES`) | 41 | 19 | **0** |
 * | `OFFENSIVE_SPELL_IDS` (`classMetadata` `SpellTag.Offensive`, cooldowns.ts) | 34 | 19 | **9** |
 *
 * **Unified 2026-09-02 (GH #60 tail).** `isOffensiveSpell` now reads the ONE
 * canonical table `spellDanger.ts`'s `OFFENSIVE_CD_SPELL_IDS` — the union of
 * the two former tables minus the 9 corpus-dead classMetadata ids (see
 * `OFFENSIVE_CD_DEAD_IDS` for the names and the deadness evidence), 60 ids,
 * registered in `curatedIdRegistry`. The forward gap is closed: the live
 * ids that used to sit only in the classMetadata table (Ascendance 114050,
 * Invoke Xuen 123904, Metamorphosis 191427, Bladestorm 227847, Summon
 * Demonic Tyrant 265187; Empower Rune Weapon 47568 left the table on
 * 2026-10-01 — a rotation button, not a cooldown) can now open a window,
 * and `reconstructEnemyCDTimeline` + `threatActiveAt` +
 * `signalSkillGradientScan` all key on the same set. The
 * `docs/predicate-index.md` "Not yet unified" entry this used to point at is
 * closed; the re-assertion below stays, because the structural point (the
 * builder cannot widen what this engine calls a burst without this line
 * going with it) survives unification.
 */
export const isBurstWindowOffensiveCd = (spellId: string): boolean =>
  isOffensiveSpell(spellId) ||
  // GH #184 part B: a spec-gated cooldown reaches this engine only through
  // the builder, which admitted it on its caster's spec (`activeCDs` carry
  // no spec to ask again)
  spellId in SPEC_GATED_OFFENSIVE_CD_IDS;

/**
 * Ids that may never be a window's `leadCd` (they stay in `extraCds`).
 *
 * Hand-maintained, therefore registered in `data/curatedIdRegistry.ts`
 * (Curated-List Completeness Rule) — one entry today:
 *
 * **Power Infusion (10060)**, killed as an opener by the user on 2026-09-01.
 * Phase 1 measured it as 21% of ALL bounded windows (16,482 of 78,377) and
 * the weakest contrast in the set (death-in-window 3.1% answered vs 5.8% not,
 * Δ +2.7 pp against Deathmark's +15.3). It is a healer's throughput buff,
 * usually handed to a partner, and "the enemy opened Power Infusion on you"
 * is not a sentence about an opener at all. A window whose ONLY casts are
 * excluded ids is dropped entirely; otherwise the lead becomes the earliest
 * surviving cast and `tSec` follows it, so "at M:SS they opened X" stays
 * literally true.
 */
export const BURST_LEAD_CD_EXCLUDED_IDS: ReadonlySet<string> = new Set([
  "10060",
]);

/**
 * **"The window itself put them there."** Severity triage additionally
 * requires the pressured friendly to have LOST at least this many percentage
 * points of maximum health inside the window (`startHpPct - minHpPct`, both
 * `gridHpPct` samples on the render grid). Approved tightener 2026-09-01
 * (chg7b concern §1: the previous triage fired on an HP number the player had
 * walked in with — "they were at 25% when the enemy pressed Combustion" is a
 * statement about the previous exchange, not about this one).
 *
 * Only the CANDIDATE population moves. The reference table
 * (`burstWindowPriorGenerated.json`) is built over FEASIBLE windows and never
 * reads `triaged`, so conditioning triage harder cannot move the numbers the
 * product quotes — deliberately, since a death both triages a window and is
 * the table's own outcome.
 *
 * **Swept, and the honest result is that this door is nearly a no-op.** The
 * 2026-09-01 archive rescan (18,134 matches, 36,649 rounds, 68,756 bounded
 * windows, `eval-private/reports/burst-window-2026-09-01-c/report.md`) over
 * the 6,292 windows that fire without it:
 *
 * | drop floor | fires | fires/round | death share | flat/reversed cell |
 * |---|---|---|---|---|
 * | 0 pp | 6,292 | 0.172 | 9.2% | 28.6% |
 * | 10 pp | 6,168 (−2.0%) | 0.168 | 9.0% | 28.4% |
 * | **15 pp (taken)** | **6,100 (−3.1%)** | **0.166** | **9.0%** | **28.3%** |
 * | 20 pp | 6,010 (−4.5%) | 0.164 | 9.0% | 28.3% |
 *
 * The three floors are indistinguishable on everything the sweep can measure
 * — the fired windows' death share and the share of them quoting a
 * flat/reversed reference move by 0.2 pp across the whole range — so 15 is
 * taken as the middle of the swept range rather than because it won
 * anything. The reason there is nothing to win: among fires the drop is
 * already p05 21 · p10 30 · p25 47 · p50 61 · p75 71, because clause 1
 * requires min HP ≤ 40% and almost nobody who ends a window under 40 started
 * it near there. Only 192 of 6,292 fires (3.1%) drop under 15 points; 124
 * (2.0%) under 10.
 *
 * This measurement **refutes** the phase-2 hand-off note that called this
 * "the strongest remaining lever". It is worth keeping — those 192 windows
 * really were accusing somebody about the previous exchange, all 6,292 have a
 * usable start sample so failing closed costs nothing, and the door is one
 * comparison — but nobody should expect it to move volume. On the 309-prompt
 * corpus it removed **0** of the 56 rendered lines; every one of the 17 the
 * two doors removed together failed the CONTRAST door.
 */
export const BURST_TRIAGE_MIN_HP_DROP_PP = 15;

export interface BurstWindowResponses {
  /** a friendly pressed a personal wall (`bigDefensiveSpellIds`) */
  wall: boolean;
  /** a friendly pressed an external (`externalDefensiveSpellIds`) */
  external: boolean;
  /** a friendly pressed a major healing cooldown (`BURST_HEAL_CD_IDS`) */
  healCd: boolean;
  /** a friendly aimed hard CC / a root / an interrupt AT one of the burst's
   * own casters (dest = caster), or a friendly's hard CC / root LANDED on one
   * of them from an untargeted or ground cast (`controlLandedResponses`) —
   * and that caster, or its pets, was hitting the pressured friendly inside
   * the window (`controlTargetHitPressured`, FT-T12 D3) */
  control: boolean;
  /** the most-pressured friendly opened `KITE_GAIN_YARDS` on the nearest
   * burst caster across the response window */
  kite: boolean;
  /** GH #93: the distance gain was the burst's casters walking away
   * (kiteAttribution), not the pressured friendly moving — still answered,
   * never described as a kite */
  attackerMoved: boolean;
}

export interface BurstCdRef {
  spellId: string;
  spellName: string;
  casterName: string;
  casterSpec: string;
  castSec: number;
}

export interface BurstResponseCast {
  category: "wall" | "external" | "healCd" | "control";
  spellId: string;
  spellName: string;
  casterName: string;
  /** whole second the cast lands on (the second `fmtTime` displays) */
  tSec: number;
  /** seconds after the window's LEAD CAST (both raw instants — an interval,
   * reliability round 3 4446 / 7d1f: from the floored window second it read
   * "Chastise 0.6s before" for a 1.55 s gap); may be negative (a pre-wall) */
  latencySec: number;
  /** the cast's target unit id (externals: who received it; an aimed
   * control: who it was aimed at). On a LANDED control (a ground / untargeted
   * cast, `controlLandedResponses`) it is the unit the aura landed on — the
   * cast has no target of its own (FT-T12 D3). */
  destId?: string;
  /** the caster's unit id */
  casterId?: string;
  /** whole second the effect ends — where the log shows it ended
   * (`observedEffectEndSeconds`, `burstCastSpan`'s reading), else cast + the
   * caster's full buff duration — when the spell has one: an answer that
   * expired before the trough did not answer it (round 3 6954; work order
   * 2026-10-15 #2: 141470d0's Greater Invisibility, removed 0.28 s after it
   * went up, read as covering 4.5 s) */
  effectEndSec?: number;
  /** An aimed control (cc / root, not an interrupt) cast BEFORE the lead
   * cast: whether its own aura was still on the target at the lead cast's
   * ms (triage sync-burst F-B4: 95127ab4's Paralysis was trinketed 0.5 s
   * before the Zenith it was credited against). Credit-line only —
   * `responded` never reads it. Absent on every other response. */
  preOpenerStillUp?: boolean;
  /** An aimed control (cc / root / interrupt cast AT a burst caster): did it
   * land? A CC or root landed when its own aura — the cast's id or one of its
   * effect auras (`castEffectAuras.ts`) — went on the target from the caster
   * or the caster's pet; an interrupt when the caster interrupted the target
   * (SPELL_INTERRUPT within `LANDED_PAIR_MS`) or its own silence aura went
   * on. Triage sync-burst F-B1: Imprison with no aura, a Hammer of Justice
   * into an immunity, a reflected Counterspell and a Wind Shear that hit no
   * cast were credited as "answered with X". Credit-line only — `responded`
   * never reads it (slow-defensive-response is unchanged). Absent on every
   * other response. */
  landed?: boolean;
  /** The response was pressed at or after the pressured friendly's death
   * (`isDeadAt` on its raw instant — the UNIT_DIED's own millisecond
   * included). T12 ⑧ (i), user ruling 2026-10-10: 483f7433's Emerald
   * Communion went out 0.251 s after the warrior it was credited for had
   * died. Credit-line only — `responded` never reads it
   * (slow-defensive-response is unchanged). Absent when it was not. */
  afterPressuredDeath?: true;
  /** A wall / external / healing CD pressed at no unit or at its caster
   * whose own aura (`castAndEffectIds`) went on a friendly player other than
   * its caster: every friendly player that aura went on
   * (`pressEffectSpread`). Pipeline T123: an aura logged per recipient
   * proves who it reached — 77310154's untargeted Rallying Cry went on two of
   * three teammates and was credited for the third's dip. Credit-line only —
   * `responded` never reads it. Absent otherwise (an aura on the caster alone
   * says nothing about its reach: Aura Mastery works through the paladin's
   * own aura). */
  effectOnUnitIds?: string[];
  /** The same press, officially a heal of its caster alone
   * (`ABILITY_EFFECTS_GENERATED` healsSelf without healsOthers), with no
   * aura or heal row of its name on another friendly player
   * (`pressEffectSpread`). Pipeline T123: ec49887a's Frenzied Regeneration
   * — aura and heals on the druid — was credited for a paladin's dip.
   * Credit-line only. Absent otherwise (Emerald Communion's overflow heal,
   * another id under the same name, reaches allies). */
  selfOnlyEffect?: true;
  /** The press logged no cast row and was read from its aura
   * (`CASTLESS_SELF_ANSWER_IDS`: Feign Death, a castless Renewing Blaze).
   * It answers the window; the `[BURST ANSWERED]` line never names it
   * (user ruling R80, 2026-11-19: a self-only save counts as an answer and
   * the credit lines stay as they were). */
  castless?: true;
  /** A control: the enemy it was aimed at (an aimed cast) or landed on (a
   * ground / untargeted one), and the aura applications it landed as — none
   * for an interrupt, or a control that did not land. T12 ⑧ (i), second
   * half: the credit line names the target and reads the control's length
   * off the `[CC ON ENEMY]` instance of the same application. Credit-line
   * only — `responded` never reads it. Absent on every other response. */
  controlOn?: {
    unitId: string;
    unitName: string;
    auras: ControlLandingAura[];
  };
}

/** One aura application a control answer put on its target: the aura's own
 * id and the instant it went on — the key the `[CC ON ENEMY]` instance of the
 * same application carries (`ICCInstance.spellId` / `atSeconds`). */
export interface ControlLandingAura {
  spellId: string;
  atMs: number;
}

/** How far before a response's SPELL_CAST_SUCCESS a row of its effect may
 * be logged and still be that press's (the log orders an aura and its cast
 * row either way — 77310154's Rallying Cry aura is logged one row before
 * its cast). Pipeline T123; `scan5/t123.ts` reads the same bound. */
export const ANSWER_EFFECT_LEAD_MS = 500;

/** The official profile heals the press's caster and nobody else
 * (`ABILITY_EFFECTS_GENERATED` healsSelf without healsOthers) — pipeline
 * T123's self-only reading (`selfOnlyEffect`); `scan5/t123.ts` asks the same
 * function. */
export function officialSelfOnlyHeal(spellId: string): boolean {
  const profile = ABILITY_EFFECTS_GENERATED[spellId];
  return !!profile?.healsSelf && !profile.healsOthers;
}

type SpreadRow = {
  timestamp: number;
  spellId?: string;
  srcUnitId: string;
  destUnitId: string;
};

/**
 * Where one press's effect went, read off the friendly players' rows from
 * one of `sources` (the caster, its pets) in [`fromMs`, `toMs`) — pipeline
 * T123, an answer counts for a unit only when its effect is on that unit:
 *  - `auraHolderIds`: the players with an APPLIED / REFRESH row of the
 *    cast's id or one of its effect auras (`castAndEffectIds`);
 *  - `namedOnOther`: whether a player other than `casterId` got an aura or
 *    heal row under the cast's own name (another id of the same spell —
 *    Emerald Communion's overflow heal).
 * `scan5/t123.ts` reads the same rows.
 */
export function pressEffectSpread(
  players: ReadonlyArray<{
    id: string;
    auraEvents?: ReadonlyArray<SpreadRow & { logLine: { event: string } }>;
    healIn?: ReadonlyArray<SpreadRow>;
  }>,
  casterId: string,
  sources: ReadonlySet<string>,
  castSpellId: string,
  fromMs: number,
  toMs: number,
): { auraHolderIds: string[]; namedOnOther: boolean } {
  const ids = castAndEffectIds(castSpellId);
  const name = getEnglishSpellName(castSpellId);
  const inSpan = (r: SpreadRow): boolean =>
    sources.has(r.srcUnitId) && r.timestamp >= fromMs && r.timestamp < toMs;
  const byId = (r: SpreadRow): boolean =>
    r.spellId !== undefined && ids.has(String(r.spellId));
  const byName = (r: SpreadRow): boolean =>
    r.spellId !== undefined && getEnglishSpellName(String(r.spellId)) === name;
  const auraOn = (
    u: (typeof players)[number],
    match: (r: SpreadRow) => boolean,
  ): boolean =>
    (u.auraEvents ?? []).some(
      (a) =>
        (a.logLine.event === "SPELL_AURA_APPLIED" ||
          a.logLine.event === "SPELL_AURA_REFRESH") &&
        a.destUnitId === u.id &&
        inSpan(a) &&
        match(a),
    );
  return {
    auraHolderIds: players.filter((u) => auraOn(u, byId)).map((u) => u.id),
    namedOnOther: players.some(
      (u) =>
        u.id !== casterId &&
        (auraOn(u, byName) ||
          (u.healIn ?? []).some(
            (h) => h.destUnitId === u.id && inSpan(h) && byName(h),
          )),
    ),
  };
}

/** How far before an aimed control's SPELL_CAST_SUCCESS its own aura / its
 * SPELL_INTERRUPT may be logged and still be that cast's landing (the log
 * can order the two either way). The value F-B1 shipped with, named so the
 * gate that re-reads a landing's second derives its bound from it. */
export const AIMED_CONTROL_LANDING_LEAD_MS = 100;

/**
 * The aura applications by which the aimed control `castSpellId`, cast by
 * `casterId` at `castMs`, landed on `dest`: its own id or one of its effect
 * auras (`castEffectAuras.ts`), from the caster or the caster's pet, inside
 * the landing window. `aimedControlLanded`'s aura half — one scan, so "it
 * landed" and "this is the aura it landed as" cannot disagree.
 */
export function aimedControlLandingAuras(
  dest:
    | {
        auraEvents?: ReadonlyArray<{
          timestamp: number;
          spellId?: string;
          srcUnitId: string;
          logLine: { event: string };
        }>;
      }
    | undefined,
  casterId: string,
  castSpellId: string,
  castMs: number,
  friendlyPlayerOf: (srcUnitId: string) => string | undefined,
): ControlLandingAura[] {
  const own = castAndEffectIds(castSpellId);
  const out: ControlLandingAura[] = [];
  for (const a of dest?.auraEvents ?? [])
    if (
      (a.logLine.event === "SPELL_AURA_APPLIED" ||
        a.logLine.event === "SPELL_AURA_REFRESH") &&
      a.spellId !== undefined &&
      own.has(a.spellId) &&
      (a.srcUnitId === casterId ||
        friendlyPlayerOf(a.srcUnitId) === casterId) &&
      a.timestamp >= castMs - AIMED_CONTROL_LANDING_LEAD_MS &&
      a.timestamp <= castMs + GROUND_CONTROL_FUSE_MS
    )
      out.push({ spellId: a.spellId, atMs: a.timestamp });
  return out;
}

/**
 * F-B1: did the aimed control `castSpellId` cast by `casterId` at `castMs`
 * land on `dest`? See `BurstResponseCast.landed`.
 */
export function aimedControlLanded(
  dest:
    | {
        auraEvents?: ReadonlyArray<{
          timestamp: number;
          spellId?: string;
          srcUnitId: string;
          logLine: { event: string };
        }>;
        actionIn?: ReadonlyArray<{
          timestamp: number;
          srcUnitId: string;
          logLine: { event: string };
        }>;
      }
    | undefined,
  casterId: string,
  castSpellId: string,
  castMs: number,
  friendlyPlayerOf: (srcUnitId: string) => string | undefined,
  isInterrupt: boolean,
): boolean {
  if (!dest) return true; // unknown target: never withhold credit
  const fromCaster = (src: string) =>
    src === casterId || friendlyPlayerOf(src) === casterId;
  const auraLanded =
    aimedControlLandingAuras(
      dest,
      casterId,
      castSpellId,
      castMs,
      friendlyPlayerOf,
    ).length > 0;
  if (auraLanded) return true;
  if (!isInterrupt) return false;
  return (dest.actionIn ?? []).some(
    (x) =>
      x.logLine.event === "SPELL_INTERRUPT" &&
      fromCaster(x.srcUnitId) &&
      x.timestamp >= castMs - AIMED_CONTROL_LANDING_LEAD_MS &&
      x.timestamp <= castMs + LANDED_PAIR_MS,
  );
}

/**
 * F-B4: is the control `casterId` aimed at `dest` (cast `castSpellId` at
 * `castMs`) still applied at `atMs`? Keyed on the cast id and its effect aura
 * (its DR-bearing effect auras in `castEffectAuras.ts`, the one cast→effect
 * table), sourced from the caster.
 */
export function aimedControlUpAt(
  dest:
    | {
        auraEvents?: ReadonlyArray<{
          timestamp: number;
          spellId?: string;
          srcUnitId: string;
          logLine: { event: string };
        }>;
      }
    | undefined,
  casterId: string,
  castSpellId: string,
  castMs: number,
  atMs: number,
): boolean {
  const ids = new Set([castSpellId, ...drEffectAurasOfCast(castSpellId)]);
  let up = false;
  // a BROKEN line its aura's own REMOVED follows is not the end (FT-T08)
  const notTheEnd = supersededAuraBreaks(dest?.auraEvents ?? []);
  for (const a of dest?.auraEvents ?? []) {
    if (a.timestamp < castMs || a.timestamp > atMs) continue;
    if (notTheEnd.has(a)) continue;
    if (a.srcUnitId !== casterId || !ids.has(a.spellId ?? "")) continue;
    const ev = a.logLine.event;
    if (
      ev === "SPELL_AURA_APPLIED" ||
      ev === "SPELL_AURA_REFRESH" ||
      ev === "SPELL_AURA_APPLIED_DOSE"
    )
      up = true;
    else if (
      ev === "SPELL_AURA_REMOVED" ||
      ev === "SPELL_AURA_BROKEN" ||
      ev === "SPELL_AURA_BROKEN_SPELL"
    )
      up = false;
  }
  return up;
}

/**
 * PROBE-ONLY (2026-09-01, GH #60 over-react probe). One defensive cooldown a
 * friendly actually spent inside the bounded window — personal wall, external
 * or major healing CD, the same three id sets `BurstWindowResponses` uses, so
 * "a response" and "a spend" cannot disagree about what counts as a major
 * defensive. Collected ONLY when `BurstWindowOptions.collectSpend` is set;
 * the product never sets it, nothing renders it and no gate reads it. It
 * exists so the corpus scan can ask whether spending MORE than the moment
 * needed is punished later in the round (the bar to clear: `cd-spent-idle`
 * was retired 2026-08-30 for showing no outcome cost).
 */
export interface BurstSpendCast {
  category: "wall" | "external" | "healCd";
  spellId: string;
  spellName: string;
  casterId: string;
  casterName: string;
  /** whole second the cast lands on (the second `fmtTime` displays) */
  tSec: number;
  /**
   * Base cooldown in seconds, read from the SAME per-player ledger
   * `cdAvailableAt` consults (`extractMajorCooldowns`), not a second table.
   * 0 means the ledger has no entry for this spell on this player — the row
   * still counts toward `majorsSpent`, it just contributes nothing to a
   * cooldown-weight sum, and the scan reports how often that happens.
   */
  cooldownSeconds: number;
}

export interface BurstFriendlyOutcome {
  unitId: string;
  name: string;
  /** min `gridHpPct` over the window's whole seconds, skipping seconds the
   * unit was already dead at; null when no sample is in reach */
  minHpPct: number | null;
  /** the whole second `minHpPct` was read at */
  minHpSec: number | null;
  /**
   * The TRUE minimum over the same seconds (`hpTroughInWindow`: every sample
   * of `[tSec, outcomeEndSec]`'s displayed seconds, not only the whole-second
   * ticks) and the second it happened at — FT-T03, user ruling 2026-10-10
   * (D7). This pair is what a LINE prints (`[BURST ANSWERED] … bottomed at N%
   * at m:ss`); it is never above `minHpPct`.
   *
   * `minHpPct` / `minHpSec` stay the grid readings and stay the ones every
   * DECISION asks — who `pressured` is, `triaged`, the `[BURST ANSWERED]`
   * door and ranking, "the answer was still up at the bottom", the corpus
   * reference tables — so the ruling moves a printed number and no window.
   * Absent on a hand-built point (tests): the grid pair stands in.
   */
  troughHpPct?: number | null;
  troughHpSec?: number | null;
  /** T183 (ruling R73): set on the PRESSURED unit when the trough it prints
   * was found past the window's outcome horizon (`burstTroughReadEnd`) —
   * the last second read, and what stopped the reading there. Absent when
   * the low lies inside the horizon. */
  troughReadToSec?: number;
  troughReadStop?: BurstTroughReadStop;
  /**
   * `gridHpPct` at the window START — the first whole second in
   * `[tSec, outcomeEndSec]` that has a grid sample at all (normally `tSec`
   * itself; the fallback exists because `gridHpPct` returns null when no
   * advanced-action sample is in reach of that second, and a window whose
   * very first second happens to be a hole is not a window we know nothing
   * about). Null when the unit was already dead at `tSec` or has no sample
   * anywhere in the horizon.
   *
   * Added 2026-09-01 for the "the window itself put them there" triage door
   * (`BURST_TRIAGE_MIN_HP_DROP_PP`): `startHpPct - minHpPct` is the drop the
   * burst actually caused, as opposed to an HP number the player walked in
   * with. Same sampler as `minHpPct`, same render grid — one predicate.
   */
  startHpPct: number | null;
  /** the whole second `startHpPct` was read at */
  startHpSec: number | null;
  died: boolean;
  /** the rendered second of that death (the first one inside the outcome
   * window); absent when `died` is false. `burstWindowLongEnoughToJudge`
   * reads it (user ruling R103). */
  diedSec?: number;
}

export interface BurstWindowDecisionPoint {
  /** window start re-anchored on the render grid: `startTime + tSec * 1000` */
  tMs: number;
  /** the opener's own instant, epoch ms — the response span's start is
   * measured from it (`burstResponseSpanMs`, ruling R113) */
  leadMs: number;
  /** WHOLE seconds since round start — what `fmtTime` displays */
  tSec: number;
  /** last whole second of the bounded window */
  endSec: number;
  /** last whole second of the OUTCOME horizon — `endSec`, never shorter than
   * the response window (`tSec + BURST_RESPONSE_WINDOW_SEC`): the span the
   * pressured trough, `anyFriendlyDeath` and the reference table read.
   * WO3 #18 (r1008-141): slow-defensive-response prints it, `windowEndT`. */
  outcomeEndSec: number;
  /** T183: last whole second any of the window's own offensive buffs was
   * still running (the timeline's `buffEndSeconds`), never before
   * `outcomeEndSec`. The bounded window can end sooner — at a lapse in the
   * damage — while the buff runs on. */
  buffRunEndSec: number;
  /** the printed name of the buff `buffRunEndSec` is the end of */
  buffRunEndSpellName: string;
  /** `endSec - tSec` (rendered seconds, never raw) */
  durationSec: number;
  /** the CD that OPENED the window (earliest cast; a same-second tie goes to
   * the heavier `spellDangerWeight`) */
  leadCd: BurstCdRef;
  /** every other CD inside the window, cast order */
  extraCds: BurstCdRef[];
  /** unit ids of the enemies who cast this window's CDs */
  casterIds: string[];
  /**
   * The friendly the window is actually about: the LOWEST `gridHpPct` reached
   * inside the outcome horizon, ties broken by damage taken. One window, one
   * pressured friendly — the feasibility gate, the `kite` response and the
   * severity triage all ask about this same unit, so they cannot disagree
   * about who was under the burst (phase 1 measured `kite` on the
   * most-damaged friendly and the feasibility gate on the whole team; the two
   * could name different people). Null only when no friendly has any HP
   * sample in reach, in which case the window is neither feasible nor
   * triaged — there is nothing to say about it.
   */
  pressured: BurstFriendlyOutcome | null;
  responses: BurstWindowResponses;
  responded: boolean;
  /** latency of the FIRST response cast, seconds after `tSec`; null when the
   * only response was a kite (no cast instant) or there was none */
  firstResponseSec: number | null;
  responseCasts: BurstResponseCast[];
  /**
   * Value-Gate rule 3, tightened 2026-09-01 (approved correction 1). Phase 1
   * asked "did ANYBODY on the team have ANY relevant tool" and passed 99.6%
   * of 78,377 windows — a gate that removes 278 windows is not a gate. The
   * question is now asked about the person under the burst:
   *
   *  (a) the **pressured friendly** had a tool that works on themselves
   *      (`!SELF_CAST_NOOP_EXTERNAL_IDS` over the wall / external / major
   *      heal union — cd-hoarded's own-crisis readiness predicate) off
   *      cooldown at `tSec`, and was not hard-CC'd for the whole 8 s; OR
   *  (b) a **teammate** had a tool that can reach somebody else
   *      (`canHelpAnotherUnit`, GH #28's predicate) off cooldown at `tSec`,
   *      was not hard-CC'd for the whole 8 s, AND could actually DELIVER it
   *      to the pressured friendly from where they stood at the window-start
   *      render second (2026-09-02, GH #60 tail): positions from the same
   *      sampler the root-reachability work uses, per-tool official range
   *      (`externalReachYards`), LoS not disproven counts as reachable, and
   *      missing position data for either unit counts as reachable — the
   *      gate may only remove windows the log PROVES undeliverable.
   *
   * Control cooldowns no longer make a window feasible on their own (they
   * still count as a *response*): "you could have stunned somebody" is not
   * "you had an answer for the person being trained".
   */
  feasible: boolean;
  /** names of the friendlies that satisfied the gate (empty ⇒ !feasible) */
  feasibleUnits: string[];
  /** Per feasible unit, the FIRST whole second of the response window that
   * satisfied the simultaneous-opportunity test and the tool that did it —
   * the evidence behind `feasibleUnits` (decision trace / audit). */
  feasibleEvidence: Array<{ unit: string; sec: number; spellId: string }>;
  /**
   * Severity triage (approved correction 2, tightened 2026-09-01):
   *
   *  1. the pressured friendly's grid min HP inside the window reached
   *     `CRISIS_HP_PCT_RENDERED` — the same crisis line
   *     `crisisDecisionPoints` uses, imported — or a friendly died in the
   *     window; **AND**
   *  2. that friendly LOST at least `BURST_TRIAGE_MIN_HP_DROP_PP` points of
   *     maximum health inside the window (`startHpPct - minHpPct`).
   *
   * Phase 1 would have fired on 28.6% of feasible windows (0.6 per round);
   * clause 1 alone brought that to 11.7%; clause 2 is the "the window itself
   * put them there" door — without it the type fires on somebody who was
   * ALREADY low when the burst opened, which is a sentence about the previous
   * exchange. Both clauses are AND: a death at 12% HP that the window only
   * moved 4 points is still not this window's story.
   */
  triaged: boolean;
  // ── OUTCOMES — reference table only, EXCEPT `anyFriendlyDeath`.
  /**
   * Any friendly `deathRecords` entry inside the outcome horizon.
   *
   * 2026-09-01: this one field crossed the line into product facts, on the
   * user's approved shape (`facts.diedInWindow`, and death-first cap
   * ordering). It is deliberately the SAME predicate the reference table's
   * own outcome uses, so the rendered "a friendly died inside the window"
   * fact and the rendered "…died inside the window N% of the time" reference
   * mean the same thing. The three fields below stay table-only.
   */
  anyFriendlyDeath: boolean;
  /**
   * PROBE-ONLY, present only when `BurstWindowOptions.collectSpend` is set
   * (the product never sets it): every major defensive a friendly pressed
   * inside `[the opener's ms - BURST_RESPONSE_PRE_MS, outcomeEndSec]`. See
   * `BurstSpendCast`.
   */
  spend?: BurstSpendCast[];
  deathsInWindow: number;
  /** the lowest `minHpPct` across friendlies */
  minFriendlyHpPct: number | null;
  friendlyOutcomes: BurstFriendlyOutcome[];
}

/** The outcome fields the producer must not read. Exported so a test can pin
 * the list rather than trusting the comment above it. `anyFriendlyDeath` left
 * this list on 2026-09-01 — see its doc comment. */
export const BURST_OUTCOME_FIELDS = [
  "deathsInWindow",
  "minFriendlyHpPct",
  "friendlyOutcomes",
] as const;

const PERSONAL_WALL_IDS = new Set<string>(
  spellIdLists.bigDefensiveSpellIds.map(String),
);
const EXTERNAL_IDS = new Set<string>(
  spellIdLists.externalDefensiveSpellIds.map(String),
);
/**
 * Walls that are a healing cooldown FOR THE TEAM — user ruling R93
 * (2026-11-19, pipeline T224), every entry signed by it. A `wall` response
 * of a unit other than the pressured one is its presser's self-protection
 * and is ignored for that window (R81); these four are officially
 * self-targeted too, but pressing one is how its caster heals the team
 * through the burst, so another teammate's press of one stays an answer:
 *   "Tree of Life / Ancient of Lore / Ultimate Penitence are answers when
 *    pressed by another teammate: healing CDs aimed at the team, not
 *    self-only walls"; the pressed Spirit of Redemption "对自己来说是非常好的
 *    防守技能，对队友加血也是一个大技能".
 * A hand table on purpose (coordinator's call): no official field shows the
 * help — the targeting is the caster — and `canHelpAnotherUnit` splits the
 * walls the other way round (it keeps a self-cast Power Word: Shield and
 * drops these; 605: 69 against 192 presses). `ENEMY_HEAL_CD_IDS` holds two
 * of them for the enemy's lines; a unit test keeps every wall-capable id
 * there inside this table, so a change there cannot change answers
 * silently. Registered in curatedIdRegistry.
 */
export const TEAM_HEAL_WALL_ANSWER_IDS: ReadonlySet<string> = new Set([
  "33891", // Incarnation: Tree of Life (R93)
  "473909", // Ancient of Lore — Tree of Life's talent replacement (R93)
  "421453", // Ultimate Penitence (R93)
  "215769", // Spirit of Redemption, the pressed PvP id (R93; 605: 114 of 114 presses have a cast row)
]);
/** The engine can give this id the `wall` category (the order
 * `burstWindowDecisionPoints` classifies a friendly press in). A copy row
 * (`COPY_CAST_IDS`: a channel tick, a proc copy — Divine Hymn's 64844) is
 * no press there and so never a wall (codex 85-tk-CD-T224-1). */
export function canBeWallResponse(spellId: string): boolean {
  if (COPY_CAST_IDS.has(spellId)) return false;
  return (
    PERSONAL_WALL_IDS.has(spellId) ||
    (!EXTERNAL_IDS.has(spellId) &&
      !BURST_HEAL_CD_IDS.has(spellId) &&
      BURST_EXTRA_ANSWER_IDS.has(spellId))
  );
}
/**
 * "A major healing cooldown" — composed from two tables that are ALREADY
 * hand-maintained and already registered in `data/curatedIdRegistry.ts`
 * (`TEAM_HEAL_CD_IDS` and `HEALING_VERDICTS`), rather than a third hand list:
 * the Curated-List Completeness Rule's cost is per list, and a new one here
 * would need its own rot scan for no new information. The `HEALING_VERDICTS`
 * half is filtered to the user-signed `burst-answer` verdict — the register's
 * own question is literally "爆发已经打在脸上,按这个技能算不算一个答案", which
 * is exactly this module's question — and to entries whose official facts say
 * they heal somebody (a pure immunity is already a `wall` here).
 */
export const BURST_HEAL_CD_IDS = new Set<string>([
  ...TEAM_HEAL_CD_IDS,
  ...Object.entries(HEALING_VERDICTS)
    .filter(
      ([, v]) =>
        v.verdict === "burst-answer" &&
        (v.official.healsSelf || v.official.healsOthers),
    )
    .map(([id]) => id),
]);

/**
 * T181 (round-14 D2 / D28 / D29): self-saves that are no percentage wall
 * and so sat in none of the answer lists — Alter Time (the press 342245 and
 * its return 342247, the heal back to the press's health; `spellIdLists`'
 * `rewind` mechanism) and Mass Invisibility 414664 (the unit cannot be hit
 * while it holds, `ENEMY_IMMUNITY_SAVE_AURAS`). slow-defensive-response
 * said "no friendly answered" over a mage's Alter Time at +0.8 s
 * (dd3c5ad1 1:58) and a Mass Invisibility at +6.7 s (1:24); cd-hoarded
 * accused a mage whose own return took it from 26 % to 83 % inside the
 * window (2c47e3d5 1:30). Answers only, never on the accusation side.
 * "Only for the unit that pressed them" holds for both readers: cd-hoarded's
 * `spent` reads the owner's own presses, and the engine's `responded`
 * counts one only when its presser is the pressured unit — another unit's
 * press of these ids is ignored (`pressDidNotReachPressured`; R80's "the
 * unit's own", coordinator's call 2026-11-19 after the B163 batch check:
 * a rogue's window turned answered through a teammate mage's Mass
 * Invisibility, 7a4d43c8 2:21, and a paladin's through another mage's
 * Alter Time return). Whether a teammate's Mass Invisibility that put its
 * aura on the pressured unit is an answer is not ruled; until it is, such
 * a press is as on the tree before T181: not in the response list's count.
 * The `[BURST ANSWERED]` line never names one (user
 * ruling R80, 2026-11-19: the window is answered, the credit lines stay as
 * they were — `answersPressured` refuses these ids). One set for both
 * readers
 * (`BURST_EXTRA_ANSWER_IDS` here, cd-hoarded's `spent` through
 * `ownerSelfSaveCastSeconds`). Registered in curatedIdRegistry.
 */
/** Mass Invisibility — the one self-save that reaches teammates (R97). */
const MASS_INVISIBILITY_ID = "414664";
export const SELF_SAVE_ANSWER_IDS: ReadonlySet<string> = new Set([
  "342245", // Alter Time (the press)
  "342247", // Alter Time (the return)
  MASS_INVISIBILITY_ID,
]);

/**
 * User ruling R112 (2026-11-24, T258; GH #225-A10): Anti-Magic Shell —
 * 48707, and Spellwarden's 410358 that goes on self or an ally — pressed by
 * the pressured unit, or 410358 pressed ON it, answers the burst. Neither
 * id sat in an answer list (605: 63 such presses inside a window's span, 6
 * slow-defensive-response rows said "no friendly answered" over one). No
 * school gate (the user chose "answers" over the >= 50 % magic option).
 * Answers only, never on the accusation side. A press on another friendly
 * is an `external`, any other a `wall` of its presser — never a group heal
 * (`extraAnswerCategory`). Registered in curatedIdRegistry.
 */
export const ANTI_MAGIC_SHELL_ANSWER_IDS: ReadonlySet<string> = new Set([
  "48707", // Anti-Magic Shell, self only
  "410358", // Anti-Magic Shell (Spellwarden): self or an ally
]);

/**
 * F16 retest (2026-10-21, idx 51): presses that answer a crisis on the
 * crisis side but sat in none of the three lists above, so
 * slow-defensive-response said "no friendly answered within 8 s" over a
 * Bear Form, a Frenzied Regeneration and a Roar of Sacrifice on the dying
 * druid (e49b7c3b 3:24–3:32). The same signed sets the crisis readers take
 * as answers — never as accusations (the accusation side, `feasible`, keeps
 * the three lists):
 *  - `CRISIS_PROTECTIVE_ANSWER_IDS` (user rulings 2026-09-14),
 *  - the response-only saves: `RESPONSE_ONLY_DEFENSIVE_IDS` and the healer
 *    roster's `responseOnly` facts (Barkskin, Frenzied Regeneration —
 *    ruling 2026-09-25),
 *  - the redirects `ENEMY_REDIRECT_SAVE_IDS` (rulings A20 + U3; fact1215
 *    R11 counted them for cd-hoarded).
 * A press on another friendly is an `external`, an untargeted / self press
 * a `wall` — `answersPressured` then holds each to the caster or the
 * destination it reached.
 */
export const BURST_EXTRA_ANSWER_IDS: ReadonlySet<string> = new Set([
  ...CRISIS_PROTECTIVE_ANSWER_IDS,
  ...RESPONSE_ONLY_DEFENSIVE_IDS,
  ...CURATED_ABILITY_FACTS.filter(
    (f) => f.kind === "save_role" && f.responseOnly,
  ).map((f) => f.id),
  ...ENEMY_REDIRECT_SAVE_IDS,
  ...SELF_SAVE_ANSWER_IDS,
  ...ANTI_MAGIC_SHELL_ANSWER_IDS,
]);

/**
 * The self-targeted answers whose press can leave no cast row: the ids of
 * the ledger's aura-only table (`AURA_ONLY_ACTIVATION_IDS`) that are a
 * personal wall or one of the extra answers above — Feign Death, Renewing
 * Blaze. Derived, not a third list. `auraOnlyActivationSeconds` returns
 * nothing for a unit whose press does log a cast row, so no press is read
 * twice.
 */
export const CASTLESS_SELF_ANSWER_IDS: readonly string[] = Object.keys(
  AURA_ONLY_ACTIVATION_IDS,
).filter((id) => PERSONAL_WALL_IDS.has(id) || BURST_EXTRA_ANSWER_IDS.has(id));
/**
 * A healing CD whose official effect heals only its caster (Dark Pact,
 * Exhilaration, Desperate Prayer …). Keyed on the response CATEGORY
 * `healCd` at the call site, not on this alone: Guardian Spirit and Life
 * Cocoon are also `healsOthers:false` but classify as `external` first
 * (triage sync-burst F-B7).
 *
 * Two sources, the signed one first (pipeline T226, user ruling R92):
 *  1. the signed register's official fact, where the spell is in it;
 *  2. for a spell the register does not hold — it lists the
 *     Defensive-TAGGED healing cooldowns only, and an extra answer such as
 *     Frenzied Regeneration carries no such tag — the same official DB2
 *     profile the register copies its fact from (`officialSelfOnlyHeal`),
 *     unless the signed team-heal registry says the press reaches the team
 *     by another id (`TEAM_HEAL_CD_IDS`: Emerald Communion's overheal is
 *     re-cast on allies as 370984 — user ruling 2026-09-30).
 * Before T226 only source 1 was asked, so another druid's Frenzied
 * Regeneration answered a teammate's burst window (605: 4 presses).
 */
function healsOnlyItsCaster(spellId: string): boolean {
  const signed = HEALING_VERDICTS[spellId]?.official.healsOthers;
  if (signed !== undefined) return signed === false;
  return officialSelfOnlyHeal(spellId) && !TEAM_HEAL_CD_IDS.has(spellId);
}

/**
 * T180 (user rulings A7 / R65 / R68, 2026-11-18): a response that WENT
 * ELSEWHERE — the three readings the user took after six real examples
 * (attempt T180-2), and no other:
 *  - an external aimed at another unit (310e5c6d r5: the owner's Ironbark
 *    on a warlock at 95 % while the hunter fell to 15 %);
 *  - a healing cooldown that healed others and not the pressured unit: one
 *    whose per-recipient aura / heal rows went on others. NOT a self-only
 *    heal or shield pressed by another unit (ruling R75, 2026-11-19: a
 *    warlock's own Dark Pact cannot be given to the mate, so it did not go
 *    "elsewhere"; it is ignored — `pressDidNotReachPressured`) — self-only
 *    by the official verdict (`HEALING_VERDICTS.official.healsOthers ===
 *    false`); a press whose own rows show it on its caster alone
 *    (`selfOnlyEffect`, T123's reading) is not "elsewhere" either and is
 *    NOT ignored — see `pressDidNotReachPressured`;
 *  - a control that did not land (03d63165 r1: a Storm Bolt MISSED) —
 *    control only (R75): an interrupt that interrupted nothing
 *    (`INTERRUPT_IDS`, spellMeta's own class) is ignored the same way.
 * Such a press is no answer for that unit: `responded` (the
 * slow-defensive-response door) does not count it, and the `[BURST
 * ANSWERED]` credit line (`answersPressured`) never credited it — both ask
 * `pressDidNotReachPressured`, which is this function plus R75's two
 * ignored presses. NOT here, by the same ruling: another unit's own wall
 * (the pressured unit's own tools are not all in the response list — the
 * "unanswered" would be that list's blind spot), a control off before the
 * opener (a projectile in flight reads as off), and a press that reached
 * the unit but ran out before its trough (R65: not enough is not slow).
 * Those stay credit-line rules only.
 */
export function pressWentElsewhere(
  pressured: { unitId: string },
  r: BurstResponseCast,
): boolean {
  if (
    r.category === "external" &&
    r.destId !== undefined &&
    !/^0+$/.test(r.destId) &&
    r.destId !== pressured.unitId
  )
    return true;
  if (
    r.category === "healCd" &&
    !healsOnlyItsCaster(r.spellId) &&
    r.selfOnlyEffect !== true &&
    r.effectOnUnitIds !== undefined &&
    !r.effectOnUnitIds.includes(pressured.unitId)
  )
    return true;
  return (
    r.category === "control" &&
    r.landed === false &&
    !INTERRUPT_IDS.has(r.spellId)
  );
}

/**
 * What `responded` and the `[BURST ANSWERED]` line both ask (T180): did
 * this press reach the pressured unit at all? No when it went elsewhere
 * (`pressWentElsewhere`), and no for the two presses ruling R75 IGNORES —
 * a self-only heal / shield of another unit (06bb9860: one warlock's Dark
 * Pact under another player's dip; it cannot be given to the mate) and an
 * interrupt that interrupted nothing (9d899d10: a reflected Counterspell).
 * An ignored press neither answers the window nor is a press that "went
 * elsewhere": a window with nothing but ignored presses is plainly
 * unanswered. The ignored healing CD is the official verdict's alone
 * (`healsOthers === false`: Dark Pact, Exhilaration — R75 amendment c).
 * T123's broader `selfOnlyEffect` (the press's own rows show it on its
 * caster only) stays a credit-line rule (`answersPressured`): Emerald
 * Communion sends its overhealing to an injured ally, so a teammate's
 * Communion still answers the window (assembly review 80-PIPE-169-B155,
 * 84d80c66 r1 1:45: answered 1 → 0 in the table builder).
 */
export function pressDidNotReachPressured(
  pressured: { unitId: string },
  r: BurstResponseCast,
): boolean {
  if (pressWentElsewhere(pressured, r)) return true;
  if (
    r.category === "healCd" &&
    r.casterId !== undefined &&
    r.casterId !== pressured.unitId &&
    healsOnlyItsCaster(r.spellId)
  )
    return true;
  // T181: a self-save (Alter Time, Mass Invisibility) answers for its
  // presser alone — another unit's is ignored…
  if (
    SELF_SAVE_ANSWER_IDS.has(r.spellId) &&
    r.casterId !== undefined &&
    r.casterId !== pressured.unitId
  )
    // …except (user ruling R97, 2026-11-19, T224) a teammate's Mass
    // Invisibility whose invisibility aura LANDED on the pressured unit:
    // that press answers, however soon the aura is broken — "being broken
    // is the enemy's play". No aura row on the pressured unit → ignored.
    // 605: 24 such presses, the aura on the pressured unit in 21.
    return !(
      r.spellId === MASS_INVISIBILITY_ID &&
      r.effectOnUnitIds?.includes(pressured.unitId) === true
    );
  // user ruling R81 (2026-11-19, changing R68), narrowed by R93: another
  // teammate's own self-protection wall is ignored like its self-only
  // healing CD — 605: 133 distinct windows were `responded` through such a
  // wall alone, a hunter's Feign Death standing as the answer to a monk's
  // burst. The pressured unit's own wall still answers; so does another
  // teammate's wall that is a healing cooldown for the team
  // (`TEAM_HEAL_WALL_ANSWER_IDS`).
  if (
    r.category === "wall" &&
    r.casterId !== undefined &&
    r.casterId !== pressured.unitId &&
    !TEAM_HEAL_WALL_ANSWER_IDS.has(r.spellId)
  )
    return true;
  return r.category === "control" && r.landed === false;
}

const INTERRUPT_IDS = new Set<string>(
  Object.entries(spellMeta)
    .filter(([, m]) => m.type === "interrupts")
    .map(([id]) => id),
);
/** "stop the caster" tools — same union crisisDecisionPoints uses for its own
 * `control` response. */
const CONTROL_IDS = new Set<string>([
  ...ccSpellIds,
  ...rootSpellIds,
  ...INTERRUPT_IDS,
]);

/**
 * How far before a control aura landed a friendly's untargeted / ground cast
 * may be and still be the cast that produced it. Capacitor Totem's fuse is
 * 2 s (61740741: cast 318.844, stun 320.856); an AoE fear or stun lands on
 * the cast's own millisecond. A trap or Binding Shot armed earlier than this
 * falls back to the aura's own time.
 */
export const GROUND_CONTROL_FUSE_MS = 3000;

/**
 * Presses that MOVE a totem already on the ground — a relocation that puts
 * a pulsing control totem on the burst's caster is the press that answered
 * (T184: 6 windows of the 605 are timed by it), where the totem's own drop
 * may be long before the window. Totemic Projection 108287. Registered in
 * curatedIdRegistry.
 */
export const TOTEM_RELOCATION_IDS: ReadonlySet<string> = new Set(["108287"]);

const isNoDest = (dest: string | undefined): boolean =>
  !dest || /^0+$/.test(dest);

/**
 * The control answers `dest = caster` cannot see: a friendly's hard CC or
 * root (the aura half of `CONTROL_IDS`) that LANDED on one of the burst's
 * casters from an untargeted or ground cast — Capacitor Totem, Psychic
 * Scream, Intimidating Shout, Leg Sweep, traps. Reliability round 2
 * (61740741 @311): the owner's Capacitor Totem, pressed 7.8 s into an
 * Incarnation window, stunned the caster and the menu still said nobody
 * answered.
 *
 * The aura's source resolves to a friendly player directly or through
 * `ownerId` (totems, pets). The response time is that player's latest
 * untargeted cast (or a cast of the aura's own spell) at most
 * `GROUND_CONTROL_FUSE_MS` before the aura, else the aura's own time; the
 * name is the aura's (the cast found may be the totem relocation, not the
 * totem). An aura that a control cast aimed at a caster could have produced
 * is skipped: the cast-side test already counts it.
 */
/** One landed control from `controlLandedResponses`: who answered, the
 * aura, when it counts, and — for the pre-opener lifetime check (codex
 * 35-CD-13f) — the aura's holder, its own source unit and its time. */
export interface LandedControlResponse {
  unitId: string;
  spellId: string;
  /** the instant the answer is PRINTED at (`landedControlInstantMs`) */
  tMs: number;
  /** the instant the answer is ORDERED at among a window's answers, when it
   * is not `tMs`: a totem's or guardian's control is printed at the press
   * that made the totem (user ruling R90) but arrived when it LANDED —
   * an earlier-dropped totem must not displace an answer that reached the
   * caster first (batch review 80-PIPE-181-B167 #1, 0284fcd9 r2: Cheap
   * Shot landed at 22.0 s, the Earthgrab Totem dropped at 6.8 s rooted at
   * 24.8 s and took the credit). Absent = `tMs`. */
  orderAtMs?: number;
  holderId?: string;
  auraSrcId?: string;
  auraAtMs?: number;
}

/**
 * F-B4's pre-opener check for a landed control (codex 35-CD-13f / 13g): only
 * an aura APPLIED before the lead cast can have expired before it — was it
 * still on its holder at the lead cast? Undefined (no check) for an aura
 * that landed at or after the lead cast, whatever its cast time: a ground
 * control cast before the opener whose stun landed inside the burst (a
 * Capacitor Totem's fuse) answers it.
 */
export function landedPreOpenerStillUp(
  r: LandedControlResponse,
  holder: Parameters<typeof aimedControlUpAt>[0],
  leadMs: number,
): boolean | undefined {
  if (r.auraAtMs === undefined || r.auraAtMs >= leadMs || !r.auraSrcId)
    return undefined;
  return aimedControlUpAt(holder, r.auraSrcId, r.spellId, r.auraAtMs, leadMs);
}

/**
 * Does a cast of `castId` make the control aura `auraSpellId` — its own
 * spell, its cast id through the cast→effect table (Ring of Frost 113724 →
 * 82691, Lasso 305483 → 305485, Capacitor Totem → Static Charge), or the
 * same English name. The one reading `controlLandedResponses` and the
 * summon-timing scan (scan5/pets.ts) share.
 */
export function castMakesControlAura(
  castId: string,
  auraSpellId: string,
): boolean {
  if (castId === auraSpellId || isCastOrEffect(castId, auraSpellId))
    return true;
  const auraName = getEnglishSpellName(auraSpellId, "");
  return auraName !== "" && getEnglishSpellName(castId, "") === auraName;
}

/**
 * The instant a landed control is PRINTED at, from what the log holds about
 * it — the one choice `controlLandedResponses` makes and the summon-timing
 * scan (scan5/pets.ts) checks the printed line against (batch review
 * 80-PIPE-181-B167 #2: the scan accepted every candidate at once).
 * In order: the press of the answering player that made the aura
 * (`familyMs`); for a `Pet-` source, the pet's own cast row of it
 * (`petOwnMs`); for a totem or guardian whose SPELL_SUMMON row the log
 * holds, the latest relocation of it (`relocationMs`), else that summon
 * (`summonedMs`) — user ruling R90, however long before; otherwise the
 * player's aimed control or untargeted press inside the fuse
 * (`otherPressMs`); else the aura itself.
 */
export function landedControlInstantMs(x: {
  auraMs: number;
  familyMs?: number;
  petOwnMs?: number;
  summonedMs: number | null;
  relocationMs?: number;
  otherPressMs?: number;
}): number {
  if (x.familyMs !== undefined) return x.familyMs;
  if (x.petOwnMs !== undefined) return x.petOwnMs;
  if (x.summonedMs !== null) return x.relocationMs ?? x.summonedMs;
  return x.otherPressMs ?? x.auraMs;
}

/**
 * The instant that decides whether a landed control ANSWERS a window (is it
 * inside the response span), beside the instant it is printed at
 * (`landedControlInstantMs`): the control's LANDING — user rulings R90 (a
 * totem or guardian timed by its summon) and R109 (a press of the answering
 * player whose control lands later). The printed instant only for a totem's
 * or guardian's control its summon does not time (`fromSummon`, no summon
 * instant: the R90 scope note). The one reading `controlLandedResponses`
 * and scan5/t256.ts share.
 */
export function landedControlMemberAtMs(x: {
  printedMs: number;
  auraMs: number;
  summonedMs: number | null;
  /** the aura's source is a totem or guardian of the answering player
   * (neither the player nor a `Pet-` unit) */
  fromSummon: boolean;
}): number {
  return x.fromSummon && x.summonedMs === null ? x.printedMs : x.auraMs;
}

/**
 * The response span of a burst window: from `BURST_RESPONSE_PRE_MS` before
 * the opener's OWN millisecond (`leadMs`) to `BURST_RESPONSE_WINDOW_MS`
 * after the whole second the window opens on (`tMs`).
 *
 * User ruling R113 (2026-11-24, T258; GH #226-16): the "pressed just
 * before the burst" allowance is measured from the opener's cast itself.
 * Anchored on the whole second it admitted a press up to 2.5 s early and
 * the line then read "1.7s before it opened" (d86164f1 r1: Alter Time
 * 1.710 s before Army of the Dead). The end keeps the whole-second anchor
 * — not asked. One definition for the engine, the candidate's attempted
 * presses and the scans.
 */
export function burstResponseSpanMs(
  tMs: number,
  leadMs: number,
): { w0: number; w1: number } {
  return {
    w0: leadMs - BURST_RESPONSE_PRE_MS,
    w1: tMs + BURST_RESPONSE_WINDOW_MS,
  };
}

/**
 * The latest relocation (`TOTEM_RELOCATION_IDS`) by `unitId` of a totem
 * summoned at `summonedMs` before its control landed at `auraMs` — over the
 * totem's whole life, not the ground-control fuse (batch review
 * 80-PIPE-181-B167 #3, 0284fcd9 r4: an Earthgrab Totem summoned at 2.8 s,
 * moved at 4.7 s, rooted at 14.8 s printed its drop). A relocation before
 * the summon moved an earlier totem. `casts` in time order.
 */
export function latestTotemRelocationMs(
  casts: ReadonlyArray<{ unitId: string; spellId: string; tMs: number }>,
  unitId: string,
  summonedMs: number,
  auraMs: number,
): number | undefined {
  let at: number | undefined;
  for (const c of casts) {
    if (c.tMs > auraMs) break;
    if (
      c.unitId === unitId &&
      c.tMs >= summonedMs &&
      TOTEM_RELOCATION_IDS.has(c.spellId)
    )
      at = c.tMs;
  }
  return at;
}

export function controlLandedResponses(
  casters: ReadonlyArray<{
    id?: string;
    auraEvents?: ReadonlyArray<{
      timestamp: number;
      spellId?: string;
      srcUnitId: string;
      logLine: { event: string };
    }>;
  }>,
  casterIds: ReadonlySet<string>,
  friendlyPlayerOf: (srcUnitId: string) => string | undefined,
  friendlyCasts: ReadonlyArray<{
    unitId: string;
    spellId: string;
    dest: string | undefined;
    tMs: number;
  }>,
  w0: number,
  w1: number,
  /** a summon's own SPELL_CAST_SUCCESS rows (its id, its instant) — what
   * times a control a `Pet-` unit landed when no press of its owner made it */
  summonCastsOf: (
    summonId: string,
  ) => ReadonlyArray<{ spellId: string; tMs: number }> = () => [],
  /** a summon's own SPELL_SUMMON instant (`summonedAtMs`), or null */
  summonedAtOf: (summonId: string) => number | null = () => null,
): LandedControlResponse[] {
  const out: LandedControlResponse[] = [];
  for (const caster of casters)
    for (const a of caster.auraEvents ?? []) {
      if (a.logLine.event !== "SPELL_AURA_APPLIED") continue;
      const sid = a.spellId ?? "";
      if (!ccSpellIds.has(sid) && !rootSpellIds.has(sid)) continue;
      if (a.timestamp < w0 || a.timestamp > w1 + GROUND_CONTROL_FUSE_MS)
        continue;
      const unitId = friendlyPlayerOf(a.srcUnitId);
      if (!unitId) continue;
      // F-B8 (triage sync-burst): the cast that produced this aura times it
      // — its own spell, or its cast id through the cast→effect table (Ring of
      // Frost 113724 → 82691, Lasso 305483 → 305485), or the same English
      // name — before a control cast aimed at the aura's target, before any
      // untargeted cast. 7d1f14af timed a Lasso root from an unrelated
      // untargeted press 1.9 s earlier while the aimed cast came 40 ms
      // before the aura. Codex review: a non-control cast aimed at the target
      // (a Frostbolt between Ring of Frost and its aura) never times it.
      const producesAura = (castId: string): boolean =>
        castMakesControlAura(castId, sid);
      // fact2 (2026-10-20): an untargeted press that makes a control of its
      // own (its cast→effect family holds a control aura — Freezing Trap
      // 187650 → 3355) is that control's cause, never this one's
      // (e49b7c3b 0:12: Binding Shot, armed 5.1 s before its stun, was
      // timed from a Freezing Trap thrown 1.2 s after the opener — the aura
      // time is the fallback the fuse comment above names)
      const producesAControl = (castId: string): boolean =>
        [...castAndEffectIds(castId)].some(
          (id) => ccSpellIds.has(id) || rootSpellIds.has(id),
        );
      // fact6 D11 (e7608d97 1:10): a PET (`Pet-` GUID) acts on its own —
      // its control is timed by a press of the owner that made it (a command,
      // Intimidation), else by the pet's own cast row, else by the aura; never
      // by another press of the owner (a Gladiator's Medallion 1.9 s before
      // the Abomination's Monstrous Blow read "1.0s before it opened", the
      // stun landed 0.9 s after). A totem or guardian keeps the owner's
      // untargeted press (its summon or its relocation is that press).
      const fromPet = a.srcUnitId !== unitId && a.srcUnitId.startsWith("Pet-");
      let family: (typeof friendlyCasts)[number] | undefined;
      let aimedControl: (typeof friendlyCasts)[number] | undefined;
      let untargeted: (typeof friendlyCasts)[number] | undefined;
      // T43 (60bfdea9 0:12): the producing cast's own SUCCESS row can be
      // logged just AFTER its aura (Rake's stun 163505 at 13.454 s, Rake
      // 1822 at 13.456 s) — the lead the cast side already allows an aimed
      // control (`AIMED_CONTROL_LANDING_LEAD_MS`). Stopping at the aura
      // dropped it, and the stun was timed from the Prowl 0.24 s earlier
      // ("answered with Rake … in 0.9s" for a Rake 1.13 s after the opener).
      // Only the cast that makes this aura is read past it — and never the
      // impact row of a press already read (codex 85-tk-H-T43-1: The Hunt
      // 1246167 pressed at 13.000 s roots at 13.454 s, its impact 1246169
      // is logged at 13.456 s; the press times it), nor a cast aimed at
      // somebody else.
      const isImpactOf = (
        impactId: string,
        press: (typeof friendlyCasts)[number] | undefined,
      ): boolean =>
        !!press &&
        !!PRESS_TRIGGERED_CAST_IDS.get(press.spellId)?.includes(impactId);
      for (const c of friendlyCasts) {
        if (c.tMs > a.timestamp + AIMED_CONTROL_LANDING_LEAD_MS) break;
        if (c.unitId !== unitId || c.tMs < a.timestamp - GROUND_CONTROL_FUSE_MS)
          continue;
        if (c.tMs > a.timestamp) {
          if (
            producesAura(c.spellId) &&
            (isNoDest(c.dest) || c.dest === caster.id) &&
            !isImpactOf(c.spellId, family)
          )
            family = c;
        } else if (producesAura(c.spellId)) family = c;
        else if (fromPet) continue;
        else if (
          caster.id !== undefined &&
          c.dest === caster.id &&
          (CONTROL_IDS.has(c.spellId) ||
            ccSpellIds.has(c.spellId) ||
            rootSpellIds.has(c.spellId))
        )
          aimedControl = c;
        else if (isNoDest(c.dest) && !producesAControl(c.spellId))
          untargeted = c;
      }
      let petOwn: { tMs: number } | undefined;
      if (fromPet && !family)
        for (const c of summonCastsOf(a.srcUnitId))
          if (
            c.tMs <= a.timestamp &&
            c.tMs >= a.timestamp - GROUND_CONTROL_FUSE_MS &&
            producesAura(c.spellId) &&
            (!petOwn || c.tMs > petOwn.tMs)
          )
            petOwn = c;
      // T184 (fact14 D26, bd6d44c1 1:36): a totem or guardian whose summon
      // row the log holds was made by that press and by no other. A totem
      // that pulses for longer than the fuse left its own drop outside it,
      // and the owner's unrelated untargeted press inside the fuse took its
      // place (an Earthgrab Totem dropped 2.7 s after the opener rooted the
      // death knight on its third pulse, at 6.7 s; a Crash Lightning 5.1 s
      // in was read as the answer's time). With the summon known, no other
      // untargeted press times it.
      // A totem or guardian whose summon row the log holds: only a press
      // that makes the aura, or one that moves the totem, can time its
      // control — never another aimed control (one round of the 605: an
      // Earthgrab Totem dropped at 0:02 rooted at 0:18 and was timed by a
      // Hex at 0:15, for a burst opened at 0:13), never another untargeted
      // press.
      const summonAtMs =
        a.srcUnitId !== unitId && !fromPet && !family && !petOwn
          ? summonedAtOf(a.srcUnitId)
          : null;
      // the latest press that moves the totem, read apart from
      // `untargeted` (another untargeted press after it must not erase it,
      // codex 85-tk-CD-T184-1b, dca02448 r4) and over the totem's life
      const relocationMs =
        summonAtMs === null
          ? undefined
          : latestTotemRelocationMs(
              friendlyCasts,
              unitId,
              summonAtMs,
              a.timestamp,
            );
      // the cast-side test already counted an aimed control from this
      // friendly that could be this aura's cause — one that produces THIS
      // aura and was aimed at THIS aura's holder, the only case where the
      // cast side credits it (since F-B1 it credits an aimed control only
      // when it landed on its target). An unrelated aimed control (a Spear
      // Hand Strike that missed before a Leg Sweep landed, codex 35-CD-08)
      // or one aimed at another caster (Mass Entanglement at an immune E1
      // whose root landed on E2, codex 35-CD-13d) must not swallow it.
      const aimed = friendlyCasts.some(
        (c) =>
          c.unitId === unitId &&
          c.tMs >= a.timestamp - GROUND_CONTROL_FUSE_MS &&
          // the cast side's own landing window (`aimedControlLandingAuras`)
          c.tMs <= a.timestamp + AIMED_CONTROL_LANDING_LEAD_MS &&
          CONTROL_IDS.has(c.spellId) &&
          producesAura(c.spellId) &&
          caster.id !== undefined &&
          c.dest === caster.id,
      );
      if (aimed) continue;
      // fact11 D28 (be1686eb 0:17): a totem or guardian (no pet) whose
      // control no press of its owner made inside the fuse pulsed on its own
      // — the press that answered is the one that summoned it (an Earthgrab
      // Totem dropped at 0:05.5 rooted the priest at 0:17.5, read "answered
      // with Earthgrab in 4.4s" for a burst opened at 0:13.1)
      const tMs = landedControlInstantMs({
        auraMs: a.timestamp,
        ...(family ? { familyMs: family.tMs } : {}),
        ...(petOwn ? { petOwnMs: petOwn.tMs } : {}),
        summonedMs: summonAtMs,
        ...(relocationMs !== undefined ? { relocationMs } : {}),
        ...((aimedControl ?? untargeted)
          ? { otherPressMs: (aimedControl ?? untargeted)!.tMs }
          : {}),
      });
      // user ruling R90 (2026-11-19, T184; it supersedes R88 and REVERSES
      // fact11 D28's "a totem dropped before the burst answers nothing" —
      // do not restore that): for a totem's or guardian's control the two
      // questions have two instants. Whether it answers the window is
      // decided by the control LANDING inside the span; the time printed is
      // the press that made the totem (its summon, or the relocation that
      // moved it), HOWEVER long before — the user chose this over a bound
      // having seen "14.0s before it opened" (88d301a7 r1: an Earthgrab
      // Totem dropped at 24.8 s, its eighth pulse on the warlock at 40.8 s,
      // Summon Darkglare at 38.8 s). An Earthgrab Totem dropped 2.02 s
      // before a Deathmark, 51 ms outside the span, whose root went on the
      // rogue 14 ms before he pressed is an answer ("2.0s before it
      // opened", 8f110f66 7:44); one dropped 4.8 s after a Bestial Wrath
      // whose root reached the hunter at 8.8 s is none (28c39eb1 r2 0:06).
      // User ruling R109 (2026-11-22, T256) extends the same two instants
      // to a PRESS of the answering player whose control lands later (Deep
      // Breath 357210 → Terror of the Skies 372245, a Ring of Frost walked
      // into, a trap stepped on, a pet sent to stun): the landing decides
      // membership, the press is printed. What keeps its printed instant
      // for both is a totem's or guardian's control that its summon does
      // not time — the coordinator's reading of R90's scope, with its
      // pinned example (61740741 5:11: Capacitor Totem pressed 7.8 s into
      // the window, Static Charge at 9.8 s, reads "in 7.8s").
      const memberAtMs = landedControlMemberAtMs({
        printedMs: tMs,
        auraMs: a.timestamp,
        summonedMs: summonAtMs,
        fromSummon: a.srcUnitId !== unitId && !fromPet,
      });
      if (memberAtMs < w0 || memberAtMs > w1) continue;
      out.push({
        unitId,
        spellId: sid,
        tMs,
        // ranked by its landing only when its summon times it (R90, batch
        // review 80-PIPE-181-B167 #1: a drop can be 14 s old). A press
        // whose control lands within the fuse keeps its printed instant as
        // its rank — R109 moved membership and nothing else (ranking those
        // by the landing would rename the credited answer of 14 windows of
        // the 605; not asked)
        ...(summonAtMs !== null && memberAtMs !== tMs
          ? { orderAtMs: memberAtMs }
          : {}),
        ...(caster.id !== undefined ? { holderId: caster.id } : {}),
        auraSrcId: a.srcUnitId,
        auraAtMs: a.timestamp,
      });
    }
  return out;
}

/**
 * The window's other CDs as one facts / line value: only those cast inside
 * the response horizon (a CD 21 s later belongs to a different exchange —
 * match 2195ab6e round 1, window 2:17–2:58), each marked `Ns later` when it
 * was not pressed on the opener's own second (61740741: Incarnation 6.7 s
 * after Volley read as "stacked with it"). "; " joins them — ", " is the
 * facts separator the gates split on. One helper for the candidate and the
 * [BURST ANSWERED] line.
 */
export function burstExtrasLabel(
  p: {
    tSec: number;
    leadCd: Pick<BurstCdRef, "casterName">;
    extraCds: ReadonlyArray<
      Pick<BurstCdRef, "spellName" | "castSec" | "casterName" | "casterSpec">
    >;
  },
  // WO6 #2 (n48, e10c6bea): an extra another enemy pressed names that enemy —
  // without it the rogue's Kingsbane read as the warlock's, who opened. An
  // extra of the opener's own stays bare. Without labels it reads like the
  // menu's `facts.caster (facts.casterSpec)`.
  casterLabel: (c: Pick<BurstCdRef, "casterName" | "casterSpec">) => string = (
    c,
  ) => `${c.casterName} (${c.casterSpec})`,
): string {
  return p.extraCds
    .filter((c) => c.castSec <= p.tSec + BURST_RESPONSE_WINDOW_SEC)
    .map((c) => {
      const by =
        c.casterName !== p.leadCd.casterName ? ` by ${casterLabel(c)}` : "";
      return c.castSec > p.tSec
        ? `${c.spellName}${by} ${c.castSec - p.tSec}s later`
        : `${c.spellName}${by}`;
    })
    .join("; ");
}

export interface BoundedSegment {
  fromSeconds: number;
  toSeconds: number;
  casts: IAlignedBurstWindow["activeCDs"];
}

/** cast key into the per-player offensive-CD ledger (buff end + danger weight) */
const castKey = (playerName: string, spellId: string, castSeconds: number) =>
  `${playerName}|${spellId}|${castSeconds}`;

/** T183 (user ruling R73, 2026-11-19): how long after a burst window's
 * outcome horizon its pressured trough may still be read while one of the
 * window's own buffs runs. */
export const BURST_TROUGH_PAST_CUT_MAX_S = 10;

export type BurstTroughReadStop =
  "buff end" | "cap" | "next window" | "death" | "round end";

/**
 * T183 (fact14 D23; user ruling R73, 2026-11-19): the last whole second a
 * burst window's pressured trough is read to, when that is PAST the
 * window's outcome horizon, and what stops the reading there. A window is
 * cut where the damage lapses (`boundBurstWindow`), which can be well before
 * its opener's buff ends; damage that comes back under the same buff opens
 * no new window, so the unit's later, lower HP belonged to no window
 * (ae1d0895 2:27: `bottomed at 55%`, 49 % ten seconds on, the Avenging
 * Wrath still up). The reading goes on to the end of the window's own
 * buffs, at most `BURST_TROUGH_PAST_CUT_MAX_S` past the horizon, and stops
 * before the round's next window, at the unit's death and at the round's
 * end. `null` = nothing to read past the horizon. Only the printed trough
 * moves (`troughHpPct` / `troughHpSec`): the window, who died in it,
 * `responded` and every grid reading that decides stay as they are.
 * One reading for the engine, `scan5/t183` and — through the fields it
 * leaves on the pressured unit — the candidate and the credit line.
 */
export function burstTroughReadEnd(w: {
  outcomeEndSec: number;
  buffRunEndSec: number;
  /** the opening second of the round's next window, if any */
  nextWindowTSec: number | null;
  /** the second the unit died in, if it died after the window opened */
  deathSec: number | null;
  /** the round's last second, when the round's end is known */
  roundEndSec: number | null;
}): { toSec: number; stop: BurstTroughReadStop } | null {
  const stops: Array<[number, BurstTroughReadStop]> = [
    [w.buffRunEndSec, "buff end"],
    [w.outcomeEndSec + BURST_TROUGH_PAST_CUT_MAX_S, "cap"],
  ];
  if (w.nextWindowTSec !== null)
    stops.push([w.nextWindowTSec - 1, "next window"]);
  if (w.deathSec !== null) stops.push([w.deathSec, "death"]);
  if (w.roundEndSec !== null) stops.push([w.roundEndSec, "round end"]);
  // the earliest stop; the buff's end wins a tie (it is listed first)
  let [toSec, stop] = stops[0]!;
  for (const [sec, why] of stops)
    if (sec < toSec) {
      toSec = sec;
      stop = why;
    }
  return toSec > w.outcomeEndSec ? { toSec, stop } : null;
}

interface CastFacts {
  buffEndSeconds: number;
  dangerWeight: number;
}

function castFactsOf(timeline: IEnemyCDTimeline): Map<string, CastFacts> {
  const out = new Map<string, CastFacts>();
  for (const p of timeline.players)
    for (const cd of p.offensiveCDs)
      out.set(castKey(p.playerName, cd.spellId, cd.castTimeSeconds), {
        buffEndSeconds: cd.buffEndSeconds,
        dangerWeight: cd.dangerWeight,
      });
  return out;
}

/** The timeline's `dangerWeight` of a cast (`offensiveDangerWeight` — an
 * activation weighs its canonical cooldown, GH #115), 0 when the timeline
 * does not know the cast. */
function weightOf(
  c: IAlignedBurstWindow["activeCDs"][number],
  facts: Map<string, CastFacts>,
): number {
  const f = facts.get(castKey(c.playerName, c.spellId, c.castSeconds));
  return f ? f.dangerWeight : 0;
}

/**
 * Cut one unbounded builder window into per-exchange pieces.
 *
 * `dmgPctPerSec[s]` is the friendly team's incoming damage during whole second
 * `s`, as a sum of per-unit fractions of max HP. A second is "pressured" when
 * one of the window's own CD buffs is still running in it, or that damage
 * reaches `BURST_LAPSE_DMG_PCT_PER_S`. `BURST_LAPSE_SECONDS` consecutive
 * unpressured seconds close the current piece; the next cast opens a new one.
 *
 * Exported for the corpus scan's window-length sweep and for the unit tests —
 * the bounding rule is the thing GH #60 changes, so it is testable on its own.
 */
export function boundBurstWindow(
  window: IAlignedBurstWindow,
  facts: Map<string, CastFacts>,
  dmgPctPerSec: Map<number, number>,
  opts: {
    lapseSeconds?: number;
    dmgFloor?: number;
    cdBuffIsPressure?: boolean;
  } = {},
): BoundedSegment[] {
  const lapseSeconds = opts.lapseSeconds ?? BURST_LAPSE_SECONDS;
  const dmgFloor = opts.dmgFloor ?? BURST_LAPSE_DMG_PCT_PER_S;
  const cdBuffIsPressure = opts.cdBuffIsPressure ?? false;
  // Re-assert the engine's own offensive-id predicate on every inherited cast
  // (`isBurstWindowOffensiveCd`, see its doc block): today a no-op against
  // `reconstructEnemyCDTimeline`'s filter, kept as structural coupling so the
  // builder cannot widen what this engine calls a burst without this line
  // going with it.
  const casts = [...window.activeCDs]
    .filter((c) => isBurstWindowOffensiveCd(c.spellId))
    .sort((a, b) => a.castSeconds - b.castSeconds);
  if (!casts.length) return [];

  const buffEnd = (c: IAlignedBurstWindow["activeCDs"][number]) =>
    facts.get(castKey(c.playerName, c.spellId, c.castSeconds))
      ?.buffEndSeconds ?? c.castSeconds;

  const segments: BoundedSegment[] = [];
  let current: IAlignedBurstWindow["activeCDs"][number][] = [];
  let lapse = 0;
  let nextCast = 0;
  let lastPressured = -Infinity;
  const lastSec = Math.ceil(
    Math.max(window.toSeconds, casts[casts.length - 1]!.castSeconds),
  );
  const flush = () => {
    if (!current.length) return;
    const from = current[0]!.castSeconds;
    // The piece ends when its own CDs' buffs do, but never after the pressure
    // did: a 20 s offensive buff that stopped landing damage at second 8 is
    // over as an EXCHANGE at second 8, and the outcome horizon must not keep
    // collecting deaths through the quiet tail.
    const to = Math.max(
      from,
      Math.min(Math.max(...current.map(buffEnd)), lastPressured),
    );
    segments.push({ fromSeconds: from, toSeconds: to, casts: current });
    current = [];
  };

  for (let s = Math.floor(casts[0]!.castSeconds); s <= lastSec; s++) {
    // casts landing in second s join the current piece (and reopen one)
    let opened = false;
    while (nextCast < casts.length && casts[nextCast]!.castSeconds < s + 1) {
      current.push(casts[nextCast]!);
      nextCast++;
      opened = true;
    }
    const cdActive =
      cdBuffIsPressure &&
      current.some((c) => c.castSeconds <= s + 1 && buffEnd(c) >= s);
    const pressured =
      opened || cdActive || (dmgPctPerSec.get(s) ?? 0) >= dmgFloor;
    if (pressured) {
      lapse = 0;
      if (current.length) lastPressured = s;
    } else {
      lapse++;
      if (lapse >= lapseSeconds) {
        flush();
        lapse = 0;
      }
    }
  }
  flush();
  return segments;
}

/** The builder's own qualification rule, re-applied to a bounded piece: 2+
 * CDs, or one CD heavy enough to be a solo kill window. */
function qualifies(
  seg: BoundedSegment,
  facts: Map<string, CastFacts>,
): boolean {
  return (
    seg.casts.length >= 2 ||
    seg.casts.some((c) => weightOf(c, facts) >= SOLO_WINDOW_MIN_WEIGHT)
  );
}

function maxHpOf(u: any): number {
  let m = 0;
  for (const a of (u?.advancedActions ?? []) as any[])
    if ((a.advancedActorMaxHp ?? 0) > m) m = a.advancedActorMaxHp;
  return m;
}

/** friendly incoming damage per whole second, as a sum of per-unit fractions
 * of that unit's own max HP */
function damagePctPerSecond(
  friendlies: any[],
  startMs: number,
  sides: RosterSides | undefined,
  /** the round's end (`roundEndMs`): rows after it are not the round's
   * damage */
  roundEndAtMs: number | undefined,
): Map<number, number> {
  const out = new Map<number, number>();
  for (const f of friendlies) {
    const max = maxHpOf(f);
    if (max <= 0) continue;
    for (const d of (f.damageIn ?? []) as any[]) {
      const ts = d.timestamp ?? d.logLine?.timestamp;
      if (ts == null) continue;
      // health its own side moved onto it is no hit (pipeline T223), and
      // a row after the round's end is not the round's damage (pipeline
      // T234: the last burst's segment ran 1–5 s past the deciding death
      // on the rows the unit arrays keep after it) — the aligned window's
      // own bound, `isRoundLandedDamageRow`
      if (!isRoundLandedDamageRow(f, d, sides, roundEndAtMs)) continue;
      const s = Math.floor((ts - startMs) / 1000);
      const amt = Math.abs(d.effectiveAmount ?? d.amount ?? 0) / max;
      out.set(s, (out.get(s) ?? 0) + amt);
    }
  }
  return out;
}

/**
 * The round's last second is cut short (pipeline T237, ruling R111): the
 * per-second damage stops at the round's end, so that second holds only the
 * part of it the round lasted (87.0 – 87.199 s in 605 s2 22-4, where the
 * round ends on a death), and the floor it is held against is a rate per
 * second. Rescales that second's sum in `dmgPctPerSec` to the rate over the
 * part the round lasted; no row after the round's end is read. Exported for
 * scan5 `t223readers`, which bounds the same windows on its own per-second
 * maps.
 */
export function rateRoundEndingSecond(
  dmgPctPerSec: Map<number, number>,
  startMs: number,
  roundEndAtMs: number | undefined,
): void {
  if (roundEndAtMs === undefined) return;
  const s = Math.floor((roundEndAtMs - startMs) / 1000);
  const sum = dmgPctPerSec.get(s);
  if (sum === undefined) return;
  // the round's end is the last millisecond that counts
  const lastedMs = roundEndAtMs - startMs - s * 1000 + 1;
  if (lastedMs < 1000) dmgPctPerSec.set(s, (sum * 1000) / lastedMs);
}

/**
 * The bounded burst windows of one round, WITHOUT the response / feasibility /
 * outcome work. Used by `burstWindowDecisionPoints` below and by the corpus
 * scan's `sweep` (which needs only window lengths across a parameter grid and
 * must not pay for 16 full passes) — one segmentation implementation, two
 * callers (CLAUDE.md shared-predicate rule).
 */
export function boundedBurstSegments(
  combat: any,
  opts: {
    lapseSeconds?: number;
    dmgFloor?: number;
    friendlyReaction?: number;
  } = {},
): { facts: Map<string, CastFacts>; segments: BoundedSegment[] } {
  const empty = {
    facts: new Map<string, CastFacts>(),
    segments: [] as BoundedSegment[],
  };
  const start: number = combat?.startTime ?? 0;
  const players: any[] = Object.values(combat?.units ?? {}).filter(
    (u: any) => u.info,
  );
  // CombatUnitReaction.Friendly === 1 (parser-compat enums.ts)
  const friendlyReaction = opts.friendlyReaction ?? 1;
  const friendlies = players.filter((u) => u.reaction === friendlyReaction);
  const enemies = players.filter((u) => u.reaction !== friendlyReaction);
  if (!friendlies.length || !enemies.length) return empty;
  const timeline = reconstructEnemyCDTimeline(enemies as ICombatUnit[], combat);
  if (!timeline.alignedBurstWindows.length) return empty;
  const facts = castFactsOf(timeline);
  // the round's end every burst reader stops at (`roundEndMs`, pipeline
  // T237, ruling R111): a Solo Shuffle round's deciding death, not the ~2 s
  // of log after it
  const roundEndAtMs =
    typeof combat?.endTime === "number" ? roundDamageEndMs(combat) : undefined;
  const dmgPctPerSec = damagePctPerSecond(
    friendlies,
    start,
    buildRosterSides(Object.values(combat?.units ?? {}) as ICombatUnit[]),
    roundEndAtMs,
  );
  rateRoundEndingSecond(dmgPctPerSec, start, roundEndAtMs);
  const segments: BoundedSegment[] = [];
  for (const w of timeline.alignedBurstWindows)
    for (const seg of boundBurstWindow(w, facts, dmgPctPerSec, opts))
      if (qualifies(seg, facts)) segments.push(seg);
  return { facts, segments };
}

export interface BurstWindowOptions {
  /** which side is "friendly"; defaults to the logging player's team */
  friendlyReaction?: number;
  lapseSeconds?: number;
  dmgFloor?: number;
  /**
   * PROBE-ONLY: also populate `spend` on every window. Off by default and
   * never set by the product — it costs an extra pass over every friendly
   * cast per window and nothing in the prompt path reads the result.
   */
  collectSpend?: boolean;
}

/**
 * All bounded enemy burst windows of one round, each with its response,
 * feasibility and (table-only) outcome facts.
 */
export function burstWindowDecisionPoints(
  combat: any,
  opts: BurstWindowOptions = {},
): BurstWindowDecisionPoint[] {
  const start: number = combat?.startTime ?? 0;
  const units: any[] = Object.values(combat?.units ?? {});
  const players = units.filter((u) => u.info);
  if (!players.length) return [];
  // the round's end (`roundEndMs`): a printed bottom is not read past it
  // (fact10 D30 follow-up, GH #191)
  const roundEndAtMs: number = roundEndMs(combat);
  // CombatUnitReaction.Friendly === 1 (parser-compat enums.ts)
  const friendlyReaction = opts.friendlyReaction ?? 1;
  const friendlies = players.filter((u) => u.reaction === friendlyReaction);
  const enemies = players.filter((u) => u.reaction !== friendlyReaction);
  if (!friendlies.length || !enemies.length) return [];

  const { facts, segments } = boundedBurstSegments(combat, opts);
  if (!segments.length) return [];

  const enemyByName = new Map<string, any>(enemies.map((u) => [u.name, u]));
  // every friendly cast once, tagged with the categories it can answer with
  interface FriendlyCast {
    unitId: string;
    unitName: string;
    spellId: string;
    dest: string | undefined;
    tMs: number;
    /** a self wall the log shows on the teammate `dest` */
    allyCopy?: true;
    /** the one recipient whose copy this entry reads its end from (a
     * talent-shared press split into its caster's and its ally's) */
    copyOn?: string;
    /** read from the aura, the press logging no cast row */
    castless?: true;
  }
  const friendlyCasts: FriendlyCast[] = [];
  for (const u of friendlies)
    for (const c of (u.spellCastEvents ?? []) as any[]) {
      const sid = String(c.spellId ?? "");
      if (!sid) continue;
      // fact4 D32 (4accb068 r3): a row of the one not-a-press table
      // (`COPY_CAST_IDS` — a channel tick, a proc copy) is no press: Divine
      // Hymn's last 64844 tick, 1.2 s before Zenith, was read as the answer
      // although the hymn was pressed 5.0 s before and had already ended
      if (COPY_CAST_IDS.has(sid)) continue;
      // fact4 D68 (ecfb3a7f 1:42): a self wall whose copy the log shows on a
      // teammate (Flameshaper Obsidian Scales — `allyCopyRecipient`, the
      // reading cd-hoarded's answered set and the press line take) went to
      // that teammate: an external aimed at it
      const allyCopy = allyCopyRecipient(u.id, c, units);
      const tMs = c.timestamp ?? c.logLine?.timestamp;
      friendlyCasts.push({
        unitId: u.id,
        unitName: u.name,
        spellId: sid,
        // …and the caster keeps its own copy: the press is its wall too
        // (codex 20-F17-08 #3: an evoker under burst giving one to an ally
        // lost the credit for its own)
        dest: allyCopy ? u.id : c.destUnitId,
        tMs,
        ...(allyCopy ? { copyOn: u.id } : {}),
      });
      if (allyCopy)
        friendlyCasts.push({
          unitId: u.id,
          unitName: u.name,
          spellId: sid,
          dest: allyCopy.id,
          tMs,
          allyCopy: true,
          copyOn: allyCopy.id,
        });
    }
  // T222 (found by T182's capture, 7f107afb 2:24): a self-targeted answer whose
  // press logs no cast row at all — Feign Death (its Survival Tactics aura /
  // `unconscious=1` row), a castless Renewing Blaze — is a press all the
  // same. The cooldown ledger's own reader says when (`[TEAM] [CD] Feign
  // Death` is printed from it); the engine read `spellCastEvents` alone, so
  // Feign Death, in the answer set since the 2026-09-30 ruling, never
  // answered a window: three hunters who feigned 3.0–7.4 s after the opener
  // were told nobody answered within 8 s once their own Master's Call
  // stopped standing in.
  for (const u of friendlies)
    for (const sid of CASTLESS_SELF_ANSWER_IDS)
      for (const atS of auraOnlyActivationSeconds(u, sid, start, roundEndAtMs))
        friendlyCasts.push({
          unitId: u.id,
          unitName: u.name,
          spellId: sid,
          dest: u.id,
          tMs: start + atS * 1000,
          castless: true,
        });
  friendlyCasts.sort((a, b) => a.tMs - b.tMs);

  // per-friendly ledgers, computed once per round (not per window).
  // Two ledgers, not one, because the tightened feasibility gate asks two
  // different questions (see `feasible`): "could this unit save ITSELF" and
  // "could this unit reach SOMEBODY ELSE". Both predicates are imported, not
  // re-derived — `SELF_CAST_NOOP_EXTERNAL_IDS` is the #25-1 fix's list of
  // externals that do nothing self-cast, `canHelpAnotherUnit` is GH #28's.
  const selfCdsByUnit = new Map<string, IMajorCooldownInfo[]>();
  const allyCdsByUnit = new Map<string, IMajorCooldownInfo[]>();
  // hard CC on the unit itself, from any source (`inCcAt`'s first half)
  const ccByUnit = new Map<string, { startMs: number; endMs: number }[]>();
  /** PROBE-ONLY: spellId → base cooldown seconds, straight off the same
   * `extractMajorCooldowns` ledger `cdAvailableAt` reads above, so a spend's
   * weight and a spend's availability can never come from two tables. */
  const cdSecByUnit = new Map<string, Map<string, number>>();
  for (const u of friendlies) {
    let cds: IMajorCooldownInfo[] = [];
    try {
      cds = extractMajorCooldowns(u, combat);
    } catch {
      cds = [];
    }
    // The default ledger has no baseline-only row (owned by the spec, never
    // pressed / talented / picked this round — cd-hoarded F-W6): user ruling
    // 2026-10-01 (P-W6) gives those rows to cd-hoarded alone, and
    // feasibility that counted them would widen slow-defensive-response and
    // drift from the reference table's population (cast evidence).
    const answers = cds.filter(
      (cd) =>
        !cdIsProcOnly(cd) &&
        !cd.isThroughput &&
        (PERSONAL_WALL_IDS.has(cd.spellId) ||
          EXTERNAL_IDS.has(cd.spellId) ||
          BURST_HEAL_CD_IDS.has(cd.spellId)),
    );
    selfCdsByUnit.set(
      u.id,
      answers.filter((cd) => cdHelpsRecipient(cd, true)),
    );
    allyCdsByUnit.set(
      u.id,
      answers.filter((cd) => cdHelpsRecipient(cd, false)),
    );
    ccByUnit.set(u.id, buildFilteredAuraIntervals(u, ccSpellIds, combat));
    if (opts.collectSpend)
      cdSecByUnit.set(
        u.id,
        new Map(cds.map((cd) => [cd.spellId, cd.cooldownSeconds])),
      );
  }

  // Feasibility's "could not act" also covers what `inCcAt` never saw:
  // silences and kick lockouts, from the one cannot-cast predicate the
  // dispel and healing-gap exemptions use (reliability round 2 W1a). Pets
  // count as enemies here — a Felhunter's Spell Lock locks as hard as a Kick.
  const enemyPlayerIds = new Set<string>(enemies.map((u) => u.id));
  const enemySourceIds = new Set<string>([
    ...enemyPlayerIds,
    ...units
      .filter((u) => u.ownerId && enemyPlayerIds.has(u.ownerId))
      .map((u) => u.id as string),
  ]);
  // FT-T10: asked per tool, through the one reading for a named spell
  // (`cannotCastIntervalsForSpells`): a kick lockout stops only a tool of the
  // school it locked, and a tool the unit's PET casts is asked of the pet.
  // `ofPet` = that second case: the hard-CC list above sits on the unit and
  // says nothing about its pet, so it is not read for such a tool.
  const cannotCastByTool = new Map<
    string,
    { ofPet: boolean; intervals: { from: number; to: number }[] }
  >();
  const cannotCastForTool = (u: any, toolSpellId: string) => {
    const key = `${u.id}:${toolSpellId}`;
    let entry = cannotCastByTool.get(key);
    if (!entry) {
      entry = {
        ofPet: petCastersOf(u, units, toolSpellId).length > 0,
        // T147: asked as a press of this tool — a stun the game lets it
        // through does not stop it
        intervals: pressBlockedIntervalsForSpells(
          u,
          enemySourceIds,
          [toolSpellId],
          units,
          false,
        ),
      };
      cannotCastByTool.set(key, entry);
    }
    return entry;
  };
  const friendlyPlayerIds = new Set<string>(friendlies.map((u) => u.id));
  const ownerOfUnit = new Map<string, string>(
    units
      .filter((u) => u.ownerId && friendlyPlayerIds.has(u.ownerId))
      .map((u) => [u.id as string, u.ownerId as string]),
  );
  const friendlyPlayerOf = (srcUnitId: string): string | undefined =>
    friendlyPlayerIds.has(srcUnitId) ? srcUnitId : ownerOfUnit.get(srcUnitId);
  const friendlyNameById = new Map<string, string>(
    friendlies.map((u) => [u.id, u.name]),
  );
  // A damage source → the enemy PLAYER behind it (itself, or its pet's /
  // summon's owner), the mirror of `friendlyPlayerOf`. FT-T12 D3 asks it of
  // every hit on the pressured friendly (`controlTargetHitPressured`).
  const enemyOwnerOfUnit = new Map<string, string>(
    units
      .filter((u) => u.ownerId && enemyPlayerIds.has(u.ownerId))
      .map((u) => [u.id as string, u.ownerId as string]),
  );
  const enemyPlayerOf = (srcUnitId: string): string | undefined =>
    enemyPlayerIds.has(srcUnitId) ? srcUnitId : enemyOwnerOfUnit.get(srcUnitId);

  const out: BurstWindowDecisionPoint[] = [];
  {
    for (const seg of segments) {
      const orderedAll = [...seg.casts].sort(
        (a, b) => a.castSeconds - b.castSeconds,
      );
      // Lead selection first: `BURST_LEAD_CD_EXCLUDED_IDS` can move the window
      // start, and everything below is anchored on it.
      const leadPool = orderedAll.filter(
        (c) => !BURST_LEAD_CD_EXCLUDED_IDS.has(c.spellId),
      );
      if (!leadPool.length) continue; // nothing here can open a window
      let leadRaw = leadPool[0]!;
      let leadW = weightOf(leadRaw, facts);
      for (const c of leadPool) {
        if (Math.floor(c.castSeconds) !== Math.floor(leadPool[0]!.castSeconds))
          break;
        const cw = weightOf(c, facts);
        if (cw > leadW) {
          leadW = cw;
          leadRaw = c;
        }
      }
      // `tSec` follows the lead cast, not the segment's first cast: with an
      // excluded opener (Power Infusion) the two differ, and the rendered
      // sentence "at M:SS the enemy opened X" must name what was pressed at
      // M:SS. Without an excluded opener they are the same second.
      const tSec = Math.floor(leadRaw.castSeconds);
      const tMs = start + tSec * 1000;
      const leadRawMs = start + leadRaw.castSeconds * 1000;
      const endSec = Math.max(tSec, Math.floor(seg.toSeconds));
      // Outcome horizon: the bounded window, but never shorter than the
      // response window it is judged against — a piece whose only CD carries
      // no official duration ends on its own cast second, and "did anybody die
      // inside 0 seconds" is not an outcome, it is a rounding artefact.
      const outcomeEndSec = Math.max(endSec, tSec + BURST_RESPONSE_WINDOW_SEC);
      const outcomeEndMs = start + outcomeEndSec * 1000;
      const buffEndSecOf = (c: IAlignedBurstWindow["activeCDs"][number]) =>
        Math.floor(
          facts.get(castKey(c.playerName, c.spellId, c.castSeconds))
            ?.buffEndSeconds ?? c.castSeconds,
        );
      // the window's longest-running buff (the earliest cast of a tie)
      const lastBuff = orderedAll.reduce((a, c) =>
        buffEndSecOf(c) > buffEndSecOf(a) ? c : a,
      );
      const buffRunEndSec = Math.max(outcomeEndSec, buffEndSecOf(lastBuff));
      // F-B6: the window the line prints ends at the END of its last
      // rendered second — the last ms of `outcomeEndSec`. One bound for every
      // outcome reading (who died, who the burst hit, the damage taken, the
      // control-answer filter): codex post-hoc 60-POSTHOC-03 U3 — a friendly
      // hit at 18.5 s and dead at 18.6 s (outcomeEndSec 18) counted as died
      // but not as hit, so the death-first pick passed it over
      const outcomeLastMs = outcomeEndMs + 999;

      const ordered = orderedAll;
      const refOf = (
        c: IAlignedBurstWindow["activeCDs"][number],
      ): BurstCdRef => {
        const caster = enemyByName.get(c.playerName);
        const english = getEnglishSpellName(c.spellId, c.spellName);
        return {
          spellId: c.spellId,
          // user ruling R79 (2026-11-19, T185): a cast-less proc copy the
          // timeline prints `X (no press)` keeps that mark on every burst
          // line that names it — `enemy opened X (no press)`, `+X (no
          // press) 5s later`, `leadCd=X (no press)` — instead of reading as
          // a press; the window, its timing and its troughs are unchanged
          spellName:
            c.spellName.endsWith(NO_PRESS_SUFFIX) &&
            !english.endsWith(NO_PRESS_SUFFIX)
              ? `${english}${NO_PRESS_SUFFIX}`
              : english,
          casterName: c.playerName,
          casterSpec: caster ? specToString(caster.spec) : "?",
          castSec: Math.floor(c.castSeconds),
        };
      };
      // lead = the FIRST eligible cast of the window (chosen above, before
      // `tSec`), heavier `spellDangerWeight` breaking a same-second tie.
      // GH #60 wrote this "first/heaviest"; first is the half that keeps the
      // rendered sentence true — the decision point is the window START, so
      // "at M:SS they opened <leadCd>" must name what was actually pressed at
      // M:SS. Taking the heaviest instead named a CD cast up to 16 s later in
      // real windows (match 2195ab6e round 4: window opens on Recklessness at
      // 0:09, heaviest is Trueshot at 0:25).
      const leadCd = refOf(leadRaw);
      const extraCds = ordered.filter((c) => c !== leadRaw).map(refOf);
      const casterIds = [
        ...new Set(
          ordered
            .map((c) => enemyByName.get(c.playerName)?.id)
            .filter((id): id is string => !!id),
        ),
      ];

      // ── responses: any friendly, [tMs - pre, tMs + 8s] ──────────────────
      const { w0, w1 } = burstResponseSpanMs(tMs, leadRawMs);
      const casterIdSet = new Set(casterIds);
      // whose control answers THIS burst: a caster of the lead or of an extra
      // inside the 8 s the sentence judges — the CDs `burstExtrasLabel`
      // prints (fact5 D11, ef3b61c9 r0 0:22: a Scatter Shot on a druid whose
      // only CDs came 12 s and 33 s after the opener was credited as the
      // answer). The window's other readers keep the whole segment's casters.
      const answerCasterIdSet = new Set(
        ordered
          .filter(
            (c) =>
              c === leadRaw ||
              Math.floor(c.castSeconds) <= tSec + BURST_RESPONSE_WINDOW_SEC,
          )
          .map((c) => enemyByName.get(c.playerName)?.id)
          .filter((id): id is string => !!id),
      );
      const responseCasts: BurstResponseCast[] = [];
      // the raw instant each response counts at (its `latencySec` origin) —
      // read once more below, against the pressured friendly's death
      const responseAtMs = new Map<BurstResponseCast, number>();
      // the latency a response is ORDERED by when it is not its printed
      // `latencySec` (a summon's control: its landing, `orderAtMs`)
      const orderLatencyOf = new Map<BurstResponseCast, number>();
      // a press on another friendly is an external; an untargeted press
      // that can reach others (Tree of Life, Ancient of Lore) a group heal;
      // one on its caster — or on an enemy (Ultimate Penitence) — a wall
      const extraAnswerCategory = (
        c: FriendlyCast,
      ): BurstResponseCast["category"] =>
        // T181: a self-save answers for its presser alone — a `wall`, which
        // `answersPressured` holds to its caster (Mass Invisibility's
        // official targets are a friendly area; whom it covered is not
        // read here)
        SELF_SAVE_ANSWER_IDS.has(c.spellId)
          ? "wall"
          : c.dest &&
              c.dest !== c.unitId &&
              friendlies.some((f) => f.id === c.dest)
            ? "external"
            : isNoDest(c.dest) &&
                canHelpAnotherUnit(c.spellId) &&
                // R112: an Anti-Magic Shell with no ally target is its
                // presser's own shell, whatever the id can reach
                !ANTI_MAGIC_SHELL_ANSWER_IDS.has(c.spellId)
              ? "healCd"
              : "wall";
      for (const c of friendlyCasts) {
        if (c.tMs < w0) continue;
        if (c.tMs > w1) break;
        const category: BurstResponseCast["category"] | null = c.allyCopy
          ? "external"
          : PERSONAL_WALL_IDS.has(c.spellId)
            ? "wall"
            : EXTERNAL_IDS.has(c.spellId)
              ? "external"
              : BURST_HEAL_CD_IDS.has(c.spellId)
                ? "healCd"
                : CONTROL_IDS.has(c.spellId) &&
                    c.dest != null &&
                    answerCasterIdSet.has(c.dest)
                  ? "control"
                  : BURST_EXTRA_ANSWER_IDS.has(c.spellId) &&
                      // T182 (ruling A6): a redirect on its own caster that
                      // takes no damage off it (Master's Call) answers
                      // nothing
                      !selfCastRedirectIsNoSave(c.spellId, c.unitId, c.dest)
                    ? extraAnswerCategory(c)
                    : null;
        if (!category) continue;
        const casterUnit = units.find((u) => u.id === c.unitId);
        const dur = casterUnit
          ? buffDurationOfApplication(c.spellId, casterUnit, c.tMs)
          : undefined;
        const castS = (c.tMs - start) / 1000;
        // the observed end even for a cast with no official length of its
        // own (Greater Invisibility 110959: its aura 110960 carries it —
        // 141470d0 3:08 had no end at all and the coverage test was skipped)
        const observedEndS =
          casterUnit && category !== "control"
            ? observedEffectEndSeconds(
                casterUnit,
                c.spellId,
                castS,
                Math.min(
                  Infinity,
                  ...((casterUnit.spellCastEvents ?? []) as any[])
                    .filter(
                      (e) =>
                        e.logLine?.event === "SPELL_CAST_SUCCESS" &&
                        e.spellId === c.spellId &&
                        e.timestamp > c.tMs + 1,
                    )
                    .map((e) => (e.timestamp - start) / 1000),
                ),
                combat,
                c.copyOn,
              )
            : null;
        // T123: where an untargeted / self-cast answer's effect went — its
        // aura and heal rows, up to its next press or the response window
        const spread =
          category !== "control" && (isNoDest(c.dest) || c.dest === c.unitId)
            ? (() => {
                const nextMs = Math.min(
                  Infinity,
                  ...(
                    (casterUnit?.spellCastEvents ?? []) as ReadonlyArray<{
                      logLine?: { event?: string };
                      spellId?: string;
                      timestamp: number;
                    }>
                  )
                    .filter(
                      (e) =>
                        e.logLine?.event === "SPELL_CAST_SUCCESS" &&
                        e.spellId === c.spellId &&
                        e.timestamp > c.tMs + 1,
                    )
                    .map((e) => e.timestamp),
                );
                const sources = new Set<string>([c.unitId]);
                for (const [pet, owner] of ownerOfUnit)
                  if (owner === c.unitId) sources.add(pet);
                return pressEffectSpread(
                  friendlies,
                  c.unitId,
                  sources,
                  c.spellId,
                  c.tMs - ANSWER_EFFECT_LEAD_MS,
                  Math.min(nextMs, c.tMs + BURST_RESPONSE_WINDOW_MS),
                );
              })()
            : undefined;
        const effectOnUnitIds = spread?.auraHolderIds.some(
          (id) => id !== c.unitId,
        )
          ? spread.auraHolderIds
          : undefined;
        const selfOnlyEffect =
          spread !== undefined &&
          effectOnUnitIds === undefined &&
          officialSelfOnlyHeal(c.spellId) &&
          !spread.namedOnOther;
        const preOpenerStillUp =
          category === "control" &&
          c.tMs < leadRawMs &&
          !INTERRUPT_IDS.has(c.spellId)
            ? aimedControlUpAt(
                units.find((u) => u.id === c.dest),
                c.unitId,
                c.spellId,
                c.tMs,
                leadRawMs,
              )
            : undefined;
        const landed =
          category === "control"
            ? aimedControlLanded(
                units.find((u) => u.id === c.dest),
                c.unitId,
                c.spellId,
                c.tMs,
                friendlyPlayerOf,
                INTERRUPT_IDS.has(c.spellId),
              )
            : undefined;
        // T12 ⑧ (i): who the control was aimed at, and the aura applications
        // it landed as — the scan `landed` itself rests on
        const controlDest =
          category === "control"
            ? units.find((u) => u.id === c.dest)
            : undefined;
        const controlOn: BurstResponseCast["controlOn"] = controlDest
          ? {
              unitId: controlDest.id,
              unitName: controlDest.name,
              auras: aimedControlLandingAuras(
                controlDest,
                c.unitId,
                c.spellId,
                c.tMs,
                friendlyPlayerOf,
              ),
            }
          : undefined;
        const response: BurstResponseCast = {
          category,
          spellId: c.spellId,
          spellName: getEnglishSpellName(c.spellId),
          casterName: c.unitName,
          tSec: Math.floor((c.tMs - start) / 1000),
          latencySec:
            Math.round(((c.tMs - leadRawMs) / 1000 + Number.EPSILON) * 10) / 10,
          ...(c.dest ? { destId: c.dest } : {}),
          casterId: c.unitId,
          ...(observedEndS !== null
            ? { effectEndSec: Math.floor(observedEndS) }
            : dur
              ? { effectEndSec: Math.floor(castS + dur) }
              : {}),
          ...(preOpenerStillUp !== undefined ? { preOpenerStillUp } : {}),
          ...(landed !== undefined ? { landed } : {}),
          ...(controlOn ? { controlOn } : {}),
          ...(effectOnUnitIds ? { effectOnUnitIds } : {}),
          ...(selfOnlyEffect ? { selfOnlyEffect: true as const } : {}),
          ...(c.castless ? { castless: true as const } : {}),
        };
        responseAtMs.set(response, c.tMs);
        responseCasts.push(response);
      }
      for (const r of controlLandedResponses(
        [...answerCasterIdSet]
          .map((id) => units.find((u) => u.id === id))
          .filter(Boolean),
        answerCasterIdSet,
        friendlyPlayerOf,
        friendlyCasts,
        w0,
        w1,
        (summonId) => {
          const rows: ReadonlyArray<{
            spellId?: string;
            timestamp?: number;
            logLine?: { event?: string; timestamp?: number };
          }> = units.find((u) => u.id === summonId)?.spellCastEvents ?? [];
          return rows
            .filter(
              (c) => c.logLine?.event === "SPELL_CAST_SUCCESS" && !!c.spellId,
            )
            .map((c) => ({
              spellId: String(c.spellId),
              tMs: c.timestamp ?? c.logLine?.timestamp ?? 0,
            }));
        },
        (summonId) => {
          const u = units.find((x) => x.id === summonId);
          return u ? summonedAtMs(u) : null;
        },
      )) {
        const holder = units.find((u) => u.id === r.holderId);
        const response: BurstResponseCast = {
          category: "control",
          spellId: r.spellId,
          spellName: getEnglishSpellName(r.spellId),
          casterName: friendlyNameById.get(r.unitId) ?? "",
          // the unit the control landed on, in the field an aimed control
          // carries its target in — D3's rule reads one field for both
          ...(r.holderId !== undefined ? { destId: r.holderId } : {}),
          tSec: Math.floor((r.tMs - start) / 1000),
          // the holder this aura landed on, and the application itself
          ...(holder
            ? {
                controlOn: {
                  unitId: holder.id,
                  unitName: holder.name,
                  auras:
                    r.auraAtMs !== undefined
                      ? [{ spellId: r.spellId, atMs: r.auraAtMs }]
                      : [],
                },
              }
            : {}),
          // F-B4's pre-opener check, as for an aimed control: a landed control
          // from before the lead cast answers only if its aura was still on
          // its holder then (codex 35-CD-13f: a root that ended 0.5 s before
          // the opener was credited)
          ...(() => {
            const up = landedPreOpenerStillUp(
              r,
              units.find((u) => u.id === r.holderId),
              leadRawMs,
            );
            return up === undefined ? {} : { preOpenerStillUp: up };
          })(),
          // the same origin as a direct cast (the raw lead press) — the
          // window's tMs mixed two clocks and sorted a later Barkskin ahead
          // of an earlier landed Capacitor Totem (codex review of batch 8)
          latencySec:
            Math.round(((r.tMs - leadRawMs) / 1000 + Number.EPSILON) * 10) / 10,
        };
        responseAtMs.set(response, r.tMs);
        if (r.orderAtMs !== undefined)
          orderLatencyOf.set(
            response,
            Math.round(
              ((r.orderAtMs - leadRawMs) / 1000 + Number.EPSILON) * 10,
            ) / 10,
          );
        responseCasts.push(response);
      }
      // first answer first, by the instant it reached the caster (R90
      // decides what a summon's control PRINTS, not where it ranks)
      const orderLat = (r: BurstResponseCast): number =>
        orderLatencyOf.get(r) ?? r.latencySec;
      responseCasts.sort((a, b) => orderLat(a) - orderLat(b));
      // ── outcomes per friendly, and the ONE pressured friendly ────────────
      // Computed before the kite/feasibility/triage work below, because all
      // three ask about the same unit (see `pressured`).
      const friendlyOutcomes: BurstFriendlyOutcome[] = friendlies.map((f) => {
        let minHpPct: number | null = null;
        let minHpSec: number | null = null;
        let startHpPct: number | null = null;
        let startHpSec: number | null = null;
        for (let s = tSec; s <= outcomeEndSec; s++) {
          if (isDeadAtRenderSecond(f, start, s)) break;
          const hp = gridHpPct(f, start + s * 1000);
          if (hp === null) continue;
          if (startHpPct === null) {
            startHpPct = hp;
            startHpSec = s;
          }
          if (minHpPct === null || hp < minHpPct) {
            minHpPct = hp;
            minHpSec = s;
          }
        }
        // the printed bottom (FT-T03): the true minimum over the same
        // seconds. Null exactly when the grid minimum is.
        const trough =
          minHpPct === null
            ? null
            : hpTroughInWindow(
                f,
                start,
                tSec,
                outcomeEndSec,
                // not past the round's end — neither its samples nor the
                // ticks of seconds that begin after it (fact10 D30
                // follow-up, GH #191: cover set 31-3 `bottomed at 32%`, the
                // round's lowest 36 %, the hits after the round-ending death)
                secondsPastRoundEnd(start, roundEndAtMs),
                roundClippedTroughSpan(
                  start,
                  tSec,
                  outcomeEndSec,
                  roundEndAtMs,
                ),
              );
        // F-B6 (triage sync-burst, codex 09-30): the window the line prints
        // ends at the END of its last rendered second — a lethal burst's
        // segment ends at the death, which falls in the fractional part of
        // the floored `outcomeEndSec` (0777a8e0 1:19: death at 88.892, end
        // second 88). Render-grid reading, no new threshold.
        const deathInWindowMs = ((f.deathRecords ?? []) as any[])
          .map((d) => d.timestamp as number)
          .filter((ms) => ms >= tMs && ms <= outcomeLastMs)
          .sort((a, b) => a - b)[0];
        const died = deathInWindowMs !== undefined;
        return {
          unitId: f.id,
          name: f.name,
          minHpPct,
          minHpSec,
          troughHpPct: trough?.pct ?? minHpPct,
          troughHpSec: trough?.atSec ?? minHpSec,
          startHpPct,
          startHpSec,
          died,
          ...(deathInWindowMs !== undefined
            ? { diedSec: Math.floor((deathInWindowMs - start) / 1000) }
            : {}),
        };
      });
      const damageTakenIn = (f: any): number =>
        damageTakenBetween(f, tMs, outcomeLastMs);
      const dmgByUnitId = new Map<string, number>(
        friendlies.map((f) => [f.id, damageTakenIn(f)]),
      );
      // WO3 Part 2 G6 (r1014-177): the pressured friendly is one the
      // burst's casters (or their pets) hit inside the window — f4eb8c87:
      // Frozen Orb / Ray of Frost did 0 to the owner named as pressured
      const fromBurstCaster = (src: string) => {
        const p = enemyPlayerOf(src);
        return p !== undefined && casterIdSet.has(p);
      };
      // …or one their hits found IMMUNE: an immunity pressed at the opening
      // is still the answer to it (user 2026-10-14, option B; s2/51-1-357:
      // Ice Block 0.2 s before the Deathmark it answered) — `hitByAttackers`
      const hitByBurst = new Set(
        friendlies
          .filter((f) =>
            hitByAttackers(f, units, fromBurstCaster, tMs, outcomeLastMs),
          )
          .map((f) => f.id),
      );
      // WO6 Part 2 n37 (user 2026-10-15, 「按你的建议走」): a friendly the burst hit who DIED inside
      // the window beats every survivor — its grid minimum stops before its
      // death second, so 37 % on the grid (b711d4ac's mage, dead at 4:33)
      // lost to a survivor's 29.5 %; two deaths: the earlier one. Then the
      // lowest grid-sampled HP; equal HP goes to whoever took more damage
      const deathMsOf = (unitId: string) => {
        const f = friendlies.find((u) => u.id === unitId);
        const ds = ((f?.deathRecords ?? []) as any[])
          .map((d) => d.timestamp as number)
          .filter((t) => t >= tMs && t <= outcomeLastMs);
        return ds.length > 0 ? Math.min(...ds) : Infinity;
      };
      const pressured =
        [...friendlyOutcomes]
          .filter((f) => f.minHpPct !== null && hitByBurst.has(f.unitId))
          .sort(
            (a, b) =>
              Number(b.died) - Number(a.died) ||
              deathMsOf(a.unitId) - deathMsOf(b.unitId) ||
              a.minHpPct! - b.minHpPct! ||
              (dmgByUnitId.get(b.unitId) ?? 0) -
                (dmgByUnitId.get(a.unitId) ?? 0),
          )[0] ?? null;
      const pressuredUnit = pressured
        ? (friendlies.find((f) => f.id === pressured.unitId) ?? null)
        : null;
      // FT-T12 D3 (user ruling 2026-10-10): a control stays a response only
      // when it went on a unit that was hitting the pressured friendly
      // (`controlTargetHitPressured`). It leaves `responseCasts` itself — not
      // a flag beside it — so `responses.control` / `responded` below
      // (slow-defensive-response) and `creditedAnswer` ([BURST ANSWERED]) read
      // ONE list and cannot disagree about what answered. Walls, externals
      // and healing cooldowns are untouched.
      for (let i = responseCasts.length - 1; i >= 0; i--) {
        const r = responseCasts[i]!;
        if (
          r.category === "control" &&
          !controlTargetHitPressured(
            pressuredUnit,
            r.destId,
            enemyPlayerOf,
            tMs,
            outcomeLastMs,
            units,
          )
        )
          responseCasts.splice(i, 1);
      }
      // T12 ⑧ (i): mark the responses pressed at or after the pressured
      // friendly's death — the one death predicate (`isDeadAt`), on the raw
      // instants. Only the [BURST ANSWERED] credit line reads the mark;
      // `responses` / `responded` below are computed from the same list (the
      // one D3 narrowed just above) and never look at it.
      if (pressuredUnit)
        for (const r of responseCasts)
          if (isDeadAt(pressuredUnit, responseAtMs.get(r)!))
            r.afterPressuredDeath = true;
      const casterUnits = casterIds.map((id) => units.find((u) => u.id === id));
      // agy 40-FT-101: a pressured friendly who died is not read kiting past
      // its death — the distance is measured up to it, never off a corpse
      const kiteEndMs = pressured
        ? Math.min(w1, deathMsOf(pressured.unitId))
        : w1;
      const kiteGain =
        pressuredUnit != null &&
        (dmgByUnitId.get(pressuredUnit.id) ?? 0) > 0 &&
        kitedAway(pressuredUnit, casterUnits, tMs, kiteEndMs);
      const kiteWho = kiteGain
        ? kiteAttribution(pressuredUnit, casterUnits, tMs, kiteEndMs)
        : null;
      const attackerMoved =
        !!kiteWho &&
        kiteWho.ownerGain < KITE_GAIN_YARDS &&
        kiteWho.attackerGain >= KITE_GAIN_YARDS;
      const kite = kiteGain && !attackerMoved;
      const responses: BurstWindowResponses = {
        wall: responseCasts.some((r) => r.category === "wall"),
        external: responseCasts.some((r) => r.category === "external"),
        healCd: responseCasts.some((r) => r.category === "healCd"),
        control: responseCasts.some((r) => r.category === "control"),
        kite,
        attackerMoved,
      };
      // T180 (rulings R65 / R68 / R75): a press that went elsewhere, and a
      // press R75 ignores (another unit's self-only save, an interrupt that
      // interrupted nothing), is no answer for the pressured unit
      // (`pressDidNotReachPressured`); `responses` above stays what was
      // pressed
      const responded =
        responses.kite ||
        responses.attackerMoved ||
        responseCasts.some(
          (r) => !pressured || !pressDidNotReachPressured(pressured, r),
        );
      const firstResponseSec = responseCasts.length
        ? Math.min(...responseCasts.map((r) => r.latencySec))
        : null;

      // ── feasibility (Value-Gate rule 3, per the pressured friendly) ──────
      // One SIMULTANEOUS opportunity inside the response window (codex astra
      // GH #103 follow-up, 2026-09-23): some whole second s in [t, w1) at
      // which the helper is not in CC, a tool is reaction-ready
      // (`cdReadyInTimeAt`, REACTION_WINDOW_S — user ruling 2026-09-23) and,
      // for a teammate, deliverable at s. The previous test combined three
      // facts from different instants — "not CC'd for the WHOLE window",
      // "a tool ready at t", "in range at t" — so a teammate with a ready
      // external in range at t who then sat in CC until t+7 and ran out of
      // range still counted as able to answer. A cooldown that came back
      // three seconds into the window is now an opportunity it was not.
      // FT-T10: asked per tool (`cannotCastForTool`); a unit is out at a
      // second only when every ready tool is stopped
      const inCcAt = (u: any, ms: number, toolSpellId: string): boolean => {
        const tool = cannotCastForTool(u, toolSpellId);
        return (
          (!tool.ofPet &&
            (ccByUnit.get(u.id) ?? []).some(
              (iv) => iv.startMs <= ms && ms < iv.endMs,
            )) ||
          tool.intervals.some((iv) => iv.from <= ms && ms < iv.to)
        );
      };
      const windowSecs: number[] = [];
      for (let sec = tSec; start + sec * 1000 < w1; sec++) windowSecs.push(sec);
      const feasibleUnits: string[] = [];
      const feasibleEvidence: BurstWindowDecisionPoint["feasibleEvidence"] = [];
      if (pressuredUnit) {
        // (a) the person under the burst could have saved themselves
        const selfCds = selfCdsByUnit.get(pressuredUnit.id) ?? [];
        for (const sec of windowSecs) {
          // agy 40-FT-101: U8 for (a) too — a dead unit saves nobody, itself
          // included (an Ice Block back 0.8 s after the death read feasible)
          if (isDeadAtRenderSecond(pressuredUnit, start, sec)) break;
          const tool = selfCds.find(
            (cd) =>
              cdReadyInTimeAt(cd, sec) &&
              !inCcAt(pressuredUnit, start + sec * 1000, cd.spellId),
          );
          if (!tool) continue;
          feasibleUnits.push(pressuredUnit.name);
          feasibleEvidence.push({
            unit: pressuredUnit.name,
            sec,
            spellId: tool.spellId,
          });
          break;
        }
      }
      // (b)'s reachability gate (2026-09-02, GH #60 tail — chg7b §5 closed):
      // a teammate's ready tool only counts if the teammate could DELIVER it
      // to the pressured friendly at that same second. One predicate, shared
      // with the [ROOT] work (`canReachTargetAt`): same position sampler
      // (`getUnitPositionAtTime` at `LOS_SWEEP_GAP_MS`), same "LoS not
      // disproven counts as reachable" posture, and the range is per tool via
      // `externalReachYards` (official DB2 reach, 40 yd fallback — never
      // lower, so an unlisted spell cannot start acquitting or accusing
      // silently). Fail OPEN on missing data: no pressured friendly, no
      // position sample for the helper, or an unknown reach (`null`: no
      // target sample) all count as reachable — sampling gaps must not
      // manufacture infeasibility, only a position pair the log actually
      // recorded may remove a window. A DEAD target is not such a gap: the
      // loop below skips those seconds (U8).
      const teammateCanDeliver = (
        u: any,
        readyCds: IMajorCooldownInfo[],
        atMs: number,
      ): boolean => {
        if (!pressuredUnit) return true;
        const helperPos = getUnitPositionAtTime(u, atMs, LOS_SWEEP_GAP_MS);
        if (!helperPos) return true;
        return readyCds.some(
          (cd) =>
            canReachTargetAt(
              helperPos,
              pressuredUnit,
              atMs,
              combat?.startInfo?.zoneId,
              externalReachYards(cd.spellId, u),
              true,
              u,
            ) !== false,
        );
      };
      for (const u of friendlies) {
        // (b) a teammate could have reached them
        if (pressuredUnit && u.id === pressuredUnit.id) continue;
        const allyCds = allyCdsByUnit.get(u.id) ?? [];
        if (!allyCds.length) continue;
        for (const sec of windowSecs) {
          // U8 (user ruling 2026-09-30): a second at which the pressured
          // friendly is already dead is not a chance to answer for them —
          // `teammateCanDeliver`'s fail-open on an unknown reach only covers
          // a living target without a sample (4446729d 1:27: Xandarya died
          // 91.388, every "reachable" second was after it)
          if (pressuredUnit && isDeadAtRenderSecond(pressuredUnit, start, sec))
            continue;
          const ms = start + sec * 1000;
          const deliverable = allyCds.find(
            (cd) =>
              cdReadyInTimeAt(cd, sec) &&
              !inCcAt(u, ms, cd.spellId) &&
              teammateCanDeliver(u, [cd], ms),
          );
          if (!deliverable) continue;
          feasibleUnits.push(u.name);
          feasibleEvidence.push({
            unit: u.name,
            sec,
            spellId: deliverable.spellId,
          });
          break;
        }
      }

      const deathsInWindow = friendlyOutcomes.filter((f) => f.died).length;
      const mins = friendlyOutcomes
        .map((f) => f.minHpPct)
        .filter((v): v is number => v !== null);
      // "The window itself put them there" (see `triaged` / the constant):
      // null when the pressured friendly has no start sample, which fails the
      // door closed — we cannot claim the burst caused a drop we never saw.
      const pressuredDropPp =
        pressured !== null &&
        pressured.startHpPct !== null &&
        pressured.minHpPct !== null
          ? pressured.startHpPct - pressured.minHpPct
          : null;

      // ── PROBE-ONLY spend ledger (over-react probe, opt-in) ──────────────
      let spend: BurstSpendCast[] | undefined;
      if (opts.collectSpend) {
        spend = [];
        for (const c of friendlyCasts) {
          if (c.tMs < w0) continue;
          if (c.tMs > outcomeLastMs) break;
          const category: BurstSpendCast["category"] | null =
            PERSONAL_WALL_IDS.has(c.spellId)
              ? "wall"
              : EXTERNAL_IDS.has(c.spellId)
                ? "external"
                : BURST_HEAL_CD_IDS.has(c.spellId)
                  ? "healCd"
                  : null;
          if (!category) continue;
          spend.push({
            category,
            spellId: c.spellId,
            spellName: getEnglishSpellName(c.spellId),
            casterId: c.unitId,
            casterName: c.unitName,
            tSec: Math.floor((c.tMs - start) / 1000),
            cooldownSeconds: cdSecByUnit.get(c.unitId)?.get(c.spellId) ?? 0,
          });
        }
      }

      out.push({
        tMs,
        leadMs: leadRawMs,
        tSec,
        endSec,
        buffRunEndSec,
        buffRunEndSpellName: getEnglishSpellName(
          lastBuff.spellId,
          lastBuff.spellName,
        ),
        outcomeEndSec,
        durationSec: endSec - tSec,
        leadCd,
        extraCds,
        casterIds,
        pressured,
        responses,
        responded,
        firstResponseSec,
        responseCasts,
        feasible: feasibleUnits.length > 0,
        feasibleUnits,
        feasibleEvidence,
        triaged:
          pressured !== null &&
          pressuredDropPp !== null &&
          pressuredDropPp >= BURST_TRIAGE_MIN_HP_DROP_PP &&
          ((pressured.minHpPct !== null &&
            pressured.minHpPct <= CRISIS_HP_PCT_RENDERED) ||
            deathsInWindow > 0),
        anyFriendlyDeath: deathsInWindow > 0,
        ...(spend ? { spend } : {}),
        deathsInWindow,
        minFriendlyHpPct: mins.length ? Math.min(...mins) : null,
        friendlyOutcomes,
      });
    }
  }
  out.sort((a, b) => a.tSec - b.tSec);
  // T183 (ruling R73): the pressured trough reads on past the horizon while
  // one of the window's own buffs runs (`burstTroughReadEnd`). A pass of
  // its own: the stop at the next window needs every window's opening.
  const roundEndSec = Number.isFinite(roundEndAtMs)
    ? Math.floor((roundEndAtMs - start) / 1000)
    : null;
  out.forEach((p, i) => {
    const pr = p.pressured;
    if (!pr || pr.minHpPct === null) return;
    const f = friendlies.find((u) => u.id === pr.unitId);
    if (!f) return;
    const deathMs = ((f.deathRecords ?? []) as Array<{ timestamp: number }>)
      .map((d) => d.timestamp)
      .filter((t) => t >= p.tMs)
      .sort((a, b) => a - b)[0];
    const read = burstTroughReadEnd({
      outcomeEndSec: p.outcomeEndSec,
      buffRunEndSec: p.buffRunEndSec,
      nextWindowTSec:
        out.slice(i + 1).find((q) => q.tSec > p.tSec)?.tSec ?? null,
      deathSec:
        deathMs === undefined ? null : Math.floor((deathMs - start) / 1000),
      roundEndSec,
    });
    if (!read) return;
    const trough = hpTroughInWindow(
      f,
      start,
      p.tSec,
      read.toSec,
      secondsPastRoundEnd(start, roundEndAtMs),
      roundClippedTroughSpan(start, p.tSec, read.toSec, roundEndAtMs),
    );
    // R73 as narrowed by the user (2026-11-19): the line says where it was
    // read to only when the low it prints lies past the horizon — a low
    // inside the window keeps its reading and its line as they were
    if (
      trough &&
      (pr.troughHpPct === null ||
        pr.troughHpPct === undefined ||
        trough.pct < pr.troughHpPct)
    ) {
      pr.troughHpPct = trough.pct;
      pr.troughHpSec = trough.atSec;
      pr.troughReadToSec = read.toSec;
      pr.troughReadStop = read.stop;
    }
  });
  return out;
}

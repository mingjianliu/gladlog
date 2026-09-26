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

import { HEALING_VERDICTS } from "../data/healingVerdicts";
import { getEnglishSpellName } from "../data/spellEffectData";
import spellIdLists from "../data/spellIdLists";
import {
  ccSpellIds,
  rootSpellIds,
  spells as spellMeta,
} from "../data/spellTags";
import {
  canHelpAnotherUnit,
  cdReadyInTimeAt,
  extractMajorCooldowns,
  gridHpPct,
  type IMajorCooldownInfo,
  isDeadAtRenderSecond,
  cdIsProcOnly,
  SELF_CAST_NOOP_EXTERNAL_IDS,
  specToString,
  TEAM_HEAL_CD_IDS,
} from "../utils/cooldowns";
import { externalReachYards } from "../utils/deathOutcomeAnalysis";
import {
  type IAlignedBurstWindow,
  type IEnemyCDTimeline,
  reconstructEnemyCDTimeline,
  SOLO_WINDOW_MIN_WEIGHT,
} from "../utils/enemyCDs";
import { getUnitPositionAtTime } from "../utils/losAnalysis";
import { LOS_SWEEP_GAP_MS } from "../utils/positionSampling";
import { canReachTargetAt } from "../utils/rootReachability";
import { buildCannotCastIntervals } from "../utils/cannotCastIntervals";
import { isOffensiveSpell } from "../utils/spellDanger";
import { buildFilteredAuraIntervals } from "../utils/utils";
import {
  CRISIS_HP_PCT_RENDERED,
  KITE_GAIN_YARDS,
  kiteAttribution,
  kitedAway,
} from "./crisisDecisionPoints";

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
 * registered in `curatedIdRegistry`. The forward gap is closed: the 6 live
 * ids that used to sit only in the classMetadata table (Empower Rune Weapon
 * 47568, Ascendance 114050, Invoke Xuen 123904, Metamorphosis 191427,
 * Bladestorm 227847, Summon Demonic Tyrant 265187) can now open a window,
 * and `reconstructEnemyCDTimeline` + `threatActiveAt` +
 * `signalSkillGradientScan` all key on the same set. The
 * `docs/predicate-index.md` "Not yet unified" entry this used to point at is
 * closed; the re-assertion below stays, because the structural point (the
 * builder cannot widen what this engine calls a burst without this line
 * going with it) survives unification.
 */
export const isBurstWindowOffensiveCd = isOffensiveSpell;

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
   * of them from an untargeted or ground cast (`controlLandedResponses`) */
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
  /** seconds after the window start; may be negative down to
   * `-BURST_RESPONSE_PRE_MS/1000` (a pre-wall) */
  latencySec: number;
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
}

export interface BurstWindowDecisionPoint {
  /** window start re-anchored on the render grid: `startTime + tSec * 1000` */
  tMs: number;
  /** WHOLE seconds since round start — what `fmtTime` displays */
  tSec: number;
  /** last whole second of the bounded window */
  endSec: number;
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
   * inside `[tSec - BURST_RESPONSE_PRE_MS, outcomeEndSec]`. See
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
export function controlLandedResponses(
  casters: ReadonlyArray<{
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
): Array<{ unitId: string; spellId: string; tMs: number }> {
  const out: Array<{ unitId: string; spellId: string; tMs: number }> = [];
  for (const caster of casters)
    for (const a of caster.auraEvents ?? []) {
      if (a.logLine.event !== "SPELL_AURA_APPLIED") continue;
      const sid = a.spellId ?? "";
      if (!ccSpellIds.has(sid) && !rootSpellIds.has(sid)) continue;
      if (a.timestamp < w0 || a.timestamp > w1 + GROUND_CONTROL_FUSE_MS)
        continue;
      const unitId = friendlyPlayerOf(a.srcUnitId);
      if (!unitId) continue;
      let cast: (typeof friendlyCasts)[number] | undefined;
      for (const c of friendlyCasts) {
        if (c.tMs > a.timestamp) break;
        if (
          c.unitId === unitId &&
          c.tMs >= a.timestamp - GROUND_CONTROL_FUSE_MS &&
          (isNoDest(c.dest) || c.spellId === sid)
        )
          cast = c;
      }
      // the cast-side test already counted an aimed control from this
      // friendly that could be this aura's cause
      const aimed = friendlyCasts.some(
        (c) =>
          c.unitId === unitId &&
          c.tMs >= a.timestamp - GROUND_CONTROL_FUSE_MS &&
          c.tMs <= a.timestamp &&
          CONTROL_IDS.has(c.spellId) &&
          c.dest != null &&
          casterIds.has(c.dest),
      );
      if (aimed) continue;
      const tMs = cast?.tMs ?? a.timestamp;
      if (tMs < w0 || tMs > w1) continue;
      out.push({ unitId, spellId: sid, tMs });
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
export function burstExtrasLabel(p: {
  tSec: number;
  extraCds: ReadonlyArray<{ spellName: string; castSec: number }>;
}): string {
  return p.extraCds
    .filter((c) => c.castSec <= p.tSec + BURST_RESPONSE_WINDOW_SEC)
    .map((c) =>
      c.castSec > p.tSec
        ? `${c.spellName} ${c.castSec - p.tSec}s later`
        : c.spellName,
    )
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
): Map<number, number> {
  const out = new Map<number, number>();
  for (const f of friendlies) {
    const max = maxHpOf(f);
    if (max <= 0) continue;
    for (const d of (f.damageIn ?? []) as any[]) {
      const ts = d.timestamp ?? d.logLine?.timestamp;
      if (ts == null) continue;
      const s = Math.floor((ts - startMs) / 1000);
      const amt = Math.abs(d.effectiveAmount ?? d.amount ?? 0) / max;
      out.set(s, (out.get(s) ?? 0) + amt);
    }
  }
  return out;
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
  const dmgPctPerSec = damagePctPerSecond(friendlies, start);
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
  }
  const friendlyCasts: FriendlyCast[] = [];
  for (const u of friendlies)
    for (const c of (u.spellCastEvents ?? []) as any[]) {
      const sid = String(c.spellId ?? "");
      if (!sid) continue;
      friendlyCasts.push({
        unitId: u.id,
        unitName: u.name,
        spellId: sid,
        dest: c.destUnitId,
        tMs: c.timestamp ?? c.logLine?.timestamp,
      });
    }
  friendlyCasts.sort((a, b) => a.tMs - b.tMs);

  // per-friendly ledgers, computed once per round (not per window).
  // Two ledgers, not one, because the tightened feasibility gate asks two
  // different questions (see `feasible`): "could this unit save ITSELF" and
  // "could this unit reach SOMEBODY ELSE". Both predicates are imported, not
  // re-derived — `SELF_CAST_NOOP_EXTERNAL_IDS` is the #25-1 fix's list of
  // externals that do nothing self-cast, `canHelpAnotherUnit` is GH #28's.
  const selfCdsByUnit = new Map<string, IMajorCooldownInfo[]>();
  const allyCdsByUnit = new Map<string, IMajorCooldownInfo[]>();
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
      answers.filter((cd) => !SELF_CAST_NOOP_EXTERNAL_IDS.has(cd.spellId)),
    );
    allyCdsByUnit.set(
      u.id,
      answers.filter((cd) => canHelpAnotherUnit(cd.spellId, cd.tag)),
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
  for (const u of friendlies)
    ccByUnit.set(u.id, [
      ...(ccByUnit.get(u.id) ?? []),
      ...buildCannotCastIntervals(u, enemySourceIds).map((iv) => ({
        startMs: iv.from,
        endMs: iv.to,
      })),
    ]);
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
      const endSec = Math.max(tSec, Math.floor(seg.toSeconds));
      // Outcome horizon: the bounded window, but never shorter than the
      // response window it is judged against — a piece whose only CD carries
      // no official duration ends on its own cast second, and "did anybody die
      // inside 0 seconds" is not an outcome, it is a rounding artefact.
      const outcomeEndSec = Math.max(endSec, tSec + BURST_RESPONSE_WINDOW_SEC);
      const outcomeEndMs = start + outcomeEndSec * 1000;

      const ordered = orderedAll;
      const refOf = (
        c: IAlignedBurstWindow["activeCDs"][number],
      ): BurstCdRef => {
        const caster = enemyByName.get(c.playerName);
        return {
          spellId: c.spellId,
          spellName: getEnglishSpellName(c.spellId, c.spellName),
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
      const w0 = tMs - BURST_RESPONSE_PRE_MS;
      const w1 = tMs + BURST_RESPONSE_WINDOW_MS;
      const casterIdSet = new Set(casterIds);
      const responseCasts: BurstResponseCast[] = [];
      for (const c of friendlyCasts) {
        if (c.tMs < w0) continue;
        if (c.tMs > w1) break;
        const category: BurstResponseCast["category"] | null =
          PERSONAL_WALL_IDS.has(c.spellId)
            ? "wall"
            : EXTERNAL_IDS.has(c.spellId)
              ? "external"
              : BURST_HEAL_CD_IDS.has(c.spellId)
                ? "healCd"
                : CONTROL_IDS.has(c.spellId) &&
                    c.dest != null &&
                    casterIdSet.has(c.dest)
                  ? "control"
                  : null;
        if (!category) continue;
        responseCasts.push({
          category,
          spellId: c.spellId,
          spellName: getEnglishSpellName(c.spellId),
          casterName: c.unitName,
          tSec: Math.floor((c.tMs - start) / 1000),
          latencySec:
            Math.round(((c.tMs - tMs) / 1000 + Number.EPSILON) * 10) / 10,
        });
      }
      for (const r of controlLandedResponses(
        casterIds.map((id) => units.find((u) => u.id === id)).filter(Boolean),
        casterIdSet,
        friendlyPlayerOf,
        friendlyCasts,
        w0,
        w1,
      ))
        responseCasts.push({
          category: "control",
          spellId: r.spellId,
          spellName: getEnglishSpellName(r.spellId),
          casterName: friendlyNameById.get(r.unitId) ?? "",
          tSec: Math.floor((r.tMs - start) / 1000),
          latencySec:
            Math.round(((r.tMs - tMs) / 1000 + Number.EPSILON) * 10) / 10,
        });
      responseCasts.sort((a, b) => a.latencySec - b.latencySec);
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
        const died = ((f.deathRecords ?? []) as any[]).some(
          (d) => d.timestamp >= tMs && d.timestamp <= outcomeEndMs,
        );
        return {
          unitId: f.id,
          name: f.name,
          minHpPct,
          minHpSec,
          startHpPct,
          startHpSec,
          died,
        };
      });
      const damageTakenIn = (f: any): number =>
        ((f.damageIn ?? []) as any[])
          .filter((d) => {
            const ts = d.timestamp ?? d.logLine?.timestamp;
            return ts != null && ts >= tMs && ts <= outcomeEndMs;
          })
          .reduce(
            (n, d) => n + Math.abs(d.effectiveAmount ?? d.amount ?? 0),
            0,
          );
      const dmgByUnitId = new Map<string, number>(
        friendlies.map((f) => [f.id, damageTakenIn(f)]),
      );
      // lowest grid-sampled HP wins; equal HP goes to whoever took more damage
      const pressured =
        [...friendlyOutcomes]
          .filter((f) => f.minHpPct !== null)
          .sort(
            (a, b) =>
              a.minHpPct! - b.minHpPct! ||
              (dmgByUnitId.get(b.unitId) ?? 0) -
                (dmgByUnitId.get(a.unitId) ?? 0),
          )[0] ?? null;
      const pressuredUnit = pressured
        ? (friendlies.find((f) => f.id === pressured.unitId) ?? null)
        : null;
      const casterUnits = casterIds.map((id) => units.find((u) => u.id === id));
      const kiteGain =
        pressuredUnit != null &&
        (dmgByUnitId.get(pressuredUnit.id) ?? 0) > 0 &&
        kitedAway(pressuredUnit, casterUnits, tMs, w1);
      const kiteWho = kiteGain
        ? kiteAttribution(pressuredUnit, casterUnits, tMs, w1)
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
      const responded =
        responses.wall ||
        responses.external ||
        responses.healCd ||
        responses.control ||
        responses.kite ||
        responses.attackerMoved;
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
      const inCcAt = (u: any, ms: number): boolean =>
        (ccByUnit.get(u.id) ?? []).some(
          (iv) => iv.startMs <= ms && ms < iv.endMs,
        );
      const windowSecs: number[] = [];
      for (let sec = tSec; start + sec * 1000 < w1; sec++) windowSecs.push(sec);
      const feasibleUnits: string[] = [];
      const feasibleEvidence: BurstWindowDecisionPoint["feasibleEvidence"] = [];
      if (pressuredUnit) {
        // (a) the person under the burst could have saved themselves
        const selfCds = selfCdsByUnit.get(pressuredUnit.id) ?? [];
        for (const sec of windowSecs) {
          if (inCcAt(pressuredUnit, start + sec * 1000)) continue;
          const tool = selfCds.find((cd) => cdReadyInTimeAt(cd, sec));
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
      // position sample for the helper, or an unknown reach (`null`: target
      // dead / no target sample) all count as reachable — sampling gaps must
      // not manufacture infeasibility, only a position pair the log actually
      // recorded may remove a window.
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
            ) !== false,
        );
      };
      for (const u of friendlies) {
        // (b) a teammate could have reached them
        if (pressuredUnit && u.id === pressuredUnit.id) continue;
        const allyCds = allyCdsByUnit.get(u.id) ?? [];
        if (!allyCds.length) continue;
        for (const sec of windowSecs) {
          const ms = start + sec * 1000;
          if (inCcAt(u, ms)) continue;
          const deliverable = allyCds.find(
            (cd) => cdReadyInTimeAt(cd, sec) && teammateCanDeliver(u, [cd], ms),
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
          if (c.tMs > outcomeEndMs) break;
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
        tSec,
        endSec,
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
  return out;
}

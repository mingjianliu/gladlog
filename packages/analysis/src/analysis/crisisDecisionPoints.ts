/**
 * Crisis decision points — the ONE predicate behind `crisis-no-response`
 * (candidates/crisisNoResponse.ts) and the behavior-prior corpus scan
 * (packages/eval/scripts/behaviorPriorScan.ts). Both sides must consume this
 * module: the product says "you did not respond", the table says "top-10%
 * players respond X% here" — same crossing, same window, same response
 * taxonomy, or the two numbers are not comparable (CLAUDE.md shared-predicate
 * rule). Changing anything in here REQUIRES regenerating
 * data/behaviorPriorGenerated.json (spec §2 red line).
 *
 * Design: docs/superpowers/specs/2026-08-29-crisis-no-response-design.md.
 * Evidence: eval-private/reports/behavior-prior-2026-08-28/ (18,134 matches).
 */
import { LogEvent } from "@gladlog/parser-compat";

import { type CrisisRole } from "../data/behaviorPrior";
import { BREAK_RACIAL_SPELL_IDS } from "../data/racialAbilities";
import spellIdLists from "../data/spellIdLists";
import {
  ccSpellIds,
  officialSilenceIds,
  rootSpellIds,
  spells as spellMeta,
} from "../data/spellTags";
import {
  cdIsProcOnly,
  cdReadyInTimeAt,
  extractMajorCooldowns,
  // The [STATE] tick's own HP sampler (getUnitHpAtTimestamp +
  // HP_SAMPLE_RADIUS_MS + the 100 clamp), imported rather than re-derived so
  // a crisis fact and the same-second [STATE] line cannot disagree —
  // CLAUDE.md Shared-Predicate Rule; see gridHpPct's doc comment for the
  // measured cost of the two sides sampling separately.
  gridHpPct,
  type IMajorCooldownInfo,
  // ...and its companion, the [STATE] tick's `unit:dead` predicate.
  isDeadAtRenderSecond,
} from "../utils/cooldowns";
import { isEnemyCdWindowSpell } from "../utils/enemyCDs";
import { PVP_TRINKET_SPELL_IDS } from "../utils/killWindowTargetSelection";
import { rootIntervalsOf } from "../utils/rootReachability";
import { OFFENSIVE_CD_SPELL_IDS } from "../utils/spellDanger";
import { buildFilteredAuraIntervals } from "../utils/utils";

/** Re-exported from data/behaviorPrior.ts (the non-cyclic home for this
 * type — see its doc comment) so callers of this module don't need a second
 * import just to name a role. */
export type { CrisisRole };

/** A friendly at or below this HP fraction opens a "crisis" (moved here from
 * packages/eval/src/explore/signalSkillGradient.ts, which now re-exports). */
export const CRISIS_HP_PCT = 0.4;
/** Two crossings closer than this belong to the same crisis. */
export const CRISIS_WINDOW_GAP_MS = 5000;
/** The response window after the crossing — user-ruled 3 s (2026-08-29). */
export const RESPONSE_WINDOW_MS = 3000;
/** A response landed just before the sampled crossing still counts. */
export const RESPONSE_PRE_MS = 1500;
export const DMG_WINDOW_MS = 2000;

/**
 * Share of a crisis point's `DMG_WINDOW_MS` damage whose school a
 * mitigation `schoolMask` covers (`MITIGATION_TABLE`, the log's own school
 * bits). Null when the window recorded no damage (no claim either way).
 * Reliability round 2 W1e: cd-hoarded offered Blessing of Protection
 * (physical only) for crises that were 78 % and 100 % magic (06bb9860,
 * a5a8d31b).
 */
export function schoolShareCoveredBy(
  point: { dmg2sBySchool?: Record<string, number> },
  schoolMask: number,
): number | null {
  const by = point.dmg2sBySchool;
  if (!by) return null;
  let total = 0;
  let covered = 0;
  for (const [school, amount] of Object.entries(by)) {
    total += amount;
    if ((Number(school) & schoolMask) !== 0) covered += amount;
  }
  return total > 0 ? covered / total : null;
}
export const ENEMY_BURST_LOOKBACK_MS = 8000;
/** Gate 2: an interrupt landing on the owner this close before the crossing
 * means the school is locked — handed to `kick-eaten`, never double-charged. */
export const LOCKOUT_LOOKBACK_MS = 1500;
export const SELF_HEAL_BIG = 0.15;
export const KITE_GAIN_YARDS = 8;
/** Gate 5 (spec §1b, user ruling 2026-08-29): a crossing below this 2s-damage
 * floor doesn't die at a different rate whether the player responded or not
 * (measured: <10% dmg2s died 8.8% unresponded vs 7.8% responded — no
 * gradient; ≥10% died 22–23%). Below the floor, the point is not "dangerous"
 * and never fires the product candidate, and never enters the reference
 * table either — both sides apply this gate, same predicate. */
export const CRISIS_MIN_DMG2S = 0.1;
/** Table-only outcome window (spec §1b): did the owner die within this many
 * ms after the crossing? The producer (candidates/crisisNoResponse.ts) must
 * NEVER read `diedWithin10s` — only the reference-table builder
 * (packages/eval/src/explore/behaviorPriorTable.ts) does. */
export const DEATH_LOOKAHEAD_MS = 10_000;
/** Table-only outcome window (spec §1c, Solo Shuffle only): did ANY friendly
 * player — same `reaction` as the owner, owner included — have a
 * `deathRecords` entry within this many ms after the crossing? A healer
 * diving to 40% in Solo Shuffle usually isn't the kill target (measured:
 * healer-death ÷ crossing is 0.11 in Solo vs 0.29 in 3v3); the cost lands on
 * a teammate instead, so the reference-table builder counts the whole team
 * for Solo cells. The producer (candidates/crisisNoResponse.ts) must NEVER
 * read `friendDiedWithin15s` — only the reference-table builder
 * (packages/eval/src/explore/behaviorPriorTable.ts) does. */
export const TEAM_DEATH_LOOKAHEAD_MS = 15_000;
const POS_TOLERANCE_MS = 1500;
const ATTACKER_POS_TOLERANCE_MS = 2500;

export interface DecisionPointResponses {
  /** the owner's own healing from spells CAST inside the response window
   * reached SELF_HEAL_BIG (GH #93: an earlier HoT no longer counts here) */
  selfHeal: boolean;
  /** GH #93 (user ruling 2026-09-15, same shape as BACKLOG #43's procs): the
   * owner's healing only reached SELF_HEAL_BIG with heals from spells pressed
   * BEFORE the window (a ticking HoT). Still counts as answered — never an
   * accusation — but it is not a press and must not be described as one. */
  carriedHeal: boolean;
  /** GH #93: the distance gain kitedAway saw is explained by the ATTACKERS
   * moving away (kiteAttribution), not by the owner. Counts as answered,
   * never described as the owner kiting. */
  attackerMoved: boolean;
  wall: boolean;
  /** the owner pressed a protective ability outside the wall / external lists
   * that the user ruled counts as an answer (`CRISIS_PROTECTIVE_ANSWER_IDS`) */
  protective: boolean;
  external: boolean;
  control: boolean;
  peel: boolean;
  kite: boolean;
  /** BACKLOG #43 (user ruling 2026-09-14/17): a low-HP protection talent
   * TRIGGERED on its own inside the window (`CRISIS_PROC_ANSWERS` marker aura
   * applied to the owner). Counts as answered — "你自动触发了 X,这一波不需要再
   * 交别的" — but it is not a press and must never be described as one; the
   * spell the proc cast (Frenzied Regeneration, Regrowth) is subtracted from
   * the owner's own presses so it cannot double as `selfHeal` / `wall`. */
  proc: boolean;
  /** same mechanism, `kind: "cheatDeath"` (Cauterize, Purgatory, Defy Fate,
   * Last Resort, Cheat Death): a killing blow was converted into survival.
   * Counts as answered; phrased as "X saved you from a killing blow", never
   * as "nothing else needed" — the crisis reached the death line. */
  cheatDeath: boolean;
}
export interface DecisionPoint {
  /** the crossing re-anchored onto the prompt's render grid — always
   * `combat.startTime + tSec * 1000` (see `anchorToRenderGrid`) */
  tMs: number;
  /** WHOLE seconds since round start; this is the second `fmtTime` will
   * display, so it is safe to render directly and to re-derive from the
   * rendered text */
  tSec: number;
  /** the [STATE] tick's own reading at `tSec` (`gridHpPct`), never the raw
   * advancedAction sample — the two disagreed on 155/167 cd-hoarded lines
   * before 2026-08-30 */
  hpPct: number;
  dmg2s: number;
  /**
   * The same `DMG_WINDOW_MS` damage as `dmg2s` (same events, same amounts),
   * summed per log school mask (`spellSchoolId`, 0x1 = physical; a swing is
   * 0x1). Read by `schoolShareCoveredBy`; the reference tables never read
   * it. Optional so hand-built fixtures need not carry it.
   */
  dmg2sBySchool?: Record<string, number>;
  attackers2s: number;
  enemyBurst: boolean;
  inCC: boolean;
  lockedOut: boolean;
  diedInWindow: boolean;
  responses: DecisionPointResponses;
  /** owner's own active answer: selfHeal ∨ wall ∨ external ∨ control ∨ kite
   * (peel is a teammate's action — rendered, never credited to the owner) */
  responded: boolean;
  /** the low-HP procs that fired in the window (BACKLOG #43), by talent
   * name — for the "you auto-triggered X" phrasing; empty when none */
  procNames: string[];
  selfHealPct: number;
  /** gate 3, "has a tool" (spec §1d, GH #59): trivially true for a healer
   * (self-heal always exists). For a DPS owner: `!rooted || wallReady ||
   * controlReady` — not rooted (still free to move/act), or a personal wall
   * is off cooldown, or a Control-tagged major CD is off cooldown. */
  hasTool: boolean;
  /** gates 1, 2, 3 and 4 all pass */
  feasible: boolean;
  /** gate 5: dmg2s >= CRISIS_MIN_DMG2S (spec §1b). Independent of `feasible`
   * — a point can be dangerous but infeasible (e.g. CC'd), or feasible but
   * not dangerous (low damage). The product fires on feasible && dangerous. */
  dangerous: boolean;
  /** OUTCOME — for the reference table only (packages/eval's
   * behaviorPriorTable.ts). The producer must never read this field. */
  diedWithin10s: boolean;
  /** OUTCOME (spec §1c, Solo Shuffle) — for the reference table only
   * (packages/eval's behaviorPriorTable.ts). The producer must never read
   * this field. */
  friendDiedWithin15s: boolean;
}

const PERSONAL_WALL_IDS = new Set<string>(
  spellIdLists.bigDefensiveSpellIds.map(String),
);
/**
 * Healer crisis answers outside the wall / external lists — USER RULINGS
 * 2026-09-14 (GH #96 M4): "这 5 个技能我觉得都算是", then the second group below. Found by
 * packages/eval/scripts/crisisUnlistedDefensiveProbe.ts: 16 of 149 accusable
 * healer crisis points (S2 every 30) carried one of them, plus Power Word:
 * Shield on 10 more points the probe's pressable test missed. Only the owner's
 * own SPELL_CAST_SUCCESS inside the response window counts, like a wall.
 * Registered in curatedIdRegistry.
 */
export const CRISIS_PROTECTIVE_ANSWER_IDS: ReadonlySet<string> = new Set([
  "17", // Power Word: Shield
  "1253593", // Void Shield — Power Word: Shield upgraded by Master the Darkness (same button)
  "586", // Fade
  "215769", // Spirit of Redemption (PvP talent, pressed)
  "366155", // Reversion
  "64843", // Divine Hymn
  "64844", // Divine Hymn (channel id the log also reports as a cast)
  // second ruling 2026-09-14 ("一里的都算,二里的都不算"), from the
  // full-archive completeness scan: the damage-reduction / absorb /
  // big-cooldown group counts; Sanctified Ground (289655) does not
  "33891", // Incarnation: Tree of Life ("树肯定算,是大技能")
  "5487", // Bear Form
  "473909", // Ancient of Lore
  "421453", // Ultimate Penitence
  "740", // Tranquility
]);
/**
 * Presses that are not an answer on their own but OPEN one — USER RULING
 * 2026-09-14 (GH #96 M4): "交了徽章或者种族技能的话,后续有没有其他动作?如果只交徽章,
 * 什么都不干的话,不是有反应" and "给位移或者自由祝福的话,看有没有拉开距离".
 * A press inside the response window gets its own RESPONSE_WINDOW_MS to pay
 * off: a CC break (PvP trinket / break racial) counts when a credited action
 * follows within it; a mobility press counts when `kitedAway` holds from the
 * press to press + RESPONSE_WINDOW_MS. Measured before the change
 * (crisisFollowUpProbe.ts, 1/5 of the 63,303-file archive, 2,960 accusable
 * healer points): break presses at 75 points, 22 followed up only after the
 * window closed; mobility presses at 147, 38 opened distance only after it.
 * Registered in curatedIdRegistry.
 */
export const CRISIS_MOBILITY_PRESS_IDS: ReadonlySet<string> = new Set([
  "1044", // Blessing of Freedom (on self only)
  "115008", // Chi Torpedo
  "109132", // Roll
  "58875", // Spirit Walk
  "768", // Cat Form
  "210053", // Mount Form
  "190784", // Divine Steed
  "121536", // Angelic Feather
  "1850", // Dash
  "252216", // Tiger Dash
  "358267", // Hover
]);
const CRISIS_BREAK_PRESS_IDS = new Set<string>([
  ...PVP_TRINKET_SPELL_IDS,
  ...BREAK_RACIAL_SPELL_IDS,
]);
const EXTERNAL_IDS = new Set<string>(
  spellIdLists.externalDefensiveSpellIds.map(String),
);
// 2026-09-17 (GH #95 hand-read): this module still built its OWN 34-id
// offensive-cooldown set from classMetadata's Offensive tag, so `enemyBurst`
// was false on 12/12 teammate-crisis-idle cards while the enemy had pressed
// real cooldowns. The predicate index closed that divergence for every other
// consumer on 2026-09-02 (GH #60 tail) — this was the fourth consumer it
// missed. One table: the canonical 47-id `OFFENSIVE_CD_SPELL_IDS`.
const OFFENSIVE_CD_IDS: ReadonlySet<string> = OFFENSIVE_CD_SPELL_IDS;
/** hand-typed `interrupts` set (spellTags) — shared by CONTROL_IDS ("owner
 * used an interrupt on an enemy") and SILENCE_IDS ("owner is silenced") so
 * the filter is computed once, not twice. */
const INTERRUPT_IDS = new Set<string>(
  Object.entries(spellMeta)
    .filter(([, m]) => m.type === "interrupts")
    .map(([id]) => id),
);
/** "stop the damage" tools the owner can point at an enemy */
const CONTROL_IDS = new Set<string>([
  ...ccSpellIds,
  ...rootSpellIds,
  ...INTERRUPT_IDS,
]);
// C1 (2026-08-29): the hand-typed `interrupts` set alone covered 3/61 of the
// official DR `silence` category (measured) — Strangulate 47476,
// Garrote-Silence 1330, 356727, 374776 are all observed in the corpus and
// were uncovered, so a silenced healer read as `lockedOut=false`. Union in
// the official category exactly the way spellTags.ts builds
// `officialHardCcIds`: sourced from data/drCategories (not utils/drAnalysis
// — that module imports spellTags, which would cycle).
/** silence-type auras also lock the school: hand `interrupts` type
 * (spellTags) ∪ official DR `silence` category (`officialSilenceIds`, shared
 * with the [SILENCE] line since 2026-09-25). */
const SILENCE_IDS = new Set<string>([...INTERRUPT_IDS, ...officialSilenceIds]);

interface Sample {
  t: number;
  hp: number;
  max: number;
  x: number | null;
  y: number | null;
}

/** Resolve a damage source to the player id it should be attributed to: the
 * unit itself if it's a player (`info` present), else its owning player if
 * it's a pet/guardian (`unit.ownerId` → owner has `info`), else `null` for
 * environment/unknown sources. Measured 2026-08-29: a 3-enemy Solo Shuffle
 * round rendered "from 15 attackers" — 13 of the 15 raw damage sources were
 * one demonology warlock's imps/hounds, not distinct enemy players. */
function resolveAttackerId(
  src: string,
  unitById: Map<string, any>,
): string | null {
  const u = unitById.get(src);
  if (u?.info) return src;
  if (u?.ownerId) {
    const owner = unitById.get(u.ownerId);
    if (owner?.info) return u.ownerId;
  }
  return null;
}

/** Per-unit memo for `samplesOf`. Keyed on the unit object, so it costs
 * nothing when the same round is walked twice (this module's own crossings,
 * and burstWindowDecisionPoints' kite test through `kitedAway`) and cannot
 * outlive the parsed combat. */
const SAMPLE_CACHE = new WeakMap<object, Sample[]>();

function samplesOf(u: any): Sample[] {
  const hit = u && typeof u === "object" ? SAMPLE_CACHE.get(u) : undefined;
  if (hit) return hit;
  const out = ((u?.advancedActions ?? []) as any[])
    .filter((a) => (a.advancedActorMaxHp ?? 0) > 0)
    .map((a) => ({
      t: a.timestamp,
      hp: a.advancedActorCurrentHp / a.advancedActorMaxHp,
      max: a.advancedActorMaxHp,
      x: a.advancedActorPositionX ?? null,
      y: a.advancedActorPositionY ?? null,
    }))
    .sort((a, b) => a.t - b.t);
  if (u && typeof u === "object") SAMPLE_CACHE.set(u, out);
  return out;
}

/** `CRISIS_HP_PCT` on the scale [STATE] rounds to — an integer percent. The
 * crossing test must compare like with like: 0.4 → 40.
 * Exported 2026-09-01 (GH #60 phase 2): `burstWindowDecisionPoints`'s severity
 * triage asks the SAME question ("is this friendly's rendered HP at or under
 * the crisis line") against the SAME `gridHpPct` samples, so it must ask it
 * with this number, not a second `Math.round(CRISIS_HP_PCT * 100)`. */
export const CRISIS_HP_PCT_RENDERED = Math.round(CRISIS_HP_PCT * 100);

/**
 * Whether a `[DMG SPIKE]` window whose endpoints read `hpFrom% -> hpTo%`
 * hid a trough at `minPct` worth printing: the unit touched the crisis line
 * inside the window AND that reading is below both endpoints (a window that
 * starts or ends at its own minimum has nothing hidden).
 *
 * One predicate, two sides (CLAUDE.md Shared-Predicate Rule): the renderer
 * decides `, low N% @m:ss` vs `— healed through` with it, and the eval gate
 * `checkHealedThroughConsistency` asks the same question of every rendered
 * `[STATE]` tick inside the window. The crisis line is `CRISIS_HP_PCT_RENDERED`
 * — the same number every other "was this unit in danger" fact renders with —
 * rather than a second, spike-specific threshold (2026-09-15; measured on the
 * 309-prompt Opus baseline: 64 of 276 `healed through` lines had a visible
 * tick at or under it, 82 would have tripped a ≥25pp relative rule, the two
 * disagreeing only on troughs that never reached crisis).
 */
export function isDmgSpikeTrough(
  hpFrom: number,
  hpTo: number,
  minPct: number,
): boolean {
  return minPct <= CRISIS_HP_PCT_RENDERED && minPct < Math.min(hpFrom, hpTo);
}
/** How many whole seconds forward the grid re-anchor may search from the
 * crossing's own second. Derived from `CRISIS_WINDOW_GAP_MS` — anything
 * further away would already be a separate crisis by the merge rule. */
const GRID_ANCHOR_MAX_S = Math.ceil(CRISIS_WINDOW_GAP_MS / 1000);

/**
 * Re-anchor a raw crossing instant onto the prompt's render grid: the first
 * whole second at or after the crossing's own second (bounded by
 * `GRID_ANCHOR_MAX_S`) at which `gridHpPct` — the [STATE] tick's sampler —
 * still reads at or below `CRISIS_HP_PCT`.
 *
 * Returns null when no such second exists: the rendered prompt cannot show a
 * crisis there, so neither may a candidate that cites it (the alternative —
 * printing a number no [STATE] line agrees with — is exactly the defect this
 * function exists to remove).
 */
function anchorToRenderGrid(
  unit: any,
  startMs: number,
  rawMs: number,
): { tMs: number; tSec: number; hpPct: number } | null {
  const s0 = Math.floor((rawMs - startMs) / 1000);
  for (let s = s0; s <= s0 + GRID_ANCHOR_MAX_S; s++) {
    if (s < 0) continue;
    // [STATE] prints `unit:dead` from this second on, so no numeric HP claim
    // can be anchored here (measured: the whole residual 6/158 after the
    // HP-side anchor landed — see isDeadAtRenderSecond). A crisis is over
    // once the unit is dead; stop rather than search past it.
    if (isDeadAtRenderSecond(unit, startMs, s)) break;
    const tMs = startMs + s * 1000;
    const hp = gridHpPct(unit, tMs);
    // `hp > 0` mirrors the raw crossing's own `c.hp > 0` guard: 0% is a
    // corpse, not a crisis.
    if (hp !== null && hp > 0 && hp <= CRISIS_HP_PCT_RENDERED)
      return { tMs, tSec: s, hpPct: hp };
  }
  return null;
}

function nearestSample(
  samples: Sample[],
  t: number,
  tol: number,
): Sample | null {
  let best: Sample | null = null;
  for (const s of samples) {
    const d = Math.abs(s.t - t);
    if (d <= tol && (!best || d < Math.abs(best.t - t))) best = s;
  }
  return best;
}

/**
 * "Did `target` open at least `KITE_GAIN_YARDS` of distance from the nearest
 * of `attackers` between `t0Ms` and `t1Ms`?" — the ONE kite predicate.
 *
 * Extracted 2026-08-31 (GH #60 phase 1) so the enemy-burst-window engine
 * (`burstWindowDecisionPoints.ts`) tests kiting with exactly this code rather
 * than a second copy of it: same position sampler, same two tolerances, same
 * "nearest attacker at each endpoint" reduction, same gain threshold
 * (CLAUDE.md shared-predicate rule). `crisisDecisionPoints` below is the other
 * caller and its behaviour is unchanged — it used to inline this block.
 *
 * Returns false whenever either endpoint has no position sample within
 * tolerance, or no attacker does: an unmeasurable distance is not a kite.
 */
export function kitedAway(
  target: any,
  attackers: any[],
  t0Ms: number,
  t1Ms: number,
): boolean {
  if (!attackers.length) return false;
  const samples = samplesOf(target);
  const p0 = nearestSample(samples, t0Ms, POS_TOLERANCE_MS);
  const p1 = nearestSample(samples, t1Ms, POS_TOLERANCE_MS);
  if (p0?.x == null || p1?.x == null) return false;
  const near = (p: Sample, tt: number) => {
    let m = Infinity;
    for (const u of attackers) {
      if (!u) continue;
      const q = nearestSample(samplesOf(u), tt, ATTACKER_POS_TOLERANCE_MS);
      if (q?.x != null) m = Math.min(m, Math.hypot(p.x! - q.x, p.y! - q.y!));
    }
    return m;
  };
  const d0 = near(p0, t0Ms),
    d1 = near(p1, t1Ms);
  return isFinite(d0) && isFinite(d1) && d1 - d0 >= KITE_GAIN_YARDS;
}

/**
 * GH #93 measurement helper: who moved? Same sampler and tolerances as
 * `kitedAway`. Taking the attacker nearest at `t0Ms`, split the distance change
 * into the part the target's own movement explains (target at t1 vs attacker
 * at t0) and the part the attacker's movement explains (target at t0 vs
 * attacker at t1). Null when either endpoint lacks a position.
 */
export function kiteAttribution(
  target: any,
  attackers: any[],
  t0Ms: number,
  t1Ms: number,
): { gain: number; ownerGain: number; attackerGain: number } | null {
  const samples = samplesOf(target);
  const p0 = nearestSample(samples, t0Ms, POS_TOLERANCE_MS);
  const p1 = nearestSample(samples, t1Ms, POS_TOLERANCE_MS);
  if (p0?.x == null || p1?.x == null) return null;
  let best: { q0: Sample; q1: Sample; d0: number } | null = null;
  for (const u of attackers) {
    if (!u) continue;
    const s = samplesOf(u);
    const q0 = nearestSample(s, t0Ms, ATTACKER_POS_TOLERANCE_MS);
    const q1 = nearestSample(s, t1Ms, ATTACKER_POS_TOLERANCE_MS);
    if (q0?.x == null || q1?.x == null) continue;
    const d0 = Math.hypot(p0.x - q0.x, p0.y! - q0.y!);
    if (!best || d0 < best.d0) best = { q0, q1, d0 };
  }
  if (!best) return null;
  const { q0, q1, d0 } = best;
  const d = (a: Sample, b: Sample) => Math.hypot(a.x! - b.x!, a.y! - b.y!);
  return {
    gain: d(p1, q1) - d0,
    ownerGain: d(p1, q0) - d0,
    attackerGain: d(p0, q1) - d0,
  };
}

/**
 * "Could this player have acted at this instant?" — the same three blockers
 * crisisDecisionPoints gates its own crossings on (gate 1 hard CC, gate 2
 * interrupt lockout / silence, gate 4 dead), exposed for consumers that ask
 * the question about SOMEONE ELSE at an arbitrary time. GH #95 needs it for
 * the healer while a TEAMMATE is the one crossing: a healer who was stunned or
 * kicked when the teammate dropped must never be told they did nothing.
 * Registered as a shared predicate — same id sets, same lookback constant.
 */
/**
 * Low-HP protection procs (BACKLOG #43, user ruling 2026-09-14 "自动 proc 可以
 * 算进去,但话术要变" and 2026-09-17 "可以做一下"). Keyed by the proc's MARKER
 * aura — the internal-cooldown buff the game applies to the owner the instant
 * the talent fires — with the spell(s) the proc casts, so those casts can be
 * subtracted from the owner's own presses. Only talents whose marker is
 * actually observed in the archive as a self-applied low-HP trigger are
 * listed (crisisProcMarkerProbe.ts, 1/40 archive, 2026-09-17):
 *  - Well-Honed Instincts 382912: 1,039 applications, 1,039 self-sourced,
 *    985 at ≤ 49 % [STATE] HP (364 at ≤ 40 %, 621 in 40–49 % — the 1 s grid
 *    reads the crossing late). The proc's Frenzied Regeneration is almost
 *    never logged as a SPELL_CAST_SUCCESS (25 within 1 s, 92 within 3 s,
 *    922 none) — only its heal events carry 22842, which is why the trigger
 *    id is subtracted from the HEAL side too, not just the cast side.
 *  - Dream Guide 1278914 is NOT a proc marker: 153 applications, only 22
 *    self-sourced, 88 at ≥ 80 % HP — it is the buff the talent hands out,
 *    so it is deliberately absent.
 *  - Guided Prayer 404357 and Last Resort 209258 have no observable sibling
 *    id at all. An undetectable proc must not be guessed from a cast
 *    (BACKLOG #43 待做 1: "逐个用日志核实,不要猜").
 * Registered in curatedIdRegistry.
 */
export interface CrisisProcAnswer {
  name: string;
  /** `proc` = a low-HP auto-protection (heals / shields / reduces on its
   * own); `cheatDeath` = a lethal hit was converted into survival — the
   * crisis went all the way to the death line, so the phrasing differs
   * ("X saved you from a killing blow") */
  kind: "proc" | "cheatDeath";
  /** how the marker shows in the log: an aura APPLIED self→self, or a heal
   * event self→self carrying the marker id */
  via: "aura" | "heal";
  /** spells the proc casts / heals with, subtracted from the owner's presses */
  triggers: ReadonlySet<string>;
}
// Second probe run 2026-09-17 (user: 「好 可以 看看效果」), 1/40 archive =
// 2,993 rounds, every candidate sibling id of every automatic protection
// talent; the bar is self-sourced ≈ 100 % AND low HP at the instant (the
// [STATE] grid reads the SAME second, so an instant heal shows post-heal HP):
//   Blood Draw 454871       aura 318/318 self, 317 ≤ 40 %          → proc
//   Nature's Guardian 31616 heal 771/771 self (40 % instant heal, HP read
//                           after it: 193 in the 30s, 165/176 in 50s/60s) → proc
//   Veteran Vitality 441387 aura 55 + heal 165, 220/220 self, 189 ≤ 50 %   → proc
//   Golden Val'kyr 393108   aura 6/6 self, 6 ≤ 40 % (Prot only, 2 units)   → proc
//   Cauterize 87023         aura 251/251 self, 244 ≤ 40 % (HP set to 35 %) → cheatDeath
//   Cheat Death 45182       aura 25/25 self, 23 in the 0s bucket (7 % HP)  → cheatDeath
// Rejected: Defy Fate (8 events, 1 unit, heals allies too), Purgatory (1),
// Last Resort 209261 (0), Battle-Scarred Veteran (0), Elixir of Determination
// (2), Whirling Steel (15, only 2 ≤ 40 %), Dream Guide (hand-out buff),
// Guided Prayer (no sibling id).
export const CRISIS_PROC_ANSWERS: ReadonlyMap<string, CrisisProcAnswer> =
  new Map<string, CrisisProcAnswer>([
    // Well-Honed Instincts (Druid class talent, ~100 % pick): below 40 % HP,
    // casts Frenzied Regeneration 22842 once per 120 s; 382912 = the 120 s marker.
    [
      "382912",
      {
        name: "Well-Honed Instincts",
        kind: "proc",
        via: "aura",
        triggers: new Set(["22842"]),
      },
    ],
    // Blood Draw (DK class, 96 %): below 30 % drains nearby enemies (heal id
    // 374606) and takes 10 % less damage for 8 s; 454871 = the buff.
    [
      "454871",
      {
        name: "Blood Draw",
        kind: "proc",
        via: "aura",
        triggers: new Set(["374606"]),
      },
    ],
    // Nature's Guardian (Shaman class, 100 %): below 35 % heals 40 % max HP
    // instantly; the heal event itself (31616) is the only trace.
    [
      "31616",
      {
        name: "Nature's Guardian",
        kind: "proc",
        via: "heal",
        triggers: new Set(["31616"]),
      },
    ],
    // Veteran Vitality (Warrior hero, 7 %): at 35 % heals 12 % over 2 s.
    [
      "441387",
      {
        name: "Veteran Vitality",
        kind: "proc",
        via: "aura",
        triggers: new Set(["441387"]),
      },
    ],
    // Gift of the Golden Val'kyr (Prot Paladin, 97 %): below 30 % grants
    // Guardian of Ancient Kings for 4 s (393879 = the guardian aura).
    [
      "393108",
      {
        name: "Gift of the Golden Val'kyr",
        kind: "proc",
        via: "aura",
        triggers: new Set(["393879"]),
      },
    ],
    // Cauterize (Mage, 100 %): a killing blow leaves the mage at 35 % and
    // burning 28 % over 6 s; 87023 = the burn, 108843 = the speed buff.
    [
      "87023",
      {
        name: "Cauterize",
        kind: "cheatDeath",
        via: "aura",
        triggers: new Set(["87023", "108843"]),
      },
    ],
    // Cheat Death (Rogue, 5 %): a killing blow leaves the rogue at 7 % with
    // 85 % damage reduction for 3 s; 45182 = that reduction.
    [
      "45182",
      {
        name: "Cheat Death",
        kind: "cheatDeath",
        via: "aura",
        triggers: new Set(["45182"]),
      },
    ],
  ]);
/** a triggered cast this close to the marker application belongs to the proc */
export const CRISIS_PROC_TRIGGER_TOL_MS = 1500;

/** The three id sets above, exported under crisis-prefixed names for
 * `analysis/teammateCrisis.ts` (GH #95, 2026-09-17): a healer's answer TOWARD a
 * teammate is judged against the same external / control / enemy-burst sets
 * the teammate's own crossing was judged with. */
export const CRISIS_EXTERNAL_IDS: ReadonlySet<string> = EXTERNAL_IDS;
export const CRISIS_CONTROL_IDS: ReadonlySet<string> = CONTROL_IDS;
export const CRISIS_OFFENSIVE_CD_IDS: ReadonlySet<string> = OFFENSIVE_CD_IDS;

export function actionBlockedAt(
  unit: any,
  combat: any,
  tMs: number,
): { inCC: boolean; lockedOut: boolean; dead: boolean; blocked: boolean } {
  const cc = buildFilteredAuraIntervals(unit, ccSpellIds, combat);
  const silence = buildFilteredAuraIntervals(unit, SILENCE_IDS, combat);
  const inCC = cc.some((i) => i.startMs <= tMs && i.endMs >= tMs);
  const interrupted = ((unit?.actionIn ?? []) as any[])
    .filter((a) => a.logLine?.event === LogEvent.SPELL_INTERRUPT)
    .some(
      (a) =>
        (a.timestamp as number) >= tMs - LOCKOUT_LOOKBACK_MS &&
        (a.timestamp as number) <= tMs,
    );
  const lockedOut =
    interrupted || silence.some((i) => i.startMs <= tMs && i.endMs >= tMs);
  const dead = ((unit?.deathRecords ?? []) as any[]).some(
    (d) => (d.timestamp as number) <= tMs,
  );
  return { inCC, lockedOut, dead, blocked: inCC || lockedOut || dead };
}

export function crisisDecisionPoints(
  owner: any,
  combat: any,
  role: CrisisRole = "healer",
): DecisionPoint[] {
  const start: number = combat?.startTime ?? 0;
  const samples = samplesOf(owner);
  if (samples.length < 2) return [];

  const crossings: Sample[] = [];
  let last = -Infinity;
  for (let i = 1; i < samples.length; i++) {
    const p = samples[i - 1]!,
      c = samples[i]!;
    if (p.hp > CRISIS_HP_PCT && c.hp <= CRISIS_HP_PCT && c.hp > 0) {
      if (c.t - last > CRISIS_WINDOW_GAP_MS) crossings.push(c);
      last = c.t;
    }
  }
  if (!crossings.length) return [];

  const units: any[] = Object.values(combat?.units ?? {});
  const players = units.filter((u) => u.info);
  const friendIds = new Set(
    players.filter((u) => u.reaction === owner.reaction).map((u) => u.id),
  );
  // Spec §1c: Solo Shuffle's outcome cells count ANY friendly death, owner
  // included — so this collects deathRecords across every friendly player,
  // not just the owner's own (which `deaths` below still does, for
  // diedInWindow / diedWithin10s).
  const friendDeaths: number[] = [];
  for (const u of players) {
    if (!friendIds.has(u.id)) continue;
    for (const d of (u.deathRecords ?? []) as any[]) {
      friendDeaths.push(d.timestamp as number);
    }
  }
  const unitById = new Map(units.map((u) => [u.id, u]));

  const dmgIn = ((owner.damageIn ?? []) as any[]).map((d) => ({
    t: d.timestamp,
    src: d.srcUnitId,
    a: Math.abs(d.effectiveAmount ?? d.amount ?? 0),
    school: Number.parseInt(String(d.spellSchoolId ?? "0x0"), 16) || 0,
  }));
  const healIn = ((owner.healIn ?? []) as any[]).map((h) => ({
    t: h.timestamp,
    src: h.srcUnitId,
    id: String(h.spellId ?? ""),
    a: Math.abs(h.effectiveAmount ?? h.amount ?? 0),
  }));
  const ownerCasts = ((owner.spellCastEvents ?? []) as any[]).map((c) => ({
    t: c.timestamp,
    id: String(c.spellId ?? ""),
    dest: c.destUnitId,
  }));
  const deaths = ((owner.deathRecords ?? []) as any[]).map(
    (d) => d.timestamp as number,
  );
  const interruptsOnOwner = ((owner.actionIn ?? []) as any[])
    .filter((a) => a.logLine?.event === LogEvent.SPELL_INTERRUPT)
    .map((a) => a.timestamp as number);

  // enemy hard-CC and silence intervals on the owner. I2 (2026-08-29): pairing
  // lives only in auraIntervals.ts's buildAuraIntervals (CLAUDE.md
  // shared-predicate rule) — it handles APPLIED_DOSE, SPELL_AURA_BROKEN,
  // orphan REMOVED (aura already up at round start, backdated by official
  // duration), and the official-duration cap for an aura that never closes,
  // none of which the old hand-rolled APPLIED/REMOVED pairing here did.
  // buildFilteredAuraIntervals (utils/utils.ts) is the ms-shaped thin adapter
  // over it, already used by candidateFindings.ts's burst-ledger path.
  const cc = buildFilteredAuraIntervals(owner, ccSpellIds, combat);
  const silence = buildFilteredAuraIntervals(owner, SILENCE_IDS, combat);

  // Gate 3 for a DPS owner (spec §1d, GH #59): rooted intervals + the
  // owner's Defensive-wall / Control-CD ledger, both computed once for the
  // whole round (not per-crossing) the same way `cc`/`silence` are above.
  // Skipped entirely for a healer owner — gate 3 is trivially true there.
  let rootIntervals: Array<{ startMs: number; endMs: number }> = [];
  let wallCds: IMajorCooldownInfo[] = [];
  let controlCds: IMajorCooldownInfo[] = [];
  if (role === "dps") {
    // the one root predicate (`rootIntervalsOf`, shared with [ROOT] and the
    // kick run budget), converted the way buildFilteredAuraIntervals converts
    rootIntervals = rootIntervalsOf(owner as never, combat).map((iv) => ({
      startMs: combat.startTime + iv.fromS * 1000,
      endMs: combat.startTime + iv.toS * 1000,
    }));
    let cds: IMajorCooldownInfo[] = [];
    try {
      cds = extractMajorCooldowns(owner, combat);
    } catch {
      // kit not resolvable (e.g. unknown class/spec) → both stay empty,
      // hasTool then reduces to `!rooted`.
      cds = [];
    }
    wallCds = cds.filter(
      (cd) =>
        cd.tag === "Defensive" &&
        !cd.isThroughput &&
        !cdIsProcOnly(cd) &&
        PERSONAL_WALL_IDS.has(cd.spellId),
    );
    controlCds = cds.filter((cd) => cd.tag === "Control");
  }

  const enemyBurstCasts: number[] = [];
  const friendControlCasts: { t: number; dest: string }[] = [];
  for (const u of players) {
    for (const c of (u.spellCastEvents ?? []) as any[]) {
      const sid = String(c.spellId ?? "");
      if (!friendIds.has(u.id) && isEnemyCdWindowSpell(sid))
        enemyBurstCasts.push(c.timestamp);
      if (friendIds.has(u.id) && u.id !== owner.id && CONTROL_IDS.has(sid))
        friendControlCasts.push({ t: c.timestamp, dest: c.destUnitId });
    }
  }

  // BACKLOG #43: proc marker auras applied to the owner (self-sourced)
  const procMarkers: Array<CrisisProcAnswer & { t: number }> = [];
  for (const a of (owner.auraEvents ?? []) as any[]) {
    const def = CRISIS_PROC_ANSWERS.get(String(a.spellId ?? ""));
    if (
      def?.via === "aura" &&
      a.logLine?.event === LogEvent.SPELL_AURA_APPLIED &&
      a.destUnitId === owner.id &&
      a.srcUnitId === owner.id
    )
      procMarkers.push({ t: a.timestamp as number, ...def });
  }
  for (const h of (owner.healIn ?? []) as any[]) {
    const def = CRISIS_PROC_ANSWERS.get(String(h.spellId ?? ""));
    if (def?.via === "heal" && h.srcUnitId === owner.id)
      procMarkers.push({ t: h.timestamp as number, ...def });
  }

  const out: DecisionPoint[] = [];
  const emittedSeconds = new Set<number>();
  for (const x of crossings) {
    // Render-grid discipline (CLAUDE.md): everything below — the response
    // window, the 2s damage window, the CC/lockout tests, the position
    // samples, `tSec` for cooldown readiness — is anchored at the SECOND the
    // prompt will display, not at the raw advancedAction timestamp, so the
    // rendered `hpPct` is by construction the number the same-second [STATE]
    // tick prints.
    const anchor = anchorToRenderGrid(owner, start, x.t);
    // No grid second in reach still reads <= CRISIS_HP_PCT → the rendered
    // prompt cannot support this crisis; drop it rather than cite an HP no
    // [STATE] line agrees with.
    if (!anchor) continue;
    // Two raw crossings >CRISIS_WINDOW_GAP_MS apart can still land on one
    // grid second; keep the first, the merge rule's intent.
    if (emittedSeconds.has(anchor.tSec)) continue;
    emittedSeconds.add(anchor.tSec);
    const t = anchor.tMs;
    const w0 = t - RESPONSE_PRE_MS,
      w1 = t + RESPONSE_WINDOW_MS;
    const inWin = (tt: number) => tt >= w0 && tt <= w1;
    const recent = dmgIn.filter((d) => d.t > t - DMG_WINDOW_MS && d.t <= t);
    const attackers = new Set(
      recent
        .map((d) => resolveAttackerId(d.src, unitById))
        .filter((id): id is string => id != null),
    );
    const dmg2s = recent.reduce((n, d) => n + d.a, 0) / x.max;
    // Round before comparing against the floor — the rounded value is what
    // gets rendered (facts.dmg2sPct), so `dangerous` must agree with it.
    const dmg2sRounded = Math.round(dmg2s * 100) / 100;
    const dangerous = dmg2sRounded >= CRISIS_MIN_DMG2S;
    // BACKLOG #43: a proc that fired in the window, and the cast(s) it made —
    // those casts are the proc's, not the owner's press
    const procsIn = procMarkers.filter((m) => inWin(m.t));
    const procTriggered = (c: { t: number; id: string }) =>
      procsIn.some(
        (m) =>
          m.triggers.has(c.id) &&
          Math.abs(c.t - m.t) <= CRISIS_PROC_TRIGGER_TOL_MS,
      );
    const castsIn = ownerCasts.filter((c) => inWin(c.t) && !procTriggered(c));
    const ownHealInWin = healIn.filter(
      (h) => h.t > t && h.t <= w1 && h.src === owner.id,
    );
    const procHealIds = new Set(procsIn.flatMap((m) => [...m.triggers]));
    const selfHeal = ownHealInWin.reduce((n, h) => n + h.a, 0) / x.max;
    // healing the proc produced is neither a press nor a carried HoT
    const selfHealOwn =
      ownHealInWin
        .filter((h) => !procHealIds.has(h.id))
        .reduce((n, h) => n + h.a, 0) / x.max;
    // GH #93: only heals from spells the owner cast inside the window are a
    // press; the rest was already ticking
    const castIdsInWin = new Set(castsIn.map((c) => c.id));
    const selfHealFresh =
      ownHealInWin
        .filter((h) => castIdsInWin.has(h.id) && !procHealIds.has(h.id))
        .reduce((n, h) => n + h.a, 0) / x.max;

    // one kite predicate, shared with burstWindowDecisionPoints (see kitedAway)
    const attackerUnits = [...attackers].map((id) => unitById.get(id));
    const kiteGain = kitedAway(owner, attackerUnits, t, w1);
    const kiteWho = kiteGain
      ? kiteAttribution(owner, attackerUnits, t, w1)
      : null;
    // GH #93: attacker-explained only when the attackers' own movement opens
    // the gain and the owner's does not; unknown or mixed stays "kite"
    const attackerMoved =
      !!kiteWho &&
      kiteWho.ownerGain < KITE_GAIN_YARDS &&
      kiteWho.attackerGain >= KITE_GAIN_YARDS;
    const kite = kiteGain && !attackerMoved;

    // User ruling 2026-09-14: a break or mobility press inside the window gets
    // its own RESPONSE_WINDOW_MS to pay off (see CRISIS_MOBILITY_PRESS_IDS).
    const credited = (c: { id: string; dest?: string }) => ({
      wall: PERSONAL_WALL_IDS.has(c.id),
      protective: CRISIS_PROTECTIVE_ANSWER_IDS.has(c.id),
      external: EXTERNAL_IDS.has(c.id),
      control: CONTROL_IDS.has(c.id) && !!c.dest && !friendIds.has(c.dest),
    });
    const followUp = {
      selfHeal: false,
      wall: false,
      protective: false,
      external: false,
      control: false,
      kite: false,
    };
    for (const press of castsIn) {
      const p1 = press.t + RESPONSE_WINDOW_MS;
      if (CRISIS_BREAK_PRESS_IDS.has(press.id)) {
        for (const c of ownerCasts) {
          if (c.t <= press.t || c.t > p1) continue;
          const k = credited(c);
          followUp.wall ||= k.wall;
          followUp.protective ||= k.protective;
          followUp.external ||= k.external;
          followUp.control ||= k.control;
        }
        const heal =
          healIn
            .filter((h) => h.t > press.t && h.t <= p1 && h.src === owner.id)
            .reduce((n, h) => n + h.a, 0) / x.max;
        followUp.selfHeal ||= heal >= SELF_HEAL_BIG;
      }
      if (
        CRISIS_MOBILITY_PRESS_IDS.has(press.id) &&
        !(press.id === "1044" && press.dest && press.dest !== owner.id)
      )
        followUp.kite ||= kitedAway(
          owner,
          [...attackers].map((id) => unitById.get(id)),
          press.t,
          p1,
        );
    }

    const freshSelfHeal = selfHealFresh >= SELF_HEAL_BIG || followUp.selfHeal;
    const responses: DecisionPointResponses = {
      selfHeal: freshSelfHeal,
      carriedHeal: !freshSelfHeal && selfHealOwn >= SELF_HEAL_BIG,
      proc: procsIn.some((m) => m.kind === "proc"),
      cheatDeath: procsIn.some((m) => m.kind === "cheatDeath"),
      attackerMoved: attackerMoved && !followUp.kite,
      wall: castsIn.some((c) => PERSONAL_WALL_IDS.has(c.id)) || followUp.wall,
      protective:
        castsIn.some((c) => CRISIS_PROTECTIVE_ANSWER_IDS.has(c.id)) ||
        followUp.protective,
      external:
        castsIn.some((c) => EXTERNAL_IDS.has(c.id)) || followUp.external,
      control:
        castsIn.some(
          (c) => CONTROL_IDS.has(c.id) && c.dest && !friendIds.has(c.dest),
        ) || followUp.control,
      peel: friendControlCasts.some((c) => inWin(c.t) && attackers.has(c.dest)),
      kite: kite || followUp.kite,
    };
    const inCC = cc.some((i) => i.startMs <= t && i.endMs >= t);
    const lockedOut =
      interruptsOnOwner.some(
        (it) => it >= t - LOCKOUT_LOOKBACK_MS && it <= t,
      ) || silence.some((i) => i.startMs <= t && i.endMs >= t);
    const diedInWindow = deaths.some((d) => d >= t && d < w1);
    // Table-only outcome (spec §1b): a death strictly after t, within
    // DEATH_LOOKAHEAD_MS. `(t, t+10000]` — t itself is excluded (that's
    // diedInWindow's job at a shorter horizon), the far edge is inclusive.
    const diedWithin10s = deaths.some(
      (d) => d > t && d <= t + DEATH_LOOKAHEAD_MS,
    );
    // Table-only outcome (spec §1c): same (t, t+…] shape as diedWithin10s,
    // wider horizon, and across every friendly player instead of just the
    // owner.
    const friendDiedWithin15s = friendDeaths.some(
      (d) => d > t && d <= t + TEAM_DEATH_LOOKAHEAD_MS,
    );
    const responded =
      responses.selfHeal ||
      responses.carriedHeal ||
      responses.attackerMoved ||
      responses.wall ||
      responses.protective ||
      responses.external ||
      responses.control ||
      responses.kite ||
      responses.proc ||
      responses.cheatDeath;
    const tSec = anchor.tSec;
    // Gate 3 (spec §1d): trivially true for a healer (self-heal is always a
    // tool). For a DPS owner, `!rooted` alone already satisfies it — being
    // free to move/act is a tool — so `rooted` only matters when a wall or a
    // Control CD could substitute for mobility.
    let hasTool = true;
    if (role === "dps") {
      const rooted = rootIntervals.some((i) => i.startMs <= t && i.endMs >= t);
      // Reaction window (REACTION_WINDOW_S, user ruling 2026-09-23; codex
      // astra GH #103 follow-up: "has a tool" is an instant actionable
      // judgement, not a state): a wall back within 1 s is not a tool.
      const wallReady = wallCds.some((cd) => cdReadyInTimeAt(cd, tSec));
      const controlReady = controlCds.some((cd) => cdReadyInTimeAt(cd, tSec));
      hasTool = !rooted || wallReady || controlReady;
    }
    out.push({
      tMs: t,
      tSec,
      hpPct: anchor.hpPct,
      dmg2s: dmg2sRounded,
      dmg2sBySchool: recent.reduce<Record<string, number>>((m, d) => {
        m[String(d.school)] = (m[String(d.school)] ?? 0) + d.a;
        return m;
      }, {}),
      attackers2s: attackers.size,
      enemyBurst: enemyBurstCasts.some(
        (b) => b > t - ENEMY_BURST_LOOKBACK_MS && b <= t,
      ),
      inCC,
      lockedOut,
      diedInWindow,
      dangerous,
      diedWithin10s,
      friendDiedWithin15s,
      responses,
      responded,
      procNames: [...new Set(procsIn.map((m) => m.name))],
      selfHealPct: Math.round(selfHeal * 100),
      hasTool,
      feasible: !inCC && !lockedOut && !diedInWindow && hasTool,
    });
  }
  return out;
}

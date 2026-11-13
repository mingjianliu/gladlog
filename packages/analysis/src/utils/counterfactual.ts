import { CombatUnitType, ICombatUnit } from "@gladlog/parser-compat";

import { castKeyOfAura, castsOfEffectAura } from "../data/castEffectAuras";
import {
  componentForSchool,
  type IResolvedMitigationComponent,
  isUnheldMechanic,
  resolveMitigation,
} from "../data/mitigationComponents";
import { DEFLECTION_IDS } from "../data/mitigationData";
import { OWN_SHIELD_RULING_FAMILY_IDS } from "../data/ownShieldLinks";
import { getEnglishSpellName } from "../data/spellEffectData";
import spellIdLists from "../data/spellIdLists";
import { absorbContributionsInWindow } from "./absorbShields";
import { getSortedAdvancedActions } from "./advancedActions";
import {
  ALIAS_PRESS_TWIN_MS,
  buildAuraIntervals,
  IAuraInterval,
} from "./auraIntervals";
import { binarySearchClosest } from "./binarySearch";
import { isCasterSideLinkAura } from "./brokenRowBreaker";
import { buffFullDurationForCaster } from "./buffDuration";
import { IPlayerCCTrinketSummary } from "./ccTrinketAnalysis";
import { lockoutDebuffStopsPressAtDeath } from "./cooldowns";
import {
  CD_INSTANT_SLACK_S,
  cdAvailableAt,
  cdReadyInTimeAt,
  HP_SAMPLE_RADIUS_MS,
  IMajorCooldownInfo,
} from "./cooldowns";
import {
  COUNTERFACTUAL_WINDOW_S,
  IMissedExternal,
  offCooldownForLastSecondsBy,
  wasLockedOutThroughWindow,
} from "./deathOutcomeAnalysis";
import { TIME_DILATION_ID, timeDilationPendingAt } from "./deferralShield";
import {
  DEFERRAL_SHIELD_DAMAGE_IDS,
  incomingPressureBySchool,
} from "./incomingPressure";

/**
 * counterfactual.ts — mitigation counterfactual accounting (#17b): the
 * single-source three-tier predicate plus the arithmetic of three shapes.
 *
 * Three independent measures, computed entry by entry, with no modelling of
 * stacking within the same window:
 *  - A (computeMitigationAudit): entry-by-entry accounting of whitelisted
 *    mitigation **already active** inside the death window — arith entries
 *    back out the blocked amount from the observed damage; immunity (pct=100)
 *    is never back-computed, it only reports coverage duration and the damage
 *    observed during it; off-table entries (not in the mitigation table: shields,
 *    dodges, heals, transfers, reflects …) get no invented numbers; positional (Darkness) is not modelled this round and
 *    is skipped without emitting a row.
 *  - B (computeMissedExternalCounterfactuals): a teammate external that was
 *    **available but not given**, on the discount measure (saved = damage of
 *    matching schools in the window × pct%), reported only when "clearly would
 *    have survived".
 *  - Narrow gate (computeUnusedSelfCounterfactuals): the player's own
 *    available-but-unused cooldown, same discount measure, silent for the whole
 *    window when CC-locked; reported only when "clearly would have survived".
 *
 * Single-source predicate discipline (gate predicates are the spec): HP
 * sampling always reuses `HP_SAMPLE_RADIUS_MS` (the single-source constant in
 * cooldowns.ts), the whitelist is always derived from `spellIdLists`, and the
 * mitigation table is always consumed from `MITIGATION_TABLE` — this file must
 * not redefine any existing constant or table.
 */

export { COUNTERFACTUAL_WINDOW_S };
/** Margin above the decisive line: 15% of maxHp. */
export const DECISIVE_MARGIN_PCT = 15;
/** Lower bound of the marginal tier: 0.5 × net HP lost. */
export const MARGINAL_FLOOR_RATIO = 0.5;

export type CounterfactualTier = "decisive" | "marginal" | "fatal";

/**
 * Single-source three-tier predicate (same measure as the quantified report).
 * savedAmount/netDamage/maxHp share one unit (absolute HP values).
 *   decisive: savedAmount > netDamage + DECISIVE_MARGIN_PCT% × maxHp
 *   marginal: savedAmount ∈ (MARGINAL_FLOOR_RATIO × netDamage, decisive line]
 *   fatal:    everything else
 */
export function counterfactualTier(
  savedAmount: number,
  netDamage: number,
  maxHp: number,
): CounterfactualTier {
  const decisiveLine = netDamage + (DECISIVE_MARGIN_PCT / 100) * maxHp;
  if (savedAmount > decisiveLine) return "decisive";
  if (savedAmount > MARGINAL_FLOOR_RATIO * netDamage) return "marginal";
  return "fatal";
}

// Single-source whitelist derivation: big personals ∪ externals. Deliberately
// not externalOrBigDefensiveSpellIds — that list also contains team-buff ids
// (64843/740/200183, …) and serves the "who can double as a healer" judgement
// in cooldowns.ts, which is a different semantic from the mitigation
// counterfactual whitelist (walls that actually block damage or grant immunity).
const WHITELIST_IDS: ReadonlySet<string> = new Set<string>([
  ...spellIdLists.bigDefensiveSpellIds,
  ...spellIdLists.externalDefensiveSpellIds,
  // Attribution-only mitigation (stances, ally-maintained buffs) — see the
  // list's own comment for why it is separate from the other two.
  ...spellIdLists.attributedMitigationSpellIds,
  // …and the whole DB2 family of the pressed shield that list names (Power
  // Word: Shield 17): the Holy Priest's proc shield 1246768 (no cast row,
  // GH #202 item 1), Void Shield 1253593 and Unfolding Vision's copies are
  // the same shield under another id (`OWN_SHIELD_RULING_FAMILY_IDS`, DB2
  // class mask). Keyed on 17 alone, a death under one of them printed no
  // audit row (T60).
  ...OWN_SHIELD_RULING_FAMILY_IDS,
]);
/** The whitelist key an aura on the victim stands for — its own id or the
 * cast whose own effect it is (fact2 C10, `castKeyOfAura`): Rallying Cry
 * 97462 runs as 97463, Fortifying Brew 115203 as 120954, Blur 198589 as
 * 212800 — rows the audit never wrote. Priced by the key. */
const whitelistKeyOf = (auraSpellId: string): string | undefined =>
  castKeyOfAura(auraSpellId, (id) => WHITELIST_IDS.has(id));

/**
 * Direct absolute-HP sampling: `getUnitHpAtTimestamp` returns a percentage and
 * the counterfactual arithmetic needs absolute values, so it cannot be reused —
 * but the sampling logic (nearest advancedAction, source validation, radius
 * gate) is identical to it, and the sampling radius reuses the very same
 * `HP_SAMPLE_RADIUS_MS`; no second radius constant is invented.
 */
function absHpAt(
  unit: ICombatUnit,
  tMs: number,
): { hp: number; maxHp: number } | null {
  const closest = binarySearchClosest(
    getSortedAdvancedActions(unit),
    tMs,
    (a) => a.logLine.timestamp,
  );
  if (!closest) return null;
  if (closest.advancedActorId !== unit.id) return null;
  if (closest.advancedActorMaxHp <= 0) return null;
  if (Math.abs(closest.logLine.timestamp - tMs) > HP_SAMPLE_RADIUS_MS) {
    return null;
  }
  return {
    hp: closest.advancedActorCurrentHp,
    maxHp: closest.advancedActorMaxHp,
  };
}

/**
 * Single source for net HP lost / max HP: the absolute HP at the window start
 * IS the net HP lost (HP → 0 at death, and healing is already netted into the
 * HP curve, so no separate healing subtraction — same measure as the quantified
 * report); maxHp is sampled at the death instant, falling back to the window
 * start sample (both missing → null, and rows/hits each take the "omit rather
 * than guess" path instead of extrapolating a number). All three shapes (A / B /
 * narrow gate) share this one computation, so all three read the same net HP
 * lost / max HP for the same death.
 */
function windowNetDamageAndMaxHp(
  victim: ICombatUnit,
  matchStartMs: number,
  deathS: number,
): { netDamage: number | null; maxHp: number | null } {
  const windowStartMs = matchStartMs + windowStartSecondsOf(deathS) * 1000;
  const deathMs = matchStartMs + deathS * 1000;
  const startSample = absHpAt(victim, windowStartMs);
  const deathSample = absHpAt(victim, deathMs);
  return {
    netDamage: startSample ? startSample.hp : null,
    maxHp: deathSample
      ? deathSample.maxHp
      : startSample
        ? startSample.maxHp
        : null,
  };
}

/**
 * Total damage that reached the unit in the window, matching schoolMask: what
 * landed plus what its shields then ate (`incomingPressureBySchool`). A
 * percentage comes off a hit before any absorb, so landed alone priced a wall
 * on what got past the shields too (fact7 D77, the `[STACKED DEFENSIVES]`
 * reading of the same arithmetic). The same reading for a real shield and a
 * deferral shield: the hit under its own school, at the time it was thrown.
 */
export function windowDamage(
  unit: ICombatUnit,
  fromS: number,
  toS: number,
  schoolMask: number,
  matchStartMs: number,
): number {
  const bySchool = incomingPressureBySchool(
    unit,
    matchStartMs + fromS * 1000,
    matchStartMs + toS * 1000,
  );
  let sum = 0;
  for (const [mask, amount] of Object.entries(bySchool))
    if ((Number(mask) & schoolMask) !== 0) sum += amount;
  return sum;
}

/** `windowDamage` of the hits `comp` prices — each hit once, by the one
 * component `componentForSchool` gives it (a hybrid hit into a split row is
 * no longer counted under both, codex review of batch B7). A one-component
 * row reads exactly `windowDamage(…, comp.schoolMask, …)`. */
function windowDamageOfComponent(
  unit: ICombatUnit,
  fromS: number,
  toS: number,
  res: NonNullable<ReturnType<typeof resolveMitigation>>,
  comp: IResolvedMitigationComponent,
  matchStartMs: number,
): number {
  const bySchool = incomingPressureBySchool(
    unit,
    matchStartMs + fromS * 1000,
    matchStartMs + toS * 1000,
  );
  let sum = 0;
  for (const [mask, amount] of Object.entries(bySchool))
    if (componentForSchool(res, Number(mask)) === comp) sum += amount;
  return sum;
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

/**
 * Death-window start (relative seconds), clamped to 0: early in a match
 * (deathS < WINDOW_S) `deathS - COUNTERFACTUAL_WINDOW_S` goes negative, and
 * without the clamp the HP sample target lands at least (WINDOW_S - deathS)
 * seconds before matchStartMs — beyond `HP_SAMPLE_RADIUS_MS` (3s) it is always
 * null, so early deaths silently lost all counterfactual output (found by an
 * agy flash review, 2026-07-30). All four window boundaries (the netDamage /
 * maxHp sampling plus the windowDamage call in each of the three functions)
 * must use this same clamped value — no per-site clamping.
 */
function windowStartSecondsOf(deathS: number): number {
  return Math.max(0, deathS - COUNTERFACTUAL_WINDOW_S);
}

export interface IMitigationAuditRow {
  spellId: string;
  spellName: string;
  /** `deflection` (fact9 D3, user ruling 2026-10-21): a deflection
   * (`DEFLECTION_IDS`, Aspect of the Turtle) is no immunity — damage over
   * time still lands; it carries the immunity's two damage fields. */
  kind:
    "arith" | "immunity" | "deflection" | "mechanic" | "absorb" | "deferred";
  /** Seconds of (active interval ∩ death window), one decimal. */
  activeOverlapS: number;
  /** kind=arith: blocked amount (absolute) and its share of maxHp. */
  blockedAmount?: number;
  blockedPctMaxHp?: number;
  /** kind=deferred: what a deferral shield (`DEFERRAL_SHIELD_DAMAGE_IDS`:
   * Time Dilation, Stretch Time) DELAYED inside the overlap — the log's own
   * SPELL_ABSORBED rows of that shield, a measured amount — and its share of
   * maxHp. It lands later as the unit's own damage. */
  deferredAmount?: number;
  deferredPctMaxHp?: number;
  /** kind=immunity: ALL damage taken during the immunity coverage (reported as-is). */
  damageTakenDuringImmunity?: number;
  /** kind=immunity: the part of it outside the immunity's schools (a physical
   * immunity under magic damage) — 0 for a full immunity. */
  damageOutsideImmunitySchool?: number;
  /** kind=absorb: damage the shield actually ate inside the window, i.e. the
   * effective HP it was worth. Measured from SPELL_ABSORBED, so a shield that
   * expired unconsumed contributes nothing — see absorbShields.ts. */
  absorbedAmount?: number;
  absorbedPctMaxHp?: number;
  /** The school mask this row prices, set on every component row of a SPLIT
   * entry (more than one component: Evasion with Elusiveness and Bait and
   * Switch — physical and magic; Cloak of Shadows with Bait and Switch — the
   * magic immunity and physical 20 %). Without it the components print as
   * same-named rows over the same seconds (pipeline T33, ruling R07 (5)).
   * Undefined on a one-component entry. */
  schoolMask?: number;
}

/** A whitelisted aura interval clipped to the death window (both ends in
 * relative seconds; `overlapTo > overlapFrom` is guaranteed). */
export interface IWindowedAuraInterval extends IAuraInterval {
  overlapFrom: number;
  overlapTo: number;
}

/**
 * The one predicate for "which whitelisted mitigation auras were active on
 * the victim inside the death window": shape A iterates exactly this list, and
 * `packages/eval/scripts/mitigationStackScan.ts` (BACKLOG #41 (6) — does the
 * un-modelled stacking between entries matter?) measures overlap on the same
 * list, so the probe can never disagree with the product about which auras
 * count.
 */
export function whitelistedIntervalsInDeathWindow(
  victim: ICombatUnit,
  combat: {
    startTime: number;
    endTime: number;
    units?: Record<string, ICombatUnit>;
  },
  deathS: number,
  /** The death's real instant, when the caller has it: the active overlap is
   *  a duration and runs to the death itself, like the [DEATH] block's "Top
   *  damage in final 10s" (work order 2026-10-14c #2: 9c9d8601's Pain
   *  Suppression up 3.24 s before the death printed 2.4 s — the window
   *  stopped at the floored second). The HP / net-damage readings stay on
   *  the render grid (`deathS`). */
  deathInstantS: number = deathS,
): IWindowedAuraInterval[] {
  const windowStartS = windowStartSecondsOf(deathInstantS);
  const out: IWindowedAuraInterval[] = [];
  // 白名单里的减伤绝大多数是**自施**(树皮术、洞察之眼…),所以受害者自己就是
  // 施法者 —— 不用改签名就能让天赋加长的时长参与封顶(auraIntervals:11% 的上身
  // 等不到 REMOVED)。外置减伤(守护之魂等)的施法者不在这里,按无施法者取值,
  // 即接线前的行为。
  const selfCaster = new Map([[victim.id, victim]]);
  // Work order 2026-10-14d #3: an aura the OTHER side put on the victim is
  // not the victim's mitigation — an enemy Windwalker's Touch of Karma
  // tether (122470, a DEBUFF on our mage) read as "Touch of Karma active
  // 9.0s in the final 10s" (b711d4ac 4:33). Same reading as the burst
  // ledger's target defensives (`burstLedger.ts`: by the aura's source name).
  // Players on both sides, and never a name the victim's side also has
  // (agy 40-FT-90: a pet's bare name could equal a player's; 40-FT-91: so
  // the own side is its PLAYERS too, or a same-named own pet would let the
  // enemy player's aura back in): a player's name is realm-qualified
  const units = Object.values(combat.units ?? {});
  const ownSide = new Set(
    units
      .filter(
        (u) =>
          u.reaction === victim.reaction && u.type === CombatUnitType.Player,
      )
      .map((u) => u.name),
  );
  ownSide.add(victim.name);
  const opposing = new Set(
    units
      .filter(
        (u) =>
          u.reaction !== victim.reaction &&
          u.type === CombatUnitType.Player &&
          !ownSide.has(u.name),
      )
      .map((u) => u.name),
  );
  for (const iv of buildAuraIntervals(victim, combat, selfCaster)) {
    if (whitelistKeyOf(iv.spellId) === undefined) continue;
    if (opposing.has(iv.srcUnitName)) continue;
    // fact2 C4 (2026-10-20): a damage-transfer external's link on its own
    // caster moves damage ONTO the victim — no mitigation of theirs
    // (a5df6bff 2:45: the paladin's own Blessing of Sacrifice link listed in
    // his death's audit; `isCasterSideLinkAura`, the stacked-defensives rule)
    if (isCasterSideLinkAura(iv.spellId, iv.srcUnitName === victim.name))
      continue;
    const overlapFrom = Math.max(iv.fromS, windowStartS);
    const overlapTo = Math.min(iv.toS, deathInstantS);
    if (overlapTo <= overlapFrom) continue; // no overlap, emit no row
    out.push({ ...iv, overlapFrom, overlapTo });
  }
  return out;
}

/**
 * Shape A: entry-by-entry accounting of whitelisted mitigation active on the
 * victim inside the death window (independent measure; interaction between
 * multiple entries is not modelled).
 */
/** The round's unit with this name (players first), for talent attribution. */
function unitByName(
  units: Record<string, ICombatUnit> | undefined,
  name: string | undefined,
): ICombatUnit | undefined {
  if (!units || !name) return undefined;
  return Object.values(units).find((u) => u.name === name);
}

export function computeMitigationAudit(
  victim: ICombatUnit,
  combat: {
    startTime: number;
    endTime: number;
    units: Record<string, ICombatUnit>;
  },
  deathS: number,
  /** see `whitelistedIntervalsInDeathWindow` */
  deathInstantS: number = deathS,
): {
  rows: IMitigationAuditRow[];
  netDamage: number | null;
  maxHp: number | null;
} {
  const { netDamage, maxHp } = windowNetDamageAndMaxHp(
    victim,
    combat.startTime,
    deathS,
  );

  const rows: IMitigationAuditRow[] = [];
  /** the off-table rows (`mechanic`, `absorb` — one line form, "X active Ns
   * … (not in the mitigation table …)") and the interval each stands for */
  const offTableRows: Array<{
    row: IMitigationAuditRow;
    iv: IWindowedAuraInterval;
  }> = [];
  const intervals = whitelistedIntervalsInDeathWindow(
    victim,
    combat,
    deathS,
    deathInstantS,
  );

  for (const iv of intervals) {
    const { overlapFrom, overlapTo } = iv;
    const activeOverlapS = round1(overlapTo - overlapFrom);
    const spellName = getEnglishSpellName(iv.spellId, iv.spellName);
    // GH #96 M3a: every pricing goes through the component resolver; carrier =
    // an ally-applied Flameshaper Obsidian Scales is 15 %, the Evoker's own 30 %.
    const res = resolveMitigation(whitelistKeyOf(iv.spellId) ?? iv.spellId, {
      carrierIsCaster: iv.srcUnitName === victim.name,
      // the caster by name from the round's roster (talent impact audit
      // 2026-09-26: an ally-cast external was priced without its caster's
      // talents)
      caster:
        iv.srcUnitName === victim.name
          ? victim
          : unitByName(combat.units, iv.srcUnitName),
    });

    // A deferral shield is priced by what it held back — whether the
    // mitigation table prices it (Time Dilation, 50 %: user rulings
    // 2026-07-30, kept 2026-10-20 「我觉得都算」 — the row no longer says
    // "not prevented") or not (Stretch Time, which would otherwise be read as
    // an off-table ABSORB shield below; agy review of FT-T02b).
    // The back-computation would price it from damage that includes its own
    // delayed ticks; the log records what it delayed (FT-T02b, user ruling 2026-10-09; the table's
    // 50 % for Time Dilation still prices kill windows — ruling 2026-07-30).
    if (iv.spellId in DEFERRAL_SHIELD_DAMAGE_IDS) {
      const deferredAmount =
        absorbContributionsInWindow(
          victim,
          combat.startTime + overlapFrom * 1000,
          combat.startTime + overlapTo * 1000,
        ).find((c) => c.spellId === iv.spellId)?.absorbedAmount ?? 0;
      rows.push({
        spellId: iv.spellId,
        spellName,
        kind: "deferred",
        activeOverlapS,
        deferredAmount,
        deferredPctMaxHp:
          maxHp !== null && maxHp > 0
            ? round1((deferredAmount / maxHp) * 100)
            : undefined,
      });
      continue;
    }
    // a talent's whole reduction no claim can stand on (the caster lacks the
    // talent, or nobody knows), where the row says the aura is still the
    // off-table mechanic (Blessing of Sacrifice's transfer, GH #126 row
    // 170): the row it printed before the table had it
    const unheldMechanic = isUnheldMechanic(
      whitelistKeyOf(iv.spellId) ?? iv.spellId,
      res,
    );
    if (!res || unheldMechanic) {
      // Off-table (including NO_MITIGATION_IDS; the two are mutually
      // exclusive). Absorb shields are the one off-table class that CAN be
      // measured rather than guessed: the log records what each shield actually
      // ate. Everything else stays "mechanic" and invents no numbers.
      const absorbed = absorbContributionsInWindow(
        victim,
        combat.startTime + overlapFrom * 1000,
        combat.startTime + overlapTo * 1000,
      ).find((c) => c.spellId === iv.spellId);
      if (absorbed) {
        const row: IMitigationAuditRow = {
          spellId: iv.spellId,
          spellName,
          kind: "absorb",
          activeOverlapS,
          absorbedAmount: absorbed.absorbedAmount,
          absorbedPctMaxHp:
            maxHp !== null && maxHp > 0
              ? round1((absorbed.absorbedAmount / maxHp) * 100)
              : undefined,
        };
        rows.push(row);
        offTableRows.push({ row, iv });
        continue;
      }
      const row: IMitigationAuditRow = {
        spellId: iv.spellId,
        spellName,
        kind: "mechanic",
        activeOverlapS,
      };
      rows.push(row);
      offTableRows.push({ row, iv });
      continue;
    }
    if (res.positional) continue; // Darkness class: positional conditions are not modelled this round, skip without a row

    // a split entry labels each component row with the school it prices
    const split = res.components.length > 1;
    for (const [compIndex, comp] of res.components.entries()) {
      // Shape A backs ACTIVE mitigation out of what landed: observed × p / (1 − p).
      // M3a: one component per entry, so this loop runs once and is identical to
      // the table read; the lower bound is the conservative "blocked" claim.
      const pct = comp.pctMin;
      // a component worth 0 % on its lower bound blocked nothing the claim
      // can stand on — Fade without Translucent Image (GH #126 row 203: 0 %,
      // the talent's 10 points are its whole reduction) printed "blocked ~0k"
      if (comp.kind === "pct" && pct <= 0) continue;

      const observed = windowDamageOfComponent(
        victim,
        overlapFrom,
        overlapTo,
        res,
        comp,
        combat.startTime,
      );

      if (pct >= 100) {
        // Immunity: the divisor is zero — never back-compute; report the coverage
        // seconds and the damage observed during it, as-is.
        // Reliability round 3 N13 (eb80): a school-limited immunity (Blessing
        // of Protection) read "still took ~0k" while 115k off-school landed —
        // `observed` is the immunity's own schools only. Report all damage
        // taken during the coverage and how much of it was outside those
        // schools.
        const allSchools = windowDamage(
          victim,
          overlapFrom,
          overlapTo,
          0x7f,
          combat.startTime,
        );
        rows.push({
          spellId: iv.spellId,
          spellName,
          // fact9 D3: Turtle's 100 % row is a deflection, not an immunity
          // (066572a4 1:07: "Aspect of the Turtle immunity covered 3.0s …
          // dmg the immunity did not block" while its DoTs ticked)
          kind: DEFLECTION_IDS.has(iv.spellId) ? "deflection" : "immunity",
          activeOverlapS,
          damageTakenDuringImmunity: allSchools,
          damageOutsideImmunitySchool: Math.max(0, allSchools - observed),
          ...(split ? { schoolMask: comp.schoolMask } : {}),
        });
        continue;
      }

      const blockedAmount = Math.round((observed * pct) / (100 - pct));
      // A talent-added component on a school the window barely hit (Blessing of
      // Protection's magic 15 %, Cloak's physical 20 %) renders as "blocked ~0k"
      // — a line with no information. Skip it when it rounds to 0k on the
      // render grid (formatMitigationAuditLine's Math.round(/1000)); the entry's
      // own first component always keeps its row. GH #96, 2026-09-14.
      if (compIndex > 0 && Math.round(blockedAmount / 1000) === 0) continue;
      rows.push({
        spellId: iv.spellId,
        spellName,
        kind: "arith",
        activeOverlapS,
        blockedAmount,
        blockedPctMaxHp:
          maxHp !== null && maxHp > 0
            ? round1((blockedAmount / maxHp) * 100)
            : undefined,
        ...(split ? { schoolMask: comp.schoolMask } : {}),
      });
    }
  }

  // GH #201 (T59): one press that puts up its cast-id aura and its
  // own-effect aura is one defensive — the burst ledger's rule
  // (`dropOnePressAuraTwins`: same caster, starting within
  // `ALIAS_PRESS_TWIN_MS`, a cast and its effect). Touch of Karma's 122470
  // and 125174 printed two identical "active Ns … (not in the mitigation
  // table)" rows in one death block (605: 9 rows, 3 deaths). Only an
  // unmodelled `mechanic` row is dropped — it claims no number — and only
  // beside the off-table row of its own press's other aura, which prints
  // the same line: an `absorb` row stands (it carries the measured amount);
  // of two `mechanic` rows the cast's id stands. The longer overlap is kept.
  // A twin that is priced (a reduction, an immunity) keeps both rows.
  /** the spans (and their aura ids) an off-table row stands for: its own
   * interval, and those of the rows folded into it */
  const cover = new Map<
    IMitigationAuditRow,
    Array<{ spellId: string; from: number; to: number }>
  >();
  for (const { row, iv } of offTableRows)
    cover.set(row, [
      { spellId: iv.spellId, from: iv.overlapFrom, to: iv.overlapTo },
    ]);
  const coverOf = (row: IMitigationAuditRow) => cover.get(row) ?? [];
  const twinOf = (a: IWindowedAuraInterval, b: IWindowedAuraInterval) =>
    a !== b &&
    a.srcUnitName === b.srcUnitName &&
    Math.abs(a.fromS - b.fromS) * 1000 <= ALIAS_PRESS_TWIN_MS &&
    (castsOfEffectAura(a.spellId).includes(b.spellId) ||
      castsOfEffectAura(b.spellId).includes(a.spellId));
  for (const { row, iv } of offTableRows) {
    if (row.kind !== "mechanic" || !rows.includes(row)) continue;
    const other = offTableRows.find(
      (o) => rows.includes(o.row) && twinOf(iv, o.iv),
    );
    if (!other) continue;
    const dropThis =
      other.row.kind === "absorb" ||
      castsOfEffectAura(iv.spellId).includes(other.iv.spellId);
    const [keep, drop] = dropThis ? [other.row, row] : [row, other.row];
    keep.activeOverlapS = Math.max(keep.activeOverlapS, drop.activeOverlapS);
    // the row that stays stands for both auras' time (the T60 union below
    // reads it)
    coverOf(keep).push(...coverOf(drop));
    rows.splice(rows.indexOf(drop), 1);
  }

  // T60: an off-table aura that went up more than once inside the window is
  // one row — every off-table row prints the one form "X active Ns in the
  // final 10s", so two applications whose overlaps round alike printed the
  // same line twice (605: the Holy Priest's proc shield 1246768 on a dying
  // ally at 0.236 s and 0.228 s, two "Power Word: Shield active 0.2s" rows;
  // 9 rows, 3 deaths). The row that stays carries the time any of them was
  // up (the union of the overlaps, so two auras up together count once) and
  // the summed measured absorb. A cast aura and its own effect aura are
  // GH #201's pair above (one row per press of the two) and stay as it left
  // them.
  const castAndEffect = (a: string, b: string) =>
    castsOfEffectAura(a).includes(b) || castsOfEffectAura(b).includes(a);
  const offTableByName = new Map<string, typeof offTableRows>();
  for (const e of offTableRows) {
    if (!rows.includes(e.row)) continue;
    const g = offTableByName.get(e.row.spellName);
    if (g) g.push(e);
    else offTableByName.set(e.row.spellName, [e]);
  }
  for (const group of offTableByName.values()) {
    if (group.length < 2) continue;
    if (
      group.some((x) =>
        group.some((y) => castAndEffect(x.iv.spellId, y.iv.spellId)),
      )
    )
      continue;
    const keep = group[0]!.row;
    // every span the group's rows stand for — a row GH #201 folded a twin
    // into brings the twin's (codex 85-tk-H-T60-1 #2: two presses of
    // Rallying Cry, each kept at its longer twin's 3 s and 2 s, were
    // unioned over the two short cast auras alone)
    const covered = group.flatMap((e) => coverOf(e.row));
    const spans = covered
      .map((c) => [c.from, c.to] as [number, number])
      .sort((a, b) => a[0] - b[0]);
    let upS = 0;
    let end = -Infinity;
    for (const [from, to] of spans) {
      if (to <= end) continue;
      upS += to - Math.max(from, end);
      end = to;
    }
    keep.activeOverlapS = Math.max(keep.activeOverlapS, round1(upS));
    if (group.some((e) => e.row.kind === "absorb")) {
      // each absorbed row once: two casters' shields of one id up together
      // share the rows of that id (codex #1: one 50k row under two
      // overlapping intervals summed to 100k)
      let absorbed = 0;
      for (const ev of victim.absorbsIn ?? []) {
        const ts = ev.logLine?.timestamp;
        const amount = Math.abs(Number(ev.absorbedAmount) || 0);
        if (typeof ts !== "number" || amount <= 0) continue;
        // the bounds `absorbContributionsInWindow` reads a single row over
        if (
          covered.some(
            (c) =>
              c.spellId === ev.spellId &&
              ts >= combat.startTime + c.from * 1000 &&
              ts <= combat.startTime + c.to * 1000,
          )
        )
          absorbed += amount;
      }
      keep.kind = "absorb";
      keep.absorbedAmount = absorbed;
      keep.absorbedPctMaxHp =
        maxHp !== null && maxHp > 0
          ? round1((absorbed / maxHp) * 100)
          : undefined;
    }
    for (const e of group.slice(1)) rows.splice(rows.indexOf(e.row), 1);
  }

  return { rows, netDamage, maxHp };
}

/** Shape B / narrow gate arithmetic, per component: Σ observed(school) × pctMin. */
function savedByComponents(
  res: NonNullable<ReturnType<typeof resolveMitigation>>,
  victim: ICombatUnit,
  windowStartS: number,
  deathS: number,
  combat: { startTime: number },
): number {
  let saved = 0;
  for (const comp of res.components) {
    const observed = windowDamageOfComponent(
      victim,
      windowStartS,
      deathS,
      res,
      comp,
      combat.startTime,
    );
    saved += (observed * comp.pctMin) / 100;
  }
  return Math.round(saved);
}

/**
 * Time Dilation's hypothetical saving: what it would still hold back at the
 * death (`timeDilationPendingAt`), not the table's 50 % of the window — the
 * damage it defers comes back as the unit's own ticks from ~1 s after the
 * first hit it takes, most of it inside a 10 s window. One press the healer
 * could have made — when the window opens, or when the spell came off
 * cooldown if that was later (`pressS`; codex review: a press at the window's
 * start while it was still cooling down saved nobody), up for as long as its
 * caster's talents make it (`buffFullDurationForCaster`: 8 / 9.2 / 10.4 s by
 * Timeless Magic's rank) — not the best-timed one. A hit on the death's own
 * millisecond is covered, as `windowDamage` counts it. Every hit it
 * covers is deferred at the table's share (DB2 357170 #0, 50) of what the hit
 * took off the unit's health: the real shield takes half of the whole hit
 * before other shields eat theirs, so this reading defers less.
 */
function savedByTimeDilation(
  res: NonNullable<ReturnType<typeof resolveMitigation>>,
  victim: ICombatUnit,
  pressS: number,
  deathS: number,
  combat: { startTime: number },
  caster: ICombatUnit | undefined,
): number {
  const share =
    Math.min(100, Math.max(...res.components.map((c) => c.pctMin))) / 100;
  const durS = buffFullDurationForCaster(TIME_DILATION_ID, caster) ?? 0;
  const fromMs = combat.startTime + pressS * 1000;
  const expiresMs = fromMs + durS * 1000;
  const deathMs = combat.startTime + deathS * 1000;
  const absorbs = victim.damageIn
    .filter(
      (d) =>
        d.logLine.timestamp >= fromMs &&
        d.logLine.timestamp < expiresMs &&
        d.logLine.timestamp <= deathMs,
    )
    .map((d) => ({
      tsMs: d.logLine.timestamp,
      amount: Math.abs(d.effectiveAmount) * share,
    }))
    .sort((a, b) => a.tsMs - b.tsMs);
  return Math.round(timeDilationPendingAt(absorbs, deathMs));
}

/** Time Dilation's assumed press: the window's start, or the match second
 * the spell came off cooldown when that was later
 * (`IMissedExternal.offCooldownSinceS`, or `selfOffCooldownSinceS` for an
 * unused self cooldown). */
function timeDilationPressS(
  windowStartS: number,
  offCooldownSinceS: number | undefined,
): number {
  return offCooldownSinceS === undefined
    ? windowStartS
    : Math.max(windowStartS, offCooldownSinceS);
}

/** The ledger's own walk for an unused self cooldown, over the whole window
 * plus the slack the walk takes back off (as the external producer's). */
function selfOffCooldownSinceS(
  cd: IMajorCooldownInfo,
  deathS: number,
): number | undefined {
  const readyFor = offCooldownForLastSecondsBy(
    (t) => cdAvailableAt(cd, t),
    deathS,
    COUNTERFACTUAL_WINDOW_S + CD_INSTANT_SLACK_S,
  );
  return readyFor === undefined ? undefined : deathS - readyFor;
}

/** Shape B / narrow gate: the hypothetical saving of one table entry. */
function savedBy(
  spellId: string,
  res: NonNullable<ReturnType<typeof resolveMitigation>>,
  victim: ICombatUnit,
  windowStartS: number,
  deathS: number,
  combat: { startTime: number },
  caster: ICombatUnit | undefined,
  offCooldownSinceS?: number,
): number {
  return spellId === TIME_DILATION_ID
    ? savedByTimeDilation(
        res,
        victim,
        timeDilationPressS(windowStartS, offCooldownSinceS),
        deathS,
        combat,
        caster,
      )
    : savedByComponents(res, victim, windowStartS, deathS, combat);
}

export interface ICounterfactualHit {
  spellId: string;
  spellName: string;
  source: "unused-self" | "missed-external";
  casterName?: string; // for missed-external
  savedAmount: number;
  savedPctMaxHp: number;
  tier: CounterfactualTier;
  /** Time Dilation priced from a press when it came off cooldown, later
   * than the window's start (`timeDilationPressS`) */
  pressedWhenReady?: true;
}

/**
 * The discount measure shared by B and the narrow gate: the candidate was
 * **not active**, so no back-computation (that is exclusive to shape A) —
 * discount the observed damage of matching schools in the window by the table's
 * pct. Only tier=decisive produces a hit; marginal/fatal stay silent (honesty
 * discipline: do not state what is uncertain).
 */
function decisiveHitFor(
  spellId: string,
  rawSpellName: string,
  source: ICounterfactualHit["source"],
  casterName: string | undefined,
  saved: number,
  netDamage: number | null,
  maxHp: number | null,
): ICounterfactualHit | null {
  if (netDamage === null || maxHp === null || maxHp <= 0) return null;
  const tier = counterfactualTier(saved, netDamage, maxHp);
  if (tier !== "decisive") return null;
  return {
    spellId,
    spellName: getEnglishSpellName(spellId, rawSpellName),
    source,
    casterName,
    savedAmount: saved,
    savedPctMaxHp: round1((saved / maxHp) * 100),
    tier,
  };
}

/**
 * Walls this gate does not price. The discount assumes the wall covered every
 * matching hit in the whole COUNTERFACTUAL_WINDOW_S window; nothing here
 * clips to the wall's duration. Codex astra (2026-09-26) showed the full-window
 * discount turns a "fatal" into a "decisive" claim for a 3 s cover.
 *
 * The two walls signed on 2026-09-26 stay out until coverage is modelled:
 *  - Greater Invisibility 110959: −60 % only while invisible and for 3 s after;
 *  - Retribution Divine Protection 403876: 8 s.
 * They still count for the cooldown ledger, crisis readiness and burst pricing.
 * The walls priced before that date keep the old model; the duration clip is
 * ledgered (GH #109) rather than silently extended to the new walls.
 */
export const UNUSED_SELF_COVERAGE_UNMODELLED: ReadonlySet<string> = new Set([
  "110959",
  "403876",
]);

/**
 * Narrow gate: the player's own available-but-unused cooldown (in the table and
 * non-positional; returns empty when CC-locked). Returns decisive hits only.
 */
export function computeUnusedSelfCounterfactuals(
  victim: ICombatUnit,
  victimCds: IMajorCooldownInfo[],
  victimCcSummary: Pick<IPlayerCCTrinketSummary, "playerName" | "ccInstances">,
  combat: { startTime: number; units: Record<string, ICombatUnit> },
  deathS: number,
): ICounterfactualHit[] {
  if (wasLockedOutThroughWindow(victimCcSummary, deathS)) return [];

  const windowStartS = windowStartSecondsOf(deathS);
  const { netDamage, maxHp } = windowNetDamageAndMaxHp(
    victim,
    combat.startTime,
    deathS,
  );

  const hits: ICounterfactualHit[] = [];
  for (const cd of victimCds) {
    // a row owned on the spec baseline alone is cd-hoarded's only (ruling
    // P-W6); this line has no Forbearance gate for a button never shown
    // (Fable review of F-W6, round 8)
    if (cd.baselineOnly) continue;
    if (UNUSED_SELF_COVERAGE_UNMODELLED.has(cd.spellId)) continue;
    if (!cdReadyInTimeAt(cd, deathS)) continue;
    // a button the game refused then (Ice Block under Hypothermia, Divine
    // Shield under Forbearance — read just before the death, where the
    // debuff still holds; codex R6C-04 #1) saved nobody
    if (
      lockoutDebuffStopsPressAtDeath(
        victim,
        cd.spellId,
        victim,
        Object.values(combat.units),
        deathS,
        combat.startTime,
      )
    )
      continue;
    // GH #96 M3a: hypothetical ADDED protection: observed × p per component
    // (own cooldown → the victim carries it). Lower bound: "would have saved".
    const res = resolveMitigation(cd.spellId, {
      carrierIsCaster: true,
      caster: victim,
    });
    if (!res || res.positional) continue;

    const readySinceS =
      cd.spellId === TIME_DILATION_ID
        ? selfOffCooldownSinceS(cd, deathS)
        : undefined;
    const saved = savedBy(
      cd.spellId,
      res,
      victim,
      windowStartS,
      deathS,
      combat,
      victim,
      readySinceS,
    );
    const hit = decisiveHitFor(
      cd.spellId,
      cd.spellName,
      "unused-self",
      undefined,
      saved,
      netDamage,
      maxHp,
    );
    if (
      hit &&
      cd.spellId === TIME_DILATION_ID &&
      timeDilationPressS(windowStartS, readySinceS) > windowStartS
    )
      hit.pressedWhenReady = true;
    if (hit) hits.push(hit);
  }
  return hits;
}

/** Shape B: missedExternals × table → three tiers; returns decisive only. */
export function computeMissedExternalCounterfactuals(
  missedExternals: IMissedExternal[],
  victim: ICombatUnit,
  combat: { startTime: number; units?: Record<string, ICombatUnit> },
  deathS: number,
): ICounterfactualHit[] {
  const windowStartS = windowStartSecondsOf(deathS);
  const { netDamage, maxHp } = windowNetDamageAndMaxHp(
    victim,
    combat.startTime,
    deathS,
  );

  const hits: ICounterfactualHit[] = [];
  for (const m of missedExternals) {
    // GH #96 M3a: an external is carried by the victim but cast by somebody
    // else. Before M3a this path read `entry.pct` raw (ignoring pctOnOthers);
    // no entry with pctOnOthers is an external today, so output is unchanged.
    // the external's caster's talents (Foreseen Circumstances → Pain
    // Suppression 50 %) — talent impact audit 2026-09-26
    const res = resolveMitigation(m.spellId, {
      carrierIsCaster: false,
      caster: unitByName(combat.units, m.casterName),
    });
    if (!res || res.positional) continue; // skip off-table / positional

    const saved = savedBy(
      m.spellId,
      res,
      victim,
      windowStartS,
      deathS,
      combat,
      unitByName(combat.units, m.casterName),
      m.offCooldownSinceS,
    );
    const hit = decisiveHitFor(
      m.spellId,
      m.spellName,
      "missed-external",
      m.casterName,
      saved,
      netDamage,
      maxHp,
    );
    if (
      hit &&
      m.spellId === TIME_DILATION_ID &&
      timeDilationPressS(windowStartS, m.offCooldownSinceS) > windowStartS
    )
      hit.pressedWhenReady = true;
    if (hit) hits.push(hit);
  }
  return hits;
}

/**
 * "Could this owner put this CC on THAT target at second s" — the one
 * target-state evaluator behind every CC-feasibility fact (GH #77). The codex
 * astra review of GH #77 part 2 (2026-09-24) required it to be shared: the
 * PEEL OPTIONS lines and the CC USE review bookmarks must not each carry a copy
 * of reach / LoS / immunity / DR / breaker checks.
 *
 * Every answer is per target and per whole render second, and says WHICH
 * condition failed. Unknowns fail closed (no mechanic, no reach, no position,
 * an unresolved aura-147 mask). Unknown LoS (no geometry / elevation) passes,
 * which is why the rendered wording is "no detected LoS obstruction".
 * Policy stays with the caller: PEEL OPTIONS accept any DR below Immune, the
 * CC USE bookmarks require Full (an unresolved DR category is not admitted).
 *
 * Conditions, in order:
 * Render-second policy: every condition that must be ABSENT (the owner
 * casting this CC, the owner CC'd or locked, the target CC'd or immune) must
 * be absent over the whole rendered second [s, s+1); positions, LoS and DR
 * are read at the instant s.
 *  - owner: alive, the CC reaction-ready (`cdReadyInTimeAt`), not stopped
 *    from casting THIS control (`cannotCastIntervalsForSpells`: CC, a
 *    silence that stops it, a lockout of its school, a disarm when it needs
 *    a weapon), not inside an own casting-lockout aura
 *    (DB2 aura 60 / 263 — Bladestorm, Ice Block);
 *  - target: alive, not already inside a CC aura, no active aura that blocks
 *    the CC's mechanic (`auraBlocksMechanic`; unknown → blocked);
 *  - geometry: both positions known, distance ≤ the owner's single-target
 *    reach (`ccThreatReachYards` — cast range, else a caster-centred radius),
 *    LoS not falsified;
 *  - DR for the CC's category not Immune (`drLevelNextAt` over the target's
 *    DR history, `buildCcCategoryHistory`);
 *  - the target holds no ready breaker of its own for that mechanic
 *    (`kitSpellReadyAt`): a designed breaker (the mechanic is on its own DB2
 *    aura 77 — corpus-confirmed pressed from inside that CC) or a full-school
 *    immunity the official usable-while attribute allows in that state.
 */
import type { AtomicArenaCombat, ICombatUnit } from "@gladlog/parser-compat";

import { abilityProfile } from "../data/abilityProfile";
import { effectAurasOfCast, effectAuraViaName } from "../data/castEffectAuras";
import { getEnglishSpellName } from "../data/spellEffectData";
import { spellSchoolMask } from "../data/spellSchools";
import { ccSpellIds } from "../data/spellTags";
import { buildAuraIntervals, type IAuraInterval } from "./auraIntervals";
import { cannotCastIntervalsForSpells } from "./cannotCastIntervals";
import { castingLockIntervalsOf } from "./castingLocks";
import {
  applicableCCAvoidanceIds,
  CC_AVOIDANCE_BUFF_SPELLS,
  pvpTrinketRemainingSecondsAt,
} from "./ccTrinketAnalysis";
import { auraIsImmunityForm } from "./combatStates";
import {
  cdReadyInTimeAt,
  type IMajorCooldownInfo,
  kitSpellReadyAt,
  playerTalentIdSets,
  USABLE_WHILE_CC_SPELL_IDS,
  USABLE_WHILE_CONFUSED_SPELL_IDS,
  USABLE_WHILE_FEARED_SPELL_IDS,
} from "./cooldowns";
import {
  auraIdsAppliedBy,
  buildCcCategoryHistory,
  type CCEntry,
  drCategoryKnown,
  drCategoryOfCast,
  drLevelNextAt,
} from "./drAnalysis";
import {
  KW_UNTARGETABLE_AURA_IDS,
  limitedImmunitySchoolMask,
  untargetableEndS,
} from "./enemyDefensives";
import {
  distanceBetween,
  getUnitPositionAtTime,
  hasLineOfSight,
} from "./losAnalysis";
import { INTERP_MAX_GAP_MS } from "./positionSampling";
import {
  auraBlocksMechanic,
  ccMechanicOf,
  explicitlyBreaksMechanic,
  mechanicStateOf,
} from "./spellMechanics";
import { ccThreatReachYards } from "./spellRange";

export type CcTargetState =
  | {
      ok: false;
      reason:
        | "owner-dead"
        | "not-ready"
        | "owner-cc"
        | "owner-locked"
        | "target-dead"
        | "target-cc"
        | "target-immune"
        | "no-position"
        | "out-of-range"
        | "los"
        | "dr-immune"
        | "target-breaker";
    }
  | { ok: true; distanceYards: number; dr: "Full" | "50%" | "n/a" };

export interface CcSampler {
  spellId: string;
  mech: number;
  reachYards: number;
  stateAt(target: ICombatUnit, s: number): CcTargetState;
}

type Interval = { from: number; to: number };

/**
 * Is this unit's PvP trinket ready at rendered second s? On the render grid:
 * a use at 10.8 s prints as 0:10, so from second 10 on it is spent. Shared by
 * PEEL OPTIONS and the CC USE bookmarks. null when the unit has no summary.
 */
export function pvpTrinketReadyAtSecond(
  summary: Parameters<typeof pvpTrinketRemainingSecondsAt>[0] | undefined,
  s: number,
): boolean | null {
  if (!summary) return null;
  // The one readiness predicate (racial lock + equipped trinket, W1j) on the
  // render grid; null when the unit has no PvP trinket to press.
  const remaining = pvpTrinketRemainingSecondsAt(summary, s, {
    renderGrid: true,
  });
  return remaining === null ? null : remaining <= 0;
}

/** The target's own abilities that break (or make it ignore) a CC of `mech`. */
function breakToolsFor(target: ICombatUnit, mech: number): string[] {
  const state = mechanicStateOf(mech);
  const usableIn =
    state === "stunned"
      ? USABLE_WHILE_CC_SPELL_IDS
      : state === "feared"
        ? USABLE_WHILE_FEARED_SPELL_IDS
        : state === "confused"
          ? USABLE_WHILE_CONFUSED_SPELL_IDS
          : null;
  const ids = new Set<string>();
  for (const e of target.spellCastEvents ?? [])
    if (e.spellId) ids.add(e.spellId);
  // A designed breaker (mechanic listed on its own aura 77) counts outright;
  // a full-school immunity (Ice Block, Divine Shield) only where the official
  // usable-while table says it can be pressed in that state. Under a stun it
  // can: both are on the immunity-purge route (user ruling U-T1, 2026-10-06,
  // reversing 2026-09-04 — `USABLE_WHILE_STUNNED_BY_PURGE_IDS`); the feared
  // and confused tables still leave them out.
  // An immunity only counts when it lands on its caster: Cyclone, Imprison
  // and Banish make their TARGET immune (official ImplicitTarget = enemy;
  // corpus: Cyclone's aura on the caster 5 times of 1,052, Imprison 0 / 38,
  // Banish 0 / 4) — a druid with Cyclone ready cannot break a Paralysis
  // with it.
  return [...ids].filter(
    (id) =>
      explicitlyBreaksMechanic(id, mech) ||
      (auraBlocksMechanic(id, mech) === true &&
        !abilityProfile(id).hitsEnemy &&
        (usableIn === null || usableIn.has(id))),
  );
}

/**
 * The geometry half of "could this owner put this CC on that target at this
 * instant": both positions known (`INTERP_MAX_GAP_MS`), the distance within
 * the CC's reach (`ccThreatReachYards` — cast range, else a caster-centred
 * radius), LoS not falsified. Unknown position fails closed. One predicate
 * for `ccSamplerFor` and the healer-offense "X ready on enemy healer" lines
 * (fact5 D18 / D19, 5fb1039a r0: an Incapacitating Roar — 10 yd around the
 * druid — "ready on enemy healer" 38–65 yd away).
 */
export function ccReachAt(
  owner: ICombatUnit,
  target: ICombatUnit,
  reachYards: number,
  zone: string,
  ms: number,
):
  | { ok: true; distanceYards: number }
  | { ok: false; reason: "no-position" | "out-of-range" | "los" } {
  const po = getUnitPositionAtTime(owner, ms, INTERP_MAX_GAP_MS);
  const pt = getUnitPositionAtTime(target, ms, INTERP_MAX_GAP_MS);
  if (!po || !pt) return { ok: false, reason: "no-position" };
  const dist = distanceBetween(po, pt);
  if (dist > reachYards) return { ok: false, reason: "out-of-range" };
  if (hasLineOfSight(zone, po, pt) === false)
    return { ok: false, reason: "los" };
  return { ok: true, distanceYards: dist };
}

/**
 * When `target` could not take this control because of an aura on it — the
 * "not immune" half of every "this CC could land on that unit" claim. One
 * predicate for `ccSamplerFor` (`[CC BOOKMARK]`, `[PEEL OPTION]`, CC USE)
 * and the healer-offense "X ready on enemy healer" lines (`[CONTESTED]`,
 * `[OPPORTUNITY]`). An aura blocks when:
 *  - DB2 gives it an immunity to the control's mechanic (aura 77 / all);
 *  - it is an immunity form DB2 does not encode (`auraIsImmunityForm`,
 *    Spirit of Redemption — fact6 D8; F20 residual: 3 `[CONTESTED] … ready
 *    on enemy healer` spans on a priest in the form, e.g. s0/72-1 3:01–3:05);
 *  - it is a listed avoidance the press line's `[IMMUNE — X was up]` names
 *    for this control (`applicableCCAvoidanceIds`, fact4 D3);
 *  - it is a school-limited full immunity (`limitedImmunitySchoolMask`: a
 *    `MITIGATION_TABLE` 100 % row) covering the school of what the control
 *    puts on the target — its own control aura(s), else the cast (F20
 *    residual: Cloak of Shadows, in no avoidance list, read "not immune" to
 *    Binding Shot's arcane stun 117526 — s0/76-1 0:26–0:35 bookmark across a
 *    Cloak 0:32.6–0:37.6);
 *  - the unit is no target at all (`KW_UNTARGETABLE_AURA_IDS`: Mass
 *    Invisibility, Phase Shift), to the end the kill windows read.
 * Intervals in seconds from the round's start.
 */
export function ccTargetBlockerIntervals(
  target: ICombatUnit,
  combat: Parameters<typeof buildAuraIntervals>[1],
  castSpellId: string,
  castSpellName?: string,
): IAuraInterval[] {
  const mech = ccMechanicOf(castSpellId);
  const controlIds = [
    castSpellId,
    ...effectAurasOfCast(castSpellId).filter(
      (a) => ccSpellIds.has(a) && effectAuraViaName(castSpellId, a),
    ),
  ];
  // keyed by the cast AND the control aura it applies: Freezing Trap's
  // cast 187650 is physical in DB2, its aura 3355 frost — the IMMUNE row
  // names the aura
  const avoidance = new Set<string>();
  for (const id of controlIds)
    for (const b of applicableCCAvoidanceIds(
      id,
      getEnglishSpellName(castSpellId, castSpellName ?? ""),
    ))
      avoidance.add(b);
  const landing =
    controlIds.length > 1 ? controlIds.slice(1) : controlIds.slice(0, 1);
  const landingSchools = landing.map((id) => spellSchoolMask(id));
  const schoolBlocked = (auraId: string) => {
    const mask = limitedImmunitySchoolMask(auraId);
    return (
      mask !== undefined &&
      landingSchools.every(
        (s) => s !== undefined && s !== 0 && (s & ~mask) === 0,
      )
    );
  };
  const auras = buildAuraIntervals(target, combat);
  return (
    auras
      .filter(
        (iv) =>
          (mech !== undefined &&
            auraBlocksMechanic(iv.spellId, mech) !== false) ||
          // an immunity form DB2 does not encode (Spirit of
          // Redemption, both forms): fact6 D8 (c992ce75 0:47–0:55)
          auraIsImmunityForm(iv.spellId) ||
          // …or one the press line's `[IMMUNE — X was up]` names for this
          // control (`applicableCCAvoidanceIds`, by school): fact4 D3
          // (190bbc57 0:26–0:31) — Anti-Magic Shell blocks no freeze by
          // mechanic, yet a Freezing Trap into it logged IMMUNE, and the
          // bookmark counted those seconds "not immune"
          (CC_AVOIDANCE_BUFF_SPELLS.has(iv.spellId) &&
            avoidance.has(iv.spellId)) ||
          schoolBlocked(iv.spellId),
      )
      // not a target at all: Mass Invisibility / Phase Shift, to the
      // end the kill windows read (`untargetableEndS`)
      .concat(
        auras
          .filter((iv) => KW_UNTARGETABLE_AURA_IDS.has(iv.spellId))
          .map((iv) => ({
            ...iv,
            toS: untargetableEndS(target, iv, combat.startTime),
          })),
      )
  );
}

/**
 * A sampler for one owner's one CC, or null when its mechanic or reach is
 * unknown (no line may be built on it). Per-target facts are computed once
 * and cached.
 */
export function ccSamplerFor(params: {
  combat: AtomicArenaCombat;
  owner: ICombatUnit;
  cd: IMajorCooldownInfo;
  enemyIds: ReadonlySet<string>;
  /**
   * The CC instances the timeline's `[CC ON ENEMY]` / `[CC ON TEAM]` lines
   * render for a unit (`analyzePlayerCCAndTrinket(...).ccInstances`). A
   * target counts as CC'd over their union with its CC auras, so a
   * "not CC'd" claim can never contradict a rendered CC line — including the
   * dispel-backlash silences / horrors (Unstable Affliction, Sin and
   * Punishment) that are not in `ccSpellIds` (the CC USE gate caught 5 such
   * spans, 2026-09-24).
   */
  renderedCcOf?: (
    unitName: string,
  ) => ReadonlyArray<{ atSeconds: number; durationSeconds: number }>;
}): CcSampler | null {
  const { combat, owner, cd } = params;
  const mech = ccMechanicOf(cd.spellId);
  const reach = ccThreatReachYards(owner, cd.spellId);
  if (mech === undefined || reach === null) return null;
  const start = combat.startTime;
  const zone = String(combat.startInfo?.zoneId ?? "");
  // The cooldown is a CAST id; the DR history below is keyed by the aura ids
  // the log applies (GH #111).
  // a cast with variants in different DR families resolves from the
  // owner's own applications (codex 35-CD-06: Chastise)
  const ownerApplied = auraIdsAppliedBy(
    owner.id,
    Object.values(combat.units ?? {}).filter((u) => params.enemyIds.has(u.id)),
  );
  const cat = drCategoryOfCast(cd.spellId, ownerApplied);
  // An unmapped cast (spell:<id> fallback, not self-DR) has no DR history to
  // read: "n/a", never a fabricated "Full" (W1g).
  const catKnown = drCategoryKnown(cd.spellId, ownerApplied);
  const deathS = (u: ICombatUnit) => {
    const d = u.deathRecords[0];
    return d ? (d.timestamp - start) / 1000 : Infinity;
  };
  const ownerDeath = deathS(owner);
  // asked about THIS control (work order 2026-10-15 #7): a school lockout
  // only when it locks the control's school, a silence only when DB2 lets it
  // stop the control, a disarm only when the control needs a weapon (Kidney
  // Shot, Gouge, Storm Bolt …) — the named-spell reading
  const cannot = cannotCastIntervalsForSpells(
    owner,
    new Set(params.enemyIds),
    [cd.spellId],
    Object.values(combat.units ?? {}),
  );
  // the one casting-lock predicate (Unrelenting Onslaught lets a holder
  // Storm Bolt inside Bladestorm)
  const locks: Interval[] = castingLockIntervalsOf(owner, combat, cd.spellId);
  // Any overlap with the rendered second [s, s+1).
  const overlapsMs = (ivs: Interval[], ms: number) =>
    ivs.some((w) => w.from < ms + 1000 && ms < w.to);
  const overlapsSecond = (iv: { fromS: number; toS: number }, s: number) =>
    iv.fromS < s + 1 && s < iv.toS;
  const castSeconds = new Set(cd.casts.map((c) => Math.floor(c.timeSeconds)));

  const perTarget = new Map<
    string,
    {
      death: number;
      cc: IAuraInterval[];
      renderedCc: Array<{ fromS: number; toS: number }>;
      blockers: IAuraInterval[];
      drHistory: CCEntry[];
      tools: string[];
      talents: ReturnType<typeof playerTalentIdSets>;
    }
  >();
  const factsOf = (t: ICombatUnit) => {
    let f = perTarget.get(t.id);
    if (!f) {
      const auras = buildAuraIntervals(t, combat);
      const cc = auras.filter((iv) => ccSpellIds.has(iv.spellId));
      const rendered = (params.renderedCcOf?.(t.name) ?? []).map((c) => ({
        fromS: c.atSeconds,
        toS: c.atSeconds + c.durationSeconds,
      }));
      f = {
        death: deathS(t),
        cc,
        renderedCc: rendered,
        // the one "could not take this control" reading
        // (`ccTargetBlockerIntervals`)
        blockers: ccTargetBlockerIntervals(t, combat, cd.spellId, cd.spellName),
        // the target's DR history — the one builder (fact6 F20,
        // `buildCcCategoryHistory`: every source, a control reflected back
        // onto it included)
        drHistory: buildCcCategoryHistory(
          t,
          cat,
          start,
          new Map(Object.values(combat.units ?? {}).map((u) => [u.id, u])),
        ),
        tools: breakToolsFor(t, mech),
        talents: playerTalentIdSets(t),
      };
      perTarget.set(t.id, f);
    }
    return f;
  };

  return {
    spellId: cd.spellId,
    mech,
    reachYards: reach,
    stateAt(target, s) {
      const ms = start + s * 1000;
      if (s >= ownerDeath) return { ok: false, reason: "owner-dead" };
      if (!cdReadyInTimeAt(cd, s)) return { ok: false, reason: "not-ready" };
      // Render-second policy (codex astra round 4): a state that must be
      // ABSENT — the owner casting this CC, the owner CC'd or locked, the
      // target CC'd or immune — must be absent over the whole rendered second
      // [s, s+1). The timeline prints each of those events at fmtTime of its
      // instant, so an event at 14.8 s shows under 0:14 and the second 14
      // cannot be claimed free of it.
      if (castSeconds.has(s)) return { ok: false, reason: "not-ready" };
      if (overlapsMs(cannot, ms)) return { ok: false, reason: "owner-cc" };
      if (overlapsMs(locks, ms)) return { ok: false, reason: "owner-locked" };
      const f = factsOf(target);
      if (s >= f.death) return { ok: false, reason: "target-dead" };
      if (
        f.cc.some((iv) => overlapsSecond(iv, s)) ||
        f.renderedCc.some((iv) => overlapsSecond(iv, s))
      )
        return { ok: false, reason: "target-cc" };
      if (f.blockers.some((iv) => overlapsSecond(iv, s)))
        return { ok: false, reason: "target-immune" };
      const geo = ccReachAt(owner, target, reach, zone, ms);
      if (!geo.ok) return { ok: false, reason: geo.reason };
      const dist = geo.distanceYards;
      const dr = catKnown
        ? drLevelNextAt(f.drHistory, ms)
        : "n/a";
      if (dr === "Immune") return { ok: false, reason: "dr-immune" };
      if (
        f.tools.some((id) =>
          kitSpellReadyAt(target, id, s, start, f.talents, combat),
        )
      )
        return { ok: false, reason: "target-breaker" };
      return {
        ok: true,
        distanceYards: dist,
        dr: dr as "Full" | "50%" | "n/a",
      };
    },
  };
}

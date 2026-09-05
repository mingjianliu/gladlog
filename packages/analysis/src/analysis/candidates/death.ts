/**
 * Death-anchored candidate producers — the precursor chain (`death-setup`),
 * `death-unused-defensive`, `external-unused` and `questionable-external`.
 *
 * Split out of `candidateFindings.ts` on 2026-08-16 (mechanical split by
 * theme); logic moved verbatim. These four share the death window and the
 * free-to-act predicates, which is why they travel together.
 */
import { CombatUnitClass } from "@gladlog/parser-compat";
import { spellEffectData } from "../../data/spellEffectData";
import { immunitySchoolMask } from "../../data/spellSchools";
import { lastCastBefore } from "../../context/timelineHelpers";
import { costNormPhrase } from "../../data/curatedAbilityFacts";
import {
  cdAvailableAt,
  FORBEARANCE_GATED_IDS,
  type IMajorCooldownInfo,
  isProcOnlyActivation,
  SELF_CAST_NOOP_EXTERNAL_IDS,
  selfForbearanceActiveAt,
  usableWhileStunned,
} from "../../utils/cooldowns";
import { isStunCcInstance } from "../../utils/drAnalysis";
import { castFailedInWindow, type RawStreams } from "../../utils/rawStreams";
import { fmtFactNum as fmt, fmtFactTime } from "../factFormat";
import { CandidateEvent } from "../types";
import { filterIntentGuardEvidence, formatAttemptedFact } from "./shared";

/** death-setup: maximum lookback (seconds) from a death to a precursor event —
 * resource spends earlier than this are too causally weak for that death.
 *
 * GH #34 batch 4 (2026-08-28), 300 matches / 1,127 healer rounds, 507
 * death-setup candidates (healer-locked 284 · trinket-early 177 ·
 * defensive-early 46). Gap death − precursor: trinket-early [0,10) 11 ·
 * [10,20) 17 · [20,30) 17 · [30,45) 25 · [45,60) 46 · [60,75) 39 · ≥ 75 22
 * (p50 50.9 s, p90 77.5 s, max 89.8 s) — the mass RISES toward the cap, so
 * 90 s is binding: it is the "causally too weak" cut on a still-populated
 * tail, not a natural end. defensive-early p50 21.9 s, max 83 s (cap not
 * binding). Editorial; measured, not official. */
export const DEATH_SETUP_LOOKBACK_S = 90;
/** death-setup: minimum healer CC duration (seconds) — a short incapacitate
 * does not make the kill window unhealable.
 *
 * GH #34 batch 4 (2026-08-28), 300 matches / 566 friendly deaths: 74.6 % of
 * deaths have a healer CC overlapping the DEATH_CC_LOOKBACK_S window; the
 * longest such CC per death — [0,1) 23 · [1,2) 42 · [2,3) 45 · [3,4) 75 ·
 * [4,5) 65 · [5,6) 78 · [6,8) 86 · ≥ 8 8 (p50 4.2 s). Share clearing the
 * gate: ≥ 2 s 84.6 % · **≥ 3 s 73.9 %** · ≥ 4 s 56.2 % — so "healer-locked"
 * attaches to roughly 55 % of ALL friendly deaths at 3 s (41 % at 4 s). No
 * natural break; editorial. Measured, not official. */
const HEALER_LOCK_MIN_S = 3;
/** Max precursor events attached to one death (priority: healer-locked >
 * trinket-early > defensive-early). */
// at-cap 体检(2026-08-26):death-setup 76/255 有产出回合打到上限(30%)。
const SETUPS_PER_DEATH = 2;

export interface DeathSetupParts {
  deathT: number;
  victim: { id: string; name: string };
  /** The victim's CC/trinket summary (the relevant slice of
   * analyzePlayerCCAndTrinket). */
  victimCC?: {
    ccInstances: Array<{
      atSeconds: number;
      durationSeconds: number;
      spellName: string;
      trinketState: string;
      /** DR category of this CC instance (e.g. "Stun"/"Incapacitate"/
       * "Disorient"/…), when known — same field as ICCInstance.drInfo.category
       * (DR_CATEGORIES_GENERATED, shared-predicate rule). Used by
       * deathUnusedDefensiveEvents to gate the USABLE_WHILE_CC_SPELL_IDS check
       * (finding #1, 2026-08-14 final review): that table is stunned-only —
       * a non-stun CC active at death must exempt unconditionally rather than
       * being checked against it. Optional/nullable so hand-built test
       * fixtures without DR data still type-check (absence reads as "not
       * stun", the conservative direction). */
      drInfo?: { category: string } | null;
    }>;
    trinketUseTimes: number[];
  };
  /** The victim's major cooldowns (extractMajorCooldowns). */
  victimCDs?: Array<
    Pick<
      IMajorCooldownInfo,
      | "spellId"
      | "spellName"
      | "tag"
      | "cooldownSeconds"
      | "casts"
      | "neverUsed"
    >
  >;
  /** CC summary for the friendly healer (when the healer is not the victim). */
  /** Enemy players who can break an immunity, with their breaker's cast
   * times (seconds) — `enemyImmunityBreakers()`; GH #18 ruling (c). */
  enemyImmunityBreakers?: Array<{ spellId: string; castTimesS: number[] }>;
  healerCC?: {
    healerName: string;
    ccInstances: Array<{
      atSeconds: number;
      durationSeconds: number;
      /** Optional: real callers pass an ICCInstance that carries the id; test
       * fixtures may omit it (it only feeds the icon). */
      spellId?: string;
      spellName: string;
      sourceName: string;
    }>;
  };
}

/**
 * death-setup candidates (reasoning chain): trace a friendly death back to an
 * earlier precursor moment, giving the model a citable "other end of the
 * chain". Pure function (unit-testable with hand-built fixtures); every
 * verdict mirrors the existing predicates of buildDeathRootCauseTrace:
 *  - healer-locked: healer CC covers the DEATH_CC_LOOKBACK_S window before the
 *    death (same window constant);
 *  - trinket-early: the victim was CC'd inside the death window with
 *    trinketState=on_cooldown (the trace's CC row); the precursor moment is
 *    the earlier trinket press;
 *  - defensive-early: a victim's major defensive was ON COOLDOWN at death and
 *    its last use was labeled Early by the timing audit (the trace's
 *    [last use: EARLY] row); the precursor moment is that cast.
 */
/**
 * Immunity breakers (hand table, registered in curatedIdRegistry): the enemy
 * CLASS that carries each — a warrior always has Shattering Throw, a priest
 * always has Mass Dispel, whether or not the log ever saw it cast. Cooldowns
 * come from the official spell data (fallbacks are the 12.x values).
 * Both ids are in observedSpellIdsGenerated (corpus-verified 2026-08-30).
 */
export const IMMUNITY_BREAKERS: ReadonlyArray<{
  spellId: string;
  name: string;
  cls: CombatUnitClass;
  fallbackCooldownS: number;
}> = [
  {
    spellId: "64382",
    name: "Shattering Throw",
    cls: CombatUnitClass.Warrior,
    fallbackCooldownS: 180,
  },
  {
    spellId: "32375",
    name: "Mass Dispel",
    cls: CombatUnitClass.Priest,
    fallbackCooldownS: 120,
  },
];

function breakerCooldownS(b: (typeof IMMUNITY_BREAKERS)[number]): number {
  return spellEffectData[b.spellId]?.cooldownSeconds ?? b.fallbackCooldownS;
}

/** Enemy players' breakers with cast times (seconds from match start). */
export function enemyImmunityBreakers(
  enemies: ReadonlyArray<{ class?: CombatUnitClass; spellCastEvents?: any[] }>,
  startMs: number,
): Array<{ spellId: string; castTimesS: number[] }> {
  const out: Array<{ spellId: string; castTimesS: number[] }> = [];
  for (const e of enemies) {
    for (const b of IMMUNITY_BREAKERS) {
      if (e.class !== b.cls) continue;
      out.push({
        spellId: b.spellId,
        castTimesS: (e.spellCastEvents ?? [])
          .filter((c: any) => String(c.spellId) === b.spellId)
          .map((c: any) => (c.timestamp - startMs) / 1000),
      });
    }
  }
  return out;
}

/** True when some enemy breaker is off cooldown at `tSeconds` — i.e. an
 * immunity pressed then could have been broken. */
export function enemyHoldsImmunityBreakerAt(
  breakers: ReadonlyArray<{ spellId: string; castTimesS: number[] }>,
  tSeconds: number,
): boolean {
  return breakers.some((br) => {
    const def = IMMUNITY_BREAKERS.find((b) => b.spellId === br.spellId);
    if (!def) return false;
    const cd = breakerCooldownS(def);
    return !br.castTimesS.some((c) => c <= tSeconds && tSeconds - c < cd);
  });
}

/**
 * CC look-back window (seconds) for the death chain: "CC inside the death
 * window" is judged over the 12 s before the death. Lived in
 * context/criticalMoments.ts until that module was deleted (2026-09-05,
 * GH #51 — six zero-consumer exports, probe showed the block restates the
 * timeline); this was its only live consumer, so the constant moved here.
 */
export const DEATH_CC_LOOKBACK_S = 12;

export function deathSetupEvents(parts: DeathSetupParts): CandidateEvent[] {
  const { deathT, victim } = parts;
  const out: CandidateEvent[] = [];
  const inWindow = (cc: { atSeconds: number; durationSeconds: number }) =>
    cc.atSeconds <= deathT &&
    cc.atSeconds + cc.durationSeconds >= deathT - DEATH_CC_LOOKBACK_S;

  // healer-locked: healer was CC'd for >=3s inside the kill window, starting
  // before the moment of death
  const lock = parts.healerCC?.ccInstances.find(
    (cc) =>
      inWindow(cc) &&
      cc.durationSeconds >= HEALER_LOCK_MIN_S &&
      cc.atSeconds < deathT,
  );
  if (lock) {
    out.push({
      id: `death-setup:${victim.id}:${Math.round(deathT)}:healer-locked`,
      type: "death-setup",
      t: lock.atSeconds,
      unitNames: [parts.healerCC!.healerName, victim.name],
      spell: lock.spellName,
      spellId: lock.spellId,
      facts: {
        t: fmt(lock.atSeconds),
        kind: "healer-locked",
        // Render-grid fix (2026-08-30, same bug/fix as kick-eaten): deathT
        // names the SAME instant the later "death" candidate's own t names,
        // and must floor onto the same [DEATH] marker second -- 10/129
        // (7.8%) death-setup deathT facts on the 2026-08-30 A/B corpus
        // rounded up past it before this.
        deathT: fmtFactTime(deathT),
        victim: victim.name,
        healer: parts.healerCC!.healerName,
        cc: lock.spellName,
        duration: lock.durationSeconds.toFixed(1),
      },
    });
  }

  // trinket-early: CC'd inside the death window with the trinket on cooldown;
  // the precursor is that earlier trinket press
  const deadInCC = parts.victimCC?.ccInstances.find(
    (cc) => inWindow(cc) && cc.trinketState === "on_cooldown",
  );
  if (deadInCC) {
    const trinketT = [...(parts.victimCC?.trinketUseTimes ?? [])]
      .filter(
        (t) => t < deadInCC.atSeconds && t >= deathT - DEATH_SETUP_LOOKBACK_S,
      )
      .pop();
    if (trinketT !== undefined) {
      out.push({
        id: `death-setup:${victim.id}:${Math.round(deathT)}:trinket-early`,
        type: "death-setup",
        t: trinketT,
        unitNames: [victim.name],
        facts: {
          t: fmt(trinketT),
          kind: "trinket-early",
          // Render-grid fix (2026-08-30, same bug/fix as kick-eaten): deathT
          // names the SAME instant the later "death" candidate's own t names,
          // and must floor onto the same [DEATH] marker second -- 10/129
          // (7.8%) death-setup deathT facts on the 2026-08-30 A/B corpus
          // rounded up past it before this.
          deathT: fmtFactTime(deathT),
          victim: victim.name,
          ccAtDeath: deadInCC.spellName,
          gapS: fmt(deathT - trinketT),
        },
      });
    }
  }

  // defensive-early: ON COOLDOWN at death and its last use was labeled Early
  // by the timing audit
  for (const cd of parts.victimCDs ?? []) {
    if (cd.tag !== "Defensive" || cd.neverUsed) continue;
    // 被动触发的能力谈不上「交早了」—— 交的时机不是玩家选的。
    if (isProcOnlyActivation(cd.spellId)) continue;
    const last = lastCastBefore(cd as IMajorCooldownInfo, deathT);
    if (!last) continue;
    // available at death → this is not a "spent it too early" chain
    if (cdAvailableAt(cd as IMajorCooldownInfo, deathT)) continue;
    if (last.timingLabel !== "Early") continue;
    if (last.timeSeconds < deathT - DEATH_SETUP_LOOKBACK_S) continue;
    // Feasibility (GH #18 human label 2026-08-30, ruling (c)): an IMMUNITY
    // "traded early" is not a mistake while an enemy still holds a breaker
    // for it (Shattering Throw / Mass Dispel) — the player's own words:
    // "shattering throw 都留着破无敌". Only official immunities
    // (spellSchools immuneSchools) are exempted; ordinary defensives keep
    // the timing verdict.
    if (
      immunitySchoolMask(cd.spellId) !== undefined &&
      enemyHoldsImmunityBreakerAt(
        parts.enemyImmunityBreakers ?? [],
        last.timeSeconds,
      )
    )
      continue;
    out.push({
      id: `death-setup:${victim.id}:${Math.round(deathT)}:defensive-early`,
      type: "death-setup",
      t: last.timeSeconds,
      unitNames: [victim.name],
      spell: cd.spellName,
      spellId: cd.spellId,
      facts: {
        t: fmt(last.timeSeconds),
        kind: "defensive-early",
        // Render-grid fix (2026-08-30, same bug/fix as kick-eaten): deathT
        // names the SAME instant the later "death" candidate's own t names,
        // and must floor onto the same [DEATH] marker second -- 10/129
        // (7.8%) death-setup deathT facts on the 2026-08-30 A/B corpus
        // rounded up past it before this.
        deathT: fmtFactTime(deathT),
        victim: victim.name,
        spell: cd.spellName,
        gapS: fmt(deathT - last.timeSeconds),
      },
    });
    // at most one defensive-early per death (take the first matching wall)
    break;
  }

  return out.slice(0, SETUPS_PER_DEATH);
}

/** Max number of available survival abilities listed in a death's facts. */
const UNUSED_DEFENSIVE_MAX_LISTED = 3;

/**
 * death-unused-defensive: the owner died with a survival ability available and
 * never pressed it (arenacoach DEATH-001 predicate, same thresholds). "Free"
 * verdict: not in CC at the moment of death, or in CC but with the trinket
 * usable (available_unused/available), or the ability is castable while CC'd
 * (USABLE_WHILE_CC_SPELL_IDS). Divine Shield-class abilities do not count as
 * available during Forbearance.
 */
export function deathUnusedDefensiveEvents(
  parts: DeathSetupParts,
  victim: { isOwner: boolean; unit?: any },
  combat?: any,
  /**
   * Intent guard (BACKLOG #26 Task 2): optional, absent/`available:false` →
   * byte-identical to before this param existed. For each listed wall, the
   * window queried is [the wall's own most-recent-cast-before-death +
   * cooldownSeconds (or 0 if never cast), deathT] — the same "available
   * since" instant the `walls` filter above already established via
   * `cdAvailableAt`, so the query window can never disagree with why the
   * wall was already counted as available.
   */
  rawStreams?: RawStreams,
): CandidateEvent[] {
  if (!victim.isOwner) return [];
  // When victimCC is absent (summary not computable) we must NOT default to
  // "not in CC" — that would wrongly land freeState on "yes" and falsely blame
  // a death that may well have happened under CC. Better to emit nothing than
  // to blame falsely.
  if (!parts.victimCC) return [];
  const { deathT } = parts;
  const ccAtDeath = parts.victimCC.ccInstances.find(
    (cc) =>
      cc.atSeconds <= deathT && cc.atSeconds + cc.durationSeconds >= deathT,
  );
  const freeState = !ccAtDeath
    ? "yes"
    : ccAtDeath.trinketState === "available_unused"
      ? "trinket_in_hand"
      : null; // in CC and the trinket is not actively usable
  // (passive_trinket/used/on_cooldown): not free overall, and only
  // USABLE_WHILE_CC abilities are exempt, and only when the CC active at
  // death is itself Stun-category (finding #1, 2026-08-14 final review):
  // USABLE_WHILE_CC_SPELL_IDS is a stunned-only table (DB2's "usable while
  // stunned" attribute), so a Fear/Disorient/Incapacitate at death must
  // exempt unconditionally rather than being checked against it — see
  // wasLockedOutByStunOnly (deathOutcomeAnalysis.ts) for the fuller story
  // behind the same fix applied there for the windowed lockout case.
  const ccAtDeathIsStunOnly = !!ccAtDeath && isStunCcInstance(ccAtDeath);

  // selfForbearanceActiveAt needs the whole-match unit list and matchStartMs —
  // derived from the same source as units/start in extractCandidateFindings
  // (see the top of that function).
  const allUnits: any[] = combat ? Object.values(combat.units ?? {}) : [];
  const matchStartMs: number = combat?.startTime ?? 0;

  /** 受害者的 PvP 天赋 id —— 条件层(某天赋才解锁「被晕可按」)要用。
   *  取不到时是 undefined,谓词按保守方向处理(不假设玩家点了天赋)。 */
  const victimPvpTalentIds: ReadonlySet<string> | undefined = victim.unit?.info
    ?.pvpTalents
    ? new Set((victim.unit.info.pvpTalents as string[]).map(String))
    : undefined;

  const walls = (parts.victimCDs ?? []).filter((cd) => {
    if (cd.tag !== "Defensive") return false;
    if ((cd as IMajorCooldownInfo).isThroughput) return false;
    // 没有按键的能力不算「你本可以按却没按的墙」—— 不是难做到,是没有那个按钮
    // (`PROC_ONLY_ACTIVATION_IDS`,用户 2026-08-23 裁定复苏烈焰是被动技能)。
    if (isProcOnlyActivation(cd.spellId)) return false;
    if (!cdAvailableAt(cd as IMajorCooldownInfo, deathT)) return false;
    if (freeState === null) {
      if (!ccAtDeathIsStunOnly) return false;
      // 单源:问「被晕时能不能按」只能问 usableWhileStunned,不能直接 .has()
      // 这个集合 —— 集合是无条件层,条件层(某 PvP 天赋才解锁)只活在谓词里。
      // GH #29 阶段 0 之前全仓没有一个生产调用点走谓词,于是 2026-08-14 签字的
      // 那条事实(超脱:转移 119996 需明心天赋)永远不生效。
      if (!usableWhileStunned(cd.spellId, victimPvpTalentIds)) return false;
    }
    if (
      FORBEARANCE_GATED_IDS.has(cd.spellId) &&
      victim.unit &&
      combat &&
      selfForbearanceActiveAt(victim.unit, allUnits, deathT, matchStartMs)
    )
      return false;
    // A damage-redirect external self-cast is a mechanical no-op (Blessing of
    // Sacrifice transfers damage TO the caster), so it is not a wall this
    // player could have pressed to survive. Shares the set with the prompt's
    // death line and with cooldowns.ts's "cheaper available" guard.
    if (SELF_CAST_NOOP_EXTERNAL_IDS.has(cd.spellId)) return false;
    return true;
  });
  if (walls.length === 0) return [];
  const listedWalls = walls.slice(0, UNUSED_DEFENSIVE_MAX_LISTED);
  // Cost-norm guard (#25, 2026-08-14): the first listed wall that is a
  // signed-off cost_norm ability (Divine Shield/Ice Block) supplies the
  // caveat — "off cooldown and unused" reads exactly like "you should have
  // pressed it" bait for an ability whose real cost rule is "last resort
  // only". Same precedent as missed-cleanse's ownerCanDispel gate: the fact
  // carries the guard, buildFindingsPrompt explains the field.
  const costNorm = listedWalls
    .map((w) => costNormPhrase(w.spellId))
    .find((phrase): phrase is string => phrase !== null);
  // Intent guard (BACKLOG #26 Task 2): per listed wall, "available since" is
  // its own most-recent cast before death + its cooldown (0 if never cast) —
  // the same instant that made `cdAvailableAt` accept it into `walls` above,
  // so this can never disagree with why the wall counts as available. Hits
  // across all listed walls are pooled into one `attempted` fact (the
  // candidate is one-per-death, not one-per-wall).
  // #29 (2026-08-17): raw hits are filtered through the shared GCD-artifact
  // exclusions before they count as "pressed but rejected" — see
  // filterIntentGuardEvidence's doc comment (shared.ts). The gcd-locked
  // exclusion consumes the victim's own successful-cast instants, derived
  // from the same `victim.unit`/`matchStartMs` pair the Forbearance check
  // above already threads; when the caller passes no unit (older call
  // shapes), the exclusion silently no-ops, same convention as `rawStreams?`.
  const ownCastSuccessSeconds: number[] | undefined = victim.unit
    ? (victim.unit.spellCastEvents ?? []).map(
        (e: any) => (e.timestamp - matchStartMs) / 1000,
      )
    : undefined;
  const failedHits = rawStreams
    ? listedWalls.flatMap((w) => {
        const lastCast = [...w.casts]
          .filter((c) => c.timeSeconds <= deathT)
          .pop();
        const fromS = Math.max(
          0,
          lastCast ? lastCast.timeSeconds + w.cooldownSeconds : 0,
        );
        return filterIntentGuardEvidence(
          castFailedInWindow(
            rawStreams,
            parts.victim.id,
            fromS,
            deathT,
            Number(w.spellId),
          ),
          w.casts.map((c) => c.timeSeconds),
          { ownCastSuccessSeconds },
        );
      })
    : [];
  const attempted = formatAttemptedFact(failedHits);
  return [
    {
      id: `death-unused-defensive:${parts.victim.id}:${Math.round(deathT)}`,
      type: "death-unused-defensive",
      t: deathT,
      unitNames: [parts.victim.name],
      facts: {
        // Render-grid fix (2026-08-30, same bug/fix as kick-eaten): t IS the
        // death instant, matched against the [DEATH] marker.
        t: fmtFactTime(deathT),
        unit: parts.victim.name,
        walls: listedWalls.map((w) => w.spellName).join(", "),
        free: freeState ?? "usable_in_cc",
        ...(costNorm ? { costNorm } : {}),
        ...(attempted ? { attempted } : {}),
      },
    },
  ];
}

/** external-unused: lookback window before the death (seconds) and the owner's
 * minimum free gap (seconds). Threshold provenance: arenacoach DEATH-003's
 * "you were free to cast it" (the 1.5s reaction allowance matches theirs
 * site-wide); the 5s window is the near-end sub-window of
 * DEATH_CC_LOOKBACK_S. */
// 2026-08-20 接地登记(GH #16,用户裁定保留):171 次可指控死亡实测,
// free-gap p50=3.9s、1.5–2.5s 边界带仅 9.9%(1.5 线不承重);窗宽敏感性
// 3s→62.6% / 5s→69.6% / 8s→87.1% 指控率 —— 以死亡为锚无法用结果选窗
// (循环),5/1.5 居中稳健,维持。数字在 issue #16 的三小件接地评论。
export const EXTERNAL_FREE_WINDOW_S = 5;
export const EXTERNAL_FREE_MIN_GAP_S = 1.5;

/**
 * external-unused: a teammate died while the owner (usually the healer) had an
 * external damage reduction available (the isAllyCastableDefensive whitelist)
 * and never gave it (arenacoach DEATH-003). "Owner was free" verdict: within
 * the EXTERNAL_FREE_WINDOW_S seconds before the death, after subtracting CC
 * coverage there was still a contiguous gap of >=EXTERNAL_FREE_MIN_GAP_S
 * seconds — purely a reaction-time allowance; the owner is not expected to
 * press exactly at the moment of death. If the owner was already dead at that
 * point (e.g. a double death), nothing is reported.
 */
export function externalUnusedEvents(input: {
  deathT: number;
  victim: { id: string; name: string };
  owner: { id: string; name: string };
  ownerExternals: Array<
    Pick<
      IMajorCooldownInfo,
      "spellId" | "spellName" | "cooldownSeconds" | "casts" | "neverUsed"
    >
  >;
  ownerCC: Array<{ atSeconds: number; durationSeconds: number }>;
  ownerAliveAt: (t: number) => boolean;
}): CandidateEvent[] {
  const { deathT, victim, owner } = input;
  if (!input.ownerAliveAt(deathT)) return [];

  // Owner's free gap: the largest contiguous gap left in the window
  // [deathT-5, deathT] after subtracting CC coverage
  const from = Math.max(0, deathT - EXTERNAL_FREE_WINDOW_S);
  const covers = input.ownerCC
    .map((c) => [c.atSeconds, c.atSeconds + c.durationSeconds] as const)
    .filter(([a, b]) => b > from && a < deathT)
    .sort((a, b) => a[0] - b[0]);
  let cursor = from;
  let maxGap = 0;
  for (const [a, b] of covers) {
    maxGap = Math.max(maxGap, a - cursor);
    cursor = Math.max(cursor, b);
  }
  maxGap = Math.max(maxGap, deathT - cursor);
  if (maxGap < EXTERNAL_FREE_MIN_GAP_S) return [];

  const avail = input.ownerExternals.find((cd) => cdAvailableAt(cd, deathT));
  if (!avail) return [];
  return [
    {
      id: `external-unused:${owner.id}:${victim.id}:${Math.round(deathT)}`,
      type: "external-unused",
      t: deathT,
      unitNames: [owner.name, victim.name],
      spell: avail.spellName,
      spellId: avail.spellId,
      facts: {
        // Render-grid fix (2026-08-30, same bug/fix as kick-eaten): t IS the
        // death instant, matched against the [DEATH] marker.
        t: fmtFactTime(deathT),
        victim: victim.name,
        owner: owner.name,
        external: avail.spellName,
        freeGapS: fmt(maxGap),
      },
    },
  ];
}

/**
 * questionable-external (17a): the consumer of annotateDefensiveTimings' sixth
 * tier ("Unnecessary") — an external (EXTERNAL_DEFENSIVE_IDS /
 * isAllyCastableDefensive whitelist) handed out in a no-pressure window
 * (target at high HP + no damage spike + no burst alignment; all three
 * conditions are already decided inside annotate, so here we only filter on
 * timingLabel). For the corpus-measured occurrence rate see the task-3 report
 * (the pre-gate numbers).
 * Filed under category "cooldowns"; NOT in OFFENSIVE_CANDIDATE_TYPES
 * (deepDive.ts), so it routes to survival by default — "spending what you
 * should have saved" is a survival-discipline issue, not an offensive one.
 *
 * nearestBurstGapS is read straight off cast.nearestBurstGapS —
 * annotateDefensiveTimings already computed it while deciding Unnecessary,
 * holding enemyCDTimeline.alignedBurstWindows; we do not re-derive the window
 * geometry here (single-source predicate).
 */
export function questionableExternalEvents(
  cds: Pick<IMajorCooldownInfo, "spellId" | "spellName" | "casts">[],
  caster: { id: string; name: string },
): CandidateEvent[] {
  const out: CandidateEvent[] = [];
  for (const cd of cds) {
    for (const cast of cd.casts) {
      if (cast.timingLabel !== "Unnecessary") continue;
      const t = cast.timeSeconds;
      out.push({
        id: `questionable-external:${caster.id}:${Math.round(t)}`,
        type: "questionable-external",
        t,
        unitNames: [caster.name, cast.targetName ?? caster.name],
        spell: cd.spellName,
        spellId: cd.spellId,
        facts: {
          t: fmt(t),
          spell: cd.spellName,
          caster: caster.name,
          target: cast.targetName ?? caster.name,
          targetHp:
            cast.targetHpPct !== undefined ? fmt(cast.targetHpPct) : "n/a",
          nearestBurstGapS:
            cast.nearestBurstGapS !== undefined
              ? fmt(cast.nearestBurstGapS)
              : "n/a",
        },
      });
    }
  }
  return out;
}

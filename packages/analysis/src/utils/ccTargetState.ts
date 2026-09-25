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
 *  - owner: alive, the CC reaction-ready (`cdReadyInTimeAt`), not CC'd
 *    (`buildCannotCastIntervals`), not inside an own casting-lockout aura
 *    (DB2 aura 60 / 263 — Bladestorm, Ice Block);
 *  - target: alive, not already inside a CC aura, no active aura that blocks
 *    the CC's mechanic (`auraBlocksMechanic`; unknown → blocked);
 *  - geometry: both positions known, distance ≤ the owner's single-target
 *    reach (`ccThreatReachYards` — cast range, else a caster-centred radius),
 *    LoS not falsified;
 *  - DR for the CC's category not Immune (`getDRLevel` over the target's
 *    recorded CC history);
 *  - the target holds no ready breaker of its own for that mechanic
 *    (`kitSpellReadyAt`): a designed breaker (the mechanic is on its own DB2
 *    aura 77 — corpus-confirmed pressed from inside that CC) or a full-school
 *    immunity the official usable-while attribute allows in that state.
 */
import type { AtomicArenaCombat, ICombatUnit } from "@gladlog/parser-compat";

import { ccSpellIds } from "../data/spellTags";
import { buildAuraIntervals, type IAuraInterval } from "./auraIntervals";
import { buildCannotCastIntervals } from "./cannotCastIntervals";
import {
  cdReadyInTimeAt,
  type IMajorCooldownInfo,
  kitSpellReadyAt,
  playerTalentIdSets,
  USABLE_WHILE_CC_SPELL_IDS,
  USABLE_WHILE_CONFUSED_SPELL_IDS,
  USABLE_WHILE_FEARED_SPELL_IDS,
} from "./cooldowns";
import { getDRCategory, getDRLevel } from "./drAnalysis";
import {
  distanceBetween,
  getUnitPositionAtTime,
  hasLineOfSight,
} from "./losAnalysis";
import { INTERP_MAX_GAP_MS } from "./positionSampling";
import {
  auraBlocksMechanic,
  auraLocksCasting,
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
  summary:
    { trinketUseTimes: number[]; trinketCooldownSeconds: number } | undefined,
  s: number,
): boolean | null {
  if (!summary) return null;
  return !summary.trinketUseTimes.some(
    (u) => Math.floor(u) <= s && s < u + summary.trinketCooldownSeconds,
  );
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
  // usable-while attribute says it can be pressed in that state (user ruling
  // 2026-09-04: neither is usable while stunned).
  return [...ids].filter(
    (id) =>
      explicitlyBreaksMechanic(id, mech) ||
      (auraBlocksMechanic(id, mech) === true &&
        (usableIn === null || usableIn.has(id))),
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
  const cat = getDRCategory(cd.spellId);
  const deathS = (u: ICombatUnit) => {
    const d = u.deathRecords[0];
    return d ? (d.timestamp - start) / 1000 : Infinity;
  };
  const ownerDeath = deathS(owner);
  const cannot = buildCannotCastIntervals(owner, new Set(params.enemyIds));
  const locks: Interval[] = buildAuraIntervals(owner, combat)
    .filter((iv) => auraLocksCasting(iv.spellId))
    .map((iv) => ({
      from: start + iv.fromS * 1000,
      to: start + iv.toS * 1000,
    }));
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
      drHistory: Array<{ applyMs: number; removeMs: number; spellId: string }>;
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
        blockers: auras.filter(
          (iv) => auraBlocksMechanic(iv.spellId, mech) !== false,
        ),
        drHistory: cc
          .filter((iv) => getDRCategory(iv.spellId) === cat)
          .map((iv) => ({
            applyMs: start + iv.fromS * 1000,
            removeMs: start + iv.toS * 1000,
            spellId: iv.spellId,
          })),
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
      const po = getUnitPositionAtTime(owner, ms, INTERP_MAX_GAP_MS);
      const pt = getUnitPositionAtTime(target, ms, INTERP_MAX_GAP_MS);
      if (!po || !pt) return { ok: false, reason: "no-position" };
      const dist = distanceBetween(po, pt);
      if (dist > reach) return { ok: false, reason: "out-of-range" };
      if (hasLineOfSight(zone, po, pt) === false)
        return { ok: false, reason: "los" };
      const dr = cat
        ? getDRLevel(
            f.drHistory.filter((h) => h.applyMs < ms),
            ms,
          ).level
        : "n/a";
      if (dr === "Immune") return { ok: false, reason: "dr-immune" };
      if (
        f.tools.some((id) => kitSpellReadyAt(target, id, s, start, f.talents))
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

import {
  CombatUnitPowerType,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import {
  CAST_PARAM_DURATIONS,
  SUPERCHARGED_FINISHERS,
} from "../data/castParamDurations";
import { talentRankOf } from "./talentOwnership";

/** How far before an aura's application its producing cast may land. The
 * empower press / finisher and the aura it applies share a timestamp or sit
 * a server tick apart; 400 ms covers the batching without reaching the
 * previous cast (breaths and finishers are ≥ 1 GCD apart). */
export const CAST_PARAM_WINDOW_MS = 400;

/** The fields `castParamAt` reads; callers without them get `null`. */
export type CastParamCaster = Partial<
  Pick<
    ICombatUnit,
    "spellCastEvents" | "empowerEnds" | "advancedActions" | "spec" | "info"
  >
>;

/**
 * The combo points a supercharged point added to the finisher this caster
 * pressed at `castTs` (`SUPERCHARGED_FINISHERS`): the charging press leaves
 * one point per Supercharger rank, each damaging finisher after it takes
 * one. 0 without the talent's rank read from the loadout (`talentRankOf`: an
 * unread rank never lengthens), for a spec not listed, or with no point left.
 */
export function superchargedPointsAt(
  caster: CastParamCaster | undefined,
  castTs: number,
): number {
  const spec = caster?.spec;
  const cfg =
    spec === undefined ? undefined : SUPERCHARGED_FINISHERS.bySpec[spec];
  if (!caster || !cfg || spec === undefined) return 0;
  const unit = {
    spec,
    info: caster.info,
    spellCastEvents: caster.spellCastEvents ?? [],
  };
  const rank = talentRankOf(unit, SUPERCHARGED_FINISHERS.talentSpellId);
  if (rank <= 0) return 0;
  let left = 0;
  let at: number | null = null;
  for (const c of unit.spellCastEvents) {
    if (c.logLine?.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
    const t = c.logLine.timestamp;
    if (t > castTs) continue;
    const id = String(c.spellId);
    if (cfg.chargeCastIds.includes(id)) left = rank;
    else if (cfg.finisherCastIds.includes(id)) {
      if (t === castTs) at = left;
      left = Math.max(0, left - 1);
    }
  }
  if (at === null || at <= 0) return 0;
  return (
    SUPERCHARGED_FINISHERS.pointsPerCharge +
    (talentRankOf(unit, SUPERCHARGED_FINISHERS.bonusTalentSpellId) > 0
      ? SUPERCHARGED_FINISHERS.bonusPoints
      : 0)
  );
}

/** How far after its aura a finisher's own cast row may be logged. */
export const CAST_PARAM_TRAIL_MS = 5;

/**
 * The parameter of the cast that produced `auraId` at `atMs` — the empower
 * level (1-based, from `SPELL_EMPOWER_END`) or the combo points the finisher
 * spent (the combo-point entry of the caster's advanced sample AT the
 * SPELL_CAST_SUCCESS: that snapshot is taken before the cost, and the
 * combo-point ledger closes 97.2 % — docs/log-observability-audit.md
 * direction 3; plus the points a consumed supercharged point stands for,
 * `superchargedPointsAt`). `null` when the aura is not parameter-scaled, or no producing
 * cast is within CAST_PARAM_WINDOW_MS before `atMs`, or the sample is missing.
 *
 * Single predicate (GH #65 item 1, 2026-09-23): `buffFullDurationForCaster`
 * prices with it and `castParamDurationScan.ts` measures with it.
 */
export function castParamAt(
  caster: CastParamCaster | undefined,
  auraId: string,
  atMs: number,
): number | null {
  const cfg = CAST_PARAM_DURATIONS[auraId];
  if (!cfg || !caster) return null;
  if (cfg.param === "empower") {
    let best: { dt: number; level: number } | null = null;
    for (const e of caster.empowerEnds ?? []) {
      if (!cfg.castIds.includes(String(e.spellId))) continue;
      const dt = atMs - e.logLine.timestamp;
      if (dt >= 0 && dt <= CAST_PARAM_WINDOW_MS && (!best || dt < best.dt))
        best = { dt, level: e.level };
    }
    if (best) return best.level >= 1 ? best.level : null;
    // Tip the Scales: no empower at all — the cast row and its effect, no
    // SPELL_EMPOWER_END in between, at the spell's maximum level
    for (const c of caster.spellCastEvents ?? []) {
      if (c.logLine?.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      const level = cfg.maxLevelByCastId?.[String(c.spellId)];
      if (level === undefined) continue;
      const dt = atMs - c.logLine.timestamp;
      if (dt < 0 || dt > CAST_PARAM_WINDOW_MS) continue;
      const released = (caster.empowerEnds ?? []).some(
        (e) =>
          String(e.spellId) === String(c.spellId) &&
          e.logLine.timestamp >= c.logLine.timestamp &&
          e.logLine.timestamp <= atMs,
      );
      if (!released) return level;
    }
    return null;
  }
  let castTs: number | null = null;
  for (const c of caster.spellCastEvents ?? []) {
    if (c.logLine?.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
    if (!cfg.castIds.includes(String(c.spellId))) continue;
    const dt = atMs - c.logLine.timestamp;
    // the cast row can trail its aura by a ms or two (codex 62-POSTHOC-13e
    // #2: an Envenom cast 1 ms after its aura was rejected — 49 of 322
    // finisher applications in 20 files read a 0 s duration)
    if (dt >= -CAST_PARAM_TRAIL_MS && dt <= CAST_PARAM_WINDOW_MS)
      castTs = c.logLine.timestamp;
  }
  if (castTs === null) return null;
  for (const s of caster.advancedActions ?? []) {
    if (s.timestamp !== castTs) continue;
    const cp = (s.advancedActorPowers ?? []).find(
      (p) => p.type === CombatUnitPowerType.ComboPoints,
    );
    if (cp) {
      const n = Math.min(cp.current, cp.max);
      // a supercharged point counts on top of the points the bar held
      return n >= 1 ? n + superchargedPointsAt(caster, castTs) : null;
    }
  }
  return null;
}

/** The parameter-set base duration, or `null` when the parameter is unknown. */
export function castParamBaseSeconds(
  caster: CastParamCaster | undefined,
  auraId: string,
  atMs: number,
): number | null {
  const cfg = CAST_PARAM_DURATIONS[auraId];
  const p = castParamAt(caster, auraId, atMs);
  if (!cfg || p === null) return null;
  const d = cfg.baseSeconds + cfg.perUnitSeconds * p;
  return d > 0 ? d : null;
}

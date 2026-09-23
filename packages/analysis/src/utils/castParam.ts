import {
  CombatUnitPowerType,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import { CAST_PARAM_DURATIONS } from "../data/castParamDurations";

/** How far before an aura's application its producing cast may land. The
 * empower press / finisher and the aura it applies share a timestamp or sit
 * a server tick apart; 400 ms covers the batching without reaching the
 * previous cast (breaths and finishers are ≥ 1 GCD apart). */
export const CAST_PARAM_WINDOW_MS = 400;

/** The fields `castParamAt` reads; callers without them get `null`. */
export type CastParamCaster = Partial<
  Pick<ICombatUnit, "spellCastEvents" | "empowerEnds" | "advancedActions">
>;

/**
 * The parameter of the cast that produced `auraId` at `atMs` — the empower
 * level (1-based, from `SPELL_EMPOWER_END`) or the combo points the finisher
 * spent (the combo-point entry of the caster's advanced sample AT the
 * SPELL_CAST_SUCCESS: that snapshot is taken before the cost, and the
 * combo-point ledger closes 97.2 % — docs/log-observability-audit.md
 * direction 3). `null` when the aura is not parameter-scaled, or no producing
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
    return best && best.level >= 1 ? best.level : null;
  }
  let castTs: number | null = null;
  for (const c of caster.spellCastEvents ?? []) {
    if (c.logLine?.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
    if (!cfg.castIds.includes(String(c.spellId))) continue;
    const dt = atMs - c.logLine.timestamp;
    if (dt >= 0 && dt <= CAST_PARAM_WINDOW_MS) castTs = c.logLine.timestamp;
  }
  if (castTs === null) return null;
  for (const s of caster.advancedActions ?? []) {
    if (s.timestamp !== castTs) continue;
    const cp = (s.advancedActorPowers ?? []).find(
      (p) => p.type === CombatUnitPowerType.ComboPoints,
    );
    if (cp) {
      const n = Math.min(cp.current, cp.max);
      return n >= 1 ? n : null;
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

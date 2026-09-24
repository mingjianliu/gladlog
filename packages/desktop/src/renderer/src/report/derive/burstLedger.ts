import {
  analyzeBurstLedger,
  analyzeKickAudit,
  analyzeKillWindowTargetSelection,
  auditWindowTargeting,
  computeOffensiveWindows,
  type IBurstLedgerEntry,
  type IKickAuditEntry,
  type IKillWindowTargetEval,
  isHealerSpec,
  type IWindowTargetingAudit,
} from "@gladlog/analysis";
import { CombatUnitReaction } from "@gladlog/parser-compat";

import { toLegacySafe } from "./legacySource";
import type { ReportSource } from "./types";

export interface LedgerPlayer {
  unitId: string;
  name: string;
  classId: number;
  isHealer: boolean;
  bursts: IBurstLedgerEntry[];
  targeting: IWindowTargetingAudit[];
  kicks: IKickAuditEntry[];
}

interface BurstLedgerResult {
  players: LedgerPlayer[];
  /** Kill-window target-selection verdicts (team level, independent of which
   * friendly player — one snapshot of all enemies per window batch, never
   * recomputed per player). Single-source predicate:
   * analyzeKillWindowTargetSelection; a window produces no entry when there are
   * fewer than 2 enemies or the window is shorter than 5s. */
  targetSelection: IKillWindowTargetEval[];
}

const EMPTY_RESULT: BurstLedgerResult = { players: [], targetSelection: [] };

/**
 * Burst ledger (DPS direction D1): per friendly player, burst alignment /
 * kill-window target discipline / interrupt audit, plus the team-level
 * kill-window target-selection verdict. Every verdict consumes an analysis
 * predicate (analyzeBurstLedger / auditWindowTargeting / analyzeKickAudit /
 * analyzeKillWindowTargetSelection), sharing the same CD/window predicates as
 * the enemy CD timeline and the colour bands. DPS come first (the ledger mainly
 * targets DPS) and healers last; a player with nothing at all gets no row.
 */
export function deriveBurstLedger(source: ReportSource): BurstLedgerResult {
  try {
    const legacy = toLegacySafe(source);
    const players = Object.values(legacy.units).filter((u) => u.info);
    const friendlies = players.filter(
      (u) => u.reaction === CombatUnitReaction.Friendly,
    );
    const enemies = players.filter(
      (u) => u.reaction === CombatUnitReaction.Hostile,
    );
    if (friendlies.length === 0 || enemies.length === 0) return EMPTY_RESULT;

    // The windows (against enemy targets) are shared by all players and computed
    // once — the same predicate as vulnWindows.
    const windows = computeOffensiveWindows(enemies, friendlies, legacy);
    const targetSelection = analyzeKillWindowTargetSelection(
      windows,
      enemies,
      legacy,
    );

    const out: LedgerPlayer[] = [];
    for (const p of friendlies) {
      const allies = friendlies.filter((f) => f.id !== p.id);
      const bursts = analyzeBurstLedger(p, allies, enemies, legacy);
      const targeting = auditWindowTargeting(p, windows, enemies, legacy);
      const kicks = analyzeKickAudit(p, enemies, legacy);
      if (bursts.length + targeting.length + kicks.length === 0) continue;
      out.push({
        unitId: p.id,
        name: p.name,
        classId: Number(p.class),
        isHealer: isHealerSpec(p.spec),
        bursts,
        targeting,
        kicks,
      });
    }
    return {
      players: out.sort((a, b) => (a.isHealer ? 1 : 0) - (b.isHealer ? 1 : 0)),
      targetSelection,
    };
  } catch {
    return EMPTY_RESULT;
  }
}

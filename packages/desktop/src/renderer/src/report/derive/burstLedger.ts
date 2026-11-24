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
import { sourceMemo } from "./sourceMemo";
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
function deriveBurstLedgerUncached(source: ReportSource): BurstLedgerResult {
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

/** deriveBurstLedgerUncached, kept per source object across mounts (see sourceMemo.ts). */
export function deriveBurstLedger(source: ReportSource): ReturnType<typeof deriveBurstLedgerUncached> {
  return sourceMemo(source, "deriveBurstLedger", () => deriveBurstLedgerUncached(source));
}

/**
 * The burst row's CD list for display: casts of the same spell inside one
 * burst collapse to `Name ×N` (a burst opened by two casts of one CD read
 * `Incarnation + Incarnation`). Cast order of first appearance is kept. The
 * prompt keeps every cast with its own span (`formatBurstSpells`); this is the
 * card's label only.
 */
export function burstSpellsLabel(
  spells: ReadonlyArray<{ spellName: string }>,
): string {
  const counts = new Map<string, number>();
  for (const s of spells) counts.set(s.spellName, (counts.get(s.spellName) ?? 0) + 1);
  return [...counts]
    .map(([name, n]) => (n > 1 ? `${name} ×${n}` : name))
    .join(" + ");
}

/**
 * The 协同 chip's content: one entry per ally, with the CDs of theirs that
 * overlapped the burst. `allyCDsOverlapping` holds one item per CD, so an ally
 * who pressed three read as their name three times.
 */
export function groupAllyOverlaps(
  overlaps: ReadonlyArray<{ playerName: string; spellName: string }>,
): Array<{ playerName: string; spellNames: string[] }> {
  const byPlayer = new Map<string, string[]>();
  for (const o of overlaps) {
    const list = byPlayer.get(o.playerName) ?? [];
    if (!list.includes(o.spellName)) list.push(o.spellName);
    byPlayer.set(o.playerName, list);
  }
  return [...byPlayer].map(([playerName, spellNames]) => ({
    playerName,
    spellNames,
  }));
}

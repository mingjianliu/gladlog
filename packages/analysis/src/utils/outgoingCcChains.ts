/**
 * outgoingCcChains.ts — the outgoing CC chains with the incoming walk's
 * length evidence (GH #190).
 *
 * Inside `DR_RESET_TICK_MS` after the 12.1 reset window the DR walk reads a
 * control's own logged length (fact10 D9), and that length is evidence only
 * when nothing but the game ended the control (`ccLengthIsDrEvidence`: a
 * damage break, a dispel, the holder's trinket or break press, a control
 * immunity at the removal, an immunity press or a stopped channel each end
 * it wherever it was). The incoming walk (`analyzePlayerCCAndTrinket`) has
 * read it so since codex 20-F25-04 #2; the outgoing walk lives in
 * `drAnalysis.ts`, which `ccTrinketAnalysis.ts` imports — importing the
 * predicate back put `drAnalysis` inside the `ccTrinketAnalysis →
 * enemyDefensives → cooldownTiming` cycle, whose top-level
 * `HARD_CC_CATEGORIES` reads `DR_CATEGORY_MAP` before `drAnalysis` had run.
 * So the walk takes the predicate as a parameter, and this module — outside
 * that cycle's initialisation path — is the one place that passes it. Every
 * reader of the outgoing chains imports from here.
 */
import type {
  IArenaMatch,
  ICombatUnit,
  IShuffleRound,
} from "@gladlog/parser-compat";

import { ccLengthIsDrEvidence } from "./ccTrinketAnalysis";
import {
  analyzeOutgoingCCChainsWith,
  type IOutgoingCCChain,
} from "./drAnalysis";

/**
 * Scans enemy aura events for CC spells cast by friendly players. Returns
 * per-enemy CC chains annotated with DR levels — every enemy chain with at
 * least one landed CC (see `analyzeOutgoingCCChainsWith`).
 */
export function analyzeOutgoingCCChains(
  friendlies: ICombatUnit[],
  enemies: ICombatUnit[],
  combat: IArenaMatch | IShuffleRound,
): IOutgoingCCChain[] {
  return analyzeOutgoingCCChainsWith(
    friendlies,
    enemies,
    combat,
    ccLengthIsDrEvidence,
  );
}

/**
 * `analyzeOutgoingCCChains`, plus the targets whose chain holds only DR-only
 * entries (`drHistory`) — read by the healer-lock windows
 * (`enemyHealerCcWindows`), which take a healer's own control reflected
 * back onto it (`reflectedOntoTarget`) as a lock (fact10 D21 follow-up,
 * user ruling 2026-11-05).
 */
export function outgoingCcChainsWithDrHistory(
  friendlies: ICombatUnit[],
  enemies: ICombatUnit[],
  combat: IArenaMatch | IShuffleRound,
): IOutgoingCCChain[] {
  return analyzeOutgoingCCChainsWith(
    friendlies,
    enemies,
    combat,
    ccLengthIsDrEvidence,
    true,
  );
}

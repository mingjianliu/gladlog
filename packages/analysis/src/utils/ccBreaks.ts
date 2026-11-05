/**
 * ccBreaks.ts — the CC break stats with the DR walks' length evidence (GH
 * #190 follow-up).
 *
 * `ccRemainingSeconds` reads the DR an application landed at over the
 * holder's history (`buildCcCategoryHistory`), and inside `DR_RESET_TICK_MS`
 * that history reads a control's logged length — evidence only when nothing
 * but the game ended it (`ccLengthIsDrEvidence`). `ccBreakAnalysis.ts` is
 * imported by `ccTrinketAnalysis.ts` and cannot import the predicate back, so
 * `analyzeCcBreaksWith` takes it as a parameter and this module — outside
 * that graph — is the one place that passes it (the `outgoingCcChains.ts`
 * pattern). Every reader of the break stats imports from here.
 */
import type { ICombatUnit } from "@gladlog/parser-compat";

import { analyzeCcBreaksWith, type ICcBreakStats } from "./ccBreakAnalysis";
import { ccLengthIsDrEvidence } from "./ccTrinketAnalysis";

/** Every CC break of both sides, with the DR walks' length evidence (see
 * `analyzeCcBreaksWith`). */
export function analyzeCcBreaks(
  friends: ICombatUnit[],
  enemies: ICombatUnit[],
  combat: Parameters<typeof analyzeCcBreaksWith>[3],
  friendlyPets: ICombatUnit[] = [],
  enemyPets: ICombatUnit[] = [],
): ICcBreakStats {
  return analyzeCcBreaksWith(
    ccLengthIsDrEvidence,
    friends,
    enemies,
    combat,
    friendlyPets,
    enemyPets,
  );
}

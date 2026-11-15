import { getEnglishSpellName } from "./spellEffectData";

/**
 * Same-button SECOND STAGES (pipeline T99, user ruling R45 2026-11-15): the
 * id a cooldown's button logs when it is pressed again to end what its first
 * press started — Alter Time's return, Stasis' release. It has no DB2
 * cooldown of its own, so the ledger's press identity (`isPressOfCooldown`)
 * does not name it; a refused row of it under a control is still a press of
 * that cooldown the player made (`pressed during it`). Not a triggered
 * sub-effect (The Hunt 370966 / 1246169, its charge's impact): only the ids
 * listed here.
 *
 * `readyAuraId`: the aura the first press leaves up and the second stage
 * ends (Alter Time 342246; Stasis 370562, the "stored, ready to release"
 * aura that follows 370537). The user also ruled (R45) that the second stage
 * of these buttons fires through `/cancelaura` while controlled; scan5/t99
 * `secondStageUnderControl` checks it per spell in the corpus.
 *
 * Ids from the 605 corpus (every same-named refused row with no cooldown of
 * its own: 342247, 370564, and The Hunt's 370966 / 1246169). Registered in
 * curatedIdRegistry.
 */
export interface ISecondStage {
  /** the cooldown the button belongs to (its first press) */
  firstStageId: string;
  /** the aura the first press leaves up and this stage ends */
  readyAuraId: string;
}

export const SECOND_STAGE_PRESSES: ReadonlyMap<string, ISecondStage> = new Map([
  // Alter Time: 342245 puts up 342246; the return logs 342247
  ["342247", { firstStageId: "342245", readyAuraId: "342246" }],
  // Stasis: 370537 stores three spells, then 370562 waits for the
  // release, which logs 370564
  ["370564", { firstStageId: "370537", readyAuraId: "370562" }],
]);

/** The printed names of the cooldowns a listed second stage belongs to —
 *  the items that may carry `SECOND_STAGE_MACRO_NOTE` (the gate's
 *  `checkPressedDuringControlNote`). Read on call: the name table loads with
 *  the analysis data. */
export function secondStageCooldownNames(): Set<string> {
  return new Set(
    [...SECOND_STAGE_PRESSES.values()].map((s) =>
      getEnglishSpellName(s.firstStageId),
    ),
  );
}

/**
 * Corpus-level table of the healing spells enemy healers HARDCAST in arena
 * (GH #78, codex round-2 concession 2026-09-12): a spell is eligible for a
 * kick-priority decision point iff it is in this table — NOT iff it was
 * observed completing somewhere in the same round. The per-round rule was
 * outcome-dependent (a spell that was only ever kicked in a round could never
 * qualify, so the "kicked" arm was under-counted and the qualification leaked
 * future information); this table is computed once from the whole archive
 * (completed hardcasts 1–4 s that landed as SPELL_HEAL, n ≥ 50) and read the
 * same way on both arms. `medianCastS` is the nominal cast length used for
 * every feasibility check, so an interrupted cast is not judged on the
 * shorter time it actually ran.
 *
 * Regenerate: `kickPriorityOutcomeProbe.ts emit-heal-spells --in <scan.jsonl>`
 * (docs/commands/update-wow-data.md §6b-pre-6).
 */
import raw from "./kickPriorityHealSpellsGenerated.json";

export interface HardcastHealSpell {
  name: string;
  n: number;
  medianCastS: number;
}

const TABLE = (
  raw as unknown as { spells: Record<string, HardcastHealSpell | undefined> }
).spells;

export function hardcastHealSpell(spellId: string): HardcastHealSpell | null {
  const s = TABLE[spellId];
  return s && s.n > 0 && s.medianCastS > 0 ? s : null;
}

export const HARDCAST_HEAL_SPELL_IDS: readonly string[] = Object.keys(TABLE);

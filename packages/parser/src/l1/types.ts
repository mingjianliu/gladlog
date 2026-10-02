import {
  decodeBaseUnits,
  decodeSpell,
  decodeDamage,
  decodeHeal,
  decodeAdvanced,
  decodeAura,
  decodeExtraSpell,
  decodeAbsorbed,
  decodeArenaStart,
  decodeArenaEnd,
  decodeMissed,
  decodeHealAbsorbed,
} from "./decoders";
import { decodeCombatantInfo } from "./combatantInfo";

export interface ParsedLine {
  timestamp: number;
  eventName: string;
  known: boolean;
  params: string[];
  raw: string;
  /** This line's index within its match's rawLines (= the raw.txt written to
   * disk). Assigned during L2 segmentation; lines outside a segment have none.
   * The anchor for the B2 provenance deep link (event → raw line). */
  lineIndex?: number;
  base?: ReturnType<typeof decodeBaseUnits>;
  spell?: ReturnType<typeof decodeSpell>;
  damage?: ReturnType<typeof decodeDamage>;
  heal?: ReturnType<typeof decodeHeal>;
  advanced?: ReturnType<typeof decodeAdvanced>;
  aura?: ReturnType<typeof decodeAura>;
  extraSpell?: ReturnType<typeof decodeExtraSpell>;
  absorbed?: ReturnType<typeof decodeAbsorbed>;
  arenaStart?: ReturnType<typeof decodeArenaStart>;
  arenaEnd?: ReturnType<typeof decodeArenaEnd>;
  combatantInfo?: NonNullable<ReturnType<typeof decodeCombatantInfo>>;
  unitDied?: { unconscious: boolean };
  /** `*_MISSED` outcome. IMMUNE/REFLECT are the classes no other event carries;
   * ABSORB duplicates the line's own SPELL_ABSORBED — see decodeMissed. */
  missed?: ReturnType<typeof decodeMissed>;
  /** `SPELL_HEAL_ABSORBED` — healing eaten by a heal-absorb debuff. */
  healAbsorbed?: ReturnType<typeof decodeHealAbsorbed>;
  /** The trailing field of `SPELL_EMPOWER_END` and `SPELL_EMPOWER_INTERRUPT`:
   * how far the empowered cast was charged (Evoker) when it was released /
   * interrupted. Absent on `SPELL_EMPOWER_START`. */
  empowerLevel?: number;
}

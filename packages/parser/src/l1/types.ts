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
} from "./decoders";
import { decodeCombatantInfo } from "./combatantInfo";

export interface ParsedLine {
  timestamp: number;
  eventName: string;
  known: boolean;
  params: string[];
  raw: string;
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
}

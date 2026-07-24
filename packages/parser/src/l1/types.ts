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
  /** 本行在所属对局 rawLines(= 落盘 raw.txt)里的下标。L2 分段时赋值;
   * 段外的行没有。B2 溯源深链(事件 → 原始行)的锚点。 */
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
}

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
import { splitLine } from "./splitTopLevel";
import { parseTimestamp } from "./timestamp";
import { ParsedLine } from "./types";

function findXIdx(params: string[], at: number): number {
  let xIdx = at + 14;
  for (let i = at + 4; i < params.length - 1; i++) {
    const val1 = params[i];
    const val2 = params[i + 1];
    if (val1 !== undefined && val2 !== undefined && val1.includes(".") && val2.includes(".")) {
      xIdx = i;
      break;
    }
  }
  return xIdx;
}

export function parseLine(line: string, opts?: { timezone?: string }): ParsedLine | null {
  try {
    const split = splitLine(line);
    if (!split) return null;

    const { datePart, eventName, params } = split;

    if (eventName === "" && (params.length === 0 || params.every(p => p === ""))) {
      return null;
    }

    const timestamp = parseTimestamp(datePart, opts);
    if (timestamp === null) return null;

    const result: ParsedLine = {
      timestamp,
      eventName,
      known: false,
      params,
      raw: line,
    };

    let isKnown = true;

    if (eventName === "ARENA_MATCH_START") {
      result.arenaStart = decodeArenaStart(params);
    } else if (eventName === "ARENA_MATCH_END") {
      result.arenaEnd = decodeArenaEnd(params);
    } else if (eventName === "COMBATANT_INFO") {
      const info = decodeCombatantInfo(params);
      if (info !== null) {
        result.combatantInfo = info;
      }
    } else if (eventName === "SPELL_ABSORBED") {
      result.absorbed = decodeAbsorbed(params);
    } else if (eventName === "UNIT_DIED" || eventName === "PARTY_KILL") {
      result.base = decodeBaseUnits(params);
      if (eventName === "UNIT_DIED") {
        result.unitDied = {
          unconscious: params[8] === "1",
        };
      }
    } else if (eventName === "SWING_DAMAGE" || eventName === "SWING_DAMAGE_LANDED") {
      result.base = decodeBaseUnits(params);
      result.advanced = decodeAdvanced(params, 8);
      const xIdx = findXIdx(params, 8);
      const damageParams = (params.length - (xIdx + 5) >= 11) ? params.slice(-11) : params.slice(-10);
      result.damage = decodeDamage(damageParams);
    } else if (eventName.endsWith("_DAMAGE")) {
      result.base = decodeBaseUnits(params);
      result.spell = decodeSpell(params, 8);
      result.advanced = decodeAdvanced(params, 11);
      const xIdx = findXIdx(params, 11);
      const damageParams = (params.length - (xIdx + 5) >= 11) ? params.slice(-11) : params.slice(-10);
      result.damage = decodeDamage(damageParams);
    } else if (eventName.endsWith("_HEAL")) {
      result.base = decodeBaseUnits(params);
      result.spell = decodeSpell(params, 8);
      result.advanced = decodeAdvanced(params, 11);
      result.heal = decodeHeal(params.slice(-5));
    } else if (eventName === "SPELL_CAST_SUCCESS") {
      result.base = decodeBaseUnits(params);
      result.spell = decodeSpell(params, 8);
      result.advanced = decodeAdvanced(params, 11);
    } else if (
      eventName.endsWith("_AURA_APPLIED") ||
      eventName.endsWith("_AURA_REMOVED") ||
      eventName.endsWith("_AURA_REFRESH") ||
      eventName.endsWith("_AURA_APPLIED_DOSE") ||
      eventName.endsWith("_AURA_REMOVED_DOSE") ||
      eventName.endsWith("_AURA_BROKEN") ||
      eventName.endsWith("_AURA_BROKEN_SPELL")
    ) {
      result.base = decodeBaseUnits(params);
      result.spell = decodeSpell(params, 8);
      if (eventName.endsWith("_AURA_BROKEN_SPELL")) {
        result.extraSpell = decodeExtraSpell(params.slice(11));
        result.aura = decodeAura(params.slice(14));
      } else {
        result.aura = decodeAura(params.slice(11));
      }
    } else if (
      eventName === "SPELL_INTERRUPT" ||
      eventName === "SPELL_DISPEL" ||
      eventName === "SPELL_STOLEN" ||
      eventName === "SPELL_DISPEL_FAILED"
    ) {
      result.base = decodeBaseUnits(params);
      result.spell = decodeSpell(params, 8);
      result.extraSpell = decodeExtraSpell(params.slice(11));
    } else if (eventName.startsWith("SPELL_") || eventName.startsWith("RANGE_")) {
      const hasExcluded = eventName.includes("_ABSORBED") ||
                          eventName.includes("_AURA_") ||
                          eventName.includes("PERIODIC");
      if (!hasExcluded) {
        result.base = decodeBaseUnits(params);
        result.spell = decodeSpell(params, 8);
      } else {
        isKnown = false;
      }
    } else {
      isKnown = false;
    }

    result.known = isKnown;
    return result;
  } catch {
    return null;
  }
}

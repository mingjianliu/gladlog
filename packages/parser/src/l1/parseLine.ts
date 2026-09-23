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
  hpTailSlice,
} from "./decoders";
import { decodeCombatantInfo } from "./combatantInfo";
import { splitLine } from "./splitTopLevel";
import { parseTimestamp } from "./timestamp";
import type { ParsedLine } from "./types";

export function parseLine(
  line: string,
  opts?: { timezone?: string },
): ParsedLine | null {
  try {
    const split = splitLine(line);
    if (!split) return null;

    const { datePart, eventName, params } = split;

    if (
      eventName === "" &&
      (params.length === 0 || params.every((p) => p === ""))
    ) {
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
    } else if (
      eventName === "SWING_DAMAGE" ||
      eventName === "SWING_DAMAGE_LANDED"
    ) {
      result.base = decodeBaseUnits(params);
      result.spell = {
        spellId: 0,
        spellName: "Melee",
        spellSchool: 0,
      };
      result.advanced = decodeAdvanced(params, 8);
      const swingTail = hpTailSlice(eventName, params);
      if (swingTail) result.damage = decodeDamage(params, swingTail.offset);
    } else if (eventName === "ENVIRONMENTAL_DAMAGE") {
      // Falling damage and friends. No spell triple: the advanced block starts
      // right after the base units (its actor is the victim), and the
      // environment type ("Falling") sits just before the damage tail. Read
      // through the _DAMAGE branch below, every field landed one or three
      // slots off — amount NaN, spellId NaN, a bogus advanced actor — and the
      // NaN event still reached the victim's damageIn (GH #100 field ledger).
      result.base = decodeBaseUnits(params);
      result.advanced = decodeAdvanced(params, 8);
      const envTail = hpTailSlice(eventName, params);
      if (envTail) {
        result.damage = decodeDamage(params, envTail.offset);
        result.spell = {
          spellId: 0,
          spellName: params[envTail.offset - 1] ?? "",
          spellSchool: result.damage.school,
        };
      }
    } else if (eventName.endsWith("_DAMAGE") || eventName === "DAMAGE_SPLIT") {
      // DAMAGE_SPLIT (Blessing of Sacrifice, Soul Link, …) has the same shape.
      // Its src is NOT an attacker: measured on the 12.1 archive, src and dest
      // are TEAMMATES in 7,354 cases and opponents in 0 — src is the unit whose
      // damage is being redirected AWAY, dest is the one soaking it. L3 must
      // therefore route it to dest.damageIn only, never src.damageOut.
      result.base = decodeBaseUnits(params);
      result.spell = decodeSpell(params, 8);
      result.advanced = decodeAdvanced(params, 11);
      const dmgTail = hpTailSlice(eventName, params);
      if (dmgTail) result.damage = decodeDamage(params, dmgTail.offset);
    } else if (eventName === "SPELL_HEAL_ABSORBED") {
      result.healAbsorbed = decodeHealAbsorbed(params);
    } else if (eventName.endsWith("_HEAL")) {
      result.base = decodeBaseUnits(params);
      result.spell = decodeSpell(params, 8);
      result.advanced = decodeAdvanced(params, 11);
      const healTail = hpTailSlice(eventName, params);
      if (healTail) result.heal = decodeHeal(params, healTail.offset);
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
        result.extraSpell = decodeExtraSpell(params, 11);
        result.aura = decodeAura(params, 14);
      } else {
        result.aura = decodeAura(params, 11);
      }
    } else if (
      eventName === "SPELL_INTERRUPT" ||
      eventName === "SPELL_DISPEL" ||
      eventName === "SPELL_STOLEN" ||
      eventName === "SPELL_DISPEL_FAILED"
    ) {
      result.base = decodeBaseUnits(params);
      result.spell = decodeSpell(params, 8);
      result.extraSpell = decodeExtraSpell(params, 11);
    } else if (eventName === "SWING_MISSED") {
      // No spell triple on a swing, so the outcome fields start right after the
      // base units.
      result.base = decodeBaseUnits(params);
      result.missed = decodeMissed(params, 8);
    } else if (
      eventName === "SPELL_MISSED" ||
      eventName === "SPELL_PERIODIC_MISSED" ||
      eventName === "RANGE_MISSED"
    ) {
      result.base = decodeBaseUnits(params);
      result.spell = decodeSpell(params, 8);
      result.missed = decodeMissed(params, 11);
    } else if (
      eventName === "SPELL_EMPOWER_START" ||
      eventName === "SPELL_EMPOWER_END"
    ) {
      result.base = decodeBaseUnits(params);
      result.spell = decodeSpell(params, 8);
      // END carries the charge level it was released at as its last field;
      // START has no such field.
      if (eventName === "SPELL_EMPOWER_END") {
        const level = parseInt(params[params.length - 1] ?? "", 10);
        if (!Number.isNaN(level)) result.empowerLevel = level;
      }
    } else if (
      eventName.startsWith("SPELL_") ||
      eventName.startsWith("RANGE_")
    ) {
      const hasExcluded =
        eventName.includes("_ABSORBED") ||
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

import type { ParsedLine } from "../l1/types";
import type { RosterUnit } from "./roster";
import type {
  GladUnit,
  GladHpEvent,
  GladAbsorbEvent,
  GladSpellEvent,
  GladAuraEvent,
  GladDeathEvent,
} from "./model";

export function collectEvents(
  records: ParsedLine[],
  roster: { ownerId: string | null; units: Map<string, RosterUnit> }
): Map<string, GladUnit> {
  const gladUnits = new Map<string, GladUnit>();

  for (const [id, rosterUnit] of roster.units.entries()) {
    gladUnits.set(id, {
      id: rosterUnit.id,
      name: rosterUnit.name ?? "",
      ownerId: rosterUnit.ownerId,
      kind: rosterUnit.kind,
      reaction: rosterUnit.reaction,
      classId: 0,
      specId: 0,
      damageOut: [],
      damageIn: [],
      healOut: [],
      healIn: [],
      absorbsOut: [],
      absorbsIn: [],
      casts: [],
      petCasts: [],
      auraEvents: [],
      actionsOut: [],
      actionsIn: [],
      deaths: [],
      unconsciousEvents: [],
      advancedSamples: [],
    });
  }

  for (const record of records) {
    const srcGuid = record.base?.srcGuid;
    const destGuid = record.base?.destGuid;

    // 1. Damage group
    if (record.damage) {
      const hpEvent: GladHpEvent = {
        timestamp: record.timestamp,
        eventName: record.eventName,
        spellId: record.spell?.spellId ?? 0,
        spellName: record.spell?.spellName ?? "",
        srcId: srcGuid ?? "",
        srcName: record.base?.srcName ?? "",
        destId: destGuid ?? "",
        destName: record.base?.destName ?? "",
        amount: record.damage.amount,
        effectiveAmount: record.damage.effectiveAmount,
      };

      if (srcGuid && srcGuid !== "0000000000000000") {
        const srcUnit = gladUnits.get(srcGuid);
        if (srcUnit) {
          srcUnit.damageOut.push(hpEvent);
        }
      }

      if (destGuid && destGuid !== "0000000000000000") {
        const destUnit = gladUnits.get(destGuid);
        if (destUnit) {
          destUnit.damageIn.push(hpEvent);
        }
      }
    }

    // 2. Heal group
    if (record.heal) {
      const hpEvent: GladHpEvent = {
        timestamp: record.timestamp,
        eventName: record.eventName,
        spellId: record.spell?.spellId ?? 0,
        spellName: record.spell?.spellName ?? "",
        srcId: srcGuid ?? "",
        srcName: record.base?.srcName ?? "",
        destId: destGuid ?? "",
        destName: record.base?.destName ?? "",
        amount: record.heal.amount,
        effectiveAmount: record.heal.effectiveAmount,
      };

      if (srcGuid && srcGuid !== "0000000000000000") {
        const srcUnit = gladUnits.get(srcGuid);
        if (srcUnit) {
          srcUnit.healOut.push(hpEvent);
        }
      }

      if (destGuid && destGuid !== "0000000000000000") {
        const destUnit = gladUnits.get(destGuid);
        if (destUnit) {
          destUnit.healIn.push(hpEvent);
        }
      }
    }

    // 3. Absorbed group
    if (record.absorbed) {
      const absorbDestGuid = record.params[0] ?? "";
      const destNameRaw = record.params[1];
      const absorbDestName = (destNameRaw === "nil" || destNameRaw === undefined) ? "" : destNameRaw;

      const absorbEvent: GladAbsorbEvent = {
        timestamp: record.timestamp,
        eventName: record.eventName,
        spellId: record.absorbed.shieldSpellId,
        spellName: record.absorbed.shieldSpellName,
        srcId: record.absorbed.shieldOwnerGuid,
        srcName: (record.absorbed.shieldOwnerName === "nil" || !record.absorbed.shieldOwnerName) ? "" : record.absorbed.shieldOwnerName,
        destId: absorbDestGuid,
        destName: absorbDestName,
        absorbedAmount: record.absorbed.absorbedAmount,
      };

      if (absorbEvent.srcId && absorbEvent.srcId !== "0000000000000000") {
        const srcUnit = gladUnits.get(absorbEvent.srcId);
        if (srcUnit) {
          srcUnit.absorbsOut.push(absorbEvent);
        }
      }

      if (absorbEvent.destId && absorbEvent.destId !== "0000000000000000") {
        const destUnit = gladUnits.get(absorbEvent.destId);
        if (destUnit) {
          destUnit.absorbsIn.push(absorbEvent);
        }
      }
    }

    // 4. Aura group
    if (record.aura) {
      const auraEvent: GladAuraEvent = {
        timestamp: record.timestamp,
        eventName: record.eventName,
        spellId: record.spell?.spellId ?? 0,
        spellName: record.spell?.spellName ?? "",
        srcId: srcGuid ?? "",
        srcName: record.base?.srcName ?? "",
        destId: destGuid ?? "",
        destName: record.base?.destName ?? "",
        auraType: record.aura.auraType,
        amount: record.aura.amount,
      };

      if (destGuid && destGuid !== "0000000000000000") {
        const destUnit = gladUnits.get(destGuid);
        if (destUnit) {
          destUnit.auraEvents.push(auraEvent);
        }
      }
    }

    // 5. SPELL_CAST_SUCCESS
    if (record.eventName === "SPELL_CAST_SUCCESS") {
      const spellEvent: GladSpellEvent = {
        timestamp: record.timestamp,
        eventName: record.eventName,
        spellId: record.spell?.spellId ?? 0,
        spellName: record.spell?.spellName ?? "",
        srcId: srcGuid ?? "",
        srcName: record.base?.srcName ?? "",
        destId: destGuid ?? "",
        destName: record.base?.destName ?? "",
      };

      if (srcGuid && srcGuid !== "0000000000000000") {
        const srcUnit = gladUnits.get(srcGuid);
        if (srcUnit) {
          srcUnit.casts.push(spellEvent);
          if (
            (srcUnit.kind === "Pet" || srcUnit.kind === "Guardian") &&
            srcUnit.ownerId
          ) {
            const ownerUnit = gladUnits.get(srcUnit.ownerId);
            if (ownerUnit) {
              ownerUnit.petCasts.push(spellEvent);
            }
          }
        }
      }
    }

    // 6. UNIT_DIED
    if (record.eventName === "UNIT_DIED") {
      const lastParam = record.params[record.params.length - 1];
      const unconscious = record.unitDied?.unconscious ?? (lastParam === "1");

      const deathEvent: GladDeathEvent = {
        timestamp: record.timestamp,
        eventName: record.eventName,
        spellId: 0,
        spellName: "",
        srcId: srcGuid ?? "",
        srcName: record.base?.srcName ?? "",
        destId: destGuid ?? "",
        destName: record.base?.destName ?? "",
        unconscious: unconscious,
      };

      if (destGuid && destGuid !== "0000000000000000") {
        const destUnit = gladUnits.get(destGuid);
        if (destUnit) {
          if (unconscious) {
            destUnit.unconsciousEvents.push(deathEvent);
          } else {
            destUnit.deaths.push(deathEvent);
          }
        }
      }
    }

    // 7. Actions mirroring for spell events
    if (record.spell) {
      const spellEvent: GladSpellEvent = {
        timestamp: record.timestamp,
        eventName: record.eventName,
        spellId: record.spell.spellId,
        spellName: record.spell.spellName,
        srcId: srcGuid ?? "",
        srcName: record.base?.srcName ?? "",
        destId: destGuid ?? "",
        destName: record.base?.destName ?? "",
      };

      if (srcGuid && srcGuid !== "0000000000000000") {
        const srcUnit = gladUnits.get(srcGuid);
        if (srcUnit) {
          srcUnit.actionsOut.push(spellEvent);
        }
      }

      if (destGuid && destGuid !== "0000000000000000") {
        const destUnit = gladUnits.get(destGuid);
        if (destUnit) {
          destUnit.actionsIn.push(spellEvent);
        }
      }
    }

    // 8. Advanced sample
    if (record.advanced) {
      const actorGuid = record.advanced.actorGuid;
      if (actorGuid && actorGuid !== "0000000000000000") {
        const actorUnit = gladUnits.get(actorGuid);
        if (actorUnit) {
          actorUnit.advancedSamples.push({
            timestamp: record.timestamp,
            hp: record.advanced.hp,
            maxHp: record.advanced.maxHp,
            x: record.advanced.x,
            y: record.advanced.y,
          });
        }
      }
    }
  }

  return gladUnits;
}

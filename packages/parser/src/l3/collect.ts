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
  roster: { ownerId: string | null; units: Map<string, RosterUnit> },
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
      castStarts: [],
      petCasts: [],
      auraEvents: [],
      actionsOut: [],
      actionsIn: [],
      deaths: [],
      unconsciousEvents: [],
      advancedSamples: [],
      healAbsorbsIn: [],
      empowerEnds: [],
      missesOut: [],
      missesIn: [],
    });
  }

  for (const record of records) {
    const srcGuid = record.base?.srcGuid;
    const destGuid = record.base?.destGuid;
    const srcName = record.base?.srcName ?? "";
    const destName = record.base?.destName ?? "";
    const spellId = record.spell?.spellId ?? 0;
    const spellName = record.spell?.spellName ?? "";

    const baseEvent = {
      timestamp: record.timestamp,
      eventName: record.eventName,
      srcId: srcGuid ?? "",
      srcName,
      destId: destGuid ?? "",
      destName,
      params: record.params,
      lineIndex: record.lineIndex,
    };

    // 1. Damage group
    if (record.damage && record.eventName !== "SWING_DAMAGE_LANDED") {
      const hpEvent: GladHpEvent = {
        ...baseEvent,
        spellId,
        spellName,
        amount: record.damage.amount,
        effectiveAmount: record.damage.effectiveAmount,
        absorbed: record.damage.absorbed,
        crit: record.damage.critical,
      };

      // DAMAGE_SPLIT's src is the unit whose damage is being redirected AWAY
      // (Blessing of Sacrifice's protected ally, Soul Link's warlock), NOT an
      // attacker — measured on the 12.1 archive, src and dest are teammates in
      // 7,354 cases and opponents in 0. Crediting it to src.damageOut would
      // invent damage output for a player who dealt none; only the dest, who
      // actually eats it, gets the intake.
      const isSplit = record.eventName === "DAMAGE_SPLIT";

      if (!isSplit && srcGuid && srcGuid !== "0000000000000000") {
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
        ...baseEvent,
        spellId,
        spellName,
        amount: record.heal.amount,
        effectiveAmount: record.heal.effectiveAmount,
        crit: record.heal.critical,
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

    // 2b. Healing eaten by a heal-absorb debuff — keyed to the unit that was
    // being healed, which is the log's base DEST (the prefix describes the
    // absorb, not the heal; see decodeHealAbsorbed).
    if (record.healAbsorbed) {
      const ha = record.healAbsorbed;
      const victim = gladUnits.get(ha.victimGuid);
      if (victim && Number.isFinite(ha.absorbedAmount)) {
        victim.healAbsorbsIn.push({
          timestamp: record.timestamp,
          absorbSpellId: ha.absorbSpellId,
          absorbSpellName: ha.absorbSpellName,
          absorbCasterId: ha.absorbCasterGuid,
          healerId: ha.healerGuid,
          healSpellId: ha.healSpellId,
          healSpellName: ha.healSpellName,
          absorbedAmount: ha.absorbedAmount,
          totalAmount: ha.totalAmount,
          lineIndex: record.lineIndex,
        });
      }
    }

    // 2c. Empowered casts (Evoker) and their release level.
    if (
      record.eventName === "SPELL_EMPOWER_END" &&
      typeof record.empowerLevel === "number"
    ) {
      if (srcGuid && srcGuid !== "0000000000000000") {
        const srcUnit = gladUnits.get(srcGuid);
        if (srcUnit) {
          srcUnit.empowerEnds.push({
            ...baseEvent,
            spellId,
            spellName,
            level: record.empowerLevel,
          });
        }
      }
    }

    // 2d. Misses — the only place IMMUNE and REFLECT are recorded at all.
    if (record.missed) {
      const missEvent = {
        ...baseEvent,
        spellId,
        spellName,
        missType: record.missed.missType,
        amount: record.missed.amount,
      };
      if (srcGuid && srcGuid !== "0000000000000000") {
        gladUnits.get(srcGuid)?.missesOut.push(missEvent);
      }
      if (destGuid && destGuid !== "0000000000000000") {
        gladUnits.get(destGuid)?.missesIn.push(missEvent);
      }
    }

    // 3. Absorbed group
    if (record.absorbed) {
      const absorbDestGuid = record.params[0] ?? "";
      const destNameRaw = record.params[1];
      const absorbDestName =
        destNameRaw === "nil" || destNameRaw === undefined ? "" : destNameRaw;

      const absorbEvent: GladAbsorbEvent = {
        timestamp: record.timestamp,
        eventName: record.eventName,
        spellId: record.absorbed.shieldSpellId,
        spellName: record.absorbed.shieldSpellName,
        srcId: record.absorbed.shieldOwnerGuid,
        srcName:
          record.absorbed.shieldOwnerName === "nil" ||
          !record.absorbed.shieldOwnerName
            ? ""
            : record.absorbed.shieldOwnerName,
        destId: absorbDestGuid,
        destName: absorbDestName,
        absorbedAmount: record.absorbed.absorbedAmount,
        attackerId: record.absorbed.attackerGuid,
        victimId: record.absorbed.victimGuid,
        ...(record.absorbed.attackSpellId !== null
          ? {
              attackSpellId: record.absorbed.attackSpellId,
              attackSpellName: record.absorbed.attackSpellName || undefined,
            }
          : {}),
        params: record.params,
        lineIndex: record.lineIndex,
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
        ...baseEvent,
        spellId,
        spellName,
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

    // 5b. SPELL_CAST_START (cast bar begins) -- attached to the src unit only;
    // instant casts never emit this event
    if (record.eventName === "SPELL_CAST_START") {
      if (srcGuid && srcGuid !== "0000000000000000") {
        const srcUnit = gladUnits.get(srcGuid);
        if (srcUnit) {
          srcUnit.castStarts.push({
            ...baseEvent,
            spellId,
            spellName,
          });
        }
      }
    }

    // 5. SPELL_CAST_SUCCESS
    if (record.eventName === "SPELL_CAST_SUCCESS") {
      const spellEvent: GladSpellEvent = {
        ...baseEvent,
        spellId,
        spellName,
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
      const unconscious = record.unitDied?.unconscious ?? lastParam === "1";

      const deathEvent: GladDeathEvent = {
        ...baseEvent,
        spellId: 0,
        spellName: "",
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
        ...baseEvent,
        spellId,
        spellName,
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
            // Only carried when the line actually had readable power fields —
            // an empty list would cost a key on every sample in a 60GB library.
            ...(record.advanced.powers.length > 0
              ? { powers: record.advanced.powers }
              : {}),
          });
        }
      }
    }
  }

  return gladUnits;
}

import type {
  GladMatch,
  GladShuffle,
  GladUnit,
  GladCombatantInfo,
} from "@gladlog/parser";
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitType,
  CombatUnitSpec,
  CombatResult,
  LogEvent,
} from "./enums";
import type {
  IArenaMatch,
  IShuffleMatch,
  ICombatUnit,
  IHpEvent,
  IAbsorbEvent,
  IAuraEvent,
  ISpellEvent,
  CombatantInfo,
  IStartInfo,
  IAdvancedAction,
  ILogLine,
} from "./types";

// Mapping from Blizzard classId to legacy CombatUnitClass enum value
const BLIZZARD_CLASS_TO_LEGACY: Record<number, CombatUnitClass> = {
  0: CombatUnitClass.None,
  1: CombatUnitClass.Warrior, // Warrior
  2: CombatUnitClass.Paladin, // Paladin
  3: CombatUnitClass.Hunter, // Hunter
  4: CombatUnitClass.Rogue, // Rogue
  5: CombatUnitClass.Priest, // Priest
  6: CombatUnitClass.DeathKnight, // DeathKnight
  7: CombatUnitClass.Shaman, // Shaman
  8: CombatUnitClass.Mage, // Mage
  9: CombatUnitClass.Warlock, // Warlock
  10: CombatUnitClass.Monk, // Monk
  11: CombatUnitClass.Druid, // Druid
  12: CombatUnitClass.DemonHunter, // DemonHunter
  13: CombatUnitClass.Evoker, // Evoker
};

function kindToType(kind: string): CombatUnitType {
  switch (kind) {
    case "Player":
      return CombatUnitType.Player;
    case "NPC":
      return CombatUnitType.NPC;
    case "Pet":
      return CombatUnitType.Pet;
    case "Guardian":
      return CombatUnitType.Guardian;
    case "Object":
      return CombatUnitType.Object;
    default:
      return CombatUnitType.None;
  }
}

function reactionToLegacy(reaction: string): CombatUnitReaction {
  switch (reaction) {
    case "Friendly":
      return CombatUnitReaction.Friendly;
    case "Hostile":
      return CombatUnitReaction.Hostile;
    case "Neutral":
      return CombatUnitReaction.Neutral;
    default:
      return CombatUnitReaction.Neutral;
  }
}

function classIdToLegacy(classId: number): CombatUnitClass {
  return BLIZZARD_CLASS_TO_LEGACY[classId] ?? CombatUnitClass.None;
}

function resultToLegacy(result: string): CombatResult {
  switch (result) {
    case "Win":
      return CombatResult.Win;
    case "Lose":
      return CombatResult.Lose;
    case "Draw":
      return CombatResult.DrawGame;
    default:
      return CombatResult.Unknown;
  }
}

function convertCombatantInfo(
  info: GladCombatantInfo | undefined,
): CombatantInfo | undefined {
  if (!info) return undefined;
  return {
    teamId: String(info.teamId),
    specId: String(info.specId),
    personalRating: info.personalRating,
    talents: (info.talents as unknown as number[][]).map((arr) => ({
      id1: arr[0] ?? 0,
      id2: arr[1] ?? 0,
      count: arr[2] ?? 0,
    })),
    pvpTalents: (info.pvpTalents as unknown as (number | string)[]).map((t) =>
      String(t),
    ),
    equipment: (info.equipment as unknown as any[]).map((eq) => {
      const [id, ilvl, enchants, bonuses, gems] = eq;
      return {
        id: String(id),
        ilvl: Number(ilvl),
        enchants: Array.isArray(enchants) ? enchants.map(String) : [],
        bonuses: Array.isArray(bonuses) ? bonuses.map(String) : [],
        gems: Array.isArray(gems) ? gems.map(String) : [],
      };
    }),
    interestingAurasJSON: JSON.stringify(
      (info.interestingAuras as any[]).flatMap((a) => [
        a.casterGuid,
        a.spellId,
        1,
      ]),
    ),
  };
}

function isPetOrGuardian(
  destId: string | undefined,
  allUnits: Record<string, GladUnit> | undefined,
): boolean {
  if (!destId) return false;
  if (allUnits && destId in allUnits) {
    const unit = allUnits[destId];
    if (unit) {
      const kind = unit.kind;
      return kind === "Pet" || kind === "Guardian";
    }
  }
  return destId.startsWith("Pet-");
}

function getSpellSchoolId(
  eventName: string,
  params: string[] | undefined,
): string {
  // SWING events use '0x1'
  if (eventName.startsWith("SWING")) {
    return "0x1";
  }
  // For SPELL_* events, spell school is at params[10]
  if (!params || params.length < 11) {
    return "0x0";
  }
  const schoolStr = params[10];
  if (schoolStr && (schoolStr.startsWith("0x") || schoolStr.startsWith("0X"))) {
    return schoolStr;
  }
  return "0x0";
}

function convertParams(
  params: string[] | undefined,
): (string | number)[] | undefined {
  if (!params) return undefined;
  return params.map((p) => {
    if (p === "nil" || p === "BUFF" || p === "DEBUFF") {
      return p;
    }
    if (p.startsWith("0x") || p.startsWith("0X")) {
      return p;
    }
    if (p.length >= 15) {
      return p;
    }
    if (/^-?\d+(\.\d+)?$/.test(p)) {
      const num = Number(p);
      if (!isNaN(num)) {
        return num;
      }
    }
    return p;
  });
}

function convertUnit(
  unit: GladUnit,
  allUnits?: Record<string, GladUnit>,
): ICombatUnit {
  const deathRecords: ILogLine[] = unit.deaths.map((death) => ({
    event: LogEvent.UNIT_DIED,
    timestamp: death.timestamp,
    parameters: convertParams(death.params),
  }));

  const advancedActions: IAdvancedAction[] = unit.advancedSamples.map(
    (sample) => ({
      advancedActorCurrentHp: sample.hp,
      advancedActorMaxHp: sample.maxHp,
      advancedActorPositionX: sample.x,
      advancedActorPositionY: sample.y,
      advanced: true,
      timestamp: sample.timestamp,
      advancedActorId: unit.id,
      logLine: {
        event: "ADVANCED_SAMPLE" as const,
        timestamp: sample.timestamp,
      },
    }),
  );

  const damageOut: IHpEvent[] = [
    ...unit.damageOut.map((event) => {
      const isPetDest = isPetOrGuardian(event.destId, allUnits);
      return {
        spellId: String(event.spellId),
        spellName: event.spellName,
        timestamp: event.timestamp,
        srcUnitId: event.srcId,
        srcUnitName: event.srcName,
        destUnitId: event.destId,
        destUnitName: event.destName,
        amount: -event.amount,
        effectiveAmount: isPetDest
          ? -0
          : -(event.effectiveAmount - (event.absorbed ?? 0)),
        spellSchoolId: getSpellSchoolId(event.eventName, event.params),
        logLine: {
          event: event.eventName as LogEvent,
          timestamp: event.timestamp,
          parameters: convertParams(event.params),
        },
      };
    }),
    ...unit.absorbsIn.map((event) => {
      const isPetDest = isPetOrGuardian(event.srcId, allUnits);
      return {
        spellId: String(event.spellId),
        spellName: event.spellName,
        timestamp: event.timestamp,
        srcUnitId: event.attackerId,
        srcUnitName: event.destName,
        destUnitId: event.srcId,
        destUnitName: event.srcName,
        amount: event.absorbedAmount,
        effectiveAmount: isPetDest ? 0 : event.absorbedAmount,
        absorbedAmount: event.absorbedAmount,
        spellSchoolId: getSpellSchoolId(event.eventName, event.params),
        logLine: {
          event: event.eventName as LogEvent,
          timestamp: event.timestamp,
          parameters: convertParams(event.params),
        },
      } as unknown as IHpEvent;
    }),
  ].sort((a, b) => a.timestamp - b.timestamp);

  const damageIn: IHpEvent[] = unit.damageIn
    .map((event) => {
      const isPetDest = isPetOrGuardian(event.destId, allUnits);
      return {
        spellId: String(event.spellId),
        spellName: event.spellName,
        timestamp: event.timestamp,
        srcUnitId: event.srcId,
        srcUnitName: event.srcName,
        destUnitId: event.destId,
        destUnitName: event.destName,
        amount: -event.amount,
        effectiveAmount: isPetDest
          ? -0
          : -(event.effectiveAmount - (event.absorbed ?? 0)),
        spellSchoolId: getSpellSchoolId(event.eventName, event.params),
        logLine: {
          event: event.eventName as LogEvent,
          timestamp: event.timestamp,
          parameters: convertParams(event.params),
        },
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp);

  const healOut: IHpEvent[] = unit.healOut.map((event) => {
    const isPetDest = isPetOrGuardian(event.destId, allUnits);
    return {
      spellId: String(event.spellId),
      spellName: event.spellName,
      timestamp: event.timestamp,
      srcUnitId: event.srcId,
      srcUnitName: event.srcName,
      destUnitId: event.destId,
      destUnitName: event.destName,
      amount: event.amount,
      effectiveAmount: isPetDest ? 0 : event.effectiveAmount,
      logLine: {
        event: event.eventName as LogEvent,
        timestamp: event.timestamp,
        parameters: convertParams(event.params),
      },
    };
  });

  const healIn: IHpEvent[] = unit.healIn.map((event) => {
    const isPetDest = isPetOrGuardian(event.destId, allUnits);
    return {
      spellId: String(event.spellId),
      spellName: event.spellName,
      timestamp: event.timestamp,
      srcUnitId: event.srcId,
      srcUnitName: event.srcName,
      destUnitId: event.destId,
      destUnitName: event.destName,
      amount: event.amount,
      effectiveAmount: isPetDest ? 0 : event.effectiveAmount,
      logLine: {
        event: event.eventName as LogEvent,
        timestamp: event.timestamp,
        parameters: convertParams(event.params),
      },
    };
  });

  const absorbsOut: IAbsorbEvent[] = unit.absorbsOut.map((event) => ({
    spellId: String(event.spellId),
    spellName: event.spellName,
    timestamp: event.timestamp,
    srcUnitId: event.srcId,
    srcUnitName: event.srcName,
    destUnitId: event.destId,
    destUnitName: event.destName,
    absorbedAmount: event.absorbedAmount,
    logLine: {
      event: event.eventName as LogEvent,
      timestamp: event.timestamp,
      parameters: convertParams(event.params),
    },
  }));

  const absorbsIn: IAbsorbEvent[] = unit.absorbsIn.map((event) => ({
    spellId: String(event.spellId),
    spellName: event.spellName,
    timestamp: event.timestamp,
    srcUnitId: event.srcId,
    srcUnitName: event.srcName,
    destUnitId: event.destId,
    destUnitName: event.destName,
    absorbedAmount: event.absorbedAmount,
    logLine: {
      event: event.eventName as LogEvent,
      timestamp: event.timestamp,
      parameters: convertParams(event.params),
    },
  }));

  const auraEvents: IAuraEvent[] = unit.auraEvents.map((event) => ({
    spellId: String(event.spellId),
    spellName: event.spellName,
    timestamp: event.timestamp,
    srcUnitId: event.srcId,
    srcUnitName: event.srcName,
    destUnitId: event.destId,
    destUnitName: event.destName,
    auraType: event.auraType,
    amount: event.amount,
    logLine: {
      event: event.eventName as LogEvent,
      timestamp: event.timestamp,
      parameters: convertParams(event.params),
    },
  }));

  const spellCastEvents: ISpellEvent[] = unit.casts.map((event) => ({
    spellId: String(event.spellId),
    spellName: event.spellName,
    timestamp: event.timestamp,
    srcUnitId: event.srcId,
    srcUnitName: event.srcName,
    destUnitId: event.destId,
    destUnitName: event.destName,
    logLine: {
      event: event.eventName as LogEvent,
      timestamp: event.timestamp,
      parameters: convertParams(event.params),
    },
  }));

  const petSpellCastEvents: ISpellEvent[] = unit.petCasts.map((event) => ({
    spellId: String(event.spellId),
    spellName: event.spellName,
    timestamp: event.timestamp,
    srcUnitId: event.srcId,
    srcUnitName: event.srcName,
    destUnitId: event.destId,
    destUnitName: event.destName,
    logLine: {
      event: event.eventName as LogEvent,
      timestamp: event.timestamp,
      parameters: convertParams(event.params),
    },
  }));

  const actionOut: ISpellEvent[] = unit.actionsOut.map((event) => ({
    spellId: String(event.spellId),
    spellName: event.spellName,
    timestamp: event.timestamp,
    srcUnitId: event.srcId,
    srcUnitName: event.srcName,
    destUnitId: event.destId,
    destUnitName: event.destName,
    logLine: {
      event: event.eventName as LogEvent,
      timestamp: event.timestamp,
      parameters: convertParams(event.params),
    },
  }));

  const actionIn: ISpellEvent[] = unit.actionsIn.map((event) => ({
    spellId: String(event.spellId),
    spellName: event.spellName,
    timestamp: event.timestamp,
    srcUnitId: event.srcId,
    srcUnitName: event.srcName,
    destUnitId: event.destId,
    destUnitName: event.destName,
    logLine: {
      event: event.eventName as LogEvent,
      timestamp: event.timestamp,
      parameters: convertParams(event.params),
    },
  }));

  return {
    id: unit.id,
    name: unit.name,
    ownerId: unit.ownerId,
    type: kindToType(unit.kind),
    class: classIdToLegacy(unit.classId),
    spec: String(unit.specId) as CombatUnitSpec | string,
    reaction: reactionToLegacy(unit.reaction),
    info: convertCombatantInfo(unit.info),
    damageIn,
    damageOut,
    healIn,
    healOut,
    absorbsIn,
    absorbsOut,
    auraEvents,
    spellCastEvents,
    petSpellCastEvents,
    actionIn,
    actionOut,
    deathRecords,
    advancedActions,
  };
}

function mergePetEvents(units: Record<string, ICombatUnit>): void {
  for (const unit of Object.values(units)) {
    if (
      (unit.type === CombatUnitType.Pet ||
        unit.type === CombatUnitType.Guardian) &&
      unit.ownerId &&
      units[unit.ownerId]
    ) {
      const owner = units[unit.ownerId]!;
      owner.damageOut = [...owner.damageOut, ...unit.damageOut].sort(
        (a, b) => a.timestamp - b.timestamp,
      );
      owner.healOut = [...owner.healOut, ...unit.healOut].sort(
        (a, b) => a.timestamp - b.timestamp,
      );
      owner.absorbsOut = [...owner.absorbsOut, ...unit.absorbsOut].sort(
        (a, b) => a.timestamp - b.timestamp,
      );
    }
  }
}

export function toLegacyMatch(m: GladMatch): IArenaMatch {
  const units: Record<string, ICombatUnit> = {};
  for (const [id, unit] of Object.entries(m.units)) {
    // Filter: exclude Player units without CombatantInfo (outsider filter)
    if (unit.kind === "Player" && !unit.info) {
      continue;
    }
    units[id] = convertUnit(unit, m.units);
  }
  mergePetEvents(units);

  const startInfo: IStartInfo = {
    bracket: m.bracket,
    zoneId: m.zoneId,
    isRanked: true,
  };

  return {
    dataType: "ArenaMatch",
    startTime: m.startTime,
    endTime: m.endTime,
    units,
    startInfo,
    playerId: m.playerId,
    playerTeamId: m.playerTeamId != null ? String(m.playerTeamId) : null,
    result: resultToLegacy(m.result),
    winningTeamId: m.winningTeamId != null ? String(m.winningTeamId) : null,
    rawLines: m.rawLines,
    durationInSeconds: (m.endTime - m.startTime) / 1000,
    hasAdvancedLogging: m.hasAdvancedLogging,
    timezone: m.timezone,
    wowVersion: "retail",
  };
}

export function toLegacyShuffle(s: GladShuffle): IShuffleMatch {
  const rounds = s.rounds.map((round) => {
    const units: Record<string, ICombatUnit> = {};
    for (const [id, unit] of Object.entries(round.units)) {
      // Filter: exclude Player units without CombatantInfo (outsider filter)
      if (unit.kind === "Player" && !unit.info) {
        continue;
      }
      units[id] = convertUnit(unit, round.units);
    }
    mergePetEvents(units);

    const startInfo: IStartInfo = {
      bracket: round.bracket,
      zoneId: round.zoneId,
      isRanked: true,
    };

    return {
      dataType: "ShuffleRound" as const,
      sequenceNumber: round.sequenceNumber,
      startTime: round.startTime,
      endTime: round.endTime,
      units,
      startInfo,
      playerId: round.playerId,
      playerTeamId:
        round.playerTeamId != null ? String(round.playerTeamId) : null,
      result: resultToLegacy(round.result),
      winningTeamId:
        round.winningTeamId != null ? String(round.winningTeamId) : null,
      rawLines: round.rawLines,
      durationInSeconds: (round.endTime - round.startTime) / 1000,
      hasAdvancedLogging: round.hasAdvancedLogging,
      timezone: round.timezone,
      wowVersion: "retail" as const,
    };
  });

  return {
    dataType: "ShuffleMatch",
    rounds,
    startTime: s.startTime,
    endTime: s.endTime,
    rawLines: s.rawLines,
    result: resultToLegacy(s.result),
  };
}

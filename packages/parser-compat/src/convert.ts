import type {
  GladAbsorbEvent,
  GladCombatantInfo,
  GladMatch,
  GladShuffle,
  GladUnit,
} from "@gladlog/parser";

import {
  CombatResult,
  CombatUnitClass,
  CombatUnitPowerType,
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  LogEvent,
} from "./enums";
import type {
  CombatantInfo,
  IAbsorbEvent,
  IAdvancedAction,
  IArenaMatch,
  IAuraEvent,
  ICombatUnit,
  IEmpowerEvent,
  IHealAbsorbEvent,
  IHpEvent,
  IMissEvent,
  ILogLine,
  IShuffleMatch,
  ISpellEvent,
  IStartInfo,
} from "./types";

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

/**
 * CombatUnitClass values now ARE Blizzard's official ChrClasses.ID (see
 * enumsGenerated.ts) and match the classId in the log, so this only validates
 * "is this a known class" and no longer converts anything.
 * There used to be a Blizzard→private-numbering translation table here; that
 * numbering was invented by an external project and was deleted along with the
 * switch to official enum values (see docs/DATA-COMPLIANCE.md).
 */
const KNOWN_CLASS_IDS = new Set<number>(
  Object.values(CombatUnitClass).filter(
    (v): v is CombatUnitClass => typeof v === "number",
  ),
);

function classIdToLegacy(classId: number): CombatUnitClass {
  return KNOWN_CLASS_IDS.has(classId)
    ? (classId as CombatUnitClass)
    : CombatUnitClass.None;
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

/** The attacker's spell on an absorb, when the document carries it (spell-form
 * absorbs parsed on or after 2026-09-20). */
function attackSpellFields(event: {
  attackSpellId?: number;
  attackSpellName?: string;
}): { attackSpellId?: string; attackSpellName?: string } {
  return event.attackSpellId !== undefined
    ? {
        attackSpellId: String(event.attackSpellId),
        attackSpellName: event.attackSpellName || undefined,
      }
    : {};
}

/** L3 stores `effectiveAmount = amount − overkill` (l1/decoders decodeDamage),
 * so the difference IS the overkill; carried only on a killing blow. */
function overkillField(event: { amount: number; effectiveAmount: number }): {
  overkill?: number;
} {
  const overkill = event.amount - event.effectiveAmount;
  return overkill > 0 ? { overkill } : {};
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

function convertParams(params: string[] | undefined): (string | number)[] {
  if (!params) return [];
  return params.map((p) => {
    if (typeof p !== "string") return p;
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

/**
 * SPELL_ABSORBED events grouped by the unit the shield actually protected.
 *
 * Three units take part in an absorb — attacker, shield owner, victim — but L3
 * only groups by the first two (`GladUnit.absorbsIn` is keyed by the ATTACKER:
 * "damage I dealt that a shield soaked"; `absorbsOut` by the shield owner).
 * The victim's own view had no array at all, so `ICombatUnit.absorbsIn` used to
 * hand consumers the attacker-keyed list under a name every one of them read as
 * "absorbs I received". Rebuilding it here keys it to the victim; the attacker
 * view stays available to `damageOut`, which reads the L3 array directly.
 *
 * An event is reachable whenever either the attacker or the shield owner is a
 * tracked unit, so both arrays are scanned and `lineIndex` (unique per line
 * within a match, and untouched by params slimming) removes the overlap.
 */
function buildAbsorbsByVictim(
  allUnits: Record<string, GladUnit> | undefined,
): Map<string, GladAbsorbEvent[]> {
  const byVictim = new Map<string, GladAbsorbEvent[]>();
  if (!allUnits) return byVictim;
  const seen = new Set<string>();
  for (const unit of Object.values(allUnits)) {
    for (const event of [...unit.absorbsIn, ...unit.absorbsOut]) {
      const victimId = event.victimId;
      if (!victimId || victimId === "0000000000000000") continue;
      const key =
        typeof event.lineIndex === "number"
          ? String(event.lineIndex)
          : `${event.timestamp}|${event.attackerId}|${victimId}|${event.spellId}|${event.absorbedAmount}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const list = byVictim.get(victimId);
      if (list) list.push(event);
      else byVictim.set(victimId, [event]);
    }
  }
  for (const list of byVictim.values()) {
    list.sort((a, b) => a.timestamp - b.timestamp);
  }
  return byVictim;
}

function convertUnit(
  unit: GladUnit,
  allUnits?: Record<string, GladUnit>,
  absorbsByVictim?: Map<string, GladAbsorbEvent[]>,
): ICombatUnit {
  const deathRecords: ILogLine[] = unit.deaths.map((death) => ({
    event: LogEvent.UNIT_DIED,
    timestamp: death.timestamp,
    parameters: convertParams(death.params),
    lineIndex: death.lineIndex,
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
      advancedActorPowers: (sample.powers ?? []).map((p) => ({
        type: p.powerType as unknown as CombatUnitPowerType,
        current: p.current,
        max: p.max,
      })),
      logLine: {
        event: "ADVANCED_SAMPLE" as const,
        timestamp: sample.timestamp,
        parameters: [],
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
        ...unitFlagFields(event.params),
        srcUnitId: event.srcId,
        srcUnitName: event.srcName,
        destUnitId: event.destId,
        destUnitName: event.destName,
        amount: -event.amount,
        effectiveAmount: isPetDest
          ? -0
          : -(event.effectiveAmount - (event.absorbed ?? 0)),
        ...overkillField(event),
        spellSchoolId: getSpellSchoolId(event.eventName, event.params),
        logLine: {
          event: event.eventName as LogEvent,
          timestamp: event.timestamp,
          parameters: convertParams(event.params),
          lineIndex: event.lineIndex,
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
          lineIndex: event.lineIndex,
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
        ...unitFlagFields(event.params),
        srcUnitId: event.srcId,
        srcUnitName: event.srcName,
        destUnitId: event.destId,
        destUnitName: event.destName,
        amount: -event.amount,
        effectiveAmount: isPetDest
          ? -0
          : -(event.effectiveAmount - (event.absorbed ?? 0)),
        ...overkillField(event),
        spellSchoolId: getSpellSchoolId(event.eventName, event.params),
        logLine: {
          event: event.eventName as LogEvent,
          timestamp: event.timestamp,
          parameters: convertParams(event.params),
          lineIndex: event.lineIndex,
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
      ...unitFlagFields(event.params),
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
        lineIndex: event.lineIndex,
      },
    };
  });

  const healIn: IHpEvent[] = unit.healIn.map((event) => {
    const isPetDest = isPetOrGuardian(event.destId, allUnits);
    return {
      spellId: String(event.spellId),
      spellName: event.spellName,
      timestamp: event.timestamp,
      ...unitFlagFields(event.params),
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
        lineIndex: event.lineIndex,
      },
    };
  });

  const absorbsOut: IAbsorbEvent[] = unit.absorbsOut.map((event) => ({
    spellId: String(event.spellId),
    spellName: event.spellName,
    timestamp: event.timestamp,
    ...unitFlagFields(event.params),
    srcUnitId: event.srcId,
    srcUnitName: event.srcName,
    destUnitId: event.destId,
    destUnitName: event.destName,
    absorbedAmount: event.absorbedAmount,
    ...attackSpellFields(event),
    logLine: {
      event: event.eventName as LogEvent,
      timestamp: event.timestamp,
      parameters: convertParams(event.params),
      lineIndex: event.lineIndex,
    },
  }));

  const convertMiss = (event: {
    spellId: number;
    spellName: string;
    timestamp: number;
    srcId: string;
    srcName: string;
    destId: string;
    destName: string;
    missType: string;
    amount: number;
    eventName: string;
    params: string[];
    lineIndex?: number;
  }): IMissEvent => ({
    spellId: String(event.spellId),
    spellName: event.spellName,
    timestamp: event.timestamp,
    ...unitFlagFields(event.params),
    srcUnitId: event.srcId,
    srcUnitName: event.srcName,
    destUnitId: event.destId,
    destUnitName: event.destName,
    missType: event.missType,
    amount: event.amount,
    logLine: {
      event: event.eventName as LogEvent,
      timestamp: event.timestamp,
      parameters: convertParams(event.params),
      lineIndex: event.lineIndex,
    },
  });
  const missesOut: IMissEvent[] = (unit.missesOut ?? []).map(convertMiss);
  const missesIn: IMissEvent[] = (unit.missesIn ?? []).map(convertMiss);

  const empowerEnds: IEmpowerEvent[] = (unit.empowerEnds ?? []).map(
    (event) => ({
      spellId: String(event.spellId),
      spellName: event.spellName,
      timestamp: event.timestamp,
      ...unitFlagFields(event.params),
      srcUnitId: event.srcId,
      srcUnitName: event.srcName,
      destUnitId: event.destId,
      destUnitName: event.destName,
      level: event.level,
      logLine: {
        event: event.eventName as LogEvent,
        timestamp: event.timestamp,
        parameters: convertParams(event.params),
        lineIndex: event.lineIndex,
      },
    }),
  );

  // Already victim-keyed in L3 (the log's base dest is the unit being healed),
  // so this is a straight field mapping — no regrouping needed.
  const healAbsorbsIn: IHealAbsorbEvent[] = (unit.healAbsorbsIn ?? []).map(
    (event) => ({
      timestamp: event.timestamp,
      absorbSpellId: String(event.absorbSpellId),
      absorbSpellName: event.absorbSpellName,
      absorbCasterId: event.absorbCasterId,
      healerId: event.healerId,
      healSpellId: String(event.healSpellId),
      healSpellName: event.healSpellName,
      absorbedAmount: event.absorbedAmount,
      totalAmount: event.totalAmount,
      logLine: {
        event: "SPELL_HEAL_ABSORBED" as LogEvent,
        timestamp: event.timestamp,
        parameters: [],
        lineIndex: event.lineIndex,
      },
    }),
  );

  // Victim-keyed: the absorbs that protected THIS unit. See buildAbsorbsByVictim
  // for why the L3 array cannot be used directly. srcUnit = the shield's owner
  // (who to credit), destUnit = this unit (who was protected).
  // Caveat on the spread flags: params[2]/[6] are the raw line's own src/dest,
  // i.e. ATTACKER and victim. So `destUnitFlags` lines up with `destUnitId`, but
  // `srcUnitFlags` describes `attackerId`, not `srcUnitId`. No consumer reads
  // them off an absorb today; anyone who starts must pick the field deliberately.
  const absorbsIn: IAbsorbEvent[] = (absorbsByVictim?.get(unit.id) ?? []).map(
    (event) => ({
      spellId: String(event.spellId),
      spellName: event.spellName,
      timestamp: event.timestamp,
      ...unitFlagFields(event.params),
      srcUnitId: event.srcId,
      srcUnitName: event.srcName,
      destUnitId: event.victimId,
      destUnitName: unit.name,
      absorbedAmount: event.absorbedAmount,
      attackerId: event.attackerId,
      ...attackSpellFields(event),
      logLine: {
        event: event.eventName as LogEvent,
        timestamp: event.timestamp,
        parameters: convertParams(event.params),
        lineIndex: event.lineIndex,
      },
    }),
  );

  const auraEvents: IAuraEvent[] = unit.auraEvents.map((event) => ({
    spellId: String(event.spellId),
    spellName: event.spellName,
    timestamp: event.timestamp,
    ...unitFlagFields(event.params),
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
      lineIndex: event.lineIndex,
    },
  }));

  const spellCastEvents: ISpellEvent[] = unit.casts.map((event) => ({
    spellId: String(event.spellId),
    spellName: event.spellName,
    timestamp: event.timestamp,
    ...unitFlagFields(event.params),
    srcUnitId: event.srcId,
    srcUnitName: event.srcName,
    destUnitId: event.destId,
    destUnitName: event.destName,
    logLine: {
      event: event.eventName as LogEvent,
      timestamp: event.timestamp,
      parameters: convertParams(event.params),
      lineIndex: event.lineIndex,
    },
  }));

  // Older stored docs have no castStarts field → [] (the castBars/kickAudit
  // consumers treat it as optional)
  const castStartEvents: ISpellEvent[] = (
    (unit as { castStarts?: typeof unit.casts }).castStarts ?? []
  ).map((event) => ({
    spellId: String(event.spellId),
    spellName: event.spellName,
    timestamp: event.timestamp,
    ...unitFlagFields(event.params),
    srcUnitId: event.srcId,
    srcUnitName: event.srcName,
    destUnitId: event.destId,
    destUnitName: event.destName,
    logLine: {
      event: event.eventName as LogEvent,
      timestamp: event.timestamp,
      parameters: convertParams(event.params),
      lineIndex: event.lineIndex,
    },
  }));

  const petSpellCastEvents: ISpellEvent[] = unit.petCasts.map((event) => ({
    spellId: String(event.spellId),
    spellName: event.spellName,
    timestamp: event.timestamp,
    ...unitFlagFields(event.params),
    srcUnitId: event.srcId,
    srcUnitName: event.srcName,
    destUnitId: event.destId,
    destUnitName: event.destName,
    logLine: {
      event: event.eventName as LogEvent,
      timestamp: event.timestamp,
      parameters: convertParams(event.params),
      lineIndex: event.lineIndex,
    },
  }));

  const actionOut: ISpellEvent[] = unit.actionsOut.map((event) => ({
    ...extraSpellFields(event.eventName, event.params),
    spellId: String(event.spellId),
    spellName: event.spellName,
    timestamp: event.timestamp,
    ...unitFlagFields(event.params),
    srcUnitId: event.srcId,
    srcUnitName: event.srcName,
    destUnitId: event.destId,
    destUnitName: event.destName,
    logLine: {
      event: event.eventName as LogEvent,
      timestamp: event.timestamp,
      parameters: convertParams(event.params),
      lineIndex: event.lineIndex,
    },
  }));

  const actionIn: ISpellEvent[] = unit.actionsIn.map((event) => ({
    ...extraSpellFields(event.eventName, event.params),
    spellId: String(event.spellId),
    spellName: event.spellName,
    timestamp: event.timestamp,
    ...unitFlagFields(event.params),
    srcUnitId: event.srcId,
    srcUnitName: event.srcName,
    destUnitId: event.destId,
    destUnitName: event.destName,
    logLine: {
      event: event.eventName as LogEvent,
      timestamp: event.timestamp,
      parameters: convertParams(event.params),
      lineIndex: event.lineIndex,
    },
  }));

  return {
    id: unit.id,
    name: unit.name,
    ownerId: unit.ownerId ?? "",
    isWellFormed: true,
    type: kindToType(unit.kind),
    class: classIdToLegacy(unit.classId),
    spec: String(unit.specId) as CombatUnitSpec,
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
    castStartEvents,
    petSpellCastEvents,
    actionIn,
    actionOut,
    deathRecords,
    advancedActions,
    healAbsorbsIn,
    missesOut,
    missesIn,
    empowerEnds,
  };
}

function mergePetEvents(units: Record<string, ICombatUnit>): void {
  for (const unit of Object.values(units)) {
    // GH #57 (user ruling 2026-08-29): merge by SUMMON relationship, not by
    // unit kind. Army of the Dead ghouls are flagged NPC by the game
    // (0xa28: NPC type, NPC-controlled) yet carry the DK as ownerId from
    // SPELL_SUMMON; Details-style attribution — and the old parser — credit
    // them to the summoner. Any non-player unit whose owner is a player unit
    // in this combat folds in. Measured before the ruling: 1,585 ghouls /
    // 19.6M damage per 300 matches left on the ghouls.
    if (
      unit.type !== CombatUnitType.Player &&
      unit.ownerId &&
      units[unit.ownerId] &&
      units[unit.ownerId]!.type === CombatUnitType.Player
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

function parseFlags(v: string | undefined): number {
  if (!v) return 0;
  const n =
    v.startsWith("0x") || v.startsWith("0X")
      ? parseInt(v, 16)
      : parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}
function unitFlagFields(params: string[] | undefined): {
  srcUnitFlags: number;
  destUnitFlags: number;
} {
  return {
    srcUnitFlags: parseFlags(params?.[2]),
    destUnitFlags: parseFlags(params?.[6]),
  };
}

const EXTRA_SPELL_EVENTS = /DISPEL|INTERRUPT|STOLEN/;
function extraSpellFields(
  eventName: string,
  params: string[] | undefined,
): { extraSpellId?: string; extraSpellName?: string } {
  if (!EXTRA_SPELL_EVENTS.test(eventName)) return {};
  return {
    extraSpellId: String(params?.[11] ?? ""),
    extraSpellName: String(params?.[12] ?? ""),
  };
}

export function toLegacyMatch(m: GladMatch): IArenaMatch {
  const units: Record<string, ICombatUnit> = {};
  const absorbsByVictim = buildAbsorbsByVictim(m.units);
  for (const [id, unit] of Object.entries(m.units)) {
    // Filter: exclude Player units without CombatantInfo (outsider filter)
    if (unit.kind === "Player" && !unit.info) {
      continue;
    }
    units[id] = convertUnit(unit, m.units, absorbsByVictim);
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
    const absorbsByVictim = buildAbsorbsByVictim(round.units);
    for (const [id, unit] of Object.entries(round.units)) {
      // Filter: exclude Player units without CombatantInfo (outsider filter)
      if (unit.kind === "Player" && !unit.info) {
        continue;
      }
      units[id] = convertUnit(unit, round.units, absorbsByVictim);
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

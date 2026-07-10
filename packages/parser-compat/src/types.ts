import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitType,
  CombatUnitSpec,
  CombatResult,
  LogEvent,
} from "./enums";

export interface ILogLine {
  event: LogEvent | string;
  timestamp: number;
  parameters?: (string | number)[];
}

export interface ICombatEvent {
  spellId: number;
  spellName: string;
  timestamp: number;
  srcUnitId: string;
  srcUnitName: string;
  destUnitId: string;
  destUnitName: string;
  logLine: ILogLine;
}

export interface IHpEvent extends ICombatEvent {
  amount: number;
  effectiveAmount: number;
}

export interface IAbsorbEvent extends ICombatEvent {
  absorbedAmount: number;
}

export interface ISpellEvent extends ICombatEvent {}

export interface IAuraEvent extends ICombatEvent {
  auraType: "BUFF" | "DEBUFF";
  amount?: number;
}

export interface CombatantInfo {
  teamId: string;
  specId: string;
  personalRating: number;
  talents: { id1: number; id2: number; count: number }[];
  pvpTalents: string[];
  equipment: {
    id: string;
    ilvl: number;
    enchants: string[];
    bonuses: string[];
    gems: string[];
  }[];
  interestingAurasJSON: string;
}

export interface ICombatUnit {
  id: string;
  name: string;
  ownerId?: string;
  type: CombatUnitType;
  class: CombatUnitClass;
  spec: CombatUnitSpec | string;
  reaction: CombatUnitReaction;
  info?: CombatantInfo;
  damageIn: IHpEvent[];
  damageOut: IHpEvent[];
  healIn: IHpEvent[];
  healOut: IHpEvent[];
  absorbsIn: IAbsorbEvent[];
  absorbsOut: IAbsorbEvent[];
  auraEvents: IAuraEvent[];
  spellCastEvents: ISpellEvent[];
  petSpellCastEvents: ISpellEvent[];
  actionIn: ISpellEvent[];
  actionOut: ISpellEvent[];
  deathRecords: ILogLine[];
  advancedActions: IAdvancedAction[];
}

export interface IAdvancedAction {
  advancedActorCurrentHp: number;
  advancedActorMaxHp: number;
  advancedActorPositionX: number;
  advancedActorPositionY: number;
  advanced: true;
  timestamp: number;
  advancedActorId: string;
  logLine: {
    event: "ADVANCED_SAMPLE";
    timestamp: number;
  };
}

export interface IStartInfo {
  bracket: string;
  zoneId: string;
  isRanked: boolean;
}

export interface IArenaCombatBase {
  startTime: number;
  endTime: number;
  units: Record<string, ICombatUnit>;
  startInfo: IStartInfo;
  playerId: string;
  playerTeamId: string | null;
  result: CombatResult;
  winningTeamId: string | null;
  rawLines: string[];
  durationInSeconds: number;
  hasAdvancedLogging: boolean;
  timezone: string;
  wowVersion: "retail";
}

export interface IArenaMatch extends IArenaCombatBase {
  dataType: "ArenaMatch";
}

export interface IShuffleRound extends IArenaCombatBase {
  dataType: "ShuffleRound";
  sequenceNumber: number;
}

export interface IShuffleMatch {
  dataType: "ShuffleMatch";
  rounds: IShuffleRound[];
  startTime: number;
  endTime: number;
  rawLines: string[];
  result: CombatResult;
}

export type AtomicArenaCombat = IArenaMatch | IShuffleRound;

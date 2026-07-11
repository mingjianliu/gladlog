import {
  CombatUnitClass,
  CombatUnitPowerType,
  CombatUnitReaction,
  CombatUnitType,
  CombatUnitSpec,
  CombatResult,
  LogEvent,
} from "./enums";

export interface ILogLine {
  event: LogEvent | string;
  timestamp: number;
  parameters: (string | number)[];
}

export interface ICombatEvent {
  spellId: string;
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
  spellSchoolId?: string;
}

export interface IAbsorbEvent extends ICombatEvent {
  absorbedAmount: number;
  shieldSpellId?: string;
}

export interface ISpellEvent extends ICombatEvent {
  /** SPELL_DISPEL/_INTERRUPT/_STOLEN 类事件的目标法术(params[11..12]);其余事件为 undefined */
  extraSpellId?: string;
  extraSpellName?: string;
}

/** 旧接口别名:携带 extra 法术字段的动作事件 */
export interface CombatExtraSpellAction extends ISpellEvent {
  extraSpellId: string;
  extraSpellName: string;
}

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
  ownerId: string;
  type: CombatUnitType;
  class: CombatUnitClass;
  spec: CombatUnitSpec;
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
  /** 新 parser 未采集 powers;转换器恒填 [](mana 类判定优雅降级,见 4a 再对齐报告) */
  advancedActorPowers: { type: CombatUnitPowerType; current: number; max: number }[];
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

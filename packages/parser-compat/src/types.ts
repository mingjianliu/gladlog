import {
  CombatResult,
  CombatUnitClass,
  CombatUnitPowerType,
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  LogEvent,
} from "./enums";

export interface ILogLine {
  event: LogEvent | string;
  timestamp: number;
  parameters: (string | number)[];
}

export interface ICombatEvent {
  /** 原始 srcFlags/destFlags(params[2]/params[6],十六进制解码) */
  srcUnitFlags: number;
  destUnitFlags: number;
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

/** 旧接口别名:吸收事件 */
export interface CombatAbsorbAction extends IAbsorbEvent {}

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
  /** 转换后单位恒为 well-formed(parser 已过滤坏单位) */
  isWellFormed: boolean;
  /** 旧接口字段(旗标 affiliation 位);转换器不填,可选 */
  affiliation?: number;
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
  /** 旧接口字段:作为攻击方打掉的护盾吸收;转换器暂不填(可选) */
  absorbsDamaged?: IAbsorbEvent[];
  /** 旧接口字段族:_SUPPORT 事件(增辅贡献);转换器暂不填(可选) */
  supportDamageIn?: IHpEvent[];
  supportDamageOut?: IHpEvent[];
  supportHealIn?: IHpEvent[];
  supportHealOut?: IHpEvent[];
  /** 旧接口字段:非假死死亡记录;转换器暂不填(可选,消费方回退 deathRecords) */
  consciousDeathRecords?: ILogLine[];
  auraEvents: IAuraEvent[];
  spellCastEvents: ISpellEvent[];
  /** SPELL_CAST_START(读条开始;瞬发无此事件)。旧存档 doc 无 castStarts 字段 → [](可选,消费方需容忍缺席)。 */
  castStartEvents?: ISpellEvent[];
  petSpellCastEvents: ISpellEvent[];
  actionIn: ISpellEvent[];
  actionOut: ISpellEvent[];
  deathRecords: ILogLine[];
  advancedActions: IAdvancedAction[];
}

export interface IAdvancedAction {
  /** 新 parser 未采集 powers;转换器恒填 [](mana 类判定优雅降级,见 4a 再对齐报告) */
  advancedActorPowers: {
    type: CombatUnitPowerType;
    current: number;
    max: number;
  }[];
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

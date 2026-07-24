export type MatchResult = "Win" | "Lose" | "Draw" | "Unknown";
export type UnitKind =
  "Player" | "Pet" | "Guardian" | "NPC" | "Object" | "Unknown";
export type Reaction = "Friendly" | "Hostile" | "Neutral" | "Unknown";

export interface GladCombatantInfo {
  teamId: number;
  specId: number;
  personalRating: number;
  talents: unknown[];
  pvpTalents: unknown[];
  equipment: unknown[];
  interestingAuras: { casterGuid: string; spellId: number }[];
}

export interface GladEventBase {
  timestamp: number;
  eventName: string;
  spellId: number;
  spellName: string;
  srcId: string;
  srcName: string;
  destId: string;
  destName: string;
  params: string[];
  /** 本事件源行在所属对局 rawLines 里的下标(shuffle 为轮内下标,整场
   * raw.txt 的偏移由各轮 linesTotal 累加)。B2 溯源深链锚点。 */
  lineIndex?: number;
}

export interface GladHpEvent extends GladEventBase {
  amount: number;
  effectiveAmount: number;
  absorbed?: number;
}

export interface GladAbsorbEvent extends GladEventBase {
  absorbedAmount: number;
  attackerId: string;
}

export interface GladSpellEvent extends GladEventBase {}

export interface GladAuraEvent extends GladEventBase {
  auraType: "BUFF" | "DEBUFF";
  amount?: number;
}

export interface GladDeathEvent extends GladEventBase {
  unconscious: boolean;
}

export interface GladAdvancedSample {
  timestamp: number;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
}

export interface GladUnit {
  id: string; // GUID
  name: string;
  ownerId?: string; // 宠物→主人
  kind: UnitKind;
  reaction: Reaction;
  classId: number; // 暴雪 class ID;0=未知
  specId: number; // 暴雪 spec ID;0=未知
  info?: GladCombatantInfo; // 仅玩家
  damageOut: GladHpEvent[];
  damageIn: GladHpEvent[];
  healOut: GladHpEvent[];
  healIn: GladHpEvent[];
  absorbsOut: GladAbsorbEvent[];
  absorbsIn: GladAbsorbEvent[];
  casts: GladSpellEvent[];
  /** SPELL_CAST_START(读条开始;瞬发无此事件)。回放读条条消费。 */
  castStarts: GladSpellEvent[];
  petCasts: GladSpellEvent[];
  auraEvents: GladAuraEvent[];
  actionsOut: GladSpellEvent[];
  actionsIn: GladSpellEvent[];
  deaths: GladDeathEvent[];
  unconsciousEvents: GladDeathEvent[];
  advancedSamples: GladAdvancedSample[];
}

export interface GladMatchBase {
  id: string; // 内容哈希
  bracket: string;
  zoneId: string;
  startTime: number;
  endTime: number;
  units: Record<string, GladUnit>;
  playerId: string; // 日志所有者 GUID
  playerTeamId: number | null;
  winningTeamId: number | null;
  result: MatchResult;
  linesTotal: number;
  linesDropped: number;
  rawLines: string[];
  hasAdvancedLogging: boolean;
  timezone: string;
}

export interface GladMatch extends GladMatchBase {
  kind: "match";
}

export interface GladShuffleRound extends GladMatchBase {
  kind: "shuffleRound";
  sequenceNumber: number;
}

export interface GladShuffle {
  kind: "shuffle";
  rounds: GladShuffleRound[];
  startTime: number;
  endTime: number;
  rawLines: string[];
  result: MatchResult;
}

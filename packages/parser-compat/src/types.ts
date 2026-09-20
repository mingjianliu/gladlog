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
  /** Index of the source line within its match's rawLines (the raw.txt written
   * to disk); for shuffle it is the index within the round, and the whole-match
   * offset is the running sum of each round's linesTotal. Absent on old
   * archives (undefined) → deep links degrade by hiding. */
  lineIndex?: number;
}

export interface ICombatEvent {
  /** Raw srcFlags/destFlags (params[2]/params[6], hex-decoded) */
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
  /**
   * Damage past the target's remaining health (positive), present ONLY when
   * > 0 — i.e. this event is a killing blow. Needed as its own field because
   * `effectiveAmount` is zeroed for pet/guardian targets, which erases the
   * `amount − effectiveAmount` difference exactly on the units whose death has
   * no other evidence: 12.x logs write `UNIT_DIED` for 5 of 13,439 summoned
   * totems/guardians (GH #100, docs/log-observability-audit.md direction 4).
   */
  overkill?: number;
}

export interface IAbsorbEvent extends ICombatEvent {
  absorbedAmount: number;
  shieldSpellId?: string;
  /** Who threw the punch the shield ate. On `absorbsIn` (victim-keyed) srcUnit
   * is the shield's OWNER, so the attacker needs its own field. */
  attackerId?: string;
}

/**
 * `SPELL_HEAL_ABSORBED` — healing ON this unit that a heal-absorb debuff ate.
 *
 * Not an HPS correction: `SPELL_HEAL.amount` is already net of heal absorption
 * (grounding audit D8). What this carries is the fact HPS cannot express — how
 * much healing was aimed at the unit and swallowed, and by which debuff.
 */
export interface IHealAbsorbEvent {
  timestamp: number;
  /** The heal-absorb debuff (Necrotic Wound and friends). */
  absorbSpellId: string;
  absorbSpellName: string;
  /** Who applied that debuff. */
  absorbCasterId: string;
  /** Whose healing was eaten. */
  healerId: string;
  healSpellId: string;
  healSpellName: string;
  absorbedAmount: number;
  /** What the heal would have been. */
  totalAmount: number;
  logLine: ILogLine;
}

/**
 * A `*_MISSED` outcome (SPELL_MISSED / SPELL_PERIODIC_MISSED / RANGE_MISSED /
 * SWING_MISSED). Only IMMUNE and REFLECT are unique to this event class —
 * `missType === "ABSORB"` restates the same hit's own SPELL_ABSORBED line
 * (same instant, same numbers), so consumers must never add ABSORB rows on
 * top of absorb events.
 */
export interface IMissEvent extends ICombatEvent {
  missType: string;
  /** For ABSORB misses, the absorbed amount; 0/NaN otherwise. */
  amount: number;
}

export interface ISpellEvent extends ICombatEvent {
  /** The targeted spell of SPELL_DISPEL/_INTERRUPT/_STOLEN style events
   * (params[11..12]); undefined for all other events */
  extraSpellId?: string;
  extraSpellName?: string;
}

/** `SPELL_EMPOWER_END` — an Evoker empowered cast and the charge level it was
 * released at. Deliberately NOT folded into spellCastEvents: the same cast
 * already appears there as its own SPELL_CAST_SUCCESS, so folding would
 * double-count every empowered cast. */
export interface IEmpowerEvent extends ICombatEvent {
  /** Release level (1-based; Font of Magic raises the cap, the log only
   * carries the level actually reached). */
  level: number;
}

/** Legacy interface alias: absorb event */
export interface CombatAbsorbAction extends IAbsorbEvent {}

/** Legacy interface alias: an action event carrying the extra-spell fields */
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
  /** Converted units are always well-formed (the parser already filtered out
   * malformed ones) */
  isWellFormed: boolean;
  /** Legacy interface field (the affiliation bits of the flags); the converter
   * does not populate it, hence optional */
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
  /** Legacy interface field: shield absorption chewed through as the attacker;
   * not populated by the converter yet (optional) */
  absorbsDamaged?: IAbsorbEvent[];
  /** Legacy interface field group: _SUPPORT events (augmentation
   * contributions); not populated by the converter yet (optional) */
  supportDamageIn?: IHpEvent[];
  supportDamageOut?: IHpEvent[];
  supportHealIn?: IHpEvent[];
  supportHealOut?: IHpEvent[];
  /** Legacy interface field: death records excluding feign death; not
   * populated by the converter yet (optional; consumers fall back to
   * deathRecords) */
  consciousDeathRecords?: ILogLine[];
  auraEvents: IAuraEvent[];
  spellCastEvents: ISpellEvent[];
  /** SPELL_CAST_START (start of a cast bar; instants have no such event). Old
   * archived docs have no castStarts field → [] (optional; consumers must
   * tolerate its absence). */
  castStartEvents?: ISpellEvent[];
  petSpellCastEvents: ISpellEvent[];
  actionIn: ISpellEvent[];
  actionOut: ISpellEvent[];
  deathRecords: ILogLine[];
  advancedActions: IAdvancedAction[];
  /** Healing on this unit that a heal-absorb debuff ate. Absent on archived
   * docs written before 2026-08-23 (the event was discarded by the parser), so
   * consumers must tolerate undefined rather than assume []. */
  healAbsorbsIn?: IHealAbsorbEvent[];
  /** Attacks BY this unit that missed (immune/reflect/dodge/...). Same
   * absent-on-old-archives caveat as healAbsorbsIn. */
  missesOut?: IMissEvent[];
  /** Attacks ON this unit that missed — "I was immune to that". Same caveat. */
  missesIn?: IMissEvent[];
  /** Empowered casts BY this unit with their release level. Same
   * absent-on-old-archives caveat as healAbsorbsIn. */
  empowerEnds?: IEmpowerEvent[];
}

export interface IAdvancedAction {
  /** Resource readings from the same advanced block. Empty until 2026-08-23 —
   * the parser did not decode the power fields at all — and still empty for a
   * line that carried none, so mana-based checks must keep degrading
   * gracefully rather than assuming a reading exists. */
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

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
  /** Index of this event's source line within its match's rawLines (for a
   * shuffle it is the index within the round; the offset into the whole
   * raw.txt is the sum of each round's linesTotal). The anchor for B2
   * provenance deep links. */
  lineIndex?: number;
}

export interface GladHpEvent extends GladEventBase {
  amount: number;
  effectiveAmount: number;
  absorbed?: number;
  /** Critical hit (materialized by the L1 hp-tail decode; after params
   * slimming the tail is no longer persisted with the doc). */
  crit?: boolean;
}

export interface GladAbsorbEvent extends GladEventBase {
  absorbedAmount: number;
  attackerId: string;
  /** Who the shield protected. Three units take part in a SPELL_ABSORBED —
   * attacker (`attackerId`, = `destId`), shield owner (`srcId`) and victim —
   * and only the first two are the keys the L3 arrays are grouped by, so the
   * victim has to travel on the event itself. Params slimming clears
   * `params[4]`, so re-deriving it downstream is not possible. */
  victimId: string;
  /** The ATTACKER's spell that was absorbed (the event's own `spellId` is the
   * SHIELD). Present only on spell-form absorbs; absent on swing absorbs and
   * on documents stored before 2026-09-20 — absent means unknown. */
  attackSpellId?: number;
  attackSpellName?: string;
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
  /** Resource readings carried by the same advanced block (mana, essence,
   * insanity, …). A unit can report more than one at a time. Empty when the
   * line carried no readable power fields. */
  powers?: Array<{ powerType: number; current: number; max: number }>;
}

/** `SPELL_HEAL_ABSORBED` — healing on this unit that a heal-absorb debuff ate.
 * Stored on the unit that was being healed (the log's base dest). */
export interface GladHealAbsorbEvent {
  timestamp: number;
  /** The heal-absorb debuff (Necrotic Wound and friends). */
  absorbSpellId: number;
  absorbSpellName: string;
  /** Who applied that debuff. */
  absorbCasterId: string;
  /** Whose healing got eaten. */
  healerId: string;
  healSpellId: number;
  healSpellName: string;
  /** How much of the heal was eaten, and how big the heal would have been. */
  absorbedAmount: number;
  totalAmount: number;
  lineIndex?: number;
}

/** `SPELL_EMPOWER_END` — an Evoker empowered cast and the charge level it was
 * released at. Kept out of `casts` on purpose: folding it in would double-count
 * every empowered cast, which already appears as its own SPELL_CAST_SUCCESS. */
export interface GladEmpowerEvent extends GladEventBase {
  level: number;
}

/** A `*_MISSED` outcome. Only IMMUNE/REFLECT are unique to this event —
 * `missType === "ABSORB"` restates the line's own SPELL_ABSORBED. */
export interface GladMissEvent extends GladEventBase {
  missType: string;
  amount: number;
}

export interface GladUnit {
  id: string; // GUID
  name: string;
  ownerId?: string; // pet -> owner
  kind: UnitKind;
  reaction: Reaction;
  classId: number; // Blizzard class ID; 0 = unknown
  specId: number; // Blizzard spec ID; 0 = unknown
  info?: GladCombatantInfo; // Players only
  damageOut: GladHpEvent[];
  damageIn: GladHpEvent[];
  healOut: GladHpEvent[];
  healIn: GladHpEvent[];
  absorbsOut: GladAbsorbEvent[];
  absorbsIn: GladAbsorbEvent[];
  casts: GladSpellEvent[];
  /** SPELL_CAST_START (start of a cast bar; instant casts have no such
   * event). Consumed by the replay cast bars. */
  castStarts: GladSpellEvent[];
  petCasts: GladSpellEvent[];
  auraEvents: GladAuraEvent[];
  actionsOut: GladSpellEvent[];
  actionsIn: GladSpellEvent[];
  deaths: GladDeathEvent[];
  unconsciousEvents: GladDeathEvent[];
  advancedSamples: GladAdvancedSample[];
  /** Healing ON this unit that a heal-absorb debuff ate (victim-keyed). */
  healAbsorbsIn: GladHealAbsorbEvent[];
  /** Empowered casts BY this unit, with their release level. */
  empowerEnds: GladEmpowerEvent[];
  /** Attacks BY this unit that missed, with the reason (IMMUNE, REFLECT, …). */
  missesOut: GladMissEvent[];
  /** Attacks ON this unit that missed — "I was immune to that". */
  missesIn: GladMissEvent[];
}

export interface GladMatchBase {
  id: string; // Content hash
  bracket: string;
  zoneId: string;
  startTime: number;
  endTime: number;
  units: Record<string, GladUnit>;
  playerId: string; // GUID of the log's owner
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

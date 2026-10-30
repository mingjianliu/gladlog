/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Shared factory helpers for unit tests.
 * All mock objects use `as unknown as X` casts because CombatAction et al.
 * are classes with readonly fields — plain-object stubs are sufficient for
 * the structural checks performed in utils code.
 */

import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

 
type AnyObj = Record<string, any>;

/**
 * Every event carries what parser-compat writes on a real one (weekly review
 * 2026-10-24, audited against the converted public wowarenalogs testlogs):
 * a `logLine.lineIndex` — the log order inside a millisecond, which
 * same-ms readers decide on (press HP D31) — taken here from creation
 * order; damage in the production sign (`amount` / `effectiveAmount`
 * negative: convert.ts negates both — 2cefc73's 5 % filter was inverted
 * because this helper wrote them positive); and no advanced HP / position
 * fields on a damage or heal row — production keeps those on
 * `advancedActions` only, so a reader that took them off a hit row passed
 * here and read nothing in the app.
 */
let nextLineIndex = 0;
const lineIndex = (): number => ++nextLineIndex;

/** Minimal damage-taken event (CombatHpUpdateAction shape). */
export function makeDamageEvent(
  timestamp: number,
  amount: number,
  destUnitId = "player-1",
): AnyObj {
  // callers pass the hit's size; production stores damage negative
  const signed = -Math.abs(amount);
  return {
    logLine: {
      event: LogEvent.SPELL_DAMAGE,
      timestamp,
      parameters: [],
      lineIndex: lineIndex(),
    },
    timestamp,
    effectiveAmount: signed,
    amount: signed,
    srcUnitId: "enemy-1",
    srcUnitName: "Enemy",
    destUnitId,
    destUnitName: "Target",
    spellId: "1",
    spellName: "TestSpell",
  };
}

/** Minimal SPELL_HEAL event (CombatHpUpdateAction shape). */
export function makeHealEvent(
  timestamp: number,
  srcUnitId: string,
  amount: number,
  overhealAmount = 0,
): AnyObj {
  return {
    logLine: {
      event: LogEvent.SPELL_HEAL,
      timestamp,
      parameters: [],
      lineIndex: lineIndex(),
    },
    timestamp,
    amount,
    effectiveAmount: amount - overhealAmount,
    srcUnitId,
    srcUnitName: "Healer",
    destUnitId: "player-1",
    destUnitName: "Target",
    spellId: "1",
    spellName: "TestHeal",
  };
}

/** Minimal SPELL_CAST_SUCCESS event (CombatAction shape). */
export function makeSpellCastEvent(
  spellId: string,
  timestamp: number,
  destUnitId: string,
  destUnitName = "Target",
  srcUnitId = "player-1",
  srcUnitName = "Player",
  destUnitFlags = 0,
  spellName?: string,
): AnyObj {
  return {
    logLine: {
      event: LogEvent.SPELL_CAST_SUCCESS,
      timestamp,
      parameters: [],
      lineIndex: lineIndex(),
    },
    timestamp,
    spellId,
    spellName: spellName ?? spellId,
    srcUnitId,
    srcUnitName,
    destUnitId,
    destUnitName,
    destUnitFlags,
  };
}

/** Minimal aura event (CombatAction shape). */
export function makeAuraEvent(
  event: LogEvent,
  spellId: string,
  timestamp: number,
  srcUnitId = "enemy-1",
  destUnitId = "player-1",
  auraType: "BUFF" | "DEBUFF" = "DEBUFF",
): AnyObj {
  const parameters: (string | number)[] = [];
  parameters[11] = auraType;
  return {
    logLine: { event, timestamp, parameters, lineIndex: lineIndex() },
    auraType,
    timestamp,
    spellId,
    spellName: spellId,
    srcUnitId,
    srcUnitName: "Source",
    destUnitId,
    destUnitName: "Target",
  };
}

/** Minimal CombatAdvancedAction (position + HP snapshot). */
export function makeAdvancedAction(
  timestamp: number,
  posX: number,
  posY: number,
  maxHp = 500_000,
  currentHp = 500_000,
): AnyObj {
  return {
    logLine: { event: LogEvent.SPELL_DAMAGE, timestamp, parameters: [] },
    timestamp,
    advancedActorPositionX: posX,
    advancedActorPositionY: posY,
    advancedActorMaxHp: maxHp,
    advancedActorCurrentHp: currentHp,
    advancedActorFacing: 0,
    advancedActorItemLevel: 450,
    advancedActorPowers: [],
    advancedActorId: "unit-1",
    advancedOwnerId: "",
    spellId: null,
    spellName: null,
    srcUnitId: "unit-1",
    srcUnitName: "",
    destUnitId: "unit-1",
    destUnitName: "",
  };
}

/** Build a minimal ICombatUnit stub. */
export function makeUnit(
  id: string,
  overrides: {
    name?: string;
    spec?: CombatUnitSpec;
    class?: CombatUnitClass;
    reaction?: CombatUnitReaction;
    spellCastEvents?: AnyObj[];
    castStartEvents?: AnyObj[];
    auraEvents?: AnyObj[];
    actionIn?: AnyObj[];
    actionOut?: AnyObj[];
    damageIn?: AnyObj[];
    damageOut?: AnyObj[];
    /** Victim-keyed absorbs — the hits a shield ate for this unit. */
    absorbsIn?: AnyObj[];
    healOut?: AnyObj[];
    advancedActions?: AnyObj[];
    petSpellCastEvents?: AnyObj[];
    deathRecords?: AnyObj[];
    info?: AnyObj | undefined;
    ownerId?: string;
  } = {},
): ICombatUnit {
  return {
    id,
    isWellFormed: true,
    name: overrides.name ?? id,
    ownerId: overrides.ownerId ?? "",
    reaction: overrides.reaction ?? CombatUnitReaction.Friendly,
    type: CombatUnitType.Player,
    class: overrides.class ?? CombatUnitClass.None,
    spec: overrides.spec ?? CombatUnitSpec.None,
    info: overrides.info as ICombatUnit["info"],
    damageIn: (overrides.damageIn ?? []) as ICombatUnit["damageIn"],
    damageOut: (overrides.damageOut ?? []) as ICombatUnit["damageOut"],
    healIn: [],
    healOut: (overrides.healOut ?? []) as ICombatUnit["healOut"],
    absorbsIn: (overrides.absorbsIn ?? []) as ICombatUnit["absorbsIn"],
    absorbsOut: [],
    healAbsorbsIn: [],
    missesIn: [],
    missesOut: [],
    empowerStarts: [],
    empowerEnds: [],
    empowerInterrupts: [],
    actionIn: (overrides.actionIn ?? []) as ICombatUnit["actionIn"],
    actionOut: (overrides.actionOut ?? []) as ICombatUnit["actionOut"],
    auraEvents: (overrides.auraEvents ?? []) as ICombatUnit["auraEvents"],
    spellCastEvents: (overrides.spellCastEvents ??
      []) as ICombatUnit["spellCastEvents"],
    castStartEvents: (overrides.castStartEvents ??
      []) as ICombatUnit["castStartEvents"],
    petSpellCastEvents: (overrides.petSpellCastEvents ??
      []) as ICombatUnit["petSpellCastEvents"],
    deathRecords: (overrides.deathRecords ?? []) as ICombatUnit["deathRecords"],
    // Stamp advancedActorId like production convert.ts does (unit.id) — the shared HP
    // sampler (getUnitHpAtTimestamp) rejects samples whose actor id doesn't match.
    advancedActions: (overrides.advancedActions ?? []).map((a) => ({
      ...a,
      advancedActorId: id,
    })) as ICombatUnit["advancedActions"],
  };
}

/** Build a minimal AtomicArenaCombat-compatible combat object. */
export function makeCombat(
  startTime: number,
  endTime: number,
): { startTime: number; endTime: number } {
  return { startTime, endTime };
}

/** Minimal SPELL_INTERRUPT event (CombatExtraSpellAction shape). */
export function makeInterruptEvent(
  kickSpellId: string,
  kickSpellName: string,
  interruptedSpellId: string,
  interruptedSpellName: string,
  timestamp: number,
  srcUnitId = "enemy-1",
  srcUnitName = "Enemy",
): AnyObj {
  // Raw SPELL_INTERRUPT semantics: spellId = the kick, extraSpellId = the
  // spell that was interrupted
  return {
    logLine: {
      event: LogEvent.SPELL_INTERRUPT,
      timestamp,
      parameters: [],
      lineIndex: lineIndex(),
    },
    timestamp,
    spellId: kickSpellId,
    spellName: kickSpellName,
    extraSpellId: interruptedSpellId,
    extraSpellName: interruptedSpellName,
    srcUnitId,
    srcUnitName,
    destUnitId: "player-1",
    destUnitName: "Target",
  };
}

/**
 * Minimal SPELL_DISPEL event stub (CombatExtraSpellAction shape).
 * srcUnitId: the unit that performed the dispel (may be a pet ID)
 * destUnitId: the target that was dispelled
 * dispelSpellId: the ability used to dispel (e.g. Detox '115450')
 * removedSpellId: the effect that was removed (e.g. Polymorph '118')
 * removedSpellName: display name of the removed effect
 */
export function makeDispelAction(
  timestamp: number,
  srcUnitId: string,
  destUnitId: string,
  dispelSpellId: string,
  removedSpellId: string,
  removedSpellName: string,
  destUnitName = "Target",
  srcUnitName = "Source",
): AnyObj {
  return {
    logLine: {
      event: LogEvent.SPELL_DISPEL,
      timestamp,
      parameters: [],
      lineIndex: lineIndex(),
    },
    timestamp,
    spellId: dispelSpellId,
    spellName: dispelSpellId,
    extraSpellId: removedSpellId,
    extraSpellName: removedSpellName,
    srcUnitId,
    srcUnitName,
    destUnitId,
    destUnitName,
  };
}

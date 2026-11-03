/**
 * GH #176 (user ruling 2026-11-02): a major press no hand list names gets a
 * `[PRESS]` line of its own. "Major" = an official cooldown (DB2,
 * `effectiveCooldownSeconds`) of at least `PRESS_LINE_MIN_CD_SECONDS`; the
 * important buttons below it wait for a whitelist of their own.
 *
 * The rosters a press has to pass to be printed by another family
 * (`classMetadata`, `OFFENSIVE_CD_SPELL_IDS`, `SPELL_EFFECT_OVERRIDES`) are
 * `isRosterPressId`; the press families that print a press under a tag of
 * their own (a CC, a kick, a purge…) are `PRESS_LINE_TAG`. Both are shared
 * with the Curated-List forward check `listGapPress`
 * (`packages/eval/scripts/scan5/listGap.ts`): the check counts a press with no
 * line by the same two predicates the renderer uses to decide to print one.
 *
 * The numbers on the line are the shared cooldown model's
 * (`unitCooldownEntry`: this unit's talents, its per-press reductions and
 * resets), never the static DB2 value, and the duration is the caster's
 * talented one (`buffFullDurationForCaster`) for an aura its press put up.
 */
import {
  AtomicArenaCombat,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import { effectAurasOfCast } from "../data/castEffectAuras";
import { classMetadata } from "../data/classSpells";
import { effectiveCooldownSeconds } from "../data/spellEffectData";
import { timeSpiralEchoMs } from "../data/talentScriptedCooldowns";
import { buffFullDurationForCaster } from "./buffDuration";
import { isNoPressRow } from "./castPress";
import { isStasisReplayCast } from "./combatStates";
import {
  canonicalSpellId,
  type IMajorCooldownInfo,
  pressReadyAgainAtSeconds,
  unitCooldownEntry,
} from "./cooldowns";
import {
  OFFENSIVE_CD_SPELL_IDS,
  OFFENSIVE_PRESS_FACT_IDS,
  SPELL_EFFECT_OVERRIDES,
} from "./spellDanger";
import { equippedBadgeCount, GLADIATOR_BADGE_SPELL_ID } from "./trinketType";

/** user ruling 2026-11-02 (GH #176): 45 s, not 30 s; 14.1 lines per owner
 * view on the 605 set against 33.0 at 30 s */
export const PRESS_LINE_MIN_CD_SECONDS = 45;

/** a printed `[tag]` that states a press of the spell it names */
export const PRESS_LINE_TAG =
  /\[(YOU|TEAM)\] \[(CD|CC|PROC|CAST)\]|\[ENEMY (CD|DEF|UTILITY|HEAL CD|TRINKET|HARD CAST|PURGE|CLEANSE)\]|\[TRINKET\]|\[PRESS\]|\[(CLEANSE|PURGE|GRIP|KICK|DISARM|SILENCE|SHIELD|ROOT|DISPEL|MINOR DISPELS|CC ON ENEMY|CC ON TEAM|CC NOT LANDED|ENEMY SUMMON)\]/;

/** Gladiator's Medallion, Adaptation's activation, the two racials that share
 * the PvP trinket's lock: printed by `[TRINKET]` / `[ENEMY TRINKET]` */
export const TRINKET_LINE_IDS: ReadonlySet<string> = new Set([
  "336126",
  "336135",
  "59752",
  "7744",
]);
/** the group heal of the class (fact7 D51, D55), printed `[ENEMY HEAL CD]` */
export const FILLED_HEAL_IDS: ReadonlySet<string> = new Set(["15286"]);

const rosterIds = new Set(
  classMetadata.flatMap((c) => c.abilities.map((a) => a.spellId)),
);

/** On a hand roster some family prints a press of from (the ids `listGapPress`
 * calls `listed`). */
export function isRosterPressId(id: string): boolean {
  const canon = canonicalSpellId(id);
  return (
    rosterIds.has(id) ||
    rosterIds.has(canon) ||
    OFFENSIVE_CD_SPELL_IDS.has(id) ||
    OFFENSIVE_CD_SPELL_IDS.has(canon) ||
    id in SPELL_EFFECT_OVERRIDES
  );
}

/** A press of `id` is the `[PRESS]` line's to print, when no other line does:
 * a major official cooldown on no roster, not a trinket and not a press fact
 * another family already owns. */
export function isOffListPressId(id: string): boolean {
  return (
    (effectiveCooldownSeconds(id) ?? 0) >= PRESS_LINE_MIN_CD_SECONDS &&
    !isRosterPressId(id) &&
    !TRINKET_LINE_IDS.has(id) &&
    !FILLED_HEAL_IDS.has(id) &&
    !OFFENSIVE_PRESS_FACT_IDS.has(id)
  );
}

const FIRST_UNIT = /(?:^|[\s(])(\d+)\(/;
const BY_UNIT = /^ \((?:by|from) (\d+)\(/;
const OWNED_BY_UNIT = /(\d+)\([^)]*\)'s (?:\w+'s )?$/;

/**
 * Whose press a line's mention of `spell` states: the unit its own `(by N)` /
 * `(from N)` names (`← Dragon's Breath (by 3(FMage))`) or `N's` claims
 * (`interrupted 5(SPriest)'s Void Torrent`), the owner on a `[YOU]` line or a
 * `your X`, else the line's first unit (`[TEAM] [CD] 3(AWarrior) …`, `[PURGE]
 * 1(FMage) purged … (Spellsteal)`). `spell` undefined: the line's own subject,
 * a trinket line naming no spell. Returns the roster number (`"4"`).
 */
export function pressLineCaster(
  text: string,
  spell: string | undefined,
  ownerNumber: string | undefined,
): string | undefined {
  const at = spell === undefined ? -1 : text.indexOf(spell);
  if (at >= 0) {
    const by = BY_UNIT.exec(text.slice(at + spell!.length));
    if (by) return by[1];
    const owns = OWNED_BY_UNIT.exec(text.slice(0, at));
    if (owns) return owns[1];
  }
  if (/\[YOU\]|\byour /.test(at >= 0 ? text.slice(0, at) : text))
    return ownerNumber;
  return FIRST_UNIT.exec(text)?.[1];
}

/** a press-tag line within this many whole seconds of the press states it */
export const PRESS_LINE_NEAR_S = 1;

/** Does a rendered line (time stripped) state this unit's press of `name`? */
export function lineStatesPress(
  text: string,
  name: string,
  casterNumber: string | undefined,
  ownerNumber: string | undefined,
): boolean {
  return (
    text.includes(name) &&
    PRESS_LINE_TAG.test(text) &&
    pressLineCaster(text, name, ownerNumber) === casterNumber
  );
}

export interface IOffListPress {
  unit: ICombatUnit;
  spellId: string;
  timeSeconds: number;
  /** the model's cooldown for this unit (talents and charges resolved) */
  cooldownSeconds: number;
  charges: number;
  /** when the model gives a press back (`pressReadyAgainAtSeconds`); the
   * press's own second = a charge is still in hand; null = the model does
   * not count this row as a press of its entry */
  readyAgainAtSeconds: number | null;
  /** the talented duration of the aura this press put up (its own or its
   * effect aura's), when one went up — or was refreshed — within
   * `PRESS_AURA_LEAD_MS` */
  durationSeconds?: number;
  /** where `durationSeconds` was read: the unit and the APPLIED row
   * (`pressDuration`). The press scan measures the
   * life of this row, not one of its own choosing. */
  durationAura?: { unitId: string; spellId: string; atMs: number };
  /** the model's free press (`freeRecast` — Time Spiral, Death's Arrival,
   * Escape from Reality …): it spent no charge and restarted nothing;
   * `readyAgainAtSeconds` is the cooldown it stands on */
  free?: true;
  /** two of the item worn, a cooldown each (Gladiator's Badge,
   * `equippedBadgeCount`): `readyAgainAtSeconds` is when either is back */
  equipped?: number;
}

/** The entry as it stood at the press: its later presses out. The ready
 * reading samples `CD_INSTANT_SLACK_S` past the instant, so a press 0.8 s
 * later (Between the Eyes after Ace Up Your Sleeve reset it) would be read
 * as this one's. */
function upToPress(entry: IMajorCooldownInfo, t: number): IMajorCooldownInfo {
  const keep = (c: { timeSeconds: number }) => c.timeSeconds <= t + 0.05;
  return {
    ...entry,
    casts: entry.casts.filter(keep),
    ...(entry.sharedCasts
      ? { sharedCasts: entry.sharedCasts.filter(keep) }
      : {}),
  };
}

/** a shorter aura is the press's own blink (Berserker Shout's 0.1 s), not
 * an effect that runs: no `lasts` */
export const PRESS_LINE_MIN_DURATION_S = 1;

/** the press's own aura is applied within this of its cast row */
export const PRESS_AURA_LEAD_MS = 1000;

/** A press's aura on its cast's target may land this long after the cast
 * row: Holy Armaments travel (GH #179, 22 files: 370 target applications,
 * 200 within 1 s, 360 within 2 s, the latest 3.8 s). */
export const PRESS_TARGET_AURA_LEAD_MS = 4000;

/** The aura rows a press may have put up — APPLIED / REFRESH by the caster
 * of its own or its effect aura's id — one per unit, the cast's target's
 * first: on the target within `PRESS_TARGET_AURA_LEAD_MS` (never at or past
 * the caster's next press of the spell, `untilMs`), on anyone else within
 * `PRESS_AURA_LEAD_MS`. A press that arms its target and its caster too
 * (Holy Armaments) prints the target's: the caster's copy is stretched by
 * later procs (GH #179, 2026-11-03: lives 26–48 s on the caster where the
 * target's ran its 20 s). */
export function pressAuraCandidates(
  caster: ICombatUnit,
  cast: {
    spellId?: string;
    destUnitId?: string;
    logLine: { timestamp: number };
  },
  allUnits: readonly ICombatUnit[],
  untilMs = Infinity,
): Array<{ unit: ICombatUnit; row: ICombatUnit["auraEvents"][number] }> {
  const at = cast.logLine.timestamp;
  const auraIds = new Set([cast.spellId!, ...effectAurasOfCast(cast.spellId!)]);
  const ordered = [
    ...allUnits.filter((u) => u.id === cast.destUnitId),
    ...allUnits.filter((u) => u.id !== cast.destUnitId),
  ];
  const out: Array<{
    unit: ICombatUnit;
    row: ICombatUnit["auraEvents"][number];
  }> = [];
  for (const u of ordered) {
    const end =
      u.id === cast.destUnitId
        ? Math.min(at + PRESS_TARGET_AURA_LEAD_MS, untilMs - 1)
        : at + PRESS_AURA_LEAD_MS;
    const row = (u.auraEvents ?? []).find(
      (a) =>
        (a.logLine.event === LogEvent.SPELL_AURA_APPLIED ||
          a.logLine.event === LogEvent.SPELL_AURA_REFRESH) &&
        a.srcUnitId === caster.id &&
        !!a.spellId &&
        auraIds.has(a.spellId) &&
        a.logLine.timestamp >= at &&
        a.logLine.timestamp <= end,
    );
    if (row) out.push({ unit: u, row });
  }
  return out;
}

/** The duration a press's line prints, and the APPLIED row it is read
 * from: the first of `pressAuraCandidates` (bounded by the caster's next
 * press of the spell among `casterRows`) whose talented duration is at least
 * `PRESS_LINE_MIN_DURATION_S`; none when the first is a REFRESH. Shared by
 * the line and its gate (`offListPressLine` lastsBeyond, scan5). */
export function pressDuration(
  caster: ICombatUnit,
  cast: {
    spellId?: string;
    destUnitId?: string;
    logLine: { timestamp: number };
  },
  allUnits: readonly ICombatUnit[],
  casterRows: ICombatUnit["spellCastEvents"],
):
  | {
      durationSeconds: number;
      unit: ICombatUnit;
      row: ICombatUnit["auraEvents"][number];
    }
  | undefined {
  const at = cast.logLine.timestamp;
  const nextPressMs = casterRows.find(
    (r) =>
      r.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
      r.spellId === cast.spellId &&
      r.logLine.timestamp > at,
  )?.logLine.timestamp;
  for (const { unit, row } of pressAuraCandidates(
    caster,
    cast,
    allUnits,
    nextPressMs,
  )) {
    // laid on an aura already up: the life is what was left plus the
    // press's share, not the table's length (Holy Armaments: 605 files,
    // 96 + 71 of the presses printed `lasts 20s` lived 26–48 s)
    if (row.logLine.event === LogEvent.SPELL_AURA_REFRESH) return undefined;
    // nor when a second copy lands on it in the same millisecond: a Holy
    // Armament cast on oneself by a paladin it also arms — APPLIED then
    // REFRESH, and the aura runs 40 s (GH #179: 2 of 79 self-casts in 22
    // files, both 40.0 s)
    if (
      (unit.auraEvents ?? []).some(
        (a) =>
          a !== row &&
          a.logLine.event === LogEvent.SPELL_AURA_REFRESH &&
          a.srcUnitId === caster.id &&
          a.spellId === row.spellId &&
          a.logLine.timestamp === row.logLine.timestamp,
      )
    )
      return undefined;
    const d = buffFullDurationForCaster(row.spellId!, caster, at, {
      pressed: true,
    });
    if (d !== undefined && d >= PRESS_LINE_MIN_DURATION_S)
      return { durationSeconds: d, unit, row };
  }
  return undefined;
}

/** The round's off-list presses of every player, in time order. */
export function extractOffListPresses(
  players: readonly ICombatUnit[],
  combat: AtomicArenaCombat,
  roundEndAtMs: number,
): IOffListPress[] {
  const out: IOffListPress[] = [];
  const allUnits = Object.values(combat.units) as ICombatUnit[];
  for (const unit of players) {
    const rows = unit.spellCastEvents ?? [];
    for (const c of rows) {
      if (c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS || !c.spellId)
        continue;
      const at = c.logLine.timestamp;
      if (at < combat.startTime || at > roundEndAtMs) continue;
      if (!isOffListPressId(c.spellId) || isNoPressRow(c, rows)) continue;
      // Stasis replaying a stored spell: its copy, not a press (the ledger's
      // own reading, `isStasisReplayCast`)
      if (isStasisReplayCast(unit, c.spellId, at)) continue;
      // nor is a row echoing a Time Spiral free press (`timeSpiralEchoMs`)
      if (
        timeSpiralEchoMs(
          unit,
          c.spellId,
          rows
            .filter(
              (r) =>
                r.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
                r.spellId === c.spellId,
            )
            .map((r) => r.logLine.timestamp),
        ).includes(at)
      )
        continue;
      const entry = unitCooldownEntry(unit, combat, c.spellId);
      if (!entry) continue;
      const t = (at - combat.startTime) / 1000;
      const dur = pressDuration(unit, c, allUnits, rows);
      out.push({
        unit,
        spellId: c.spellId,
        timeSeconds: t,
        cooldownSeconds: entry.cooldownSeconds,
        charges: entry.charges ?? 1,
        readyAgainAtSeconds: pressReadyAgainAtSeconds(upToPress(entry, t), t),
        ...(entry.casts.some(
          (k) => k.freeRecast && Math.abs(k.timeSeconds - t) < 0.05,
        )
          ? { free: true as const }
          : {}),
        ...(c.spellId === GLADIATOR_BADGE_SPELL_ID &&
        equippedBadgeCount(unit) >= 2
          ? { equipped: equippedBadgeCount(unit) }
          : {}),
        ...(dur
          ? {
              durationSeconds: dur.durationSeconds,
              durationAura: {
                unitId: dur.unit.id,
                spellId: dur.row.spellId!,
                atMs: dur.row.logLine.timestamp,
              },
            }
          : {}),
      });
    }
  }
  return out.sort((a, b) => a.timeSeconds - b.timeSeconds);
}

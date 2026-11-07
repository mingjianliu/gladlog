/**
 * fact8 class 5 (D11 D17 D22 D26 D40): a tracked cooldown's own aura that goes
 * up on its unit with no press of it — a talent's proc, a rider of another
 * spell. The enemy side has read two of the three families since F15 / F18;
 * the friendly timeline walks the cooldown ledger only, and a unit that also
 * pressed the button keeps its ledger clean of aura-only rows
 * (`auraOnlyActivationSeconds` is fallback-only), so these had no line on our
 * side, and the enemy's healing majors had no reading at all.
 *
 * One reading per family, the ones the enemy lines already use:
 *  - a save: `enemyDefensiveEvents`' own `noPressLogged` rows;
 *  - an offensive cooldown: `auraOffensiveOccurrences`' occurrences no press
 *    backs (the `(no press)` ones — a 12.1.5 Doom Winds proc among them; a
 *    12.1.0 Doom Winds whose press is unlogged is a press, fact11 D44);
 *  - a healing major: `castlessHealCdAuras` below.
 */
import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { castsOfEffectAura, effectAurasOfCast } from "../data/castEffectAuras";
import { ENEMY_HEAL_CD_IDS, isEnemyHealCdFor } from "../data/enemyHealCds";
import { getEnglishSpellName } from "../data/spellEffectData";
import { AURA_PRESS_BY_ERA, auraStandsForPressAt } from "./auraActivationEra";
import { dropAuraRebroadcasts } from "./auraIntervals";
import {
  enemyDefensiveEvents,
  SAVE_CAST_AURA_PAIR_S,
  SELF_SAVE_IDS,
} from "./enemyDefensives";
import { isResyncBatchAt } from "./hiddenPress";
import {
  auraOffensiveOccurrences,
  NO_PRESS_SUFFIX,
} from "./offensiveAuraOccurrences";

export interface IAuraOnlyActivation {
  atSeconds: number;
  /** the cooldown's id, the ledger's */
  spellId: string;
  /** the name a line prints, without the `(no press)` suffix */
  spellName: string;
  /** `unlogged-press`: a cooldown whose aura stands for a press the log did
   * not write, on this log's date (`AURA_PRESS_BY_ERA`: Doom Winds before
   * 12.1.5) — a press, the button spent (GH #193) */
  family: "save" | "offensive" | "heal" | "unlogged-press";
}

/** The suffix of an `unlogged-press` line: a press the log shows only as its
 * aura (GH #193, user ruling 2026-11-07). */
export const UNLOGGED_PRESS_SUFFIX = " (pressed; the log has only its aura)";

/** A healing major's own aura the unit put on itself with no press beside it
 * (Deeply Rooted Elements' Ascendance, Reforestation's Tree of Life). */
export function castlessHealCdAuras(
  unit: ICombatUnit,
  matchStartMs: number,
  endMs: number,
): IAuraOnlyActivation[] {
  const castOf = new Map<string, string>();
  for (const id of ENEMY_HEAL_CD_IDS) {
    // a save has its reading (Frenzied Regeneration: the `[ENEMY DEF]` line)
    if (!isEnemyHealCdFor(id, unit.spec) || SELF_SAVE_IDS.has(id)) continue;
    for (const a of [id, ...effectAurasOfCast(id)])
      if (!castOf.has(a)) castOf.set(a, id);
  }
  if (castOf.size === 0) return [];
  const presses = new Map<string, number[]>();
  const pressesOf = (castId: string, auraId: string): number[] => {
    const hit = presses.get(castId);
    if (hit) return hit;
    const ids = new Set([
      castId,
      ...effectAurasOfCast(castId),
      ...castsOfEffectAura(auraId),
    ]);
    const out = (unit.spellCastEvents ?? [])
      .filter(
        (c) =>
          c.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
          !!c.spellId &&
          ids.has(c.spellId),
      )
      .map((c) => c.logLine.timestamp);
    presses.set(castId, out);
    return out;
  };
  const out: IAuraOnlyActivation[] = [];
  for (const a of dropAuraRebroadcasts(unit.auraEvents ?? [])) {
    if (a.logLine.event !== LogEvent.SPELL_AURA_APPLIED) continue;
    if (a.srcUnitId !== unit.id || a.destUnitId !== unit.id) continue;
    const castId = a.spellId ? castOf.get(a.spellId) : undefined;
    if (castId === undefined) continue;
    const ms = a.logLine.timestamp;
    if (ms < matchStartMs || ms > endMs || isResyncBatchAt(unit, ms)) continue;
    if (
      pressesOf(castId, a.spellId!).some(
        (p) => Math.abs(p - ms) <= SAVE_CAST_AURA_PAIR_S * 1000,
      )
    )
      continue;
    out.push({
      atSeconds: (ms - matchStartMs) / 1000,
      spellId: castId,
      spellName: getEnglishSpellName(castId, a.spellName ?? ""),
      family: "heal",
    });
  }
  return out;
}

/** Every aura-only activation of one unit inside the round, by time. */
export function auraOnlyActivations(
  unit: ICombatUnit,
  units: readonly ICombatUnit[],
  matchStartMs: number,
  endMs: number,
): IAuraOnlyActivation[] {
  const out = castlessHealCdAuras(unit, matchStartMs, endMs);
  const bounds = { startTime: matchStartMs, endTime: endMs };
  for (const e of enemyDefensiveEvents(unit, [...units], bounds)) {
    // a passive shield (fact10 D25) is no press at all, hidden or not
    if (!e.noPressLogged || e.procSource || e.kind === "passive") continue;
    out.push({
      atSeconds: e.atSeconds,
      spellId: e.spellId,
      spellName: e.spellName,
      family: "save",
    });
  }
  for (const o of auraOffensiveOccurrences(unit, bounds).occurrences) {
    if (o.burstRole !== "burst") continue;
    // a 12.1.0 Doom Winds with no press row is an unlogged press
    // (`auraStandsForPressAt`), never a `(no press)` line (fact11 D44) — it
    // has a line of its own as a press (GH #193, user ruling 2026-11-07:
    // before it had none on our side); from 12.1.5 it is a proc and carries
    // the suffix like every other
    if (
      o.provenance === "press-inferred" &&
      AURA_PRESS_BY_ERA[o.spellId] !== undefined &&
      auraStandsForPressAt(o.spellId, o.startMs)
    ) {
      out.push({
        atSeconds: (o.startMs - matchStartMs) / 1000,
        spellId: o.spellId,
        spellName: o.spellName,
        family: "unlogged-press",
      });
      continue;
    }
    if (!o.spellName.endsWith(NO_PRESS_SUFFIX)) continue;
    // a healer's throughput major on the offensive roster (fact11 D16: Holy
    // Paladin Avenging Wrath) is read once — as the heal family's line
    if (
      out.some(
        (h) =>
          h.family === "heal" &&
          h.spellId === o.spellId &&
          Math.abs(h.atSeconds * 1000 + matchStartMs - o.startMs) <=
            SAVE_CAST_AURA_PAIR_S * 1000,
      )
    )
      continue;
    out.push({
      atSeconds: (o.startMs - matchStartMs) / 1000,
      spellId: o.spellId,
      spellName: o.spellName.slice(0, -NO_PRESS_SUFFIX.length),
      family: "offensive",
    });
  }
  return out.sort((a, b) => a.atSeconds - b.atSeconds);
}

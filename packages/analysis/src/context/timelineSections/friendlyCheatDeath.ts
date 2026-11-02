/**
 * WO3 #17 (r1008-140, dfcccbf2 2:46): a friendly cheat-death proc — Cauterize
 * / Cheat Death refusing a killing blow on the owner or a teammate — gets a
 * `[YOU] [PROC]` / `[TEAM] [PROC]` line, as the same proc on an enemy gets
 * `[ENEMY DEF] … (cheat-death proc)`. Nothing was pressed; the line prints no
 * HP (the proc sets it).
 *
 * The ids are the `kind: "cheatDeath"` markers of `CRISIS_PROC_ANSWERS`
 * (crisisDecisionPoints.ts: Cauterize's aura 87023 251/251 self and heal
 * 1286444, Cheat Death 45182 25/25) — the same reading the crisis layer
 * credits, applied on the unit by the unit itself.
 */
import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { CRISIS_PROC_ANSWERS } from "../../analysis/crisisDecisionPoints";
import { dropAuraRebroadcasts } from "../../utils/auraIntervals";
import { auraOnlyActivations } from "../../utils/auraOnlyActivations";
import {
  type IMajorCooldownInfo,
  specToString,
} from "../../utils/cooldowns";
import {
  NO_PRESS_SUFFIX,
  OFFENSIVE_FORM_FACT_AURAS,
} from "../../utils/offensiveAuraOccurrences";
import { fmtTime } from "../../utils/renderGrid";

/** The words the line closes on — `[ENEMY DEF]`'s label for the same proc. */
export const CHEAT_DEATH_PROC_LABEL = "(cheat-death proc)";

/** Cauterize's aura and heal stand within a second of each other, as
 * `effectSaves` joins them for `[ENEMY DEF]`. */
const CHEAT_DEATH_MARKERS_MS = 1000;

export function emitFriendlyCheatDeathEntries(ctx: {
  owner: ICombatUnit;
  friends: readonly ICombatUnit[];
  matchStartMs: number;
  matchEndSeconds: number;
  roundEndAtMs?: number;
  pid: (name: string) => string;
  addEntry: (atSeconds: number, line: string) => void;
}): boolean {
  const { owner, friends, matchStartMs, matchEndSeconds, pid, addEntry } = ctx;
  const endMs = Math.min(
    ctx.roundEndAtMs ?? Infinity,
    matchStartMs + matchEndSeconds * 1000,
  );
  let emitted = false;
  const units = [owner, ...friends.filter((f) => f.id !== owner.id)];
  for (const u of units) {
    // the unit's own markers of a proc: its aura, and its heal — the aura is
    // not always written (fact7 D46, 7acbefeb 1:09: heal 1286444 and the
    // Cauterized debuff, no 87023)
    const marks = [
      ...(u.auraEvents ?? [])
        .filter(
          (a) =>
            a.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
            a.srcUnitId === u.id &&
            a.destUnitId === u.id,
        )
        .map((a) => ({ id: a.spellId, ms: a.logLine.timestamp })),
      ...(u.healIn ?? [])
        .filter((h) => h.srcUnitId === u.id)
        .map((h) => ({ id: h.spellId, ms: h.logLine.timestamp })),
    ].sort((a, b) => a.ms - b.ms);
    const lastOf = new Map<string, number>();
    for (const m of marks) {
      const def = CRISIS_PROC_ANSWERS.get(m.id ?? "");
      if (def?.kind !== "cheatDeath") continue;
      if (m.ms < matchStartMs || m.ms > endMs) continue;
      // one proc's two markers name it once
      const last = lastOf.get(def.name);
      lastOf.set(def.name, m.ms);
      if (last !== undefined && m.ms - last <= CHEAT_DEATH_MARKERS_MS) continue;
      const t = (m.ms - matchStartMs) / 1000;
      // the talent's name, as [ENEMY DEF] prints it (45182's aura is
      // "Cheating Death")
      const name = def.name;
      addEntry(
        t,
        u.id === owner.id
          ? `${fmtTime(t)}  [YOU] [PROC]   ${name} ${CHEAT_DEATH_PROC_LABEL}`
          : `${fmtTime(t)}  [TEAM] [PROC]   ${pid(u.name)} (${specToString(u.spec)}): ${name} ${CHEAT_DEATH_PROC_LABEL}`,
      );
      emitted = true;
    }
  }
  return emitted;
}

/**
 * fact7 class 3 (D69, every reader): an offensive form with no button
 * (`OFFENSIVE_FORM_FACT_AURAS`) on the owner or a teammate — the `[PROC]`
 * legend's "an automatically applied effect", the enemy side's `(no press)`
 * [ENEMY CD] line. Nothing was pressed; the line prints no HP.
 */
export function emitFriendlyFormEntries(ctx: {
  owner: ICombatUnit;
  friends: readonly ICombatUnit[];
  matchStartMs: number;
  matchEndSeconds: number;
  roundEndAtMs?: number;
  pid: (name: string) => string;
  addEntry: (atSeconds: number, line: string) => void;
}): boolean {
  const { owner, friends, matchStartMs, matchEndSeconds, pid, addEntry } = ctx;
  const endMs = Math.min(
    ctx.roundEndAtMs ?? Infinity,
    matchStartMs + matchEndSeconds * 1000,
  );
  let emitted = false;
  for (const u of [owner, ...friends.filter((f) => f.id !== owner.id)]) {
    for (const a of dropAuraRebroadcasts(u.auraEvents ?? [])) {
      if (a.logLine.event !== LogEvent.SPELL_AURA_APPLIED) continue;
      if (a.srcUnitId !== u.id || a.destUnitId !== u.id) continue;
      const name = OFFENSIVE_FORM_FACT_AURAS.get(a.spellId ?? "");
      if (name === undefined) continue;
      if (a.logLine.timestamp < matchStartMs || a.logLine.timestamp > endMs)
        continue;
      const t = (a.logLine.timestamp - matchStartMs) / 1000;
      addEntry(
        t,
        u.id === owner.id
          ? `${fmtTime(t)}  [YOU] [PROC]   ${name}`
          : `${fmtTime(t)}  [TEAM] [PROC]   ${pid(u.name)} (${specToString(u.spec)}): ${name}`,
      );
      emitted = true;
    }
  }
  return emitted;
}

/** A ledger row this near an activation is the same fact: the ledger's own
 * aura-only rows (`auraOnlyActivationSeconds`) already print a line. */
const LEDGER_ROW_NEAR_S = 1;

/**
 * fact8 class 5 (D11 D17 D22 D26 D40; every family of `auraOnlyActivations`):
 * a tracked cooldown's aura that went up on the owner or a teammate with no
 * press of it. The enemy side's `[no press logged]` / `(no press)` lines, on
 * the `[PROC]` tag. Nothing was pressed; the line prints no HP, and it reads
 * no cooldown: the button is not spent.
 */
export function emitFriendlyAuraOnlyEntries(ctx: {
  owner: ICombatUnit;
  friends: readonly ICombatUnit[];
  ownerCDs: readonly IMajorCooldownInfo[];
  teammateCDs: ReadonlyArray<{
    player: ICombatUnit;
    cds: readonly IMajorCooldownInfo[];
  }>;
  matchStartMs: number;
  matchEndSeconds: number;
  roundEndAtMs?: number;
  pid: (name: string) => string;
  addEntry: (atSeconds: number, line: string) => void;
}): boolean {
  const { owner, friends, matchStartMs, pid, addEntry } = ctx;
  const endMs = Math.min(
    ctx.roundEndAtMs ?? Infinity,
    matchStartMs + ctx.matchEndSeconds * 1000,
  );
  const units = [owner, ...friends.filter((f) => f.id !== owner.id)];
  let emitted = false;
  for (const u of units) {
    const ledger =
      u.id === owner.id
        ? ctx.ownerCDs
        : (ctx.teammateCDs.find((t) => t.player.id === u.id)?.cds ?? []);
    for (const a of auraOnlyActivations(u, units, matchStartMs, endMs)) {
      const inLedger = ledger.some(
        (cd) =>
          (cd.spellId === a.spellId || cd.spellName === a.spellName) &&
          cd.casts.some(
            (c) => Math.abs(c.timeSeconds - a.atSeconds) <= LEDGER_ROW_NEAR_S,
          ),
      );
      if (inLedger) continue;
      const t = a.atSeconds;
      addEntry(
        t,
        u.id === owner.id
          ? `${fmtTime(t)}  [YOU] [PROC]   ${a.spellName}${NO_PRESS_SUFFIX}`
          : `${fmtTime(t)}  [TEAM] [PROC]   ${pid(u.name)} (${specToString(u.spec)}): ${a.spellName}${NO_PRESS_SUFFIX}`,
      );
      emitted = true;
    }
  }
  return emitted;
}

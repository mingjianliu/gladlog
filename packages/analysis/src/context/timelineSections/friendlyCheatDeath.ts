/**
 * WO3 #17 (r1008-140, dfcccbf2 2:46): a friendly cheat-death proc — Cauterize
 * / Cheat Death / Defy Fate refusing a killing blow on the owner or a teammate — gets a
 * `[YOU] [PROC]` / `[TEAM] [PROC]` line, as the same proc on an enemy gets
 * `[ENEMY DEF] … (cheat-death proc)`. Nothing was pressed; the line prints no
 * HP (the proc sets it).
 *
 * The ids are the `kind: "cheatDeath"` markers of `CRISIS_PROC_ANSWERS`
 * (crisisDecisionPoints.ts: Cauterize's aura 87023 251/251 self and heal
 * 1286444, Cheat Death 45182 25/25) — the same reading the crisis layer
 * credits, applied on the unit by the unit itself.
 */
import { type ICombatUnit } from "@gladlog/parser-compat";

import {
  auraOnlyActivations,
  UNLOGGED_PRESS_SUFFIX,
} from "../../utils/auraOnlyActivations";
import { type IMajorCooldownInfo, specToString } from "../../utils/cooldowns";
import {
  auraOffensiveOccurrences,
  NO_PRESS_SUFFIX,
  OFFENSIVE_FORM_FACT_AURAS,
} from "../../utils/offensiveAuraOccurrences";
import { ownProcMarkers } from "../../utils/procTriggeredCast";
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
    // the unit's own markers of a proc — the one reading of them
    // (`ownProcMarkers`: an `aura` marker's APPLIED self → self, a `heal`
    // marker's own heal row; T190 — read here without `via`, a heal-over-
    // time under an aura marker's id would have named one proc per tick).
    // Cauterize has both: the aura is not always written (fact7 D46,
    // 7acbefeb 1:09: heal 1286444 and the Cauterized debuff, no 87023)
    const marks = [...ownProcMarkers(u)].sort((a, b) => a.t - b.t);
    const lastOf = new Map<string, number>();
    for (const def of marks) {
      if (def.kind !== "cheatDeath") continue;
      const ms = def.t;
      if (ms < matchStartMs || ms > endMs) continue;
      // one proc's two markers name it once
      const last = lastOf.get(def.name);
      lastOf.set(def.name, ms);
      if (last !== undefined && ms - last <= CHEAT_DEATH_MARKERS_MS) continue;
      const t = (ms - matchStartMs) / 1000;
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
 * fact7 class 3 (D69, every reader): an offensive form on the owner or a
 * teammate whose press the log writes only as the form
 * (`OFFENSIVE_FORM_FACT_AURAS`). Pipeline T291: Void Metamorphosis is a
 * button (1217605) whose SPELL_CAST_SUCCESS never logs — a press, the `[CD]`
 * tag with `UNLOGGED_PRESS_SUFFIX` (GH #193's line for a press the log has
 * only as its aura), as the enemy side's [ENEMY CD] line names it without
 * `(no press)`. The line prints no HP: no press row says when it was pressed.
 */
export function emitFriendlyFormEntries(ctx: {
  owner: ICombatUnit;
  friends: readonly ICombatUnit[];
  matchStartMs: number;
  matchEndSeconds: number;
  roundEndAtMs?: number;
  pid: (name: string) => string;
  addEntry: (atSeconds: number, line: string) => void;
}): void {
  const { owner, friends, matchStartMs, matchEndSeconds, pid, addEntry } = ctx;
  const endMs = Math.min(
    ctx.roundEndAtMs ?? Infinity,
    matchStartMs + matchEndSeconds * 1000,
  );
  for (const u of [owner, ...friends.filter((f) => f.id !== owner.id)]) {
    // the entries the enemy side reads (`auraOffensiveOccurrences`): one per
    // form, whatever restates it while it runs (codex 85-tk-L6-T291-1 #1:
    // 20c23c12 r1, Shadowmeld 3:17.089 restated the form entered at
    // 3:12.378 — a second APPLIED with no REMOVED, read as a second press)
    const { occurrences } = auraOffensiveOccurrences(u, {
      startTime: matchStartMs,
      endTime: endMs,
    });
    for (const o of occurrences) {
      const name = OFFENSIVE_FORM_FACT_AURAS.get(o.spellId);
      if (name === undefined) continue;
      if (o.startMs < matchStartMs || o.startMs > endMs) continue;
      const t = (o.startMs - matchStartMs) / 1000;
      addEntry(
        t,
        u.id === owner.id
          ? `${fmtTime(t)}  [YOU] [CD]   ${name}${UNLOGGED_PRESS_SUFFIX}`
          : `${fmtTime(t)}  [TEAM] [CD]   ${pid(u.name)} (${specToString(u.spec)}): ${name}${UNLOGGED_PRESS_SUFFIX}`,
      );
    }
  }
}

/** A ledger row this near an activation is the same fact: the ledger's own
 * aura-only rows (`auraOnlyActivationSeconds`) already print a line. */
const LEDGER_ROW_NEAR_S = 1;

/** A ledger row and the producer's press event are one cast row read twice:
 * the same millisecond. */
const PRESS_ROW_SAME_S = 0.001;

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
    for (const a of auraOnlyActivations(
      u,
      units,
      matchStartMs,
      endMs,
      matchStartMs + ctx.matchEndSeconds * 1000,
    )) {
      // …except beside a proc's own activation (the producer's `procOwned`,
      // T259 B194 review), where a logged press of the same button is a
      // second fact with its own [CD] line: the ledger row of that press does
      // not stand for the proc (85a6cad9 r4: the proc 0:56, the press 0:57 —
      // the press alone was printed). Any other row this near still does.
      const ownPress = (s: number) =>
        a.procOwned === true &&
        (a.pressesBesideSeconds ?? []).some(
          (p) => Math.abs(p - s) <= PRESS_ROW_SAME_S,
        );
      const inLedger = ledger.some(
        (cd) =>
          (cd.spellId === a.spellId || cd.spellName === a.spellName) &&
          cd.casts.some(
            (c) =>
              Math.abs(c.timeSeconds - a.atSeconds) <= LEDGER_ROW_NEAR_S &&
              !ownPress(c.timeSeconds),
          ),
      );
      if (inLedger) continue;
      const t = a.atSeconds;
      // GH #193: a press the log shows only as its aura is a press — the
      // [CD] tag, the button spent
      const [tag, suffix] =
        a.family === "unlogged-press"
          ? ["[CD]", UNLOGGED_PRESS_SUFFIX]
          : ["[PROC]", NO_PRESS_SUFFIX];
      addEntry(
        t,
        u.id === owner.id
          ? `${fmtTime(t)}  [YOU] ${tag}   ${a.spellName}${suffix}`
          : `${fmtTime(t)}  [TEAM] ${tag}   ${pid(u.name)} (${specToString(u.spec)}): ${a.spellName}${suffix}`,
      );
      // the return says a [PROC] line went out (its legend); a press's [CD]
      // line explains itself
      if (a.family !== "unlogged-press") emitted = true;
    }
  }
  return emitted;
}

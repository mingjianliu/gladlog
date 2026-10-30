/**
 * [ENEMY CD] — enemy major cooldown casts with a per-spell sequence index
 * (`Bestial Wrath [2/4]`, B107) so short-interval repeats are not collapsed into
 * one window; timeline-only facts (GH #119) render here too, and a missed-purge
 * note folded in by GH #99 Rules B & C rides on the cast line.
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx`. Output is pinned by the 605-file
 * acceptanceCapture context hash.
 */
import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { castAndEffectIds } from "../../data/castEffectAuras";
import { classMetadata } from "../../data/classSpells";
import { isEnemyHealCdFor } from "../../data/enemyHealCds";
import { getEnglishSpellName } from "../../data/spellEffectData";
import { SpellTag } from "../../data/spellTypes";
import { AURA_REBROADCAST_GAP_MS } from "../../utils/auraIntervals";
import { isFormReshiftCast } from "../../utils/castPress";
import { canonicalSpellId, specToString } from "../../utils/cooldowns";
import {
  AURA_BEFORE_CAST_MAX_S,
  ENEMY_DEF_UNSEEN_PRESS_TAG,
  enemyDefSpeaksForPress,
  PRESS_TO_AURA_MAX_S,
} from "../../utils/enemyDefensives";
import { pressRowsWithHidden } from "../../utils/hiddenPress";
import { fmtTime } from "../../utils/renderGrid";
import { OFFENSIVE_CD_SPELL_IDS } from "../../utils/spellDanger";
import type { TimelineCtx } from "./ctx";

/** The per-spell cast ordinal (triage res-readiness F-C2): `[k/N]` is the
 *  notation the legend reserves for CHARGES, so a cast count reads
 *  ` (cast k of N)`. Shared by [ENEMY CD] and [ENEMY HEAL CD]. */
export function castOrdinal(seq: number, total: number): string {
  return total > 1 ? ` (cast ${seq} of ${total})` : "";
}

/**
 * FT-T06: an activation of another cooldown's effect — no button, no cooldown
 * of its own (`availableAgainAtSeconds === null`: Radiant Glory's Avenging
 * Wrath 454351, GH #115) — is not a cast the enemy chose. The log still
 * writes a SPELL_CAST_SUCCESS for it, in the very ms of the cast that
 * triggered it (0e0663e6: five of them, each with a Wake of Ashes), and the
 * line read `Avenging Wrath (cast 1 of 5)`. It says `proc`, and what it came
 * with when the log shows that.
 */
export function procOrdinal(
  seq: number,
  total: number,
  triggerName: string | undefined,
): string {
  const which = total > 1 ? `proc ${seq} of ${total}` : "proc";
  return ` (${which}${triggerName ? `, with ${triggerName}` : ""})`;
}

/**
 * What an activation comes with: the unit's own cast that shares its ms with
 * at least two of the round's activations of that effect, and with strictly
 * more of them than any other cast. One shared ms proves nothing — a trinket
 * macro'd to the press, an off-GCD strike (the first cut named `Gladiator's
 * Badge` and `Crusading Strikes` as triggers on 39 lines of the 605-file
 * capture). Undefined = the log does not single one out. Shared by the
 * friendly `[TEAM]` / `[YOU] [PROC]` lines (fact1215 C5, 8cd58545: the
 * friendly side dropped the `with Wake of Ashes` the enemy side prints).
 */
export function procTriggerOf(
  unit: ICombatUnit | undefined,
  activationSpellId: string,
  activationsMs: readonly number[],
): string | undefined {
  const counts = new Map<string, number>();
  // the activation itself, under any id: the friendly ledger keys Radiant
  // Glory's Avenging Wrath by the 31884 button while the log writes the
  // activation as 454351 (F15 C5: `with Avenging Wrath` on 1,184 lines)
  const selfName = getEnglishSpellName(activationSpellId);
  for (const ledgerMs of activationsMs) {
    const atMs = activationCastMs(unit, activationSpellId, ledgerMs);
    const names = new Set<string>();
    for (const e of unit?.spellCastEvents ?? []) {
      if (
        e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
        !!e.spellId &&
        e.spellId !== activationSpellId &&
        getEnglishSpellName(e.spellId, e.spellName) !== selfName &&
        triggerBeside(e.logLine.timestamp, atMs)
      )
        names.add(getEnglishSpellName(e.spellId, e.spellName));
    }
    for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [top, next] = ranked;
  return top && top[1] >= 2 && (!next || next[1] < top[1]) ? top[0] : undefined;
}

/** Round-1 retest (fact1215 idx 79): how far BEFORE an activation's cast
 * row the press that procced it may be logged. Measured on the 29 fact2
 * logs: of 223 Radiant Glory Avenging Wraths after a Wake of Ashes, 165
 * came within 1 ms, 57 at 2–50 ms (12–14 ms in 519781fd's procs 9 and 11,
 * which the same-ms rule dropped), 1 later. After it, the rebroadcast gap
 * (`AURA_REBROADCAST_GAP_MS`) as before. */
export const PROC_TRIGGER_LEAD_MS = 50;
function triggerBeside(castMs: number, activationMs: number): boolean {
  return (
    castMs >= activationMs - PROC_TRIGGER_LEAD_MS &&
    castMs <= activationMs + AURA_REBROADCAST_GAP_MS
  );
}

/** How far from a ledger activation its own cast row may be logged (the
 * ledger can carry the aura's ms, 2 ms before the row — codex 20-F15-25). */
const ACTIVATION_CAST_ANCHOR_MS = 100;

/**
 * The instant an activation's own cast row is logged: the unit's nearest
 * SUCCESS printing the activation's name (the friendly ledger keys Radiant
 * Glory's Avenging Wrath by 31884, the log writes 454351) within
 * `ACTIVATION_CAST_ANCHOR_MS` of the ledger's time; that time when none.
 */
export function activationCastMs(
  unit: ICombatUnit | undefined,
  activationSpellId: string,
  ledgerMs: number,
): number {
  const name = getEnglishSpellName(activationSpellId);
  let best: number | undefined;
  for (const e of unit?.spellCastEvents ?? []) {
    if (e.logLine.event !== LogEvent.SPELL_CAST_SUCCESS || !e.spellId) continue;
    if (
      e.spellId !== activationSpellId &&
      getEnglishSpellName(e.spellId, e.spellName) !== name
    )
      continue;
    const d = Math.abs(e.logLine.timestamp - ledgerMs);
    if (
      d <= ACTIVATION_CAST_ANCHOR_MS &&
      (best === undefined || d < Math.abs(best - ledgerMs))
    )
      best = e.logLine.timestamp;
  }
  return best ?? ledgerMs;
}

/**
 * Did THIS activation go out with `triggerName` — a cast of it by the unit in
 * the activation's own ms (`procTriggerOf`'s reading, at one activation)?
 * The round-level trigger is printed only where it holds (codex 20-F15-25: a
 * cast-less Avenging Wrath between two Wake pairs read `with Wake of Ashes`).
 */
export function procTriggerAt(
  unit: ICombatUnit | undefined,
  activationSpellId: string,
  ledgerMs: number,
  triggerName: string | undefined,
): string | undefined {
  if (!triggerName) return undefined;
  const atMs = activationCastMs(unit, activationSpellId, ledgerMs);
  return (unit?.spellCastEvents ?? []).some(
    (e) =>
      e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
      !!e.spellId &&
      getEnglishSpellName(e.spellId, e.spellName) === triggerName &&
      triggerBeside(e.logLine.timestamp, atMs),
  )
    ? triggerName
    : undefined;
}

/** Returns whether any line carried a cast ordinal (its legend line). */
export function emitEnemyCdEntries(
  ctx: Pick<
    TimelineCtx,
    | "enemyCDTimeline"
    | "cdPurgeAnnotations"
    | "addEntry"
    | "enemyPid"
    | "enemies"
    | "matchStartMs"
    | "matchEndSeconds"
  >,
): {
  ordinalRendered: boolean;
  healCdRendered: boolean;
  procRendered: boolean;
  /** a line carries `[pressed while unseen]` */
  unseenRendered: boolean;
  utilityRendered: boolean;
} {
  const { enemyCDTimeline, cdPurgeAnnotations, addEntry, enemyPid } = ctx;
  let ordinalRendered = false;
  let procRendered = false;
  let unseenRendered = false;

  for (const player of enemyCDTimeline.players) {
    // GH #119: timeline-only facts (a Demonic Metamorphosis form) render here
    // too; they are never in offensiveCDs, so no burst reader sees them
    const shown = [
      ...player.offensiveCDs,
      ...(player.offensiveFacts ?? []),
    ].sort((x, y) => x.castTimeSeconds - y.castTimeSeconds);
    const enemyUnit = (ctx.enemies ?? []).find(
      (e) => e.name === player.playerName,
    );
    const isActivationCd = (cd: (typeof shown)[number]) =>
      cd.availableAgainAtSeconds === null && !cd.availabilityUnknown;
    // F20 D23 follow-up (coordinator ruling 2026-10-28): a press of a
    // variant that shares the button's cooldown (Predator's Wake 1259431
    // for The Hunt 370965, category 2427) is the k-th use of THAT cooldown —
    // one counter, each line under the log's own name. An activation has
    // no cooldown and keeps its own name's counter.
    const ordinalKey = (cd: (typeof shown)[number]): string => {
      const canon = canonicalSpellId(cd.spellId);
      return canon === cd.spellId || isActivationCd(cd)
        ? cd.spellName
        : getEnglishSpellName(canon);
    };
    const totalBySpell = new Map<string, number>();
    for (const cd of shown) {
      const key = ordinalKey(cd);
      totalBySpell.set(key, (totalBySpell.get(key) ?? 0) + 1);
    }
    /** activation spell id → what it comes with this round, if anything */
    const triggerBySpell = new Map<string, string | undefined>();
    for (const cd of shown) {
      if (!isActivationCd(cd) || triggerBySpell.has(cd.spellId)) continue;
      triggerBySpell.set(
        cd.spellId,
        procTriggerOf(
          enemyUnit,
          cd.spellId,
          shown
            .filter((o) => o.spellId === cd.spellId && isActivationCd(o))
            .map((o) =>
              Math.round(ctx.matchStartMs + o.castTimeSeconds * 1000),
            ),
        ),
      );
    }
    const seqBySpell = new Map<string, number>();
    for (const cd of shown) {
      const key = ordinalKey(cd);
      const total = totalBySpell.get(key) ?? 1;
      const seq = (seqBySpell.get(key) ?? 0) + 1;
      seqBySpell.set(key, seq);
      const isActivation = isActivationCd(cd);
      // an application with no press at all (`(no press)` / `(source
      // unknown)`: no button the log shows, no known trigger) is no k-th
      // cast of anything (fact5 D16 follow-up: `Recklessness (no press)
      // (cast 1 of 5)`)
      const noPress =
        cd.availableAgainAtSeconds === null && !!cd.availabilityUnknown;
      const seqAnnotation = noPress
        ? ""
        : isActivation
        ? procOrdinal(
            seq,
            total,
            procTriggerAt(
              enemyUnit,
              cd.spellId,
              Math.round(ctx.matchStartMs + cd.castTimeSeconds * 1000),
              triggerBySpell.get(cd.spellId),
            ),
          )
        : castOrdinal(seq, total);
      if (isActivation) procRendered = true;
      if (cd.unseenPress) unseenRendered = true;
      else if (seqAnnotation) ordinalRendered = true;
      const purgeNote = cdPurgeAnnotations.get(cd) ?? "";
      addEntry(
        cd.castTimeSeconds,
        `${fmtTime(cd.castTimeSeconds)}  [ENEMY CD]   ${enemyPid(player.playerName)} (${player.specName}): ${cd.spellName}${seqAnnotation}${cd.unseenPress ? ` ${ENEMY_DEF_UNSEEN_PRESS_TAG}` : ""}${purgeNote}`,
      );
    }
  }

  // [ENEMY HEAL CD] (user ruling A26 = A, triage enemy-def F-E8; Avenging
  // Crusader by A27 = B): an enemy healer's throughput majors on their own
  // tag — they never reach the burst-window builder.
  let healCdRendered = false;
  for (const enemy of ctx.enemies ?? []) {
    // corpusFactScan hiddenPressUnused: and the presses made while unseen
    // (`pressRowsWithHidden` — 0284fcd9 r1 0:12, a Tranquility with no row)
    const casts = pressRowsWithHidden(
      enemy,
      (id) => isEnemyHealCdFor(id, enemy.spec),
      ctx.matchStartMs,
    ).filter(
      (c) =>
        c.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
        !!c.spellId &&
        isEnemyHealCdFor(c.spellId, enemy.spec) &&
        // a shift back into Tree of Life form is no second press
        (c.unseenPress || !isFormReshiftCast(enemy, c as never)),
    );
    const totalBy = new Map<string, number>();
    for (const c of casts)
      totalBy.set(c.spellId, (totalBy.get(c.spellId) ?? 0) + 1);
    const seqBy = new Map<string, number>();
    for (const c of casts) {
      const seq = (seqBy.get(c.spellId) ?? 0) + 1;
      seqBy.set(c.spellId, seq);
      const ordinal = castOrdinal(seq, totalBy.get(c.spellId) ?? 1);
      if (ordinal) ordinalRendered = true;
      const t = (c.logLine.timestamp - ctx.matchStartMs) / 1000;
      healCdRendered = true;
      if (c.unseenPress) unseenRendered = true;
      addEntry(
        t,
        `${fmtTime(t)}  [ENEMY HEAL CD]   ${enemyPid(enemy.name)} (${specToString(enemy.spec)}): ${getEnglishSpellName(c.spellId, c.spellName)}${ordinal}${c.unseenPress ? ` ${ENEMY_DEF_UNSEEN_PRESS_TAG}` : ""}`,
      );
    }
  }
  // [ENEMY UTILITY] (fact1215 C7, user ruling 2026-10-18: a new tag, a fact
  // line only): an enemy's press of a roster Utility row (`SpellTag.Utility`
  // — Champion's Spear, Smoke Bomb, Tremor Totem) that no other enemy family
  // prints. The friendly side has always had its press line; the enemy side
  // had none (3867e9ef 0:23 Smoke Bomb, 1120cb61 0:36 Champion's Spear). It
  // opens no window and feeds no reader: not [ENEMY CD], not [RES].
  let utilityRendered = false;
  for (const enemy of ctx.enemies ?? []) {
    const rows = classMetadata
      .find((c) => c.unitClass === enemy.class)
      ?.abilities.filter(
        (ab) =>
          (ab.tags.includes(SpellTag.Utility) ||
            ENEMY_UTILITY_EXTRA_IDS.has(ab.spellId)) &&
          // a healing major of THIS unit's spec has its own line (a Feral's
          // Convoke is no healer's)
          !isEnemyHealCdFor(ab.spellId, enemy.spec) &&
          !OFFENSIVE_CD_SPELL_IDS.has(ab.spellId),
      );
    if (!rows || rows.length === 0) continue;
    const ids = new Set(rows.map((ab) => ab.spellId));
    /** [ENEMY DEF] speaks for THIS press: its spell is one of that family's
     * and its effect aura went up with it (codex 20-F15-30: a Vanish whose
     * aura the log never wrote had neither line) */
    const defSpeaksFor = (c: (typeof enemy.spellCastEvents)[number]) =>
      enemyDefSpeaksForPress(c.spellId) &&
      (enemy.auraEvents ?? []).some(
        (a) =>
          !!a.spellId &&
          castAndEffectIds(c.spellId).has(a.spellId) &&
          a.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
          a.timestamp >= c.logLine.timestamp - AURA_BEFORE_CAST_MAX_S * 1000 &&
          a.timestamp <= c.logLine.timestamp + PRESS_TO_AURA_MAX_S * 1000,
      );
    // inside the timeline's span only, so the ordinal counts what prints
    // (codex 20-F15-30: a pre-gate press printed `-1:-2` and shifted `cast
    // k of N`)
    const casts = (enemy.spellCastEvents ?? [])
      .filter((c) => {
        if (c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) return false;
        if (!c.spellId || !ids.has(c.spellId)) return false;
        const t = (c.logLine.timestamp - ctx.matchStartMs) / 1000;
        return t >= 0 && t <= ctx.matchEndSeconds && !defSpeaksFor(c);
      })
      .sort((a, b) => a.logLine.timestamp - b.logLine.timestamp);
    const totalBy = new Map<string, number>();
    for (const c of casts)
      totalBy.set(c.spellId, (totalBy.get(c.spellId) ?? 0) + 1);
    const seqBy = new Map<string, number>();
    for (const c of casts) {
      const seq = (seqBy.get(c.spellId) ?? 0) + 1;
      seqBy.set(c.spellId, seq);
      const ordinal = castOrdinal(seq, totalBy.get(c.spellId) ?? 1);
      if (ordinal) ordinalRendered = true;
      const t = (c.logLine.timestamp - ctx.matchStartMs) / 1000;
      if (
        addEntry(
          t,
          `${fmtTime(t)}  ${ENEMY_UTILITY_TAG}   ${enemyPid(enemy.name)} (${specToString(enemy.spec)}): ${getEnglishSpellName(c.spellId, c.spellName)}${ordinal}`,
        )
      )
        utilityRendered = true;
    }
  }
  return {
    ordinalRendered,
    healCdRendered,
    procRendered,
    utilityRendered,
    unseenRendered,
  };
}

/** The tag of an enemy's utility press line (fact1215 C7). */
export const ENEMY_UTILITY_TAG = "[ENEMY UTILITY]";

/** Catalog rows the friendly ledger tags otherwise whose ENEMY press is a
 * utility fact line too: no [ENEMY DEF] roster names them, no reader takes
 * them (fact5 cxa c224dd9e 0:51 / 0:53: a Windwalker's two Transcendence:
 * Transfer escapes at 12 % / 8 % HP had only a loadout entry — user ruling
 * 2026-10-26, a line only). Registered in curatedIdRegistry. */
export const ENEMY_UTILITY_EXTRA_IDS: ReadonlySet<string> = new Set([
  "119996", // Transcendence: Transfer
]);

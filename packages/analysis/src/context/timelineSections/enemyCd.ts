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

import { ENEMY_HEAL_CD_IDS } from "../../data/enemyHealCds";
import { getEnglishSpellName } from "../../data/spellEffectData";
import { AURA_REBROADCAST_GAP_MS } from "../../utils/auraIntervals";
import { specToString } from "../../utils/cooldowns";
import { fmtTime } from "../../utils/renderGrid";
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
 * capture). Undefined = the log does not single one out.
 */
function triggerOf(
  unit: ICombatUnit | undefined,
  activationSpellId: string,
  activationsMs: readonly number[],
): string | undefined {
  const counts = new Map<string, number>();
  for (const atMs of activationsMs) {
    const names = new Set<string>();
    for (const e of unit?.spellCastEvents ?? []) {
      if (
        e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
        !!e.spellId &&
        e.spellId !== activationSpellId &&
        Math.abs(e.logLine.timestamp - atMs) <= AURA_REBROADCAST_GAP_MS
      )
        names.add(getEnglishSpellName(e.spellId, e.spellName));
    }
    for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [top, next] = ranked;
  return top && top[1] >= 2 && (!next || next[1] < top[1]) ? top[0] : undefined;
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
  >,
): {
  ordinalRendered: boolean;
  healCdRendered: boolean;
  procRendered: boolean;
} {
  const { enemyCDTimeline, cdPurgeAnnotations, addEntry, enemyPid } = ctx;
  let ordinalRendered = false;
  let procRendered = false;

  for (const player of enemyCDTimeline.players) {
    // GH #119: timeline-only facts (a Demonic Metamorphosis form) render here
    // too; they are never in offensiveCDs, so no burst reader sees them
    const shown = [
      ...player.offensiveCDs,
      ...(player.offensiveFacts ?? []),
    ].sort((x, y) => x.castTimeSeconds - y.castTimeSeconds);
    const totalBySpell = new Map<string, number>();
    for (const cd of shown) {
      totalBySpell.set(cd.spellName, (totalBySpell.get(cd.spellName) ?? 0) + 1);
    }
    const enemyUnit = (ctx.enemies ?? []).find(
      (e) => e.name === player.playerName,
    );
    const isActivationCd = (cd: (typeof shown)[number]) =>
      cd.availableAgainAtSeconds === null && !cd.availabilityUnknown;
    /** activation spell id → what it comes with this round, if anything */
    const triggerBySpell = new Map<string, string | undefined>();
    for (const cd of shown) {
      if (!isActivationCd(cd) || triggerBySpell.has(cd.spellId)) continue;
      triggerBySpell.set(
        cd.spellId,
        triggerOf(
          enemyUnit,
          cd.spellId,
          shown
            .filter((o) => o.spellId === cd.spellId && isActivationCd(o))
            .map((o) => Math.round(ctx.matchStartMs + o.castTimeSeconds * 1000)),
        ),
      );
    }
    const seqBySpell = new Map<string, number>();
    for (const cd of shown) {
      const total = totalBySpell.get(cd.spellName) ?? 1;
      const seq = (seqBySpell.get(cd.spellName) ?? 0) + 1;
      seqBySpell.set(cd.spellName, seq);
      const isActivation = isActivationCd(cd);
      const seqAnnotation = isActivation
        ? procOrdinal(seq, total, triggerBySpell.get(cd.spellId))
        : castOrdinal(seq, total);
      if (isActivation) procRendered = true;
      else if (seqAnnotation) ordinalRendered = true;
      const purgeNote = cdPurgeAnnotations.get(cd) ?? "";
      addEntry(
        cd.castTimeSeconds,
        `${fmtTime(cd.castTimeSeconds)}  [ENEMY CD]   ${enemyPid(player.playerName)} (${player.specName}): ${cd.spellName}${seqAnnotation}${purgeNote}`,
      );
    }
  }

  // [ENEMY HEAL CD] (user ruling A26 = A, triage enemy-def F-E8; Avenging
  // Crusader by A27 = B): an enemy healer's throughput majors on their own
  // tag — they never reach the burst-window builder.
  let healCdRendered = false;
  for (const enemy of ctx.enemies ?? []) {
    const casts = (enemy.spellCastEvents ?? [])
      .filter(
        (c) =>
          c.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
          !!c.spellId &&
          ENEMY_HEAL_CD_IDS.has(c.spellId),
      )
      .sort((a, b) => a.logLine.timestamp - b.logLine.timestamp);
    const totalBy = new Map<string, number>();
    for (const c of casts) totalBy.set(c.spellId, (totalBy.get(c.spellId) ?? 0) + 1);
    const seqBy = new Map<string, number>();
    for (const c of casts) {
      const seq = (seqBy.get(c.spellId) ?? 0) + 1;
      seqBy.set(c.spellId, seq);
      const ordinal = castOrdinal(seq, totalBy.get(c.spellId) ?? 1);
      if (ordinal) ordinalRendered = true;
      const t = (c.logLine.timestamp - ctx.matchStartMs) / 1000;
      healCdRendered = true;
      addEntry(
        t,
        `${fmtTime(t)}  [ENEMY HEAL CD]   ${enemyPid(enemy.name)} (${specToString(enemy.spec)}): ${getEnglishSpellName(c.spellId, c.spellName)}${ordinal}`,
      );
    }
  }
  return { ordinalRendered, healCdRendered, procRendered };
}

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
import { LogEvent } from "@gladlog/parser-compat";

import { ENEMY_HEAL_CD_IDS } from "../../data/enemyHealCds";
import { getEnglishSpellName } from "../../data/spellEffectData";
import { specToString } from "../../utils/cooldowns";
import { fmtTime } from "../../utils/renderGrid";
import type { TimelineCtx } from "./ctx";

/** The per-spell cast ordinal (triage res-readiness F-C2): `[k/N]` is the
 *  notation the legend reserves for CHARGES, so a cast count reads
 *  ` (cast k of N)`. Shared by [ENEMY CD] and [ENEMY HEAL CD]. */
export function castOrdinal(seq: number, total: number): string {
  return total > 1 ? ` (cast ${seq} of ${total})` : "";
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
): { ordinalRendered: boolean; healCdRendered: boolean } {
  const { enemyCDTimeline, cdPurgeAnnotations, addEntry, enemyPid } = ctx;
  let ordinalRendered = false;

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
    const seqBySpell = new Map<string, number>();
    for (const cd of shown) {
      const total = totalBySpell.get(cd.spellName) ?? 1;
      const seq = (seqBySpell.get(cd.spellName) ?? 0) + 1;
      seqBySpell.set(cd.spellName, seq);
      const seqAnnotation = castOrdinal(seq, total);
      if (seqAnnotation) ordinalRendered = true;
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
  return { ordinalRendered, healCdRendered };
}

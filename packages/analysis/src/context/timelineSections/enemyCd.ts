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
import { fmtTime } from "../../utils/renderGrid";
import type { TimelineCtx } from "./ctx";

export function emitEnemyCdEntries(
  ctx: Pick<
    TimelineCtx,
    "enemyCDTimeline" | "cdPurgeAnnotations" | "addEntry" | "enemyPid"
  >,
): void {
  const { enemyCDTimeline, cdPurgeAnnotations, addEntry, enemyPid } = ctx;

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
      const seqAnnotation = total > 1 ? ` [${seq}/${total}]` : "";
      const purgeNote = cdPurgeAnnotations.get(cd) ?? "";
      addEntry(
        cd.castTimeSeconds,
        `${fmtTime(cd.castTimeSeconds)}  [ENEMY CD]   ${enemyPid(player.playerName)} (${player.specName}): ${cd.spellName}${seqAnnotation}${purgeNote}`,
      );
    }
  }
}

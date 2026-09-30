/**
 * [TEAM] [CD] — teammates' major cooldown presses (and proc-only activations as
 * [PROC]), with target, HP, AoE CC folding and CC-immune tags.
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx`. `procLinesEmitted` is threaded:
 * the caller passes its current value and assigns back the returned one. Output
 * is pinned by the 605-file acceptanceCapture context hash.
 */
import { ccSpellIds } from "../../data/spellTags";
import {
  cdIsProcOnly,
  gridHpPct,
  isDeadAtRenderSecond,
} from "../../utils/cooldowns";
import { fmtTime, toRenderSecond } from "../../utils/renderGrid";
import { ALTER_TIME_CAST_ID, alterTimeReturnSeconds } from "./alterTime";
import type { TimelineCtx } from "./ctx";

export function emitTeamCdEntries(
  ctx: Pick<
    TimelineCtx,
    | "teammateCDs"
    | "procLinesEmitted"
    | "groundingAbsorbNote"
    | "enemyPid"
    | "findAndConsumeAoeCC"
    | "formatAoeTargetPart"
    | "pid"
    | "ccImmuneTagFor"
    | "addEntry"
    | "requestSnapshotPlaceholder"
    | "matchStartMs"
  >,
): Pick<TimelineCtx, "procLinesEmitted"> {
  const {
    teammateCDs,
    groundingAbsorbNote,
    enemyPid,
    findAndConsumeAoeCC,
    formatAoeTargetPart,
    pid,
    ccImmuneTagFor,
    addEntry,
    requestSnapshotPlaceholder,
    matchStartMs,
  } = ctx;
  // threaded: read from ctx, returned to the caller (GH #116)
  let { procLinesEmitted } = ctx;

  for (const { player, spec, cds } of teammateCDs) {
    for (const cd of cds) {
      const isCC = ccSpellIds.has(cd.spellId);
      // Same as the owner loop: a proc-only entry's activations are not presses.
      const isProc = cdIsProcOnly(cd);
      if (isProc) procLinesEmitted = true;
      for (const cast of cd.casts) {
        const groundingNote = groundingAbsorbNote(
          cd.spellId,
          cd.spellName,
          player.id,
          cast.timeSeconds,
        );

        // 17c: same [UNNECESSARY] surfacing as the [YOU] [CD] block above — an externally-cast
        // defensive (e.g. Pain Suppression on a teammate) also runs through annotateDefensiveTimings
        // per-caster, so this cast object can carry the same timingLabel/timingContext. Consume
        // verbatim, no recompute (single-source predicate).
        const unnecessaryNote =
          !isProc && cast.timingLabel === "Unnecessary" && cast.timingContext
            ? ` [UNNECESSARY — ${cast.timingContext}]`
            : "";

        // B112(a): "[TEAM] [CC] N (Spec): X" was misread as teammate N BEING CC'd. It is actually N
        // CASTING an offensive CC on an enemy — render it in active voice ("cast") with the enemy
        // target so the caster is never confused with the victim. [TEAM] [CD] (buffs/defensives on
        // self) keeps the ": X" form.
        let line: string;
        if (isCC) {
          const tgtLabel =
            cast.targetName && cast.targetName !== "nil"
              ? enemyPid(cast.targetName)
              : "";
          // Suppress localized (non-ASCII) totem/pet/NPC target names — never leak
          // a client-locale unit name into the English prompt.
          const tgt =
            tgtLabel && ![...tgtLabel].some((c) => c.charCodeAt(0) > 127)
              ? ` → ${tgtLabel}`
              : "";
          let effectiveTgt = tgt;
          const matchingAoe = findAndConsumeAoeCC(
            cast.timeSeconds,
            player.name,
            cd.spellName,
            false,
          );
          if (matchingAoe) {
            effectiveTgt = formatAoeTargetPart(matchingAoe, tgt);
          }
          line = `${fmtTime(cast.timeSeconds)}  [TEAM] [CC]   ${pid(player.name)} (${spec}) cast ${cd.spellName}${effectiveTgt}${groundingNote}${ccImmuneTagFor(player, cd.spellId, cast.timeSeconds)}${unnecessaryNote}`;
        } else {
          line = `${fmtTime(cast.timeSeconds)}  [TEAM] ${isProc ? "[PROC]" : "[CD]"}   ${pid(player.name)} (${spec}): ${cd.spellName}${groundingNote}${unnecessaryNote}`;
        }
        addEntry(
          cast.timeSeconds,
          line,
          requestSnapshotPlaceholder(cast.timeSeconds),
        );
        // H17 (triage 2026-09-29): a teammate's Alter Time return is its own
        // moment (138e632d: the Frost Mage snapped back at 0:28 from 31 %) —
        // a line at the return, with the HP the [STATE] sampler reads at the
        // next whole second (never a raw sample).
        if (cd.spellId === ALTER_TIME_CAST_ID) {
          const ret = alterTimeReturnSeconds(
            player,
            cast.timeSeconds,
            matchStartMs,
          );
          if (ret !== null) {
            const next = toRenderSecond(ret) + 1;
            // the [STATE] tick's own two predicates: `unit:dead` first, then
            // the HP sampler (codex review: a unit dead by the next second
            // printed a positive HP)
            const hpPart = isDeadAtRenderSecond(player, matchStartMs, next)
              ? ` (dead at ${fmtTime(next)})`
              : (() => {
                  const hp = gridHpPct(player, matchStartMs + next * 1000);
                  return hp === null ? "" : ` (${hp}% HP at ${fmtTime(next)})`;
                })();
            addEntry(
              ret,
              `${fmtTime(ret)}  [TEAM] [CD]   ${pid(player.name)} (${spec}): Alter Time returned${hpPart}`,
            );
          }
        }
      }
    }
  }

  return { procLinesEmitted };
}

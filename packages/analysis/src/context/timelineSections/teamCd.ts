/**
 * [TEAM] [CD] — teammates' major cooldown presses (and proc-only activations as
 * [PROC]), with target, HP, AoE CC folding and CC-immune tags.
 *
 * Triage 2026-09-29 G3 (one template, CROSS-THEME §3): the non-CC line names
 * the recipient when it is another friendly player (crisis-external F-T1) and
 * carries the IMMUNE tag like the CC line (enemy-def F-E25a: a Freezing Trap
 * or a disarm into an immunity); the CC line adds the MISS / REFLECT tag after
 * the IMMUNE one (cc-dr F-TM1), and both tags read only the units the line
 * names (enemy-def F-E26).
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx`. `procLinesEmitted` is threaded:
 * the caller passes its current value and assigns back the returned one. Output
 * is pinned by the 605-file acceptanceCapture context hash.
 */
import { ccSpellIds } from "../../data/spellTags";
import { reachesAlly } from "../../data/spellTargeting";
import {
  cdIsProcOnly,
  gridHpPct,
  guardianSpiritSaveClause,
  isDeadAtRenderSecond,
  timingContextWithLabel,
} from "../../utils/cooldowns";
import { AOE_CC_LANDING_WINDOW_S } from "../../utils/drAnalysis";
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
    | "friendlyPid"
    | "ccImmuneTagFor"
    | "ccMissTagFor"
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
    friendlyPid,
    ccImmuneTagFor,
    ccMissTagFor,
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
            ? ` [UNNECESSARY — ${timingContextWithLabel(cast, pid)}]`
            : "";

        // B112(a): "[TEAM] [CC] N (Spec): X" was misread as teammate N BEING CC'd. It is actually N
        // CASTING an offensive CC on an enemy — render it in active voice ("cast") with the enemy
        // target so the caster is never confused with the victim. [TEAM] [CD] keeps the ": X" form,
        // with ` → <pid>` when it went to another friendly player (F-T1).
        // The units this line names, for the tags (F-E26).
        const named = new Set<string>(
          cast.targetName && cast.targetName !== "nil" ? [cast.targetName] : [],
        );
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
            AOE_CC_LANDING_WINDOW_S[cd.spellId] ?? undefined,
          );
          if (matchingAoe) {
            effectiveTgt = formatAoeTargetPart(matchingAoe, tgt);
            for (const t of matchingAoe.targets) named.add(t.name);
          }
          line = `${fmtTime(cast.timeSeconds)}  [TEAM] [CC]   ${pid(player.name)} (${spec}) cast ${cd.spellName}${effectiveTgt}${groundingNote}${ccImmuneTagFor(player, cd.spellId, cast.timeSeconds, named)}${ccMissTagFor(player, cd.spellId, cast.timeSeconds)}${unnecessaryNote}`;
        } else {
          // F-T1: another friendly player as the recipient — only for a spell
          // that officially reaches allies (`reachesAlly`: a self-only wall
          // such as Obsidian Scales logs the caster's current target), never
          // the caster itself, never an unmapped name (a pet / NPC / a
          // localized name)
          const recipient =
            reachesAlly(cd.spellId) &&
            cast.targetName &&
            cast.targetName !== "nil" &&
            cast.targetName !== player.name
              ? friendlyPid(cast.targetName)
              : undefined;
          const recipientPart = recipient ? ` → ${recipient}` : "";
          // F-E25a: a hostile press into an immunity. A proc-only activation
          // is not a press, and a spell that reaches allies is not aimed at
          // the enemy its stray miss names (Mass Invisibility logs IMMUNE on
          // enemies standing in it).
          const immunePart =
            isProc || reachesAlly(cd.spellId)
              ? ""
              : ccImmuneTagFor(player, cd.spellId, cast.timeSeconds, named);
          // B18: a Guardian Spirit whose save triggered says so (the same
          // heal the ledger's recovery reads)
          const saveNote = isProc
            ? ""
            : guardianSpiritSaveClause(
                cd.spellId,
                player,
                cast.timeSeconds,
                matchStartMs,
                cast.targetName && cast.targetName !== "nil"
                  ? cast.targetName
                  : player.name,
              );
          line = `${fmtTime(cast.timeSeconds)}  [TEAM] ${isProc ? "[PROC]" : "[CD]"}   ${pid(player.name)} (${spec}): ${cd.spellName}${recipientPart}${groundingNote}${immunePart}${saveNote}${unnecessaryNote}`;
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

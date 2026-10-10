/**
 * Context fact lines — [BURST ANSWERED], [CD PRIOR], [STACKED DEFENSIVES] and
 * [DR CLASH]: descriptive facts, not candidates. Each is capped and gated by its
 * own builder; the entries are returned because the legends are decided on what
 * actually rendered (addEntry drops anything past match end, B103).
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx`, and the four rendered-entry
 * arrays come back to the caller for the legends. Output is pinned by the
 * 605-file acceptanceCapture context hash.
 */
import {
  detectTeammateDrClashes,
  type ITeammateDrClash,
} from "../../utils/drAnalysis";
import { fmtTime } from "../../utils/renderGrid";
import { formatBurstAnsweredLines } from "../burstAnswered";
import { formatCdPriorLines } from "../cdPrior";
import { formatStackedDefensiveLines } from "../stackedDefensives";
import type { TimelineCtx } from "./ctx";

export const DR_CLASH_LEGEND = [
  "  [DR CLASH] = a friendly CC landed at diminished DR (50% or Immune) because another teammate",
  "    used a CC in the same category within the reset window — a timing note about DR conflict, not a verdict.",
];

export function emitContextFactEntries(
  ctx: Pick<
    TimelineCtx,
    | "burstWindows"
    | "matchEndSeconds"
    | "addEntry"
    | "cdPriorCohort"
    | "cdPriorEpisodes"
    | "stackedDefensives"
    | "outgoingCCChains"
    | "matchStartMs"
    | "owner"
    | "pid"
    | "enemyPid"
  >,
) {
  const {
    burstWindows,
    matchEndSeconds,
    addEntry,
    cdPriorCohort,
    cdPriorEpisodes,
    stackedDefensives,
    outgoingCCChains,
    matchStartMs,
    owner,
    pid,
    enemyPid,
  } = ctx;

  // ── [BURST ANSWERED] context lines ─────────────────────────────────────────
  // Descriptive credit for a correct reaction, NOT a candidate — see
  // context/burstAnswered.ts. Capped and gated there; emitted here so the
  // lines land in the same time-sorted stream as every other per-second entry
  // (and so the legend below can be conditional on there being any).
  // `addEntry` silently drops anything past match end (B103), so the legend
  // must be decided on what actually RENDERS, not on what the builder
  // returned — otherwise a window opening after [MATCH END] leaves a legend
  // describing lines that are not in the prompt (1 of 309 corpus prompts).
  // FT board item: these three line families name players by the
  // timeline's roster label, like every other line
  const labels = { friendly: pid, enemy: enemyPid };
  const burstAnsweredEntries = formatBurstAnsweredLines(
    burstWindows ?? [],
    undefined,
    labels,
  ).filter((e) => e.atSeconds <= matchEndSeconds);
  for (const e of burstAnsweredEntries) {
    addEntry(e.atSeconds, `${fmtTime(e.atSeconds)}  ${e.line}`);
  }

  // ── [CD PRIOR] context lines ───────────────────────────────────────────────
  // Cohort-norm fact for a held save cooldown, NOT a candidate — see
  // context/cdPrior.ts. Same render-vs-legend discipline as [BURST ANSWERED]:
  // the legend is decided on what actually renders.
  const cdPriorEntries =
    cdPriorCohort && cdPriorEpisodes
      ? formatCdPriorLines(
          cdPriorEpisodes,
          cdPriorCohort,
          undefined,
          labels,
        ).filter((e) => e.atSeconds <= matchEndSeconds)
      : [];
  for (const e of cdPriorEntries) {
    addEntry(e.atSeconds, `${fmtTime(e.atSeconds)}  ${e.line}`);
  }

  // ── [STACKED DEFENSIVES] context lines (GH #95) ───────────────────────────
  // Two major defensives from two players on one friendly — a fact about the
  // stack, NOT a candidate; see context/stackedDefensives.ts. Same
  // render-vs-legend discipline as [CD PRIOR].
  const stackedDefensiveEntries = formatStackedDefensiveLines(
    stackedDefensives ?? [],
    undefined,
    labels,
  ).filter((e) => e.atSeconds <= matchEndSeconds);
  for (const e of stackedDefensiveEntries) {
    addEntry(e.atSeconds, `${fmtTime(e.atSeconds)}  ${e.line}`);
  }

  // ── [DR CLASH] context lines (GH #67 S3) ──────────────────────────────────
  // A friendly CC landed at diminished DR because another teammate put the
  // target on DR earlier within the reset window.
  const teammateDrClashes: ITeammateDrClash[] =
    outgoingCCChains && outgoingCCChains.length > 0
      ? detectTeammateDrClashes(outgoingCCChains, matchStartMs)
      : [];

  const DR_CLASH_CAP = 3;
  // cc-dr F-DC1: the cap keeps the owner's own clashes first — (1) the owner
  // is the diminished caster, (2) the owner is the prior caster, (3) the
  // rest; time order within — then renders the kept ones in time order (it
  // kept the first three by time and dropped the owner's later ones).
  const ownerRank = (c: ITeammateDrClash) =>
    c.diminishedCasterName === owner.name
      ? 0
      : c.priorCasterName === owner.name
        ? 1
        : 2;
  const keptClashes = teammateDrClashes
    .filter((c) => c.atSeconds <= matchEndSeconds)
    .map((c, i) => ({ c, i }))
    .sort((a, b) => ownerRank(a.c) - ownerRank(b.c) || a.i - b.i)
    .slice(0, DR_CLASH_CAP)
    .sort((a, b) => a.i - b.i)
    .map(({ c }) => c);
  const drClashEntries: Array<{ atSeconds: number; line: string }> = [];
  for (const clash of keptClashes) {
    const victimWho =
      clash.diminishedCasterName === owner.name
        ? "your"
        : `${pid(clash.diminishedCasterName)}'s`;
    const priorWho =
      clash.priorCasterName === owner.name
        ? "your"
        : `${pid(clash.priorCasterName)}'s`;
    // the diminished CC landed on an ENEMY: the enemy roster's label (`pid`
    // only knows the friendly side and printed the bare character name)
    const target = enemyPid(clash.targetName);
    const line = `[DR CLASH]   ${victimWho} ${clash.diminishedSpellName} on ${target} landed at ${clash.level} DR (${clash.category}) — ${priorWho} ${clash.priorSpellName} ${clash.gapSeconds}s earlier put them on DR`;
    drClashEntries.push({ atSeconds: clash.atSeconds, line });
    addEntry(clash.atSeconds, `${fmtTime(clash.atSeconds)}  ${line}`);
  }

  // exported: returned to the caller (GH #116)
  return {
    burstAnsweredEntries,
    cdPriorEntries,
    stackedDefensiveEntries,
    drClashEntries,
  };
}

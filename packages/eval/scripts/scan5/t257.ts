/**
 * scan5/t257.ts — ticket T257 (user ruling R110, GH #226-40): another
 * teammate's team-heal wall (Tree of Life, Ancient of Lore, Ultimate
 * Penitence, the pressed Spirit of Redemption — `TEAM_HEAL_WALL_ANSWER_IDS`)
 * answers a burst window and was never named by `[BURST ANSWERED]`. It is
 * named only in a window no other answer is credited for, and only in the
 * cap slots the other windows leave; no line is renamed or pushed out.
 *
 * THIS SCAN RE-RUNS THE ENGINE AND THE RENDERER: its numbers are the
 * checkout's. Which windows print, in which order and with which answer is
 * the producer's own `formatBurstAnsweredLines` (called with stand-in labels);
 * which of them are team-heal-wall credits is its `teamHealWallCredit`.
 *
 *  - `teamHealWallUnnamed`: a line the checkout's renderer prints for a
 *    window only a teammate's team-heal wall answers, and the capture has
 *    no `[BURST ANSWERED]` line at that second naming that spell. Non-zero
 *    on a capture taken before the fix, 0 on one taken with it. Kind = the
 *    spell. Counted: every such line of the checkout's renderer.
 *  - `creditLineRenamedOrDropped`: a `[BURST ANSWERED]` line of the capture
 *    that the checkout's renderer does not print at that second with that
 *    answer, that answering player and that time — "nothing renamed, nothing pushed out of the
 *    cap". 0 on both captures. Counted: every printed line.
 *  - `teamHealWallPastCap`: inventory, never a failure — a window only a
 *    teammate's team-heal wall answers that the round's cap leaves out.
 *    Counted: every window with such a credit.
 */
import { burstWindowDecisionPoints } from "@gladlog/analysis/src/analysis/burstWindowDecisionPoints";
import {
  formatBurstAnsweredLines,
  teamHealWallCredit,
} from "@gladlog/analysis/src/context/burstAnswered";
import { fmtTime } from "@gladlog/analysis/src/utils/renderGrid";
import {
  isPastRoundEnd,
  roundEndMs,
} from "@gladlog/analysis/src/utils/roundEnd";

import type { IRoundCtx } from "./ctx";
import { readPrintedAnswer } from "./t184";

export const CHECKS = [
  "teamHealWallUnnamed",
  "creditLineRenamedOrDropped",
  "teamHealWallPastCap",
] as const;

const PAST_CAP = "left out by the round's cap";
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  `teamHealWallPastCap|${PAST_CAP}`,
]);

export function run(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  if (!owner) return;
  let points: ReturnType<typeof burstWindowDecisionPoints>;
  try {
    points = burstWindowDecisionPoints(ctx.legacy, {
      friendlyReaction: owner.reaction,
    });
  } catch {
    return;
  }
  // the renderer's own lines, read back by the reader the gates use; a
  // window that opens after the round's end — a Solo Shuffle round's
  // deciding death, else the log's end — is never emitted (the timeline's
  // own `addEntry` cut: `isPastRoundEnd` over `roundEndMs`)
  const endSec = (roundEndMs(ctx.legacy) - ctx.start) / 1000;
  const pastEnd = (sec: number): boolean => isPastRoundEnd(sec, endSec);
  // roster-label-shaped names, so the reader takes a control's target
  // clause as one (the capture's lines carry `5(RPaladin)` labels)
  const label = (n: string): string => `${ctx.pidOf(n) ?? "0"}(x)`;
  const labels = { friendly: label, enemy: label };
  const rendered = formatBurstAnsweredLines(points, undefined, labels)
    .filter((e) => !pastEnd(e.atSeconds))
    .map((e) => ({
      atSec: e.atSeconds,
      answer: readPrintedAnswer(`${fmtTime(e.atSeconds)}  ${e.line}`),
      wall: teamHealWallCredit(points.find((p) => p.tSec === e.atSeconds)!),
    }));
  const printed = ctx.lines
    .filter((l) => l.includes("[BURST ANSWERED]"))
    .map((l) => ({ line: l.trim(), answer: readPrintedAnswer(l) }))
    .filter((x) => x.answer !== null);
  const fact = (sec: number): string =>
    `${ctx.roundKey}|${owner.reaction}|${sec}`;
  for (const r of rendered) {
    if (!r.wall || !r.answer) continue;
    ctx.bump("teamHealWallUnnamed");
    if (
      printed.some(
        (x) =>
          x.answer!.atSec === r.atSec &&
          x.answer!.spellName === r.answer!.spellName,
      )
    )
      continue;
    ctx.violate(
      "teamHealWallUnnamed",
      r.wall.spellName,
      ctx.start + r.atSec * 1000,
      fact(r.atSec),
      `window at ${r.atSec}s: ${r.wall.casterName} ${r.wall.spellName} ${r.wall.latencySec}s is the window's only credit; the capture prints no line naming it`,
    );
  }
  for (const x of printed) {
    ctx.bump("creditLineRenamedOrDropped");
    const a = x.answer!;
    const same = rendered.find((r) => r.atSec === a.atSec);
    const kind = !same?.answer
      ? "the renderer prints no line at that second"
      : same.answer.spellName !== a.spellName
        ? "the renderer names another answer"
        : /^(\d+)/.exec(same.answer.answerer)?.[1] !==
            /^(\d+)/.exec(a.answerer)?.[1]
          ? "the renderer credits another player"
          : Math.abs(same.answer.latencySec - a.latencySec) > 0.05
            ? "the time differs"
            : null;
    if (kind === null) continue;
    ctx.violate(
      "creditLineRenamedOrDropped",
      kind,
      ctx.start + a.atSec * 1000,
      fact(a.atSec),
      `printed: ${a.spellName} ${a.latencySec}s; renderer: ${same?.answer ? `${same.answer.spellName} ${same.answer.latencySec}s` : "none"}`,
      x.line,
    );
  }
  for (const p of points) {
    const wall = teamHealWallCredit(p);
    if (!wall) continue;
    ctx.bump("teamHealWallPastCap");
    // the windows the renderer's door admits and its cap drops: the ones a
    // cap of every window would print
    if (rendered.some((r) => r.atSec === p.tSec)) continue;
    if (
      pastEnd(p.tSec) ||
      !formatBurstAnsweredLines(points, { cap: points.length }, labels).some(
        (e) => e.atSeconds === p.tSec,
      )
    )
      continue;
    ctx.violate(
      "teamHealWallPastCap",
      PAST_CAP,
      ctx.start + p.tSec * 1000,
      fact(p.tSec),
      `window at ${p.tSec}s: ${wall.casterName} ${wall.spellName} ${wall.latencySec}s`,
    );
  }
}

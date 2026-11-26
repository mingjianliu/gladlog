/**
 * scan5/t257.ts — ticket T257 (user ruling R110, GH #226-40): another
 * teammate's team-heal wall (Tree of Life, Ancient of Lore, Ultimate
 * Penitence, the pressed Spirit of Redemption — `TEAM_HEAL_WALL_ANSWER_IDS`)
 * answers a burst window and was never named by `[BURST ANSWERED]`. It is
 * named only in a window no other answer is credited for, and only in the
 * cap slots the other windows leave; no line is renamed or pushed out.
 *
 * THIS SCAN RE-RUNS THE ENGINE AND THE RENDERER: its numbers are the
 * checkout's; only `teamHealWallUnnamed` reads the capture. Which windows print, in which order and with which answer is
 * the producer's own `formatBurstAnsweredLines` (called with stand-in labels);
 * which of them are team-heal-wall credits is its `teamHealWallCredit`.
 *
 *  - `teamHealWallUnnamed`: a line the checkout's renderer prints for a
 *    window only a teammate's team-heal wall answers, and the capture has
 *    no `[BURST ANSWERED]` line at that second naming that spell, that
 *    player and that time. Non-zero
 *    on a capture taken before the fix, 0 on one taken with it. Kind = the
 *    spell. Counted: every such line of the checkout's renderer.
 *  - `creditLineRenamedOrDropped`: a line the checkout's renderer prints
 *    WITHOUT the team-heal-wall fallback (the same engine output with every
 *    teammate's team-heal wall taken out of each window's responses —
 *    `answersPressured` never credits one outside the fallback, so nothing
 *    else moves) that it does not print
 *    WITH the fallback at that second with that answer, that answering
 *    player and that time — "nothing renamed, nothing pushed out of the
 *    cap". Both renders come from one engine run, so a change another
 *    ticket makes to the engine (a T258 span) cannot read as a T257 drop
 *    (T300, codex 80-WSL-BW1-1 #3). 0 by construction of the fix. Counted:
 *    every line of the render without the fallback.
 *  - `teamHealWallPastCap`: inventory, never a failure — a window only a
 *    teammate's team-heal wall answers that the round's cap leaves out.
 *    Counted: every window with such a credit.
 */
import {
  burstWindowDecisionPoints,
  TEAM_HEAL_WALL_ANSWER_IDS,
} from "@gladlog/analysis/src/analysis/burstWindowDecisionPoints";
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

/** Two roster labels name one player (`3(RDruid)` → 3). */
const sameAnswerer = (a: string, b: string): boolean =>
  /^(\d+)/.exec(a)?.[1] === /^(\d+)/.exec(b)?.[1];

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
  const render = (pts: typeof points) =>
    formatBurstAnsweredLines(pts, undefined, labels)
      .filter((e) => !pastEnd(e.atSeconds))
      .map((e) => {
        const text = `${fmtTime(e.atSeconds)}  ${e.line}`;
        return {
          atSec: e.atSeconds,
          text,
          answer: readPrintedAnswer(text),
          wall: teamHealWallCredit(pts.find((p) => p.tSec === e.atSeconds)!),
        };
      });
  const rendered = render(points);
  // the same engine output rendered without the R110 fallback: the windows
  // only a team-heal wall answers left out (`teamHealWallCredit` is defined
  // only where `creditedAnswer` is not, so no other window's door, rank or
  // answer moves)
  // codex 85-tk-L2-T300-1 #1: the teammates' team-heal walls are taken out
  // of each window's responses, not the windows out of the list, so a
  // renderer that put one before an ordinary credit (169ee83b r5 0:35,
  // Ironbark then Tree of Life) shows as a renamed line. `answersPressured`
  // never credits another unit's wall outside the fallback, so the
  // remaining responses credit what they credited before.
  const otherTeamWall = (
    p: (typeof points)[number],
    r: (typeof points)[number]["responseCasts"][number],
  ): boolean =>
    r.category === "wall" &&
    TEAM_HEAL_WALL_ANSWER_IDS.has(r.spellId) &&
    r.casterId !== undefined &&
    r.casterId !== p.pressured?.unitId;
  const withoutWall = render(
    points.map((p) => ({
      ...p,
      responseCasts: p.responseCasts.filter((r) => !otherTeamWall(p, r)),
    })),
  );
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
          x.answer!.spellName === r.answer!.spellName &&
          // the same player and time too (codex 85-tk-L2-T300-1 #3)
          sameAnswerer(x.answer!.answerer, r.answer!.answerer) &&
          Math.abs(x.answer!.latencySec - r.answer!.latencySec) <= 0.05,
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
  for (const w of withoutWall) {
    if (!w.answer) continue;
    ctx.bump("creditLineRenamedOrDropped");
    const a = w.answer;
    const same = rendered.find((r) => r.atSec === a.atSec);
    const kind = !same?.answer
      ? "the renderer prints no line at that second"
      : same.answer.spellName !== a.spellName
        ? "the renderer names another answer"
        : !sameAnswerer(same.answer.answerer, a.answerer)
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
      `without the fallback: ${a.spellName} ${a.latencySec}s; with it: ${same?.answer ? `${same.answer.spellName} ${same.answer.latencySec}s` : "none"}`,
      w.text,
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

/* eslint-disable @typescript-eslint/no-explicit-any -- the legacy parse objects are untyped */
/**
 * scan5/t256.ts — ticket T256 (user ruling R109, GH #225-A12): a control
 * that LANDS on a burst caster after the press that made it (Deep Breath →
 * Terror of the Skies, a Ring of Frost walked into, a trap, a pet sent to
 * stun) answers the window when the LANDING is inside the response span;
 * the line still prints the press. Before, the press decided both: a press
 * a moment before the span whose control landed inside it answered nothing,
 * and a press at the span's end whose control landed past it answered.
 *
 * THIS SCAN RE-RUNS THE ENGINE: its numbers are the checkout's. Which
 * responses a window holds, which one is credited and what lands where are
 * the engine's own (`responseCasts`, `creditedAnswer`, `controlOn`); the
 * span is the producer's `burstResponseSpanMs`.
 *
 *  - `printedControlAnswerDiffers`: a printed `[BURST ANSWERED]` line whose
 *    answer is a control — in print, or in the engine's credited answer for
 *    that window — and whose answer, answerer, time or targets are not what
 *    the checkout's engine credits. Non-zero on a capture taken before the
 *    fix, 0 on one taken with it. Kind = what differs.
 *    Counted: every such printed line.
 *  - `landedControlOutsideSpan`: a landed-control response of an engine
 *    window (every owner) whose landing is outside the window's span.
 *    A totem's or guardian's control that its summon does not time keeps
 *    its press for both questions (the R90 scope note: Capacitor Totem →
 *    Static Charge) — counted as an inventory kind, never a failure.
 *    Counted: every landed-control response.
 *  - `aimedControlLandsPastSpan`: inventory, never a failure — an AIMED
 *    control pressed inside the span whose every landing is past it. The
 *    cast side keeps press-time membership; R109 was not asked about it.
 *    Counted: every aimed control response that landed.
 */
import {
  burstResponseSpanMs,
  burstWindowDecisionPoints,
} from "@gladlog/analysis/src/analysis/burstWindowDecisionPoints";
import { creditedAnswer } from "@gladlog/analysis/src/context/burstAnswered";

import { APPLIED, ev, type IRoundCtx, nameOf, tsOf } from "./ctx";
import { readPrintedAnswer } from "./t184";

export const CHECKS = [
  "printedControlAnswerDiffers",
  "landedControlOutsideSpan",
  "aimedControlLandsPastSpan",
] as const;

const SUMMON_KEPT_ON_PRESS =
  "a totem's or guardian's control kept on its press";
const AIMED_PAST_SPAN = "pressed inside the span, landed past it";
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  `landedControlOutsideSpan|${SUMMON_KEPT_ON_PRESS}`,
  `aimedControlLandsPastSpan|${AIMED_PAST_SPAN}`,
]);

type Points = ReturnType<typeof burstWindowDecisionPoints>;

function printedLines(ctx: IRoundCtx, points: Points): void {
  const C = "printedControlAnswerDiffers";
  for (const line of ctx.lines) {
    if (!line.includes("[BURST ANSWERED]")) continue;
    const a = readPrintedAnswer(line);
    if (!a) continue;
    const p = points.find((x) => x.tSec === a.atSec);
    const credited = p ? creditedAnswer(p) : undefined;
    if (a.controlOn.length === 0 && credited?.category !== "control") continue;
    ctx.bump(C);
    const unit = ctx.unitOfPid(/^(\d+)/.exec(a.answerer)?.[1]);
    // every caster the credited press landed on; the renderer prints the
    // ones that answer the pressured unit, a non-empty subset of these
    const engineTargets = new Set<string>(
      p && credited
        ? p.responseCasts
            .filter(
              (r) =>
                r.controlOn &&
                r.casterName === credited.casterName &&
                r.spellName === credited.spellName &&
                r.latencySec === credited.latencySec,
            )
            .map((r) => r.controlOn!.unitId)
        : [],
    );
    const printedTargets = a.controlOn.map(
      (t) =>
        ctx.unitOfPid(/^(\d+)/.exec(t.target)?.[1])?.id as string | undefined,
    );
    const kind = !p
      ? "the engine has no window at that second"
      : !credited
        ? "the engine credits no answer in that window"
        : credited.spellName !== a.spellName
          ? "the engine credits another answer"
          : unit === undefined || printedTargets.some((id) => id === undefined)
            ? "a printed identity does not resolve"
            : unit.name !== credited.casterName
              ? "the answerer differs"
              : Math.abs(credited.latencySec - a.latencySec) > 0.05
                ? "the time differs"
                : printedTargets.length > engineTargets.size ||
                    printedTargets.some((id) => !engineTargets.has(id!))
                  ? "the targets differ"
                  : null;
    if (kind === null) continue;
    ctx.violate(
      C,
      kind,
      ctx.start + a.atSec * 1000,
      `${ctx.roundKey}|${ctx.owner.reaction}|${a.atSec}`,
      `printed: ${a.answerer} ${a.spellName} ${a.latencySec}s on ${a.controlOn.map((t) => t.target).join(" and ") || "-"}; engine: ${credited ? `${credited.casterName} ${credited.spellName} ${credited.latencySec}s` : "none"}`,
      line.trim(),
    );
  }
}

export function run(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  if (!owner) return;
  let points: Points;
  try {
    points = burstWindowDecisionPoints(ctx.legacy, {
      friendlyReaction: owner.reaction,
    });
  } catch {
    return;
  }
  printedLines(ctx, points);
  const at = (ms: number): string => ((ms - ctx.start) / 1000).toFixed(1);
  for (const p of points) {
    const { w0, w1 } = burstResponseSpanMs(ctx.start + p.tSec * 1000);
    for (const r of p.responseCasts) {
      if (r.category !== "control" || !r.controlOn) continue;
      const auras = r.controlOn.auras;
      const id = `${ctx.roundKey}|${owner.reaction}|${p.tSec}|${r.casterName}|${r.spellId}|${r.tSec}`;
      if (r.landed !== undefined) {
        // an aimed control (the cast side)
        if (auras.length === 0) continue;
        ctx.bump("aimedControlLandsPastSpan");
        if (auras.every((x) => x.atMs > w1))
          ctx.violate(
            "aimedControlLandsPastSpan",
            AIMED_PAST_SPAN,
            auras[0]!.atMs,
            id,
            `window at ${p.tSec}s: ${r.casterName} ${r.spellName} pressed ${r.latencySec}s, landed on ${r.controlOn.unitName} at ${at(auras[0]!.atMs)}s; the span ends ${at(w1)}s`,
          );
        continue;
      }
      const landing = auras[0];
      if (!landing) continue;
      ctx.bump("landedControlOutsideSpan");
      if (landing.atMs >= w0 && landing.atMs <= w1) continue;
      // the aura row itself: whose unit put it there
      const holder = ctx.units.find((u: any) => u.id === r.controlOn!.unitId);
      const row = ((holder?.auraEvents ?? []) as any[]).find(
        (a) =>
          ev(a) === APPLIED &&
          String(a.spellId) === landing.spellId &&
          tsOf(a) === landing.atMs,
      );
      const srcId: string | undefined = row?.srcUnitId;
      const src = ctx.units.find((u: any) => u.id === srcId);
      const fromSummon =
        !!srcId && !!src && !src.info && !srcId.startsWith("Pet-");
      ctx.violate(
        "landedControlOutsideSpan",
        fromSummon ? SUMMON_KEPT_ON_PRESS : "landed outside the span",
        landing.atMs,
        id,
        `window at ${p.tSec}s (span ${at(w0)}–${at(w1)}s): ${r.casterName} ${nameOf(landing.spellId)} landed on ${r.controlOn.unitName} at ${at(landing.atMs)}s${src ? ` from ${src.name}` : ""}; printed latency ${r.latencySec}s`,
      );
    }
  }
}

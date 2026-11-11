/* eslint-disable @typescript-eslint/no-explicit-any -- scan over raw parse output */
/**
 * scan5/t91.ts — pipeline T91: a burst window whose last effect's end runs
 * past the analysed slice's end measured its damage RATE over seconds the
 * log shows no damage for, so its damage ratio — and the `dangerScore` /
 * `dangerLabel` the POSITIONING and [HEALER EXPOSURE] lines print — read
 * low.
 *
 * Check `burstRatePastSliceEnd`, per owner context. Counted: every aligned
 * burst window of the owner's timeline (the product's own call:
 * `reconstructEnemyCDTimeline(enemies, combat, owner, friends)`) whose
 * `toSeconds` is past the slice's end. Log truth, read on the raw rows: the
 * damage the owner's side took from the window's start to the slice's end,
 * over those seconds, against the side's average over the whole slice —
 * clamped as the product's ratio is (0.5–6). Kinds:
 *  - `label reads low` — the window's `dangerLabel` is lower than the label
 *    of its own score at the log's ratio (`dangerLabel`, a threshold
 *    lookup);
 *  - `ratio low, same label` — out of the total: the ratio is under the
 *    log's by more than 2 %, the label is the same.
 */
import { reconstructEnemyCDTimeline } from "@gladlog/analysis/src/utils/enemyCDs";
import { dangerLabel } from "@gladlog/analysis/src/utils/spellDanger";

import { fmtS, type IRoundCtx } from "./ctx";

export const CHECKS = ["burstRatePastSliceEnd"] as const;
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "burstRatePastSliceEnd|ratio low, same label",
]);

const RATIO_MIN = 0.5;
const RATIO_MAX = 6;
const RATIO_TOLERANCE = 0.02;

/** the side's damage taken in [fromS, toS] of the slice, and over all of it */
export function sideDamage(
  side: readonly any[],
  startMs: number,
  fromS: number,
  toS: number,
): { inSpan: number; total: number } {
  let inSpan = 0;
  let total = 0;
  for (const u of side)
    for (const e of (u.damageIn ?? []) as any[]) {
      const amount = Math.abs(e.effectiveAmount ?? 0);
      total += amount;
      const t = (e.logLine.timestamp - startMs) / 1000;
      if (t >= fromS && t <= toS) inSpan += amount;
    }
  return { inSpan, total };
}

export function run(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  if (!owner) return;
  const friends = (ctx.players as any[]).filter(
    (p) => p.reaction === owner.reaction,
  );
  const enemies = (ctx.players as any[]).filter(
    (p) => p.reaction !== owner.reaction,
  );
  const combat = {
    ...ctx.legacy,
    startTime: ctx.start,
    endTime: ctx.end,
  };
  const sliceEndS = (ctx.end - ctx.start) / 1000;
  if (!(sliceEndS > 0)) return;
  const timeline = reconstructEnemyCDTimeline(
    enemies as never,
    combat as never,
    owner as never,
    friends as never,
  );
  for (const w of timeline.alignedBurstWindows) {
    if (!(w.toSeconds > sliceEndS + 0.05)) continue;
    ctx.bump("burstRatePastSliceEnd");
    const { inSpan, total } = sideDamage(
      friends,
      ctx.start,
      w.fromSeconds,
      sliceEndS,
    );
    const avgRate = total / sliceEndS;
    if (!(avgRate > 0) || !(w.damageRatio > 0)) continue;
    const shownS = Math.max(sliceEndS - w.fromSeconds, 1);
    const logRatio = Math.min(
      RATIO_MAX,
      Math.max(inSpan / shownS / avgRate, RATIO_MIN),
    );
    if (!(logRatio > w.damageRatio * (1 + RATIO_TOLERANCE))) continue;
    const logLabel = dangerLabel((w.dangerScore / w.damageRatio) * logRatio);
    ctx.violate(
      "burstRatePastSliceEnd",
      logLabel !== w.dangerLabel ? "label reads low" : "ratio low, same label",
      ctx.start + w.fromSeconds * 1000,
      `${owner.name}#${Math.round(w.fromSeconds * 1000)}`,
      `window ${fmtS(w.fromSeconds)}–${fmtS(w.toSeconds)} (slice ends ${fmtS(sliceEndS)}): ratio ${w.damageRatio.toFixed(2)} [${w.dangerLabel}], over the ${shownS.toFixed(1)} s the log shows ${logRatio.toFixed(2)} [${logLabel}]`,
    );
  }
}

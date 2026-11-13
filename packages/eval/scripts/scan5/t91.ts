/* eslint-disable @typescript-eslint/no-explicit-any -- scan over raw parse output */
/**
 * scan5/t91.ts — pipeline T91: a burst window whose last effect's end runs
 * past the analysed slice's end measured its damage RATE over seconds the
 * log shows no damage for, so its damage ratio — and the `dangerScore` /
 * `dangerLabel` the POSITIONING and [HEALER EXPOSURE] lines print — read
 * low.
 *
 * Counted, per owner context: every aligned burst window of the owner's
 * timeline (the product's own call:
 * `reconstructEnemyCDTimeline(enemies, combat, owner, friends)`) whose
 * `toSeconds` is past the slice's end. Log truth, read on the raw rows of
 * the slice and no row after its end (a Solo Shuffle round's unit arrays
 * keep the rows after the deciding death).
 *
 * Check `burstRatePastSliceEnd`: the damage the owner's side took from the
 * window's start to the slice's end, over those seconds
 * (`burstWindowRateSpanSeconds`), against the side's average over the
 * slice — clamped as the product's ratio is. Wrong either way (codex
 * 85-tk-G-T91-1 #1: a numerator that kept the damage after the slice's end
 * read HIGH and the one-sided check said nothing). Kinds:
 *  - `label reads low` / `label reads high` — the window's `dangerLabel`
 *    differs from the label of its own score at the log's ratio
 *    (`dangerLabel`, a threshold lookup);
 *  - `ratio off, same label` — out of the total: the ratio is off the
 *    log's by more than 2 %, the label is the same.
 *
 * Check `burstHealerCcPastSliceEnd` (codex #2), healer owners: the share
 * of those same seconds the owner spent under a control aura (rows of
 * `ccSpellIds` on the owner, a run still open at the slice's end closed
 * there), against the share the window's score carries
 * (`dangerScore / (threatScore × damageRatio)` = 1 + share ×
 * `BURST_HEALER_CC_WEIGHT`). Counted when the log shows any control in the
 * span (a window with none is the product's "cast nothing" reading, which
 * has no log row to check). Kind `coverage off`: the two differ by more
 * than 5 points.
 */
import { ccSpellIds } from "@gladlog/analysis/src/data/spellTags";
import { supersededAuraBreaks } from "@gladlog/analysis/src/utils/auraIntervals";
import { isHealerSpec } from "@gladlog/analysis/src/utils/cooldowns";
import {
  BURST_DAMAGE_RATIO_MAX,
  BURST_DAMAGE_RATIO_MIN,
  BURST_HEALER_CC_WEIGHT,
  burstWindowRateSpanSeconds,
  reconstructEnemyCDTimeline,
} from "@gladlog/analysis/src/utils/enemyCDs";
import { dangerLabel } from "@gladlog/analysis/src/utils/spellDanger";

import { APPLIED, ev, fmtS, type IRoundCtx, REFRESH, tsOf } from "./ctx";

export const CHECKS = [
  "burstRatePastSliceEnd",
  "burstHealerCcPastSliceEnd",
] as const;
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "burstRatePastSliceEnd|ratio off, same label",
]);

const RATIO_TOLERANCE = 0.02;
const COVERAGE_TOLERANCE = 0.05;
const LABEL_RANK = ["Low", "Moderate", "High", "Critical"];

/** the side's damage taken in [fromS, toS] of the slice, and over the
 * slice [0, sliceEndS] — no row after its end */
export function sideDamage(
  side: readonly any[],
  startMs: number,
  fromS: number,
  toS: number,
  sliceEndS: number,
): { inSpan: number; total: number } {
  let inSpan = 0;
  let total = 0;
  for (const u of side)
    for (const e of (u.damageIn ?? []) as any[]) {
      const t = (e.logLine.timestamp - startMs) / 1000;
      if (t > sliceEndS) continue;
      const amount = Math.abs(e.effectiveAmount ?? 0);
      total += amount;
      if (t >= fromS && t <= toS) inSpan += amount;
    }
  return { inSpan, total };
}

/** A window's printed ratio and label against the ratio the log gives. The
 * label is compared first, whatever the ratios' distance: the tolerance is
 * for a ratio a hair off that leaves the label standing, never for one that
 * carries the score over a threshold (codex 85-tk-G-T91-1b #1: a score of
 * 4.01 on a ratio read 1 % low is 3.97 — High printed as Moderate, inside
 * the 2 %). */
export function rateVerdict(
  w: { damageRatio: number; dangerScore: number; dangerLabel: string },
  logRatio: number,
): { kind?: string; logLabel: string } {
  const logLabel = dangerLabel((w.dangerScore / w.damageRatio) * logRatio);
  if (logLabel !== w.dangerLabel)
    return {
      kind:
        LABEL_RANK.indexOf(w.dangerLabel) < LABEL_RANK.indexOf(logLabel)
          ? "label reads low"
          : "label reads high",
      logLabel,
    };
  return Math.abs(logRatio - w.damageRatio) <=
    Math.max(logRatio, w.damageRatio) * RATIO_TOLERANCE
    ? { logLabel }
    : { kind: "ratio off, same label", logLabel };
}

/** the ms of [fromMs, toMs] `unit` spent under a control aura, as its rows
 * say: APPLIED / REFRESH opens a run, anything else of that aura closes it,
 * a run still open at `toMs` is closed there */
export function controlledMs(unit: any, fromMs: number, toMs: number): number {
  const open = new Map<string, number>();
  const spans: Array<[number, number]> = [];
  // a BROKEN row its aura's own REMOVED follows is not the end — the
  // product's predicate, the same set (`supersededAuraBreaks`, FT-T08; codex
  // 85-tk-G-T91-1b #2: Polymorph broken at 99.90 s and removed at 99.94 s
  // read 80 % against the engine's 88 %)
  const notTheEnd = supersededAuraBreaks((unit.auraEvents ?? []) as never);
  for (const a of (unit.auraEvents ?? []) as any[]) {
    const id = String(a.spellId);
    if (!ccSpellIds.has(id) || notTheEnd.has(a)) continue;
    const t = tsOf(a);
    if (ev(a) === APPLIED || ev(a) === REFRESH) {
      if (!open.has(id)) open.set(id, t);
    } else if (/REMOVED$|BROKEN/.test(String(ev(a)))) {
      const from = open.get(id);
      if (from !== undefined) spans.push([from, t]);
      open.delete(id);
    }
  }
  for (const from of open.values()) spans.push([from, toMs]);
  const cut = spans
    .map(([a, b]) => [Math.max(a, fromMs), Math.min(b, toMs)] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let sum = 0;
  let reach = -Infinity;
  for (const [a, b] of cut) {
    if (b <= reach) continue;
    sum += b - Math.max(a, reach);
    reach = b;
  }
  return sum;
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
    const at = ctx.start + w.fromSeconds * 1000;
    const id = `${owner.name}#${Math.round(w.fromSeconds * 1000)}`;
    const span = `window ${fmtS(w.fromSeconds)}–${fmtS(w.toSeconds)} (slice ends ${fmtS(sliceEndS)})`;

    // the healer's control over the seconds the slice shows
    const shownMs = ctx.end - at;
    if (isHealerSpec(owner.spec) && shownMs > 0) {
      const ccMs = controlledMs(owner, at, ctx.end);
      if (ccMs > 0 && w.threatScore > 0 && w.damageRatio > 0) {
        ctx.bump("burstHealerCcPastSliceEnd");
        const logShare = ccMs / shownMs;
        const share =
          (w.dangerScore / (w.threatScore * w.damageRatio) - 1) /
          BURST_HEALER_CC_WEIGHT;
        if (Math.abs(share - logShare) > COVERAGE_TOLERANCE)
          ctx.violate(
            "burstHealerCcPastSliceEnd",
            "coverage off",
            at,
            id,
            `${span}: healer control share ${(share * 100).toFixed(0)} % in the score, ${(logShare * 100).toFixed(0)} % of the ${(shownMs / 1000).toFixed(1)} s the log shows`,
          );
      }
    }

    ctx.bump("burstRatePastSliceEnd");
    const { inSpan, total } = sideDamage(
      friends,
      ctx.start,
      w.fromSeconds,
      sliceEndS,
      sliceEndS,
    );
    const avgRate = total / sliceEndS;
    if (!(avgRate > 0) || !(w.damageRatio > 0)) continue;
    const shownS = burstWindowRateSpanSeconds(
      w.fromSeconds,
      w.toSeconds,
      sliceEndS,
    );
    const logRatio = Math.min(
      BURST_DAMAGE_RATIO_MAX,
      Math.max(inSpan / shownS / avgRate, BURST_DAMAGE_RATIO_MIN),
    );
    const { kind, logLabel } = rateVerdict(w, logRatio);
    if (!kind) continue;
    ctx.violate(
      "burstRatePastSliceEnd",
      kind,
      at,
      id,
      `${span}: ratio ${w.damageRatio.toFixed(2)} [${w.dangerLabel}], over the ${shownS.toFixed(1)} s the log shows ${logRatio.toFixed(2)} [${logLabel}]`,
    );
  }
}

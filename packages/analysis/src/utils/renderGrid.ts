/**
 * The prompt's render grid — the single source for how an instant becomes text
 * and which instant a rendered value must be sampled at.
 *
 * Extracted from `cooldowns.ts` on 2026-08-16. These three functions have
 * nothing to do with cooldowns; they lived there for historical reasons, which
 * meant that anything needing to print a timestamp had to import a 2,258-line
 * cooldown module (fan-in 35 of 114 files in this package). The companion
 * regression guard `renderGrid.test.ts` already carried this module's name
 * before the module existed.
 *
 * Deliberately NOT moved here: `HP_SAMPLE_RADIUS_MS`. That constant is a data
 * freshness tolerance (how far from an instant we will accept a sample), not a
 * text-formatting rule; it stays next to the sampling logic in `cooldowns.ts`.
 *
 * This module must stay dependency-free — every layer imports it.
 */

/** Format seconds as m:ss string */
export function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Snaps an arbitrary instant onto the **prompt's render grid** (whole seconds) —
 * the same rounding rule fmtTime uses.
 *
 * **Any sample that will be rendered together with a timestamp must go through
 * this function before the value is looked up.**
 *
 * Measured on 2026-07-20 (class A, 26/50 matches): `[STATE]` sampled on
 * whole-second ticks while `[DMG SPIKE]` sampled at `pw.fromSeconds` (fractional
 * seconds), yet both were rendered through fmtTime into the **same displayed
 * second** — so two HP numbers under one timestamp contradicted each other
 * (median 7pp, max 25pp). Note: this is NOT a sampling-radius problem —
 * getUnitHpAtTimestamp picks the nearest sample first and only then uses the
 * radius to accept or reject it, so changing the radius can only turn the value
 * into null, it **never changes the value**. The only way to make both sides
 * agree is to make them query the same instant.
 *
 * See CLAUDE.md, "a gate predicate IS the spec": fractional seconds inside the
 * analysis must be floored onto the render grid before any decision that will be
 * rendered or recomputed by a gate.
 */
export function toRenderSecond(seconds: number): number {
  return Math.floor(seconds);
}

/**
 * The width (in seconds) a time window **appears to have** in the prompt.
 *
 * Windows are generally rendered as `fmtTime(from)–fmtTime(to) (Ns)`. If N is
 * taken from the raw `toSeconds - fromSeconds` and then rounded, a reader
 * subtracting the displayed endpoints gets a different number (e.g.
 * `0:10–0:20 (9s)`) — classes E/G of the 2026-07-20 eval, "window duration
 * doesn't add up". The width must be derived from the **displayed** endpoints
 * for the rendered text to be self-consistent.
 */
export function renderedWindowSeconds(
  fromSeconds: number,
  toSeconds: number,
): number {
  return Math.max(0, toRenderSecond(toSeconds) - toRenderSecond(fromSeconds));
}

/**
 * A duration or a gap printed in whole seconds: `3s`, and `<1s` for one that
 * rounds to zero.
 *
 * `0s` reads as "nothing happened": a control that held 0.3 s printed as one
 * that did nothing (FT-T09), a control with 0.4 s to run as one already over
 * (FT-T04). The interval is real — it is under half a second, and the text
 * says so. The one formatter for that reading: `renderedCcDuration` (control
 * lines), `resCcRemainingText` (the [RES] `cc:` token), the `next spike in`
 * note of a press line and the `after …` of `[CC REMOVED]` all print through
 * it, and `parseWholeSeconds` reads every one of them back.
 *
 * It prints `<1s` for an input of exactly 0 too — right for an interval whose
 * two ends are both events in the log (a spike whose first hit shares the
 * press's millisecond still follows the press). An amount that can truly be
 * nothing goes through `fmtWholeSecondsOrZero`.
 */
export function fmtWholeSeconds(seconds: number): string {
  const whole = Math.round(seconds);
  return whole < 1 ? "<1s" : `${whole}s`;
}

/**
 * `fmtWholeSeconds` for an amount that can be nothing at all — the owner's
 * free time inside a window, what a control had left when it had already run
 * its length: `0s` when it IS zero (that is the fact; `<1s` would claim a
 * remainder), `<1s` when it is positive and rounds to zero.
 */
export function fmtWholeSecondsOrZero(seconds: number): string {
  return seconds > 0 ? fmtWholeSeconds(seconds) : "0s";
}

/** What the two formatters above print, as a pattern source (no capture
 *  group) for a reader that has to find the number inside a line. */
export const WHOLE_SECONDS_RE_SRC = String.raw`(?:<1|\d+)s`;

/** The whole seconds a `fmtWholeSeconds` / `fmtWholeSecondsOrZero` text
 *  stands for — `<1s` is 0, the number it rounded to. Undefined for any
 *  other text. */
export function parseWholeSeconds(text: string): number | undefined {
  const m = text.match(/^(<1|\d+)s$/);
  return m ? (m[1] === "<1" ? 0 : Number(m[1])) : undefined;
}

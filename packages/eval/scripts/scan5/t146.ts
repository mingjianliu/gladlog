/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents) */
/**
 * scan5/t146.ts — pipeline T146 (fact14 D5): the free-to-cast seconds of an
 * `[INACTIVITY]` line against the silence the log proves inside its gap.
 * Truth is read from the raw rows: the unit's presses the client refused as
 * silenced (SPELL_CAST_FAILED, `controlRejectKindOf` = silence). From one
 * such refusal to the next, with no cast of the unit going out between them,
 * the unit could not cast.
 *
 *  - `inactivityFreeWhileSilenced`: an `[INACTIVITY] N inactive Ls (Fs of it
 *    un-CC'd/free to cast)` line whose F is more than L minus that silenced
 *    time. Only the part certainly inside the gap is read — the line's
 *    second is the gap's start floored, so [S + 1, S + L] is inside whatever
 *    the fraction — and so the silenced time is a lower bound. Kind: `aura`
 *    when an enemy silence aura sat on the unit in that part (the product
 *    subtracts the aura), else `no aura` (Solar Beam: proven by the refusals
 *    alone). Counted: every [INACTIVITY] line.
 */
import { controlRejectKindOf } from "@gladlog/analysis/src/context/controlRejectedPresses";
import { isSilenceEffectAura } from "@gladlog/analysis/src/utils/cannotCastIntervals";

import {
  APPLIED,
  ev,
  fmtS,
  type IRoundCtx,
  REMOVED,
  secOf,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = ["inactivityFreeWhileSilenced"] as const;

const LINE_RE =
  /^(\d+:\d\d)\s+\[INACTIVITY\]\s+(\d+)\([^)]*\) inactive ([\d.]+)s \(([\d.]+)s of it un-CC'd\/free to cast\)/;
/** both numbers are printed to 0.1 s */
const PRINT_TOLERANCE_S = 0.1;
/** less proven silence than this is not judged */
const MIN_SILENCED_S = 0.5;

export function run(ctx: IRoundCtx): void {
  for (const l of ctx.lines) {
    const m = LINE_RE.exec(l);
    if (!m) continue;
    const u = ctx.unitOfPid(m[2]);
    if (!u) continue;
    const S = secOf(m[1]!);
    const L = Number(m[3]);
    const F = Number(m[4]);
    ctx.bump("inactivityFreeWhileSilenced");
    const from = S + 1;
    const to = S + L;
    const refusals = ctx
      .rawStreams()
      .castFailed.filter(
        (c) =>
          c.unitGuid === u.id &&
          c.tSeconds >= from &&
          c.tSeconds <= to &&
          controlRejectKindOf(c.reason) === "silence",
      )
      .map((c) => c.tSeconds)
      .sort((a, b) => a - b);
    if (refusals.length < 2) continue;
    const out = successesOf(u).map((c) => (tsOf(c) - ctx.start) / 1000);
    let silenced = 0;
    for (let i = 1; i < refusals.length; i++) {
      const a = refusals[i - 1]!;
      const b = refusals[i]!;
      if (!out.some((t) => a < t && t < b)) silenced += b - a;
    }
    if (silenced < MIN_SILENCED_S) continue;
    if (F <= L - silenced + PRINT_TOLERANCE_S) continue;
    const auras = ((u.auraEvents ?? []) as any[]).filter(
      (a) => a.destUnitId === u.id && isSilenceEffectAura(String(a.spellId)),
    );
    const underAura = auras.some((a, i) => {
      if (ev(a) !== APPLIED) return false;
      const on = (tsOf(a) - ctx.start) / 1000;
      const end = auras
        .slice(i + 1)
        .find((r) => ev(r) === REMOVED && r.spellId === a.spellId);
      const off = end ? (tsOf(end) - ctx.start) / 1000 : Infinity;
      return on <= to && off >= from;
    });
    ctx.violate(
      "inactivityFreeWhileSilenced",
      underAura ? "aura" : "no aura",
      ctx.start + S * 1000,
      `${u.id}:${S}`,
      `${m[1]} inactive ${L}s, ${F}s printed free: ${refusals.length} presses refused as silenced from ${fmtS(refusals[0]!)} to ${fmtS(refusals[refusals.length - 1]!)}, ${silenced.toFixed(1)}s between them with no cast out — at most ${(L - silenced).toFixed(1)}s free`,
      l,
    );
  }
}

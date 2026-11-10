/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents, spellCastEvents, damageOut) */
/**
 * scan5/t18.ts — pipeline T18 (GH #175 row 1): a buff a class set bonus
 * extends press by press — Recklessness under the Fury 12.1 2pc 1296645,
 * +2 s per landed Raging Blow / Crushing Blow while it is up, up to 6 s —
 * read at its flat length. 605 91b53e67 3:22: `[BUFF FADED] Recklessness
 * (expired, estimated)` at 3:40, 18 s after the press, while the warrior's
 * presses kept it up past the round's end at 3:42.
 *
 * Check `setExtendedFade`, on the owner's `[BUFF FADED] <aura>` lines for
 * an aura in `SET_BONUS_PER_EVENT_DURATIONS` when the owner wears the bonus
 * (`setBonusPerEventFor`, the product's own gate on gear and spec). The
 * line's application is the owner's latest self APPLIED of the aura at or
 * before the line's second, its end the next REMOVED. Truth, from the log
 * rows: the run's full length is the static length (`buffFullDurationForCaster`
 * with no application time — the talents and any flat set bonus, not the
 * per-press half this audits) plus `addSecondsPerEvent` for each qualifying
 * SPELL_CAST_SUCCESS by the owner whose hit landed (`pressLandedOn`, the one
 * reading of "a hit of this press") inside the window as it grows, up to
 * `capSeconds`. Kinds:
 *  - `estimatedBeforeEnd`: `(expired, estimated)` (no REMOVED) printed at a
 *    second before the run's full length ends.
 *  - `fullLengthMisread`: `ended after A of Bs` whose B is not the full
 *    length.
 *  - `shortRunReadExpired`: `(expired)` on a run the log ended more than
 *    1.5 s (the producer's early-end tolerance) before its full length.
 * Counted: every such line whose application is found (no REFRESH between
 * the APPLIED and the line).
 */
import {
  SET_BONUS_PER_EVENT_DURATIONS,
  setBonusPerEventFor,
} from "@gladlog/analysis/src/data/classSetBonuses";
import { dropAuraRebroadcasts } from "@gladlog/analysis/src/utils/auraIntervals";
import {
  buffFullDurationForCaster,
  ownAuraRunAt,
} from "@gladlog/analysis/src/utils/buffDuration";
import { pressLandedOn } from "@gladlog/analysis/src/utils/castMissRows";

import {
  ev,
  type IRoundCtx,
  nameOf,
  REFRESH,
  secOf,
  successesOf,
  tsOf,
} from "./ctx";
import { producerPressMs } from "./producerPress";

export const CHECKS = ["setExtendedFade"] as const;

const FADE_LINE = /^(\d+:\d\d)\s+\[BUFF FADED\]\s+(.+?) \((.+)\)\s*$/;
const ENDED_AFTER = /^ended after ([\d.]+) of ([\d.]+)s/;
/** `timelineHelpers.ts` BUFF_FADE_EARLY_TOLERANCE_S */
const EARLY_TOLERANCE_S = 1.5;

/** The run's full length from the log's rows (see the header). */
function fullLengthS(
  owner: any,
  auraId: string,
  appliedMs: number,
  staticS: number,
  /** the run's REMOVED: a press after it (in its ms, after it in log
   * order) extends nothing */
  removed?: any,
  /** the run's APPLIED: a press in its ms logged before it is not inside
   * the run (codex B25 #2) */
  applied?: any,
): number {
  const appliedLine: number | undefined = applied?.logLine?.lineIndex;
  const beforeRun = (c: any) => {
    const t = tsOf(c);
    if (t !== appliedMs) return t < appliedMs;
    const line = c.logLine?.lineIndex;
    return (
      appliedLine !== undefined && line !== undefined && line < appliedLine
    );
  };
  const removedMs = removed ? tsOf(removed) : Number.POSITIVE_INFINITY;
  const removedLine: number | undefined = removed?.logLine?.lineIndex;
  const afterRun = (c: any) => {
    const t = tsOf(c);
    if (t !== removedMs) return t > removedMs;
    const line = c.logLine?.lineIndex;
    return (
      removedLine !== undefined && line !== undefined && line > removedLine
    );
  };
  const r = SET_BONUS_PER_EVENT_DURATIONS[auraId]!;
  const casts = successesOf(owner).sort((a: any, b: any) => tsOf(a) - tsOf(b));
  const hitRows = [
    ...((owner.damageOut ?? []) as any[]),
    ...((owner.missesOut ?? []) as any[]).filter(
      (m) => m.missType === "ABSORB",
    ),
  ];
  let ext = 0;
  for (const c of casts) {
    const t = tsOf(c);
    if (beforeRun(c)) continue;
    if (t > appliedMs + (staticS + ext) * 1000 || afterRun(c)) break;
    const id = String(c.spellId ?? "");
    if (!r.qualifyingSpellIds.has(id)) continue;
    if (r.landedOnly && c.destUnitId) {
      const same = casts
        .filter((x: any) => String(x.spellId) === id)
        .map((x: any) => tsOf(x));
      if (
        !pressLandedOn(
          hitRows,
          id,
          c.spellName ?? "",
          same,
          t,
          String(c.destUnitId),
        )
      )
        continue;
    }
    ext = Math.min(r.capSeconds, ext + r.addSecondsPerEvent);
    if (ext >= r.capSeconds) break;
  }
  return staticS + ext;
}

export function run(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  if (!owner) return;
  const auras = Object.keys(SET_BONUS_PER_EVENT_DURATIONS).filter(
    (a) => setBonusPerEventFor(a, owner) !== undefined,
  );
  if (auras.length === 0) return;
  const byName = new Map(auras.map((a) => [nameOf(a, a), a]));
  for (const line of ctx.lines) {
    const m = FADE_LINE.exec(line);
    if (!m) continue;
    const auraId = byName.get(m[2]!.trim());
    if (!auraId) continue;
    const sec = secOf(m[1]!);
    // a REMOVED → APPLIED re-broadcast is one run (the producer's own
    // reading, `dropAuraRebroadcasts`; codex 85-tk-A-T18-1b #2)
    const rows = dropAuraRebroadcasts(
      ((owner.auraEvents ?? []) as any[]).filter(
        (a) =>
          String(a.spellId) === auraId &&
          a.srcUnitId === owner.id &&
          a.destUnitId === owner.id,
      ),
    ).sort((a, b) => tsOf(a) - tsOf(b));
    const secOfMs = (ms: number) => Math.floor((ms - ctx.start) / 1000);
    const estimated = m[3]!.startsWith("expired, estimated");
    // the press the producer printed this line for (codex 85-tk-A-T18-2
    // #1, -2b #2), and the run that press put up — the one its walk reads
    // (`ownAuraRunAt`; codex 85-tk-A-T18-2e #2: a later application in the
    // same second is the next press's run)
    const anchor = producerPressMs(ctx, owner, auraId, sec, estimated);
    if (anchor === undefined) continue;
    const run = ownAuraRunAt(owner, auraId, anchor);
    if (!run) continue;
    // a logged fade is its REMOVED's: judged only when that REMOVED ends the
    // press's run (a proc applied later in the same second is another run
    // — codex 85-tk-A-T18-1 #2)
    if (!estimated && !(run.to && secOfMs(tsOf(run.to)) === sec)) continue;
    const at = tsOf(run.from);
    const removed = run.to;
    const refreshed = rows.some(
      (a) =>
        ev(a) === REFRESH &&
        tsOf(a) > at &&
        (removed === undefined || tsOf(a) < tsOf(removed)),
    );
    if (refreshed) continue;
    const staticS = buffFullDurationForCaster(auraId, owner);
    if (staticS === undefined) continue;
    // the producer's expiry is its press + the full length: the run's length
    // is walked from its APPLIED, the end anchored at that press
    ctx.bump("setExtendedFade");
    const full = fullLengthS(owner, auraId, at, staticS, removed, run.from);
    const claim = m[3]!;
    if (estimated && removed && secOfMs(tsOf(removed)) <= sec) continue;
    const key = `${owner.name}:${auraId}:${at}`;
    if (claim.startsWith("expired, estimated")) {
      if (sec < secOfMs(anchor + full * 1000))
        ctx.violate(
          "setExtendedFade",
          "estimatedBeforeEnd",
          at,
          key,
          `estimated fade at ${m[1]} but the log's run is ${full} s from the ${secOfMs(anchor)} s press`,
          line,
        );
      continue;
    }
    const ended = ENDED_AFTER.exec(claim);
    if (ended) {
      if (Math.abs(Number(ended[2]) - full) > 0.05)
        ctx.violate(
          "setExtendedFade",
          "fullLengthMisread",
          at,
          key,
          `printed of ${ended[2]} s, the log's full length is ${full} s`,
          line,
        );
      continue;
    }
    if (
      claim.startsWith("expired") &&
      removed &&
      (tsOf(removed) - anchor) / 1000 < full - EARLY_TOLERANCE_S
    )
      ctx.violate(
        "setExtendedFade",
        "shortRunReadExpired",
        at,
        key,
        `ran ${((tsOf(removed) - anchor) / 1000).toFixed(1)} s from its press of a ${full} s run`,
        line,
      );
  }
}

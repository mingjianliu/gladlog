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
import { buffFullDurationForCaster } from "@gladlog/analysis/src/utils/buffDuration";
import { pressLandedOn } from "@gladlog/analysis/src/utils/castMissRows";

import {
  APPLIED,
  ev,
  type IRoundCtx,
  nameOf,
  REFRESH,
  REMOVED,
  secOf,
  successesOf,
  tsOf,
} from "./ctx";

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
): number {
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
    if (t < appliedMs) continue;
    if (t > appliedMs + (staticS + ext) * 1000) break;
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
    const rows = ((owner.auraEvents ?? []) as any[])
      .filter(
        (a) =>
          String(a.spellId) === auraId &&
          a.srcUnitId === owner.id &&
          a.destUnitId === owner.id,
      )
      .sort((a, b) => tsOf(a) - tsOf(b));
    const secOfMs = (ms: number) => Math.floor((ms - ctx.start) / 1000);
    const applied = rows
      .filter((a) => ev(a) === APPLIED && secOfMs(tsOf(a)) <= sec)
      .pop();
    if (!applied) continue;
    const at = tsOf(applied);
    const removed = rows.find((a) => ev(a) === REMOVED && tsOf(a) > at);
    const refreshed = rows.some(
      (a) =>
        ev(a) === REFRESH &&
        tsOf(a) > at &&
        (removed === undefined || tsOf(a) < tsOf(removed)),
    );
    if (refreshed) continue;
    const staticS = buffFullDurationForCaster(auraId, owner);
    if (staticS === undefined) continue;
    ctx.bump("setExtendedFade");
    const full = fullLengthS(owner, auraId, at, staticS);
    const claim = m[3]!;
    const key = `${owner.name}:${auraId}:${at}`;
    if (claim.startsWith("expired, estimated")) {
      if (sec < secOfMs(at + full * 1000))
        ctx.violate(
          "setExtendedFade",
          "estimatedBeforeEnd",
          at,
          key,
          `estimated fade at ${m[1]} but the log's run is ${full} s from ${secOfMs(at)} s`,
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
      (tsOf(removed) - at) / 1000 < full - EARLY_TOLERANCE_S
    )
      ctx.violate(
        "setExtendedFade",
        "shortRunReadExpired",
        at,
        key,
        `ran ${((tsOf(removed) - at) / 1000).toFixed(1)} s of a ${full} s run`,
        line,
      );
  }
}

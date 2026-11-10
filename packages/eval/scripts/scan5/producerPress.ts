/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, ledger casts) */
/**
 * scan5/producerPress.ts — no checks of its own: the press a `[BUFF FADED]`
 * line was printed for, by the producer's own pairing. Shared by t18
 * (`setExtendedFade`) and t35 (`setFadeWhileUp`) so both scans read one
 * line → press → run chain (codex B33 #2).
 */
import { extractOwnerCDBuffExpiry } from "@gladlog/analysis/src/context/timelineHelpers";
import { unitCooldownEntry } from "@gladlog/analysis/src/utils/cooldowns";

import type { IRoundCtx } from "./ctx";

/** The press the producer printed this fade line for, by its own pairing
 * (`extractOwnerCDBuffExpiry` on the owner's ledger entry, the call the
 * timeline makes). The scan audits the length the producer put after that
 * press, not which press a removal belongs to (codex 85-tk-A-T18-2b #2:
 * nearest-APPLIED pairing took a later press than the producer's).
 * Undefined when the producer has no such fade. */
export function producerPressMs(
  ctx: IRoundCtx,
  owner: any,
  auraId: string,
  sec: number,
  estimated: boolean,
  /** an estimated line printed at another length than the producer's own
   * (t35 audits base lines the unworn length printed): a press the
   * producer pairs with a removal after the line's second may have printed
   * that estimate, so only a removal at or before it rules the press out */
  opts: { keepLaterRemovals?: boolean } = {},
): number | undefined {
  let entry: any;
  try {
    entry = unitCooldownEntry(owner, ctx.legacy as never, auraId);
  } catch {
    entry = undefined;
  }
  if (!entry) return undefined;
  const startMs: number = ctx.legacy.startTime;
  const friends = ctx.players.filter((p) => p.reaction === owner.reaction);
  const enemies = ctx.players.filter((p) => p.reaction !== owner.reaction);
  const events = extractOwnerCDBuffExpiry(
    [entry],
    owner.id,
    friends,
    startMs,
    owner,
    enemies,
    ctx.roundEndAt,
  );
  const secOfMs = (ms: number) => Math.floor((ms - ctx.start) / 1000);
  // a logged fade: the press the producer paired that removal with (the
  // removal's second, which no length moves)
  if (!estimated) {
    const hit = events.find(
      (e) =>
        !e.isEstimated && secOfMs(startMs + e.expiresAtSeconds * 1000) === sec,
    );
    return hit === undefined ? undefined : startMs + hit.castAtSeconds * 1000;
  }
  // an estimated one: the latest ledger press before the line's second that the
  // producer did not pair with a removal — matched without any expiry, which
  // hangs on the length this scan audits (the unworn length's line printed
  // at 3:40 has no estimated event under the worn length, whose expiry falls
  // past the round's end)
  // (a press the round ended on — `round_end`, the producer's own estimate
  // or removal past the round's end — printed no fade and stays a candidate)
  const logged = new Set(
    events
      .filter(
        (e) =>
          !e.isEstimated &&
          e.cause !== "round_end" &&
          !(
            opts.keepLaterRemovals &&
            secOfMs(startMs + e.expiresAtSeconds * 1000) > sec
          ),
      )
      .map((e) => e.castAtSeconds),
  );
  const press = ((entry.casts ?? []) as Array<{ timeSeconds: number }>)
    .filter(
      (c) =>
        !logged.has(c.timeSeconds) &&
        // strictly before the line's second: a fade prints after its
        // press, and a later press inside that second is the next run's
        // (codex 85-tk-A-T18-2d #1)
        secOfMs(startMs + c.timeSeconds * 1000) < sec,
    )
    .sort((x, y) => x.timeSeconds - y.timeSeconds)
    .pop();
  return press === undefined ? undefined : startMs + press.timeSeconds * 1000;
}

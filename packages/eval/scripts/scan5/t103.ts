/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents, absorbsIn, spellCastEvents) */
/**
 * scan5/t103.ts — ticket T103: a `[BUFF FADED]` cause the log contradicts.
 *  - 0a13e993 r0 0:34 `Touch of Karma (expired; 666k absorbed)`: the absorb
 *    aura came off 0.78 s before its 10 s end, in the ms of a hit the shield
 *    took (an absorb row naming it) — used up.
 *  - 26c4ac25 r0 0:13 `Power Siphon (ended after 4.2 of 20s — no dispel
 *    logged)`: a one-stack charge buff removed 7 ms after the Demonbolt that
 *    spends it — its charge spent.
 *  - 77a6b63e r0 0:37 `Dispersion (expired)`: removed 0.8 s before its 6 s
 *    end — ended early, inside the 1.5 s early tolerance.
 *
 * The line's press and its removal are the producer's own pairing
 * (`extractOwnerCDBuffExpiry`, the event whose logged removal floors to the
 * line's second); the cause is judged from the log rows at that removal:
 *  - `absorbEmptiedReadExpired`: printed `expired…` while an absorb row on the
 *    holder names the press's spell, by the owner, in the removal's ms
 *    (± `AURA_REBROADCAST_GAP_MS`), and the removal is more than
 *    `JITTER_MS` before the press's full length ends.
 *  - `chargeSpentReadEarly`: printed `ended after` while the holder cast,
 *    ≤ `CHARGE_CAST_MS` before the removal, a spell that spent a dose of the
 *    same aura (a REMOVED_DOSE of it ≤ `CHARGE_CAST_MS` after that spell's
 *    cast, the only cast id in that window) anywhere in the round. A cast
 *    before the removal with no such dose seen is out of the total (`no
 *    spender seen`).
 *  - `earlyEndReadExpired`: printed `(expired)` / `(expired; …)` on a
 *    removal more than the slack (`JITTER_MS`, at most half the length, as
 *    the producer) before the full length ends. Only buffs the producer
 *    judges on length: no haste-length buff or channel (`runsWithHaste`), no
 *    charge's aura (`ENDS_WITH_ITS_CHARGE_IDS`). The length is the
 *    producer's: its run aura's (`buffFullDurationForCaster`). Kind = how
 *    early.
 *  - `fadeOffset` (all out of the total): every logged `expired` fade of a
 *    buff judged on length, its offset from the full length bucketed — the
 *    measured jitter behind `BUFF_FADE_EARLY_TOLERANCE_S`.
 */
import {
  BUFF_FADE_EARLY_TOLERANCE_S,
  ENDS_WITH_ITS_CHARGE_IDS,
  extractOwnerCDBuffExpiry,
  runsWithHaste,
} from "@gladlog/analysis/src/context/timelineHelpers";
import { ownEffectAurasOfCast } from "@gladlog/analysis/src/data/castEffectAuras";
import { AURA_REBROADCAST_GAP_MS } from "@gladlog/analysis/src/utils/auraRebroadcast";
import { buffFullDurationForCaster } from "@gladlog/analysis/src/utils/buffDuration";
import { unitCooldownEntry } from "@gladlog/analysis/src/utils/cooldowns";
import {
  TOUCH_OF_KARMA_ABSORB_ID,
  TOUCH_OF_KARMA_ID,
} from "@gladlog/analysis/src/utils/karmaFeed";

import {
  APPLIED,
  ev,
  type IRoundCtx,
  nameOf,
  REMOVED,
  secOf,
  SUCCESS,
  tsOf,
} from "./ctx";

export const CHECKS = [
  "absorbEmptiedReadExpired",
  "chargeSpentReadEarly",
  "earlyEndReadExpired",
  "fadeOffset",
] as const;

const BUCKETS = [
  "late >0.2s",
  "-0.2..0.05s",
  "0.05..0.2s",
  "0.2..0.5s",
  "0.5..1.0s",
  "1.0..1.5s",
] as const;
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "chargeSpentReadEarly|no spender seen",
  ...BUCKETS.map((b) => `fadeOffset|${b}`),
]);

const FADE_LINE = /^\s*(\d+:\d\d)\s+\[BUFF FADED\]\s+(.+?) \((.+)\)\s*$/;
/** a removal this far before the full length is no log jitter: the
 * producer's own measured slack (605 at PV547: 15,630 of 19,048 logged
 * `expired` fades sit −0.2…+0.05 s from the full length) */
const JITTER_MS = BUFF_FADE_EARLY_TOLERANCE_S * 1000;
const CHARGE_CAST_MS = 100;
const REMOVED_DOSE = "SPELL_AURA_REMOVED_DOSE";

const bucketOf = (earlyMs: number): (typeof BUCKETS)[number] =>
  earlyMs < -200
    ? "late >0.2s"
    : earlyMs <= 50
      ? "-0.2..0.05s"
      : earlyMs <= 200
        ? "0.05..0.2s"
        : earlyMs <= 500
          ? "0.2..0.5s"
          : earlyMs <= 1000
            ? "0.5..1.0s"
            : "1.0..1.5s";

export function run(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  if (!owner) return;
  const startMs: number = ctx.legacy.startTime;
  const friends = ctx.players.filter((p) => p.reaction === owner.reaction);
  const enemies = ctx.players.filter((p) => p.reaction !== owner.reaction);
  const castIds = [
    ...new Set(
      ((owner.spellCastEvents ?? []) as any[])
        .filter((c) => ev(c) === SUCCESS)
        .map((c) => String(c.spellId ?? "")),
    ),
  ];
  const eventsOf = new Map<string, any[]>();
  const events = (id: string): any[] => {
    let out = eventsOf.get(id);
    if (out) return out;
    let entry: any;
    try {
      entry = unitCooldownEntry(owner, ctx.legacy as never, id);
    } catch {
      entry = undefined;
    }
    out = entry
      ? extractOwnerCDBuffExpiry(
          [entry],
          owner.id,
          friends,
          startMs,
          owner,
          enemies,
          ctx.roundEndAt,
        )
      : [];
    eventsOf.set(id, out);
    return out;
  };
  const secOfMs = (ms: number) => Math.floor((ms - ctx.start) / 1000);
  for (const line of ctx.lines) {
    const m = FADE_LINE.exec(line);
    if (!m) continue;
    const sec = secOf(m[1]!);
    const name = m[2]!.trim();
    const claim = m[3]!;
    if (claim.startsWith("expired, estimated")) continue;
    let hit: { id: string; e: any } | undefined;
    for (const id of castIds) {
      if (nameOf(id, "") !== name) continue;
      const e = events(id).find(
        (x) =>
          !x.isEstimated &&
          x.cause !== "round_end" &&
          secOfMs(startMs + x.expiresAtSeconds * 1000) === sec,
      );
      if (e) {
        hit = { id: e.spellId ?? id, e };
        break;
      }
    }
    if (!hit) continue;
    const { id, e } = hit;
    const removedMs = Math.round(startMs + e.expiresAtSeconds * 1000);
    const castMs = Math.round(startMs + e.castAtSeconds * 1000);
    const auraIds = new Set([
      id,
      ...ownEffectAurasOfCast(id),
      ...(id === TOUCH_OF_KARMA_ID ? [TOUCH_OF_KARMA_ABSORB_ID] : []),
    ]);
    let auraId: string | undefined;
    const holder = friends.find((f) =>
      ((f.auraEvents ?? []) as any[]).some((a) => {
        const ok =
          ev(a) === REMOVED &&
          a.srcUnitId === owner.id &&
          auraIds.has(String(a.spellId)) &&
          Math.round(tsOf(a)) === removedMs;
        if (ok) auraId = String(a.spellId);
        return ok;
      }),
    );
    if (!holder || !auraId) continue;
    // the producer's length: its run aura's (the cast's own id when the log
    // shows it from the owner, else its effect aura), else the cast's
    const seen = (x: string) =>
      friends.some((f) =>
        ((f.auraEvents ?? []) as any[]).some(
          (a) =>
            String(a.spellId) === x &&
            a.srcUnitId === owner.id &&
            a.auraType !== "DEBUFF" &&
            (ev(a) === APPLIED || ev(a) === REMOVED),
        ),
      );
    const runAura = seen(id) ? id : (ownEffectAurasOfCast(id).find(seen) ?? id);
    const fullS =
      buffFullDurationForCaster(runAura, owner, castMs) ??
      buffFullDurationForCaster(id, owner, castMs);
    if (!fullS) continue;
    const earlyMs = castMs + fullS * 1000 - removedMs;
    const key = `${holder.id}:${id}:${castMs}`;
    const expired = claim.startsWith("expired");
    // judged on length only where the producer judges length: not a
    // haste-length buff or channel, not a charge's aura
    const byLength = !runsWithHaste(id) && !ENDS_WITH_ITS_CHARGE_IDS.has(id);
    const slackMs = Math.min(JITTER_MS, (fullS * 1000) / 2);

    if (expired && byLength) {
      ctx.bump("fadeOffset");
      ctx.violate(
        "fadeOffset",
        bucketOf(earlyMs),
        removedMs,
        `${id}:${bucketOf(earlyMs)}`,
        `${name} removed ${(earlyMs / 1000).toFixed(2)} s before its ${fullS} s`,
        line.trim(),
      );
    }

    // used up by a hit in the removal's ms
    if (expired) {
      ctx.bump("absorbEmptiedReadExpired");
      const emptied = ((holder.absorbsIn ?? []) as any[]).some(
        (x) =>
          String(x.spellId) === id &&
          x.srcUnitId === owner.id &&
          Math.abs(tsOf(x) - removedMs) <= AURA_REBROADCAST_GAP_MS,
      );
      if (emptied && earlyMs > slackMs)
        ctx.violate(
          "absorbEmptiedReadExpired",
          name,
          removedMs,
          key,
          `${name} removed ${(earlyMs / 1000).toFixed(2)} s early in the ms of a hit it absorbed`,
          line.trim(),
        );
    }

    // a charge buff spent by its spender
    if (claim.startsWith("ended after")) {
      ctx.bump("chargeSpentReadEarly");
      const casts = ((holder.spellCastEvents ?? []) as any[]).filter(
        (c) => ev(c) === SUCCESS,
      );
      const castsBefore = (ms: number) =>
        casts
          .filter((c) => tsOf(c) <= ms && ms - tsOf(c) <= CHARGE_CAST_MS)
          .map((c) => String(c.spellId ?? ""));
      const spenders = new Set(
        ((holder.auraEvents ?? []) as any[])
          .filter(
            (a) =>
              ev(a) === REMOVED_DOSE &&
              String(a.spellId) === auraId &&
              a.srcUnitId === owner.id,
          )
          // a dose row with one cast id in its window names its spender;
          // a coincident cast is no evidence (codex 85-tk-L-T103-1 #2)
          .flatMap((a) => {
            const ids = new Set(castsBefore(tsOf(a)).filter((x) => x));
            return ids.size === 1 ? [...ids] : [];
          }),
      );
      const finals = castsBefore(removedMs).filter((x) => x);
      const spent = finals.find((x) => spenders.has(x));
      if (spent)
        ctx.violate(
          "chargeSpentReadEarly",
          name,
          removedMs,
          key,
          `${name} removed ${removedMs - Math.max(...casts.filter((c) => String(c.spellId) === spent && tsOf(c) <= removedMs).map(tsOf))} ms after ${nameOf(spent, spent)}, which spends its doses`,
          line.trim(),
        );
      else if (finals.length > 0)
        ctx.violate(
          "chargeSpentReadEarly",
          "no spender seen",
          removedMs,
          key,
          `${name} removed after ${finals.map((x) => nameOf(x, x)).join(", ")}; no dose of it spent this round`,
          line.trim(),
        );
    }

    // an early end inside the tolerance
    if (byLength && /^expired(;|$)/.test(claim)) {
      ctx.bump("earlyEndReadExpired");
      if (earlyMs > slackMs)
        ctx.violate(
          "earlyEndReadExpired",
          bucketOf(earlyMs),
          removedMs,
          key,
          `${name} removed ${(earlyMs / 1000).toFixed(2)} s before its ${fullS} s`,
          line.trim(),
        );
    }
  }
}

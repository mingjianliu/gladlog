/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, spellCastEvents) */
/**
 * scan5/t106.ts — ticket T106 (fact13 D14, ruling R40: Feign Death is a
 * defensive; a defenseless span cannot hold while it is ready).
 *
 *  - `feignReadyInSpan`: a `[KILL WINDOW] … (defenseless a–b)` or
 *    `[VULNERABLE] a–b … no major defensives` span on an enemy Hunter. Its
 *    Feign Death (5384, every hunter's baseline) readiness comes from the
 *    shared cooldown model (`unitCooldownEntry` → `entryAvailabilityTransitions`:
 *    the hunter's own presses, its talents' cooldown); cooldown timing is not
 *    the fact under audit, the span's membership is. Each span is one checked
 *    item; it is a violation when Feign Death was ready for one whole rendered
 *    second or more inside it (5e61152f r0: `defenseless 2:05–2:15`, Feign
 *    Death pressed 1:41.57 on a 20 s cooldown, back ~2:01.6, pressed again
 *    2:15.6). Population: every enemy hunter. One the ledger saw press it
 *    this round is read through its presses; one that never pressed it and
 *    owns it at its spec's DB2 baseline (`kwAuraReadUnpressedInHand`, the
 *    producer's own reading — codex 85-tk-K-T106-1 #1) holds it all round.
 *    Kind = `afterReturn` (pressed earlier this round) / `beforeFirstPress` /
 *    `neverPressed`. The rendered span is floored on both ends, so only
 *    [a + 1, b] is surely inside it (codex 85-tk-K-T106-1 #3: a span that
 *    ended at the cooldown's return on a whole second read b + 1).
 */
import {
  entryAvailabilityTransitions,
  unitCooldownEntry,
} from "@gladlog/analysis/src/utils/cooldowns";
import { kwAuraReadUnpressedInHand } from "@gladlog/analysis/src/utils/kwAuraReadPresses";
import { CombatUnitClass } from "@gladlog/parser-compat";

import { fmtS, type IRoundCtx, secOf } from "./ctx";

export const CHECKS = ["feignReadyInSpan"] as const;

const FEIGN_DEATH = "5384";
const SPAN =
  /^\s+\[(KILL WINDOW|VULNERABLE)\] (\d+:\d\d)–(\d+:\d\d) on [^(]+\(([^)]+)\)(.*)$/;

/** Feign Death's ready stretches of `u` in round seconds, from the shared
 * cooldown model; available from the round's start until its first press */
export function feignReadyStretches(
  u: any,
  legacy: any,
  roundS: number,
): Array<{ from: number; to: number }> | undefined {
  let entry: any;
  try {
    entry = unitCooldownEntry(u, legacy, FEIGN_DEATH);
  } catch {
    entry = undefined;
  }
  if (!entry || entry.casts.length === 0) return undefined;
  const out: Array<{ from: number; to: number }> = [];
  let readyFrom: number | undefined = 0;
  for (const f of entryAvailabilityTransitions(entry, roundS).sort(
    (a, b) => a.atSeconds - b.atSeconds,
  )) {
    if (f.available) readyFrom ??= f.atSeconds;
    else if (readyFrom !== undefined) {
      out.push({ from: readyFrom, to: f.atSeconds });
      readyFrom = undefined;
    }
  }
  if (readyFrom !== undefined) out.push({ from: readyFrom, to: roundS });
  return out;
}

export function run(ctx: IRoundCtx): void {
  const C = "feignReadyInSpan";
  if (!ctx.owner) return;
  const roundS = (ctx.roundEndAt - ctx.start) / 1000;
  const memo = new Map<
    string,
    Array<{ from: number; to: number; never?: boolean }> | undefined
  >();
  for (const l of ctx.lines) {
    const m = SPAN.exec(l);
    if (!m) continue;
    const dl = /\(defenseless (\d+:\d\d)–(\d+:\d\d)\)/.exec(m[5]!);
    let a: number;
    let b: number;
    if (dl) {
      a = secOf(dl[1]!);
      b = secOf(dl[2]!);
    } else if (m[1] === "VULNERABLE" && /no major defensives/.test(m[5]!)) {
      a = secOf(m[2]!);
      b = secOf(m[3]!);
    } else continue;
    const u = ctx.players.find((p) => p.name === m[4]);
    if (!u || u.class !== CombatUnitClass.Hunter) continue;
    if (u.reaction === ctx.owner.reaction) continue;
    if (!memo.has(u.id))
      memo.set(
        u.id,
        feignReadyStretches(u, ctx.legacy, roundS) ??
          (kwAuraReadUnpressedInHand(u, ctx.legacy, roundS).includes(
            FEIGN_DEATH,
          )
            ? [{ from: 0, to: Infinity, never: true }]
            : undefined),
      );
    const ready = memo.get(u.id);
    if (!ready) continue;
    ctx.bump(C);
    // the span is printed floored: only [a + 1, b] is surely inside it
    const hit = ready.find(
      (r) => Math.min(b, r.to) - Math.max(a + 1, r.from) >= 1,
    );
    if (!hit) continue;
    ctx.violate(
      C,
      hit.never
        ? "neverPressed"
        : hit.from > 0
          ? "afterReturn"
          : "beforeFirstPress",
      ctx.start + Math.max(a, hit.from) * 1000,
      `${u.id}#${a}#${b}`,
      `${u.name} defenseless ${fmtS(a)}–${fmtS(b)} while Feign Death was ready ${hit.never ? "all round (never pressed)" : `${fmtS(hit.from)}–${fmtS(hit.to)}`}`,
      l.trim().slice(0, 300),
    );
  }
}

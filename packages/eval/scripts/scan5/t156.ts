/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents) */
/**
 * scan5/t156.ts — ticket T156 (fact14 D16 / D34, r13 P5): the Anti-Magic
 * Shell that goes on the knight or an ally (410358) is the kill-window
 * roster's Anti-Magic Shell too.
 *
 *  - `amsInDefenselessSpan`: a `[KILL WINDOW] … (defenseless a–b)` or
 *    `[VULNERABLE] a–b … no major defensives` span on an enemy that pressed
 *    410358 this round. Each span is one checked item. Kinds:
 *      `ready` — the shield was ready for one whole rendered second or more
 *        inside the span, by the shared cooldown model (`unitCooldownEntry` →
 *        `entryAvailabilityTransitions`: the unit's own presses and talents;
 *        cooldown timing is not the fact under audit, the span's membership
 *        is) — 7669df4d r0: `defenseless 2:40–3:00`, pressed 2:05.5 and again
 *        2:51.6 on a 30 s cooldown;
 *      `up` — its own 410358 aura (the unit's press on itself) ran one whole
 *        second or more inside the span, from the log's aura rows.
 *    The rendered span is floored on both ends: only [a + 1, b] is surely
 *    inside it.
 *  - `burstAmsNotNamed`: a burst-ledger block whose target carried a 410358
 *    aura from its own side for one whole second or more inside the burst's
 *    printed span [a + 1, b] (the ledger's own floor is
 *    `MIN_DEFENSIVE_OVERLAP_S`, 0.5 s) and that does not name Anti-Magic
 *    Shell. Counted: every block whose target carried one at all in the
 *    round.
 */
import {
  entryAvailabilityTransitions,
  unitCooldownEntry,
} from "@gladlog/analysis/src/utils/cooldowns";

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

export const CHECKS = ["amsInDefenselessSpan", "burstAmsNotNamed"] as const;

const AMS = "410358";
const AMS_NAME = "Anti-Magic Shell";
const SPAN =
  /^\s+\[(KILL WINDOW|VULNERABLE)\] (\d+:\d\d)–(\d+:\d\d)(?: \(\d+s\))? on [^(]+\(([^)]+)\)(.*)$/;
const DEFENSELESS = /(?:\(|; target )defenseless (\d+:\d\d)–(\d+:\d\d)/;
const BURST = /^\s+Burst #\d+ — (\d+:\d\d)–(\d+:\d\d) \|/;
const TARGET = /^\s+Target: (\S+) /;

type Stretch = { from: number; to: number };

/** the shield's ready stretches of `u` in round seconds, from the shared
 * cooldown model; ready from the round's start until its first press */
function readyStretches(u: any, legacy: any, roundS: number): Stretch[] {
  let entry: any;
  try {
    entry = unitCooldownEntry(u, legacy, AMS);
  } catch {
    entry = undefined;
  }
  if (!entry || entry.casts.length === 0) return [];
  const out: Stretch[] = [];
  let readyFrom: number | undefined = 0;
  for (const f of entryAvailabilityTransitions(entry, roundS).sort(
    (a: any, b: any) => a.atSeconds - b.atSeconds,
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

/** the 410358 aura's runs on `u` in round seconds, from sources `from` */
function auraRuns(
  u: any,
  from: (srcId: string) => boolean,
  start: number,
  roundS: number,
): Stretch[] {
  const out: Stretch[] = [];
  const open = new Map<string, number>();
  for (const a of ((u.auraEvents ?? []) as any[])
    .filter((x) => String(x.spellId) === AMS && from(x.srcUnitId))
    .sort((x, y) => tsOf(x) - tsOf(y))) {
    const t = (tsOf(a) - start) / 1000;
    if (ev(a) === APPLIED) {
      if (!open.has(a.srcUnitId)) open.set(a.srcUnitId, t);
    } else if (ev(a) === REMOVED && open.has(a.srcUnitId)) {
      out.push({ from: open.get(a.srcUnitId)!, to: t });
      open.delete(a.srcUnitId);
    }
  }
  for (const f of open.values()) out.push({ from: f, to: roundS });
  return out;
}

/** a stretch that covers one whole second or more of [a + 1, b] */
const insideOf = (rs: Stretch[], a: number, b: number): Stretch | undefined =>
  rs.find((r) => Math.min(b, r.to) - Math.max(a + 1, r.from) >= 1);

export function run(ctx: IRoundCtx): void {
  if (!ctx.owner) return;
  const roundS = (ctx.roundEndAt - ctx.start) / 1000;
  const enemies = ctx.players.filter(
    (p: any) => p.reaction !== ctx.owner.reaction,
  );
  const pressed = new Set<string>(
    enemies
      .filter((u: any) =>
        successesOf(u).some(
          (c) =>
            String(c.spellId) === AMS &&
            tsOf(c) >= ctx.start &&
            tsOf(c) < ctx.roundEndAt,
        ),
      )
      .map((u: any) => u.id),
  );

  for (const l of ctx.lines) {
    const m = SPAN.exec(l);
    if (!m) continue;
    const dl = DEFENSELESS.exec(m[5]!);
    let a: number;
    let b: number;
    if (dl) {
      a = secOf(dl[1]!);
      b = secOf(dl[2]!);
    } else if (m[1] === "VULNERABLE" && /no major defensives/.test(m[5]!)) {
      a = secOf(m[2]!);
      b = secOf(m[3]!);
    } else continue;
    const u = enemies.find((p: any) => p.name === m[4]);
    if (!u || !pressed.has(u.id)) continue;
    ctx.bump("amsInDefenselessSpan");
    const up = insideOf(
      auraRuns(u, (src) => src === u.id, ctx.start, roundS),
      a,
      b,
    );
    const ready = insideOf(readyStretches(u, ctx.legacy, roundS), a, b);
    const hit = up ?? ready;
    if (!hit) continue;
    ctx.violate(
      "amsInDefenselessSpan",
      up ? "up" : "ready",
      ctx.start + Math.max(a, hit.from) * 1000,
      `${u.id}#${a}#${b}`,
      `${u.name} defenseless ${fmtS(a)}–${fmtS(b)} while ${AMS_NAME} was ${up ? "up" : "ready"} ${fmtS(hit.from)}–${fmtS(hit.to)}`,
      l.trim().slice(0, 300),
    );
  }

  const side = new Set<string>(enemies.map((u: any) => u.id));
  for (let i = 0; i < ctx.lines.length; i++) {
    const h = BURST.exec(ctx.lines[i]!);
    if (!h) continue;
    const block: string[] = [];
    for (let j = i + 1; j < ctx.lines.length; j++) {
      const x = ctx.lines[j]!;
      if (BURST.test(x) || !/^\s{4}\S/.test(x)) break;
      block.push(x);
    }
    const t = block.map((x) => TARGET.exec(x)).find((x) => x);
    const target = t && enemies.find((p: any) => p.name === t[1]);
    if (!target) continue;
    const runs = auraRuns(target, (src) => side.has(src), ctx.start, roundS);
    if (runs.length === 0) continue;
    ctx.bump("burstAmsNotNamed");
    const a = secOf(h[1]!);
    const b = secOf(h[2]!);
    const hit = insideOf(runs, a, b);
    if (!hit || block.some((x) => x.includes(AMS_NAME))) continue;
    ctx.violate(
      "burstAmsNotNamed",
      "notNamed",
      ctx.start + Math.max(a, hit.from) * 1000,
      `${target.id}#${a}#${b}`,
      `${target.name} carried ${AMS_NAME} ${fmtS(hit.from)}–${fmtS(hit.to)} inside the burst ${fmtS(a)}–${fmtS(b)}`,
      ctx.lines[i]!.trim().slice(0, 300),
    );
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units) */
/**
 * scan5/t165.ts — ticket T165 (round 14 D17 / D25, user ruling A17): a break
 * ability that is also a wall or a self-save (Icebound Fortitude, Lichborne)
 * and removed a control of a kill attempt files that attempt as `broke out`,
 * the legend's order — not as the wall it also is.
 *
 * `breakWallNotBrokeOut`: every pair of a KILL ATTEMPTS line `[a–b] on T — …
 * FAILED: X` and the page's own `[ENEMY TRINKET] T used <ability> out of <CC>`
 * line (the break binder's rendering) whose second is inside the bracket
 * (a ≤ s ≤ b + 1: the control it removed was on T inside the bracket). A
 * violation when X is neither `broke out (…)` nor `target trinketed out`.
 * Kind = the ability. A break in the rest of the credit window (the next 5 s)
 * is counted apart, out of the total: its control may have begun after the
 * bracket, which the line does not say. So is a break whose cast row is
 * before the press that opens a burst-anchored bracket, in the bracket's
 * first printed second: the producer reads the bracket by the millisecond
 * (716c3c3a r2 2:29: Lichborne 58 ms before the Dark Harvest that opens
 * `[2:29–2:31]`, its Howl of Terror already off). So is a break of a control
 * that began in the bracket's last printed second or later (codex
 * 85-tk-WIN-T165-1; the control and its start are the product's own binding,
 * `breakAbilityUses[].brokenCc` — review -2): the producer asks whether the control it removed
 * overlapped the attempt by the millisecond (`ofThisAttempt`), and the page
 * prints the bracket's end by the second — a Fear that landed 0.4 s after the
 * attempt ended is no control of it.
 */
import {
  AURA_KEYED_BREAK_RACIALS,
  CC_BREAK_CAST_IDS,
} from "@gladlog/analysis/src/data/ccBreakAbilities";
import { analyzePlayerCCAndTrinket } from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import {
  MITIGATION_AURA_IDS,
  SELF_SAVE_IDS,
} from "@gladlog/analysis/src/utils/enemyDefensives";
import type {
  AtomicArenaCombat,
  ICombatUnit,
} from "@gladlog/parser-compat";

import { type IRoundCtx, nameOf, secOf,
  successesOf,
  tsOf,
} from "./ctx";

const C = "breakWallNotBrokeOut";
export const CHECKS = [C] as const;
const LATER = "in the 5 s after the bracket";
const BEFORE = "before the bracket's opening press";
const LATE_CC = "its control began in the bracket's last second or later";
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  `${C}|${LATER}`,
  `${C}|${BEFORE}`,
  `${C}|${LATE_CC}`,
]);
const BURST = / — (.+?) burst \(no stun\)/;

const ATTEMPT = /^ {2}\[(\d+:\d{2})–(\d+:\d{2})\] on (\S+) — .*\| FAILED: (.*)$/;
const BREAK =
  /^\s*(\d+:\d{2})\s+\[ENEMY TRINKET\]\s+(\d+)\([^)]*\) used (.+?) out of (.+?) \(by /;
const CREDIT_S = 5;

/** The start (ms) of the control the product bound to `unit`'s break
 * `name` pressed in printed second `s` — undefined when it bound none. */
function brokenCcStartMs(
  ctx: IRoundCtx,
  unit: any,
  name: string,
  s: number,
): number | undefined {
  const players = ctx.players as ICombatUnit[];
  const opponents = players.filter((o) => o.reaction !== unit.reaction);
  const oppIds = new Set(opponents.map((o) => o.id));
  const use = analyzePlayerCCAndTrinket(
    unit,
    opponents,
    ctx.legacy as AtomicArenaCombat,
    (ctx.units as ICombatUnit[]).filter(
      (u) => u.ownerId && oppIds.has(u.ownerId),
    ),
  ).breakAbilityUses?.find(
    (u) => u.name === name && Math.floor(u.atSeconds) === s && u.brokenCc,
  );
  return use?.brokenCc
    ? ctx.start + use.brokenCc.atSeconds * 1000
    : undefined;
}

export function run(ctx: IRoundCtx): void {
  const names = new Set(
    [...CC_BREAK_CAST_IDS, ...Object.keys(AURA_KEYED_BREAK_RACIALS)]
      .filter((id) => MITIGATION_AURA_IDS.has(id) || SELF_SAVE_IDS.has(id))
      .map((id) => nameOf(id, id)),
  );
  const breaks: Array<{ s: number; unit: string; name: string; cc: string }> =
    [];
  for (const l of ctx.lines) {
    const m = BREAK.exec(l);
    if (m && names.has(m[3]!))
      breaks.push({
        s: secOf(m[1]!),
        unit: (ctx.unitOfPid(m[2]) as any)?.name ?? "",
        name: m[3]!,
        cc: m[4]!,
      });
  }
  if (breaks.length === 0) return;
  for (const l of ctx.lines) {
    const m = ATTEMPT.exec(l);
    if (!m) continue;
    const a = secOf(m[1]!);
    const b = secOf(m[2]!);
    for (const br of breaks) {
      if (br.unit !== m[3] || br.s < a || br.s > b + CREDIT_S) continue;
      const inside = br.s <= b + 1;
      if (inside) ctx.bump(C);
      if (/^(broke out \(|target trinketed out)/.test(m[4]!)) continue;
      // the bracket of a burst-anchored line opens at its press, not at the
      // top of its second
      const burst = BURST.exec(l)?.[1];
      const lo = ctx.start + a * 1000;
      const inFirstS = (c: any) => tsOf(c) >= lo && tsOf(c) < lo + 1000;
      const named = (c: any, n: string) =>
        nameOf(String(c.spellId), c.spellName ?? "") === n;
      const target = ctx.byName.get(m[3]!);
      const breakMs =
        br.s === a && target
          ? successesOf(target).find((c: any) => inFirstS(c) && named(c, br.name))
          : undefined;
      const openMs = burst
        ? Math.min(
            Infinity,
            ...(ctx.players as any[])
              .filter((p) => p.reaction !== target?.reaction)
              .flatMap((p) => successesOf(p))
              .filter((c: any) => inFirstS(c) && named(c, burst))
              .map(tsOf),
          )
        : Infinity;
      const before =
        breakMs !== undefined && Number.isFinite(openMs) && tsOf(breakMs) < openMs;
      // when the removed control went onto the target — the PRODUCT's
      // binder (`breakAbilityUses[].brokenCc`, which starts a new control
      // at a cast-backed refresh), not this file's pairing of aura rows
      // (codex 85-tk-WIN-T165-2 #1)
      const on = target
        ? brokenCcStartMs(ctx, target, br.name, br.s)
        : undefined;
      // not the attempt's own opener. A one-second bracket too: the page
      // prints its end by the second, the producer reads it by the
      // millisecond, so a control that began in that second is not known
      // to be the attempt's (codex 85-tk-WIN-T165-2 #2)
      const lateCc =
        inside &&
        on !== undefined &&
        on >= ctx.start + b * 1000 &&
        !l.includes(`— ${br.cc} opener`);
      ctx.violate(
        C,
        before ? BEFORE : lateCc ? LATE_CC : inside ? br.name : LATER,
        ctx.start + br.s * 1000,
        `${m[3]}#${m[1]}#${br.name}#${br.s}`,
        `${m[3]} [${m[1]}–${m[2]}]: ${br.name} broke a control at ${br.s}s, filed ${m[4]!.slice(0, 60)}`,
        l.slice(0, 240),
      );
    }
  }
}

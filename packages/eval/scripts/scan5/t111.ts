/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units) */
/**
 * scan5/t111.ts — ticket T111 (fact13 D2/D19, user ruling R47 2026-11-15,
 * option A): a cooldown its holder's spec passive scales by haste (DB2 aura
 * 416, the producer's own `hasteScaledCooldownIds` — Pierce the Veil for
 * Devourer, Avenger's Shield / Consecration / Execution Sentence for
 * Protection and Holy, Blackout Kick for Mistweaver, …) is back sooner than
 * its unhasted base, by an amount the log does not state. No line may print
 * an exact return for it.
 *
 *  - `hasteScaledExactBack`: each line that prices one of those spells for a
 *    holder of that spec is one checked item; a violation when it prints an
 *    exact return. Kind:
 *    - `press`: a `[PRESS]` line of the holder naming the spell, with
 *      `back m:ss` (owner `[YOU] [PRESS]   X (…)`, others `[PRESS]   N(…)
 *      (Spec): X (…)`);
 *    - `kick`: a `[KICK]` line whose kicker (an enemy, `N(…) interrupted`)
 *      used the spell, with `; back m:ss`;
 *    - `res`: a `[RES]` `cd:` entry of the holder (`X(…)` for the owner,
 *      `N:X(…)` for a teammate) whose remaining is not `≤Ns`.
 */
import {
  parseResRow,
  splitResList,
} from "@gladlog/analysis/src/context/resRow";
import { hasteScaledCooldownIds } from "@gladlog/analysis/src/data/hasteScaledCooldowns";

import { type IRoundCtx, nameOf } from "./ctx";

export const CHECKS = ["hasteScaledExactBack"] as const;

const PRESS =
  /^\s*\d+:\d\d\s+(?:\[YOU\] \[PRESS\]\s+(.+?) \((.*)\)$|\[PRESS\]\s+(\d+)\([^)]*\) \([^)]*\): (.+?) \((.*)\)$)/;
const KICK =
  /^\s*\d+:\d\d\s+\[KICK\]\s+(\d+)\([^)]*\) interrupted .*\(([^;()]+)(?:; ([^()]*))?\)$/;
const CD_ENTRY = /^(?:(\d+):)?(.+?)\((.*)\)(?:\[[^\]]*\])?$/;
const BACK = /\bback \d+:\d\d\b/;

export function run(ctx: IRoundCtx): void {
  const C = "hasteScaledExactBack";
  if (!ctx.owner) return;
  const namesOf = new Map<any, Set<string>>();
  const hasteNames = (u: any): Set<string> => {
    let s = namesOf.get(u);
    if (!s) {
      s = new Set(
        [...hasteScaledCooldownIds(u?.spec)].map((id) => nameOf(id, id)),
      );
      namesOf.set(u, s);
    }
    return s;
  };
  ctx.lines.forEach((l, i) => {
    const p = PRESS.exec(l);
    if (p) {
      const u = p[1] !== undefined ? ctx.owner : ctx.unitOfPid(p[3]);
      const name = p[1] ?? p[4]!;
      if (!u || !hasteNames(u).has(name)) return;
      ctx.bump(C);
      if (BACK.test(p[2] ?? p[5]!))
        ctx.violate(
          C,
          "press",
          ctx.start,
          `press#${i}`,
          `${u.name}: ${name} is haste-scaled for its spec; the [PRESS] line prints an exact back`,
          l.trim().slice(0, 300),
        );
      return;
    }
    const k = KICK.exec(l);
    if (k) {
      const u = ctx.unitOfPid(k[1]);
      if (!u || !hasteNames(u).has(k[2]!.trim())) return;
      ctx.bump(C);
      if (k[3] !== undefined && BACK.test(k[3]))
        ctx.violate(
          C,
          "kick",
          ctx.start,
          `kick#${i}`,
          `${u.name}: ${k[2]} is haste-scaled for its spec; the [KICK] line prints an exact back`,
          l.trim().slice(0, 300),
        );
      return;
    }
    const r = parseResRow(l);
    if (!r || !r.cd || r.cd === "—") return;
    for (const entry of splitResList(r.cd)) {
      const m = CD_ENTRY.exec(entry.trim());
      if (!m) continue;
      const u = m[1] !== undefined ? ctx.unitOfPid(m[1]) : ctx.owner;
      if (!u || !hasteNames(u).has(m[2]!)) continue;
      ctx.bump(C);
      if (!m[3]!.startsWith("≤"))
        ctx.violate(
          C,
          "res",
          ctx.start,
          `res#${i}#${entry}`,
          `${u.name}: ${m[2]} is haste-scaled for its spec; the [RES] cd entry reads an exact remaining (${m[3]})`,
          l.trim().slice(0, 300),
        );
    }
  });
}

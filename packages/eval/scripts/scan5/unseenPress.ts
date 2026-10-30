/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents) */
/**
 * scan5/unseenPress.ts — class 1 of the round-7 audit (fact7 F21, D34 / D35 /
 * D41 / D56): a `[pressed while unseen]` line printed for a re-listing of an
 * aura that never went down. A Feral's Incarnation applies 102543 and 252071;
 * Prowl removes 252071, and the batch that re-states the druid then re-lists
 * the running 102543 as APPLIED — read as a press the log never had.
 *
 * Log truth, rows only (the same-named self auras of the printed spell on the
 * printed unit, whichever ids they are):
 *  - the batch row = the first APPLIED of such an aura in the printed second;
 *  - `stillUp`: at that row another run of ANY of those auras was up: its last
 *    row before the batch is an APPLIED / REFRESH, no REMOVED after it, and
 *    its official length + 1 s has not run out (a run whose REMOVED the log
 *    lost is not up for ever).
 *
 * Kinds split `sameId` (the aura's own id was up — a re-listing outright) from
 * `sibling` (only a same-named other id was).
 */
import {
  getEnglishSpellName,
  spellEffectData,
} from "@gladlog/analysis/src/data/spellEffectData";

import { APPLIED, ev, type IRoundCtx, REFRESH, REMOVED, tsOf } from "./ctx";

export const CHECKS = ["unseenPressStillUp"] as const;

const LINE = /^\s*(\d+):(\d\d)\s+\[[A-Z ]+\]\s+(.*\[pressed while unseen\].*)$/;
const UNIT = /^(\d+)\([^)]*\)(?: \([^)]*\))?: (.+)$/;

/** the spell a line prints, up to its first ` (` / ` [` */
const spellOf = (rest: string): string =>
  /^(.+?)(?: \(| \[|$)/.exec(rest)?.[1] ?? rest;

export function run(ctx: IRoundCtx): void {
  for (const line of ctx.lines) {
    const m = LINE.exec(line);
    if (!m) continue;
    const u = UNIT.exec(m[3]!);
    const unit = u ? ctx.unitOfPid(u[1]) : ctx.owner;
    if (!unit) continue;
    const name = spellOf(u ? u[2]! : m[3]!);
    const t = +m[1]! * 60 + +m[2]!;
    const lo = ctx.start + t * 1000;
    const rows = ((unit.auraEvents ?? []) as any[]).filter(
      (a) =>
        a.spellId &&
        a.srcUnitId === unit.id &&
        a.destUnitId === unit.id &&
        getEnglishSpellName(a.spellId, a.spellName ?? "") === name,
    );
    const batch = rows.find(
      (a) => ev(a) === APPLIED && tsOf(a) >= lo && tsOf(a) < lo + 1000,
    );
    if (!batch) continue;
    ctx.bump("unseenPressStillUp");
    const at = tsOf(batch);
    const upIds = new Set<string>();
    for (const id of new Set(rows.map((a) => a.spellId as string))) {
      const before = rows.filter((a) => a.spellId === id && tsOf(a) < at);
      const last = before[before.length - 1];
      if (!last || ev(last) === REMOVED) continue;
      if (ev(last) !== APPLIED && ev(last) !== REFRESH) continue;
      const d = spellEffectData[id]?.durationSeconds;
      const hasEndRow = rows.some(
        (a) => a.spellId === id && ev(a) === REMOVED && tsOf(a) > at,
      );
      if (!hasEndRow && d && d > 0 && at > tsOf(last) + (d + 1) * 1000)
        continue;
      upIds.add(id);
    }
    if (upIds.size === 0) continue;
    ctx.violate(
      "unseenPressStillUp",
      upIds.has(batch.spellId) ? "sameId" : "sibling",
      at,
      `${unit.name}#${name}#${at}`,
      `${unit.name} ${name}: batch row ${batch.spellId} at +${at - ctx.start}ms, up: ${[...upIds].join(",")}`,
      line,
    );
  }
}

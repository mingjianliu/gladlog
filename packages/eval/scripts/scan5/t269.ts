/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units) */
/**
 * scan5/t269.ts — ticket T269 (12.1.5 baseline: Preservation Dream Breath /
 * Fire Breath `back` later than the observed re-press). An empowered press
 * logs SPELL_EMPOWER_START, then its SPELL_CAST_SUCCESS, then
 * SPELL_EMPOWER_END (released) or SPELL_EMPOWER_INTERRUPT (never released).
 * A hold never released — or released at level 0 — spent no cooldown
 * (GH #183), so the cooldown model must carry its press as `unreleased`.
 *
 *  - `cutHoldSpent`: every such hold of a player, once per round. Its own
 *    cast row is read off the log: the one SPELL_CAST_SUCCESS of the spell
 *    by the unit logged between the hold's START and its closer (605:
 *    1,699 of 1,699 closed holds carry exactly one; 1215: 4,153 of 4,153 —
 *    the row lags the START by 0–50 ms, by recorder). Checked = the holds
 *    whose cast row the model's entry (`unitCooldownEntry`) has as a press;
 *    a violation = that press not `unreleased` (the model spends a cooldown
 *    the game never started). Kind = the START→SUCCESS lag in ms (`0`,
 *    `1`, `2+`).
 */
import {
  type IMajorCooldownInfo,
  unitCooldownEntry,
} from "@gladlog/analysis/src/utils/cooldowns";

import { type IRoundCtx, nameOf, successesOf, tsOf } from "./ctx";

export const CHECKS = ["cutHoldSpent"] as const;

interface IRow {
  spellId: string | number;
  timestamp: number;
  level?: number;
  logLine?: { lineIndex?: number };
}
const order = (a: IRow, b: IRow): number =>
  a.timestamp - b.timestamp ||
  (a.logLine?.lineIndex ?? 0) - (b.logLine?.lineIndex ?? 0);

export function run(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  for (const u of ctx.players as any[]) {
    const starts = ((u.empowerStarts ?? []) as IRow[]).slice().sort(order);
    if (!starts.length) continue;
    const closers = [
      ...((u.empowerEnds ?? []) as IRow[]).map((e) => ({ e, cut: false })),
      ...((u.empowerInterrupts ?? []) as IRow[]).map((e) => ({
        e,
        cut: true,
      })),
    ].sort((a, b) => order(a.e, b.e));
    const succ = successesOf(u);
    const entries = new Map<string, IMajorCooldownInfo | undefined>();
    for (const { e, cut } of closers) {
      if (!cut && e.level !== 0) continue;
      const id = String(e.spellId);
      // the hold this closer ends: the latest START of the spell before it
      const st = starts
        .filter((s) => String(s.spellId) === id && order(s, e) <= 0)
        .pop();
      if (!st) continue;
      const rows = succ.filter(
        (c) =>
          String(c.spellId) === id &&
          tsOf(c) >= st.timestamp &&
          tsOf(c) <= e.timestamp,
      );
      if (rows.length !== 1) continue;
      const rowMs = tsOf(rows[0]);
      if (!entries.has(id))
        entries.set(id, unitCooldownEntry(u, ctx.legacy, id));
      const entry = entries.get(id);
      if (!entry) continue;
      const tS = (rowMs - ctx.start) / 1000;
      const press = entry.casts.find(
        (c) => Math.abs(c.timeSeconds - tS) < 0.002,
      );
      if (!press) continue;
      ctx.bump("cutHoldSpent");
      if (press.unreleased) continue;
      const lag = rowMs - st.timestamp;
      ctx.violate(
        "cutHoldSpent",
        lag >= 2 ? "2+" : String(lag),
        rowMs,
        `${ctx.roundKey}|${u.id}|${id}|${rowMs}`,
        `${nameOf(id, id)} hold ${(st.timestamp - ctx.start) / 1000}s→${(e.timestamp - ctx.start) / 1000}s ${cut ? "INTERRUPT" : "END level 0"}, cast row +${lag}ms: the model spends its cooldown`,
      );
    }
  }
}

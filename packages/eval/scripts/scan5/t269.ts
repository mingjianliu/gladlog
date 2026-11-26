/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units) */
/**
 * scan5/t269.ts — ticket T269 (12.1.5 baseline: Preservation Dream Breath /
 * Fire Breath `back` later than the observed re-press). An empowered press
 * logs SPELL_EMPOWER_START, then its SPELL_CAST_SUCCESS, then
 * SPELL_EMPOWER_END (released) or SPELL_EMPOWER_INTERRUPT (never released).
 * A hold never released — or released at level 0 — spent no cooldown
 * (GH #183), so the cooldown model must carry its press as `unreleased`.
 *
 *  - `cutHoldSpent`: every such hold of a player (the parse's pairing,
 *    `empowerSpans`), once per round. Its own cast row is read off the log:
 *    the one SPELL_CAST_SUCCESS of the spell by the unit logged between the
 *    hold's START and its closer in log order (605:
 *    1,699 of 1,699 closed holds carry exactly one; 1215: 4,153 of 4,153 —
 *    the row lags the START by 0–50 ms, by recorder). Checked = the holds
 *    whose cast row the model's entry (`unitCooldownEntry`) has as a press;
 *    a violation = that press not `unreleased` (the model spends a cooldown
 *    the game never started). Kind = the START→SUCCESS lag in ms (`0`,
 *    `1`, `2+`).
 */
import { empowerSpans } from "@gladlog/analysis/src/utils/castCommitSpans";
import {
  type IMajorCooldownInfo,
  unitCooldownEntry,
} from "@gladlog/analysis/src/utils/cooldowns";

import { type IRoundCtx, nameOf, successesOf, tsOf } from "./ctx";

export const CHECKS = ["cutHoldSpent"] as const;

type At = { ms: number; line: number };
const before = (a: At, b: At): boolean =>
  a.ms < b.ms || (a.ms === b.ms && a.line < b.line);

export function run(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  for (const u of ctx.players as any[]) {
    // the holds as the parse pairs them (`empowerSpans`: each START with
    // its first closer, a successful END included, within the longest hold
    // — codex 85-tk-L5-T269-1 #2: a later INTERRUPT re-used a START already
    // ended at level 1)
    const holds = (empowerSpans(u) ?? []).filter(
      (h) => h.interrupted || h.level === 0,
    );
    if (!holds.length) continue;
    const succ = successesOf(u).map((c: any) => ({
      id: String(c.spellId),
      at: { ms: tsOf(c), line: c.logLine?.lineIndex ?? 0 } as At,
    }));
    const entries = new Map<string, IMajorCooldownInfo | undefined>();
    for (const h of holds) {
      const id = String(h.spellId);
      // the SUCCESS rows inside the hold in log order (#4: a retry's START
      // and SUCCESS can share the closer's millisecond)
      const from: At = { ms: h.startMs, line: h.startLine ?? -Infinity };
      const until: At = { ms: h.endMs, line: h.endLine ?? Infinity };
      const rows = succ.filter(
        (c) => c.id === id && !before(c.at, from) && before(c.at, until),
      );
      if (rows.length !== 1) continue;
      const rowMs = rows[0].at.ms;
      if (!entries.has(id))
        entries.set(id, unitCooldownEntry(u, ctx.legacy, id));
      const entry = entries.get(id);
      if (!entry) continue;
      const tS = (rowMs - ctx.start) / 1000;
      const press = entry.casts.find(
        (c) => Math.abs(c.timeSeconds - tS) < 0.0005,
      );
      if (!press) continue;
      ctx.bump("cutHoldSpent");
      if (press.unreleased) continue;
      const lag = rowMs - h.startMs;
      ctx.violate(
        "cutHoldSpent",
        lag >= 2 ? "2+" : String(lag),
        rowMs,
        `${ctx.roundKey}|${u.id}|${id}|${rowMs}`,
        `${nameOf(id, id)} hold ${(h.startMs - ctx.start) / 1000}s→${(h.endMs - ctx.start) / 1000}s ${h.interrupted ? "INTERRUPT" : "END level 0"}, cast row +${lag}ms: the model spends its cooldown`,
      );
    }
  }
}

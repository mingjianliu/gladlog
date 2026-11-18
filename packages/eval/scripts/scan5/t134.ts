/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents, spellCastEvents) */
/**
 * scan5/t134.ts — ticket T134 (wave-4 P01): a cast a low-HP proc made, read
 * as a press of the cooldown it casts. Well-Honed Instincts (377847) casts
 * Frenzied Regeneration below 40 % health and puts its marker 382912 on the
 * druid in the same millisecond; the proc spends no charge of the 36 s
 * button. 74f541c0 r5: pressed 2:19.3, the proc at 2:44.8, pressed again
 * 2:54.6 — the ledger held three presses and the kit said `Frenzied
 * Regeneration [28–36s]` beside two of them 25.5 s apart.
 *
 *  - `procCastReadAsPress`: per round, every marker of `CRISIS_PROC_ANSWERS`
 *    a player put on itself (the log's own APPLIED row, self → self) whose
 *    proc casts a cooldown the player's ledger carries (`unitCooldownEntry`);
 *    a violation when the ledger holds a press of that cooldown within
 *    `PROC_OWN_ACTIVATION_PAIR_MS` of the marker that no SPELL_CAST_SUCCESS
 *    row backs — a press read off the proc's aura. A press the log has a
 *    cast row for is the player's own (the product keeps it: a cast row is
 *    always a press), so it is no violation however close the marker is; it
 *    shows in the inventory only. Kind `<spell> | no cast row`.
 *    Checked = those markers.
 *  - inventory kinds (out of the total), the pairing's own measure: for each
 *    such marker, the nearest SPELL_CAST_SUCCESS of the proc's spell within
 *    3 s, by distance — `<spell> | cast row within 0 ms / 100 ms / 500 ms /
 *    1500 ms / 3000 ms` — the proc logs no cast row of its own, so a row
 *    beside it is the player pressing on top of it (18e3feae r4: 1.04 s).
 */
import { CRISIS_PROC_ANSWERS } from "@gladlog/analysis/src/data/crisisProcAnswers";
import { unitCooldownEntry } from "@gladlog/analysis/src/utils/cooldowns";
import { PROC_OWN_ACTIVATION_PAIR_MS } from "@gladlog/analysis/src/utils/procTriggeredCast";

import {
  APPLIED,
  ev,
  fmtS,
  type IRoundCtx,
  nameOf,
  successesOf,
  tsOf,
} from "./ctx";

const BUCKETS = [0, 100, 500, 1500, 3000] as const;
export const CHECKS = ["procCastReadAsPress"] as const;
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set(
  [...CRISIS_PROC_ANSWERS.values()].flatMap((a) =>
    [...a.triggers].flatMap((id) =>
      BUCKETS.map(
        (b) => `procCastReadAsPress|${nameOf(id)} | cast row within ${b} ms`,
      ),
    ),
  ),
);

export function run(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  for (const u of ctx.players as any[]) {
    for (const a of (u.auraEvents ?? []) as any[]) {
      const def = CRISIS_PROC_ANSWERS.get(String(a.spellId ?? ""));
      if (!def || def.via !== "aura" || ev(a) !== APPLIED) continue;
      if (a.srcUnitId !== u.id || a.destUnitId !== u.id) continue;
      const ms = tsOf(a);
      if (ms < ctx.start || ms > ctx.roundEndAt) continue;
      for (const id of def.triggers) {
        const entry = unitCooldownEntry(u, ctx.legacy, id);
        if (!entry) continue;
        ctx.bump("procCastReadAsPress");
        const name = nameOf(id);
        const at = (ms - ctx.start) / 1000;
        const factId = `${ctx.roundKey}|${u.id}|${id}|${Math.floor(at)}`;
        const rowGaps = successesOf(u)
          .filter((c) => String(c.spellId) === id)
          .map((c) => Math.abs(tsOf(c) - ms))
          .sort((x, y) => x - y);
        const nearest = rowGaps[0];
        const bucket = BUCKETS.find(
          (b) => nearest !== undefined && nearest <= b,
        );
        if (bucket !== undefined)
          ctx.violate(
            "procCastReadAsPress",
            `${name} | cast row within ${bucket} ms`,
            ms,
            `${factId}|row`,
            `${u.spec} ${name}: ${def.name} at ${fmtS(at)}, a cast row ${nearest} ms from it`,
          );
        const rowMs = successesOf(u)
          .filter((c) => String(c.spellId) === id)
          .map((c) => tsOf(c));
        // a ledger press at a cast row's own instant is the player's press
        const press = entry.casts.find((c) => {
          const pressMs = Math.round(ctx.start + c.timeSeconds * 1000);
          return (
            Math.abs(pressMs - ms) <= PROC_OWN_ACTIVATION_PAIR_MS &&
            !rowMs.some((r) => Math.abs(r - pressMs) <= 1)
          );
        });
        if (!press) continue;
        ctx.violate(
          "procCastReadAsPress",
          `${name} | no cast row`,
          ms,
          factId,
          `${u.spec} ${name}: ${def.name} at ${at.toFixed(2)}s, the ledger holds a press at ${press.timeSeconds.toFixed(2)}s with no cast row (presses ${entry.casts.map((c) => c.timeSeconds.toFixed(1)).join(" ")})`,
        );
      }
    }
  }
}

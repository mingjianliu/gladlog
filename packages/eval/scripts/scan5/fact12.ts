/* eslint-disable @typescript-eslint/no-explicit-any -- scan over raw parse output */
/**
 * fact12 (pipeline 2026-11-07) class checks.
 *
 *  - resEnemyEffectAfterDeath (T03, fact12 D18 A11/B13): a `[RES]` row's
 *    `enemy:` entry `X/<spec>(Ns left)` on a row at or after its holder's
 *    death second (the unit's first UNIT_DIED, floored — the `[DEATH]`
 *    line's second) whose effect the log shows over: every aura named X
 *    (English name, `(no press)` stripped) the holder put on any unit was
 *    REMOVED by the death's instant + `DEATH_CASCADE_MS`. An effect living
 *    on someone else — a Goremaw's Bite DoT ticking on after its rogue
 *    died, a Power Infusion on an ally — is still running and no violation.
 *    65d7e61a r0 2:20: `Bladestorm/Arms Warrior(5s left)` under the
 *    warrior's own `[DEATH]` (REMOVED 2:20.004, UNIT_DIED 2:20.030). Kind
 *    `no aura of the name` (holder has no aura named X this round: the log
 *    cannot say) is kept out of the total. Kind `round over`: the same for
 *    a living holder on a row at or after the round's end when it comes
 *    before the log's (`shuffleRoundEndMs`, a Solo Shuffle round's ending
 *    death; not a 3v3's deciding death, which ends no enemy effect, T28) —
 *    GH #167 gives that cut the official time left too. Counted: every
 *    `enemy:` entry of a dead holder or of a finished round, the holder's
 *    spec unique on the enemy roster.
 */
import {
  parseResRow,
  splitResList,
} from "@gladlog/analysis/src/context/resRow";
import { casterAuraOutlives } from "@gladlog/analysis/src/utils/enemyCDs";
import { shuffleRoundEndMs } from "@gladlog/analysis/src/utils/roundEnd";
import { DEATH_CASCADE_MS } from "@gladlog/analysis/src/utils/unitDeath";

import { deathMs, type IRoundCtx, secOf } from "./ctx";

export const CHECKS = ["resEnemyEffectAfterDeath"] as const;

export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "resEnemyEffectAfterDeath|no aura of the name",
]);

export function run(ctx: IRoundCtx): void {
  resEnemyEffectAfterDeath(ctx);
}

const ROSTER =
  /<unit\s+id="(\d+)"\s+name="[^"]+"\s+spec="([^"]+)"\s+role="enemy"/;
const ENTRY = /^(.*)\/([^/]+?)\((\d+)s left\)$/;

function resEnemyEffectAfterDeath(ctx: IRoundCtx): void {
  const lines = ctx.text.split("\n");
  const pidsOfSpec = new Map<string, string[]>();
  for (const l of lines) {
    const r = ROSTER.exec(l);
    if (r) pidsOfSpec.set(r[2]!, [...(pidsOfSpec.get(r[2]!) ?? []), r[1]!]);
  }
  /** does an aura named `name` by `holder` — on any unit, a pet's copy
   * included — outlive `untilMs`? The product's own predicate
   * (`casterAuraOutlives`, the one `[RES]`'s death cut reads; its intervals
   * the builder's, so a REMOVED written with no source closes the holder's
   * open interval — codex P2 on attempt 1) */
  const combat = {
    startTime: ctx.start,
    endTime: ctx.end,
    units: ctx.legacy.units,
  };
  const outlives = (holder: any, name: string, untilMs: number) =>
    casterAuraOutlives(holder, name, untilMs, combat);
  // a Solo Shuffle round's end (T28): a 3v3's deciding friendly death
  // (`ctx.roundEndAt` carries it too) ends no enemy effect — the match runs
  // on, and a press after it is a press, not an effect the death ended
  const roundEnd = shuffleRoundEndMs(ctx.legacy, ctx.units);
  let atS = 0;
  for (const l of lines) {
    const t = /^(\d+:\d{2})\s/.exec(l);
    if (t) atS = secOf(t[1]!);
    const enemy = parseResRow(l)?.enemy;
    if (!enemy) continue;
    for (const entry of splitResList(enemy)) {
      const e = ENTRY.exec(entry.trim());
      if (!e) continue;
      const pids = pidsOfSpec.get(e[2]!) ?? [];
      if (pids.length !== 1) continue;
      const holder = ctx.unitOfPid(pids[0]);
      if (!holder) continue;
      const known = (ms: number) =>
        Number.isFinite(ms) && Math.floor((ms - ctx.start) / 1000) <= atS;
      const diedMs = deathMs(holder);
      const cut = known(diedMs)
        ? { ms: diedMs, why: "holder dead" }
        : roundEnd !== undefined && roundEnd < ctx.end && known(roundEnd)
          ? { ms: roundEnd, why: "round over" }
          : undefined;
      if (!cut) continue;
      ctx.bump("resEnemyEffectAfterDeath");
      const name = e[1]!.replace(/ \(no press\)$/, "");
      const r = outlives(holder, name, cut.ms + DEATH_CASCADE_MS);
      if (r.outlives) continue;
      ctx.violate(
        "resEnemyEffectAfterDeath",
        r.any ? `effect over (${cut.why})` : "no aura of the name",
        ctx.start + atS * 1000,
        `${holder.name}:${atS}:${name}`,
        `${holder.name}: ${cut.why} at ${((cut.ms - ctx.start) / 1000).toFixed(3)}s; [RES] ${atS}s lists ${entry.trim()}`,
        l.trim().slice(0, 220),
      );
    }
  }
}

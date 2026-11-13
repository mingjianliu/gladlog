/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse units */
/**
 * scan5/t16.ts — the low end of a kit's `[a–Ns]` (fact12 D17, T16).
 *
 *  - `kitSoonestAboveRecast`: a `<player_loadout>` kit entry `X [a–Ns…]`
 *    (the legend: "has been seen back after a s at the soonest") whose unit
 *    pressed X twice in the round less than a s apart, by more than
 *    `KIT_SLACK_S` — the soonest return the kit states is later than one
 *    the log shows (64e9a3f3 r0: Frozen Orb `[31–60s]`, presses 26.0 s
 *    apart under White Out's per-hit and per-shattered-stack give-backs).
 *    A charge entry (`N Charges`) is not read: two presses of a charge
 *    spell are no cooldown apart. Kind = the spell. Counted: every kit range
 *    entry whose unit pressed X again after a press that started its
 *    cooldown.
 * Which rows are presses, and which of them started a cooldown, is the
 * producer's own selection (`pressesOf`, the kit entry's ledger casts): the
 * check audits the kit's `a`, not the press identification, and a second
 * identification here drifted from the ledger's three times (free-recast
 * windows, Time Spiral's free casts and its echo rows). The `[RES]` rows'
 * range low end is fact8's `resCdBeforeNextPress`.
 */
import {
  kitSpellNameOf,
  unitCooldownLedger,
} from "@gladlog/analysis/src/utils/cooldowns";

import { type IRoundCtx } from "./ctx";

export const CHECKS = ["kitSoonestAboveRecast"] as const;

/** the kit's a is whole seconds; a recast this much under it is no rounding */
const KIT_SLACK_S = 1;
const UNIT_OPEN = /^\s*<unit id="(\d+)"/;
const KIT_LINE = /^\s*<cooldowns>(.*)<\/cooldowns>/;
const KIT_RANGE = /(?:^|, )([^,[\]]+?) \[(\d+)–(\d+)s([^\]]*)\]/g;

/**
 * The presses of the kit entry `name`, as the producer selects them: the
 * casts of the ledger entry that kit entry is rendered from
 * (`unitCooldownLedger`, the entry whose `spellName` the kit prints), never
 * re-derived here and never `unitCooldownEntry`'s fallback for an id the
 * ledger does not carry (the Stasis release 370564 built a cooldown entry of
 * its own, its releases read as presses: 61 false Stasis rows on 605). Echo
 * rows (Time Spiral's, Stasis replays, copy casts) are no cast there, and a
 * free press (`freeRecast`) is marked (codex reviews 85-tk-E-T16-1 / -1b /
 * -2, batch review 80-PIPE-20-B20: 08428e7e r2 Spiritwalker's Grace 16.0 /
 * 69.3 s, the second a Time Spiral cast). `spent`: the presses that started
 * a cooldown. `ready`: every press that proves the button was back — those,
 * plus a hold that never went out (`unreleased`: it spent nothing, but it
 * could only start on a ready button). A free press of Time Spiral or a
 * free-recast window proves neither. A press no cast row dates
 * (`timedAtLatest`: unseen, or read off its effect) is ready, not spent: its
 * real instant is at or before its time, so a gap measured from it reads
 * short (codex 85-tk-E-T16-2b: an unseen Life Cocoon at 10 s re-stated at
 * 15 s, pressed again at 97 s, read 82.0 s against `[86–120s]`). Epoch ms, the round's end of play the
 * cut. One per ledger entry of that name.
 */
function pressesOf(
  ctx: IRoundCtx,
  u: any,
  name: string,
): Array<{ spent: number[]; ready: number[] }> {
  return (
    unitCooldownLedger(u, ctx.legacy)
      // by the name the kit prints for this holder (`kitSpellNameOf`: an Ice
      // Cold holder's Ice Block row), codex 85-tk-G-T61-2 #2
      .filter((cd) => kitSpellNameOf(cd, u) === name)
      .map((cd) => {
        const spent: number[] = [];
        const ready: number[] = [];
        for (const c of cd.casts) {
          const ms = ctx.legacy.startTime + c.timeSeconds * 1000;
          if (ms > ctx.roundEndAt) continue;
          // a press timed at the latest it can have been is no anchor (the
          // gap from it reads short), but it still proves the button back
          if (!c.freeRecast) {
            if (!c.timedAtLatest) spent.push(ms);
            ready.push(ms);
          } else if (c.unreleased) ready.push(ms);
        }
        return {
          spent: spent.sort((x, y) => x - y),
          ready: ready.sort((x, y) => x - y),
        };
      })
  );
}

/** The shortest gap from a press that started the cooldown to the next
 * press proving it back, and that press's start; undefined with none. */
function shortestRecast(p: {
  spent: number[];
  ready: number[];
}): { gapMs: number; at: number } | undefined {
  let best: { gapMs: number; at: number } | undefined;
  for (const r of p.ready) {
    let from: number | undefined;
    for (const s of p.spent) if (s < r) from = s;
    if (from === undefined) continue;
    if (!best || r - from < best.gapMs) best = { gapMs: r - from, at: from };
  }
  return best;
}

export function run(ctx: IRoundCtx): void {
  let pid: string | undefined;
  for (const line of ctx.lines) {
    const open = UNIT_OPEN.exec(line);
    if (open) {
      pid = open[1];
      continue;
    }
    const kit = KIT_LINE.exec(line);
    if (!kit || pid === undefined) continue;
    const unit = ctx.unitOfPid(pid);
    if (!unit) continue;
    for (const e of kit[1]!.matchAll(KIT_RANGE)) {
      if (/Charges/.test(e[4]!)) continue;
      const name = e[1]!.trim();
      const soonest = Number(e[2]);
      let recast: { gapMs: number; at: number } | undefined;
      for (const p of pressesOf(ctx, unit, name)) {
        const r = shortestRecast(p);
        if (r && (!recast || r.gapMs < recast.gapMs)) recast = r;
      }
      if (!recast) continue;
      ctx.bump("kitSoonestAboveRecast");
      const min = recast.gapMs;
      const at = recast.at;
      if (min / 1000 >= soonest - KIT_SLACK_S) continue;
      ctx.violate(
        "kitSoonestAboveRecast",
        name,
        at,
        `${unit.name}#${name}`,
        `${unit.name} ${name} [${soonest}–${e[3]}s]: pressed ${(min / 1000).toFixed(1)} s apart`,
        e[0]!.slice(0, 200),
      );
    }
  }
}

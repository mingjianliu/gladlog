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
 *    entry whose unit pressed X at least twice.
 * Presses are fact8's `buttonPressesOf` (one per press, the round's end of
 * play the cut), less the ones the ledger itself reads as free
 * (`freePressMsOf`); the `[RES]` rows' range low end is fact8's
 * `resCdBeforeNextPress`.
 */
import { unitCooldownEntry } from "@gladlog/analysis/src/utils/cooldowns";

import { type IRoundCtx, nameOf } from "./ctx";
import { buttonPressesOf } from "./fact8";

export const CHECKS = ["kitSoonestAboveRecast"] as const;

/** the kit's a is whole seconds; a recast this much under it is no rounding */
const KIT_SLACK_S = 1;
const UNIT_OPEN = /^\s*<unit id="(\d+)"/;
const KIT_LINE = /^\s*<cooldowns>(.*)<\/cooldowns>/;
const KIT_RANGE = /(?:^|, )([^,[\]]+?) \[(\d+)–(\d+)s([^\]]*)\]/g;

/** The epoch ms of the presses on the button `name` that the ledger reads as
 * starting no cooldown of their own (`freeRecast`: Time Spiral's free cast,
 * a press inside a free-recast window, a hold that never went out) — the
 * producer's own selection, asked through `unitCooldownEntry` on the
 * button's cast ids, never re-derived here (codex reviews 85-tk-E-T16-1 /
 * -1b, batch review 80-PIPE-20-B20: 08428e7e r2 Spiritwalker's Grace 16.0 /
 * 69.3 s, the second a Time Spiral cast). */
function freePressMsOf(ctx: IRoundCtx, u: any, name: string): number[] {
  const ids = new Set<string>(
    (u.spellCastEvents ?? [])
      .filter((c: any) => nameOf(c.spellId, c.spellName) === name)
      .map((c: any) => String(c.spellId)),
  );
  const out: number[] = [];
  const seen = new Set<unknown>();
  for (const id of ids) {
    const cd = unitCooldownEntry(u, ctx.legacy, id);
    if (!cd || seen.has(cd)) continue;
    seen.add(cd);
    for (const c of cd.casts)
      if (c.freeRecast) out.push(ctx.legacy.startTime + c.timeSeconds * 1000);
  }
  return out;
}

/** The presses whose cooldown ran out before them: the button's presses
 * less the ones the ledger reads as free (`freePressMsOf`). */
function cooldownPresses(
  ctx: IRoundCtx,
  u: any,
  presses: number[],
  name: string,
): number[] {
  const free = freePressMsOf(ctx, u, name);
  if (!free.length) return presses;
  return presses.filter((p) => !free.some((f) => Math.abs(f - p) < 1));
}

export function run(ctx: IRoundCtx): void {
  const memo = new Map<string, number[]>();
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
      const presses = cooldownPresses(
        ctx,
        unit,
        buttonPressesOf(ctx, memo, unit, name),
        name,
      );
      if (presses.length < 2) continue;
      ctx.bump("kitSoonestAboveRecast");
      let min = Infinity;
      let at = 0;
      for (let i = 1; i < presses.length; i++)
        if (presses[i]! - presses[i - 1]! < min) {
          min = presses[i]! - presses[i - 1]!;
          at = presses[i - 1]!;
        }
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

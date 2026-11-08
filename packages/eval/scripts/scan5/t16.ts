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
 * play the cut); the `[RES]` rows' range low end is fact8's
 * `resCdBeforeNextPress`.
 */
import { type IRoundCtx } from "./ctx";
import { buttonPressesOf } from "./fact8";

export const CHECKS = ["kitSoonestAboveRecast"] as const;

/** the kit's a is whole seconds; a recast this much under it is no rounding */
const KIT_SLACK_S = 1;
const UNIT_OPEN = /^\s*<unit id="(\d+)"/;
const KIT_LINE = /^\s*<cooldowns>(.*)<\/cooldowns>/;
const KIT_RANGE = /(?:^|, )([^,[\]]+?) \[(\d+)–(\d+)s([^\]]*)\]/g;

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
      const presses = buttonPressesOf(ctx, memo, unit, name);
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

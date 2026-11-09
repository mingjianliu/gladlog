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
 * play the cut), less a free press inside its opener's free-recast window; the `[RES]` rows' range low end is fact8's
 * `resCdBeforeNextPress`.
 */
import {
  freeRecastWindowFor,
  type IFreeRecastWindow,
} from "@gladlog/analysis/src/data/talentScriptedCooldowns";
import {
  cooldownTalentHolds,
  freeRecastWindowEndSeconds,
} from "@gladlog/analysis/src/utils/cooldowns";

import { type IRoundCtx, nameOf } from "./ctx";
import { buttonPressesOf } from "./fact8";

export const CHECKS = ["kitSoonestAboveRecast"] as const;

/** the kit's a is whole seconds; a recast this much under it is no rounding */
const KIT_SLACK_S = 1;
const UNIT_OPEN = /^\s*<unit id="(\d+)"/;
const KIT_LINE = /^\s*<cooldowns>(.*)<\/cooldowns>/;
const KIT_RANGE = /(?:^|, )([^,[\]]+?) \[(\d+)–(\d+)s([^\]]*)\]/g;

/** The free-recast window on the button `name` the unit holds (Strafing
 * Run's second Deep Breath within 18 s): the ledger's own
 * `freeRecastWindowFor` and `cooldownTalentHolds` — an unresolved choice
 * node holds neither entry (codex review 85-tk-E-T16-1b). */
function freeWindowOf(u: any, name: string): IFreeRecastWindow | undefined {
  const holds = cooldownTalentHolds(u);
  const ids = new Set<string>(
    (u.spellCastEvents ?? [])
      .filter((c: any) => nameOf(c.spellId, c.spellName) === name)
      .map((c: any) => String(c.spellId)),
  );
  for (const id of ids) {
    const w = freeRecastWindowFor(id, holds);
    if (w) return w;
  }
  return undefined;
}

/** The presses whose cooldown ran out before them: a free press inside the
 * window its opener opened (`freeRecastWindowEndSeconds`, the ledger's
 * reading) stands on that opener's cooldown and is dropped (codex review
 * 85-tk-E-T16-1: 0fe0e2e2 Deep Breath 22.0 / 31.2 s, the second free). */
function cooldownPresses(
  u: any,
  presses: number[],
  w: IFreeRecastWindow | undefined,
): number[] {
  if (!w) return presses;
  const out: number[] = [];
  let openEnd = Number.NEGATIVE_INFINITY;
  for (const p of presses) {
    if (p <= openEnd) {
      openEnd = Number.NEGATIVE_INFINITY;
      continue;
    }
    out.push(p);
    openEnd = p + freeRecastWindowEndSeconds(u, w, 0, p) * 1000;
  }
  return out;
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
        unit,
        buttonPressesOf(ctx, memo, unit, name),
        freeWindowOf(unit, name),
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

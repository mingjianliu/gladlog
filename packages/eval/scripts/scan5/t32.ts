/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, spellCastEvents) */
/**
 * scan5/t32.ts — T32 (from T24-1): `[DEFENSIVE AVAILABLE] … available but
 * unused (free to press it for the last Ns before the death)` reads N off
 * the holder's cannot-cast runs alone; a defensive that came back from
 * cooldown inside that stretch was not free to press it for all of it
 * (round-11 132-1 0:59: Feign Death back 1.7 s before the death, the line
 * said 7.8 s).
 *
 * Truth: the holder's last press of the named spell before the death and the
 * instant it was back in hand, both under the shared cooldown model
 * (`unitCooldownEntry` — press identification from SUCCESS and aura-read
 * rows — and `pressReadyAgainAtSeconds`: the ledger the `[RES]` lines and the
 * line's own `cdReadyInTimeAt` read).
 *
 * Check `freeToPressPastReturn`, kind `pastReturn`: the printed N exceeds the
 * death − that ready instant by more than the printed rounding plus the
 * rendered second's slack. Multi-charge entries are left out (a charge can be
 * in hand right after a press).
 */
import { classMetadata } from "@gladlog/analysis/src/data/classSpells";
import {
  CD_INSTANT_SLACK_S,
  pressReadyAgainAtSeconds,
  unitCooldownEntry,
} from "@gladlog/analysis/src/utils/cooldowns";

import { deathMs, type IRoundCtx, nameOf, successesOf } from "./ctx";

export const CHECKS = ["freeToPressPastReturn"] as const;

const AVAILABLE =
  /^\s*\d+:\d\d\s+\[DEFENSIVE AVAILABLE\]\s+(\d+)\([^)]*\): (.+?)(?: \([^)]*\))? available but unused \(free to press it for the last ([\d.]+)s before the death\)/;

/** printed to 0.1 s: half its last digit, plus the ledger's rendered slack */
const TOLERANCE_S = 0.05 + CD_INSTANT_SLACK_S;

/** the named spell's id: the holder's own SUCCESS of it, else the class
 * table (an aura-read press such as Feign Death logs no SUCCESS) */
function spellIdByName(unit: any, name: string): string | undefined {
  for (const c of successesOf(unit))
    if (nameOf(c.spellId, c.spellName ?? "") === name) return String(c.spellId);
  for (const meta of classMetadata)
    for (const sp of meta.abilities) if (sp.name === name) return sp.spellId;
  return undefined;
}

export function run(ctx: IRoundCtx): void {
  for (const line of ctx.lines) {
    const a = AVAILABLE.exec(line);
    if (!a) continue;
    const unit: any = ctx.unitOfPid(a[1]!);
    if (!unit) continue;
    const dead = ctx.players
      .filter((u) => deathMs(u) < Infinity)
      .sort((x, y) => deathMs(x) - deathMs(y))[0];
    if (!dead) continue;
    const death = deathMs(dead);
    const name = a[2]!;
    const printed = +a[3]!;
    ctx.bump("freeToPressPastReturn");
    const id = spellIdByName(unit, name);
    if (!id) continue;
    let entry: any;
    try {
      entry = unitCooldownEntry(unit, ctx.legacy as never, id);
    } catch {
      entry = undefined;
    }
    if (!entry || (entry.charges ?? 1) > 1) continue;
    const deathS = (death - ctx.legacy.startTime) / 1000;
    const press = (entry.casts as any[])
      .filter((c) => c.timeSeconds < deathS)
      .sort((x, y) => x.timeSeconds - y.timeSeconds)
      .at(-1);
    if (!press) continue;
    const backS = pressReadyAgainAtSeconds(entry, press.timeSeconds);
    if (backS === null) continue;
    const readyFor = deathS - backS;
    if (printed - readyFor <= TOLERANCE_S) continue;
    ctx.violate(
      "freeToPressPastReturn",
      "pastReturn",
      death,
      `${unit.name}|${id}|${Math.round(deathS)}`,
      `${name}: printed ${printed}s, back from its ${press.timeSeconds.toFixed(1)}s press at ${backS.toFixed(1)}s, ${readyFor.toFixed(1)}s before the death`,
      line,
    );
  }
}

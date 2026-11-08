/* eslint-disable @typescript-eslint/no-explicit-any -- scan over raw parse output */
/**
 * fact12e (pipeline 2026-11-08) class check — T05, fact12 A6/B7/C19.
 *
 *  - unusedPressedBeforeRoundEnd: a `<cooldowns>` entry `Name [..]
 *    [UNUSED]` whose unit pressed it before the round's end (`roundEndMs`,
 *    a Solo Shuffle round's deciding death) though its cast row was logged
 *    after it. Truth from the unit's own rows: a SPELL_CAST_SUCCESS of the
 *    name logged in (end, end + `PRESS_LANDING_LAG_S`], and an aura of the
 *    same English name the unit put on itself APPLIED in [row −
 *    `PRESS_LANDING_LAG_S`, end] — the press went up inside the round, the
 *    row is its landing. 52a97230 r0: Havoc Metamorphosis' 162264 up at
 *    0:32.885, the round-ending death 0:33.744, its 200166 landing 0:33.809;
 *    the kit read `Metamorphosis [120s] [UNUSED]` while `0:32 [ENEMY CD]`
 *    printed the press. Counted: every kit entry with such a press.
 */
import { PRESS_LANDING_LAG_S } from "@gladlog/analysis/src/utils/offensiveAuraOccurrences";
import { roundEndMs } from "@gladlog/analysis/src/utils/roundEnd";

import {
  APPLIED,
  ev,
  fmtS,
  type IRoundCtx,
  nameOf,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = ["unusedPressedBeforeRoundEnd"] as const;

export function run(ctx: IRoundCtx): void {
  unusedPressedBeforeRoundEnd(ctx);
}

const LAG_MS = PRESS_LANDING_LAG_S * 1000;

function unusedPressedBeforeRoundEnd(ctx: IRoundCtx): void {
  const end = roundEndMs(ctx.legacy);
  for (const u of ctx.players) {
    const pid = ctx.pidOf(u.name);
    const at = ctx.text.indexOf(`<unit id="${pid}" `);
    if (at < 0) continue;
    const cds = /<cooldowns>([^<]*)<\/cooldowns>/.exec(ctx.text.slice(at))?.[1];
    if (!cds) continue;
    /** name → the press's activation (its own aura's APPLIED) */
    const late = new Map<string, { rowMs: number; auraMs: number }>();
    for (const c of successesOf(u)) {
      const rowMs = tsOf(c);
      if (rowMs <= end || rowMs > end + LAG_MS) continue;
      const name = nameOf(c.spellId, c.spellName);
      const aura = ((u.auraEvents ?? []) as any[]).find(
        (a) =>
          ev(a) === APPLIED &&
          a.srcUnitId === u.id &&
          (a.destUnitId === undefined || a.destUnitId === u.id) &&
          tsOf(a) >= rowMs - LAG_MS &&
          tsOf(a) <= end &&
          nameOf(a.spellId, a.spellName) === name,
      );
      if (aura && !late.has(name))
        late.set(name, { rowMs, auraMs: tsOf(aura) });
    }
    if (late.size === 0) continue;
    for (const m of cds.matchAll(
      /(?:^|, )([^,[]+?) \[[^\]]*\]( \[UNUSED\])?(?=,|$| \[)/g,
    )) {
      const name = m[1]!;
      const hit = late.get(name);
      if (!hit) continue;
      ctx.bump("unusedPressedBeforeRoundEnd");
      if (m[2])
        ctx.violate(
          "unusedPressedBeforeRoundEnd",
          name,
          hit.auraMs,
          `${u.name}:${name}`,
          `${u.name}: ${name} up at ${fmtS((hit.auraMs - ctx.start) / 1000)} (+${((hit.auraMs - ctx.start) / 1000).toFixed(3)}s), round over at ${((end - ctx.start) / 1000).toFixed(3)}s, its cast row at ${((hit.rowMs - ctx.start) / 1000).toFixed(3)}s; kit reads [UNUSED]`,
        );
    }
  }
}

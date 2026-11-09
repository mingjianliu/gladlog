/* eslint-disable @typescript-eslint/no-explicit-any -- scan over raw parse output */
/**
 * t05 (pipeline 2026-11-08) class check — T05, fact12 A6/B7/C19.
 *
 *  - unusedPressedBeforeRoundEnd: a `<cooldowns>` entry `Name [..]
 *    [UNUSED]` whose unit pressed it before the round's end (`roundEndMs`,
 *    a Solo Shuffle round's deciding death) though its cast row was logged
 *    after it: a SPELL_CAST_SUCCESS of the name in (end, end +
 *    `PRESS_LANDING_LAG_S`] whose activation is at or before the end.
 *    Activation: for a Havoc Metamorphosis landing row
 *    or a logged 191427 button row (`METAMORPHOSIS_PRESS_CAST_IDS`) the
 *    product's own selection, `castRowActivationMs` (codex B11 #3, B19: the
 *    scan must not pick another instant than the ledger — a 191427 row is
 *    its own). For any other spell, kind `other (aura-led inventory)`, the
 *    LATEST aura row of the same English name the unit put on itself
 *    (APPLIED / REFRESH) in [row − lag, row] — an inventory of other spells
 *    with the shape, OUT of the total: the ledger keeps those rows at their
 *    own instant, so it nominates and never rejects (codex T05-4). 52a97230 r0: Metamorphosis' 162264 up at
 *    0:32.885, the round-ending death 0:33.744, its 200166 landing 0:33.809;
 *    the kit read `Metamorphosis [120s] [UNUSED]` while `0:32 [ENEMY CD]`
 *    printed the press. Counted: every kit entry with such a press.
 */
import {
  castRowActivationMs,
  METAMORPHOSIS_PRESS_CAST_IDS,
  PRESS_LANDING_LAG_S,
} from "@gladlog/analysis/src/utils/offensiveAuraOccurrences";
import { roundEndMs } from "@gladlog/analysis/src/utils/roundEnd";
import { LogEvent } from "@gladlog/parser-compat";

import { ev, fmtS, type IRoundCtx, nameOf, successesOf, tsOf } from "./ctx";

export const CHECKS = ["unusedPressedBeforeRoundEnd"] as const;

/** the aura-led inventory of other spells: the ledger keeps their cast row
 * (only a Metamorphosis landing is dated at its activation), so a hit here
 * is a candidate for a future ticket, never a verdict against the ledger
 * (codex T05-4: Recklessness' self-aura 0.1 s before its SUCCESS) */
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "unusedPressedBeforeRoundEnd|other (aura-led inventory)",
]);

export function run(ctx: IRoundCtx): void {
  unusedPressedBeforeRoundEnd(ctx);
}

const LAG_MS = PRESS_LANDING_LAG_S * 1000;

/** the latest own aura row of `name` in [rowMs − lag, rowMs] */
function latestOwnAuraRowMs(
  u: any,
  name: string,
  rowMs: number,
): number | undefined {
  let best: number | undefined;
  for (const a of (u.auraEvents ?? []) as any[]) {
    const e = ev(a);
    if (e !== LogEvent.SPELL_AURA_APPLIED && e !== LogEvent.SPELL_AURA_REFRESH)
      continue;
    if (a.srcUnitId !== u.id) continue;
    if (a.destUnitId !== undefined && a.destUnitId !== u.id) continue;
    const t = tsOf(a);
    if (t < rowMs - LAG_MS || t > rowMs) continue;
    if (nameOf(a.spellId, a.spellName) !== name) continue;
    if (best === undefined || t > best) best = t;
  }
  return best;
}

function unusedPressedBeforeRoundEnd(ctx: IRoundCtx): void {
  const end = roundEndMs(ctx.legacy);
  for (const u of ctx.players) {
    const pid = ctx.pidOf(u.name);
    const at = ctx.text.indexOf(`<unit id="${pid}" `);
    if (at < 0) continue;
    const cds = /<cooldowns>([^<]*)<\/cooldowns>/.exec(ctx.text.slice(at))?.[1];
    if (!cds) continue;
    /** name → the press's activation and its row */
    const late = new Map<
      string,
      { rowMs: number; upMs: number; kind: string }
    >();
    for (const c of successesOf(u)) {
      const rowMs = tsOf(c);
      if (rowMs <= end || rowMs > end + LAG_MS) continue;
      const name = nameOf(c.spellId, c.spellName);
      const id = String(c.spellId ?? "");
      // a Metamorphosis cast row (landing or a logged 191427 button) is
      // dated by the ledger's own selection, never the generic fallback
      // (B19 assembly review: a 191427 row backdated through its name)
      const meta = METAMORPHOSIS_PRESS_CAST_IDS.has(id);
      const upMs = meta
        ? castRowActivationMs(u, id, rowMs)
        : latestOwnAuraRowMs(u, name, rowMs);
      if (upMs === undefined || upMs > end || late.has(name)) continue;
      late.set(name, {
        rowMs,
        upMs,
        kind: meta ? "metamorphosis" : "other (aura-led inventory)",
      });
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
          hit.kind,
          hit.upMs,
          `${u.name}:${name}`,
          `${u.name}: ${name} up at ${fmtS((hit.upMs - ctx.start) / 1000)} (+${((hit.upMs - ctx.start) / 1000).toFixed(3)}s), round over at ${((end - ctx.start) / 1000).toFixed(3)}s, its cast row at ${((hit.rowMs - ctx.start) / 1000).toFixed(3)}s; kit reads [UNUSED]`,
        );
    }
  }
}

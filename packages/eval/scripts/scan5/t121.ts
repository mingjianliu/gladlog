/**
 * scan5/t121.ts — ticket T121 (fact12 retest, fcee94ea r0 0:27): the
 * `[HEALING]` block (per-5s HPS + overheal) under an owner press goes to
 * every press whose id is in `HEALING_AMPLIFIER_SPELL_IDS`, whatever the
 * presser's spec — a Shadow Priest's Power Infusion got one, 76 % of it
 * Vampiric Embrace.
 *
 *  - `healingBlockOffHealer`: a `[YOU] [CD]` line of a healing-amplifier
 *    spell (by English name) with a `[HEALING]` sub-line under it, the
 *    owner not a healer spec (`isHealerSpec`). Kind = the spell's name.
 *    Counted: every such `[YOU] [CD]` line, any spec.
 */
import { HEALING_AMPLIFIER_SPELL_IDS } from "@gladlog/analysis/src/context/timelineHelpers";
import { isHealerSpec } from "@gladlog/analysis/src/utils/cooldowns";

import { type IRoundCtx, nameOf } from "./ctx";

export const CHECKS = ["healingBlockOffHealer"] as const;

const CD_LINE = /^\s*(\d+:\d\d)\s+\[YOU\] \[CD\]\s+(.+?) \(/;
let names: Set<string> | undefined;

export function run(ctx: IRoundCtx): void {
  if (!ctx.owner) return;
  names ??= new Set([...HEALING_AMPLIFIER_SPELL_IDS].map((id) => nameOf(id)));
  const C = "healingBlockOffHealer";
  const lines = ctx.lines;
  for (let i = 0; i < lines.length; i++) {
    const m = CD_LINE.exec(lines[i]!);
    if (!m || !names.has(m[2]!)) continue;
    ctx.bump(C);
    if (isHealerSpec(ctx.owner.spec)) continue;
    let healing = false;
    for (let j = i + 1; j < lines.length && /^\s{6}\S/.test(lines[j]!); j++)
      if (lines[j]!.includes("[HEALING]")) healing = true;
    if (!healing) continue;
    ctx.violate(
      C,
      m[2]!,
      ctx.start,
      `${m[2]}:${m[1]}`,
      `${m[2]} at ${m[1]} carries a [HEALING] block; the owner is no healer`,
      lines[i]!.trim(),
    );
  }
}

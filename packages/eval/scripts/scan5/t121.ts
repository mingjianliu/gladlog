/**
 * scan5/t121.ts — ticket T121 (fact12 retest, fcee94ea r0 0:27): the
 * `[HEALING]` block (per-5s HPS + overheal) under an owner press goes to
 * every press whose id is in `HEALING_AMPLIFIER_SPELL_IDS`, whatever the
 * presser's spec — a Shadow Priest's Power Infusion got one, 76 % of it
 * Vampiric Embrace.
 *
 *  - `healingBlockOffHealer`: a `[YOU] [CD]` line of a healing-amplifier
 *    spell (by English name) with a `[HEALING]` sub-line under it, the
 *    owner not a healer spec (`pressGetsHealingBlock`, ruling R46 = A). Kind = the spell's name.
 *    Counted: every such `[YOU] [CD]` line, any spec.
 */
import {
  HEALING_AMPLIFIER_SPELL_IDS,
  pressGetsHealingBlock,
} from "@gladlog/analysis/src/context/timelineHelpers";

import { type IRoundCtx, nameOf } from "./ctx";

export const CHECKS = ["healingBlockOffHealer"] as const;

/** `m:ss  [YOU] [CD]   <spell>[ → target][ (…)]…` — the spell is read as a
 * prefix of the body, whatever the target / HP part (codex 85-tk-L-T121-2) */
const CD_LINE = /^\s*(\d+:\d\d)\s+\[YOU\] \[CD\]\s+(.+)$/;
let idOfName: Map<string, string> | undefined;

export function run(ctx: IRoundCtx): void {
  if (!ctx.owner) return;
  idOfName ??= new Map(
    [...HEALING_AMPLIFIER_SPELL_IDS].map((id) => [nameOf(id), id] as const),
  );
  const C = "healingBlockOffHealer";
  const lines = ctx.lines;
  for (let i = 0; i < lines.length; i++) {
    const m = CD_LINE.exec(lines[i]!);
    if (!m) continue;
    const body = m[2]!;
    const name = [...idOfName.keys()].find(
      (n) => body === n || body.startsWith(`${n} `),
    );
    const id = name ? idOfName.get(name) : undefined;
    if (!name || !id) continue;
    ctx.bump(C);
    // the product's predicate (ruling R46 = A): a healer's press keeps it
    if (pressGetsHealingBlock(id, ctx.owner)) continue;
    let healing = false;
    for (let j = i + 1; j < lines.length && /^\s{6}\S/.test(lines[j]!); j++)
      if (lines[j]!.includes("[HEALING]")) healing = true;
    if (!healing) continue;
    ctx.violate(
      C,
      name,
      ctx.start,
      `${name}:${m[1]}`,
      `${name} at ${m[1]} carries a [HEALING] block; the owner is no healer`,
      lines[i]!.trim(),
    );
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, spellCastEvents) */
/**
 * scan5/overrideVariant.ts — class 10 of the round-7 audit (fact7 F21, D68 /
 * D71), the override-variant readers commit b5131407d did not reach.
 *
 * `noPressOfOwnVariant`: a `(no press)` [ENEMY CD] line whose second has a
 * SPELL_CAST_SUCCESS of a DB2 override variant of the printed spell, or of the
 * button it overrides: one press read twice. Log truth: the unit's cast rows
 * and the generated variant table, not the occurrence builder.
 *
 * `kitRangeBelowSeen`: a kit `[a–Ns]` printing a = 0. Nothing comes back 0 s
 * after its press; a full reset summed as a number of seconds did it.
 */
import { OVERRIDE_VARIANTS_GENERATED } from "@gladlog/analysis/src/data/overrideVariantsGenerated";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";

import { type IRoundCtx, successesOf, tsOf } from "./ctx";

export const CHECKS = ["noPressOfOwnVariant", "kitRangeBelowSeen"] as const;

const NO_PRESS =
  /^\s*(\d+):(\d\d)\s+\[ENEMY CD\]\s+(\d+)\([^)]*\) \([^)]*\): (.+?) \(no press\)/;
const KIT_UNIT = /<unit id="(\d+)" name="([^"]+)"/;
const KIT_ZERO = /([^,>]+?) \[0–(\d+)s/g;

/** every name a DB2 override pair of `name` goes by */
function variantIds(name: string): Set<string> {
  const ids = new Set<string>();
  for (const [variant, base] of Object.entries(OVERRIDE_VARIANTS_GENERATED)) {
    if (
      getEnglishSpellName(base, "") === name ||
      getEnglishSpellName(variant, "") === name
    ) {
      ids.add(variant);
      ids.add(base);
    }
  }
  return ids;
}

export function run(ctx: IRoundCtx): void {
  let pid: string | undefined;
  for (const line of ctx.lines) {
    const u = KIT_UNIT.exec(line);
    if (u) pid = u[1];
    if (line.includes("<cooldowns>"))
      for (const m of line.matchAll(KIT_ZERO)) {
        ctx.bump("kitRangeBelowSeen");
        const name = m[1]!.replace(/^.*<cooldowns>/, "").trim();
        ctx.violate(
          "kitRangeBelowSeen",
          "zero",
          ctx.start,
          `${pid}#${name}`,
          `${ctx.unitOfPid(pid)?.name} ${name} [0–${m[2]}s]`,
        );
      }
    const n = NO_PRESS.exec(line);
    if (!n) continue;
    const name = n[4]!;
    const ids = variantIds(name);
    if (ids.size === 0) continue;
    ctx.bump("noPressOfOwnVariant");
    const unit = ctx.unitOfPid(n[3]);
    if (!unit) continue;
    const lo = ctx.start + (+n[1]! * 60 + +n[2]!) * 1000;
    const press = successesOf(unit).find(
      (c: any) =>
        ids.has(String(c.spellId)) &&
        tsOf(c) >= lo - 1000 &&
        tsOf(c) < lo + 1000,
    );
    if (press)
      ctx.violate(
        "noPressOfOwnVariant",
        "sameSecond",
        tsOf(press),
        `${unit.name}#${name}#${tsOf(press)}`,
        `${unit.name} ${name} (no press), cast row ${press.spellId} at +${tsOf(press) - ctx.start}ms`,
        line,
      );
  }
}

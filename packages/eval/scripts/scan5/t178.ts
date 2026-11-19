/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, missesIn) */
/**
 * scan5/t178.ts — ticket T178 (GH #221 g1): a reflected control is stated
 * once. Its `[REFLECTED]` line always prints (a control passes that line's
 * door whatever came back), and the legend says a failed control "on a
 * [REFLECTED] line is not repeated here" — yet the cast sweep still printed
 * a credited `[CC AVOIDED?] … logged REFLECT; <aura> active` line beside it.
 *
 *  - `reflectStatedTwice` reads every `[CC AVOIDED?]` line whose outcome is
 *    `logged REFLECT` (credited or bare) and finds the log rows it states:
 *    the holder's REFLECT miss rows of that spell in the line's second from
 *    the line's caster (or a summon of it). Violation: one of those rows is
 *    a row a printed `[REFLECTED]` line states — the producer's own set
 *    (`reflectLineRowKeys`: every row of the chain the line is built from,
 *    keyed by the row's caster, reflector, ms and spell), not a reading of
 *    the line's text (codex 85-tk-CC-T178-1b: a chain's later rows print on
 *    its first second; two casters' reflects in one second are two rows).
 *    Kind = credited / bare | the aura named. Out of the total: a line
 *    whose rows no `[REFLECTED]` line states (its only statement, which
 *    stays), and a line whose row is not found.
 */
import {
  reflectLineRowKeys,
  reflectRowKey,
} from "@gladlog/analysis/src/context/spellOutcomeLines";

import { type IRoundCtx, nameOf, secOf, tsOf } from "./ctx";

export const CHECKS = ["reflectStatedTwice"] as const;
const ONLY_STATEMENT = "no [REFLECTED] line states its row (stays)";
const NO_ROW = "the line's REFLECT row is not found";
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  `reflectStatedTwice|${ONLY_STATEMENT}`,
  `reflectStatedTwice|${NO_ROW}`,
]);

const AVOIDED_REFLECT =
  /^\s*(\d+:\d\d)\s+\[CC AVOIDED\?\]\s+(\d+)\([^)]*\): (.+?) \(by (\d+)\(.*?\) logged REFLECT(?:; (.+?) (?:\([^)]*\) )?(?:active|was up|pressed)|$| — )/;

export function run(ctx: IRoundCtx): void {
  const C = "reflectStatedTwice";
  let keys: Set<string> | undefined;
  const byId = new Map<string, any>(ctx.units.map((u: any) => [u.id, u]));
  for (const line of ctx.lines) {
    const m = AVOIDED_REFLECT.exec(line);
    if (!m) continue;
    ctx.bump(C);
    const sec = secOf(m[1]!);
    const holder = ctx.unitOfPid(m[2]!);
    const caster = ctx.unitOfPid(m[4]!);
    const rows = ((holder?.missesIn ?? []) as any[]).filter((r) => {
      if (r.missType !== "REFLECT" || !r.spellId) return false;
      if (nameOf(r.spellId, r.spellName) !== m[3]) return false;
      if (Math.floor((tsOf(r) - ctx.start) / 1000) !== sec) return false;
      const src = byId.get(r.srcUnitId);
      return !!caster && (src?.id === caster.id || src?.ownerId === caster.id);
    });
    keys ??= reflectLineRowKeys(
      ctx.units,
      ctx.start,
      (ctx.end - ctx.start) / 1000,
    );
    const stated = rows.some((r) =>
      keys!.has(reflectRowKey(r.srcUnitId, holder.id, tsOf(r), m[3]!)),
    );
    ctx.violate(
      C,
      !rows.length
        ? NO_ROW
        : stated
          ? `${m[5] ? "credited" : "bare"} | ${m[5] ?? "no aura named"}`
          : ONLY_STATEMENT,
      ctx.start + sec * 1000,
      `${ctx.roundKey}:${holder?.id ?? m[2]}:${m[3]}:${sec}`,
      `${m[3]} reflected by ${holder?.name ?? m[2]}`,
      line.trim().slice(0, 240),
    );
  }
}

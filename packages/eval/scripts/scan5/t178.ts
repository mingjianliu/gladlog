/**
 * scan5/t178.ts — ticket T178 (GH #221 g1): a reflected control is stated
 * once. Its `[REFLECTED]` line always prints (a control passes that line's
 * door whatever came back), and the legend says a failed control "on a
 * [REFLECTED] line is not repeated here" — yet the cast sweep still printed
 * a credited `[CC AVOIDED?] … logged REFLECT; <aura> active` line beside it.
 *
 *  - `reflectStatedTwice` reads the rendered timeline: every `[CC AVOIDED?]`
 *    line whose outcome is `logged REFLECT` (credited or bare) is checked;
 *    a violation is one with a `[REFLECTED]` line of the same spell and the
 *    same reflector in that second ±1 (kind = credited / bare | the aura
 *    named). Out of the total: a `logged REFLECT` line with no such
 *    `[REFLECTED]` line — the only statement of that reflect (a silence
 *    with nothing back), which stays.
 */
import { type IRoundCtx, parseReflectedLine, secOf } from "./ctx";

export const CHECKS = ["reflectStatedTwice"] as const;
const ONLY_STATEMENT = "no [REFLECTED] line states it (stays)";
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  `reflectStatedTwice|${ONLY_STATEMENT}`,
]);

const AVOIDED_REFLECT =
  /^\s*(\d+:\d\d)\s+\[CC AVOIDED\?\]\s+(\d+)\([^)]*\): (.+?) \(by .*?\) logged REFLECT(?:; (.+?) (?:\([^)]*\) )?(?:active|was up|pressed)|$| — )/;

export function run(ctx: IRoundCtx): void {
  const C = "reflectStatedTwice";
  const reflected = ctx.lines
    .map((l) => parseReflectedLine(l))
    .filter((r): r is NonNullable<typeof r> => r !== null);
  for (const line of ctx.lines) {
    const m = AVOIDED_REFLECT.exec(line);
    if (!m) continue;
    ctx.bump(C);
    const sec = secOf(m[1]!);
    const twin = reflected.find(
      (r) =>
        r.reflectorPid === m[2] &&
        // a summon's reflect prints `N(…)'s pet's X` / `'s guardian's X`:
        // the qualifier is the caster's, not the spell's (codex
        // 85-tk-CC-T178-1 #2)
        r.spell.replace(/^(?:pet|guardian)'s /, "") === m[3] &&
        Math.abs(r.sec - sec) <= 1,
    );
    const holder = ctx.unitOfPid(m[2]!);
    ctx.violate(
      C,
      twin
        ? `${m[4] ? "credited" : "bare"} | ${m[4] ?? "no aura named"}`
        : ONLY_STATEMENT,
      ctx.start + sec * 1000,
      `${ctx.roundKey}:${holder?.id ?? m[2]}:${m[3]}:${sec}`,
      `${m[3]} reflected by ${holder?.name ?? m[2]}`,
      line.trim().slice(0, 240),
    );
  }
}

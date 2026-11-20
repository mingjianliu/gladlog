/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units) */
/**
 * scan5/t50.ts — pipeline T50: window-start readiness printed as the whole
 * window's state. f22d547e: `[KILL WINDOW] 2:01–2:08 … your CC on cooldown;
 * you cast no CC` while the owner's Hammer of Justice, pressed at 1:32.25 on
 * a 30 s cooldown, was back from 2:02.25 — ready for 5.75 of the 7 s.
 *
 * Check `killWindowCcBack`. Counted: every `[KILL WINDOW]` / `[VULNERABLE]`
 * line of the owner's context that prints `your CC on cooldown`. For each,
 * the owner's controls are the producer's own (`ownerCcSpellsOf`) and each
 * one's return is the producer's `ownerCcBackSecond` over the line's own
 * rendered `a–b` (the whole seconds a+1 … b, the owner alive) — the scan
 * re-implements neither the control set nor the cooldown model. Violations:
 *  - `backUnsaid`: a control is back inside the window and the line does not
 *    say so;
 *  - `backMismatch`: the line's `(back inside: X m:ss、…)` is not that set.
 */
import {
  ownerCcBackClause,
  ownerCcBackSecond,
  ownerCcSpellsOf,
} from "@gladlog/analysis/src/utils/healerOffenseAnalysis";
import { firstDeathMs } from "@gladlog/analysis/src/utils/unitDeath";

import { type IRoundCtx, secOf } from "./ctx";

export const CHECKS = ["killWindowCcBack"] as const;

export const LINE_RE =
  /^\s+\[(?:KILL WINDOW|VULNERABLE)\] (\d+:\d\d)–(\d+:\d\d).*?; your CC on cooldown( \(back inside: .*? \d+:\d\d\))?;/;

export function run(ctx: IRoundCtx): void {
  if (!ctx.owner) return;
  let spells: ReturnType<typeof ownerCcSpellsOf> | undefined;
  for (const l of ctx.lines) {
    const m = LINE_RE.exec(l);
    if (!m) continue;
    ctx.bump("killWindowCcBack");
    spells ??= ownerCcSpellsOf(ctx.legacy as any, ctx.owner as any);
    const from = secOf(m[1]!);
    const to = secOf(m[2]!);
    const start = (ctx.legacy as any).startTime as number;
    const deadFrom = (firstDeathMs(ctx.owner as any) - start) / 1000;
    const ownerCCBack =
      from >= deadFrom
        ? []
        : spells.flatMap((s) => {
            const atSeconds = ownerCcBackSecond(s, from, to, deadFrom);
            return atSeconds === undefined
              ? []
              : [{ spellName: s.spellName, atSeconds }];
          });
    const want = ownerCcBackClause({ ownerCCBack });
    const got = m[3] ?? "";
    if (want === got) continue;
    const first = ownerCCBack[0];
    ctx.violate(
      "killWindowCcBack",
      got === "" ? "backUnsaid" : "backMismatch",
      start + (first?.atSeconds ?? from) * 1000,
      `${ctx.owner.id}|${m[1]}|${m[2]}`,
      `window ${m[1]}–${m[2]} prints \`your CC on cooldown${got}\`; the producer's readiness gives \`${want.trim() || "(none back)"}\``,
      l.trim().slice(0, 160),
    );
  }
}

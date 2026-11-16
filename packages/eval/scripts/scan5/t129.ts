/**
 * scan5/t129.ts — pipeline T129 (CXA13 D30): a death-setup row's `chain=`
 * printed `Freezing Trap 72.1-78.1` in a Solo Shuffle round whose deciding
 * death was at 75.1 — the cannot-cast interval's raw end (its REMOVED row,
 * logged after the round) — while the same trap's `[CC ON TEAM]` line, built
 * from the round-end-clipped CC instances, says it was still on when the
 * round ended.
 *
 *  - `deathChainPastRoundEnd`: every `name[ (tag)] a-b` entry of a death-setup
 *    `chain=`; a violation when its rendered end `b` lies past the round end
 *    the CC instances and roots are cut at (`roundEndMs`, the producer's
 *    function) on the facts grid (`fmtFactTime`, floor to 0.1 s).
 *  - `cdHoardedOwnerCcPastRoundEnd`: every `name … -a…+bs` block of a
 *    cd-hoarded `ownerCc=` (offsets from facts.t); a violation when `t + b`
 *    lies past the round end that row's owner gate cuts its window at
 *    (`min(endTime, playableEndMs)`, candidateFindings' `roundEndMs`), past
 *    the 0.1 s rounding of the offset.
 *
 * Kind = the entry's spell name.
 */
import {
  playableEndMs,
  roundEndMs,
} from "@gladlog/analysis/src/utils/roundEnd";

import { type IRoundCtx } from "./ctx";

export const CHECKS = [
  "deathChainPastRoundEnd",
  "cdHoardedOwnerCcPastRoundEnd",
] as const;

const DEATH_ROW = /type=death-setup .*?chain=([^=]*?), chainFrom=/;
const CHAIN_ENTRY = /\s*(.+?) ([\d.]+)-([\d.]+)$/;
const HOARD_ROW =
  /type=cd-hoarded .*?facts=\{t=(\d+),.*?ownerCc=([^=]*?), ownerFreeS=/;
const HOARD_BLOCK =
  /\s*(.+?) ([+-][\d.]+)…(?:([+-][\d.]+)s|\(no end logged\))$/;

export function run(ctx: IRoundCtx): void {
  const combat = {
    endTime: ctx.end,
    startInfo: ctx.legacy.startInfo,
    units: ctx.legacy.units,
  };
  const units = Object.values(ctx.legacy.units ?? {});
  // death-setup: the CC instances' / roots' cut (ccTrinketAnalysis)
  const deathEndS = Math.floor((roundEndMs(combat) - ctx.start) / 100) / 10;
  // cd-hoarded: the owner gate's cut (candidateFindings)
  const hoardEndS =
    (Math.min(ctx.end, playableEndMs(combat, units) ?? Infinity) - ctx.start) /
    1000;
  for (const row of ctx.menu.split("\n")) {
    const d = DEATH_ROW.exec(row);
    if (d)
      for (const part of d[1]!.split(";")) {
        const m = CHAIN_ENTRY.exec(part);
        if (!m) continue;
        ctx.bump("deathChainPastRoundEnd");
        const endS = Number(m[3]);
        if (!(endS > deathEndS + 1e-6)) continue;
        ctx.violate(
          "deathChainPastRoundEnd",
          m[1]!.replace(/ \((?:root|school lockout|own flight)\)$/, ""),
          ctx.start + Number(m[2]) * 1000,
          `${m[1]}:${m[2]}`,
          `chain entry ${m[1]} ${m[2]}-${m[3]} ends past the round end ${deathEndS}`,
          row.trim().slice(0, 240),
        );
      }
    const h = HOARD_ROW.exec(row);
    if (h)
      for (const part of h[2]!.split(";")) {
        const m = HOARD_BLOCK.exec(part);
        if (!m || m[3] === undefined) continue;
        ctx.bump("cdHoardedOwnerCcPastRoundEnd");
        const endS = Number(h[1]) + Number(m[3]);
        if (!(endS > hoardEndS + 0.05 + 1e-6)) continue;
        ctx.violate(
          "cdHoardedOwnerCcPastRoundEnd",
          m[1]!.replace(/ lockout.*$/, ""),
          ctx.start + Number(h[1]) * 1000,
          `${h[1]}:${m[1]}:${m[2]}`,
          `ownerCc block ${m[1]} ${m[2]}…${m[3]}s from t=${h[1]} ends at ${endS.toFixed(1)}, past the round end ${hoardEndS.toFixed(1)}`,
          row.trim().slice(0, 240),
        );
      }
  }
}

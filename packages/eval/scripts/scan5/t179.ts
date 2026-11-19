/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units) */
/**
 * scan5/t179.ts — ticket T179 (GH #221 g1, #218 8.1): the `ENEMY CC KIT`
 * line promises "every control that landed on you|them this round", yet it
 * printed only in a round with a burst-window threat.
 *
 *  - `kitAbsentWithControls`: per context whose side has a healer (the
 *    kit's unit — the producer's choice, the first friendly `isHealerSpec`
 *    player). Violation: no `ENEMY CC KIT (` line while the timeline prints
 *    a `[CC ON TEAM]` / `[SILENCE]` line on that unit from an enemy roster
 *    label (the gate's reading, `checkEnemyCcKitLanded`: a dispel backlash
 *    is no landed control) — kind `landed` — or, with none, the producer's
 *    `aimedControlsForKit` lists a control aimed at it — kind `aimed only`.
 *    Counted: every such context.
 */
import { backlashCcTag } from "@gladlog/analysis/src/data/backlashCc";
import { isHealerSpec } from "@gladlog/analysis/src/utils/cooldowns";
import { aimedControlsForKit } from "@gladlog/analysis/src/utils/healerExposureAnalysis";
import { roundEndMs } from "@gladlog/analysis/src/utils/roundEnd";

import { type IRoundCtx } from "./ctx";

export const CHECKS = ["kitAbsentWithControls"] as const;

const ON_UNIT =
  /^\s*\d+:\d\d\s+\[(?:CC ON TEAM|SILENCE)\]\s+(\d+)\([^()]*\) ← (.+?) \(by (\d+)\([^()]*\)/;

export function run(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  if (!owner) return;
  const C = "kitAbsentWithControls";
  const friends = (ctx.players as any[]).filter(
    (p) => p.reaction === owner.reaction,
  );
  const enemies = (ctx.players as any[]).filter(
    (p) => p.reaction !== owner.reaction,
  );
  const healer = friends.find((p) => isHealerSpec(p.spec));
  const pid = healer && ctx.pidOf(healer.name);
  if (!healer || !pid) return;
  ctx.bump(C);
  if (ctx.lines.some((l) => l.startsWith("ENEMY CC KIT ("))) return;
  const enemyPids = new Set(enemies.map((e) => ctx.pidOf(e.name)));
  const landed = ctx.lines.filter((l) => {
    const m = ON_UNIT.exec(l);
    return (
      !!m &&
      m[1] === pid &&
      enemyPids.has(m[3]) &&
      !l.includes(backlashCcTag("silence"))
    );
  });
  const aimed = landed.length
    ? []
    : aimedControlsForKit(
        healer,
        enemies,
        ctx.start,
        roundEndMs(ctx.legacy),
        ctx.units,
      );
  if (!landed.length && !aimed.length) return;
  ctx.violate(
    C,
    landed.length ? "landed" : "aimed only",
    ctx.start,
    `${ctx.roundKey}:${owner.id}`,
    landed.length
      ? `${landed.length} control line(s) on ${healer.name}, no kit line`
      : `${aimed.map((a) => `${a.spellName} ×${a.count}`).join(", ")} aimed at ${healer.name}, no kit line`,
    landed[0]?.trim().slice(0, 240),
  );
}

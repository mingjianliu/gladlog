/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units) */
/**
 * scan5/t173.ts — ticket T173 (round 14 D18): a `[HEALER EXPOSURE]` line
 * says what threatens the team's healer at a burst window. A dead healer is
 * threatened by nothing.
 *
 *  - `exposureAfterHealerDeath`: a `[HEALER EXPOSURE]` line at a second the
 *    producer's own predicate (`healerDeadAtExposureWindow`, the `[STATE]`
 *    tick's `dead`) reads the line's subject dead — kind `healer dead`.
 *    Checked = every `[HEALER EXPOSURE]` line of a round whose team has a
 *    healer. 95d4affb 6:43: `healer trinket ready … LoS break ~20.5yd
 *    away`, the healer dead since 6:41.890 (a 3v3 that went on).
 *    Inventory, not in the total: kind `threat is a dead enemy` — an enemy
 *    the line lists (IN LoS or pillar-blocked) dead at that second by the
 *    same reading.
 */
import {
  isDeadAtRenderSecond,
  isHealerSpec,
  specToString,
} from "@gladlog/analysis/src/utils/cooldowns";
import { healerDeadAtExposureWindow } from "@gladlog/analysis/src/utils/healerExposureAnalysis";

import { type IRoundCtx } from "./ctx";

export const CHECKS = ["exposureAfterHealerDeath"] as const;
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "exposureAfterHealerDeath|threat is a dead enemy",
]);

const EXPOSURE = /^\s*(\d+):(\d\d)\s+\[HEALER EXPOSURE\]\s+(.*)$/;

export function run(ctx: IRoundCtx): void {
  const friends = ctx.players.filter(
    (u: any) => u.reaction === ctx.owner.reaction,
  );
  const enemies = ctx.players.filter(
    (u: any) => u.reaction !== ctx.owner.reaction,
  );
  const healer = friends.find((u: any) => isHealerSpec(u.spec));
  if (!healer) return;
  const enemyOf = (ref: string): any => {
    const pid = /\((\d+)\(/.exec(ref);
    if (pid) return ctx.unitOfPid(pid[1]);
    const spec = ref.replace(/\s*\(.*$/, "").trim();
    const of = enemies.filter((u: any) => specToString(u.spec) === spec);
    return of.length === 1 ? of[0] : undefined;
  };
  for (const line of ctx.lines) {
    const m = EXPOSURE.exec(line);
    if (!m) continue;
    const sec = Number(m[1]) * 60 + Number(m[2]);
    const ms = ctx.start + sec * 1000;
    ctx.bump("exposureAfterHealerDeath");
    if (healerDeadAtExposureWindow(healer, ctx.start, sec))
      ctx.violate(
        "exposureAfterHealerDeath",
        "healer dead",
        ms,
        `${ctx.roundKey}:${healer.id}:${sec}`,
        `${healer.name} died ${(((healer.deathRecords ?? []) as any[]).reduce((a, d) => Math.max(a, d.timestamp), 0) - ctx.start) / 1000} s`,
        line.trim().slice(0, 240),
      );
    for (const seg of m[3]!.split(" | ")) {
      const refs = seg.startsWith("IN LoS: ")
        ? seg
            .slice("IN LoS: ".length)
            .split("; ")
            .map((e) => e.slice(0, e.indexOf(": ")))
        : seg.startsWith("Pillar-blocked: ")
          ? seg
              .slice("Pillar-blocked: ".length)
              .split(", ")
              .map((e) => e.trim())
          : [];
      for (const ref of refs) {
        const enemy = enemyOf(ref);
        if (enemy && isDeadAtRenderSecond(enemy, ctx.start, sec))
          ctx.violate(
            "exposureAfterHealerDeath",
            "threat is a dead enemy",
            ms,
            `${ctx.roundKey}:${enemy.id}:${sec}`,
            `${enemy.name} listed, dead at that second`,
            line.trim().slice(0, 240),
          );
      }
    }
  }
}

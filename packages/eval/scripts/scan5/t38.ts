/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, advancedActions) */
/**
 * scan5/t38.ts — pipeline T38 (GH #206, #141 item 4, #148 item 6b): a
 * `[HEALER EXPOSURE]` line's line-of-sight claim read on interpolated points.
 * The line sorts each threatening enemy into `IN LoS:` or `Pillar-blocked:`
 * from a sweep of the whole seconds within `LOS_SWEEP_SLACK_S` of its
 * printed second. Line of sight is topological (`losAnalysis` contract): it
 * reads the two units' nearest RAW samples, never a point interpolated
 * between two samples — which can sit inside a pillar neither sample is
 * behind, or in the open between two samples that are both behind one.
 *
 * Truth = `rawLosSweepInSight` — that sweep on raw samples (within
 * `LOS_SWEEP_GAP_MS`, then the arena geometry): in sight if any swept second
 * with a sample pair is not blocked. The producer's own reading, called,
 * never re-implemented (FIX-CONTRACT §7); the 605 base count was taken with
 * a copy of it in this file, before the producer had it.
 *
 * Check `exposureLosRawSweep`, kinds `in-los` (listed IN LoS, every raw pair
 * of the sweep blocked) and `blocked` (listed Pillar-blocked, a raw pair of
 * the sweep in sight). A claim whose enemy cannot be told apart (two of one
 * spec without a unit label) or has no raw pair in the sweep is not counted.
 */
import { isHealerSpec, specToString } from "@gladlog/analysis";
import { rawLosSweepInSight } from "@gladlog/analysis/src/utils/losAnalysis";
import { LOS_SWEEP_SLACK_S } from "@gladlog/analysis/src/utils/positionSampling";

import type { IRoundCtx } from "./ctx";

export const CHECKS = ["exposureLosRawSweep"] as const;

const EXPOSURE = /^\s*(\d+):(\d\d)\s+\[HEALER EXPOSURE\]\s+(.*)$/;

export function run(ctx: IRoundCtx): void {
  const zone = String(ctx.legacy?.startInfo?.zoneId ?? "");
  if (!zone) return;
  const friends = ctx.players.filter(
    (u: any) => u.reaction === ctx.owner.reaction,
  );
  const enemies = ctx.players.filter(
    (u: any) => u.reaction !== ctx.owner.reaction,
  );
  // the line's subject: the friendly healer (`healerExposureAnalysis`
  // anchors on it), the owner when the team has none
  const subject = friends.find((u: any) => isHealerSpec(u.spec)) ?? ctx.owner;
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
    const claims: { ref: string; inLos: boolean }[] = [];
    for (const seg of m[3]!.split(" | ")) {
      if (seg.startsWith("IN LoS: "))
        for (const e of seg.slice("IN LoS: ".length).split("; "))
          claims.push({ ref: e.slice(0, e.indexOf(": ")), inLos: true });
      else if (seg.startsWith("Pillar-blocked: "))
        for (const e of seg.slice("Pillar-blocked: ".length).split(", "))
          claims.push({ ref: e.trim(), inLos: false });
    }
    for (const c of claims) {
      const enemy = enemyOf(c.ref);
      if (!enemy || enemy.id === subject.id) continue;
      const truth = rawLosSweepInSight(zone, subject, enemy, ms);
      if (truth === null) continue;
      ctx.bump("exposureLosRawSweep");
      if (truth === c.inLos) continue;
      ctx.violate(
        "exposureLosRawSweep",
        c.inLos ? "in-los" : "blocked",
        ms,
        `${subject.id}:${enemy.id}:${sec}`,
        c.inLos
          ? `${c.ref} listed IN LoS at ${m[1]}:${m[2]}: every raw sample pair within ${LOS_SWEEP_SLACK_S}s is line-of-sight blocked`
          : `${c.ref} listed Pillar-blocked at ${m[1]}:${m[2]}: a raw sample pair within ${LOS_SWEEP_SLACK_S}s is in line of sight`,
        line,
      );
    }
  }
}

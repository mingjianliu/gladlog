/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, advancedActions) */
/**
 * scan5/t31.ts — pipeline T31 (codex review of batch B5): a control
 * suggestion's reach instant read in line of sight on interpolated points.
 * `[PEEL OPTION]` and `[CC BOOKMARK]` print `at M:SS: Nyd` — the first second
 * the control was usable and reached the target (`ccSamplerFor` →
 * `ccReachAt`). Line of sight is topological (`losAnalysis` contract): it
 * reads the nearest RAW samples, never an interpolated point between them.
 * Truth = `rawLineOfSightAt` (the two units' nearest raw position rows
 * within the sampler's `INTERP_MAX_GAP_MS` of that second, then the arena
 * geometry) — the producer's own reading, called, never re-implemented
 * (FIX-CONTRACT §7, 2026-11-08).
 *
 * Check `ccReachRawLos`, kinds `peel` / `bookmark`: the printed instant has
 * a raw sample pair on both units and the geometry says the pair is blocked.
 */
import {
  getUnitRawPositionAtTime,
  rawLineOfSightAt,
} from "@gladlog/analysis/src/utils/losAnalysis";
import { INTERP_MAX_GAP_MS } from "@gladlog/analysis/src/utils/positionSampling";

import type { IRoundCtx } from "./ctx";

export const CHECKS = ["ccReachRawLos"] as const;

const PEEL =
  /^(\d+):(\d\d)–\d+:\d\d\s+\[PEEL OPTION\]\s+(\d+)\([^)]*\) (.+?) → (\d+)\([^)]*\).*\| at (\d+):(\d\d): ([\d.]+)yd/;
const BOOKMARK =
  /^(\d+):(\d\d)–\d+:\d\d\s+\[CC BOOKMARK\]\s+(.+?) → (\d+)\([^)]*\).*\| at (\d+):(\d\d): ([\d.]+)yd/;
export function run(ctx: IRoundCtx): void {
  const zone = String(ctx.legacy?.startInfo?.zoneId ?? "");
  if (!zone) return;
  for (const line of ctx.lines) {
    let kind: "peel" | "bookmark";
    let caster: any;
    let target: any;
    let sec: number;
    let spell: string;
    const p = PEEL.exec(line);
    const b = p ? null : BOOKMARK.exec(line);
    if (p) {
      kind = "peel";
      caster = ctx.unitOfPid(p[3]);
      spell = p[4]!;
      target = ctx.unitOfPid(p[5]);
      sec = Number(p[6]) * 60 + Number(p[7]);
    } else if (b) {
      kind = "bookmark";
      caster = ctx.owner;
      spell = b[3]!;
      target = ctx.unitOfPid(b[4]);
      sec = Number(b[5]) * 60 + Number(b[6]);
    } else continue;
    if (!caster || !target) continue;
    ctx.bump("ccReachRawLos");
    const ms = ctx.start + sec * 1000;
    if (rawLineOfSightAt(zone, caster, target, ms, INTERP_MAX_GAP_MS) !== false)
      continue;
    // the pair the reading used, for the example line
    const a = getUnitRawPositionAtTime(caster, ms, INTERP_MAX_GAP_MS)!;
    const t = getUnitRawPositionAtTime(target, ms, INTERP_MAX_GAP_MS)!;
    ctx.violate(
      "ccReachRawLos",
      kind,
      ms,
      `${kind}:${caster.id}:${target.id}:${sec}`,
      `${spell} → ${target.name} at ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}: the raw samples (${a.x.toFixed(1)}, ${a.y.toFixed(1)}) → (${t.x.toFixed(1)}, ${t.y.toFixed(1)}) are line-of-sight blocked`,
      line,
    );
  }
}

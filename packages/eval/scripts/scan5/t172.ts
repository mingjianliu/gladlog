/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents) */
/**
 * scan5/t172.ts — ticket T172 (GH #218 item 12.5): a line-of-sight test
 * reads the two units' nearest RAW position samples (`rawLineOfSightAt`,
 * the `losAnalysis` contract); two readers read one interpolated or
 * last-known point.
 *
 *  - `ccLineLosTag` reads `[CC ON TEAM]` lines that print `Nyd from
 *    caster`. Their `, LoS blocked` tag is a claim, made only where the raw
 *    sample pair AND the interpolated points both say blocked at the
 *    control's landing (`losBlockedOnBothReadings`, caster → holder, the
 *    aura row's source, `CC_POSITION_MAX_GAP_MS`; user ruling R70) and no
 *    targeted cast of the control landed on the holder
 *    (`landedCastProvesLos`) — the producer's two predicates, called. Both
 *    directions are counted: a tagged line the predicates do not back, an
 *    untagged line they do. Checked = every such line whose control
 *    instance (the producer's own, `analyzePlayerCCAndTrinket`) and caster
 *    are found. Out of the total, the lines where the two single
 *    readings disagree (each direction).
 *  - `deathExternalLos` reads the death block's `[m:ss] <unit> died —
 *    <teammate> had <external> available` lines: "available" is the claim,
 *    made only where neither reading says the teammate could not see the
 *    dying unit at the death (`losBlockedOnEitherReading`,
 *    `LOS_SWEEP_GAP_MS`; user ruling R72) — the producer's predicate,
 *    called. Checked = every such line whose two units and death row are
 *    found.
 *  - `deathTraceLosSkip` (inventory of the log, all kinds out of the
 *    total): for each friendly death and each living teammate, the skip
 *    (checked = every such pair) read the old way (one
 *    `getUnitPositionAtTime` point each, no gap bound) against the
 *    producer's. The old reading lives here only, as
 *    the reference the count is taken against.
 */
import { arenaObstacles } from "@gladlog/analysis/src/data/arenaGeometry";
import {
  analyzePlayerCCAndTrinket,
  CC_POSITION_MAX_GAP_MS,
  type ICCInstance,
  landedCastProvesLos,
} from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import {
  getUnitPositionAtTime,
  hasLineOfSight,
  losBlockedOnBothReadings,
  losBlockedOnEitherReading,
  rawLineOfSightAt,
} from "@gladlog/analysis/src/utils/losAnalysis";
import { LOS_SWEEP_GAP_MS } from "@gladlog/analysis/src/utils/positionSampling";

import { type IRoundCtx, secOf } from "./ctx";

export const CHECKS = [
  "ccLineLosTag",
  "deathExternalLos",
  "deathTraceLosSkip",
] as const;
const DEATH_LINE = /^\s*\[(\d+:\d\d)\] (\S+) died — (\S+) had .+? available/;
const DEATH_KINDS = [
  "old reading blocked, neither reading blocked now",
  "old reading not blocked, a reading blocked now",
];
const CC_KINDS = [
  "tagged, not blocked on both readings (or a targeted cast landed)",
  "untagged, blocked on both readings",
];
const SPLIT_KINDS = [
  "raw pair blocked, interpolated point in sight",
  "interpolated point blocked, raw pair in sight",
];
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  ...DEATH_KINDS.map((k) => `deathTraceLosSkip|${k}`),
  ...SPLIT_KINDS.map((k) => `ccLineLosTag|${k}`),
]);

const CC_LINE =
  /^(\d+:\d\d)\s+\[CC ON TEAM\]\s+(\d+)\([^)]*\) ← (.+?) \((?:by |reflected back)[^|]*\| .*?[\d.]+yd from caster(, LoS blocked)?/;

export function run(ctx: IRoundCtx): void {
  const zoneId = ctx.legacy.startInfo?.zoneId as string | undefined;
  if (!zoneId || !arenaObstacles[zoneId]?.length) return;
  const byId = new Map<string, any>(ctx.units.map((u) => [u.id, u]));

  const players = ctx.players as any[];
  const instancesByHolder = new Map<string, ICCInstance[]>();
  const instancesOf = (holder: any): ICCInstance[] => {
    let list = instancesByHolder.get(holder.id);
    if (!list) {
      const opponents = players.filter((o) => o.reaction !== holder.reaction);
      const oppIds = new Set(opponents.map((o) => o.id));
      list = [
        ...analyzePlayerCCAndTrinket(
          holder,
          opponents,
          ctx.legacy as never,
          ctx.units.filter((u: any) => u.ownerId && oppIds.has(u.ownerId)),
        ).ccInstances,
      ].sort((a, b) => a.atSeconds - b.atSeconds);
      instancesByHolder.set(holder.id, list);
    }
    return list;
  };
  for (const line of ctx.lines) {
    const m = CC_LINE.exec(line);
    if (!m) continue;
    const holder = ctx.unitOfPid(m[2]);
    if (!holder) continue;
    const atS = secOf(m[1]!);
    // the line's own application is the producer's: the control instance
    // its line is printed from (`analyzePlayerCCAndTrinket`, the holder's
    // instances of that name on that rendered second, taken in order) —
    // its landing ms, aura id and source. The scan paired aura rows itself
    // before and met the producer's pairing rules one at a time: Binding
    // Shot's tether 117405 under the stun's name (605: f55b2412 r4 1:57), a
    // line opened on a recast's REFRESH, a periodic re-broadcast beside it
    // (codex 85-tk-CC-T172-1 #2, -2 #1, -2b, -2c).
    const instances = instancesOf(holder);
    const at = instances.findIndex(
      (c) => Math.floor(c.atSeconds) === atS && c.spellName === m[3],
    );
    if (at < 0) continue;
    const [inst] = instances.splice(at, 1);
    const caster = byId.get(inst!.sourceId);
    if (!caster || caster.id === holder.id) continue;
    const applied = { spellId: inst!.spellId };
    const ms = Math.round((ctx.start + inst!.atSeconds * 1000) * 10) / 10;
    ctx.bump("ccLineLosTag");
    // the producer's two predicates, called (FIX-CONTRACT §7)
    const blocked = losBlockedOnBothReadings(
      zoneId,
      caster,
      holder,
      ms,
      CC_POSITION_MAX_GAP_MS,
    );
    const tagged = !!m[4];
    const landedCast = landedCastProvesLos(
      caster.spellCastEvents ?? [],
      String(applied.spellId),
      holder.id,
      ms,
    );
    const kind =
      tagged && (blocked !== true || landedCast)
        ? CC_KINDS[0]
        : !tagged && blocked === true && !landedCast
          ? CC_KINDS[1]
          : undefined;
    const fact = `${ctx.roundKey}:${holder.id}:${applied.spellId}:${ms}`;
    if (kind)
      ctx.violate(
        "ccLineLosTag",
        kind,
        ms,
        fact,
        `${m[3]} on ${holder.name}: blocked on both readings ${blocked}, landed cast ${landedCast}`,
        line.trim().slice(0, 240),
      );
    // inventory: the two single readings where they disagree
    const raw = rawLineOfSightAt(
      zoneId,
      caster,
      holder,
      ms,
      CC_POSITION_MAX_GAP_MS,
    );
    const a = getUnitPositionAtTime(caster, ms, CC_POSITION_MAX_GAP_MS);
    const b = getUnitPositionAtTime(holder, ms, CC_POSITION_MAX_GAP_MS);
    const interpolated = a && b ? hasLineOfSight(zoneId, a, b) : null;
    const split =
      raw === false && interpolated === true
        ? SPLIT_KINDS[0]
        : raw === true && interpolated === false
          ? SPLIT_KINDS[1]
          : undefined;
    if (split)
      ctx.violate(
        "ccLineLosTag",
        split,
        ms,
        fact,
        `${m[3]} on ${holder.name}${landedCast ? " (a targeted cast landed)" : ""}`,
        line.trim().slice(0, 240),
      );
  }

  // ── deathExternalLos ────────────────────────────────────────────────────
  for (const line of ctx.lines) {
    const m = DEATH_LINE.exec(line);
    if (!m) continue;
    const dead = (ctx.players as any[]).find((p) => p.name === m[2]);
    const mate = (ctx.players as any[]).find((p) => p.name === m[3]);
    const atS = secOf(m[1]!);
    const death = ((dead?.deathRecords ?? []) as any[]).find(
      (d) => Math.floor((d.timestamp - ctx.start) / 1000) === atS,
    );
    if (!dead || !mate || !death) continue;
    ctx.bump("deathExternalLos");
    if (
      losBlockedOnEitherReading(
        zoneId,
        mate,
        dead,
        death.timestamp,
        LOS_SWEEP_GAP_MS,
      ) === true
    )
      ctx.violate(
        "deathExternalLos",
        "external called available, a reading says its holder is blocked",
        death.timestamp,
        `${ctx.roundKey}:${dead.id}:${mate.id}:${death.timestamp}`,
        `${mate.name} at ${dead.name}'s death`,
        line.trim().slice(0, 240),
      );
  }

  if (!ctx.firstOwnerOfRound || !ctx.owner) return;
  const friends = (ctx.players as any[]).filter(
    (p) => p.reaction === ctx.owner.reaction,
  );
  for (const unit of friends)
    for (const d of (unit.deathRecords ?? []) as any[]) {
      const deathMs = d.timestamp as number;
      if (deathMs < ctx.start || deathMs > ctx.end) continue;
      const dyingPos = getUnitPositionAtTime(unit, deathMs);
      for (const mate of friends) {
        if (mate.id === unit.id) continue;
        if ((mate.deathRecords ?? []).some((x: any) => x.timestamp < deathMs))
          continue;
        ctx.bump("deathTraceLosSkip");
        const pos = getUnitPositionAtTime(mate, deathMs);
        const old =
          dyingPos && pos ? hasLineOfSight(zoneId, pos, dyingPos) : null;
        const now = losBlockedOnEitherReading(
          zoneId,
          mate,
          unit,
          deathMs,
          LOS_SWEEP_GAP_MS,
        );
        const kind =
          old === false && now !== true
            ? DEATH_KINDS[0]
            : old !== false && now === true
              ? DEATH_KINDS[1]
              : undefined;
        if (kind)
          ctx.violate(
            "deathTraceLosSkip",
            kind,
            deathMs,
            `${ctx.roundKey}:${unit.id}:${mate.id}:${deathMs}`,
            `${mate.name} at ${unit.name}'s death`,
          );
      }
    }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- the legacy parse objects are untyped */
/**
 * scan5/t184.ts — ticket T184 (fact14 D26): a control that a friendly's
 * TOTEM or GUARDIAN landed on a burst caster is an answer timed by the
 * press that made it. When the totem pulsed for longer than the ground-
 * control fuse, the summon press fell outside the fuse and the answer's
 * time was taken from whatever untargeted press of the owner sat inside it
 * (bd6d44c1 1:36: an Earthgrab Totem dropped 2.7 s after the opener rooted
 * the death knight at 6.7 s; the line read "in 5.1s" — a Crash Lightning).
 *
 * THIS SCAN RE-RUNS THE ENGINE: its numbers are the checkout's.
 *
 *  - `summonControlTimedByOtherPress`: a control response of an engine
 *    window (every owner) whose landing aura came from a non-player, non-pet
 *    unit of the answering player, and whose instant is none of: the
 *    summon's own SPELL_SUMMON second, the aura's second, the second of a
 *    cast of the owner that makes the aura (same id, cast→effect, or the
 *    same name) or moves the totem (`TOTEM_RELOCATION_IDS`). A source with
 *    no summon row is not judged. Kind = the aura | the owner's press at that second.
 *    Counted: every such summon-landed control response.
 *  - `printedSummonControlAnswerDiffers`: a printed `[BURST ANSWERED]` line
 *    whose answer is a totem / guardian-landed control — in print (a
 *    control answer under a name the answering player never cast, or one
 *    the engine holds as a landed control in the round) or in the engine's
 *    credited answer for that window — and whose answer, time or targets
 *    are not what the checkout's engine credits. The first check re-reads
 *    the engine alone and so is 0 from the fixing checkout on any capture;
 *    this one reads the capture's own lines: non-zero on a capture taken
 *    before the fix, 0 on one taken with it. Kind = what differs.
 *    Counted: every such printed line.
 */
import {
  burstWindowDecisionPoints,
  TOTEM_RELOCATION_IDS,
} from "@gladlog/analysis/src/analysis/burstWindowDecisionPoints";
import {
  creditedAnswer,
  parseBurstAnsweredLine,
} from "@gladlog/analysis/src/context/burstAnswered";
import { isCastOrEffect } from "@gladlog/analysis/src/data/castEffectAuras";
import { summonedAtMs } from "@gladlog/analysis/src/utils/summonLife";

import { APPLIED, ev, type IRoundCtx, nameOf, successesOf, tsOf } from "./ctx";

export const CHECKS = [
  "summonControlTimedByOtherPress",
  "printedSummonControlAnswerDiffers",
] as const;

function printedLines(
  ctx: IRoundCtx,
  points: ReturnType<typeof burstWindowDecisionPoints>,
): void {
  const C = "printedSummonControlAnswerDiffers";
  const isLanded = (r: any) =>
    r.category === "control" && r.landed === undefined;
  const landedNames = new Set<string>(
    points.flatMap((p) =>
      p.responseCasts.filter(isLanded).map((r) => r.spellName),
    ),
  );
  for (const line of ctx.lines) {
    if (!line.includes("[BURST ANSWERED]")) continue;
    const a = parseBurstAnsweredLine(line);
    if (!a) continue;
    const p = points.find((x) => x.tSec === a.atSec);
    const credited = p ? creditedAnswer(p) : undefined;
    const unit = ctx.unitOfPid(/^(\d+)/.exec(a.answerer)?.[1]);
    const ownCastNames = new Set<string>(
      unit
        ? successesOf(unit).map((c: any) => nameOf(c.spellId, c.spellName))
        : [],
    );
    const printedIsSummon =
      a.controlOn.length > 0 &&
      (landedNames.has(a.spellName) ||
        (unit !== undefined && !ownCastNames.has(a.spellName)));
    if (!printedIsSummon && !(credited && isLanded(credited))) continue;
    ctx.bump(C);
    // every caster the credited press landed on. The renderer prints the
    // ones that answer the pressured unit (`controlTargetClause`, a
    // predicate this branch does not export), so the printed targets are
    // held to be a non-empty SUBSET of these, each by identity
    const engineTargets = new Set<string>(
      p && credited
        ? p.responseCasts
            .filter(
              (r) =>
                r.controlOn &&
                r.casterName === credited.casterName &&
                r.spellName === credited.spellName &&
                r.latencySec === credited.latencySec,
            )
            .map((r) => r.controlOn!.unitId)
        : [],
    );
    const printedTargets = a.controlOn.map(
      (t) =>
        ctx.unitOfPid(/^(\d+)/.exec(t.target)?.[1])?.id as string | undefined,
    );
    const kind = !p
      ? "the engine has no window at that second"
      : !credited
        ? "the engine credits no answer in that window"
        : credited.spellName !== a.spellName
          ? "the engine credits another answer"
          : unit !== undefined && unit.name !== credited.casterName
            ? "the answerer differs"
            : Math.abs(credited.latencySec - a.latencySec) > 0.05
              ? "the time differs"
              : printedTargets.length === 0 ||
                  printedTargets.length > engineTargets.size ||
                  printedTargets.some(
                    (id) => id !== undefined && !engineTargets.has(id),
                  )
                ? "the targets differ"
                : null;
    if (kind === null) continue;
    ctx.violate(
      C,
      kind,
      ctx.start + a.atSec * 1000,
      `${ctx.roundKey}|${ctx.owner.reaction}|${a.atSec}`,
      `printed: ${a.answerer} ${a.spellName} ${a.latencySec}s on ${a.controlOn.map((t) => t.target).join(" and ") || "-"}; engine: ${credited ? `${credited.casterName} ${credited.spellName} ${credited.latencySec}s` : "none"}`,
      line.trim(),
    );
  }
}

export function run(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  if (!owner) return;
  let points: ReturnType<typeof burstWindowDecisionPoints>;
  try {
    points = burstWindowDecisionPoints(ctx.legacy, {
      friendlyReaction: owner.reaction,
    });
  } catch {
    return;
  }
  printedLines(ctx, points);
  const C = "summonControlTimedByOtherPress";
  const sec = (ms: number): number => Math.floor((ms - ctx.start) / 1000);
  for (const p of points)
    for (const r of p.responseCasts) {
      const landing = r.controlOn?.auras[0];
      if (r.category !== "control" || !landing) continue;
      // a landed control carries its answering player by name alone
      const caster = ctx.units.find(
        (u: any) => u.info && u.name === r.casterName,
      );
      if (!caster) continue;
      const holder = ctx.units.find((u: any) => u.id === r.controlOn!.unitId);
      const row = ((holder?.auraEvents ?? []) as any[]).find(
        (a) =>
          ev(a) === APPLIED &&
          String(a.spellId) === landing.spellId &&
          tsOf(a) === landing.atMs,
      );
      const srcId: string | undefined = row?.srcUnitId;
      if (!srcId || srcId === caster.id || srcId.startsWith("Pet-")) continue;
      const src = ctx.units.find((u: any) => u.id === srcId);
      if (!src || src.info || src.ownerId !== caster.id) continue;
      ctx.bump(C);
      const auraName = nameOf(landing.spellId);
      const summoned = summonedAtMs(src);
      // no summon row: the producer keeps its untargeted-press fallback by
      // design — nothing to hold it to (codex 85-tk-CD-T184-1 #2)
      if (summoned === null) continue;
      const makes = (id: string): boolean =>
        id === landing.spellId ||
        isCastOrEffect(id, landing.spellId) ||
        (auraName !== "" && nameOf(id) === auraName);
      const casts = successesOf(caster);
      if (
        r.tSec === sec(landing.atMs) ||
        (summoned !== null && r.tSec === sec(summoned)) ||
        casts.some(
          (c: any) =>
            (makes(String(c.spellId)) ||
              TOTEM_RELOCATION_IDS.has(String(c.spellId))) &&
            sec(tsOf(c)) === r.tSec,
        )
      )
        continue;
      const other = casts.find((c: any) => sec(tsOf(c)) === r.tSec);
      ctx.violate(
        C,
        `${auraName} | ${other ? nameOf(other.spellId) : "no press at that second"}`,
        ctx.start + p.tSec * 1000,
        `${ctx.roundKey}|${owner.reaction}|${p.tSec}|${caster.id}|${landing.atMs}`,
        `window at ${p.tSec}s: ${auraName} landed on ${r.controlOn!.unitName} at ${((landing.atMs - ctx.start) / 1000).toFixed(1)}s from ${src.name}${summoned !== null ? ` (summoned ${((summoned - ctx.start) / 1000).toFixed(1)}s)` : " (no summon row)"}; the answer is timed at ${r.tSec}s (latency ${r.latencySec}s)`,
      );
    }
}

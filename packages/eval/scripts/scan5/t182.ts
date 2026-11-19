/* eslint-disable @typescript-eslint/no-explicit-any -- the legacy parse objects are untyped */
/**
 * scan5/t182.ts — ticket T182 (user ruling A6, extending R43): a self-cast
 * Master's Call — a root / snare freedom that takes no damage off its
 * caster — still counted as an answer in three places. Whether a redirect
 * on its caster is a save is the producer's own predicate
 * (`selfCastRedirectIsNoSave`, never replayed here).
 *
 *  - `selfRedirectAnswersBurst`: a judged burst window (feasible, triaged,
 *    a pressured friendly, at least `BURST_WINDOW_MIN_JUDGED_S` long, healer
 *    owner) whose `responseCasts` hold such a press. Kind = whether it is
 *    the window's only answer (the window turns unanswered) or stands
 *    beside others. Counted: every judged window with a response.
 *  - `selfRedirectPoppedInKillAttempt`: a kill-attempt line whose FAILED
 *    clause names such a press among the target's own saves (`popped X`).
 *    The target's own cast of it at or before the attempt's end must be on
 *    itself. Counted: every kill-attempt line with a `popped` list.
 *
 * cd-hoarded's `spent` through `ownerRedirectSaves` leaves no line when it
 * holds; its rows are counted by the capture diff.
 */
import { burstWindowDecisionPoints } from "@gladlog/analysis/src/analysis/burstWindowDecisionPoints";
import { BURST_WINDOW_MIN_JUDGED_S } from "@gladlog/analysis/src/analysis/candidates/burstWindowResponse";
import { ENEMY_REDIRECT_SAVE_IDS } from "@gladlog/analysis/src/data/spellIdLists";
import { isHealerSpec } from "@gladlog/analysis/src/utils/cooldowns";
import { selfCastRedirectIsNoSave } from "@gladlog/analysis/src/utils/selfDefensiveMechanism";

import { type IRoundCtx, nameOf, successesOf, tsOf } from "./ctx";

export const CHECKS = [
  "selfRedirectAnswersBurst",
  "selfRedirectPoppedInKillAttempt",
] as const;

const ATTEMPT_RE =
  /^\s*\[(\d+):(\d\d)–(\d+):(\d\d)\] on (\S+) .*\| FAILED: (.*)$/;

function burst(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  if (!owner || !isHealerSpec(owner.spec)) return;
  let points: ReturnType<typeof burstWindowDecisionPoints>;
  try {
    points = burstWindowDecisionPoints(ctx.legacy, {
      friendlyReaction: owner.reaction,
    });
  } catch {
    return;
  }
  const C = "selfRedirectAnswersBurst";
  for (const p of points) {
    if (
      !p.feasible ||
      !p.triaged ||
      p.pressured === null ||
      p.durationSec < BURST_WINDOW_MIN_JUDGED_S ||
      p.responseCasts.length === 0
    )
      continue;
    ctx.bump(C);
    const noSave = p.responseCasts.filter(
      (r) =>
        r.casterId !== undefined &&
        selfCastRedirectIsNoSave(r.spellId, r.casterId, r.destId),
    );
    if (noSave.length === 0) continue;
    const only =
      noSave.length === p.responseCasts.length &&
      !p.responses.kite &&
      !p.responses.attackerMoved;
    ctx.violate(
      C,
      `${nameOf(noSave[0]!.spellId)} | ${only ? "the only answer" : "beside others"}`,
      ctx.start + p.tSec * 1000,
      `${ctx.roundKey}|${owner.reaction}|${p.tSec}`,
      `window at ${p.tSec}s: ${p.responseCasts.map((r) => nameOf(r.spellId)).join(", ")}; pressured low ${p.pressured.minHpPct ?? "?"}%${p.anyFriendlyDeath ? ", a friendly died" : ""}; responded=${p.responded}`,
    );
  }
}

function killAttempts(ctx: IRoundCtx): void {
  const C = "selfRedirectPoppedInKillAttempt";
  const idsOfName = new Map<string, string[]>();
  for (const id of ENEMY_REDIRECT_SAVE_IDS) {
    const n = nameOf(id);
    if (n) idsOfName.set(n, [...(idsOfName.get(n) ?? []), id]);
  }
  const seen = new Set<string>();
  for (const line of ctx.lines) {
    const m = ATTEMPT_RE.exec(line);
    if (!m) continue;
    const popped = m[6]!
      .split("; ")
      .filter((part) => part.startsWith("popped "))
      .flatMap((part) => part.slice(7).split("/"))
      .map((n) => n.replace(/ \[up since [\d:]+\]$/, "").trim());
    if (popped.length === 0) continue;
    const key = `${m[1]}:${m[2]}-${m[3]}:${m[4]}|${m[5]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ctx.bump(C);
    const endMs = ctx.start + (Number(m[3]) * 60 + Number(m[4]) + 1) * 1000;
    const target = ctx.units.find((u: any) => u.name === m[5]);
    for (const name of popped) {
      const ids = idsOfName.get(name);
      if (!ids || !target) continue;
      const cast = successesOf(target)
        .filter((c: any) => ids.includes(String(c.spellId)) && tsOf(c) <= endMs)
        .pop();
      if (
        !cast ||
        !selfCastRedirectIsNoSave(
          String(cast.spellId),
          target.id,
          cast.destUnitId,
        )
      )
        continue;
      ctx.violate(
        C,
        name,
        tsOf(cast),
        `${ctx.roundKey}|${key}|${name}`,
        `a kill attempt's FAILED clause lists ${name} the target cast on itself; it does not save its caster`,
        line.trim().slice(0, 300),
      );
    }
  }
}

export function run(ctx: IRoundCtx): void {
  burst(ctx);
  killAttempts(ctx);
}

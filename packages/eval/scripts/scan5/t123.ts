/* eslint-disable @typescript-eslint/no-explicit-any -- the checks walk the untyped legacy parse objects (auraEvents, healIn, spellCastEvents) */
/**
 * scan5/t123.ts — ticket T123: a `[BURST ANSWERED]` line credits an answer
 * whose effect never reached the player it names as pressured. Rallying
 * Cry pressed with no target put its aura on two of the three teammates and
 * was credited for the third's dip; a Guardian druid's Frenzied
 * Regeneration (no target, aura and heals on the druid alone) for a
 * paladin's.
 *
 *  - `answerEffectNotOnPressured`: a `[BURST ANSWERED] … A answered with X
 *    in Z.Zs | Z.Zs before it opened; P bottomed at …` line (not a control
 *    line, which names its target with ` on `), the answerer's SUCCESS row
 *    named X logged Z s from the opener's SUCCESS row (±60 ms), cast at no
 *    unit or at the answerer itself, P not the answerer. The span: from
 *    0.5 s before the press to the answerer's next SUCCESS of that id or the
 *    press + 8 s, whichever is first; rows from the answerer or its pets.
 *    Where the effect went is the producer's own reading
 *    (`pressEffectSpread`, `officialSelfOnlyHeal`); the press, its span and
 *    the line come from the log rows and the rendered text. Two readings,
 *    either one a violation:
 *    (a) an aura — APPLIED / REFRESH of the cast's id or one of its effect
 *        auras (`castAndEffectIds`, a lookup) — on a player other than A in
 *        the span, and none on P (the aura is logged per recipient, and P
 *        is not one: Rallying Cry);
 *    (b) the official profile heals its caster and not others
 *        (`officialSelfOnlyHeal`: `ABILITY_EFFECTS_GENERATED` healsSelf
 *        without healsOthers), and no aura or heal row named X went on a
 *        player other than A in the span (Frenzied Regeneration; Emerald
 *        Communion's overflow heal, another id under the same name,
 *        reaches allies).
 *    Kind = X. Counted: every such line with (a)'s aura on another player
 *    or (b)'s profile.
 */
import {
  ANSWER_EFFECT_LEAD_MS,
  BURST_RESPONSE_WINDOW_MS,
  officialSelfOnlyHeal,
  pressEffectSpread,
} from "@gladlog/analysis/src/analysis/burstWindowDecisionPoints";

import { type IRoundCtx, nameOf, secOf, successesOf, tsOf } from "./ctx";

export const CHECKS = ["answerEffectNotOnPressured"] as const;

const LINE =
  /^(\d+:\d{2})\s+\[BURST ANSWERED\]\s+enemy opened (.+?) (?:\(\+.*\) )?\((\d+)\([^)]*\)\): (\d+)\([^)]*\) answered with (.+?) (?:in ([\d.]+)s|([\d.]+)s before it opened); (\d+)\([^)]*\) bottomed at/;
/** the printed latency is rounded to 0.1 s */
const LATENCY_SLACK_MS = 60;

const isNoDest = (d: string | undefined): boolean => !d || /^0+$/.test(d);

export function run(ctx: IRoundCtx): void {
  const C = "answerEffectNotOnPressured";
  for (const l of ctx.lines) {
    const m = LINE.exec(l);
    if (!m) continue;
    const name = m[5]!;
    if (/ on \d+\(/.test(name)) continue; // a control names its target
    const opener = ctx.unitOfPid(m[3]);
    const answerer = ctx.unitOfPid(m[4]);
    const pressured = ctx.unitOfPid(m[8]);
    if (!opener || !answerer || !pressured) continue;
    const lineMs = ctx.start + secOf(m[1]!) * 1000;
    const open = successesOf(opener).find(
      (c) =>
        nameOf(c.spellId, c.spellName) === m[2] &&
        tsOf(c) >= lineMs &&
        tsOf(c) < lineMs + 1000,
    );
    if (!open) continue;
    const latencyMs =
      m[6] !== undefined ? Number(m[6]) * 1000 : -Number(m[7]) * 1000;
    const want = tsOf(open) + latencyMs;
    const own = successesOf(answerer).filter(
      (c) => nameOf(c.spellId, c.spellName) === name,
    );
    const press = own
      .filter((c) => Math.abs(tsOf(c) - want) <= LATENCY_SLACK_MS)
      .sort((a, b) => Math.abs(tsOf(a) - want) - Math.abs(tsOf(b) - want))[0];
    if (!press) continue;
    if (!isNoDest(press.destUnitId) && press.destUnitId !== answerer.id)
      continue; // aimed at another unit: the destination rule's case
    const t = tsOf(press);
    const id = String(press.spellId);
    const next = own
      .filter((c) => String(c.spellId) === id && tsOf(c) > t + 1)
      .reduce((x, c) => Math.min(x, tsOf(c)), Infinity);
    const sources = new Set<string>([
      answerer.id,
      ...ctx.units
        .filter((u: any) => u.ownerId === answerer.id)
        .map((u: any) => u.id as string),
    ]);
    // the producer's own reading of where the press went (coordinator rule:
    // a scan calls the producer's selection, it does not replay it)
    const spread = pressEffectSpread(
      ctx.players,
      answerer.id,
      sources,
      id,
      t - ANSWER_EFFECT_LEAD_MS,
      Math.min(next, t + BURST_RESPONSE_WINDOW_MS),
    );
    const auraOthers = spread.auraHolderIds.filter((x) => x !== answerer.id);
    const selfOnly = auraOthers.length === 0 && officialSelfOnlyHeal(id);
    if (pressured.id === answerer.id) continue;
    if (auraOthers.length === 0 && !selfOnly) continue;
    ctx.bump(C);
    const nameOfId = (x: string): string =>
      ctx.players.find((u: any) => u.id === x)?.name ?? x;
    let why: string | undefined;
    if (auraOthers.length > 0) {
      if (!spread.auraHolderIds.includes(pressured.id))
        why = `its aura went on ${auraOthers.map(nameOfId).join(", ")}, not on ${pressured.name}`;
    } else if (!spread.namedOnOther)
      why = `officially heals its caster only, and no row of it went on another player`;
    if (why === undefined) continue;
    ctx.violate(
      C,
      name,
      t,
      `${answerer.id}#${id}#${t}#${pressured.id}`,
      `${name} pressed ${((t - ctx.start) / 1000).toFixed(3)} s (${isNoDest(press.destUnitId) ? "no target" : "on itself"}): ${why}; the line credits it for ${pressured.name}`,
      l.slice(0, 300),
    );
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, castStartEvents, spellCastEvents) */
/**
 * scan5/t52.ts — pipeline T52: the owner's kick the log shows refused
 * (a SPELL_MISSED row: IMMUNE, REFLECT, MISS, …) while its target had a cast
 * bar running, printed `hit nothing`. bd7f386f 0:43: Polymorph begun 42.58,
 * Sanctified Ground on the mage 43.31, Mind Freeze 43.39 logged IMMUNE, the
 * Polymorph off at 43.74 — `[KICK] your Mind Freeze on N — hit nothing
 * [IMMUNE: N]`. "Hit nothing" is the audit's `missed`: nothing kickable.
 * Something was.
 *
 * Truth = the log's rows (the bars are `castBarStartsOf`, the product's one
 * list of cast-bar starts). Per owner context, every `[KICK] your K on N —
 * hit nothing… [<miss tag>]` line aimed at a player:
 *
 *  - `refusedKickLiveCast`: the owner's (or its summon's) press of K in that
 *    second and the miss row that followed it (the refusal's own instant —
 *    a pet carries the command out later); the target's last bar begun
 *    before that row (a START of its millisecond counts when logged before
 *    it); the bar's end — the first SUCCESS of its spell from its start on,
 *    or somebody's SPELL_INTERRUPT of it — after the row, inside the bar's
 *    cap (`JUKE_LOOKBACK_MS`) and no later than `CAST_QUEUE_TOLERANCE_MS`
 *    past the target's next bar: the bar was running when the kick was
 *    refused. Violation: the line says `hit nothing`, or the burst ledger's
 *    `Kicks:` row does for the same kick. Kind = the miss tag's word, with
 *    `+ledger` when both say it and `ledger only` when the line is right.
 */
import {
  CAST_QUEUE_TOLERANCE_MS,
  castBarStartsOf,
  JUKE_LOOKBACK_MS,
} from "@gladlog/analysis/src/utils/castBarOutcomes";

import { ev, fmtS, type IRoundCtx, nameOf, successesOf, tsOf } from "./ctx";

export const CHECKS = ["refusedKickLiveCast"] as const;

/** the kick's miss row sits this close to its press (scan5/t11's window) */
const MISS_LEAD_S = 0.1;
const MISS_AFTER_S = 2.5;

/** 1,2 = m:ss, 3 = the kick, 4 = the target's roster number, 5 = what
 * follows the dash */
const KICK_REFUSED =
  /^(\d+):(\d\d)\s+\[KICK\]\s+your (.+?) on (\d+)\([^)]*\) — (.*)$/;
const MISS_TAG =
  /\[(IMMUNE|MISSED on|REFLECTED|PARRIED|DODGED|EVADED|DEFLECTED|RESISTED)\b/;

export function run(ctx: IRoundCtx): void {
  if (!ctx.owner) return;
  const src = new Set<string>([
    ctx.owner.id,
    ...ctx.units
      .filter((x: any) => x.ownerId === ctx.owner.id)
      .map((x: any) => x.id),
  ]);
  const capS = JUKE_LOOKBACK_MS / 1000;
  const tolS = CAST_QUEUE_TOLERANCE_MS / 1000;
  const sec = (ms: number) => (ms - ctx.start) / 1000;
  const ledger = ctx.text
    .split("\n")
    .map((l) => /^\s*Kicks: (.*)$/.exec(l)?.[1])
    .filter((x): x is string => x !== undefined)
    .flatMap((x) => x.split(" | "));
  for (const line of ctx.lines) {
    const k = KICK_REFUSED.exec(line);
    if (!k) continue;
    const tag = MISS_TAG.exec(k[5]!);
    if (!tag) continue;
    const target = ctx.unitOfPid(k[4]);
    if (!target?.info) continue;
    const atSec = Number(k[1]) * 60 + Number(k[2]);
    const name = k[3]!;
    const press = ctx.units
      .filter((u: any) => src.has(u.id))
      .flatMap((u: any) => successesOf(u))
      .filter((c: any) => nameOf(c.spellId, c.spellName ?? "") === name)
      .map((c: any) => sec(tsOf(c)))
      .find((t: number) => Math.floor(t) === atSec);
    if (press === undefined) continue;
    ctx.bump("refusedKickLiveCast");
    // the refusal's own row: a pet carries the command out after the
    // owner's press, and a START of that millisecond logged after the row
    // was not running at it
    const miss = ctx.units
      .flatMap((u: any) => (u.missesIn ?? []) as any[])
      .filter(
        (m) =>
          src.has(m.srcUnitId) &&
          m.missType !== "ABSORB" &&
          nameOf(m.spellId, m.spellName ?? "") === name &&
          sec(m.timestamp) >= press - MISS_LEAD_S &&
          sec(m.timestamp) <= press + MISS_AFTER_S,
      )
      .sort((a, b) => a.timestamp - b.timestamp)[0];
    const atS = miss ? sec(miss.timestamp) : press;
    const atLine = miss?.logLine?.lineIndex as number | undefined;
    const bars = castBarStartsOf(target, ctx.start);
    let i = -1;
    bars.forEach((b, j) => {
      if (
        b.t < atS ||
        (b.t === atS &&
          !(b.line !== undefined && atLine !== undefined && b.line > atLine))
      )
        i = j;
    });
    const bar = bars[i];
    if (!bar) continue;
    const untilS = Math.min(bar.t + capS, (bars[i + 1]?.t ?? Infinity) + tolS);
    // the bar's end is the FIRST SUCCESS of its spell from its start on (one
    // of the START's millisecond logged before it is the previous cast's):
    // an instant-made cast (Hot Streak Pyroblast: START and SUCCESS in one
    // ms) was over before the kick, whatever the spell did later — or
    // somebody's interrupt of it, the log saying it was still up
    const firstOff = successesOf(target)
      .filter(
        (c: any) =>
          String(c.spellId) === bar.id &&
          !(
            sec(tsOf(c)) === bar.t &&
            bar.line !== undefined &&
            typeof c.logLine?.lineIndex === "number" &&
            c.logLine.lineIndex < bar.line
          ),
      )
      .map((c: any) => sec(tsOf(c)))
      .find((t: number) => t >= bar.t);
    const kickedAt = ((target.actionIn ?? []) as any[])
      .filter(
        (a) => ev(a) === "SPELL_INTERRUPT" && String(a.extraSpellId) === bar.id,
      )
      .map((a) => sec(tsOf(a)))
      .find((t: number) => t >= bar.t);
    const endS = Math.min(firstOff ?? Infinity, kickedAt ?? Infinity);
    if (!(endS > atS && endS <= untilS)) continue;
    const lineWrong = /^hit nothing/.test(k[5]!);
    const ledgerWrong = ledger.some((e) =>
      e.startsWith(`${k[1]}:${k[2]} ${name} → hit nothing`),
    );
    if (!lineWrong && !ledgerWrong) continue;
    ctx.violate(
      "refusedKickLiveCast",
      `${tag[1]}${lineWrong ? (ledgerWrong ? " +ledger" : "") : " ledger only"}`,
      ctx.start + press * 1000,
      `${name}@${Math.floor(press * 10)}`,
      `${name} at ${fmtS(press)} (${atS.toFixed(2)}) refused while ${nameOf(bar.id, bar.name)} begun ${bar.t.toFixed(2)} was running (${endS === kickedAt ? "interrupted" : "went off"} ${endS.toFixed(2)}) — printed "hit nothing"`,
      line,
    );
  }
}

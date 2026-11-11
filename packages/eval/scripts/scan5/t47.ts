/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (castStartEvents, spellCastEvents, actionIn) */
/**
 * scan5/t47.ts — pipeline T47: the recorder's cast bar that ended with no row
 * at all. A bar the client stopped and restarted (the same key pressed again
 * through a stop-casting macro, or another cast begun over it) writes no
 * "Interrupted" SPELL_CAST_FAILED: the log has its SPELL_CAST_START, then the
 * unit's next SPELL_CAST_START, and no SUCCESS, SPELL_INTERRUPT or FAILED of
 * the spell between them. A new bar cannot begin over a running one, so the
 * first had ended by then — not completed, not kicked, not refused.
 * 1d26a991: Searing Glare begun 0:28.0 and again 0:29.1, an enemy Disrupt at
 * the first bar 0:28.8 that interrupted nothing; the cancel ledger said
 * `yourCancels=0, baitedKicks=0`.
 *
 * Log rows are the truth (the bars are `castBarStartsOf`, the product's one
 * list of cast-bar starts; a bar's end rows are looked for in the raw rows).
 * Once per round, for the unit that recorded the log (the one the
 * SPELL_CAST_FAILED rows are written for):
 *
 *  - `unloggedStopNotCancel`: a bar begun inside the round with no row of its
 *    spell — SUCCESS (to `CAST_QUEUE_TOLERANCE_MS` past the next start),
 *    SPELL_INTERRUPT on the unit, SPELL_CAST_FAILED — before the unit's next
 *    bar, which began inside the bar's cap (`JUKE_LOOKBACK_MS`) and before
 *    the round's end, and is a bar itself (no SUCCESS of its own inside
 *    `COMPLETED_BAR_MIN_S` of its START — a pet command or an instant-made
 *    cast writes both rows at once); the spell went off as itself at least once in the
 *    round (so its SUCCESS is logged under this id); and nothing that stops
 *    a cast landed on the unit from the bar's start to the next bar
 *    (`forcedStopInstantsMs`, the unit's death or another player's, an
 *    enemy's target-dropping press — `TARGETED_CC_DODGE_SPELLS`,
 *    `feignDeathInstantsMs` —, a silence with no aura logged —
 *    `unloggedSilencesOnOwner`). Violation: the product's
 *    ledger (`ownerCastCancels`) has no cancel that began at that bar. Kind
 *    `same spell` when the next bar is the same spell, else `other spell`.
 *  - `jukedNotBaited`: a kick the product's own audit calls juked on the
 *    recorder (`analyzeKickAudit(…, rawStreams)`, the ledger's source), every
 *    one counted. Violation: the bar it went out at (the last one begun
 *    before it) has no end row before the next bar or its cap, as the log's
 *    rows say, and the ledger's `baitedKicks` has no kick at that instant.
 *    A juked kick at a bar that has an end row, or at a channel, is not a
 *    baited kick by the ledger's own rule (a cancel with nothing landing on
 *    the owner, the kick inside its window) and is not judged here — 605 at
 *    4882aca85: 17 with an "Interrupted" row, 33 others (channels mostly).
 */
import {
  CAST_QUEUE_TOLERANCE_MS,
  castBarStartsOf,
  COMPLETED_BAR_MIN_S,
  JUKE_LOOKBACK_MS,
} from "@gladlog/analysis/src/utils/castBarOutcomes";
import {
  ownerCastBarOutcomes,
  ownerCastCancels,
} from "@gladlog/analysis/src/utils/castCancels";
import {
  feignDeathInstantsMs,
  forcedStopInstantsMs,
} from "@gladlog/analysis/src/utils/castStopEvidence";
import { TARGETED_CC_DODGE_SPELLS } from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import { analyzeKickAudit } from "@gladlog/analysis/src/utils/kickAudit";
import { roundEndMs } from "@gladlog/analysis/src/utils/roundEnd";
import { unloggedSilencesOnOwner } from "@gladlog/analysis/src/utils/unloggedSilence";
import type { AtomicArenaCombat, ICombatUnit } from "@gladlog/parser-compat";

import { ev, fmtS, type IRoundCtx, nameOf, successesOf, tsOf } from "./ctx";

export const CHECKS = ["unloggedStopNotCancel", "jukedNotBaited"] as const;

/** two instants are the same event when this close (float seconds) */
const SAME_S = 0.002;

export function run(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  const streams = ctx.rawStreams();
  if (!streams.available || streams.castFailed.length === 0) return;
  const recorderId = streams.castFailed[0]!.unitGuid;
  const rec = ctx.players.find((p) => p.id === recorderId);
  if (!rec) return;
  const combat = ctx.legacy as AtomicArenaCombat;
  const friends = ctx.players.filter(
    (p) => p.reaction === rec.reaction,
  ) as ICombatUnit[];
  const enemies = ctx.players.filter(
    (p) => p.reaction !== rec.reaction,
  ) as ICombatUnit[];
  const ledger = ownerCastCancels({
    owner: rec as ICombatUnit,
    friends,
    enemies,
    combat,
    rawStreams: streams,
  });
  if (!ledger) return;
  // the product's reading of each bar: the completion witness, and a
  // violation's detail
  const read =
    ownerCastBarOutcomes({
      owner: rec as ICombatUnit,
      startMs: combat.startTime,
      rawStreams: streams,
      enemies,
      allUnits: Object.values(combat.units),
      roundEndAtMs: roundEndMs(combat),
    }) ?? [];
  const roundEndS = (roundEndMs(combat) - ctx.start) / 1000;
  const capS = JUKE_LOOKBACK_MS / 1000;
  const tolS = CAST_QUEUE_TOLERANCE_MS / 1000;
  const sec = (ms: number) => (ms - ctx.start) / 1000;

  const bars = castBarStartsOf(rec, ctx.start);
  const successes = successesOf(rec).map((c) => ({
    id: String(c.spellId),
    t: sec(tsOf(c)),
    line: c.logLine?.lineIndex as number | undefined,
  }));
  type Bar = (typeof bars)[number];
  /** a SUCCESS row of the bar's spell at or after its START — one of the
   * START's own millisecond logged before it is the previous cast's end
   * (the cast-bar reading's `loggedBeforeStart`) */
  const ofBar = (s: (typeof successes)[number], b: Bar) =>
    s.id === b.id &&
    s.t >= b.t &&
    !(
      s.t === b.t &&
      b.line !== undefined &&
      typeof s.line === "number" &&
      s.line < b.line
    );
  const kicked = ((rec.actionIn ?? []) as any[])
    .filter((a) => ev(a) === "SPELL_INTERRUPT")
    .map((a) => ({ id: String(a.extraSpellId), t: sec(tsOf(a)) }));
  const failed = streams.castFailed.filter((f) => f.unitGuid === rec.id);
  const forced = forcedStopInstantsMs(rec);
  const forcedS = [
    ...forced.cc,
    ...forced.displaced,
    ...forced.gripped,
    ...((rec.deathRecords ?? []) as any[]).map((d) => d.timestamp),
    // another player's death: the bar's likely target (a START names none)
    ...ctx.players
      .filter((p) => p.id !== rec.id)
      .flatMap((p) =>
        ((p.deathRecords ?? []) as any[]).map((d) => d.timestamp),
      ),
    // a silence the log wrote no aura for (`[SILENCE] … no aura logged`)
    ...unloggedSilencesOnOwner({
      owner: rec as ICombatUnit,
      allUnits: Object.values(combat.units),
      enemies,
      matchStartMs: combat.startTime,
      roundEndAtMs: roundEndMs(combat),
      rawStreams: streams,
    }).map((x) => x.castMs),
    // the other side's target-dropping presses (Shadowmeld, Feign Death):
    // the bar may have lost its target, the cast-stop reading's `dodged`
    ...enemies.flatMap((e) => [
      ...successesOf(e)
        .filter((c) => TARGETED_CC_DODGE_SPELLS.has(String(c.spellId)))
        .map(tsOf),
      ...feignDeathInstantsMs(e),
    ]),
  ].map(sec);
  /** the spell went off as itself in the round — the ledger's own witness
   * (a bar of the id the cast-bar reading calls completed, begun and
   * completed inside the round): which bar a SUCCESS completes, with an
   * "Interrupted" row before it, is that reading's to say */
  const completesAsItself = (id: string) =>
    read.some(
      (o) =>
        o.id === id &&
        o.end.kind === "completed" &&
        o.t >= 0 &&
        o.end.atS < roundEndS,
    );
  const rowsOf = (b: Bar, nextS: number) => ({
    success: successes.some((s) => ofBar(s, b) && s.t <= nextS + tolS),
    kick: kicked.some((k) => k.id === b.id && k.t >= b.t && k.t <= nextS),
    failed: failed.filter(
      (f) =>
        String(f.spellId) === b.id && f.tSeconds >= b.t && f.tSeconds <= nextS,
    ),
  });

  bars.forEach((b, i) => {
    const next = bars[i + 1];
    if (!next || b.t < 0 || b.t >= roundEndS) return;
    if (next.t >= b.t + capS || next.t >= roundEndS) return;
    // a START with its own SUCCESS in the same few ms is a pet command or
    // an instant-made cast, not a bar that replaced this one
    if (
      successes.some(
        (s) => ofBar(s, next) && s.t <= next.t + COMPLETED_BAR_MIN_S,
      )
    )
      return;
    const rows = rowsOf(b, next.t);
    if (rows.success || rows.kick || rows.failed.length > 0) return;
    if (!completesAsItself(b.id)) return;
    if (forcedS.some((t) => t >= b.t && t <= next.t)) return;
    ctx.bump("unloggedStopNotCancel");
    if (ledger.cancels.some((c) => Math.abs(c.startS - b.t) <= SAME_S)) return;
    ctx.violate(
      "unloggedStopNotCancel",
      next.id === b.id ? "same spell" : "other spell",
      ctx.start + b.t * 1000,
      `${rec.name}#${b.id}#${Math.floor(b.t * 10)}`,
      `${nameOf(b.id, b.name)} begun ${fmtS(b.t)} (${b.t.toFixed(2)}), no end row; ${nameOf(next.id, next.name)} begun ${(next.t - b.t).toFixed(2)}s later — not a cancel in the ledger (yourCancels ${ledger.cancels.length}; read as ${JSON.stringify(read.find((o) => Math.abs(o.t - b.t) <= SAME_S)?.end)})`,
    );
  });

  for (const enemy of enemies)
    for (const k of analyzeKickAudit(enemy, friends, combat, streams)) {
      if (k.result !== "juked" || k.targetId !== rec.id) continue;
      ctx.bump("jukedNotBaited");
      if (
        ledger.baitedKicks.some(
          (x) => Math.abs(x.atSeconds - k.atSeconds) <= SAME_S,
        )
      )
        continue;
      const at = [...bars].reverse().find((b) => b.t <= k.atSeconds);
      const nextS =
        bars.find((b) => at !== undefined && b.t > at.t)?.t ?? Infinity;
      const rows = at ? rowsOf(at, Math.min(nextS, at.t + capS)) : undefined;
      if (!rows || rows.success || rows.kick || rows.failed.length > 0)
        continue;
      ctx.violate(
        "jukedNotBaited",
        "no end row",
        ctx.start + k.atSeconds * 1000,
        `${rec.name}#${Math.floor(k.atSeconds * 10)}`,
        `${k.kickSpellName} at ${fmtS(k.atSeconds)} (${k.atSeconds.toFixed(2)}) juked by ${k.jukedBySpellName ?? "?"} begun ${at!.t.toFixed(2)} — not a baited kick in the ledger (baitedKicks ${ledger.baitedKicks.length})`,
      );
    }
}

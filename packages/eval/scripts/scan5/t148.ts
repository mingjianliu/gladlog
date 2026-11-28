/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (castStartEvents, spellCastEvents, actionIn) */
/**
 * scan5/t148.ts — pipeline T148: the recorder's cast bar that ended with no
 * row at all and was followed, not by another bar (scan5/t47.ts), but by a
 * press on the global cooldown. A spell on the global cooldown cannot go out
 * while a cast bar runs — 605 raw logs: 46,046 bars that went on to their
 * own SUCCESS hold 15 SUCCESS rows of another on-GCD spell (13 of them an
 * Evoker's Stasis replaying Dream Breath / Echo) against 831 off the global
 * cooldown (Fire Blast, Shimmer, Combustion) — so the bar had ended by then:
 * not completed, not kicked, not refused. cf909ac1 r1: Searing Glare begun
 * 23.83, an enemy Wind Shear 24.69 that interrupted nothing, Judgment out at
 * 24.84; the cancel ledger said `yourCancels=0, baitedKicks=0`.
 *
 * Log rows are the truth; the DB2 global-cooldown table
 * (`ON_GCD_SPELL_IDS`) is a lookup. Once per round, for the unit that
 * recorded the log:
 *
 *  - `pressOverBarNotCancel`: a bar begun inside the round with no row of
 *    its spell — SUCCESS (to `CAST_QUEUE_TOLERANCE_MS` past the window),
 *    SPELL_INTERRUPT on the unit, SPELL_CAST_FAILED — up to its cap
 *    (`JUKE_LOOKBACK_MS`) or the unit's next bar; a SUCCESS row of ANOTHER
 *    spell on the global cooldown inside that window and before the round's
 *    end, a press of its own (no copy / companion / impact row, no Stasis
 *    replay; the previous bar's spell inside the queue tolerance of this START
 *    is that bar's queued completion and is not one); the spell went off as
 *    itself at least once in the round; and nothing that stops a cast landed
 *    on the unit from the bar's start to that press (as in t47). Violation:
 *    the product's ledger (`ownerCastCancels`) has no cancel that began at
 *    that bar. Kind: the pressed spell. Counted: every such bar.
 *
 *  - `kickEatenCancelsShort` (batch review of Mac job T148-1: the check
 *    above asks the ledger of the code that RUNS the scan, so it reads the
 *    same on a capture taken before the fix and after it — it is a check of
 *    the code, not of a capture): the PRINTED count. Every kick-eaten menu
 *    row of the recorder prints the round's `yourCancels`; it must not be
 *    below the ledger's other cancels plus the bars found above from the
 *    rows alone (`kickEatenCancelsShort`, the pure half). Kind: `short by
 *    N`. Counted: every such row in a round with at least one such bar.
 */
import { ON_GCD_SPELL_IDS } from "@gladlog/analysis/src/data/offGcdGenerated";
import {
  CAST_QUEUE_TOLERANCE_MS,
  castBarStartsOf,
  JUKE_LOOKBACK_MS,
} from "@gladlog/analysis/src/utils/castBarOutcomes";
import {
  ownerCastBarOutcomes,
  ownerCastCancels,
} from "@gladlog/analysis/src/utils/castCancels";
import { isNoPressRow } from "@gladlog/analysis/src/utils/castPress";
import {
  anyForcedStopMs,
  feignDeathInstantsMs,
  forcedStopInstantsMs,
} from "@gladlog/analysis/src/utils/castStopEvidence";
import { TARGETED_CC_DODGE_SPELLS } from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import { isStasisReplayCast } from "@gladlog/analysis/src/utils/combatStates";
import { roundEndMs } from "@gladlog/analysis/src/utils/roundEnd";
import { unloggedSilencesOnOwner } from "@gladlog/analysis/src/utils/unloggedSilence";
import type { AtomicArenaCombat, ICombatUnit } from "@gladlog/parser-compat";

import { ev, fmtS, type IRoundCtx, nameOf, successesOf, tsOf } from "./ctx";

export const CHECKS = [
  "pressOverBarNotCancel",
  "kickEatenCancelsShort",
] as const;

/**
 * The kick-eaten rows of a findings menu whose printed `yourCancels` is
 * below `expected`, with how far. A row without the field is not one of the
 * recorder's and is skipped.
 */
export function kickEatenCancelsShort(
  menu: string,
  expected: number,
): { row: string; printed: number; shortBy: number }[] {
  const out: { row: string; printed: number; shortBy: number }[] = [];
  for (const row of menu.split("\n")) {
    if (!row.includes(" type=kick-eaten ")) continue;
    const m = /[{ ]yourCancels=(\d+)[,}]/.exec(row);
    if (!m) continue;
    const printed = Number(m[1]);
    out.push({ row, printed, shortBy: Math.max(0, expected - printed) });
  }
  return out;
}

/** two instants are the same event when this close (float seconds) */
const SAME_S = 0.002;

export function run(ctx: IRoundCtx): void {
  const streams = ctx.rawStreams();
  if (!streams.available || streams.castFailed.length === 0) return;
  const recorderId = streams.castFailed[0]!.unitGuid;
  // the bars are judged once per round; the printed count on the recorder's
  // own context
  const ownMenu = ctx.owner?.id === recorderId;
  if (!ctx.firstOwnerOfRound && !ownMenu) return;
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
  // rows that are no press of a button — a copy, a companion or impact row
  // of another press (`isNoPressRow`), a Stasis replay — say nothing of a
  // running bar (codex 85-tk-KICK-T148-1 #3: Dream Breath's 355941)
  const recRows = successesOf(rec);
  const noPress = new Set(
    recRows.filter(
      (c) =>
        isNoPressRow(c, recRows) ||
        isStasisReplayCast(rec as ICombatUnit, String(c.spellId), tsOf(c)),
    ),
  );
  const successes = recRows
    .map((c) => ({
      noPress: noPress.has(c),
      id: String(c.spellId),
      t: sec(tsOf(c)),
      line: c.logLine?.lineIndex as number | undefined,
    }))
    .sort((a, b) => a.t - b.t);
  const kicked = ((rec.actionIn ?? []) as any[])
    .filter((a) => ev(a) === "SPELL_INTERRUPT")
    .map((a) => ({ id: String(a.extraSpellId), t: sec(tsOf(a)) }));
  const failed = streams.castFailed.filter((f) => f.unitGuid === rec.id);
  const forced = forcedStopInstantsMs(rec);
  const forcedS = [
    ...anyForcedStopMs(forced),
    ...((rec.deathRecords ?? []) as any[]).map((d) => d.timestamp),
    ...ctx.players
      .filter((p) => p.id !== rec.id)
      .flatMap((p) =>
        ((p.deathRecords ?? []) as any[]).map((d) => d.timestamp),
      ),
    ...unloggedSilencesOnOwner({
      owner: rec as ICombatUnit,
      allUnits: Object.values(combat.units),
      enemies,
      matchStartMs: combat.startTime,
      roundEndAtMs: roundEndMs(combat),
      rawStreams: streams,
    }).map((x) => x.castMs),
    ...enemies.flatMap((e) => [
      ...successesOf(e)
        .filter((c) => TARGETED_CC_DODGE_SPELLS.has(String(c.spellId)))
        .map(tsOf),
      ...feignDeathInstantsMs(e),
    ]),
  ].map(sec);
  const completesAsItself = (id: string) =>
    read.some(
      (o) =>
        o.id === id &&
        o.end.kind === "completed" &&
        o.t >= 0 &&
        o.end.atS < roundEndS,
    );

  // A SPELL_CAST_FAILED row of the bar's spell in the bar's window is its
  // end row — but not the row that ended the PREVIOUS bar of that spell in
  // the very millisecond this one began (a stop-and-recast: "Interrupted"
  // and the next START in one ms). Which bar such a row belongs to is the
  // product's attribution (`ownerCastBarOutcomes`: the previous bar read as
  // stopped / refused at this bar's start), not a second rule: that one row
  // is the previous bar's, any other row is this bar's (batch review
  // 80-PIPE-145-B131, eadf9636 r4: Arcane Surge stopped 216.421 and begun
  // again in that millisecond — the row was taken as the new bar's end and
  // the round's printed count went unchecked).
  const failedOfBar = (
    b: (typeof bars)[number],
    prev: (typeof bars)[number] | undefined,
    windowEndS: number,
  ): boolean => {
    const rows = failed.filter(
      (f) =>
        String(f.spellId) === b.id &&
        f.tSeconds >= b.t &&
        f.tSeconds <= windowEndS,
    );
    if (rows.length === 0) return false;
    const prevEnd =
      prev !== undefined && prev.id === b.id
        ? read.find((o) => Math.abs(o.t - prev.t) <= SAME_S)?.end
        : undefined;
    const prevEndedHere =
      prevEnd !== undefined &&
      (prevEnd.kind === "stopped" || prevEnd.kind === "refused") &&
      prevEnd.atS === b.t;
    if (!prevEndedHere) return true;
    const sameMs = rows.filter((f) => f.tSeconds === b.t).length;
    return rows.length - Math.min(1, sameMs) > 0;
  };
  const barsOverPressed: number[] = [];
  bars.forEach((b, i) => {
    if (b.t < 0 || b.t >= roundEndS) return;
    const prev = bars[i - 1];
    const windowEndS = Math.min(b.t + capS, bars[i + 1]?.t ?? Infinity);
    const press = successes.find(
      (s) =>
        s.t > b.t &&
        s.t < windowEndS &&
        s.t < roundEndS &&
        s.id !== b.id &&
        ON_GCD_SPELL_IDS.has(s.id) &&
        !s.noPress &&
        !(prev !== undefined && s.id === prev.id && s.t <= b.t + tolS),
    );
    if (!press) return;
    // any row of the bar's own spell in its window: the bar has an end
    if (
      successes.some(
        (s) =>
          s.id === b.id &&
          s.t <= windowEndS + tolS &&
          (s.t > b.t ||
            (s.t === b.t &&
              !(
                b.line !== undefined &&
                typeof s.line === "number" &&
                s.line < b.line
              ))),
      ) ||
      kicked.some((k) => k.id === b.id && k.t >= b.t && k.t <= windowEndS) ||
      failedOfBar(b, prev, windowEndS)
    )
      return;
    if (!completesAsItself(b.id)) return;
    if (forcedS.some((t) => t >= b.t && t <= press.t)) return;
    barsOverPressed.push(b.t);
    if (!ctx.firstOwnerOfRound) return;
    ctx.bump("pressOverBarNotCancel");
    if (ledger.cancels.some((c) => Math.abs(c.startS - b.t) <= SAME_S)) return;
    ctx.violate(
      "pressOverBarNotCancel",
      nameOf(press.id, press.id),
      ctx.start + b.t * 1000,
      `${rec.name}#${b.id}#${Math.floor(b.t * 10)}`,
      `${nameOf(b.id, b.name)} begun ${fmtS(b.t)} (${b.t.toFixed(2)}), no end row; ${nameOf(press.id, press.id)} went out ${(press.t - b.t).toFixed(2)}s later — not a cancel in the ledger (yourCancels ${ledger.cancels.length}; read as ${JSON.stringify(read.find((o) => Math.abs(o.t - b.t) <= SAME_S)?.end)})`,
    );
  });

  if (!ownMenu || barsOverPressed.length === 0) return;
  const others = ledger.cancels.filter(
    (c) => !barsOverPressed.some((t) => Math.abs(c.startS - t) <= SAME_S),
  ).length;
  const expected = others + barsOverPressed.length;
  for (const r of kickEatenCancelsShort(ctx.menu, expected)) {
    ctx.bump("kickEatenCancelsShort");
    if (r.shortBy === 0) continue;
    const id = /\bid=(\S+)/.exec(r.row)?.[1] ?? "";
    ctx.violate(
      "kickEatenCancelsShort",
      `short by ${r.shortBy}`,
      ctx.start,
      `${rec.name}#${id}`,
      `${id} prints yourCancels=${r.printed}; the round has ${others} other cancels and ${barsOverPressed.length} bar(s) with no end row under an on-GCD press (begun ${barsOverPressed.map((t) => t.toFixed(2)).join(", ")})`,
      r.row.slice(0, 160),
    );
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- scan over raw parse output */
/**
 * fact9 (F24) class 7 — single items:
 *  - duringEndSameMsHit (D2): an `[ENEMY DEF] … | during it:` figure that
 *    leaves out an ally's hit on the target logged at the aura's REMOVED
 *    millisecond BEFORE the REMOVED row (03cba5ac 2:01: Shadow Word: Madness
 *    under Time Dilation, 9k);
 *  - killFocusPastRoundEnd (D16): a KILL ATTEMPTS `B M incl. the 5 s after`
 *    above every damage the team dealt the target from the bracket's start
 *    to the round's end (409d2e4e r0 [2:10–2:12]: the log tail after the
 *    round-ending death at 2:14).
 * Both recompute from the parse's rows, not the product's sums: the D2
 * check compares the printed landed total with the window cut at the
 * REMOVED row in log order and at its millisecond; the D16 one bounds the
 * printed B from above. Both read the round's end through the product's
 * `roundEndMs` (shared predicate).
 */
import { roundEndMs } from "@gladlog/analysis/src/utils/roundEnd";
import { LogEvent } from "@gladlog/parser-compat";

import {
  APPLIED,
  deathMs,
  type IRoundCtx,
  nameOf,
  REMOVED,
  secOf,
  tsOf,
} from "./ctx";

export const CHECKS = ["duringEndSameMsHit", "killFocusPastRoundEnd"] as const;

const unitOfLabel = (ctx: IRoundCtx, label: string | undefined): any =>
  ctx.unitOfPid(/^(\d+)\(/.exec(label ?? "")?.[1]);
const lineIx = (r: any): number => r.logLine?.lineIndex ?? -1;

// ---------------------------------------------------------------- D2
const ENEMY_DEF_DURING =
  /^(\d+:\d{2}) {2}\[ENEMY DEF\] {3}\d+\([^)]*\) \([^)]*\): (.+?) → (\d+\([^)]*\)) \((\d+(?:\.\d+)?)s.*\| during it: (.+)$/;
const SEG = /^(\d+\([^)]*\)) (\d+(?:\.\d+)?)k on target/;
const DIRECT = new Set<string>([
  LogEvent.SPELL_DAMAGE,
  LogEvent.SPELL_PERIODIC_DAMAGE,
  LogEvent.RANGE_DAMAGE,
  LogEvent.SWING_DAMAGE,
  LogEvent.SWING_DAMAGE_LANDED,
  "SPELL_BUILDING_DAMAGE",
]);

function duringEnd(ctx: IRoundCtx): void {
  for (const line of ctx.lines) {
    const m = ENEMY_DEF_DURING.exec(line);
    if (!m) continue;
    const target = unitOfLabel(ctx, m[3]);
    if (!target) continue;
    const at = ctx.start + secOf(m[1]!) * 1000;
    const aura = m[2]!.replace(/ \[.*$/, "");
    const auras = ((target.auraEvents ?? []) as any[]).filter(
      (a) => nameOf(a.spellId, a.spellName) === aura,
    );
    const applied = auras.find(
      (a) =>
        a.logLine?.event === APPLIED && tsOf(a) >= at && tsOf(a) < at + 1000,
    );
    if (!applied) continue;
    const removed = auras.find(
      (a) =>
        a.logLine?.event === REMOVED &&
        String(a.spellId) === String(applied.spellId) &&
        tsOf(a) > tsOf(applied),
    );
    if (!removed || lineIx(removed) < 0) continue;
    const endMs = tsOf(removed);
    // a window the round's end or the target's death closed first ends
    // there, not at the REMOVED row (62-2 1:54: Life Cocoon removed 2 s
    // after the round-ending death)
    if (endMs >= roundEndMs(ctx.legacy) || endMs >= deathMs(target)) continue;
    for (const seg of m[5]!.split("; ")) {
      const s = SEG.exec(seg);
      if (!s) continue;
      const ally = unitOfLabel(ctx, s[1]);
      if (!ally) continue;
      const rows = ((ally.damageOut ?? []) as any[]).filter(
        (d) =>
          d.destUnitId === target.id &&
          DIRECT.has(d.logLine?.event) &&
          d.effectiveAmount < 0,
      );
      const late = rows.filter(
        (d) => tsOf(d) === endMs && lineIx(d) >= 0 && lineIx(d) < lineIx(removed),
      );
      if (late.length === 0) continue;
      ctx.bump("duringEndSameMsHit");
      const sum = (f: (d: any) => boolean) =>
        rows.filter(f).reduce((n, d) => n - d.effectiveAmount, 0) / 1000;
      const from = tsOf(applied);
      const excl = sum((d) => tsOf(d) >= from && tsOf(d) < endMs);
      const extra = sum((d) => late.includes(d));
      const printed = Number(s[2]);
      // the printed figure is the excluded window's, and the hit is no
      // rounding error
      if (extra < 1 || Math.abs(printed - excl) > 0.6) continue;
      ctx.violate(
        "duringEndSameMsHit",
        "enemyDef",
        endMs,
        `${m[1]}#${s[1]}#${m[3]}`,
        `${printed}k printed; ${extra.toFixed(1)}k of hits at the REMOVED ms logged before it left out (${late.map((d) => nameOf(d.spellId, d.spellName)).join(", ")})`,
        line.slice(0, 300),
      );
    }
  }
}

// ---------------------------------------------------------------- D16
const KILL_LINE =
  /^ {2}\[(\d+):(\d{2})–(\d+):(\d{2})\] on (.+?) — .*\(\d+\.\d{2}M on target inside it, (\d+\.\d{2})M incl\. the \d+ s after\)/;

function killFocus(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  if (!owner) return;
  // the product's round end (`roundEndMs`: a Solo Shuffle's first player
  // death, else the log's end), not the scans' end of play — a 3v3's
  // deciding friendly death is earlier than its end
  const endAt = roundEndMs(ctx.legacy);
  for (const line of ctx.lines) {
    const m = KILL_LINE.exec(line);
    if (!m) continue;
    const target = ctx.byName.get(m[5]!);
    if (!target) continue;
    const fromS = Number(m[1]) * 60 + Number(m[2]);
    const toS = Number(m[3]) * 60 + Number(m[4]);
    const spanEnd = ctx.start + (toS + 6) * 1000;
    if (spanEnd <= endAt) continue;
    const fromMs = ctx.start + fromS * 1000;
    const friends = ctx.units.filter(
      (u) => u.reaction === owner.reaction && u.info,
    );
    // an upper bound: every row on the target from the bracket's floored
    // start to the round's end, deferral rows included
    let bound = 0;
    let tail = 0;
    for (const f of friends)
      for (const d of (f.damageOut ?? []) as any[]) {
        if (d.destUnitId !== target.id) continue;
        const ts = tsOf(d);
        if (ts < fromMs) continue;
        if (ts <= endAt) bound += Math.abs(d.effectiveAmount);
        else if (ts <= spanEnd) tail += Math.abs(d.effectiveAmount);
      }
    if (tail === 0) continue;
    ctx.bump("killFocusPastRoundEnd");
    const printed = Number(m[6]);
    if (printed <= bound / 1e6 + 0.006) continue;
    ctx.violate(
      "killFocusPastRoundEnd",
      "killAttempt",
      fromMs,
      `${m[1]}:${m[2]}#${m[5]}`,
      `${printed}M printed; ${(bound / 1e6).toFixed(3)}M at most before the round's end, ${(tail / 1e6).toFixed(3)}M after it`,
      line.slice(0, 300),
    );
  }
}

export function run(ctx: IRoundCtx): void {
  duringEnd(ctx);
  killFocus(ctx);
}

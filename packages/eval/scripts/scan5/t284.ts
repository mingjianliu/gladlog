/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units) */
/**
 * scan5/t284.ts — ticket T284 (12.1.5 targeted audit): printed spans read
 * from the wrong source.
 *
 *  - `channelEndedBeforeItsBolts` (audit 02 D1): the owner's printed
 *    channel (`[YOU] [CD] … (channeled Xs, ended m:ss` or `interrupted at
 *    Xs`) of a channelled cooldown its bolts measure
 *    (`CHANNELED_CD_SPELL_IDS`, not a DB2 channel) whose own effect rows
 *    (damage / heal / miss under the channel's English name, by the
 *    caster, from its own millisecond, before its next press of the same
 *    spell and within 15 s) all come after the printed end — the line
 *    ended the channel at a press before it had produced anything.
 *    Checked = such printed lines with effect rows. Kind = the spell.
 *  - `pressLastsTriggerWindow` (audit 04 D2): a printed `[PRESS]` line's
 *    `lasts N` (`matchPressLines`, the line and its press row) equal to the
 *    talented length of a window the press laid (the caster's APPLIED of
 *    its id or an effect aura within `PRESS_CHAIN_HANDOVER_MS`) that the
 *    hand-off reading (`pressEffectHandoffRow`, on the raw rows) says
 *    handed off — and not the successor's length: the line priced the
 *    window, not the effect that ran. Checked = printed `lasts` lines of
 *    presses with a handed-off window. Kind = the spell.
 *  - `burstSpanEndsWhileUp` (audit 01 D2): the owner's burst ledger
 *    (`analyzeBurstLedger`) gives a cooldown's span an end more than 1 s
 *    before the round's while the caster's own aura of that press
 *    (APPLIED or REFRESH within 1 s of the cast) has no REMOVED until the
 *    round's end (a REMOVED inside the round), nor a later ledger entry of
 *    the spell before the span's end.
 *    Checked = ledger spells whose caster aura is found. Kind = the spell.
 */
import { CHANNELED_CD_SPELL_IDS } from "@gladlog/analysis/src/context/timelineHelpers";
import { effectAurasOfCast } from "@gladlog/analysis/src/data/castEffectAuras";
import { CHANNELED_SPELL_IDS } from "@gladlog/analysis/src/data/channeledGenerated";
import { PRESS_CHAIN_HANDOVER_MS } from "@gladlog/analysis/src/data/pressEffectChains";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import { buffFullDurationForCaster } from "@gladlog/analysis/src/utils/buffDuration";
import { analyzeBurstLedger } from "@gladlog/analysis/src/utils/burstLedger";
import { pressEffectHandoffRow } from "@gladlog/analysis/src/utils/offListPress";
import { roundEndMs } from "@gladlog/analysis/src/utils/roundEnd";

import {
  APPLIED,
  ev,
  type IRoundCtx,
  REFRESH,
  REMOVED,
  secOf,
  successesOf,
  tsOf,
} from "./ctx";
import { matchPressLines } from "./offListPress";

export const CHECKS = [
  "channelEndedBeforeItsBolts",
  "pressLastsTriggerWindow",
  "burstSpanEndsWhileUp",
] as const;

const CHANNEL_READ_MS = 15_000;
/** the printed channel length is rounded to a tenth */
const CHANNEL_TENTH_MS = 50;
/** a printed `lasts` this close to a length is that length (the line
 * rounds to whole or tenth seconds) */
const LASTS_MATCH_S = 0.5;

function effectName(r: any): string {
  return r.attackSpellId
    ? getEnglishSpellName(String(r.attackSpellId), r.attackSpellName ?? "")
    : getEnglishSpellName(String(r.spellId), r.spellName ?? "");
}

/** `m:ss  [YOU] [CD]   <name> (channeled|interrupted at Xs, ended m:ss` —
 * the owner's printed channel (`ownerCd`'s `channelSuffix`) */
const CHANNEL_LINE =
  /^\s*(\d+:\d\d)\s+\[YOU\] \[CD\]\s+(.+?) \((?:channeled|interrupted at) ([\d.]+)s, ended \d+:\d\d/;

function channels(ctx: IRoundCtx): void {
  // the printed lines (codex 85-tk-L5-T284-1k: a scan that re-asks the
  // producer checks the present reading, not the line a capture printed)
  const u = ctx.owner;
  if (!u) return;
  const casts = successesOf(u);
  const seen = new Map<string, number>();
  for (const line of ctx.lines) {
    const m = CHANNEL_LINE.exec(line);
    if (!m) continue;
    const second = secOf(m[1]!);
    const name = m[2]!;
    const key = `${name}|${second}`;
    const k = seen.get(key) ?? 0;
    seen.set(key, k + 1);
    // a channel its bolts measure: DB2 does not call the press a channel
    const c = casts.filter(
      (r: any) =>
        CHANNELED_CD_SPELL_IDS.has(String(r.spellId)) &&
        !CHANNELED_SPELL_IDS.has(String(r.spellId)) &&
        getEnglishSpellName(String(r.spellId), r.spellName ?? "") === name &&
        Math.floor((tsOf(r) - ctx.start) / 1000) === second,
    )[k];
    if (!c) continue;
    const id = String(c.spellId);
    const at = tsOf(c);
    const i = casts.indexOf(c);
    const nextSame = casts.slice(i + 1).find((n) => String(n.spellId) === id);
    const until = Math.min(
      nextSame ? tsOf(nextSame) : Infinity,
      at + CHANNEL_READ_MS,
    );
    const fx = [
      ...(u.damageOut ?? []),
      ...(u.healOut ?? []),
      ...(u.missesOut ?? []),
    ]
      .filter(
        (r: any) =>
          r.srcUnitId === u.id &&
          tsOf(r) >= at &&
          tsOf(r) < until &&
          effectName(r) === name,
      )
      .map((r: any) => tsOf(r) as number);
    if (!fx.length) continue;
    ctx.bump("channelEndedBeforeItsBolts");
    // the printed length, to its tenth
    const end = at + Number(m[3]) * 1000;
    const first = Math.min(...fx);
    const last = Math.max(...fx);
    // nothing of it by the printed end, rows of it after it: the channel ran on
    if (first <= end + CHANNEL_TENTH_MS || last <= end) continue;
    ctx.violate(
      "channelEndedBeforeItsBolts",
      name,
      at,
      `${ctx.roundKey}|${u.id}|${id}|${at}`,
      `${name} at ${((at - ctx.start) / 1000).toFixed(3)}s printed ${m[3]}s; its effect rows +${first - at}…+${last - at}ms`,
      line,
    );
  }
}

function presses(ctx: IRoundCtx): void {
  // the printed lines, not the producer's present reading (codex
  // 85-tk-L5-T284-1k: regenerating the presses checked the corrected 10 s
  // and passed a capture's `lasts 30s` off d1553082 r0's window)
  let matched: ReturnType<typeof matchPressLines>["matched"];
  try {
    matched = matchPressLines(ctx).matched;
  } catch {
    return;
  }
  const units = Object.values(ctx.legacy.units ?? {}) as any[];
  const endMs = roundEndMs(ctx.legacy);
  for (const { m, unit: caster, press } of matched) {
    if (!caster || !press) continue;
    const printed = /lasts ([\d.]+)s(\+)?/.exec(m[5] ?? "");
    // a floor (`lasts 10s+`) prices no length
    if (!printed || printed[2]) continue;
    const lasts = Number(printed[1]);
    const castId = String(press.spellId);
    const at = tsOf(press);
    const nextPress = successesOf(caster).find(
      (c: any) => String(c.spellId) === castId && tsOf(c) > at,
    );
    const untilMs = Math.min(nextPress ? tsOf(nextPress) : Infinity, endMs + 1);
    // the press's windows: the caster's APPLIED of the press's id or an
    // effect aura of it, on any unit, in the press's instant
    const ids = new Set([castId, ...effectAurasOfCast(castId)]);
    let found:
      { window: any; windowS: number; next: any; nextS: number } | undefined;
    for (const u of units) {
      for (const r of (u.auraEvents ?? []) as any[]) {
        if (
          r.srcUnitId !== caster.id ||
          ev(r) !== APPLIED ||
          !ids.has(r.spellId) ||
          Math.abs(tsOf(r) - at) > PRESS_CHAIN_HANDOVER_MS
        )
          continue;
        const windowS = buffFullDurationForCaster(r.spellId, caster, tsOf(r), {
          pressed: true,
          onUnitId: u.id,
        });
        if (windowS === undefined) continue;
        const handoff = pressEffectHandoffRow(
          caster,
          u,
          castId,
          r,
          windowS,
          untilMs,
          units,
          at,
        );
        if (!handoff) continue;
        const nextS = buffFullDurationForCaster(
          handoff.row.spellId!,
          caster,
          tsOf(handoff.row),
          { pressed: true, onUnitId: handoff.unit.id },
        );
        if (nextS === undefined) continue;
        found = { window: r, windowS, next: handoff.row, nextS };
        break;
      }
      if (found) break;
    }
    if (!found) continue;
    ctx.bump("pressLastsTriggerWindow");
    // the line priced the window, not the effect that took over
    if (
      Math.abs(lasts - found.windowS) > LASTS_MATCH_S ||
      Math.abs(lasts - found.nextS) <= LASTS_MATCH_S
    )
      continue;
    const name = getEnglishSpellName(castId, "");
    const second = (at - ctx.start) / 1000;
    ctx.violate(
      "pressLastsTriggerWindow",
      name,
      at,
      `${ctx.roundKey}|${caster.id}|${castId}|${at}`,
      `${name} at ${second.toFixed(2)}s prints lasts ${lasts}s, the length of ${found.window.spellId}; it handed off at +${((tsOf(found.next) - tsOf(found.window)) / 1000).toFixed(2)}s to ${found.next.spellId} (${found.nextS}s)`,
      m[0],
    );
  }
}

function bursts(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  if (!owner) return;
  let ledger: ReturnType<typeof analyzeBurstLedger>;
  try {
    const side = ctx.players.filter((u) => u.reaction === owner.reaction);
    const enemies = ctx.players.filter((u) => u.reaction !== owner.reaction);
    ledger = analyzeBurstLedger(owner, side, enemies, ctx.legacy);
  } catch {
    return;
  }
  const endS = (roundEndMs(ctx.legacy) - ctx.start) / 1000;
  const own = ((owner.auraEvents ?? []) as any[]).filter(
    (r) => r.srcUnitId === owner.id && r.destUnitId === owner.id,
  );
  for (const b of ledger)
    for (const s of b.spells) {
      const castMs = ctx.start + s.castTimeSeconds * 1000;
      const ids = new Set([s.spellId, ...effectAurasOfCast(s.spellId)]);
      // the press's own row of its aura: APPLIED, or the REFRESH of one
      // already up (codex 85-tk-L5-T284-1 #4: a Malevolence proc, then a
      // press that refreshed it)
      const app = own.find(
        (r) =>
          ids.has(r.spellId) &&
          (ev(r) === APPLIED || ev(r) === REFRESH) &&
          Math.abs(tsOf(r) - castMs) <= 1000,
      );
      if (!app) continue;
      ctx.bump("burstSpanEndsWhileUp");
      // a REMOVED inside the round (codex 85-tk-L5-T284-1b #5: one after the
      // round-ending death is none)
      const gone = own.some(
        (r) =>
          r.spellId === app.spellId &&
          ev(r) === REMOVED &&
          tsOf(r) > tsOf(app) &&
          tsOf(r) <= roundEndMs(ctx.legacy),
      );
      // renewed by the ledger's own next entry of the spell (a press that
      // refreshed a proc's aura, codex 85-tk-L5-T284-1 #4) — not by any
      // later row (#3 of 1b: a resync batch's APPLIED)
      const renewed = ledger
        .flatMap((x) => x.spells)
        .filter(
          (o) =>
            o.spellId === s.spellId && o.castTimeSeconds > s.castTimeSeconds,
        )
        .reduce((m, o) => Math.min(m, o.castTimeSeconds), Infinity);
      const upTo = Math.min(renewed, endS);
      if (gone || s.spanToSeconds >= upTo - 1) continue;
      ctx.violate(
        "burstSpanEndsWhileUp",
        s.spellName,
        castMs,
        `${ctx.roundKey}|${owner.id}|${s.spellId}|${s.castTimeSeconds}`,
        `${s.spellName} ${s.castTimeSeconds.toFixed(1)}–${s.spanToSeconds.toFixed(1)}s printed; its aura ${app.spellId} has no REMOVED to the round's end ${endS.toFixed(1)}s`,
      );
    }
}

export function run(ctx: IRoundCtx): void {
  bursts(ctx);
  channels(ctx);
  if (!ctx.firstOwnerOfRound) return;
  presses(ctx);
}

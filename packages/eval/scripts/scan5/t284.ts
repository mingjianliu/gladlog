/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units) */
/**
 * scan5/t284.ts — ticket T284 (12.1.5 targeted audit): printed spans read
 * from the wrong source.
 *
 *  - `channelEndedBeforeItsBolts` (audit 02 D1): a channelled cooldown
 *    (`CHANNELED_CD_SPELL_IDS`) whose end the producer puts at the caster's
 *    next press (`nextPressEndingChannelMs`) while the log shows the channel
 *    had produced nothing yet at that press and went on producing well
 *    after it — a press in the channel's own instant
 *    (`CHANNEL_PRESS_SAME_INSTANT_MS`), its own effect rows (damage / heal /
 *    miss under the channel's English name, by the caster, from its own
 *    millisecond, before its next press of the same spell and within 15 s)
 *    all after the press, the last more than `CHANNEL_PRESS_IN_FLIGHT_MS`
 *    past it. Checked = presses with an ending press before
 *    their last effect row. Kind = the spell.
 *  - `pressLastsTriggerWindow` (audit 04 D2): a `[PRESS]` line's `lasts`
 *    (`extractOffListPresses` → `durationSeconds` / `durationAura`) read
 *    from an aura the log shows handed off: REMOVED on that unit in the same
 *    instant (`PRESS_CHAIN_HANDOVER_MS`, the producer's) another aura of the press (its id or
 *    `effectAurasOfCast`) is APPLIED on that unit by the caster — the line
 *    priced the window, not the effect that ran. Checked = lines with a
 *    `lasts` whose aura was REMOVED more than 1 s before it. Kind = the
 *    spell.
 *  - `burstSpanEndsWhileUp` (audit 01 D2): the owner's burst ledger
 *    (`analyzeBurstLedger`) gives a cooldown's span an end more than 1 s
 *    before the round's while the caster's own aura of that press
 *    (APPLIED or REFRESH within 1 s of the cast) has no REMOVED until the
 *    round's end, nor a later row renewing it before the span's end.
 *    Checked = ledger spells whose caster aura is found. Kind = the spell.
 */
import { CHANNELED_CD_SPELL_IDS } from "@gladlog/analysis/src/context/timelineHelpers";
import { effectAurasOfCast } from "@gladlog/analysis/src/data/castEffectAuras";
import { PRESS_CHAIN_HANDOVER_MS } from "@gladlog/analysis/src/data/pressEffectChains";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import { analyzeBurstLedger } from "@gladlog/analysis/src/utils/burstLedger";
import {
  CHANNEL_PRESS_IN_FLIGHT_MS,
  CHANNEL_PRESS_SAME_INSTANT_MS,
  nextPressEndingChannelMs,
} from "@gladlog/analysis/src/utils/castCommitSpans";
import { extractOffListPresses } from "@gladlog/analysis/src/utils/offListPress";
import { roundEndMs } from "@gladlog/analysis/src/utils/roundEnd";

import {
  APPLIED,
  ev,
  type IRoundCtx,
  REFRESH,
  REMOVED,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = [
  "channelEndedBeforeItsBolts",
  "pressLastsTriggerWindow",
  "burstSpanEndsWhileUp",
] as const;

const CHANNEL_READ_MS = 15_000;

function effectName(r: any): string {
  return r.attackSpellId
    ? getEnglishSpellName(String(r.attackSpellId), r.attackSpellName ?? "")
    : getEnglishSpellName(String(r.spellId), r.spellName ?? "");
}

function channels(ctx: IRoundCtx): void {
  for (const u of ctx.players) {
    const casts = successesOf(u);
    for (const [i, c] of casts.entries()) {
      const id = String(c.spellId);
      if (!CHANNELED_CD_SPELL_IDS.has(id)) continue;
      const at = tsOf(c);
      const nextSame = casts.slice(i + 1).find((n) => String(n.spellId) === id);
      const until = Math.min(
        nextSame ? tsOf(nextSame) : Infinity,
        at + CHANNEL_READ_MS,
      );
      const p = nextPressEndingChannelMs(u, id, at);
      if (!(p < until)) continue;
      const name = getEnglishSpellName(id, c.spellName ?? "");
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
      const first = Math.min(...fx);
      const last = Math.max(...fx);
      if (last <= p) continue;
      ctx.bump("channelEndedBeforeItsBolts");
      if (
        p - at > CHANNEL_PRESS_SAME_INSTANT_MS ||
        first <= p ||
        last - p <= CHANNEL_PRESS_IN_FLIGHT_MS
      )
        continue;
      const by = [
        ...(u.spellCastEvents ?? []),
        ...(u.castStartEvents ?? []),
      ].find((e: any) => tsOf(e) === p && String(e.spellId) !== id);
      ctx.violate(
        "channelEndedBeforeItsBolts",
        name,
        p,
        `${ctx.roundKey}|${u.id}|${id}|${at}`,
        `${name} at ${((at - ctx.start) / 1000).toFixed(3)}s: ended by ${by ? `${getEnglishSpellName(String(by.spellId), by.spellName ?? "")} (${by.spellId}, ${ev(by)})` : "a press"} +${p - at}ms, its effect rows +${first - at}…+${last - at}ms`,
      );
    }
  }
}

function presses(ctx: IRoundCtx): void {
  let list: any[];
  try {
    list = extractOffListPresses(
      ctx.players,
      ctx.legacy,
      roundEndMs(ctx.legacy),
    );
  } catch {
    return;
  }
  const units = Object.values(ctx.legacy.units ?? {}) as any[];
  for (const p of list) {
    const da = p.durationAura;
    if (p.durationSeconds === undefined || !da) continue;
    const caster = p.unit;
    const holder = units.find((d) => d.id === da.unitId);
    if (!holder) continue;
    const rows = ((holder.auraEvents ?? []) as any[]).filter(
      (r) => r.srcUnitId === caster.id,
    );
    const removed = rows.find(
      (r) => r.spellId === da.spellId && ev(r) === REMOVED && tsOf(r) > da.atMs,
    );
    if (!removed) continue;
    // a hand-off at the printed length is the next aura of a chain (Holy
    // Armaments); only one gone before it priced a window
    if (tsOf(removed) - da.atMs > (p.durationSeconds - 1) * 1000) continue;
    ctx.bump("pressLastsTriggerWindow");
    const ids = new Set([p.spellId, ...effectAurasOfCast(p.spellId)]);
    ids.delete(da.spellId);
    const handoff = rows.find(
      (r) =>
        ids.has(r.spellId) &&
        ev(r) === APPLIED &&
        Math.abs(tsOf(r) - tsOf(removed)) <= PRESS_CHAIN_HANDOVER_MS,
    );
    if (!handoff) continue;
    const name = getEnglishSpellName(p.spellId, "");
    ctx.violate(
      "pressLastsTriggerWindow",
      name,
      ctx.start + p.timeSeconds * 1000,
      `${ctx.roundKey}|${caster.id}|${p.spellId}|${p.timeSeconds}`,
      `${name} at ${p.timeSeconds.toFixed(2)}s prints lasts ${p.durationSeconds}s from ${da.spellId}, gone after ${((tsOf(removed) - da.atMs) / 1000).toFixed(2)}s into ${handoff.spellId}`,
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
      const gone = own.some(
        (r) =>
          r.spellId === app.spellId && ev(r) === REMOVED && tsOf(r) > tsOf(app),
      );
      // a later row of the aura renews it: this entry's span may end there
      const renewed = own.find(
        (r) =>
          r.spellId === app.spellId &&
          (ev(r) === APPLIED || ev(r) === REFRESH) &&
          tsOf(r) > tsOf(app) + 1000,
      );
      const upTo = renewed ? (tsOf(renewed) - ctx.start) / 1000 : endS;
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
  if (!ctx.firstOwnerOfRound) return;
  channels(ctx);
  presses(ctx);
}

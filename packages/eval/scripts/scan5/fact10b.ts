/* eslint-disable @typescript-eslint/no-explicit-any -- scan over raw parse output */
/**
 * fact10b (F25b, GH #191 / #190) class checks.
 *
 *  - troughPastRoundEndReaders (D30 follow-up): the other printed troughs of
 *    a window the round ended inside (`roundEndMs`, a Solo Shuffle round's
 *    first death) — `[BURST ANSWERED] … <name> bottomed at P% at M:SS` and
 *    the POSITIONING `STAYED IN` line's `your HP A%→B% (min over window)` —
 *    sit below every reading of their unit the round holds: its live HP
 *    rows from the window's start to the round's end and the window's own
 *    `[STATE]` ticks (fact10 D30's `troughPastRoundEnd`, the same judge).
 *    `[BURST ANSWERED]` prints no window end; its bottom's second stands in
 *    for it, so a line counts when that second is at or after the round's
 *    end second (a bottom read inside the round is never past it). Kinds:
 *    `burstAnswered`, `stayedIn`. Counted: every such line.
 *  - killLivePastRoundEnd (D30 follow-up): a kill-live-gated wall's aura on
 *    a player (`mitigationVerdictOf` of its cast key, the offensive-waste
 *    window) that the round ended inside, whose span's true minimum
 *    (`hpTroughInEventSpan`, `killWasLive`'s reading) reaches
 *    `KILL_LIVE_HP_PCT` only through samples after the round's end. Counted:
 *    every such wall the round ended inside.
 *  - reflectedHealerLockUnread (D21 follow-up): a healer's own hard control
 *    (`HARD_CC_CATEGORIES`) reflected back onto it — a control DEBUFF whose
 *    source is the holder — for 1 s or more inside the round. Ruling A52
 *    keeps it off the enemy side's `ccInstances`, so the lock-window readers
 *    (`enemyHealerCcWindows` → missed-sync-window / unsynced-burst /
 *    `[KILL WINDOW]` healer facts; healer-offense `healerCcAt`) do not see
 *    it. An exposure count: every such control is a violation; kinds are
 *    the spell names. Counted once per round.
 *  - healerLockEndedByAllyImmunity (D8 follow-up): an enemy-healer lock
 *    (`enemyHealerCcWindows`, either side as "ours") with no `endedBy`
 *    (`ccRemovalCause`) whose control the log ended with ANOTHER unit's
 *    control immunity put on the healer in the control's own REMOVED
 *    millisecond (`immunityAuraAtRemoval` → `byUnitId`). Counted: every
 *    lock not cut by the round's end.
 *  - passiveAbsorbForward (GH #191 forward list): a player's own absorb
 *    shield (an `absorbsIn` row with the player the shield's caster, amount
 *    > 0) of an id the player applied on itself and never pressed (no own
 *    SUCCESS of that id or name this round), outside the press-ridden
 *    families (`ownShieldLinksGenerated.json`) and the ruled table
 *    (`PASSIVE_ABSORB_PROC_AURAS`). An inventory: one violation per (player,
 *    id) per round; kinds are `name id`.
 */
import {
  enemyHealerCcWindows,
  HARD_CC_CATEGORIES,
} from "@gladlog/analysis/src/analysis/candidates/cooldownTiming";
import { castKeyOfAura } from "@gladlog/analysis/src/data/castEffectAuras";
import {
  KILL_LIVE_HP_PCT,
  mitigationVerdictOf,
} from "@gladlog/analysis/src/data/mitigationVerdicts";
import ownShieldLinks from "@gladlog/analysis/src/data/ownShieldLinksGenerated.json";
import { ccSpellIds } from "@gladlog/analysis/src/data/spellTags";
import { buildAuraIntervals } from "@gladlog/analysis/src/utils/auraIntervals";
import { immunityAuraAtRemoval } from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import {
  hpTroughInEventSpan,
  isHealerSpec,
} from "@gladlog/analysis/src/utils/cooldowns";
import { DR_CATEGORY_MAP } from "@gladlog/analysis/src/utils/drAnalysis";
import { PASSIVE_ABSORB_PROC_AURAS } from "@gladlog/analysis/src/utils/enemyDefensives";
import { roundEndMs } from "@gladlog/analysis/src/utils/roundEnd";

import {
  ABSORBED,
  APPLIED,
  ev,
  fmtS,
  type IRoundCtx,
  nameOf,
  REFRESH,
  REMOVED,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = [
  "troughPastRoundEndReaders",
  "killLivePastRoundEnd",
  "reflectedHealerLockUnread",
  "healerLockEndedByAllyImmunity",
  "passiveAbsorbForward",
] as const;

export function run(ctx: IRoundCtx): void {
  troughPastRoundEndReaders(ctx);
  killLivePastRoundEnd(ctx);
  if (!ctx.firstOwnerOfRound) return;
  reflectedHealerLockUnread(ctx);
  healerLockEndedByAllyImmunity(ctx);
  passiveAbsorbForward(ctx);
}

const mss = (m: string, ss: string) => +m * 60 + +ss;
const STATE = /^(\d+):(\d{2})\s+\[STATE\]\s+(.*)$/;
const BURST_ANSWERED_BOTTOM =
  /^\s*(\d+):(\d{2})\s+\[BURST ANSWERED\].*;\s+(\S+) bottomed at (\d+)% at (\d+):(\d{2})/;
const STAYED_IN_HP =
  /^\s+(\d+):(\d\d)–(\d+):(\d\d) \[[^\]]* burst\] .* — your HP (\d+)%→(\d+)% \(min over window\)/;

/** live HP of `u` (whole percent, a living 0 % counts) in [fromMs, toMs] */
function liveMin(u: any, fromMs: number, toMs: number): number | null {
  let best: number | null = null;
  for (const a of (u.advancedActions ?? []) as any[]) {
    const ts = a.logLine.timestamp;
    if (ts < fromMs || ts > toMs) continue;
    if (a.advancedActorId !== u.id || !(a.advancedActorMaxHp > 0)) continue;
    if (!(a.advancedActorCurrentHp > 0)) continue;
    const pct = Math.min(
      Math.round((a.advancedActorCurrentHp / a.advancedActorMaxHp) * 100),
      100,
    );
    if (best === null || pct < best) best = pct;
  }
  return best;
}

function troughPastRoundEndReaders(ctx: IRoundCtx): void {
  const endAt = roundEndMs(ctx.legacy);
  const ticks = new Map<number, Map<string, number>>();
  for (const l of ctx.lines) {
    const m = STATE.exec(l);
    if (!m) continue;
    const row = new Map<string, number>();
    for (const t of m[3]!.matchAll(/(\d+)\([^)]*\):(\d+)/g))
      row.set(t[1]!, +t[2]!);
    ticks.set(mss(m[1]!, m[2]!), row);
  }
  const judge = (
    unit: any,
    from: number,
    to: number,
    printed: number,
    kind: string,
    line: string,
  ) => {
    if (!unit) return;
    const winEnd = ctx.start + (to + 1) * 1000;
    if (!(endAt < winEnd) || endAt < ctx.start + from * 1000) return;
    ctx.bump("troughPastRoundEndReaders");
    const pid = ctx.pidOf(unit.name);
    let low = liveMin(unit, ctx.start + from * 1000, endAt);
    for (let s = from; s <= to; s++) {
      const v = pid ? ticks.get(s)?.get(pid) : undefined;
      if (v !== undefined && (low === null || v < low)) low = v;
    }
    if (low !== null && printed < low)
      ctx.violate(
        "troughPastRoundEndReaders",
        kind,
        endAt,
        `${unit.name}:${from}`,
        `${unit.name}: printed low ${printed}%, the round's lowest reading ${low}% (round ended +${((endAt - ctx.start) / 1000).toFixed(3)}s)`,
        line.slice(0, 160),
      );
  };
  for (const l of ctx.lines) {
    const b = BURST_ANSWERED_BOTTOM.exec(l);
    if (b) {
      judge(
        ctx.byName.get(b[3]!) ?? ctx.unitOfPid(/^(\d+)\(/.exec(b[3]!)?.[1]),
        mss(b[1]!, b[2]!),
        mss(b[5]!, b[6]!),
        +b[4]!,
        "burstAnswered",
        l,
      );
      continue;
    }
  }
  if (!ctx.owner) return;
  for (const l of ctx.text.split("\n")) {
    const s = STAYED_IN_HP.exec(l);
    if (!s) continue;
    judge(
      ctx.owner,
      mss(s[1]!, s[2]!),
      mss(s[3]!, s[4]!),
      +s[6]!,
      "stayedIn",
      l,
    );
  }
}

function killLivePastRoundEnd(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  const endAt = roundEndMs(ctx.legacy);
  if (!(endAt < ctx.end)) return;
  const endS = (endAt - ctx.start) / 1000;
  for (const u of ctx.players) {
    for (const iv of buildAuraIntervals(u, ctx.legacy)) {
      const key =
        castKeyOfAura(iv.spellId, (id) => mitigationVerdictOf(id) !== null) ??
        iv.spellId;
      if (mitigationVerdictOf(key) !== "kill-live-gated") continue;
      if (iv.inferredStart || iv.inferredEnd) continue;
      if (!(iv.fromS < endS && iv.toS > endS)) continue;
      ctx.bump("killLivePastRoundEnd");
      const full = hpTroughInEventSpan(u, ctx.start, iv.fromS, iv.toS);
      const inRound = hpTroughInEventSpan(u, ctx.start, iv.fromS, endS);
      const live = (t: { pct: number } | null) =>
        t !== null && t.pct <= KILL_LIVE_HP_PCT;
      if (live(full) && !live(inRound))
        ctx.violate(
          "killLivePastRoundEnd",
          nameOf(iv.spellId),
          endAt,
          `${u.name}:${iv.spellId}:${Math.round(iv.fromS * 1000)}`,
          `${u.name} ${nameOf(iv.spellId)} ${iv.fromS.toFixed(1)}–${iv.toS.toFixed(1)}s: low ${full!.pct}% at ${full!.atSec}s, inside the round ${inRound?.pct ?? "none"}% (round ended ${endS.toFixed(3)}s)`,
        );
    }
  }
}

function reflectedHealerLockUnread(ctx: IRoundCtx): void {
  const endAt = roundEndMs(ctx.legacy);
  for (const u of ctx.players) {
    if (!isHealerSpec(u.spec)) continue;
    const auras = ((u.auraEvents ?? []) as any[]).filter(
      (a) => a.destUnitId === u.id,
    );
    for (const a of auras) {
      const id = String(a.spellId);
      if (ev(a) !== APPLIED || a.srcUnitId !== u.id) continue;
      if (!ccSpellIds.has(id) || a.auraType !== "DEBUFF") continue;
      if (!HARD_CC_CATEGORIES.has(DR_CATEGORY_MAP[id] ?? "")) continue;
      const on = tsOf(a);
      if (on < ctx.start || on >= endAt) continue;
      const off = auras.find(
        (r) =>
          String(r.spellId) === id &&
          tsOf(r) > on &&
          (ev(r) === REMOVED || String(ev(r)).startsWith("SPELL_AURA_BROKEN")),
      );
      const offMs = Math.min(off ? tsOf(off) : endAt, endAt);
      if (offMs - on < 1000) continue;
      ctx.bump("reflectedHealerLockUnread");
      ctx.violate(
        "reflectedHealerLockUnread",
        nameOf(id, a.spellName),
        on,
        `${u.name}:${id}:${on}`,
        `${fmtS((on - ctx.start) / 1000)} ${u.name} (${u.reaction === ctx.owner?.reaction ? "owner side" : "other side"}) in its own ${nameOf(id, a.spellName)} ${((offMs - on) / 1000).toFixed(1)}s`,
      );
    }
  }
}

function healerLockEndedByAllyImmunity(ctx: IRoundCtx): void {
  const sides = new Map<number, any[]>();
  for (const u of ctx.players) {
    const list = sides.get(u.reaction) ?? [];
    list.push(u);
    sides.set(u.reaction, list);
  }
  for (const [reaction, friends] of sides) {
    const enemies = ctx.players.filter((u) => u.reaction !== reaction);
    let windows: ReturnType<typeof enemyHealerCcWindows>;
    try {
      windows = enemyHealerCcWindows(friends, enemies, ctx.legacy);
    } catch {
      continue;
    }
    for (const w of windows) {
      if (w.cutByRoundEnd) continue;
      const healer = enemies.find((e) => e.name === w.healerName);
      if (!healer) continue;
      ctx.bump("healerLockEndedByAllyImmunity");
      if (w.endedBy) continue;
      const removeMs = Math.round(ctx.start + w.toSeconds * 1000);
      // the REMOVED row of that control near the window's end
      const rem = ((healer.auraEvents ?? []) as any[]).find(
        (a) =>
          a.destUnitId === healer.id &&
          String(a.spellId) === w.spellId &&
          ev(a) === REMOVED &&
          Math.abs(tsOf(a) - removeMs) <= 1,
      );
      if (!rem) continue;
      const imm = immunityAuraAtRemoval(healer, w.spellId, tsOf(rem));
      if (imm?.byUnitId === undefined) continue;
      ctx.violate(
        "healerLockEndedByAllyImmunity",
        imm.spellName,
        tsOf(rem),
        `${healer.name}:${w.spellId}:${tsOf(rem)}`,
        `${fmtS(w.fromSeconds)}–${fmtS(w.toSeconds)} ${w.spellName} on ${healer.name} ended by ${imm.byName ?? imm.byUnitId}'s ${imm.spellName}; menu endedBy none`,
      );
    }
  }
}

const RIDDEN = new Set<string>([
  ...((ownShieldLinks as any).rulingFamily as string[]),
  ...Object.keys((ownShieldLinks as any).riders),
]);

function passiveAbsorbForward(ctx: IRoundCtx): void {
  const endAt = roundEndMs(ctx.legacy);
  for (const u of ctx.players) {
    const selfApplied = new Set<string>();
    for (const a of (u.auraEvents ?? []) as any[])
      if (
        (ev(a) === APPLIED || ev(a) === REFRESH) &&
        a.destUnitId === u.id &&
        a.srcUnitId === u.id
      )
        selfApplied.add(String(a.spellId));
    const ate = new Map<string, { sum: number; rows: number; at: number }>();
    for (const r of (u.absorbsIn ?? []) as any[]) {
      if (ev(r) !== undefined && ev(r) !== ABSORBED) continue;
      const t = tsOf(r);
      if (t < ctx.start || t > endAt || r.srcUnitId !== u.id) continue;
      const amt = Math.abs(Number(r.absorbedAmount) || 0);
      if (amt <= 0) continue;
      const id = String(r.spellId);
      const x = ate.get(id) ?? { sum: 0, rows: 0, at: t };
      x.sum += amt;
      x.rows++;
      ate.set(id, x);
    }
    if (ate.size === 0) continue;
    const pressedIds = new Set<string>();
    const pressedNames = new Set<string>();
    for (const c of successesOf(u)) {
      pressedIds.add(String(c.spellId));
      pressedNames.add(nameOf(c.spellId, c.spellName));
    }
    for (const [id, x] of ate) {
      if (!selfApplied.has(id)) continue;
      if (RIDDEN.has(id) || PASSIVE_ABSORB_PROC_AURAS.has(id)) continue;
      if (pressedIds.has(id) || pressedNames.has(nameOf(id))) continue;
      ctx.bump("passiveAbsorbForward");
      ctx.violate(
        "passiveAbsorbForward",
        `${nameOf(id)} ${id}`,
        x.at,
        `${u.name}:${id}`,
        `${u.name} (${u.spec}): ${nameOf(id)} ${id} absorbed ${Math.round(x.sum / 1000)}k in ${x.rows} rows, never pressed`,
      );
    }
  }
}

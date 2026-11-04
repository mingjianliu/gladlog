/* eslint-disable @typescript-eslint/no-explicit-any -- scan over raw parse output */
/**
 * fact10 (F25) class checks.
 *
 *  - pressInsideLockNotEntered (class 1, D2–D4 D31): a `missed-sync-window`
 *    menu row ("none entered the window") whose lock — from 2 s before its
 *    start (the row's own "a press up to 2 s before the lock counts as
 *    entering") to the end of its last second — holds a press, by a player
 *    of the owner's side, of a major offensive button the roster filed as a
 *    press fact only (070c4933 2:06: Breath of Eons pressed at 2:09.572
 *    inside the Sleep Walk → Terror of the Skies lock). The id list is the
 *    check's own, so it keeps counting what the product's table no longer
 *    holds. Kinds are the spell names; only the ids the user ruled on
 *    2026-11-04 (Breath of Eons, Frostwyrm's Fury) count in the total, the
 *    rest of GH #184's ≥ 60 s buttons are measured beside it.
 *  - troughPastRoundEnd (class 8, D30): a displayed-seconds low — the burst
 *    ledger's `Target: … (low N% at M:SS)`, `[DMG SPIKE] … low N% @M:SS` —
 *    of a window the round ended inside (`roundEndMs`, a Solo Shuffle
 *    round's first death) sits below every reading of its unit the round
 *    holds: its live HP lines from the window's start to the round's end and
 *    the window's own `[STATE]` ticks (6a545d58 `Burst #4 — 3:08–3:15 …
 *    low 40% at 3:15`: the hits after the 3:15 round-ending death; the round
 *    itself bottomed at 67 %). Counted: every such low of a window the round
 *    ended inside.
 *  - trinketAfterAllyImmunity (class 6, D8): a `[CC ON TEAM] … broke this
 *    CC` line whose control the log ended with another unit's control
 *    immunity (`CC_AVOIDANCE_BUFF_SPELLS`) applied on the holder in the
 *    control's own REMOVED millisecond (11890839 0:17: Psychic Scream off at
 *    the ms of Aezryl's Berserker Shout, the trinket 26 ms later). Counted:
 *    every "broke this CC" line.
 *  - effectSpanSideAuraEnd (class 4, D11 D27): a burst-ledger span of a press
 *    that ends at the root its press applied, while a non-root aura of the
 *    same press on the same unit (applied within 1 s of it) ran on for 1 s
 *    or more (11890839 Burst #6 `1:34–1:36 | Predator's Wake`: the root
 *    370970 off at 1:36, the damage aura 1246168 at 1:41). The other aura is
 *    one of the press's family — named as the root or as the press — and
 *    both ends stop at the round's end. Counted: every ledger span of a
 *    press that applied a root beside another aura of its family.
 *  - talentedSaveUnseen (class 7, D13): a player whose COMBATANT_INFO PvP
 *    talents hold a defensive the roster files (Burrow 409293) and whose
 *    `<cooldowns>` line lacks it. Counted: every such talented player.
 *  - mobilityAsDefensive (class 7, D12): a cd-hoarded row whose readyCds
 *    names Spirit Walk (user ruling 2026-11-04: off the ready set). Counted:
 *    every cd-hoarded row.
 *  - jukeBarSuperseded (class 5, D22 D5): a `[KICK] … JUKED by fake X` line
 *    whose faked bar the target had left — another own press or cast bar of
 *    a different spell more than 0.5 s (`STOPPED_JUST_BEFORE_S`) before the
 *    kick, not one castable while channelling off the GCD — or that ended
 *    with a player's death (733ef717 0:45: Smite begun 41.415, Void Shield
 *    43.190, Penance 44.416, kick 45.309; 070c4933 2:25: Benediction begun
 *    144.495, its target dead 145.415). Counted: every juke line.
 */
import { ON_GCD_SPELL_IDS } from "@gladlog/analysis/src/data/offGcdGenerated";
import { ROOT_AURA_SPELL_IDS } from "@gladlog/analysis/src/data/rootAuraGenerated";
import { CAST_QUEUE_TOLERANCE_MS } from "@gladlog/analysis/src/utils/castBarOutcomes";
import { pressRidesAlong } from "@gladlog/analysis/src/utils/castCommitSpans";
import { STOPPED_JUST_BEFORE_S } from "@gladlog/analysis/src/utils/castStopEvidence";
import { CC_AVOIDANCE_BUFF_SPELLS } from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import { isHealerSpec } from "@gladlog/analysis/src/utils/cooldowns";
import { roundEndMs } from "@gladlog/analysis/src/utils/roundEnd";

import {
  APPLIED,
  ev,
  type IRoundCtx,
  nameOf,
  REMOVED,
  SUCCESS,
  tsOf,
} from "./ctx";

export const CHECKS = [
  "pressInsideLockNotEntered",
  "troughPastRoundEnd",
  "trinketAfterAllyImmunity",
  "effectSpanSideAuraEnd",
  "talentedSaveUnseen",
  "mobilityAsDefensive",
  "jukeBarSuperseded",
] as const;

/** fact10 class 1: ruled into the roster 2026-11-04 */
const RULED = new Set(["403631", "442204", "279302"]);
/** GH #184: the other press-fact-only offensive buttons of 45 s or more */
const OPEN = new Set([
  "228920", // Ravager
  "385059", // Odyn's Fury
  "357210", // Deep Breath
  "433874", // Deep Breath (Scalecommander)
  "375576", // Divine Toll
  "153561", // Meteor
  "439843", // Reaper's Mark
  "426591", // Goremaw's Bite
  "343527", // Execution Sentence
  "370553", // Tip the Scales
  "391528", // Convoke the Spirits
  "322109", // Touch of Death
  "375901", // Mindgames
]);
/** a healer's press of these is a heal (Holy Paladin, Restoration Druid,
 * Preservation Evoker), not a burst */
const HEALER_SPEC_PRESS = new Set(["375576", "391528", "370553"]);

export const OUT_OF_TOTAL: ReadonlySet<string> = new Set(
  [...OPEN].map((id) => `pressInsideLockNotEntered|${nameOf(id)}`),
);

const SYNC_ROW =
  /id=missed-sync-window:\S+ type=missed-sync-window t=(\d+)s [^\n]*?facts=\{t=(\d+), windowEndT=(\d+),/g;

export function run(ctx: IRoundCtx): void {
  troughPastRoundEnd(ctx);
  trinketAfterAllyImmunity(ctx);
  effectSpanSideAuraEnd(ctx);
  talentedSaveUnseen(ctx);
  mobilityAsDefensive(ctx);
  jukeBarSuperseded(ctx);
  if (!ctx.owner) return;
  const side = ctx.players.filter((u) => u.reaction === ctx.owner.reaction);
  for (const m of ctx.menu.matchAll(SYNC_ROW)) {
    ctx.bump("pressInsideLockNotEntered");
    const from = ctx.start + (+m[2]! - 2) * 1000;
    const to = ctx.start + (+m[3]! + 1) * 1000;
    const seen = new Set<string>();
    for (const u of side) {
      const healer = isHealerSpec(u.spec);
      for (const c of (u.spellCastEvents ?? []) as any[]) {
        if (ev(c) !== SUCCESS) continue;
        const id = String(c.spellId);
        if (!RULED.has(id) && !OPEN.has(id)) continue;
        if (HEALER_SPEC_PRESS.has(id) && healer) continue;
        const t = tsOf(c);
        if (t < from || t >= to) continue;
        const name = nameOf(id, c.spellName);
        if (seen.has(name)) continue;
        seen.add(name);
        ctx.violate(
          "pressInsideLockNotEntered",
          name,
          t,
          `${m[2]}`,
          `${u.name} pressed ${name} at +${((t - ctx.start) / 1000).toFixed(1)}s inside the ${m[2]}–${m[3]} lock`,
          m[0].slice(0, 160),
        );
      }
    }
  }
}

const mss = (m: string, ss: string) => +m * 60 + +ss;
const BURST_HEAD = /^\s*Burst #\d+ — (\d+):(\d{2})–(\d+):(\d{2}) \|/;
const BURST_TARGET = /^\s*Target: (\S+) \d+% → \d+% \(low (\d+)% at (\d+):(\d{2})\)/;
const SPIKE =
  /^(\d+):(\d{2})–(\d+):(\d{2})\s+\[DMG SPIKE\]\s+(\d+)\(.*low (\d+)% @(\d+):(\d{2})/;
const STATE = /^(\d+):(\d{2})\s+\[STATE\]\s+(.*)$/;

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

function troughPastRoundEnd(ctx: IRoundCtx): void {
  const endAt = roundEndMs(ctx.legacy);
  // [STATE] ticks: second → pid → number
  const ticks = new Map<number, Map<string, number>>();
  for (const l of ctx.lines) {
    const m = STATE.exec(l);
    if (!m) continue;
    const row = new Map<string, number>();
    for (const t of m[3]!.matchAll(/(\d+)\([^)]*\):(\d+)/g)) row.set(t[1]!, +t[2]!);
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
    ctx.bump("troughPastRoundEnd");
    const pid = ctx.pidOf(unit.name);
    let low = liveMin(unit, ctx.start + from * 1000, endAt);
    for (let s = from; s <= to; s++) {
      const v = pid ? ticks.get(s)?.get(pid) : undefined;
      if (v !== undefined && (low === null || v < low)) low = v;
    }
    if (low !== null && printed < low)
      ctx.violate(
        "troughPastRoundEnd",
        kind,
        endAt,
        `${from}`,
        `${unit.name}: printed low ${printed}%, the round's lowest reading ${low}% (round ended +${((endAt - ctx.start) / 1000).toFixed(3)}s)`,
        line.slice(0, 160),
      );
  };
  let burst: { from: number; to: number } | null = null;
  for (const l of ctx.text.split("\n")) {
    const h = BURST_HEAD.exec(l);
    if (h) {
      burst = { from: mss(h[1]!, h[2]!), to: mss(h[3]!, h[4]!) };
      continue;
    }
    const t = BURST_TARGET.exec(l);
    if (t && burst) {
      judge(ctx.byName.get(t[1]!), burst.from, burst.to, +t[2]!, "burst ledger", l);
      burst = null;
    }
  }
  for (const l of ctx.lines) {
    const m = SPIKE.exec(l);
    if (!m) continue;
    judge(
      ctx.unitOfPid(m[5]),
      mss(m[1]!, m[2]!),
      mss(m[3]!, m[4]!),
      +m[6]!,
      "[DMG SPIKE]",
      l,
    );
  }
}

const CC_ON_TEAM_BROKE =
  /^(\d+):(\d{2})\s+\[CC ON TEAM\]\s+(\d+)\([^)]*\) ← (.+?) \(by [^\n]*broke this CC/;

function trinketAfterAllyImmunity(ctx: IRoundCtx): void {
  for (const l of ctx.lines) {
    const m = CC_ON_TEAM_BROKE.exec(l);
    if (!m) continue;
    ctx.bump("trinketAfterAllyImmunity");
    const holder = ctx.unitOfPid(m[3]);
    if (!holder) continue;
    const fromMs = ctx.start + mss(m[1]!, m[2]!) * 1000;
    const auras = (holder.auraEvents ?? []) as any[];
    const rem = auras.find(
      (a) =>
        ev(a) === REMOVED &&
        a.destUnitId === holder.id &&
        tsOf(a) >= fromMs &&
        nameOf(a.spellId, a.spellName) === m[4],
    );
    if (!rem) continue;
    const at = tsOf(rem);
    const imm = auras.find(
      (a) =>
        ev(a) === APPLIED &&
        a.destUnitId === holder.id &&
        tsOf(a) === at &&
        a.srcUnitId !== holder.id &&
        CC_AVOIDANCE_BUFF_SPELLS.has(String(a.spellId)),
    );
    if (!imm) continue;
    ctx.violate(
      "trinketAfterAllyImmunity",
      nameOf(imm.spellId, imm.spellName),
      at,
      `${m[1]}:${m[2]}`,
      `${holder.name}: ${m[4]} removed +${((at - ctx.start) / 1000).toFixed(3)}s in the ms ${ctx.byName.get(ctx.units.find((u: any) => u.id === imm.srcUnitId)?.name)?.name ?? imm.srcUnitId}'s ${nameOf(imm.spellId, imm.spellName)} went up`,
      l.slice(0, 160),
    );
  }
}

/** `name start–end` spans of each burst-ledger header (a single-press
 * header's own range for its one name) */
function ledgerSpans(text: string): { name: string; from: number; to: number }[] {
  const out: { name: string; from: number; to: number }[] = [];
  for (const l of text.split("\n")) {
    const h = /^\s*Burst #\d+ — (\d+):(\d{2})–(\d+):(\d{2}) \| (.+)$/.exec(l);
    if (!h) continue;
    const parts = h[5]!.split(" + ");
    for (const part of parts) {
      const p = /^(.+?) (\d+):(\d{2})–(\d+):(\d{2})$/.exec(part.trim());
      if (p) out.push({ name: p[1]!, from: mss(p[2]!, p[3]!), to: mss(p[4]!, p[5]!) });
      else if (parts.length === 1)
        out.push({ name: part.trim(), from: mss(h[1]!, h[2]!), to: mss(h[3]!, h[4]!) });
    }
  }
  return out;
}

function effectSpanSideAuraEnd(ctx: IRoundCtx): void {
  if (!ctx.owner) return;
  const spans = ledgerSpans(ctx.text);
  if (spans.length === 0) return;
  const side = ctx.players.filter((u) => u.reaction === ctx.owner.reaction);
  const enemies = ctx.units.filter((u: any) => u.reaction !== ctx.owner.reaction);
  for (const caster of side) {
    for (const c of (caster.spellCastEvents ?? []) as any[]) {
      if (ev(c) !== SUCCESS) continue;
      const t = tsOf(c);
      const sec = Math.floor((t - ctx.start) / 1000);
      const name = nameOf(c.spellId, c.spellName);
      const span = spans.find((x) => x.name === name && x.from === sec);
      if (!span) continue;
      // per holder: the press's own auras (applied by the caster in [t, t+1s])
      let rootEnd = -Infinity;
      let sideEnd = -Infinity;
      for (const e of enemies) {
        const auras = ((e.auraEvents ?? []) as any[]).filter(
          (a) => a.destUnitId === e.id && a.srcUnitId === caster.id,
        );
        const applied = auras.filter(
          (a) => ev(a) === APPLIED && tsOf(a) >= t && tsOf(a) <= t + 1000,
        );
        const roots = applied.filter((a) => ROOT_AURA_SPELL_IDS.has(String(a.spellId)));
        // the press's own family: an aura named as the root or as the press
        // (The Hunt's root and damage aura are both "The Hunt"), not another
        // aura the caster happened to apply in that second
        const family = new Set([name, ...roots.map((r) => nameOf(r.spellId, r.spellName))]);
        const others = applied.filter(
          (a) =>
            !ROOT_AURA_SPELL_IDS.has(String(a.spellId)) &&
            family.has(nameOf(a.spellId, a.spellName)),
        );
        if (roots.length === 0 || others.length === 0) continue;
        const endOf = (a: any) =>
          tsOf(
            auras.find(
              (r) => ev(r) === REMOVED && r.spellId === a.spellId && tsOf(r) >= tsOf(a),
            ) ?? { timestamp: tsOf(a) },
          );
        for (const r of roots) rootEnd = Math.max(rootEnd, endOf(r));
        for (const o of others) sideEnd = Math.max(sideEnd, endOf(o));
      }
      if (!Number.isFinite(rootEnd) || !Number.isFinite(sideEnd)) continue;
      // nothing past the round's end is the span's
      const endAt = roundEndMs(ctx.legacy);
      rootEnd = Math.min(rootEnd, endAt);
      sideEnd = Math.min(sideEnd, endAt);
      ctx.bump("effectSpanSideAuraEnd");
      const rootSec = Math.floor((rootEnd - ctx.start) / 1000);
      const sideSec = Math.floor((sideEnd - ctx.start) / 1000);
      if (sideEnd - rootEnd >= 1000 && span.to <= rootSec && span.to < sideSec)
        ctx.violate(
          "effectSpanSideAuraEnd",
          name,
          t,
          `${sec}`,
          `${caster.name} ${name} +${((t - ctx.start) / 1000).toFixed(3)}s: ledger span ends ${span.to}s at the root (${rootSec}s), its other aura ran to ${sideSec}s`,
        );
    }
  }
}

/** PvP talents granting a defensive the roster files */
const PVP_TALENT_DEFENSIVES = new Map([["409293", "Burrow"]]);

function talentedSaveUnseen(ctx: IRoundCtx): void {
  if (!ctx.owner) return;
  for (const u of ctx.players) {
    if (u.reaction !== ctx.owner.reaction) continue;
    const pvp = new Set<string>((u.info?.pvpTalents ?? []).map(String));
    for (const [id, name] of PVP_TALENT_DEFENSIVES) {
      if (!pvp.has(id)) continue;
      ctx.bump("talentedSaveUnseen");
      const pid = ctx.pidOf(u.name);
      const at = ctx.text.indexOf(`<unit id="${pid}" `);
      const cds = at >= 0 ? /<cooldowns>([^<]*)<\/cooldowns>/.exec(ctx.text.slice(at))?.[1] : undefined;
      if (cds !== undefined && !cds.includes(`${name} [`))
        ctx.violate(
          "talentedSaveUnseen",
          name,
          ctx.start,
          u.name,
          `${u.name} has ${name} ${id} talented; its <cooldowns> line lacks it`,
        );
    }
  }
}

function mobilityAsDefensive(ctx: IRoundCtx): void {
  for (const m of ctx.menu.matchAll(
    /type=cd-hoarded t=(\d+)s [^\n]*?readyCds=([^,}]*(?:, [A-Z][^,=}]*)*)/g,
  )) {
    ctx.bump("mobilityAsDefensive");
    if (/\bSpirit Walk\b/.test(m[2]!))
      ctx.violate(
        "mobilityAsDefensive",
        "Spirit Walk",
        ctx.start + +m[1]! * 1000,
        m[1]!,
        `cd-hoarded readyCds=${m[2]}`,
        m[0].slice(0, 160),
      );
  }
}

const JUKE = /^(\d+):(\d{2})\s+\[KICK\]\s+your (.+?) on (\d+)\([^)]*\) — JUKED by fake (.+)$/;

function jukeBarSuperseded(ctx: IRoundCtx): void {
  if (!ctx.owner) return;
  for (const l of ctx.lines) {
    const m = JUKE.exec(l);
    if (!m) continue;
    ctx.bump("jukeBarSuperseded");
    const target = ctx.unitOfPid(m[4]);
    if (!target) continue;
    const sec = mss(m[1]!, m[2]!);
    const kick = ((ctx.owner.spellCastEvents ?? []) as any[]).find(
      (c) =>
        ev(c) === SUCCESS &&
        nameOf(c.spellId, c.spellName) === m[3] &&
        Math.floor((tsOf(c) - ctx.start) / 1000) === sec,
    );
    if (!kick) continue;
    const kickMs = tsOf(kick);
    const starts = ((target.castStartEvents ?? []) as any[]).filter(
      (c) => tsOf(c) <= kickMs && tsOf(c) >= kickMs - 4000,
    );
    const bar = starts.filter((c) => nameOf(c.spellId, c.spellName) === m[5]).at(-1);
    if (!bar) continue;
    const startMs = tsOf(bar);
    const prevBar = ((target.castStartEvents ?? []) as any[])
      .filter((c) => tsOf(c) < startMs)
      .at(-1);
    // A SUCCESS ends a bar only when it starts the GCD (DB2
    // ON_GCD_SPELL_IDS): a passive trigger or a pet command has no
    // SpellCooldowns row (codex 20-F25-01). A SUCCESS of the previous bar's
    // spell inside CAST_QUEUE_TOLERANCE_MS is that bar's queued completion.
    const other = [
      ...((target.spellCastEvents ?? []) as any[]).filter(
        (c) => ev(c) === SUCCESS && ON_GCD_SPELL_IDS.has(String(c.spellId)),
      ),
      ...((target.castStartEvents ?? []) as any[]),
    ].find(
      (c) =>
        tsOf(c) > startMs &&
        tsOf(c) < kickMs - STOPPED_JUST_BEFORE_S * 1000 &&
        String(c.spellId) !== String(bar.spellId) &&
        !pressRidesAlong(String(c.spellId)) &&
        !(
          prevBar &&
          String(c.spellId) === String(prevBar.spellId) &&
          tsOf(c) <= startMs + CAST_QUEUE_TOLERANCE_MS
        ),
    );
    const died = ctx.players.find(
      (u) =>
        u.id !== target.id &&
        ((u.deathRecords ?? []) as any[]).some(
          (d) => d.timestamp >= startMs && d.timestamp <= kickMs,
        ),
    );
    if (other || died)
      ctx.violate(
        "jukeBarSuperseded",
        other ? "superseded" : "a player died",
        kickMs,
        `${m[1]}:${m[2]}`,
        other
          ? `${m[5]} begun +${((startMs - ctx.start) / 1000).toFixed(3)}s, ${nameOf(other.spellId, other.spellName)} +${((tsOf(other) - ctx.start) / 1000).toFixed(3)}s, kick +${((kickMs - ctx.start) / 1000).toFixed(3)}s`
          : `${m[5]} begun +${((startMs - ctx.start) / 1000).toFixed(3)}s, ${died.name} died before the kick +${((kickMs - ctx.start) / 1000).toFixed(3)}s`,
        l.slice(0, 160),
      );
  }
}

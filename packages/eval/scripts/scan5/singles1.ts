/* eslint-disable @typescript-eslint/no-explicit-any -- the checks walk the untyped legacy parse objects (match.units, auraEvents, damageIn) by the hundred */
/**
 * scan5/singles1.ts — fact6 F20 single defects D1 / D6 / D9 / D13, each
 * counted as its whole fact class (`research/singles1.md`). Truth comes from
 * the log rows; tables read here are lookups only (English names, the DB2
 * spell-mechanic / DR-family / duration tables). D7 has no check: the
 * kill-live legend stays as ruled on 2026-10-27.
 *
 *  - `allyOnlySelfSave` (D1): an ally-only external — a spell that cannot
 *    target its caster — offered as the holder's own save, or counted as a
 *    save its holder has in hand. Ally-only is read off the log:
 *    `SPELL_CAST_SUCCESS` rows of the spell id over every archive seen so far
 *    (this round's whole file included). At least one row names another unit
 *    on the caster's side; none names the caster; none has no target (Death
 *    Pact's no-target heal is no external). A name is ally-only when every id
 *    logged under it is. A name with no such row is `unknownTarget` (not in
 *    the total).
 *    Readers:
 *    - (a) KILL SEQUENCE `m:ss  [DEFENSIVE AVAILABLE]  P: X[ (on an ally — …)]
 *      available but unused`, with the block's next `[KILL]  Q(` and P = Q
 *      → `ownDeathOffer`;
 *    - (b) `[DEATH]  P(…) … (Unused: X, Y)` → `deathUnused`;
 *    - (c) KILL ATTEMPTS `gated (X/Y in hand` / `— gated, X/Y in hand` in
 *      the timeline or the menu → `inHandText`;
 *    - (d) `defenseless a–b` (KILL WINDOW) / `[VULNERABLE] a–b … no major
 *      defensives` spans of an enemy who pressed an ally-only external on
 *      another unit this round. Each instant that external came back off
 *      cooldown inside the round is one checked item. The back instants come
 *      from the shared cooldown model (`unitCooldownEntry`); cooldown timing
 *      is not the fact under audit, membership is. A span of that unit that
 *      ends at that rendered second (±1) is a span the ready external closed
 *      → `spanCutAtReturn`. Excluded: the unit's death second and the
 *      round's last second. Population: ids the kill-window kit holds
 *      (`countsAsKillWindowDefensiveInHand`, the id or its canonical alias —
 *      a lookup; a non-member such as Leap of Faith cannot close a span, and
 *      its return only coincided with another save). Known limitation: a span
 *      the ready external kept from opening at all is not seen.
 *  - `reflectDotRun` (D6): a REFLECT chain (one caster, one spell by English
 *    name, one reflector, rows ≤ 3 s apart) whose reflected copy — an aura
 *    of the spell on the caster, from the caster or the reflector, APPLIED in
 *    [first row − 0.5 s, last row + 3 s] (a same-ms REMOVED + APPLIED
 *    continues it) — ran more than 20 s past the first row. Shorter returns
 *    are scan1's `reflectReturn`. Truth, with no time cap:
 *    - the spell's rows on the caster (landed + absorbed; no dispel backlash
 *      of the same name, no deferral shield) from the caster, the reflector
 *      or its pets within [−0.5 s, +3 s] of the chain — not from a source
 *      whose own aura of the spell was on the caster since before the chain
 *      (its own DoT) — plus every row from the copy's source inside the
 *      copy's run;
 *    - plus the reflector's own-id rows (Spell Reflection 23920, Nether Ward
 *      212295) within [first − 0.5 s, last + 3 s] whose nearest REFLECT row
 *      (of this caster on this reflector, any spell) is this chain's.
 *    Rendered: `m:ss  [REFLECTED]   C(…)'s S reflected[ ×N] by R(…)[ (came
 *    back for Nk)]` (same pids, name, second ±1). `amount`: off by
 *    > max(2k, 10 %). `noLine`: no line while the truth is ≥ 5 % of the
 *    caster's max HP (the line's own floor).
 *  - `pressMultiBreak` (D9): every loss-of-control aura a friendly player's
 *    PvP trinket press (Medallion 336126) ended.
 *    - Ended: the aura, from a hostile unit, is REMOVED within
 *      `PRESS_ENDED_CC_LAG_MS` (10 ms) of the press — the product's own
 *      `castEndedCcWindow` lag (`PRESS_LEAD_MS`).
 *    - Excluded: a BROKEN row or a SPELL_DISPEL of it at that removal, or a
 *      run that reached its DB2 length at the DR step it landed on
 *      (`drFraction`, − 0.02 s; no DR family: × 1, ½, ¼ ± 0.15 s).
 *    - Class: `disarm` = DB2 mechanic 3; `silence` = DR family Silence;
 *      `cc` = DR family Stun / Incapacitate / Disorient, or a DB2 stun /
 *      fear / charm / disorient / sleep / freeze / incapacitate / polymorph /
 *      shackle / horror / sap mechanic.
 *    - Its rendered line — `[DISARM]` / `[SILENCE]` / `[CC ON TEAM]`, same
 *      pid, English name, landing second ±1 — must credit the press:
 *      `trinket broke this disarm|silence|CC`, or for a CC `ended by their
 *      PvP trinket`.
 *    Kinds: `disarmNoCredit` / `silenceNoCredit` / `ccNoCredit`. Not in the
 *    total: `ccCreditWording` (credited only as `ended by their PvP
 *    trinket`, the two-wordings question) and `noLine` (no line to carry
 *    it). Inverse, `disarmFalseCredit`: a `[DISARM]` line saying `trinket
 *    broke this disarm after Ns` with no press within 1 s of m:ss + N that
 *    ended a disarm of that unit.
 *  - `deathBreakableCc` (D13): a friendly `[DEATH]  P(…) … (PvP Trinket
 *    available[; …])` tag against the trinket-breakable controls (the
 *    `pressMultiBreak` CC set; roots and silences never count — A28) on the
 *    unit from hostile units, read on the render grid as A28 reads them:
 *    landing second + rounded logged length, overlapping [death − 10, death].
 *    - `breakable`: a rounded length ≥ 2 s.
 *    - `death-cut`: a control still on the unit at the death (REMOVED within
 *      0.2 s of the UNIT_DIED row with no BROKEN row at that removal, or none
 *      before it) and shorter than that.
 *      User ruling 2026-10-28 (4) keeps A28 and only changes the words: the
 *      tail must then name that control, e.g. `(PvP Trinket available;
 *      Psychic Scream landed 0.5 s before the death)`.
 *    Kinds:
 *    - `noneButBreakable`: the `no breakable CC in the last 10 s` form with a
 *      breakable control;
 *    - `deathCutUnnamed`: no breakable control, a death-cut one, and a tail
 *      that does not name it (the pre-fix `no breakable CC …`);
 *    - `deathCutLead`: the named control's `landed N s before` off the log
 *      by > 0.15 s;
 *    - `bareButNone`: the bare tag with neither;
 *    - `rootAtDeath` (not in the total): the `no breakable CC` form while a
 *      root ran to the death.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { countsAsKillWindowDefensiveInHand } from "@gladlog/analysis/src/data/abilityProfile";
import { BACKLASH_AURA_CC_TYPE } from "@gladlog/analysis/src/data/backlashCc";
import spellEffectGenerated from "@gladlog/analysis/src/data/spellEffectGenerated.json";
import spellMechanicsGenerated from "@gladlog/analysis/src/data/spellMechanicsGenerated.json";
import { PRESS_ENDED_CC_LAG_MS } from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import {
  canonicalSpellId,
  entryAvailabilityTransitions,
  unitCooldownEntry,
} from "@gladlog/analysis/src/utils/cooldowns";
import {
  DR_CATEGORY_MAP,
  drResetMsAt,
} from "@gladlog/analysis/src/utils/drAnalysis";
import { DEFERRAL_SHIELD_DAMAGE_IDS } from "@gladlog/analysis/src/utils/incomingPressure";

import {
  APPLIED,
  deathMs,
  ev,
  fmtS,
  type IRoundCtx,
  nameOf,
  REFRESH,
  REMOVED,
  secOf,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = [
  "allyOnlySelfSave",
  "reflectDotRun",
  "pressMultiBreak",
  "deathBreakableCc",
] as const;

export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "allyOnlySelfSave|unknownTarget",
  "pressMultiBreak|ccCreditWording",
  "pressMultiBreak|noLine",
  "deathBreakableCc|rootAtDeath",
]);

// ── lookups ──
const MECH = (
  spellMechanicsGenerated as unknown as {
    spells: Record<string, { mech?: number } | undefined>;
  }
).spells;
const DURATION = spellEffectGenerated as unknown as Record<
  string,
  { durationSeconds?: number } | undefined
>;
const DEFERRAL_SHIELDS = new Set(Object.keys(DEFERRAL_SHIELD_DAMAGE_IDS));
/** DB2 SpellMechanic ids of a loss of control the PvP trinket removes (not
 * root 7, silence 9, disarm 3 — classed on their own) */
const CC_MECHANICS = new Set([1, 2, 5, 10, 12, 13, 14, 17, 20, 24, 30]);
const CC_DR = new Set(["Stun", "Incapacitate", "Disorient"]);
const DISARM_MECHANIC = 3;
const ROOT_MECHANIC = 7;
const MEDALLION = "336126";
/** F20 residual: how far from the Medallion's cast row a control it removed
 * may be logged — the product's own predicate (`castEndedCcWindow`), one fact.
 * Measured 2026-10-28 on the 605 raw logs (2,773 Medallion presses): the
 * press's removals are logged in the ms of its own buff row (336126 APPLIED),
 * and that row sits 0–3 ms before the cast row in 2,735 presses. Of the
 * cut-short removals 11–20 ms before the cast row, 15 sit 8–18 ms BEFORE that
 * buff row while the press's own removals sit at it — the control ended
 * before the press acted (an ally's Berserker Shout in that ms, a
 * BROKEN_SPELL, a Cleanse, or no logged cause; cap-int s0/30-5-215's Hammer
 * of Justice, s1/160-1-876's Cheap Shot, s2/121-*'s Mind Control / Void Nova
 * / Mortal Coil among them); only 3 sit at the buff row. 300 ms (and 50 ms)
 * read those, a Kidney Shot a Cheap Shot replaced 201 ms before the press,
 * and Mind Controls whose caster was kicked 250 ms before it, as the press's
 * (cap-int s0/29-2-188 0:22, s0/96-2-510 0:57). */
const PRESS_LEAD_MS = PRESS_ENDED_CC_LAG_MS;
const REFLECT_OWN_IDS = new Set(["23920", "212295"]);
const BROKEN_EVENTS = new Set(["SPELL_AURA_BROKEN", "SPELL_AURA_BROKEN_SPELL"]);

/** F20 residual: spells whose every applied aura (SpellEffect Effect 6) is a
 * dummy (EffectAura 4) — DB2 SpellEffect from the datagen cache, when this
 * machine has one. Binding Shot's tether 117405 carries the stun mechanic
 * (12) at spell level but applies only a dummy aura; the stun is 117526
 * (cap-int s2/4-2-58 2:45: the tether, removed 29 ms before the death, read
 * as a 3 s breakable stun). A mechanic-only control needs a real aura. */
const DUMMY_AURA_ONLY: Set<string> | undefined = (() => {
  const dir =
    process.env.DATAGEN_CACHE ?? join(homedir(), ".cache/gladlog-datagen");
  if (!existsSync(dir)) return undefined;
  const f = readdirSync(dir)
    .filter((n) => /^SpellEffect-[\d.]+\.csv$/.test(n))
    .sort()
    .at(-1);
  if (!f) return undefined;
  const rows = readFileSync(join(dir, f), "utf8").split("\n");
  const head = rows[0]!.split(",");
  const aura = head.indexOf("EffectAura");
  const eff = head.indexOf("Effect");
  const sid = head.indexOf("SpellID");
  const real = new Set<string>();
  const dummy = new Set<string>();
  for (const r of rows.slice(1)) {
    const c = r.split(",");
    if (c.length <= sid || c[eff] !== "6") continue;
    (c[aura] === "4" ? dummy : real).add(c[sid]!);
  }
  return new Set([...dummy].filter((id) => !real.has(id)));
})();

type ControlClass = "cc" | "disarm" | "silence" | "root";
function controlClass(spellId: string | undefined): ControlClass | undefined {
  if (!spellId) return undefined;
  const mech = MECH[spellId]?.mech;
  const dr = DR_CATEGORY_MAP[spellId];
  if (mech === DISARM_MECHANIC) return "disarm";
  if (dr === "Silence") return "silence";
  if (
    (dr && CC_DR.has(dr)) ||
    (mech !== undefined &&
      CC_MECHANICS.has(mech) &&
      !DUMMY_AURA_ONLY?.has(spellId))
  )
    return "cc";
  if (mech === ROOT_MECHANIC) return "root";
  return undefined;
}

const reactionOf = (ctx: IRoundCtx, id: string | undefined): any => {
  if (!id) return undefined;
  const u = ctx.units.find((x) => x.id === id);
  if (!u) return undefined;
  if (u.reaction !== undefined && !u.info && u.ownerId && u.ownerId !== "0") {
    const o = ctx.units.find((x) => x.id === u.ownerId);
    if (o) return o.reaction;
  }
  return u.reaction;
};
const hostileTo = (ctx: IRoundCtx, unit: any, srcId: string | undefined) => {
  if (!srcId || srcId === unit.id) return false;
  const r = reactionOf(ctx, srcId);
  return r !== undefined && r !== unit.reaction;
};

// ── allyOnlySelfSave: the log's own targets, per spell id ──
interface ITally {
  self: number;
  none: number;
  ally: number;
}
const tally = new Map<string, ITally>();
const tallied = new Set<string>();
const idsByName = new Map<string, Set<string>>();
function tallyArchive(path: string): void {
  if (tallied.has(path)) return;
  tallied.add(path);
  if (!existsSync(path)) return;
  const buf = readFileSync(path);
  const text = (path.endsWith(".gz") ? gunzipSync(buf) : buf).toString("utf8");
  for (const line of text.split("\n")) {
    const i = line.indexOf("  SPELL_CAST_SUCCESS,");
    if (i < 0) continue;
    const p = line.slice(i + 2).split(",");
    const src = p[1];
    const srcFlags = Number(p[3]);
    const dest = p[5];
    const destFlags = Number(p[7]);
    const id = p[9];
    if (!id || !src || !src.startsWith("Player-")) continue;
    const t = tally.get(id) ?? { self: 0, none: 0, ally: 0 };
    if (!dest || /^0+$/.test(dest)) t.none++;
    else if (dest === src) t.self++;
    // the same reaction bits as the caster (0x10 friendly … 0x40 hostile)
    else if ((srcFlags & 0xf0) === (destFlags & 0xf0)) t.ally++;
    tally.set(id, t);
    if (!idsByName.has(id)) {
      const n = nameOf(id, "");
      if (n) idsByName.set(n, (idsByName.get(n) ?? new Set()).add(id));
    }
  }
}
/** DB2 `SpellMisc.Attributes_1` bit 19 ("Exclude Caster") from the datagen
 * cache, when this machine has one — the official leg; the log leg alone
 * (no cache) needs `LOG_ONLY_MIN_ALLY` casts */
const EXCLUDE_CASTER: Set<string> | undefined = (() => {
  const dir =
    process.env.DATAGEN_CACHE ?? join(homedir(), ".cache/gladlog-datagen");
  if (!existsSync(dir)) return undefined;
  const f = readdirSync(dir)
    .filter((n) => /^SpellMisc-[\d.]+\.csv$/.test(n))
    .sort()
    .at(-1);
  if (!f) return undefined;
  const rows = readFileSync(join(dir, f), "utf8").split("\n");
  const head = rows[0]!.split(",");
  const a1 = head.indexOf("Attributes_1");
  const sid = head.indexOf("SpellID");
  const out = new Set<string>();
  for (const r of rows.slice(1)) {
    const c = r.split(",");
    if (c.length > sid && Number(c[a1]) & (1 << 19)) out.add(c[sid]!);
  }
  return out;
})();
const LOG_ONLY_MIN_ALLY = 5;
/** true / false / undefined (no logged cast to read it from) */
function allyOnlyByName(name: string): boolean | undefined {
  const ids = [...(idsByName.get(name) ?? [])];
  const known = ids.map((id) => tally.get(id)!).filter((t) => t);
  if (known.length === 0) return undefined;
  if (!known.every((t) => t.self === 0 && t.none === 0)) return false;
  if (known.every((t) => t.ally === 0)) return undefined;
  if (EXCLUDE_CASTER) return ids.some((id) => EXCLUDE_CASTER.has(id));
  return known.reduce((n, t) => n + t.ally, 0) >= LOG_ONLY_MIN_ALLY
    ? true
    : undefined;
}

function allyOnlySelfSave(ctx: IRoundCtx): void {
  const C = "allyOnlySelfSave";
  tallyArchive(ctx.archive);
  const judge = (
    kind: string,
    spell: string,
    atMs: number,
    fact: string,
    detail: string,
    line: string,
  ) => {
    ctx.bump(C);
    const a = allyOnlyByName(spell);
    if (a === undefined)
      ctx.violate(
        C,
        "unknownTarget",
        atMs,
        `${fact}:${spell}`,
        `${spell}: no logged cast on a unit to read the target rule from — ${detail}`,
        line,
      );
    else if (a)
      ctx.violate(
        C,
        kind,
        atMs,
        `${fact}:${spell}`,
        `${spell} cannot target its caster (logged casts: ${[...(idsByName.get(spell) ?? [])].map((id) => `${id} ally ${tally.get(id)?.ally ?? 0}/self ${tally.get(id)?.self ?? 0}`).join(", ")}) — ${detail}`,
        line,
      );
  };
  // (a) KILL SEQUENCE
  const L = ctx.lines;
  for (let i = 0; i < L.length; i++) {
    const m =
      /^(\d+:\d\d)\s+\[DEFENSIVE AVAILABLE\]\s+(\d+)\([^)]*\): (.+?)(?: \(on an ally — [^)]+\))? available but unused/.exec(
        L[i]!,
      );
    if (!m) continue;
    let killed: string | undefined;
    for (let j = i + 1; j < Math.min(L.length, i + 12); j++) {
      const k = /^\d+:\d\d\s+\[KILL\]\s+(\d+)\(/.exec(L[j]!);
      if (k) {
        killed = k[1];
        break;
      }
    }
    if (killed !== m[2]) continue;
    judge(
      "ownDeathOffer",
      m[3]!,
      ctx.start + secOf(m[1]!) * 1000,
      `ks:${ctx.unitOfPid(m[2])?.id}:${m[1]}`,
      `offered to ${m[2]} at their own death`,
      L[i]!,
    );
  }
  // (b) [DEATH] Unused
  for (const l of L) {
    const m = /^(\d+:\d\d)\s+\[DEATH\]\s+(\d+)\(.*?\(Unused: ([^)]+)\)/.exec(l);
    if (!m) continue;
    for (const s of m[3]!.split(", "))
      judge(
        "deathUnused",
        s.trim(),
        ctx.start + secOf(m[1]!) * 1000,
        `death:${ctx.unitOfPid(m[2])?.id}`,
        `listed unused at ${m[2]}'s own death`,
        l,
      );
  }
  // (c) "in hand" text, timeline and menu (one claim per text + name)
  const seenHand = new Set<string>();
  for (const l of [...L, ...ctx.menu.split("\n")]) {
    for (const h of l.matchAll(/gated(?: \(|, )([^;()|]+?) in hand/g)) {
      for (const s of h[1]!.split("/")) {
        const key = `${l.slice(0, 60)}|${s}`;
        if (seenHand.has(key)) continue;
        seenHand.add(key);
        const at = /^\s*\[?(\d+:\d\d)/.exec(l)?.[1];
        judge(
          "inHandText",
          s.trim(),
          ctx.start + (at ? secOf(at) * 1000 : 0),
          `hand:${l.slice(0, 40)}`,
          `named as a save in hand`,
          l,
        );
      }
    }
  }
  // (d) defenseless spans closed by a pressed ally-only external coming back
  const spans = new Map<
    string,
    Array<{ a: number; b: number; line: string }>
  >();
  for (const l of L) {
    const m =
      /^\s+\[(KILL WINDOW|VULNERABLE)\] (\d+:\d\d)–(\d+:\d\d) on [^(]+\(([^)]+)\)(.*)$/.exec(
        l,
      );
    if (!m) continue;
    const dl = /\(defenseless (\d+:\d\d)–(\d+:\d\d)\)/.exec(m[5]!);
    let a: number;
    let b: number;
    if (dl) {
      a = secOf(dl[1]!);
      b = secOf(dl[2]!);
    } else if (m[1] === "VULNERABLE" && /no major defensives/.test(m[5]!)) {
      a = secOf(m[2]!);
      b = secOf(m[3]!);
    } else continue;
    spans.set(m[4]!, [...(spans.get(m[4]!) ?? []), { a, b, line: l }]);
  }
  const roundS = (ctx.roundEndAt - ctx.start) / 1000;
  for (const u of ctx.players) {
    if (u.reaction === ctx.owner.reaction) continue;
    const pressed = new Set<string>();
    for (const c of successesOf(u)) {
      const t = tsOf(c);
      if (t < ctx.start || t > ctx.roundEndAt) continue;
      if (!c.destUnitId || c.destUnitId === u.id || /^0+$/.test(c.destUnitId))
        continue;
      // F20 residual: only an external the kill-window kit holds can close
      // a span by coming back — a lookup of the roster (population), not
      // the fact under audit (whether an ally-only member counts for its
      // holder). Leap of Faith / Intervene are no kit members: their
      // "returns" met spans that a Phase Shift / Blessing of Spellwarding /
      // Guardian Spirit in the same second closed (cap-int s0/34-6-243 2:00,
      // s0/106-1-594 2:53, s2/1-6-17 2:51)
      const id = String(c.spellId);
      if (
        !countsAsKillWindowDefensiveInHand(id) &&
        !countsAsKillWindowDefensiveInHand(canonicalSpellId(id))
      )
        continue;
      if (allyOnlyByName(nameOf(c.spellId, c.spellName)) === true)
        pressed.add(id);
    }
    for (const id of pressed) {
      let entry: any;
      try {
        entry = unitCooldownEntry(u, ctx.legacy as never, id);
      } catch {
        entry = undefined;
      }
      if (!entry) continue;
      const deathS = Math.floor((deathMs(u) - ctx.start) / 1000);
      for (const f of entryAvailabilityTransitions(entry, roundS)) {
        if (!f.available || f.atSeconds <= 0 || f.atSeconds >= roundS) continue;
        ctx.bump(C);
        const back = Math.floor(f.atSeconds);
        for (const s of spans.get(u.name) ?? []) {
          if (Math.abs(s.b - back) > 1) continue;
          if (s.b >= deathS || s.b >= Math.floor(roundS) - 1) continue;
          ctx.violate(
            C,
            "spanCutAtReturn",
            ctx.start + f.atSeconds * 1000,
            `span:${u.id}:${id}:${back}`,
            `${u.name}'s ${nameOf(id, id)} (pressed on an ally) came back at ${fmtS(f.atSeconds)} and the span ${fmtS(s.a)}–${fmtS(s.b)} ends there`,
            s.line,
          );
        }
      }
    }
  }
}

// ── reflectDotRun ──
function reflectDotRun(ctx: IRoundCtx): void {
  const C = "reflectDotRun";
  const lines: Array<{
    sec: number;
    cp: string;
    rp: string;
    spell: string;
    back: number | null;
    line: string;
  }> = [];
  for (const l of ctx.lines) {
    const m =
      /^(\d+:\d\d) {2}\[REFLECTED\] {3}(\d+)\([^)]*\)'s (.+?) reflected(?: ×\d+)? by (\d+)\([^)]*\)(?: \(came back for (\d+)k\))?/.exec(
        l,
      );
    if (m)
      lines.push({
        sec: secOf(m[1]!),
        cp: m[2]!,
        rp: m[4]!,
        spell: m[3]!,
        back: m[5] !== undefined ? Number(m[5]) : null,
        line: l,
      });
  }
  for (const caster of ctx.units) {
    const cp = ctx.pidOf(caster.name);
    if (!cp) continue;
    // F20 wide residual: a REFLECT row aimed at its own caster is the
    // copy's bounce, not a reflect (4eea3cc5 r1 1:11: two Nether Wards; the
    // self row in the ms of the real one) — the product's
    // `isCountedReflectRow`, inlined (this scan runs on the pre-fix code)
    const reflects = ((caster.missesOut ?? []) as any[])
      .filter(
        (m) =>
          m.missType === "REFLECT" &&
          m.spellId &&
          !(m.srcUnitId && m.srcUnitId === m.destUnitId),
      )
      .sort((x, y) => tsOf(x) - tsOf(y));
    const chains: Array<{ first: any; last: number }> = [];
    for (const m of reflects) {
      const c = [...chains]
        .reverse()
        .find(
          (x) =>
            nameOf(x.first.spellId, x.first.spellName) ===
              nameOf(m.spellId, m.spellName) &&
            x.first.destUnitId === m.destUnitId,
        );
      if (c && tsOf(m) - c.last <= 3000) c.last = tsOf(m);
      else chains.push({ first: m, last: tsOf(m) });
    }
    for (const g of chains) {
      const t0 = tsOf(g.first);
      if (t0 < ctx.start || t0 > ctx.roundEndAt) continue;
      const reflector = ctx.units.find((u) => u.id === g.first.destUnitId);
      const rp = reflector && ctx.pidOf(reflector.name);
      if (!reflector || !rp) continue;
      const S = String(g.first.spellId);
      const sName = nameOf(S, g.first.spellName);
      const isS = (id: string | undefined, fb = "") =>
        !!id &&
        (id === S ||
          (!BACKLASH_AURA_CC_TYPE.has(id) && nameOf(id, fb) === sName));
      const srcs = new Set<string>([
        reflector.id,
        ...ctx.units
          .filter((u) => u.ownerId === reflector.id)
          .map((u) => u.id as string),
      ]);
      // the reflected copy's run(s)
      const auras = ((caster.auraEvents ?? []) as any[]).filter((a) =>
        isS(a.spellId, a.spellName),
      );
      const runs: Array<{ from: number; to: number; src: string }> = [];
      // F20 wide residual: a later reflect of the spell that REFRESHes the
      // caster's copy owns the rest of the copy's run (a refresh replaces
      // the aura; d6d8a412 r1 2:07 / 2:17 Shadow Word: Pain) — this chain's
      // run ends there, and a chain whose copy starts with a REFRESH runs
      // from it
      const laterT0 = chains
        .filter(
          (c) =>
            c !== g &&
            tsOf(c.first) > t0 &&
            nameOf(c.first.spellId, c.first.spellName) === sName,
        )
        .map((c) => tsOf(c.first));
      for (let k = 0; k < auras.length; k++) {
        const a = auras[k];
        const refresh =
          ev(a) === REFRESH &&
          a.srcUnitId === caster.id &&
          tsOf(a) >= t0 - 500 &&
          tsOf(a) <= g.last + 3000;
        if (ev(a) !== APPLIED && !refresh) continue;
        if (a.srcUnitId !== caster.id && !srcs.has(a.srcUnitId)) continue;
        const prev = runs.find(
          (r) => r.to === tsOf(a) && r.src === a.srcUnitId,
        );
        const rm = auras.find(
          (b, j) =>
            j > k &&
            b.srcUnitId === a.srcUnitId &&
            b.spellId === a.spellId &&
            ev(b) === REMOVED,
        );
        const to = rm ? tsOf(rm) : ctx.roundEndAt;
        if (prev) prev.to = to;
        else if (tsOf(a) >= t0 - 500 && tsOf(a) <= g.last + 3000)
          runs.push({ from: tsOf(a), to, src: a.srcUnitId });
      }
      for (const r of runs) {
        const cut = laterT0.find((t) => t > r.from && t < r.to);
        if (cut !== undefined) r.to = cut - 1;
      }
      if (!runs.some((r) => r.to - t0 > 20_000)) continue;
      ctx.bump(C);
      const inRun = (src: string, ts: number) =>
        runs.some((r) => r.src === src && ts >= r.from && ts <= r.to);
      // F20 residual: a source whose own aura of the spell was already on the
      // caster before the chain ticks its own DoT, not the reflect (cap-int
      // s1/181-1-976 1:01: the reflecting Affliction Warlock's own
      // Corruption ticked 15.6k on the caster inside the 3 s window; the
      // line's 98k is the copy's run alone)
      const ownRuns = auras
        .map((a, k) => ({ a, k }))
        .filter(({ a }) => ev(a) === APPLIED && tsOf(a) < t0 - 500)
        .map(({ a, k }) => {
          const rm = auras.find(
            (b, j) =>
              j > k &&
              b.srcUnitId === a.srcUnitId &&
              b.spellId === a.spellId &&
              ev(b) === REMOVED,
          );
          return {
            src: a.srcUnitId as string,
            from: tsOf(a),
            to: rm ? tsOf(rm) : Infinity,
          };
        });
      const preexisting = (src: string, ts: number) =>
        ownRuns.some((r) => r.src === src && ts > r.from && ts <= r.to);
      const direct = (src: string, ts: number) =>
        (src === caster.id || srcs.has(src)) &&
        ts >= t0 - 500 &&
        ts <= g.last + 3000 &&
        !preexisting(src, ts);
      // F20 residual: a row of the reflector's own id belongs to the chain
      // whose REFLECT row is nearest (the product's reading — one hit, one
      // chain). Two chains 0.5 s apart both took a 149k Nether Ward hit
      // (cap-int s1/197-3-1070 0:28: Wither reflected 20.776, Soul Fire
      // 21.247, the 212295 row 21.738 is Soul Fire's; Wither printed 97k,
      // the scan read 245.7k)
      const toReflector = reflects.filter((m) => m.destUnitId === reflector.id);
      const ownRowIsThisChain = (ts: number) => {
        const near = toReflector
          .filter((m) => ts >= tsOf(m) - 500)
          .reduce(
            (b: any, m: any) =>
              !b || Math.abs(ts - tsOf(m)) < Math.abs(ts - tsOf(b)) ? m : b,
            undefined,
          );
        return (
          !!near &&
          nameOf(near.spellId, near.spellName) === sName &&
          tsOf(near) >= t0 &&
          tsOf(near) <= g.last
        );
      };
      let total = 0;
      for (const d of (caster.damageIn ?? []) as any[]) {
        const ts = tsOf(d);
        if (REFLECT_OWN_IDS.has(String(d.spellId))) {
          if (
            srcs.has(d.srcUnitId) &&
            direct(d.srcUnitId, ts) &&
            ownRowIsThisChain(ts)
          )
            total += Math.abs(d.effectiveAmount);
          continue;
        }
        if (!isS(d.spellId, d.spellName)) continue;
        if (direct(d.srcUnitId, ts) || inRun(d.srcUnitId, ts))
          total += Math.abs(d.effectiveAmount);
      }
      for (const a of (caster.absorbsIn ?? []) as any[]) {
        if (DEFERRAL_SHIELDS.has(String(a.spellId))) continue;
        const ts = tsOf(a);
        if (REFLECT_OWN_IDS.has(String(a.attackSpellId))) {
          if (
            srcs.has(a.attackerId) &&
            direct(a.attackerId, ts) &&
            ownRowIsThisChain(ts)
          )
            total += Math.abs(a.absorbedAmount);
          continue;
        }
        if (!isS(a.attackSpellId, a.attackSpellName)) continue;
        if (direct(a.attackerId, ts) || inRun(a.attackerId, ts))
          total += Math.abs(a.absorbedAmount);
      }
      const acts = ((caster.advancedActions ?? []) as any[]).filter(
        (x) => x.advancedActorId === caster.id && x.advancedActorMaxHp > 0,
      );
      const near = acts.reduce(
        (b: any, x: any) =>
          !b || Math.abs(tsOf(x) - t0) < Math.abs(tsOf(b) - t0) ? x : b,
        undefined,
      );
      const maxHp: number = near?.advancedActorMaxHp ?? 0;
      const sec = Math.floor((t0 - ctx.start) / 1000);
      const line = lines.find(
        (x) =>
          x.cp === cp &&
          x.rp === rp &&
          x.spell === sName &&
          Math.abs(x.sec - sec) <= 1,
      );
      const runTxt = runs
        .map(
          (r) =>
            `${fmtS((r.from - ctx.start) / 1000)}–${fmtS((r.to - ctx.start) / 1000)}`,
        )
        .join(", ");
      const fact = `${caster.id}:${S}:${t0}`;
      if (line?.back !== null && line?.back !== undefined) {
        if (Math.abs(line.back * 1000 - total) > Math.max(2000, 0.1 * total))
          ctx.violate(
            C,
            "amount",
            t0,
            fact,
            `${cp}'s ${sName} by ${rp}: printed ${line.back}k, the copy's run ${runTxt} gives ${(total / 1000).toFixed(1)}k`,
            line.line,
          );
      } else if (
        !line &&
        maxHp > 0 &&
        total >= 0.05 * maxHp &&
        // F20 wide residual: two reflectors logged a REFLECT of one cast in
        // one ms (c5c7e005 r4 0:13 Agony) — there is one copy, and the line
        // naming the other reflector states it
        !lines.some(
          (x) =>
            x.cp === cp && x.spell === sName && Math.abs(x.sec - sec) <= 1,
        )
      )
        ctx.violate(
          C,
          "noLine",
          t0,
          fact,
          `${cp}'s ${sName} by ${rp} at ${fmtS((t0 - ctx.start) / 1000)}: ${(total / 1000).toFixed(1)}k back over the copy's run ${runTxt} (${((total / maxHp) * 100).toFixed(1)}% of max HP), no [REFLECTED] line`,
        );
    }
  }
}

// ── pressMultiBreak / deathBreakableCc: control runs on a unit ──
interface IControlRun {
  spellId: string;
  name: string;
  cls: ControlClass;
  from: number;
  /** REMOVED ms, or undefined when none is logged */
  to: number | undefined;
}
function controlRuns(ctx: IRoundCtx, u: any): IControlRun[] {
  const out: IControlRun[] = [];
  const auras = (u.auraEvents ?? []) as any[];
  for (let k = 0; k < auras.length; k++) {
    const a = auras[k];
    if (ev(a) !== APPLIED || a.auraType !== "DEBUFF") continue;
    const cls = controlClass(a.spellId);
    if (!cls || !hostileTo(ctx, u, a.srcUnitId)) continue;
    const rm = auras.find(
      (b, j) =>
        j > k &&
        b.spellId === a.spellId &&
        b.srcUnitId === a.srcUnitId &&
        ev(b) === REMOVED,
    );
    // a REMOVED + APPLIED of the same aura in one ms continues the run
    const prev = out.find(
      (r) => r.spellId === String(a.spellId) && r.to === tsOf(a),
    );
    if (prev) {
      prev.to = rm ? tsOf(rm) : undefined;
      continue;
    }
    out.push({
      spellId: String(a.spellId),
      name: nameOf(a.spellId, a.spellName),
      cls,
      from: tsOf(a),
      to: rm ? tsOf(rm) : undefined,
    });
  }
  return out;
}
/** a run ended by nothing the holder pressed: its length is the control's
 * natural one on this round (DR and talents included) */
function naturalLengths(ctx: IRoundCtx): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const u of ctx.players) {
    const pressMs = successesOf(u).map(tsOf);
    const auras = (u.auraEvents ?? []) as any[];
    for (const r of controlRuns(ctx, u)) {
      if (r.to === undefined) continue;
      if (pressMs.some((p) => Math.abs(p - r.to!) <= 300)) continue;
      if (
        auras.some(
          (b) =>
            b.spellId === r.spellId &&
            BROKEN_EVENTS.has(ev(b)) &&
            Math.abs(tsOf(b) - r.to!) <= 300,
        )
      )
        continue;
      if (deathMs(u) - r.to! <= 300 && deathMs(u) >= r.to!) continue;
      out.set(r.spellId, [
        ...(out.get(r.spellId) ?? []),
        (r.to - r.from) / 1000,
      ]);
    }
  }
  return out;
}
/** F20 residual: the DR step a run landed at — the hostile applications of
 * its DR family on the unit before it, a chain reset by a gap ≥ the era's
 * reset window after the chain's latest end (1, ½, ¼); undefined with no
 * family (a disarm-mechanic aura with no DR row — Faerie Swarm 209749,
 * Sticky Tar Bomb 407031/407032 — takes the Disarm family). The old "any of
 * 1 / ½ / ¼ ± 0.15 s" read a 1.13–1.33 s disarm
 * the Medallion removed in its own ms as a ¼-DR run that ran out
 * (disarmFalseCredit, cap-int s0/89-1-473 0:10). */
const drFamilyOf = (r: IControlRun): string | undefined =>
  DR_CATEGORY_MAP[r.spellId] ?? (r.cls === "disarm" ? "Disarm" : undefined);
function drFraction(runs: IControlRun[], r: IControlRun): number | undefined {
  const fam = drFamilyOf(r);
  if (!fam) return undefined;
  const reset = drResetMsAt(r.from);
  let level = 0;
  let chainEnd = -Infinity;
  for (const x of runs
    .filter((y) => drFamilyOf(y) === fam && y.from < r.from)
    .sort((a, b) => a.from - b.from)) {
    level = x.from - chainEnd >= reset ? 1 : level + 1;
    chainEnd = Math.max(
      x.from - chainEnd >= reset ? -Infinity : chainEnd,
      x.to ?? x.from,
    );
  }
  if (r.from - chainEnd >= reset) level = 0;
  return [1, 0.5, 0.25][Math.min(level, 2)];
}
const ranFull = (
  r: IControlRun,
  natural: Map<string, number[]>,
  frac?: number,
): boolean => {
  if (r.to === undefined) return false;
  const len = (r.to - r.from) / 1000;
  // a natural length counts when the round shows it twice (F20 residual: one
  // run an ally's dispel or freedom ended early, logged with no press of the
  // holder's, made a 1.9 s Faerie Swarm the Medallion removed in its own ms
  // read as "ran its natural length" — cap-int s0/161-3-954 1:38)
  const nat = natural.get(r.spellId) ?? [];
  if (
    nat.some(
      (n) =>
        Math.abs(n - len) <= 0.1 &&
        nat.filter((m) => Math.abs(m - n) <= 0.1).length >= 2,
    )
  )
    return true;
  const d = DURATION[r.spellId]?.durationSeconds;
  if (!d) return false;
  // at its DR step, the product's own reading (`ranFullLength`: removal at or
  // after the official end) with 20 ms of log jitter — a 4.962 s Grapple
  // Weapon removed in the Medallion's own ms had not expired (cap-int
  // s0/29-2-188 0:22)
  if (frac !== undefined) return len >= d * frac - 0.02;
  return (
    len >= d - 0.1 || [1, 0.5, 0.25].some((f) => Math.abs(len - d * f) <= 0.15)
  );
};

const LINE_TAG: Record<Exclude<ControlClass, "root">, string> = {
  cc: "CC ON TEAM",
  disarm: "DISARM",
  silence: "SILENCE",
};
function pressMultiBreak(ctx: IRoundCtx): void {
  const C = "pressMultiBreak";
  const natural = naturalLengths(ctx);
  for (const u of ctx.players) {
    if (u.reaction !== ctx.owner.reaction) continue;
    const pid = ctx.pidOf(u.name);
    if (!pid) continue;
    const presses = successesOf(u)
      .filter((c) => String(c.spellId) === MEDALLION)
      .map(tsOf)
      .filter((t) => t >= ctx.start && t <= ctx.roundEndAt);
    const runs = controlRuns(ctx, u);
    const auras = (u.auraEvents ?? []) as any[];
    const dispels = ((u.actionIn ?? []) as any[]).filter((a) =>
      /DISPEL/.test(ev(a) ?? ""),
    );
    const ended = (r: IControlRun, p: number) =>
      r.to !== undefined &&
      r.to >= p - PRESS_LEAD_MS &&
      r.to <= p + PRESS_LEAD_MS &&
      !ranFull(r, natural, drFraction(runs, r)) &&
      !auras.some(
        (b) =>
          b.spellId === r.spellId &&
          BROKEN_EVENTS.has(ev(b)) &&
          tsOf(b) <= r.to! &&
          r.to! - tsOf(b) <= 300,
      ) &&
      !dispels.some(
        (d) =>
          String(d.extraSpellId) === r.spellId &&
          Math.abs(tsOf(d) - r.to!) <= 100,
      );
    for (const p of presses) {
      for (const r of runs) {
        if (r.cls === "root" || !ended(r, p)) continue;
        ctx.bump(C);
        const tag = LINE_TAG[r.cls];
        const fromS = Math.floor((r.from - ctx.start) / 1000);
        const toS = Math.floor((r.to! - ctx.start) / 1000);
        // every line of the run: a refresh prints its own line (6be60aae
        // 2:22 / 2:26 Fear), the credit sits on the one the press ended
        const runLines = ctx.lines.filter((l) => {
          const m = new RegExp(
            String.raw`^(\d+:\d\d)\s+\[${tag}\]\s+(\d+)\([^)]*\) ← (.+?) \(by `,
          ).exec(l);
          return (
            !!m &&
            m[2] === pid &&
            m[3] === r.name &&
            secOf(m[1]!) >= fromS - 1 &&
            secOf(m[1]!) <= toS + 1
          );
        });
        const creditRe = new RegExp(
          String.raw`trinket broke this ${r.cls === "cc" ? "CC" : r.cls}`,
        );
        const line =
          runLines.find((l) => creditRe.test(l)) ??
          runLines.find((l) => /ended by their PvP trinket/.test(l)) ??
          runLines[0];
        const fact = `${u.id}:${r.spellId}:${r.from}`;
        const what = `${pid}'s ${r.name} ${fmtS((r.from - ctx.start) / 1000)}→${fmtS((r.to! - ctx.start) / 1000)} ended by the Medallion at ${fmtS((p - ctx.start) / 1000)}`;
        if (!line) {
          ctx.violate(C, "noLine", p, fact, `${what}: no [${tag}] line`);
          continue;
        }
        if (creditRe.test(line)) continue;
        if (r.cls === "cc" && /ended by their PvP trinket/.test(line))
          ctx.violate(
            C,
            "ccCreditWording",
            p,
            fact,
            `${what}: credited as "ended by their PvP trinket"`,
            line,
          );
        else
          ctx.violate(
            C,
            `${r.cls}NoCredit`,
            p,
            fact,
            `${what}: the line does not say the trinket broke it`,
            line,
          );
      }
    }
    // inverse: a disarm tail no press explains
    for (const l of ctx.lines) {
      const m =
        /^(\d+:\d\d)\s+\[DISARM\]\s+(\d+)\([^)]*\) ← (.+?) \(by .*trinket broke this disarm after (\d+)s/.exec(
          l,
        );
      if (!m || m[2] !== pid) continue;
      ctx.bump(C);
      const at = ctx.start + (secOf(m[1]!) + Number(m[4])) * 1000;
      const ok = presses.some(
        (p) =>
          Math.abs(p - at) <= 2000 &&
          runs.some((r) => r.cls === "disarm" && ended(r, p)),
      );
      if (!ok)
        ctx.violate(
          C,
          "disarmFalseCredit",
          at,
          `${u.id}:${m[1]}:${m[3]}`,
          `${pid}'s ${m[3]} at ${m[1]}: no Medallion press ended a disarm of theirs near ${fmtS((at - ctx.start) / 1000)}`,
          l,
        );
    }
  }
}

function deathBreakableCc(ctx: IRoundCtx): void {
  const C = "deathBreakableCc";
  for (const l of ctx.lines) {
    const m =
      /^(\d+:\d\d)\s+\[DEATH\]\s+(\d+)\(.*?— friendly\).*?\(PvP Trinket available(; [^)]*)?\)/.exec(
        l,
      );
    if (!m) continue;
    const u = ctx.unitOfPid(m[2]);
    if (!u) continue;
    const D = deathMs(u);
    if (!Number.isFinite(D)) continue;
    ctx.bump(C);
    const tail = m[3] ?? "";
    const deathS = Math.floor((D - ctx.start) / 1000);
    const runs = controlRuns(ctx, u).filter((r) => r.from <= D);
    const rounded = (r: IControlRun) =>
      Number((((r.to ?? D) - r.from) / 1000).toFixed(0));
    const overlaps = (r: IControlRun) =>
      Math.floor((r.from - ctx.start) / 1000) + rounded(r) >= deathS - 10;
    const cc = runs.filter((r) => r.cls === "cc" && overlaps(r));
    const breakable = cc.filter((r) => rounded(r) >= 2);
    const uAuras = (u.auraEvents ?? []) as any[];
    // F20 residual: a control a hit broke just before the death (a BROKEN
    // row at its removal) ended on the break, not on the death (cap-int
    // s2/81-1-570 0:37: Ring of Frost broken by Frost Splinter 52 ms before
    // UNIT_DIED; the line reads `broken by … Frost Splinter`)
    const atDeath = (r: IControlRun) =>
      r.to === undefined ||
      r.to > D ||
      (Math.abs(r.to - D) <= 200 &&
        !uAuras.some(
          (b) =>
            String(b.spellId) === r.spellId &&
            BROKEN_EVENTS.has(ev(b)) &&
            tsOf(b) <= r.to! &&
            r.to! - tsOf(b) <= 300,
        ));
    const deathCut = cc.filter((r) => rounded(r) < 2 && atDeath(r));
    const saysNone = /no breakable CC/.test(tail);
    const fact = `${u.id}:${D}`;
    if (breakable.length > 0) {
      if (saysNone)
        ctx.violate(
          C,
          "noneButBreakable",
          D,
          fact,
          `${m[2]} died ${m[1]}: ${breakable.map((r) => `${r.name} ${fmtS((r.from - ctx.start) / 1000)} (${rounded(r)}s)`).join(", ")} on them`,
          l,
        );
    } else if (deathCut.length > 0) {
      const named = deathCut.find((r) => tail.includes(r.name));
      if (!named)
        ctx.violate(
          C,
          "deathCutUnnamed",
          D,
          fact,
          `${m[2]} died ${m[1]} under ${deathCut.map((r) => `${r.name} (landed ${((D - r.from) / 1000).toFixed(1)} s before)`).join(", ")}; the tag says "${tail.slice(2) || "available"}"`,
          l,
        );
      else {
        const lead = new RegExp(
          String.raw`${named.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} landed ([\d.]+) s before`,
        ).exec(tail);
        const truth = (D - named.from) / 1000;
        if (lead && Math.abs(Number(lead[1]) - truth) > 0.15)
          ctx.violate(
            C,
            "deathCutLead",
            D,
            fact,
            `${named.name}: printed ${lead[1]} s, log ${truth.toFixed(2)} s`,
            l,
          );
      }
    } else if (!saysNone)
      ctx.violate(
        C,
        "bareButNone",
        D,
        fact,
        `${m[2]} died ${m[1]}: bare "PvP Trinket available" with no trinket-breakable control in the last 10 s`,
        l,
      );
    if (saysNone) {
      const roots = runs.filter((r) => r.cls === "root" && atDeath(r));
      if (roots.length > 0)
        ctx.violate(
          C,
          "rootAtDeath",
          D,
          fact,
          `${m[2]}: ${roots.map((r) => r.name).join(", ")} ran to the death`,
          l,
        );
    }
  }
}

export function run(ctx: IRoundCtx): void {
  allyOnlySelfSave(ctx);
  reflectDotRun(ctx);
  pressMultiBreak(ctx);
  deathBreakableCc(ctx);
}

/** the ally-only names the log showed (every archive read) */
export function report(): string[] {
  const names = [...idsByName.keys()]
    .filter((n) => allyOnlyByName(n) === true)
    .filter((n) =>
      [...idsByName.get(n)!].some((id) => (tally.get(id)?.ally ?? 0) >= 3),
    )
    .sort();
  return [
    `singles1: ally-only = log targets ∧ ${EXCLUDE_CASTER ? `DB2 Exclude Caster (${EXCLUDE_CASTER.size} ids, datagen cache)` : `no DB2 cache — log only, ≥ ${LOG_ONLY_MIN_ALLY} ally casts`}`,
    `singles1 inventory — spells the log shows cast only on another unit of the caster's side (≥ 3 casts, never self, never untargeted): ${names.length}`,
    `  ${names.slice(0, 60).join(", ")}`,
  ];
}

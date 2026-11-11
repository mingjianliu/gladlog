/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents, advancedActions) */
/**
 * scan5/fact8.ts — the round-8 audit's class checks (fact8 F23). Log rows are
 * the truth; each check names the class it counts.
 *
 *  - `resCdBeforeNextPress` (class 1 and class 6): a `[RES]` `cd:` entry
 *    `X(Ns)` whose unit pressed X again more than 2 s before that back time.
 *    Kind = the spell. A free recast and a cooldown that runs short both land
 *    here; a range entry (`64–121s`, `≤53s`) states no single back time and is
 *    not read. The row's own second is excluded: a press beside it is the one
 *    the row reports.
 *  - `empowerFiledAsChannel` (class 2, D4): a kick-eaten row with
 *    `phase=channel` on a hold the log closed with SPELL_EMPOWER_INTERRUPT.
 *  - `externalFiledAsPopped` (class 3, D2 / D20): `FAILED: popped X` where
 *    every X aura on the target inside the attempt came from another unit.
 *  - `staleDipWithDamage` (class 8, D16): a `[STATE]` tick more than 3 points
 *    above the unit's last row of the second, whose fall off the row before
 *    it the unit's own damage rows explain.
 *  - `auraActivationNoLine` (class 5, D11 D17 D22 D26 D40): a unit's own buff
 *    of a tracked cooldown goes up with no press of it near, and no line of a
 *    press tag names it for that unit. Kind = `<side>/<spell>`. Log rows only:
 *    a row of the batch that re-states a unit (`RESTATE_BATCH` self rows,
 *    each within `RESTATE_BATCH_GAP_MS` of the one before) is no activation. Kind `unlogged press (dated)` (not
 *    in the total): a cooldown whose aura stands for an unlogged press on
 *    the log's date (`AURA_PRESS_BY_ERA`, `auraStandsForPressAt`: Doom Winds
 *    before 12.1.5, fact11 D44 / user ruling 2026-11-05 — our side prints no
 *    `(no press)` line for it).
 *  - `ledgerOnePressTwice` (class 11, D1): two identical burst-ledger
 *    "major defensive up" lines in a row.
 *  - `pressFiledHealAndDef` (class 11, D37): one press on an `[ENEMY HEAL CD]`
 *    and an `[ENEMY DEF]` line of the same second.
 *  - `silenceImmuneNoLine` (class 11, D27): our side's silence logged IMMUNE
 *    on an enemy, no line naming it in that second.
 *  - `backlashTrinketNoNote` (class 11, D33): a backlash silence the unit's
 *    Medallion ended, its `[SILENCE]` line without the break note.
 *  - `racialPressNoLine` (class 11, D49): our side's press of a racial that
 *    shares the trinket's lock, no line naming it in that second.
 */
import { parseResRow } from "@gladlog/analysis/src/context/resRow";
import {
  castsOfEffectAura,
  effectAurasOfCast,
} from "@gladlog/analysis/src/data/castEffectAuras";
import { classMetadata } from "@gladlog/analysis/src/data/classSpells";
import { ENEMY_HEAL_CD_IDS } from "@gladlog/analysis/src/data/enemyHealCds";
import { RACIAL_TRINKET_LOCK_MS } from "@gladlog/analysis/src/data/racialAbilities";
import {
  effectiveCooldownSeconds,
  getEnglishSpellName,
  spellEffectData,
} from "@gladlog/analysis/src/data/spellEffectData";
import {
  AURA_PRESS_BY_ERA,
  auraStandsForPressAt,
} from "@gladlog/analysis/src/utils/auraActivationEra";
import {
  isFormReshiftCast,
  isNoPressRow,
} from "@gladlog/analysis/src/utils/castPress";
import { SELF_SAVE_IDS } from "@gladlog/analysis/src/utils/enemyDefensives";
import { logInstantOf } from "@gladlog/analysis/src/utils/logEra";
import { MEDALLION_SPELL_ID } from "@gladlog/analysis/src/utils/pvpTrinketUses";
import { OFFENSIVE_CD_SPELL_IDS } from "@gladlog/analysis/src/utils/spellDanger";
import { ccMechanicOf } from "@gladlog/analysis/src/utils/spellMechanics";

import {
  APPLIED,
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
  "resCdBeforeNextPress",
  "empowerFiledAsChannel",
  "externalFiledAsPopped",
  "staleDipWithDamage",
  "auraActivationNoLine",
  "ledgerOnePressTwice",
  "pressFiledHealAndDef",
  "silenceImmuneNoLine",
  "backlashTrinketNoNote",
  "racialPressNoLine",
] as const;

export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "auraActivationNoLine|unlogged press (dated)",
]);

/** Unstable Affliction's dispel backlash (`BACKLASH_AURA_CC_TYPE`) */
const BACKLASH_SILENCE_ID = "196364";
/** how far after the tick a max-HP step still explains the fall before it */
const BUFF_STEP_LOOKAHEAD_MS = 1500;
// `(Ns)` or a range `(lo–his)` (an entry whose combat events may shorten it:
// the low end is the earliest it can be back, fact10 D1 / D16)
const RES_CD = /(?:^|[ ,])(?:(\d+):)?([A-Z][^,()[\]]*?)\((\d+)(?:–\d+)?s\)/g;
const TIMED = /^\s*(\d+):(\d\d)\s/;
/** the back time may sit this far past the press: a floored row, a slack */
const BACK_SLACK_MS = 2000;
/** two rows of one button this close are one press */
const SAME_PRESS_MS = 100;

function resCd(ctx: IRoundCtx): void {
  const memo = new Map<string, number[]>();
  const pressesOf = (u: any, name: string): number[] => {
    const key = `${u.id}|${name}`;
    let out = memo.get(key);
    if (!out) {
      const rows = (u.spellCastEvents ?? []) as any[];
      out = successesOf(u)
        // a row of the name with no cooldown of its own is no press of the
        // button: Odyn's Fury's three hit rows after the press, Divine Hymn's
        // tick, Alter Time's return (a different id, the same name); nor is
        // a row the product reads as no press (`isNoPressRow`: Champion's
        // Spear's re-press 1271980 while the spear stands, GH #177), nor a
        // shift back into a form whose cooldown is running
        // (`isFormReshiftCast`: Incarnation: Tree of Life re-entered under
        // its own buff), nor a press after the round's end of play (a Solo
        // Shuffle round's rows run into the next round's preparation, where
        // Arena Preparation resets cooldowns: 05b762f1 r1 Stasis at 2:44,
        // the round over at 2:22)
        .filter(
          (c) =>
            nameOf(c.spellId, c.spellName) === name &&
            (effectiveCooldownSeconds(c.spellId) ?? 0) > 0 &&
            !isNoPressRow(c, rows) &&
            !isFormReshiftCast(u, c) &&
            tsOf(c) <= ctx.roundEndAt,
        )
        .map(tsOf)
        .sort((a, b) => a - b)
        // a row within `SAME_PRESS_MS` of the one before is that press logged
        // twice (Power Infusion's self copy 16–25 ms after the press, which
        // can cross into the next second: dca02448 r4 0:23.979 / 0:24.004);
        // a human's second press lands ≥ 0.485 s later (the ledger's fold)
        .filter((t, i, a) => i === 0 || t - a[i - 1]! > SAME_PRESS_MS);
      memo.set(key, out);
    }
    return out;
  };
  let t = 0;
  for (const line of ctx.lines) {
    const timed = TIMED.exec(line);
    if (timed) t = +timed[1]! * 60 + +timed[2]!;
    const cd = parseResRow(line)?.cd;
    if (!cd) continue;
    for (const e of cd.matchAll(RES_CD)) {
      const unit = e[1] ? ctx.unitOfPid(e[1]) : ctx.owner;
      if (!unit) continue;
      ctx.bump("resCdBeforeNextPress");
      const at = ctx.start + t * 1000;
      const back = at + Number(e[3]) * 1000;
      const next = pressesOf(unit, e[2]!).find((p) => p >= at + 1000);
      if (next !== undefined && next < back - BACK_SLACK_MS)
        ctx.violate(
          "resCdBeforeNextPress",
          e[2]!,
          at,
          `${unit.name}#${e[2]}#${Math.floor((next - ctx.start) / 1000)}`,
          `${e[2]}(${e[3]}s) at ${fmtS(t)}, pressed ${fmtS((next - ctx.start) / 1000)}`,
          line,
        );
    }
  }
}

const KICK_ROW =
  /type=kick-eaten t=([\d.]+)s .*?interrupted=([^,]+),.*?phase=channel/g;

function empowerChannel(ctx: IRoundCtx): void {
  const stops: any[] = ctx.owner?.empowerInterrupts ?? [];
  for (const m of ctx.menu.matchAll(KICK_ROW)) {
    ctx.bump("empowerFiledAsChannel");
    const at = ctx.start + +m[1]! * 1000;
    if (stops.some((e) => Math.abs(tsOf(e) - at) <= 200))
      ctx.violate(
        "empowerFiledAsChannel",
        m[2]!,
        at,
        `${ctx.owner.name}#${m[1]}`,
        `${m[2]} kicked on its hold at ${m[1]}s, phase=channel`,
      );
  }
}

const ATTEMPT =
  /^\s*\[(\d+):(\d\d)–(\d+):(\d\d)\] on (\S.*?) — .*\| FAILED: (.*)$/;

function poppedByAlly(ctx: IRoundCtx): void {
  for (const line of ctx.lines) {
    const m = ATTEMPT.exec(line);
    if (!m) continue;
    const target = ctx.byName.get(m[5]!);
    if (!target) continue;
    const popped = /(?:^|; )popped ([^;|]*)/.exec(m[6]!);
    if (!popped) continue;
    const fromMs = ctx.start + secOf(`${m[1]}:${m[2]}`) * 1000;
    const toMs = ctx.start + (secOf(`${m[3]}:${m[4]}`) + 1) * 1000;
    for (const raw of popped[1]!.split("/")) {
      const name = raw.replace(/ \[[^\]]*\]/, "").trim();
      ctx.bump("externalFiledAsPopped");
      const rows = ((target.auraEvents ?? []) as any[]).filter(
        (a) =>
          (ev(a) === APPLIED || ev(a) === REFRESH) &&
          getEnglishSpellName(a.spellId, a.spellName ?? "") === name &&
          tsOf(a) <= toMs,
      );
      const near = rows.filter((a) => tsOf(a) >= fromMs - 30_000);
      const ownPress = successesOf(target).some(
        (c) =>
          nameOf(c.spellId, c.spellName) === name &&
          tsOf(c) >= fromMs - 30_000 &&
          tsOf(c) <= toMs,
      );
      if (
        near.length > 0 &&
        !ownPress &&
        near.every((a) => a.srcUnitId && a.srcUnitId !== target.id)
      )
        ctx.violate(
          "externalFiledAsPopped",
          name,
          fromMs,
          `${target.name}#${m[1]}:${m[2]}#${name}`,
          `popped ${name} on ${target.name}, aura source ${near[0].srcUnitName}`,
          line,
        );
    }
  }
}

const STATE_FRIEND = /\b(\d+)\([A-Z][A-Za-z]*\):(\d+)\b/g;
/** points a tick may sit over the last row: rounding and the same second */
const STATE_SLACK_PCT = 3;

function staleDip(ctx: IRoundCtx): void {
  let t = 0;
  for (const line of ctx.lines) {
    const timed = TIMED.exec(line);
    if (timed) t = +timed[1]! * 60 + +timed[2]!;
    if (!/\[STATE\]/.test(line)) continue;
    for (const m of line.matchAll(STATE_FRIEND)) {
      const unit = ctx.unitOfPid(m[1]);
      if (!unit) continue;
      const printed = +m[2]!;
      // the tick is the reading at the second's start (`gridHpPct`)
      const endMs = ctx.start + t * 1000 + 1;
      const rows = ((unit.advancedActions ?? []) as any[])
        .filter(
          (a) =>
            a.advancedActorId === unit.id &&
            a.advancedActorMaxHp > 0 &&
            tsOf(a) < endMs,
        )
        .sort((a, b) => tsOf(a) - tsOf(b));
      const last = rows[rows.length - 1];
      if (!last || tsOf(last) < endMs - 2000) continue;
      ctx.bump("staleDipWithDamage");
      const pct = (a: any) =>
        (100 * a.advancedActorCurrentHp) / a.advancedActorMaxHp;
      if (printed - pct(last) <= STATE_SLACK_PCT) continue;
      // the fall off the highest row of the last 2 s, in the unit's own damage
      const fromMs = endMs - 2000;
      const span = rows.filter((a) => tsOf(a) >= fromMs);
      // a max-HP buff falling: the current drops by the whole step in one
      // row and the max follows rows later (1-5 2:14: 650k → 516k, then the
      // max 914k → 781k, both friends at once) — no hit took it
      const nextMax = ((unit.advancedActions ?? []) as any[]).find(
        (a) =>
          a.advancedActorId === unit.id &&
          a.advancedActorMaxHp > 0 &&
          tsOf(a) >= endMs &&
          tsOf(a) < endMs + BUFF_STEP_LOOKAHEAD_MS &&
          a.advancedActorMaxHp < last.advancedActorMaxHp,
      );
      if (nextMax) {
        const step = last.advancedActorMaxHp - nextMax.advancedActorMaxHp;
        const dropAt = span.findIndex(
          (a, i) =>
            i > 0 &&
            Math.abs(
              span[i - 1]!.advancedActorCurrentHp -
                a.advancedActorCurrentHp -
                step,
            ) <=
              0.05 * step,
        );
        // the step excuses the reading before it, not any printed number
        if (dropAt > 0 && printed - pct(span[dropAt - 1]!) <= STATE_SLACK_PCT)
          continue;
      }
      const top = Math.max(...span.map((a) => a.advancedActorCurrentHp));
      const fall = top - last.advancedActorCurrentHp;
      const hits = ((unit.damageIn ?? []) as any[])
        .filter((d) => tsOf(d) >= fromMs && tsOf(d) < endMs)
        .reduce((s, d) => s + Math.abs(d.effectiveAmount), 0);
      if (fall > 0 && hits >= 0.5 * fall)
        ctx.violate(
          "staleDipWithDamage",
          "tick",
          endMs,
          `${unit.name}#${t}`,
          `[STATE] ${fmtS(t)} ${unit.name} ${printed}, last row ${pct(last).toFixed(1)}, ${hits} damage in 2 s`,
          line,
        );
    }
  }
}

/** cast id of every tracked cooldown's own aura */
let castOfAura: Map<string, string> | undefined;
function trackedAuras(): Map<string, string> {
  if (castOfAura) return castOfAura;
  const out = new Map<string, string>();
  const ids = new Set<string>([
    ...classMetadata.flatMap((c) => c.abilities.map((a) => a.spellId)),
    ...OFFENSIVE_CD_SPELL_IDS,
    ...ENEMY_HEAL_CD_IDS,
    ...SELF_SAVE_IDS,
  ]);
  for (const id of ids) {
    if ((effectiveCooldownSeconds(id) ?? 0) < 30) continue;
    for (const a of [id, ...effectAurasOfCast(id)])
      if (!out.has(a)) out.set(a, id);
  }
  castOfAura = out;
  return out;
}

/** a batch of this many self rows can re-state the unit */
const RESTATE_BATCH = 4;
/** rows of one batch follow each other within this gap */
const RESTATE_BATCH_GAP_MS = 2;
/** rows of the batch that must re-list an aura already up: four fresh buffs in
 * one ms are a press with its riders (Doom Winds, a39539f2 2:36) */
const RESTATE_ALREADY_UP = 2;
/** a REMOVED + APPLIED pair counts as one run within this gap */
const SAME_RUN_GAP_MS = 50;
/** `a` follows a REMOVED of its own aura and source */
function continuesRemovedRun(rows: readonly any[], a: any): boolean {
  for (const r of rows) {
    if (r === a) return false;
    if (
      ev(r) === REMOVED &&
      r.spellId === a.spellId &&
      r.srcUnitId === a.srcUnitId &&
      tsOf(a) - tsOf(r) <= SAME_RUN_GAP_MS &&
      tsOf(a) >= tsOf(r)
    )
      return true;
  }
  return false;
}

/** a row of `rows` that re-lists an aura up since an earlier APPLIED */
function relistsAuraUp(rows: readonly any[], a: any): boolean {
  let up = false;
  for (const r of rows) {
    if (r === a) break;
    if (r.spellId !== a.spellId || r.srcUnitId !== a.srcUnitId) continue;
    if (ev(r) === APPLIED) up = true;
    else if (ev(r) === REMOVED) up = false;
  }
  return up;
}
const PRESS_LINE =
  /\[(YOU|TEAM)\] \[(CD|CC|PROC|CAST)\]|\[ENEMY (CD|DEF|UTILITY|HEAL CD)\]/;
const PRESS_BEFORE_MS = 3000;
const PRESS_AFTER_MS = 1500;
const FIRST_PID = /(?:^|\s)(\d+)\(/;

function auraNoLine(ctx: IRoundCtx): void {
  const tracked = trackedAuras();
  const timed: { t: number; text: string }[] = [];
  for (const l of ctx.lines) {
    const m = TIMED.exec(l);
    if (m && PRESS_LINE.test(l))
      timed.push({ t: +m[1]! * 60 + +m[2]!, text: l });
  }
  for (const u of ctx.players) {
    const self = ((u.auraEvents ?? []) as any[]).filter(
      (a) =>
        ev(a) === APPLIED &&
        a.srcUnitId === u.id &&
        a.destUnitId === u.id &&
        // a stun or a trap reflected onto its caster is no activation
        a.auraType !== "DEBUFF",
    );
    const perMs = new Map<number, number>();
    const relistedPerMs = new Map<number, number>();
    const auraRows = (u.auraEvents ?? []) as any[];
    // the batch: the unit's self APPLIED rows, buffs and debuffs, each at
    // most RESTATE_BATCH_GAP_MS after the one before — the log writes one
    // re-listing across two or three milliseconds, its debuffs (Dampening,
    // Exhaustion) among the buffs (GH #177 item 14: all 23 residual facts on
    // the 605 were such a batch, 5–25 rows, read one millisecond at a time)
    let batch: any[] = [];
    const closeBatch = () => {
      const relisted = batch.filter((b) => relistsAuraUp(auraRows, b)).length;
      for (const b of batch) {
        perMs.set(tsOf(b), batch.length);
        relistedPerMs.set(tsOf(b), relisted);
      }
      batch = [];
    };
    for (const a of auraRows) {
      if (ev(a) !== APPLIED || a.srcUnitId !== u.id || a.destUnitId !== u.id)
        continue;
      const last = batch[batch.length - 1];
      if (last && tsOf(a) - tsOf(last) > RESTATE_BATCH_GAP_MS) closeBatch();
      batch.push(a);
    }
    closeBatch();
    for (const a of self) {
      const cast = tracked.get(a.spellId);
      const ms = tsOf(a);
      if (cast === undefined || ms < ctx.start || ms > ctx.roundEndAt) continue;
      // the batch's rows it re-lists, not the batch: a new aura in it still
      // needs its line (`hiddenPressMs`)
      if (
        (perMs.get(ms) ?? 0) >= RESTATE_BATCH &&
        (relistedPerMs.get(ms) ?? 0) >= RESTATE_ALREADY_UP &&
        relistsAuraUp(auraRows, a)
      )
        continue;
      // a REMOVED then APPLIED of one source in one instant is the same run,
      // extended (Dragonrage by Animosity)
      if (continuesRemovedRun(auraRows, a)) continue;
      const buttons = new Set([
        cast,
        a.spellId,
        ...castsOfEffectAura(a.spellId),
      ]);
      const name = nameOf(cast);
      const pressed = successesOf(u).some(
        (c) =>
          (buttons.has(c.spellId) ||
            // a same-named row is the button only if it has a cooldown: Doom
            // Winds' pulse 469270 is its effect
            (nameOf(c.spellId, c.spellName) === name &&
              (spellEffectData[c.spellId]?.cooldownSeconds ?? 0) > 0)) &&
          tsOf(c) >= ms - PRESS_BEFORE_MS &&
          tsOf(c) <= ms + PRESS_AFTER_MS,
      );
      if (pressed) continue;
      ctx.bump("auraActivationNoLine");
      const t = Math.floor((ms - ctx.start) / 1000);
      const isOwner = u.id === ctx.owner?.id;
      const named = timed.some(
        (l) =>
          Math.abs(l.t - t) <= 1 &&
          l.text.includes(name) &&
          (isOwner
            ? l.text.includes("[YOU]")
            : ctx.unitOfPid(FIRST_PID.exec(l.text)?.[1])?.id === u.id),
      );
      if (named) continue;
      const side = isOwner
        ? "owner"
        : u.info?.teamId === ctx.owner?.info?.teamId
          ? "ally"
          : "enemy";
      const unlogged =
        AURA_PRESS_BY_ERA[cast] !== undefined &&
        auraStandsForPressAt(cast, logInstantOf(u, ms));
      ctx.violate(
        "auraActivationNoLine",
        unlogged ? "unlogged press (dated)" : `${side}/${name}`,
        ms,
        `${u.name}#${name}#${t}`,
        `${unlogged ? `${side}: ` : ""}${name} on ${u.name} at ${fmtS(t)}, no press, no line`,
      );
    }
  }
}

const LEDGER_DEF =
  /Target had a major defensive up: (.+?) active ON THE TARGET/;
function ledgerTwice(ctx: IRoundCtx): void {
  let prev = "";
  for (const line of ctx.lines) {
    const m = LEDGER_DEF.exec(line);
    if (m) {
      ctx.bump("ledgerOnePressTwice");
      if (line === prev)
        ctx.violate(
          "ledgerOnePressTwice",
          m[1]!,
          ctx.start,
          `${m[1]}#${line}`,
          line.trim().slice(0, 120),
          line,
        );
    }
    prev = line;
  }
}

const HEAL_CD_LINE =
  /^\s*(\d+:\d\d)\s+\[ENEMY HEAL CD\]\s+(\S+).*?: ?(.+?)(?: \(| \[|$)/;
function healAndDef(ctx: IRoundCtx): void {
  const defs = ctx.lines.filter((l) => l.includes("[ENEMY DEF]"));
  for (const line of ctx.lines) {
    if (!line.includes("[ENEMY HEAL CD]")) continue;
    const at = TIMED.exec(line);
    if (!at) continue;
    ctx.bump("pressFiledHealAndDef");
    const stamp = `${at[1]}:${at[2]}`;
    const pid = FIRST_PID.exec(line)?.[1];
    // a healing major that is also a self-save on purpose: the spirit heals
    // at full strength through its 15 s (one press, both facts)
    if (line.includes("Spirit of Redemption")) continue;
    for (const d of defs) {
      if (!d.trimStart().startsWith(stamp)) continue;
      if (FIRST_PID.exec(d)?.[1] !== pid) continue;
      const name = HEAL_CD_LINE.exec(line)?.[3];
      if (name && d.includes(name))
        ctx.violate(
          "pressFiledHealAndDef",
          name,
          ctx.start,
          `${pid}#${stamp}#${name}`,
          line.trim().slice(0, 120),
          line,
        );
    }
  }
}

const lineNames = (ctx: IRoundCtx, tagged: RegExp, atS: number, name: string) =>
  ctx.lines.some((l) => {
    const m = TIMED.exec(l);
    if (!m || !tagged.test(l) || !l.includes(name)) return false;
    return Math.abs(+m[1]! * 60 + +m[2]! - atS) <= 1;
  });

const ourSide = (ctx: IRoundCtx) =>
  ctx.players.filter((p) => p.info?.teamId === ctx.owner?.info?.teamId);
const SILENCE_MECHANIC = 9;

function silenceImmune(ctx: IRoundCtx): void {
  const enemyIds = new Set(
    ctx.players
      .filter((p) => p.info?.teamId !== ctx.owner?.info?.teamId)
      .map((p) => p.id),
  );
  for (const u of ourSide(ctx)) {
    for (const m of (u.missesOut ?? []) as any[]) {
      if (m.missType !== "IMMUNE" || !m.spellId) continue;
      if (ccMechanicOf(m.spellId) !== SILENCE_MECHANIC) continue;
      if (!enemyIds.has(m.destUnitId)) continue;
      if (tsOf(m) < ctx.start || tsOf(m) > ctx.roundEndAt) continue;
      ctx.bump("silenceImmuneNoLine");
      const name = nameOf(m.spellId, m.spellName);
      const t = (tsOf(m) - ctx.start) / 1000;
      if (
        !lineNames(
          ctx,
          /\[CC NOT LANDED\]|\[(?:YOU|TEAM)\] \[CC\]|\[SILENCE\]/,
          t,
          name,
        )
      )
        ctx.violate(
          "silenceImmuneNoLine",
          name,
          tsOf(m),
          `${u.name}#${name}#${t}`,
          `${name} by ${u.name} IMMUNE at ${fmtS(t)}, no line`,
        );
    }
  }
}

function backlashBreak(ctx: IRoundCtx): void {
  for (const u of ourSide(ctx)) {
    const presses = successesOf(u)
      .filter((c) => c.spellId === MEDALLION_SPELL_ID)
      .map(tsOf);
    if (!presses.length) continue;
    const rows = (u.auraEvents ?? []) as any[];
    for (const r of rows) {
      if (ev(r) !== REMOVED || r.spellId !== BACKLASH_SILENCE_ID) continue;
      const applied = rows
        .filter(
          (a) =>
            ev(a) === APPLIED && a.spellId === r.spellId && tsOf(a) <= tsOf(r),
        )
        .pop();
      if (!applied || tsOf(r) - tsOf(applied) > 3500) continue;
      if (!presses.some((p) => Math.abs(p - tsOf(r)) <= 300)) continue;
      ctx.bump("backlashTrinketNoNote");
      const t = (tsOf(applied) - ctx.start) / 1000;
      const pid = ctx.pidOf(u.name);
      const noted = ctx.lines.some(
        (l) =>
          l.includes("[SILENCE]") &&
          (l.includes("trinket broke this silence") ||
            l.includes("ended by their PvP trinket")) &&
          (pid === undefined || FIRST_PID.exec(l)?.[1] === pid) &&
          Math.abs(
            +(TIMED.exec(l)?.[1] ?? 0) * 60 + +(TIMED.exec(l)?.[2] ?? 0) - t,
          ) <= 1,
      );
      if (!noted)
        ctx.violate(
          "backlashTrinketNoNote",
          "silence",
          tsOf(r),
          `${u.name}#${t}`,
          `backlash silence on ${u.name} at ${fmtS(t)}, Medallion at its end, no note`,
        );
    }
  }
}

function racialNoLine(ctx: IRoundCtx): void {
  for (const u of ourSide(ctx)) {
    for (const c of successesOf(u)) {
      if (RACIAL_TRINKET_LOCK_MS[c.spellId] === undefined) continue;
      if (tsOf(c) < ctx.start || tsOf(c) > ctx.roundEndAt) continue;
      ctx.bump("racialPressNoLine");
      const name = nameOf(c.spellId, c.spellName);
      const t = (tsOf(c) - ctx.start) / 1000;
      if (!lineNames(ctx, /\[TRINKET\]|\[(?:YOU|TEAM)\]/, t, name))
        ctx.violate(
          "racialPressNoLine",
          name,
          tsOf(c),
          `${u.name}#${name}#${t}`,
          `${name} by ${u.name} at ${fmtS(t)}, no line`,
        );
    }
  }
}

export function run(ctx: IRoundCtx): void {
  resCd(ctx);
  empowerChannel(ctx);
  poppedByAlly(ctx);
  staleDip(ctx);
  auraNoLine(ctx);
  ledgerTwice(ctx);
  healAndDef(ctx);
  silenceImmune(ctx);
  backlashBreak(ctx);
  racialNoLine(ctx);
}

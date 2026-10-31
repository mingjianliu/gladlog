/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (advancedActions, auraEvents) */
/**
 * scan5/spanFacts.ts — the windows-and-spans single items of the round-7 audit
 * (fact7 F21, class 14), against the rows.
 *
 *  - `noDefensiveButPressed` (D2): STAYED IN's `no defensive CD available`
 *    (with no `back at`) over a span holding the owner's own press of a
 *    defensive. 96fb4d42 1:47–1:57: Anti-Magic Shell back 1:54.6, pressed
 *    1:55.413.
 *  - `kickWindowPastRoundEnd` (D25): kick-eaten `ccInWindowS` above the control
 *    the rows show inside the kick's 5 s, cut at the round's end. db5b6b6a 1:39:
 *    2.4 from a Leg Sweep landed 4 ms after the deciding death.
 *  - `conseqDroppedWithReadings` (D20): a healer's control printed `[CC ON …]`
 *    for ≥ 2 s of the round with no `[CONSEQ]` line, every living teammate
 *    having rows inside it. d2e6e70b 0:16: Freezing Trap on the enemy healer,
 *    its hunter unread from 0:04 to 0:20 and read inside.
 *  - `drHalfLengthFull` (D14): `[CC ON …] … [DR: Cat Full]` on a control whose
 *    aura ran out on its own at half its full length, landed 20.0–20.4 s after
 *    the family's last end on that unit. 69276401 1:32: Shockwave 1.50 s, 20.27 s
 *    after Storm Bolt ended.
 *  - `ledgerProcImmunityMissing` (D40): a teammate's proc immunity on the burst
 *    ledger's target for ≥ 0.5 s of the burst, the burst not naming it.
 *    9121b496 Burst #2: Peaceweaver 1:18.6–1:20.6.
 *  - `troughOnStaleMaxRow` (D60): a printed `low B% at m:ss` / `[STATE]` tick
 *    that only the row of a form shift reaches: current HP already on the new
 *    scale, max HP still the old one. 4f8a5947 2:33: 151364 / 1361920 = 11 %,
 *    then 151771 / 1047640 = 14 %.
 */
import { classMetadata } from "@gladlog/analysis/src/data/classSpells";
import {
  effectiveCooldownSeconds,
  getEnglishSpellName,
} from "@gladlog/analysis/src/data/spellEffectData";
import { ENEMY_IMMUNITY_TEAM_PROC_AURAS } from "@gladlog/analysis/src/data/spellIdLists";
import { ccSpellIds } from "@gladlog/analysis/src/data/spellTags";
import { SpellTag } from "@gladlog/analysis/src/data/spellTypes";
import { ccFullDurationForCaster } from "@gladlog/analysis/src/utils/ccDuration";
import {
  isHealerSpec,
  MIN_CD_SECONDS,
} from "@gladlog/analysis/src/utils/cooldowns";
import { DR_CATEGORY_MAP } from "@gladlog/analysis/src/utils/drAnalysis";

import {
  APPLIED,
  deathMs,
  ev,
  fmtS,
  type IRoundCtx,
  REFRESH,
  REMOVED,
  secOf,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = [
  "noDefensiveButPressed",
  "kickWindowPastRoundEnd",
  "conseqDroppedWithReadings",
  "drHalfLengthFull",
  "ledgerProcImmunityMissing",
  "troughOnStaleMaxRow",
] as const;

export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "noDefensiveButPressed|edgeSecond",
]);

const DEFENSIVE_IDS = new Set(
  classMetadata
    .flatMap((m) => m.abilities)
    .filter((s) => s.tags.includes(SpellTag.Defensive))
    .map((s) => s.spellId),
);
const STAYED_NONE =
  /^\s*(\d+):(\d\d)–(\d+):(\d\d) \[.* — no defensive CD available(?! at the start)/;
const CC_LINE =
  /^\s*(\d+):(\d\d)\s+\[CC ON (?:TEAM|ENEMY)\]\s+(\d+)\([^)]*\) ← (.+?) \(by (?:\d+\([^)]*\)|[^)]*)\)(?: \([^)]*\))*(?: \[DR: (\w+) (Full|50%|Immune)\])?/;
const CONSEQ_AT =
  /^\s*(\d+):(\d\d)\s+\[CONSEQ\]\s+\w+ healer (\d+)\([^)]*\) in (.+?)(?: \(silence\))? for /;
const BURST_HEAD = /^\s*Burst #\d+ — (\d+):(\d\d)–(\d+):(\d\d) \|/;
const BURST_TARGET = /^\s*Target: (\S.*?) \d+%/;
const LOW = /(\d+)\([^)]*\) \d+% → low (\d+)% at (\d+):(\d\d)/g;

/** a defensive the owner's `[YOU] [CD]` lines print: name → seconds pressed */
function noDefensive(ctx: IRoundCtx): void {
  for (const line of ctx.lines) {
    const m = STAYED_NONE.exec(line);
    if (!m) continue;
    ctx.bump("noDefensiveButPressed");
    const from = ctx.start + secOf(`${m[1]}:${m[2]}`) * 1000;
    const to = ctx.start + (secOf(`${m[3]}:${m[4]}`) + 1) * 1000;
    for (const c of successesOf(ctx.owner)) {
      if (tsOf(c) < from || tsOf(c) >= to) continue;
      const name = getEnglishSpellName(c.spellId, c.spellName ?? "");
      const t = fmtS((tsOf(c) - ctx.start) / 1000);
      // the sentence's "defensive CD" is the owner's tracked kit, ≥
      // `MIN_CD_SECONDS`: a 15 s Feint is no row of it
      const isDefensive =
        DEFENSIVE_IDS.has(String(c.spellId)) &&
        (effectiveCooldownSeconds(String(c.spellId)) ?? 0) >= MIN_CD_SECONDS;
      // the printed ends are floored: a press in either end second can lie
      // outside the span (a Dark Pact 0.2 s before it): shown, not counted
      const edge = tsOf(c) < from + 1000 || tsOf(c) >= to - 1000;
      if (isDefensive)
        ctx.violate(
          "noDefensiveButPressed",
          edge ? "edgeSecond" : "pressInSpan",
          tsOf(c),
          `${m[1]}:${m[2]}|${name}`,
          `${name} pressed ${t}`,
          line,
        );
    }
  }
}

function kickWindow(ctx: IRoundCtx): void {
  for (const row of ctx.menu.matchAll(
    /type=kick-eaten t=([\d.]+)s .*?ccInWindowS=([\d.]+)/g,
  )) {
    ctx.bump("kickWindowPastRoundEnd");
    const kickS = +row[1]!;
    const printed = +row[2]!;
    const fromMs = ctx.start + kickS * 1000;
    const toMs = Math.min(fromMs + 5000, ctx.roundEndAt);
    // nothing of the 5 s lies past the round's end, or the control started
    // inside it: only a control that started past the end is this class
    const after = ((ctx.owner.auraEvents ?? []) as any[]).filter(
      (a) =>
        ccSpellIds.has(String(a.spellId)) &&
        ev(a) === APPLIED &&
        tsOf(a) >= ctx.roundEndAt &&
        tsOf(a) < fromMs + 5000,
    );
    const room = (toMs - fromMs) / 1000;
    if (after.length > 0 || printed > room + 0.15)
      ctx.violate(
        "kickWindowPastRoundEnd",
        "pastTheEnd",
        fromMs,
        `${kickS}`,
        `ccInWindowS=${printed}, ${room.toFixed(1)}s of the window lies in the round`,
      );
  }
}

const ownRows = (u: any): any[] =>
  ((u.advancedActions ?? []) as any[])
    .filter((a) => a.advancedActorId === u.id && a.advancedActorMaxHp > 0)
    .sort((a, b) => a.logLine.timestamp - b.logLine.timestamp);

function conseqDropped(ctx: IRoundCtx): void {
  const printed = new Set<string>();
  for (const line of ctx.lines) {
    const c = CONSEQ_AT.exec(line);
    if (c) printed.add(`${secOf(`${c[1]}:${c[2]}`)}|${c[3]}|${c[4]}`);
  }
  for (const line of ctx.lines) {
    const m = CC_LINE.exec(line);
    if (!m) continue;
    const unit = ctx.unitOfPid(m[3]);
    if (!unit || !isHealerSpec(unit.spec)) continue;
    const sec = secOf(`${m[1]}:${m[2]}`);
    const spell = m[4]!;
    const secFrom = ctx.start + sec * 1000;
    const rows = ((unit.auraEvents ?? []) as any[]).filter(
      (a) => getEnglishSpellName(a.spellId, a.spellName ?? "") === spell,
    );
    const on = rows.find(
      (a) =>
        ev(a) === APPLIED && tsOf(a) >= secFrom && tsOf(a) < secFrom + 1000,
    );
    if (!on) continue;
    // the instance the line printed: a re-application (a second Sap, REFRESH)
    // is the next `[CC ON …]` line, and the round's end cuts the span —
    // `[CONSEQ]` reads HP inside the round only
    const off = rows.find(
      (a) => (ev(a) === REMOVED || ev(a) === REFRESH) && tsOf(a) > tsOf(on),
    );
    if (!off) continue;
    const offMs = Math.min(tsOf(off), ctx.roundEndAt);
    if (offMs - tsOf(on) < 2000) continue;
    ctx.bump("conseqDroppedWithReadings");
    if (printed.has(`${sec}|${m[3]}|${spell}`)) continue;
    const mates = ctx.players.filter(
      (u) =>
        u.reaction === unit.reaction &&
        u.id !== unit.id &&
        deathMs(u) > tsOf(on),
    );
    const allRead = mates.every((u) =>
      ownRows(u).some(
        (a) => a.logLine.timestamp >= tsOf(on) && a.logLine.timestamp <= offMs,
      ),
    );
    if (mates.length > 0 && allRead)
      ctx.violate(
        "conseqDroppedWithReadings",
        "noLine",
        tsOf(on),
        `${m[3]}|${spell}|${sec}`,
        `${spell} on ${unit.name}: ${((offMs - tsOf(on)) / 1000).toFixed(1)}s`,
        line,
      );
  }
}

function drHalf(ctx: IRoundCtx): void {
  for (const line of ctx.lines) {
    const m = CC_LINE.exec(line);
    if (!m || m[6] !== "Full") continue;
    const unit = ctx.unitOfPid(m[3]);
    if (!unit) continue;
    const secFrom = ctx.start + secOf(`${m[1]}:${m[2]}`) * 1000;
    const rows = ((unit.auraEvents ?? []) as any[]).filter(
      (a) => DR_CATEGORY_MAP[String(a.spellId)] === m[5],
    );
    const on = rows.find(
      (a) =>
        ev(a) === APPLIED &&
        tsOf(a) >= secFrom &&
        tsOf(a) < secFrom + 1000 &&
        getEnglishSpellName(a.spellId, a.spellName ?? "") === m[4],
    );
    if (!on) continue;
    const off = rows.find(
      (a) =>
        a.spellId === on.spellId &&
        tsOf(a) > tsOf(on) &&
        (ev(a) === REMOVED || ev(a)?.startsWith("SPELL_AURA_BROKEN")),
    );
    if (!off || ev(off) !== REMOVED) continue;
    const prevEnd = Math.max(
      -Infinity,
      ...rows.filter((a) => ev(a) === REMOVED && tsOf(a) < tsOf(on)).map(tsOf),
    );
    const gap = tsOf(on) - prevEnd;
    if (gap < 20_000 || gap >= 20_400) continue;
    ctx.bump("drHalfLengthFull");
    const caster = ctx.units.find((u) => u.id === on.srcUnitId);
    const full = ccFullDurationForCaster(String(on.spellId), caster);
    if (!full) continue;
    const r = (tsOf(off) - tsOf(on)) / 1000 / full;
    if (r >= 0.4 && r <= 0.6)
      ctx.violate(
        "drHalfLengthFull",
        "halfLengthInBand",
        tsOf(on),
        `${m[3]}|${tsOf(on)}`,
        `${m[4]} ran ${((tsOf(off) - tsOf(on)) / 1000).toFixed(2)}s of ${full}s, ${(gap / 1000).toFixed(2)}s after the family's last end`,
        line,
      );
  }
}

function ledger(ctx: IRoundCtx): void {
  let from = 0;
  let to = 0;
  let block: string[] = [];
  const flush = () => {
    const target = block
      .map((l) => BURST_TARGET.exec(l)?.[1])
      .find((x) => x !== undefined);
    const unit = target ? ctx.byName.get(target) : undefined;
    if (unit) {
      const auras = ((unit.auraEvents ?? []) as any[]).filter((a) =>
        ENEMY_IMMUNITY_TEAM_PROC_AURAS.has(String(a.spellId)),
      );
      for (const on of auras) {
        if (ev(on) !== APPLIED) continue;
        // its own end, before the next application: a REMOVED the log lost
        // (12c701da: 32.2 unclosed, the next pair 153.5–155.5) is the proc's 2 s
        const nextOn = auras.find(
          (a) => ev(a) === APPLIED && tsOf(a) > tsOf(on),
        );
        const off = auras.find(
          (a) =>
            ev(a) === REMOVED &&
            tsOf(a) > tsOf(on) &&
            (!nextOn || tsOf(a) < tsOf(nextOn)),
        );
        const onS = (tsOf(on) - ctx.start) / 1000;
        const offS = off ? (tsOf(off) - ctx.start) / 1000 : onS + 2;
        // the burst's bounds are floored seconds: the overlap it surely had
        const overlap = Math.min(offS, to) - Math.max(onS, from + 1);
        if (overlap < 0.5) continue;
        ctx.bump("ledgerProcImmunityMissing");
        const name = getEnglishSpellName(on.spellId, on.spellName ?? "");
        if (!block.some((l) => l.includes(`${name} active ON THE TARGET`)))
          ctx.violate(
            "ledgerProcImmunityMissing",
            "notNamed",
            tsOf(on),
            `${from}|${target}|${name}`,
            `${name} on ${target} ${onS.toFixed(1)}–${offS.toFixed(1)}, burst ${fmtS(from)}–${fmtS(to)}`,
          );
      }
    }
    block = [];
  };
  for (const line of ctx.lines) {
    const m = BURST_HEAD.exec(line);
    if (m) {
      flush();
      from = secOf(`${m[1]}:${m[2]}`);
      to = secOf(`${m[3]}:${m[4]}`);
      block = [line];
    } else if (block.length > 0) {
      if (/^\s*$|^[A-Z]/.test(line)) flush();
      else block.push(line);
    }
  }
  flush();
}

/** how much of the way from a rescaled current to a carried one the step's
 * row must sit, for the rows before it to be stale */
const STEP_CARRIES = 0.5;

/** the rows of a form shift, read from the rows alone: current HP has moved
 * to the next max's scale while the row still states the old max */
function staleRows(rows: any[]): Set<any> {
  const out = new Set<any>();
  const pct = (a: any) =>
    (100 * a.advancedActorCurrentHp) / a.advancedActorMaxHp;
  for (let j = 1; j < rows.length; j++) {
    const m0 = rows[j - 1].advancedActorMaxHp;
    const m1 = rows[j].advancedActorMaxHp;
    if (m1 >= m0) continue;
    let i = j;
    while (
      i > 0 &&
      rows[i - 1].advancedActorMaxHp === m0 &&
      rows[j].logLine.timestamp - rows[i - 1].logLine.timestamp <= 500 &&
      Math.abs(
        rows[i - 1].advancedActorCurrentHp - rows[j].advancedActorCurrentHp,
      ) <=
        0.05 * m1
    )
      i--;
    if (i === j || i === 0) continue;
    const before = pct(rows[i - 1]);
    const last = rows[j - 1].advancedActorCurrentHp;
    const rescaled = (last * m1) / m0;
    if (
      before - pct(rows[i]) >= 3 &&
      Math.abs((100 * rows[i].advancedActorCurrentHp) / m1 - before) <= 5 &&
      // the step carried the current across: a max and current that fall
      // together are a buff's loss, and the rows before it read true
      rows[j].advancedActorCurrentHp - rescaled >=
        STEP_CARRIES * (last - rescaled)
    )
      for (let k = i; k < j; k++) out.add(rows[k]);
  }
  return out;
}

function troughs(ctx: IRoundCtx): void {
  for (const line of ctx.lines) {
    for (const m of line.matchAll(LOW)) {
      const unit = ctx.unitOfPid(m[1]);
      if (!unit) continue;
      const sec = secOf(`${m[3]}:${m[4]}`);
      const fromMs = ctx.start + sec * 1000;
      const rows = ownRows(unit);
      const inSec = rows.filter(
        (a) =>
          a.logLine.timestamp >= fromMs && a.logLine.timestamp < fromMs + 1000,
      );
      if (inSec.length === 0) continue;
      ctx.bump("troughOnStaleMaxRow");
      const stale = staleRows(rows);
      const p = +m[2]!;
      const read = (a: any) =>
        Math.round((100 * a.advancedActorCurrentHp) / a.advancedActorMaxHp);
      const staleHit = inSec.some((a) => stale.has(a) && read(a) === p);
      const trueLow = Math.min(...inSec.filter((a) => !stale.has(a)).map(read));
      if (staleHit && trueLow > p)
        ctx.violate(
          "troughOnStaleMaxRow",
          "low",
          fromMs,
          `${m[1]}|${sec}|${p}`,
          `printed ${p}%, the second's other rows bottom at ${trueLow}%`,
          line,
        );
    }
  }
}

export function run(ctx: IRoundCtx): void {
  noDefensive(ctx);
  kickWindow(ctx);
  conseqDropped(ctx);
  drHalf(ctx);
  ledger(ctx);
  troughs(ctx);
}

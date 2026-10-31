/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (auraEvents, actionIn) */
/**
 * scan5/castThroughStun.ts — the rest of class 6 of the round-7 audit (fact7
 * F21): cannot-cast time stated about a spell that goes out through it.
 *
 *  - `freeToPressBelowLog` (D21): `[DEFENSIVE AVAILABLE] … free to press it for
 *    the last Fs` and the missed-options `longest stretch free to cast it Fs`
 *    about a usable-while-stunned spell (DB2's attribute, a lookup): the rows'
 *    last control on the holder that is not a stun ended before the death, so
 *    the spell was free from there. d2e6e70b 0:33: Psychic Scream ended 0.29 s
 *    before the death, only Chastise's stun remained, the lines said 0.0.
 *  - `cannotCastCountsAPress` (D30): STAYED IN's `(you could not cast for Ns of
 *    it)`, against the owner's own defensive presses inside a stretch N counts.
 *    A SUCCESS of a defensive inside a control or a lockout is the log saying
 *    that stretch did not stop it. 163de8f1 0:57: Barkskin at 0:58.364 under
 *    the stun, in a span that counted the whole stun.
 *
 * Log truth: the aura rows on the unit (APPLIED → REMOVED / BROKEN), source on
 * the other side; `ccSpellIds` and the stun family are lookups.
 */
import { classMetadata } from "@gladlog/analysis/src/data/classSpells";
import {
  isCastBlockingAuraType,
  SPELL_CATEGORIES,
} from "@gladlog/analysis/src/data/spellCategories";
import {
  getEnglishSpellName,
  kickLockoutSeconds,
} from "@gladlog/analysis/src/data/spellEffectData";
import {
  schoolLockedBy,
  spellSchoolMask,
} from "@gladlog/analysis/src/data/spellSchools";
import { ccSpellIds } from "@gladlog/analysis/src/data/spellTags";
import { SpellTag } from "@gladlog/analysis/src/data/spellTypes";
import { usableWhileStunned } from "@gladlog/analysis/src/utils/cooldowns";
import { isStunDrAura } from "@gladlog/analysis/src/utils/drAnalysis";
import { unaffordableIntervals } from "@gladlog/analysis/src/utils/resourceAt";
import { isUnsilenceableCast } from "@gladlog/analysis/src/utils/spellMechanics";
import { LogEvent } from "@gladlog/parser-compat";

import {
  APPLIED,
  deathMs,
  ev,
  type IRoundCtx,
  REMOVED,
  secOf,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = [
  "freeToPressBelowLog",
  "cannotCastCountsAPress",
] as const;

const AVAILABLE =
  /^\s*\d+:\d\d\s+\[DEFENSIVE AVAILABLE\]\s+(\d+)\([^)]*\): (.+?)(?: \([^)]*\))? available but unused \(free to press it for the last ([\d.]+)s before the death\)/;
const MISSED =
  /^\s*\[(\d+):(\d\d)\] (\S.*?) died — (\S.*?) had (.+?) available, .*?longest stretch free to cast it ([\d.]+)s of the last 5s/;
const STAYED =
  /^\s*(\d+):(\d\d)–(\d+):(\d\d) \[.*a defensive CD was available \(you could not cast for (\d+)s of it\)/;

interface ISpan {
  from: number;
  to: number;
  spellId: string;
}

/** the cast-blocking controls the other side put on `unit`, from the rows */
function controlsOn(ctx: IRoundCtx, unit: any): ISpan[] {
  const open = new Map<string, number>();
  const out: ISpan[] = [];
  const ours = new Set([
    unit.id,
    ...ctx.units.filter((u) => u.reaction === unit.reaction).map((u) => u.id),
  ]);
  for (const a of unit.auraEvents ?? []) {
    const id = String(a.spellId ?? "");
    const type = SPELL_CATEGORIES[id]?.type;
    if (!ccSpellIds.has(id) || !type || !isCastBlockingAuraType(type)) continue;
    const e = ev(a);
    if (e === APPLIED) {
      if (!ours.has(a.srcUnitId) && !open.has(id)) open.set(id, tsOf(a));
    } else if (e === REMOVED || e?.startsWith("SPELL_AURA_BROKEN")) {
      const from = open.get(id);
      if (from !== undefined) {
        out.push({ from, to: tsOf(a), spellId: id });
        open.delete(id);
      }
    }
  }
  return out;
}

/** every stretch that is no stretch free to press `spellId` beside a stun: the
 * rows' controls and silences on `unit` (one still on it at the end of its rows
 * runs on: b81efd46 1:33, a Polymorph the death ended, no REMOVED), the school
 * lockouts of its kicks, and the stretches it could not pay (fact3 D12, the
 * mana reading is not this check's fact). */
function blocksOn(ctx: IRoundCtx, unit: any, spellId: string): ISpan[] {
  const open = new Map<string, number>();
  const out: ISpan[] = [];
  const ours = new Set(
    ctx.units.filter((u) => u.reaction === unit.reaction).map((u) => u.id),
  );
  for (const a of unit.auraEvents ?? []) {
    const id = String(a.spellId ?? "");
    const type = SPELL_CATEGORIES[id]?.type;
    if (!type || !isCastBlockingAuraType(type)) continue;
    if (!ccSpellIds.has(id) && isUnsilenceableCast(spellId)) continue;
    const e = ev(a);
    if (e === APPLIED) {
      if (!ours.has(a.srcUnitId) && !open.has(id)) open.set(id, tsOf(a));
    } else if (e === REMOVED || e?.startsWith("SPELL_AURA_BROKEN")) {
      const from = open.get(id);
      if (from !== undefined) out.push({ from, to: tsOf(a), spellId: id });
      open.delete(id);
    }
  }
  for (const [id, from] of open) out.push({ from, to: Infinity, spellId: id });
  const school = spellSchoolMask(spellId);
  for (const k of unit.actionIn ?? []) {
    if (k.logLine.event !== LogEvent.SPELL_INTERRUPT) continue;
    const was = spellSchoolMask(String(k.extraSpellId ?? ""));
    if (
      school !== undefined &&
      was !== undefined &&
      !schoolLockedBy(school, was)
    )
      continue;
    if (isUnsilenceableCast(spellId)) continue;
    const kick = String(k.spellId ?? "");
    out.push({
      from: k.timestamp,
      to: k.timestamp + kickLockoutSeconds(kick) * 1000,
      spellId: kick,
    });
  }
  for (const u of unaffordableIntervals(
    unit,
    spellId,
    ctx.start,
    ctx.end,
    undefined,
    { startTime: ctx.start, endTime: ctx.end },
  ))
    out.push({ ...u, spellId: "mana" });
  return out;
}

function spellIdByName(unit: any, name: string): string | undefined {
  for (const c of successesOf(unit))
    if (getEnglishSpellName(c.spellId, c.spellName ?? "") === name)
      return String(c.spellId);
  for (const meta of classMetadata)
    for (const s of meta.abilities) if (s.name === name) return s.spellId;
  return undefined;
}

function freeToPress(ctx: IRoundCtx): void {
  const check = (
    unit: any,
    victim: any,
    name: string,
    printed: number,
    deathAt: number,
    line: string,
    windowed: boolean,
  ) => {
    const id = spellIdByName(unit, name);
    if (!id) return;
    const talents = new Set<string>((unit.info?.pvpTalents ?? []).map(String));
    if (!usableWhileStunned(id, talents)) return;
    const all = controlsOn(ctx, unit).filter((c) => c.from < deathAt);
    if (!all.some((c) => isStunDrAura(c.spellId))) return;
    ctx.bump("freeToPressBelowLog");
    const hard = blocksOn(ctx, unit, id).filter(
      (c) => c.from < deathAt && !isStunDrAura(c.spellId),
    );
    const lastHard = Math.max(-Infinity, ...hard.map((c) => c.to));
    if (lastHard >= deathAt) return;
    const lo = windowed ? deathAt - 5000 : -Infinity;
    const free = (deathAt - Math.max(lastHard, lo, ctx.start)) / 1000;
    if (free - printed > 0.15)
      ctx.violate(
        "freeToPressBelowLog",
        windowed ? "missedOptions" : "defensiveAvailable",
        deathAt,
        `${unit.name}|${name}|${windowed}`,
        `${name}: printed ${printed}, free of any non-stun control ${free.toFixed(2)}`,
        line,
      );
  };
  for (const line of ctx.lines) {
    const a = AVAILABLE.exec(line);
    if (a) {
      const unit = ctx.unitOfPid(a[1]);
      const dead = ctx.players.find(
        (u) => u.reaction === unit?.reaction && deathMs(u) < Infinity,
      );
      if (unit && dead)
        check(unit, dead, a[2]!, +a[3]!, deathMs(dead), line, false);
      continue;
    }
    const m = MISSED.exec(line);
    if (m) {
      const dead = ctx.byName.get(m[3]!);
      const unit = ctx.byName.get(m[4]!);
      if (unit && dead)
        check(unit, dead, m[5]!, +m[6]!, deathMs(dead), line, true);
    }
  }
}

function cannotCast(ctx: IRoundCtx): void {
  const unit = ctx.owner;
  const defensive = new Set(
    classMetadata
      .flatMap((m) => m.abilities)
      .filter((s) => s.tags.includes(SpellTag.Defensive))
      .map((s) => s.spellId),
  );
  const lockouts: ISpan[] = (unit.actionIn ?? [])
    .filter((a: any) => a.logLine.event === LogEvent.SPELL_INTERRUPT)
    .map((a: any) => ({
      from: a.timestamp,
      to: a.timestamp + 3000,
      spellId: String(a.spellId ?? ""),
    }));
  const runs = [...controlsOn(ctx, unit), ...lockouts];
  for (const line of ctx.lines) {
    const m = STAYED.exec(line);
    if (!m) continue;
    ctx.bump("cannotCastCountsAPress");
    const from = ctx.start + secOf(`${m[1]}:${m[2]}`) * 1000;
    const to = ctx.start + (secOf(`${m[3]}:${m[4]}`) + 1) * 1000;
    const printed = +m[5]!;
    const pressed = successesOf(unit).filter(
      (c) =>
        defensive.has(String(c.spellId)) && tsOf(c) >= from && tsOf(c) < to,
    );
    // the stretches of the span a defensive went out in
    const free = runs.filter(
      (r) =>
        r.from < to &&
        r.to > from &&
        pressed.some((c) => tsOf(c) >= r.from && tsOf(c) <= r.to),
    );
    const freeS =
      free.reduce(
        (s, r) => s + Math.min(r.to, to) - Math.max(r.from, from),
        0,
      ) / 1000;
    const spanS = (to - from) / 1000 - 1; // the printed ends are floored
    if (freeS >= 1 && printed > spanS - freeS + 0.5)
      ctx.violate(
        "cannotCastCountsAPress",
        "pressedThroughIt",
        from,
        `${m[1]}:${m[2]}`,
        `printed ${printed}s of a ${spanS}s span; ${freeS.toFixed(1)}s of it a defensive went out in`,
        line,
      );
  }
}

export function run(ctx: IRoundCtx): void {
  freeToPress(ctx);
  cannotCast(ctx);
}

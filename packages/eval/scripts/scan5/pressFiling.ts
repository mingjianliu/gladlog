/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents, healIn) */
/**
 * scan5/pressFiling.ts — class 5 of the round-7 audit (fact7 F21), the rest of
 * it: whose press a line files an effect under, against the rows.
 *
 *  - `dispelPressOnAlly` (D18): `X (passive)` in `[MINOR DISPELS]` under a unit
 *    a teammate's SPELL_CAST_SUCCESS of X was aimed at, in that second. The
 *    SPELL_DISPEL rows of a press on an ally name the recipient as source.
 *    d2e6e70b 0:26: the hunter's Mending Bandage, on the warlock.
 *  - `teamProcSourceDropped` (D44): an `[ENEMY DEF]` line for an aura another
 *    unit applied and a press of that unit put up, not naming that unit.
 *    ba5e59c6 2:02: Sshero's Peaceweaver on the warrior and the druid.
 *  - `cheatDeathProcUnsaid` (D46): a Cauterize heal / Cauterized debuff on a
 *    friendly with no `[PROC]` line for it. 7acbefeb 1:09: 311k heal, no 87023.
 *  - `controlRemovalFiled` (D33): a Master's Call on an ally that does not say
 *    what it did, or a legend that lists it as a grip / redirect. 163de8f1 0:43.
 *  - `selfOnlyHeldDualRole` (D62): the `self-only defensive` NOTE naming a
 *    spell whose press in this round was aimed at another unit. 6ab51f91:
 *    Ultimate Penitence, the enemy priest's copy aimed at a teammate.
 */
import { APPLIED, ev, type IRoundCtx, nameOf, successesOf, tsOf } from "./ctx";

export const CHECKS = [
  "dispelPressOnAlly",
  "teamProcSourceDropped",
  "cheatDeathProcUnsaid",
  "controlRemovalFiled",
  "selfOnlyHeldDualRole",
] as const;

const SECOND = 1000;
const CAUTERIZE_MARKERS = new Set(["1286444", "87023", "87024"]);
const PROC_LINE =
  /^\s*(\d+):(\d\d)\s+\[(?:YOU|TEAM)\] \[PROC\]\s+(?:(\d+)\([^)]*\) \([^)]*\): )?(.+?) \(cheat-death proc\)/;

const secOf = (m: string, s: string): number => +m * 60 + +s;
const MINOR = /^\s*(\d+):(\d\d)\s+\[MINOR DISPELS\]\s+(\d+)\([^)]*\): (.+)$/;
const PASSIVE_PART = /(?:^|, )([^,(]+?) \(passive\)/g;

function dispelPressOnAlly(ctx: IRoundCtx): void {
  const all = ctx.players;
  for (const line of ctx.lines) {
    const m = MINOR.exec(line);
    if (!m) continue;
    const unit = ctx.unitOfPid(m[3]);
    if (!unit) continue;
    for (const p of m[4]!.matchAll(PASSIVE_PART)) {
      const name = p[1]!.trim();
      ctx.bump("dispelPressOnAlly");
      const press = all
        .filter((u) => u.id !== unit.id)
        .flatMap((u) => successesOf(u))
        .find(
          (c) =>
            c.destUnitId === unit.id && nameOf(c.spellId, c.spellName) === name,
        );
      if (!press) continue;
      ctx.violate(
        "dispelPressOnAlly",
        "pressFiledPassive",
        tsOf(press),
        `${unit.name}#${name}`,
        `${press.srcUnitName} pressed ${name} on ${unit.name}, the line files it under the recipient as passive`,
        line.trim().slice(0, 200),
      );
    }
  }
}

const ENEMY_DEF =
  /^\s*(\d+):(\d\d)\s+\[ENEMY DEF\]\s+(\d+)\([^)]*\)(?: \([^)]*\))?: (.+)$/;
/** auras put on a unit by a teammate's press of another spell */
const TEAM_PROC_NAMES = new Set(["Peaceweaver"]);

function teamProcSourceDropped(ctx: IRoundCtx): void {
  for (const line of ctx.lines) {
    const m = ENEMY_DEF.exec(line);
    if (!m) continue;
    const unit = ctx.unitOfPid(m[3]);
    if (!unit) continue;
    const name = /^(.+?)(?: \(| \[|$)/.exec(m[4]!)?.[1] ?? "";
    if (!TEAM_PROC_NAMES.has(name)) continue;
    const lo = ctx.start + secOf(m[1]!, m[2]!) * SECOND;
    const aura = ((unit.auraEvents ?? []) as any[]).find(
      (a) =>
        ev(a) === APPLIED &&
        tsOf(a) >= lo - SECOND &&
        tsOf(a) < lo + SECOND &&
        nameOf(a.spellId, a.spellName) === name,
    );
    if (!aura) continue;
    ctx.bump("teamProcSourceDropped");
    if (aura.srcUnitId === unit.id) continue;
    const pid = ctx.pidOf(aura.srcUnitName);
    if (pid && m[4]!.includes(`${pid}(`)) continue;
    ctx.violate(
      "teamProcSourceDropped",
      "sourceDropped",
      lo,
      `${unit.name}#${m[1]}:${m[2]}`,
      `${aura.srcUnitName} applied ${name} on ${unit.name}`,
      line.trim().slice(0, 200),
    );
  }
}

function cheatDeathProcUnsaid(ctx: IRoundCtx): void {
  const said: Array<{ t: number; pid?: string }> = [];
  for (const line of ctx.lines) {
    const m = PROC_LINE.exec(line);
    if (m) said.push({ t: secOf(m[1]!, m[2]!), pid: m[3] });
  }
  const friends = ctx.players.filter((p) => p.reaction === ctx.owner.reaction);
  for (const f of friends) {
    const marks = [
      ...((f.healIn ?? []) as any[]).filter(
        (h) => h.srcUnitId === f.id && CAUTERIZE_MARKERS.has(String(h.spellId)),
      ),
      ...((f.auraEvents ?? []) as any[]).filter(
        (a) =>
          ev(a) === APPLIED &&
          a.srcUnitId === f.id &&
          CAUTERIZE_MARKERS.has(String(a.spellId)),
      ),
    ]
      .map(tsOf)
      .filter((t) => t >= ctx.start && t <= ctx.roundEndAt)
      .sort((a, b) => a - b);
    // the markers of one proc are one fact
    const procs = marks.filter((t, i) => i === 0 || t - marks[i - 1]! > SECOND);
    const pid = f.id === ctx.owner.id ? undefined : ctx.pidOf(f.name);
    for (const t of procs) {
      ctx.bump("cheatDeathProcUnsaid");
      const s = Math.floor((t - ctx.start) / SECOND);
      if (said.some((p) => Math.abs(p.t - s) <= 1 && p.pid === pid)) continue;
      ctx.violate(
        "cheatDeathProcUnsaid",
        "noLine",
        t,
        `${f.name}#${s}`,
        `Cauterize on ${f.name} at ${s}s has no [PROC] line`,
      );
    }
  }
}

function controlRemovalFiled(ctx: IRoundCtx): void {
  for (const line of ctx.lines) {
    const legend = /redirect \([^)]*Master's Call[^)]*\)/.test(line);
    const press = /\[ENEMY DEF\].*: Master's Call → /.test(line);
    if (!legend && !press) continue;
    ctx.bump("controlRemovalFiled");
    if (press && line.includes("(removes roots / snares)")) continue;
    ctx.violate(
      "controlRemovalFiled",
      legend ? "legend" : "line",
      ctx.start,
      legend ? "legend" : line.trim().slice(0, 60),
      "Master's Call filed as a grip / redirect",
      line.trim().slice(0, 200),
    );
  }
}

const HELD_NOTE =
  /self-only defensive cooldowns \(([^)]*)\) were correctly HELD/;

function selfOnlyHeldDualRole(ctx: IRoundCtx): void {
  for (const line of ctx.lines) {
    const m = HELD_NOTE.exec(line);
    if (!m) continue;
    for (const name of m[1]!.split(", ")) {
      ctx.bump("selfOnlyHeldDualRole");
      const aimed = ctx.players
        .flatMap((u) => successesOf(u))
        .find(
          (c) =>
            nameOf(c.spellId, c.spellName) === name &&
            c.destUnitId &&
            !/^0+$/.test(c.destUnitId) &&
            c.destUnitId !== c.srcUnitId,
        );
      if (!aimed) continue;
      ctx.violate(
        "selfOnlyHeldDualRole",
        "aimedAtAnother",
        tsOf(aimed),
        name,
        `${aimed.srcUnitName}'s ${name} aimed at ${aimed.destUnitName}`,
        line.trim().slice(0, 200),
      );
    }
  }
}

export function run(ctx: IRoundCtx): void {
  dispelPressOnAlly(ctx);
  teamProcSourceDropped(ctx);
  cheatDeathProcUnsaid(ctx);
  controlRemovalFiled(ctx);
  selfOnlyHeldDualRole(ctx);
}

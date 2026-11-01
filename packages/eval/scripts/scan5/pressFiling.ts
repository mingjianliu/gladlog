/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents, healIn) */
/**
 * scan5/pressFiling.ts — class 5 of the round-7 audit (fact7 F21), the rest of
 * it: whose press a line files an effect under, against the rows.
 *
 *  - `dispelPressOnAlly` (D18): `X (passive)` in `[MINOR DISPELS]` under a unit
 *    a teammate's SPELL_CAST_SUCCESS of X was aimed at, in the second of one of
 *    that unit's own X rows. The SPELL_DISPEL rows of a press on an ally name
 *    the recipient as source. d2e6e70b 0:26: the hunter's Mending Bandage, on
 *    the warlock. An enemy's press aimed at the unit is no press on an ally,
 *    and one at another moment is not behind this row: 30846f8e r2 printed
 *    `Spellsteal (passive)` for Jdmx's own row at 07:53:08.509, the repeat of
 *    his press 4.0 s before (Improved Spellsteal 1270827), and read Aschoni's
 *    press on him at 07:52:52 as the cause.
 *  - `teamProcSourceDropped` (D44): an `[ENEMY DEF]` line for an aura another
 *    unit applied and a press of that unit put up, not naming that unit.
 *    ba5e59c6 2:02: Sshero's Peaceweaver on the warrior and the druid.
 *  - `cheatDeathProcUnsaid` (D46): a Cauterize heal / Cauterized debuff on a
 *    friendly with no `[PROC]` line for it. 7acbefeb 1:09: 311k heal, no 87023.
 *  - `controlRemovalFiled` (D33): a Master's Call on an ally that does not say
 *    what it did, or a legend that lists it as a grip / redirect. 163de8f1 0:43.
 *  - `selfOnlyHeldDualRole` (D62): the `self-only defensive` NOTE naming a
 *    spell whose press in this round reached another unit: aimed at it, with
 *    a row of the spell from the presser on it. 6ab51f91: Ultimate Penitence,
 *    the enemy priest's copy aimed at a teammate. The aim alone is no reach: a
 *    self-buff's cast row names whatever the presser had targeted, and
 *    Survival of the Fittest 264735 went on presser + pet only with that row
 *    naming an enemy and a teammate in one log (ec7bd3f5 r3).
 */
import { APPLIED, ev, type IRoundCtx, nameOf, successesOf, tsOf } from "./ctx";

export const CHECKS = [
  "dispelPressOnAlly",
  "dispelActorOffRoster",
  "teamProcSourceDropped",
  "cheatDeathProcUnsaid",
  "controlRemovalFiled",
  "selfOnlyHeldDualRole",
] as const;

const SECOND = 1000;
const DISPEL_ROWS = new Set(["SPELL_DISPEL", "SPELL_STOLEN"]);
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
      const rows = ((unit.actionOut ?? []) as any[])
        .filter(
          (r) =>
            DISPEL_ROWS.has(ev(r)) && nameOf(r.spellId, r.spellName) === name,
        )
        .map(tsOf);
      const ownPress = successesOf(unit)
        .filter((c) => nameOf(c.spellId, c.spellName) === name)
        .map(tsOf);
      const press = all
        .filter((u) => u.id !== unit.id && u.reaction === unit.reaction)
        .flatMap((u) => successesOf(u))
        .find(
          (c) =>
            c.destUnitId === unit.id &&
            nameOf(c.spellId, c.spellName) === name &&
            rows.some(
              (t) =>
                Math.abs(t - tsOf(c)) <= SECOND &&
                !ownPress.some((o) => Math.abs(t - o) <= SECOND),
            ),
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

/** The acting unit of a dispel line is a roster token; a pet's own name is not
 * one (`Raptor: Master's Call ×1`, the D18 fix naming the pet that pressed). */
const DISPEL_LINE =
  /^\s*\d+:\d\d\s+\[(?:MINOR DISPELS|CLEANSE|PURGE|ENEMY CLEANSE|ENEMY PURGE)\]\s+(.+)$/;

function dispelActorOffRoster(ctx: IRoundCtx): void {
  for (const line of ctx.lines) {
    const m = DISPEL_LINE.exec(line);
    if (!m) continue;
    ctx.bump("dispelActorOffRoster");
    if (/^\d+\(/.test(m[1]!)) continue;
    const label = m[1]!.split(":")[0]!;
    ctx.violate(
      "dispelActorOffRoster",
      "actorNotAToken",
      ctx.start,
      `${label}#${m[1]!.slice(0, 60)}`,
      `the line's actor is ${label}, not a roster token`,
      line.trim().slice(0, 200),
    );
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

/** a row of this press's spell from its presser on the unit it was aimed at */
function pressReachedDest(ctx: IRoundCtx, c: any, name: string): boolean {
  const dest = ctx.units.find((u) => u.id === c.destUnitId);
  if (!dest) return false;
  const mine = (r: any) =>
    r.srcUnitId === c.srcUnitId && nameOf(r.spellId, r.spellName) === name;
  return [
    ...((dest.auraEvents ?? []) as any[]).filter((a) => ev(a) === APPLIED),
    ...((dest.damageIn ?? []) as any[]),
    ...((dest.healIn ?? []) as any[]),
  ].some(mine);
}

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
            c.destUnitId !== c.srcUnitId &&
            pressReachedDest(ctx, c, name),
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

/** Measurement, not a verdict: per spell, how many of its `[BUFF FADED]` lines
 * say `ended early — no dispel logged`. A spell at most of its lines is a run
 * that ends with the action, not early (Deep Breath, Predator's Wake). */
const FADE_LINE = /\[BUFF FADED\]\s+(?:\d+\([^)]*\)[^:]*: )?(.+?) \(/;
const fades = new Map<string, { all: number; early: number }>();

function fadeEarlyShare(ctx: IRoundCtx): void {
  for (const line of ctx.lines) {
    const name = FADE_LINE.exec(line)?.[1];
    if (!name) continue;
    const f = fades.get(name) ?? { all: 0, early: 0 };
    f.all++;
    if (line.includes("(ended early — no dispel logged)")) f.early++;
    fades.set(name, f);
  }
}

export function report(): string[] {
  return [...fades]
    .filter(([, f]) => f.all >= 12 && f.early / f.all >= 0.2)
    .sort((a, b) => b[1].early / b[1].all - a[1].early / a[1].all)
    .map(
      ([name, f]) =>
        `fadeEarlyShare ${name}: ${f.early} / ${f.all} (${((100 * f.early) / f.all).toFixed(0)} %)`,
    );
}

export function run(ctx: IRoundCtx): void {
  fadeEarlyShare(ctx);
  dispelPressOnAlly(ctx);
  dispelActorOffRoster(ctx);
  teamProcSourceDropped(ctx);
  cheatDeathProcUnsaid(ctx);
  controlRemovalFiled(ctx);
  selfOnlyHeldDualRole(ctx);
}

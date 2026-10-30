/* eslint-disable @typescript-eslint/no-explicit-any -- the checks walk the untyped legacy parse objects and raw log rows */
/**
 * scan5/singles2.ts — fact6 F20 single defects D23 / D24 / D25 / D26 / D28 /
 * D31, each counted as its whole fact class. Truth comes from the round's raw
 * log rows (`ctx.rawLines`, parsed here) and the legacy units' advanced
 * position samples; tables are lookups only (English names, DB2 rows,
 * `OFFENSIVE_CD_SPELL_IDS` as "the set the code knows", spell radii).
 *
 *  - `overrideVariantPressMissing` (D23): a player's SPELL_CAST_SUCCESS of a
 *    spell X that DB2 makes a same-button variant of a tracked cooldown Y —
 *    a `SpellEffect` row with EffectAura 332 (OVERRIDE_ACTIONBAR_SPELLS),
 *    `EffectMiscValue_0` = Y, `EffectBasePointsF` = X, X and Y sharing a
 *    non-zero `SpellCategories.Category` or `ChargeCategory` (one cooldown).
 *    Read from the datagen DB2 cache (`$DATAGEN_CACHE`, default
 *    `~/.cache/gladlog-datagen`, newest build holding both tables); without
 *    it the check says so in its report and checks nothing. Y is tracked for
 *    the unit when it is in `OFFENSIVE_CD_SPELL_IDS`, or its English name is
 *    in the unit's `<cooldowns>` loadout or on any of the unit's rendered
 *    cooldown lines. Kinds: `line:<X>` — no `[ENEMY CD]` / `[ENEMY DEF]` /
 *    `[ENEMY HEAL CD]` / `[TEAM] [CD]` / `[YOU] [CD]` line of that unit at
 *    the press second ±1 names X or Y (Predator's Wake 1259431 → The Hunt
 *    1246167); `windowList:<X>` — an enemy press inside an `[OFFENSIVE
 *    WINDOW] a–b | … | CDs: …` header whose list has no `X@` / `Y@` at the
 *    press second ±1. `sameUse` (measured): X pressed while Y's own aura
 *    from the caster is up or ended ≤ 500 ms before — the same use (Time
 *    Stop's cancel button 383332), not a new press.
 *  - `resEnemyDuplicateWindow` (D24): a `[RES]` row whose `enemy:` field
 *    lists `Name/Spec(Ns left)` k > 1 times. Truth = how many enemy units of
 *    that spec have a running aura of that English name they sourced (on
 *    themselves or any target; APPLIED…REMOVED, a REFRESH opens nothing)
 *    overlapping the row's second; with no such aura in the round, how many
 *    of them cast it in the 120 s before. Kind `duplicate` when k > truth.
 *  - `resEnemySameSecondPressMissing` (D25): every `[ENEMY CD]` line at the
 *    row's second s (`N(…) (Spec): Name`) against each `[RES]` row anchored at
 *    s. Truth: that unit's press row of the name (SUCCESS, or the aura's
 *    APPLIED for a `(no press)` / `(proc …)` line) at floor second s, and its
 *    aura of that name (sourced by the unit, APPLIED −1 s … +2 s around the
 *    press) still up at s + 1. Kind `missing` when the row has no
 *    `Name( (…))?/Spec(` entry (or one of Name's DB2 override-variant
 *    siblings — D24's one window per canonical cooldown). `windowHeaderRow` (the row directly under an
 *    `[OFFENSIVE WINDOW]` header, which the legend lets miss its opener) and
 *    `noAura` (no aura of that name logged: the window cannot be read off
 *    the log) are measured, not in the total.
 *  - `groundingAteOmitted` (D26): a `[YOU] [CD]` / `[TEAM] [CD]` Grounding
 *    Totem line and its player's SPELL_SUMMON 204336 at that second (the
 *    totem GUID). Truth set inside [summon, summon + 3.5 s]: (a) SPELL_ABSORBED
 *    rows the totem absorbed (the attacker's spell), (b) a hostile SUCCESS
 *    whose destination is the totem, (c) an IMMUNE miss on the totem with no
 *    (b) of that caster into it in the 3 s before, after a ground cast of
 *    that name with no destination (a trap); minus spells that then damaged
 *    the totem (an attack on it). Kinds `nonDamage` ((b)/(c) missing from the
 *    line's `[ABSORBED: …]`) and `absorbRow` ((a) missing); measured only:
 *    `namesUnknown` (an `[ABSORBED spells from: …]` line) and `missOnly` (an
 *    IMMUNE row with no cast — a proc / area effect the totem stood in).
 *  - `ccAvoidedLandedElsewhere` (D28): a `[CC AVOIDED?] P: Control (by C) did
 *    not land; …` line. Truth: C's (or C's summon's) SUCCESS of the control
 *    in [s − 3, s + 1]; the control's aura (same English name; Capacitor
 *    Totem also Static Charge) APPLIED by C on another unit within the
 *    control's landing window, before any on P. Kind `outOfReach` when P was
 *    farther from that victim at the landing (advanced-log positions, nearest
 *    sample within 1.5 s) than the reach (Freezing Trap: its DB2 radius + 2
 *    yd around the trap = the victim; an area control: twice its DB2 radius
 *    with talent mods + 2 yd, the centre being unknown). `noPosition`
 *    measured only.
 *  - `purgeRemovalCount` (D31): each `[PURGE]` entry `Buff off N(…) (k of M
 *    purgeable buff[s] on it…)` and each owner cast `[removed: … — k of M …
 *    on the target]`. Truth: the press's SPELL_DISPEL / SPELL_STOLEN rows —
 *    same source (or its pet), same tool, same target, within 300 ms — that
 *    hold the buff; r = how many of them N counts (official Magic, not
 *    UNPURGEABLE_MAGIC_AURAS). Same tool = same name (Mass Dispel 39897 +
 *    32592); a Kleptomania tick and an Improved Spellsteal 4 s repeat are
 *    removals of their own. Kind `perPress:<tool>` when k ≠ max(1, r).
 *    `legend`: the context still says "A purge removes ONE of them" while a
 *    rendered purge press removed ≥ 2; `menuDefinition`: the menu's
 *    missed-purge definition says the same while a purger of the owner's
 *    team removed ≥ 2 with one press this round.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import spellReach from "@gladlog/analysis/src/data/spellReachGenerated.json";
import { CONTROL_FAILED_MISS_TYPES } from "@gladlog/analysis/src/utils/castMissRows";
import {
  getDispelType,
  PURGE_PRESS_REMOVALS_TEXT,
  UNPURGEABLE_MAGIC_AURAS,
} from "@gladlog/analysis/src/utils/dispelAnalysis";
import { AOE_CC_LANDING_WINDOW_S } from "@gladlog/analysis/src/utils/drAnalysis";
import {
  distanceBetween,
  getUnitPositionAtTime,
} from "@gladlog/analysis/src/utils/losAnalysis";
import { INTERP_MAX_GAP_MS } from "@gladlog/analysis/src/utils/positionSampling";
import { OFFENSIVE_CD_SPELL_IDS } from "@gladlog/analysis/src/utils/spellDanger";

import { fmtS, type IRoundCtx, nameOf, secOf } from "./ctx";

export const CHECKS = [
  "overrideVariantPressMissing",
  "resEnemyDuplicateWindow",
  "resEnemySameSecondPressMissing",
  "groundingAteOmitted",
  "ccAvoidedLandedElsewhere",
  "purgeRemovalCount",
] as const;

export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "overrideVariantPressMissing|sameUse",
  "overrideVariantPressMissing|windowEndSecond",
  "resEnemySameSecondPressMissing|windowHeaderRow",
  "resEnemySameSecondPressMissing|noAura",
  "groundingAteOmitted|namesUnknown",
  "groundingAteOmitted|missOnly",
  "ccAvoidedLandedElsewhere|noPosition",
]);

// ── raw rows ────────────────────────────────────────────────────────────────

interface IRow {
  i: number;
  ms: number;
  /** f[0] = event, f[1] src GUID … as the combat log writes them */
  f: string[];
}

function splitCsv(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let k = 0; k < s.length; k++) {
    const c = s[k]!;
    if (c === '"') q = !q;
    else if (c === "," && !q) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** wall-clock of a raw line read naively (no zone): the round's legacy
 * timestamps calibrate it */
function naiveMs(line: string): number | undefined {
  const m = /^(\d+)\/(\d+)\/(\d+) (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
  if (!m) return undefined;
  return (
    Date.UTC(+m[3]!, +m[1]! - 1, +m[2]!, +m[4]!, +m[5]!, 0) + +m[6]! * 1000
  );
}

const rowCache = new WeakMap<object, IRow[]>();
function rowsOf(ctx: IRoundCtx): IRow[] {
  const hit = rowCache.get(ctx.rawLines);
  if (hit) return hit;
  let offset: number | undefined;
  for (const u of ctx.units) {
    for (const c of (u.spellCastEvents ?? []) as any[]) {
      const li = c.logLine?.lineIndex;
      if (li === undefined) continue;
      const n = naiveMs(ctx.rawLines[li] ?? "");
      if (n === undefined) continue;
      offset = c.logLine.timestamp - n;
      break;
    }
    if (offset !== undefined) break;
  }
  const rows: IRow[] = [];
  if (offset !== undefined)
    ctx.rawLines.forEach((line, i) => {
      const sep = line.indexOf("  ");
      if (sep < 0) return;
      const n = naiveMs(line);
      if (n === undefined) return;
      rows.push({
        i,
        ms: Math.round(n + offset!),
        f: splitCsv(line.slice(sep + 2)),
      });
    });
  rowCache.set(ctx.rawLines, rows);
  return rows;
}

// ── prompt helpers ──────────────────────────────────────────────────────────

const TIMED = /^(\d+):(\d\d) {2}\[/;
const stripSuffix = (n: string) => n.replace(/ \([^)]*\)$/, "").trim();

interface IUnitInfo {
  pid: string;
  name: string;
  spec: string;
  role: string;
  loadout: Set<string>;
}
function unitInfos(ctx: IRoundCtx): IUnitInfo[] {
  const out: IUnitInfo[] = [];
  let cur: IUnitInfo | undefined;
  for (const l of ctx.lines) {
    const u =
      /<unit id="(\d+)" name="([^"]+)" spec="([^"]*)" role="([^"]*)"/.exec(l);
    if (u) {
      cur = {
        pid: u[1]!,
        name: u[2]!,
        spec: u[3]!,
        role: u[4]!,
        loadout: new Set(),
      };
      out.push(cur);
      continue;
    }
    const cds = /<cooldowns>(.*)<\/cooldowns>/.exec(l);
    if (cds && cur)
      for (const part of cds[1]!.split(/, (?=[A-Z])/))
        cur.loadout.add(part.replace(/ \[.*$/, "").trim());
  }
  return out;
}

const teamOf = (ctx: IRoundCtx, guid: string): string | undefined => {
  const u = ctx.units.find((x) => x.id === guid);
  if (!u) return undefined;
  if (u.info?.teamId !== undefined) return String(u.info.teamId);
  const o = u.ownerId ? ctx.units.find((x) => x.id === u.ownerId) : undefined;
  return o?.info?.teamId !== undefined ? String(o.info.teamId) : undefined;
};
const ownerOrSelf = (ctx: IRoundCtx, guid: string): string => {
  const u = ctx.units.find((x) => x.id === guid);
  return u?.ownerId && u.ownerId !== "0000000000000000" ? u.ownerId : guid;
};

// ── D23: DB2 override variants ──────────────────────────────────────────────

let variantTable: Map<string, string[]> | null | undefined;
let variantSource = "";
function readCsv(path: string): Array<Record<string, string>> {
  const [head, ...body] = readFileSync(path, "utf8").split("\n");
  const cols = splitCsv(head!.trim());
  return body
    .filter((l) => l.trim())
    .map((l) => {
      const v = splitCsv(l.trim());
      const r: Record<string, string> = {};
      cols.forEach((c, k) => (r[c] = v[k] ?? ""));
      return r;
    });
}
function variants(): Map<string, string[]> | null {
  if (variantTable !== undefined) return variantTable;
  const dir =
    process.env.DATAGEN_CACHE ?? join(homedir(), ".cache", "gladlog-datagen");
  const builds = (table: string) =>
    existsSync(dir)
      ? readdirSync(dir)
          .map((f) => new RegExp(`^${table}-([\\d.]+)\\.csv$`).exec(f)?.[1])
          .filter((b): b is string => !!b)
      : [];
  const cats = new Set(builds("SpellCategories"));
  const cmp = (a: string, b: string) => {
    const x = a.split(".").map(Number);
    const y = b.split(".").map(Number);
    for (let k = 0; k < Math.max(x.length, y.length); k++)
      if ((x[k] ?? 0) !== (y[k] ?? 0)) return (x[k] ?? 0) - (y[k] ?? 0);
    return 0;
  };
  const build = builds("SpellEffect")
    .filter((b) => cats.has(b))
    .sort(cmp)
    .pop();
  if (!build) {
    variantSource = `no DB2 cache under ${dir} — overrideVariantPressMissing checked nothing`;
    return (variantTable = null);
  }
  const cat = new Map<string, { c: string; ch: string }>();
  for (const r of readCsv(join(dir, `SpellCategories-${build}.csv`)))
    if (r.DifficultyID === "0")
      cat.set(r.SpellID!, { c: r.Category!, ch: r.ChargeCategory! });
  const t = new Map<string, string[]>();
  let rows = 0;
  for (const r of readCsv(join(dir, `SpellEffect-${build}.csv`))) {
    if (r.EffectAura !== "332") continue;
    const y = r.EffectMiscValue_0!;
    const x = String(Math.round(Number(r.EffectBasePointsF)));
    if (!y || y === "0" || x === "0" || x === y) continue;
    const a = cat.get(y);
    const b = cat.get(x);
    if (!a || !b) continue;
    const shared =
      (a.c !== "0" && a.c === b.c) || (a.ch !== "0" && a.ch === b.ch);
    if (!shared) continue;
    t.set(x, [...new Set([...(t.get(x) ?? []), y])]);
    rows++;
  }
  variantSource = `DB2 ${build}: ${rows} aura-332 same-cooldown override pairs, ${t.size} variant ids`;
  return (variantTable = t);
}

/** the English names of `name`'s DB2 override-variant group (the variant
 *  and every member it overrides, and their other variants), `name` included */
let siblingCache: Map<string, Set<string>> | undefined;
function variantSiblingNames(name: string): Set<string> {
  if (!siblingCache) {
    siblingCache = new Map();
    const t = variants();
    if (t)
      for (const [x, ys] of t) {
        const group = new Set(
          [x, ...ys].map((id) => nameOf(id, "")).filter((n) => n !== ""),
        );
        for (const n of group) {
          const prev = siblingCache.get(n) ?? new Set<string>([n]);
          for (const m of group) prev.add(m);
          siblingCache.set(n, prev);
        }
      }
  }
  return siblingCache.get(name) ?? new Set([name]);
}

const CD_LINE =
  /^(\d+:\d\d) {2}\[(ENEMY CD|ENEMY DEF|ENEMY HEAL CD|TEAM\] \[CD|YOU\] \[CD)\] {3}(?:(\d+)\([^)]*\) \([^)]*\): )?(.+)$/;

function overrideVariantPressMissing(ctx: IRoundCtx, infos: IUnitInfo[]): void {
  const t = variants();
  if (!t) return;
  const ownerTeam = String(ctx.owner.info?.teamId);
  const cdLines: Array<{ s: number; pid: string; text: string }> = [];
  const windows: Array<{ a: number; b: number; list: string; line: string }> =
    [];
  const ownerPid = ctx.pidOf(ctx.owner.name) ?? "";
  for (const l of ctx.lines) {
    const m = CD_LINE.exec(l);
    if (m)
      cdLines.push({
        s: secOf(m[1]!),
        pid: m[3] ?? (m[2] === "YOU] [CD" ? ownerPid : ""),
        text: m[4]!,
      });
    const w =
      /^\d+:\d\d {2}\[OFFENSIVE WINDOW\] {3}(\d+:\d\d)–(\d+:\d\d) .*CDs: (.*)$/.exec(
        l,
      );
    if (w)
      windows.push({ a: secOf(w[1]!), b: secOf(w[2]!), list: w[3]!, line: l });
  }
  for (const p of ctx.players) {
    const pid = ctx.pidOf(p.name);
    if (!pid) continue;
    const info = infos.find((x) => x.pid === pid);
    const enemy = String(p.info?.teamId) !== ownerTeam;
    for (const c of (p.spellCastEvents ?? []) as any[]) {
      if (c.logLine?.event !== "SPELL_CAST_SUCCESS") continue;
      const ys = t.get(String(c.spellId));
      if (!ys) continue;
      const ms = c.logLine.timestamp;
      if (ms < ctx.start || ms > ctx.roundEndAt) continue;
      const xName = nameOf(c.spellId, c.spellName);
      const tracked = ys.filter((y) => {
        const yn = nameOf(y, y);
        return (
          OFFENSIVE_CD_SPELL_IDS.has(y) ||
          info?.loadout.has(yn) ||
          cdLines.some((d) => d.pid === pid && d.text.startsWith(yn))
        );
      });
      if (tracked.length === 0) continue;
      const names = [xName, ...tracked.map((y) => nameOf(y, y))];
      const s = Math.floor((ms - ctx.start) / 1000);
      ctx.bump("overrideVariantPressMissing");
      const fact = `${p.id}:${Math.round(ms / 100)}`;
      // the variant pressed while the base cooldown's own aura from this
      // caster is up (or gone ≤ 500 ms before) is that same use — Time
      // Stop's cancel button 383332 (DB2 aura 332 from 383340, granted
      // while 378441 runs), not a new press
      const ivs = auraIntervals(ctx);
      if (
        ivs.some(
          (iv) =>
            iv.src === p.id &&
            tracked.includes(iv.id) &&
            iv.from <= ms &&
            iv.to >= ms - 500,
        )
      ) {
        ctx.violate(
          "overrideVariantPressMissing",
          "sameUse",
          ms,
          fact,
          `${p.name} pressed ${xName} ${c.spellId} at ${fmtS(s)} inside its own ${tracked.join("/")} aura`,
        );
        continue;
      }
      const shown = cdLines.some(
        (d) =>
          d.pid === pid &&
          Math.abs(d.s - s) <= 1 &&
          names.some((n) => d.text.startsWith(n)),
      );
      if (!shown)
        ctx.violate(
          "overrideVariantPressMissing",
          `line:${xName}`,
          ms,
          fact,
          `${p.name} ${enemy ? "(enemy)" : "(friendly)"} pressed ${xName} ${c.spellId} (variant of ${tracked.join("/")} ${names.slice(1).join("/")}) at ${fmtS(s)} — no cooldown line`,
        );
      if (enemy)
        for (const w of windows) {
          if (s < w.a || s > w.b) continue;
          const listed = w.list.split(" + ").some((e) => {
            const at = /^(.*)@(\d+:\d\d)$/.exec(e.trim());
            return (
              !!at &&
              names.includes(stripSuffix(at[1]!)) &&
              Math.abs(secOf(at[2]!) - s) <= 1
            );
          });
          if (!listed)
            ctx.violate(
              "overrideVariantPressMissing",
              // residual 2026-10-28: a press in the header's END second may
              // come after the window's fractional end (`reach` = the last
              // buff's end) and open nothing — 3 of 3 cap-int facts
              // (121afd91 r1 3:03: Avatar 10:38:03.27 + 20 s ends 0.21 s
              // before the Bladestorm press). Not readable off the render.
              s === w.b ? "windowEndSecond" : `windowList:${xName}`,
              ms,
              `${fact}:w${w.a}`,
              `${xName} at ${fmtS(s)} inside [OFFENSIVE WINDOW] ${fmtS(w.a)}–${fmtS(w.b)}, not on its CDs: list`,
              w.line,
            );
        }
    }
  }
}

// ── D24 / D25: the [RES] enemy column ───────────────────────────────────────

interface IResRow {
  s: number;
  anchor: string;
  entries: Array<{ name: string; spec: string; left: number }>;
  line: string;
}
function resRows(ctx: IRoundCtx): IResRow[] {
  const out: IResRow[] = [];
  let s: number | undefined;
  let anchor = "";
  for (const l of ctx.lines) {
    const m = TIMED.exec(l);
    if (m) {
      s = Number(m[1]) * 60 + Number(m[2]);
      anchor = /^\d+:\d\d {2}(\[[^\]]+\])/.exec(l)?.[1] ?? "";
      continue;
    }
    if (!/^ {6}\[RES\] rdy:/.test(l) || s === undefined) continue;
    const f = / {2}enemy:(.*?)(?= {2}focus:| {2}cc:| \| Atonements|$)/.exec(l);
    const entries: IResRow["entries"] = [];
    if (f)
      for (const e of f[1]!.split(/(?<=s left\)),/)) {
        const x = /^(.*)\/([^/(]+)\((\d+)s left\)$/.exec(e.trim());
        if (x) entries.push({ name: x[1]!, spec: x[2]!, left: +x[3]! });
      }
    out.push({ s, anchor, entries, line: l });
  }
  return out;
}

interface IAuraIv {
  src: string;
  dest: string;
  id: string;
  name: string;
  from: number;
  to: number;
}
const ivCache = new WeakMap<object, IAuraIv[]>();
/** APPLIED…REMOVED per (src, dest, id); a REFRESH opens nothing */
function auraIntervals(ctx: IRoundCtx): IAuraIv[] {
  const hit = ivCache.get(ctx.rawLines);
  if (hit) return hit;
  const open = new Map<string, IAuraIv>();
  const out: IAuraIv[] = [];
  for (const r of rowsOf(ctx)) {
    const e = r.f[0];
    if (e !== "SPELL_AURA_APPLIED" && e !== "SPELL_AURA_REMOVED") continue;
    const k = `${r.f[1]}|${r.f[5]}|${r.f[9]}`;
    if (e === "SPELL_AURA_APPLIED") {
      if (open.has(k)) continue;
      const iv: IAuraIv = {
        src: r.f[1]!,
        dest: r.f[5]!,
        id: r.f[9]!,
        name: nameOf(r.f[9], r.f[10]),
        from: r.ms,
        to: Infinity,
      };
      open.set(k, iv);
      out.push(iv);
    } else {
      const iv = open.get(k);
      if (iv) {
        iv.to = r.ms;
        open.delete(k);
      }
    }
  }
  ivCache.set(ctx.rawLines, out);
  return out;
}

function resEnemyDuplicateWindow(
  ctx: IRoundCtx,
  rows: IResRow[],
  infos: IUnitInfo[],
): void {
  const ivs = auraIntervals(ctx);
  for (const row of rows) {
    const count = new Map<string, number>();
    for (const e of row.entries) {
      const k = `${e.name}/${e.spec}`;
      count.set(k, (count.get(k) ?? 0) + 1);
    }
    for (const [k, n] of count) {
      ctx.bump("resEnemyDuplicateWindow");
      if (n < 2) continue;
      const [name, spec] = [
        k.slice(0, k.lastIndexOf("/")),
        k.slice(k.lastIndexOf("/") + 1),
      ];
      const base = stripSuffix(name);
      const of = infos
        .filter((i) => i.role === "enemy" && i.spec === spec)
        .map((i) => ctx.unitOfPid(i.pid))
        .filter(Boolean);
      const a = ctx.start + row.s * 1000;
      const b = a + 1000;
      const anyAura = ivs.some(
        (iv) => iv.name === base && of.some((u) => u.id === iv.src),
      );
      // residual 2026-10-28: a press inside the row's second whose aura is
      // logged a few ms into the next one is running at the row too (the
      // D25 reading: a same-second press belongs on the row) — 62-6 1:55,
      // Dark Transformation SUCCESS 35.678, its APPLIED 35.689 = 1:56
      const pressedInSecond = (u: any) =>
        ((u.spellCastEvents ?? []) as any[]).some(
          (c) =>
            c.logLine?.event === "SPELL_CAST_SUCCESS" &&
            nameOf(c.spellId, c.spellName) === base &&
            c.logLine.timestamp >= a &&
            c.logLine.timestamp < b &&
            ivs.some(
              (iv) =>
                iv.src === u.id &&
                iv.name === base &&
                iv.from >= c.logLine.timestamp - 1000 &&
                iv.from <= c.logLine.timestamp + 2000,
            ),
        );
      const truth = anyAura
        ? of.filter(
            (u) =>
              pressedInSecond(u) ||
              ivs.some(
                (iv) =>
                  iv.src === u.id &&
                  iv.name === base &&
                  iv.from < b &&
                  iv.to >= a,
              ),
          ).length
        : of.filter((u) =>
            ((u.spellCastEvents ?? []) as any[]).some(
              (c) =>
                c.logLine?.event === "SPELL_CAST_SUCCESS" &&
                nameOf(c.spellId, c.spellName) === base &&
                c.logLine.timestamp < b &&
                c.logLine.timestamp >= a - 120_000,
            ),
          ).length;
      if (n > truth)
        ctx.violate(
          "resEnemyDuplicateWindow",
          "duplicate",
          a,
          `${row.s}:${k}`,
          `${fmtS(row.s)} [RES] lists ${k} ×${n}; the log has ${truth} running (${anyAura ? "auras" : "casts"})`,
          row.line,
        );
    }
  }
}

function resEnemySameSecondPressMissing(ctx: IRoundCtx, rows: IResRow[]): void {
  const ivs = auraIntervals(ctx);
  const cds: Array<{
    s: number;
    pid: string;
    spec: string;
    name: string;
    line: string;
  }> = [];
  for (const l of ctx.lines) {
    const m =
      /^(\d+:\d\d) {2}\[ENEMY CD\] {3}(\d+)\([^)]*\) \(([^)]+)\): (.+?)(?: \(|$)/.exec(
        l,
      );
    if (m)
      cds.push({
        s: secOf(m[1]!),
        pid: m[2]!,
        spec: m[3]!,
        name: m[4]!.trim(),
        line: l,
      });
  }
  for (const row of rows) {
    for (const cd of cds) {
      if (cd.s !== row.s) continue;
      const u = ctx.unitOfPid(cd.pid);
      if (!u) continue;
      const a = ctx.start + row.s * 1000;
      const inSec = (ms: number) => ms >= a && ms < a + 1000;
      const press =
        ((u.spellCastEvents ?? []) as any[]).find(
          (c) =>
            c.logLine?.event === "SPELL_CAST_SUCCESS" &&
            nameOf(c.spellId, c.spellName) === cd.name &&
            inSec(c.logLine.timestamp),
        )?.logLine.timestamp ??
        ivs.find(
          (iv) => iv.src === u.id && iv.name === cd.name && inSec(iv.from),
        )?.from;
      if (press === undefined) continue;
      const fact = `${row.s}:${u.id}:${cd.name}`;
      // wide residual 2026-10-29: D24 keeps ONE window per (enemy, canonical
      // cooldown), named after the press / occurrence whose end is latest —
      // an override variant's sibling (The Hunt (no press) beside Predator's
      // Wake, one use of category 2427) on the row is the same window
      // (41-16 0:48, 199-6 1:19: all 6 wide `missing` facts)
      const sibs = variantSiblingNames(cd.name);
      const listed = row.entries.some(
        (e) => sibs.has(stripSuffix(e.name)) && e.spec === cd.spec,
      );
      const aura = ivs.filter(
        (iv) =>
          iv.src === u.id &&
          iv.name === cd.name &&
          iv.from >= press - 1000 &&
          iv.from <= press + 2000,
      );
      if (aura.length === 0) {
        if (!listed)
          ctx.violate(
            "resEnemySameSecondPressMissing",
            "noAura",
            press,
            fact,
            `${cd.name} (${cd.spec}) pressed ${fmtS(row.s)}: no aura of that name logged`,
            row.line,
          );
        continue;
      }
      if (!aura.some((iv) => iv.to > a + 1000)) continue;
      ctx.bump("resEnemySameSecondPressMissing");
      if (listed) continue;
      ctx.violate(
        "resEnemySameSecondPressMissing",
        row.anchor === "[OFFENSIVE WINDOW]" ? "windowHeaderRow" : "missing",
        press,
        fact,
        `${fmtS(row.s)} [RES] (under ${row.anchor}) omits ${cd.name}/${cd.spec} pressed at +${((press - a) / 1000).toFixed(2)}s, up past ${fmtS(row.s + 1)}`,
        row.line,
      );
    }
  }
}

// ── D26: what a Grounding Totem ate ─────────────────────────────────────────

const GROUNDING_SUMMON_ID = "204336";
const GROUNDING_WINDOW_MS = 3500;
function groundingAteOmitted(ctx: IRoundCtx): void {
  const rows = rowsOf(ctx);
  const ownerPid = ctx.pidOf(ctx.owner.name) ?? "";
  for (const l of ctx.lines) {
    const m =
      /^(\d+:\d\d) {2}\[(YOU|TEAM)\] \[CD\] {3}(?:(\d+)\([^)]*\) \([^)]*\): )?Grounding Totem(.*)$/.exec(
        l,
      );
    if (!m) continue;
    const pid = m[2] === "YOU" ? ownerPid : m[3];
    const p = ctx.unitOfPid(pid);
    if (!p) continue;
    const s = secOf(m[1]!);
    const summon = rows.find(
      (r) =>
        r.f[0] === "SPELL_SUMMON" &&
        r.f[1] === p.id &&
        r.f[9] === GROUNDING_SUMMON_ID &&
        Math.abs(Math.floor((r.ms - ctx.start) / 1000) - s) <= 1,
    );
    if (!summon) continue;
    ctx.bump("groundingAteOmitted");
    const totem = summon.f[5]!;
    // by team (a totem's own flags read neutral on its SUMMON row)
    const totemTeam = teamOf(ctx, p.id);
    const hostile = (guid: string | undefined) => {
      const t = guid ? teamOf(ctx, ownerOrSelf(ctx, guid)) : undefined;
      return t !== undefined && t !== totemTeam;
    };
    const inWin = rows.filter(
      (r) => r.ms >= summon.ms && r.ms <= summon.ms + GROUNDING_WINDOW_MS,
    );
    const damaged = new Set<string>();
    for (const r of inWin)
      if (
        r.f[5] === totem &&
        /^(SPELL_DAMAGE|SPELL_PERIODIC_DAMAGE|RANGE_DAMAGE)$/.test(r.f[0]!)
      )
        damaged.add(`${r.f[1]}|${nameOf(r.f[9], r.f[10])}`);
    const truth = new Map<string, { kind: string; ms: number }>();
    const casts: IRow[] = [];
    for (const r of inWin) {
      const e = r.f[0];
      if (e === "SPELL_ABSORBED") {
        const spellForm = !(r.f[9] ?? "").includes("-");
        const absorber = spellForm ? r.f[12] : r.f[9];
        if (absorber !== totem) continue;
        const n = spellForm ? nameOf(r.f[9], r.f[10]) : "Melee";
        if (!truth.has(n)) truth.set(n, { kind: "absorbRow", ms: r.ms });
      } else if (
        e === "SPELL_CAST_SUCCESS" &&
        r.f[5] === totem &&
        hostile(r.f[1])
      ) {
        casts.push(r);
        const n = nameOf(r.f[9], r.f[10]);
        if (!damaged.has(`${r.f[1]}|${n}`) && !truth.has(n))
          truth.set(n, { kind: "nonDamage", ms: r.ms });
      } else if (
        e === "SPELL_MISSED" &&
        r.f[5] === totem &&
        r.f[12] === "IMMUNE" &&
        hostile(r.f[1]) &&
        !casts.some((c) => c.f[1] === r.f[1] && r.ms - c.ms <= 3000)
      ) {
        const n = nameOf(r.f[9], r.f[10]);
        // only the trap shape: a ground cast of that name by the caster
        // (no destination) ≤ 3 s before. An IMMUNE row of a proc / area
        // effect the totem stood in (Searing Light 1280134, Obliterate's
        // Chains of Ice 444826 — 457e197f 1:05) is no redirect.
        const ground = rows.some(
          (c) =>
            c.f[0] === "SPELL_CAST_SUCCESS" &&
            c.f[1] === r.f[1] &&
            (c.f[5] === "0000000000000000" || !c.f[5]) &&
            nameOf(c.f[9], c.f[10]) === n &&
            r.ms - c.ms >= 0 &&
            r.ms - c.ms <= 3000,
        );
        if (!damaged.has(`${r.f[1]}|${n}`) && !truth.has(n))
          truth.set(n, { kind: ground ? "nonDamage" : "missOnly", ms: r.ms });
      }
    }
    if (truth.size === 0) continue;
    const listM = /\[ABSORBED: (.*?)\](?:\s|$)/.exec(m[4]!);
    if (!listM && /\[ABSORBED spells from: /.test(m[4]!)) {
      ctx.violate(
        "groundingAteOmitted",
        "namesUnknown",
        summon.ms,
        `${totem}`,
        `${fmtS(s)} Grounding line names casters only`,
        l,
      );
      continue;
    }
    const listed = new Set(
      (listM?.[1] ?? "")
        .split(/\), /)
        .map((x) => x.replace(/ \(.*$/, "").trim())
        .filter(Boolean),
    );
    for (const [n, x] of truth)
      if (!listed.has(n))
        ctx.violate(
          "groundingAteOmitted",
          x.kind,
          x.ms,
          `${totem}:${n}`,
          `${fmtS(s)} ${p.name}'s Grounding Totem ate ${n} at ${fmtS((x.ms - ctx.start) / 1000)} — not on the line`,
          l,
        );
  }
}

// ── D28: an avoidance credited for a control that landed elsewhere ──────────

const reach = (spellReach as any).spells as Record<
  string,
  { radiusYards?: number; radiusMods?: Array<{ pct?: number; flat?: number }> }
>;
const CONTROL_AURA_NAMES: Record<string, string[]> = {
  "Capacitor Totem": ["Capacitor Totem", "Static Charge"],
};
const SINGLE_VICTIM = new Set(["Freezing Trap"]);
function maxRadius(castId: string): number {
  const r = reach[castId];
  if (!r?.radiusYards) return 0;
  let v = r.radiusYards;
  for (const m of r.radiusMods ?? []) {
    if (m.pct) v *= 1 + m.pct / 100;
    if (m.flat) v += m.flat;
  }
  return v;
}
function ccAvoidedLandedElsewhere(ctx: IRoundCtx): void {
  const rows = rowsOf(ctx);
  for (const l of ctx.lines) {
    const m =
      /^(\d+:\d\d) {2}\[CC AVOIDED\?\] {3}(\d+)\([^)]*\): (.+?) \(by (\d+)\(.*?\) did not land; (.+)$/.exec(
        l,
      );
    if (!m) continue;
    const p = ctx.unitOfPid(m[2]);
    const caster = ctx.unitOfPid(m[4]);
    if (!p || !caster) continue;
    const s = secOf(m[1]!);
    const control = m[3]!;
    const fromCaster = (guid: string | undefined) =>
      !!guid && ownerOrSelf(ctx, guid) === caster.id;
    const a = ctx.start + s * 1000;
    // `(by X; cast m:ss)` names the press's own second (a summon's control)
    const castS = /; cast (\d+:\d\d)\) did not land/.exec(l)?.[1];
    const cast = rows
      .filter(
        (r) =>
          r.f[0] === "SPELL_CAST_SUCCESS" &&
          fromCaster(r.f[1]) &&
          nameOf(r.f[9], r.f[10]) === control &&
          (castS !== undefined
            ? Math.floor((r.ms - ctx.start) / 1000) === secOf(castS)
            : r.ms >= a - 3000 && r.ms < a + 2000),
      )
      .pop();
    if (!cast) continue;
    // residual 2026-10-28: the reach reading is an AREA control's (a DB2
    // radius). A targeted control has none — Mortal Coil / Sleep Walk eaten
    // by Grounding (155-2 0:29, 28-1 1:32) read "reach 2.0" — and the
    // product never runs its reach test without one (`inReachOfALanding`:
    // no radius ⇒ no credit through that path).
    const r0 = maxRadius(cast.f[9]!);
    if (r0 === 0) continue;
    ctx.bump("ccAvoidedLandedElsewhere");
    const win = (AOE_CC_LANDING_WINDOW_S as any)[cast.f[9]!]?.toS ?? 3;
    const auraNames = CONTROL_AURA_NAMES[control] ?? [control];
    // residual 2026-10-28: a go-off belongs to THIS press only before the
    // caster's next press of the control — a 60.5 s trap window took the
    // 1:01 trap of the 1:00 press for the 0:34 one (4-3 r3; 44-3, 139-1 ×2,
    // 28-1 alike). The caster's own row: a summon's pulse (Capacitor Totem
    // 118905 after the 192058 press) is this press's effect, no new press.
    const nextPress = rows.find(
      (r) =>
        r.f[0] === "SPELL_CAST_SUCCESS" &&
        r.f[1] === caster.id &&
        r.ms > cast.ms &&
        nameOf(r.f[9], r.f[10]) === control,
    )?.ms;
    const until = Math.min(cast.ms + win * 1000, nextPress ?? Infinity);
    // go-offs: the aura, or a failed-control miss row (the product's
    // `landingsOnOtherUnits` / `firstGoOffMs` read both) — a trap spent on a
    // Grounding Totem (IMMUNE, 4-3 0:36) caught nobody after it
    const goOffs = rows.filter(
      (r) =>
        fromCaster(r.f[1]) &&
        r.ms >= cast.ms - 200 &&
        r.ms <= until &&
        ((r.f[0] === "SPELL_AURA_APPLIED" &&
          auraNames.includes(nameOf(r.f[9], r.f[10]))) ||
          (r.f[0] === "SPELL_MISSED" &&
            nameOf(r.f[9], r.f[10]) === control &&
            CONTROL_FAILED_MISS_TYPES.has(r.f[12] ?? ""))),
    );
    const onP = goOffs.find((r) => r.f[5] === p.id);
    const elsewhereAll = goOffs.filter(
      (r) =>
        r.f[0] === "SPELL_AURA_APPLIED" &&
        r.f[5] !== p.id &&
        (!onP || r.ms < onP.ms),
    );
    const elsewhere = elsewhereAll[0];
    if (!elsewhere) continue;
    // a single-victim trap is spent on its first go-off; an area control
    // catches several, and a player within reach of ANY of them could have
    // been caught (the product's `.some`; 155-6 1:15: Capacitor Totem also
    // stunned a pet, 85-6 1:41 Ring of Frost alike)
    if (SINGLE_VICTIM.has(control) && goOffs[0] !== elsewhere) continue;
    const victims = SINGLE_VICTIM.has(control) ? [elsewhere] : elsewhereAll;
    const limit = SINGLE_VICTIM.has(control) ? r0 + 2 : 2 * r0 + 2;
    const fact = `${p.id}:${Math.round(cast.ms / 100)}`;
    // the product's position reading (`inReachOfALanding`)
    const dists = victims.flatMap((v) => {
      const vu = ctx.units.find((u) => u.id === v.f[5]);
      const pp = getUnitPositionAtTime(p, v.ms, INTERP_MAX_GAP_MS);
      const vp = vu ? getUnitPositionAtTime(vu, v.ms, INTERP_MAX_GAP_MS) : null;
      return pp && vp ? [{ v, d: distanceBetween(pp, vp) }] : [];
    });
    if (dists.length === 0) {
      ctx.violate(
        "ccAvoidedLandedElsewhere",
        "noPosition",
        elsewhere.ms,
        fact,
        `${control} landed on ${elsewhere.f[6]} — no position sample`,
        l,
      );
      continue;
    }
    if (dists.every((x) => x.d > limit)) {
      const near = dists.reduce((m, x) => (x.d < m.d ? x : m));
      ctx.violate(
        "ccAvoidedLandedElsewhere",
        "outOfReach",
        near.v.ms,
        fact,
        `${control} (cast ${fmtS((cast.ms - ctx.start) / 1000)}) landed on ${near.v.f[6]} at ${fmtS((near.v.ms - ctx.start) / 1000)}${victims.length > 1 ? ` (nearest of ${victims.length} victims)` : ""}; ${p.name} was ${near.d.toFixed(1)} yd from it (reach ${limit.toFixed(1)})`,
        l,
      );
    }
  }
}

// ── D31: buffs one purge press removes ──────────────────────────────────────

interface IPress {
  src: string;
  tool: string;
  dest: string;
  ms: number;
  buffs: string[];
  /** how many of `buffs` the legend's N counts (official Magic, not
   *  UNPURGEABLE_MAGIC_AURAS) — what `k` is defined over */
  counted: number;
  /** the distinct purgeable buffs removed (k counts buffs, not rows —
   * codex F20-30) */
  countedIds: Set<string>;
  /** an Improved Spellsteal repeat: its own removal, never merged with a
   * direct one in either order (codex F20-30) */
  repeat: boolean;
}
/** a "remove all" tool (DB2 Effect 38 base points 100: Mass Dispel 32375 /
 *  32592) — the legend's per-tool count leaves it out on purpose (it is not
 *  a purge aimed at one buff), so its multi-removal presses do not make the
 *  legend wrong (wide residual 2026-10-29: 67-6 1:33, keyed on the name
 *  once 39897 + 32592 became one press) */
const REMOVE_ALL_TOOLS: ReadonlySet<string> = new Set(["Mass Dispel"]);
/** Kleptomania 198100's periodic steal: each tick is its own removal */
const KLEPTOMANIA_TICK_ID = "1231112";
const SPELLSTEAL_ID = "30449";
/** Improved Spellsteal 1270827's pending repeat (DB2 duration 4 s) */
const SPELLSTEAL_REPEAT_AURA_ID = "1270828";
const SPELLSTEAL_REPEAT_MS = 4000;
function pressesOf(ctx: IRoundCtx): IPress[] {
  const groups = new Map<string, IPress[]>();
  const rows = rowsOf(ctx);
  // wide residual 2026-10-29: Improved Spellsteal steals again 4 s after a
  // press (1270828 runs out) — d7fcb865 r4 1:09: press 49.576 steals Mark of
  // the Wild, the previous press's (45.587) repeat takes Void Shield at
  // 49.586. A 30449 steal with no own 30449 SUCCESS at its instant, 4 s ±
  // 100 ms after a 1270828 APPLIED/REFRESH of that source on that target, is
  // that repeat: a removal of its own, not part of the next press.
  const repeatAnchors = rows.filter(
    (r) =>
      (r.f[0] === "SPELL_AURA_APPLIED" || r.f[0] === "SPELL_AURA_REFRESH") &&
      r.f[9] === SPELLSTEAL_REPEAT_AURA_ID,
  );
  const ownPress = rows.filter(
    (r) => r.f[0] === "SPELL_CAST_SUCCESS" && r.f[9] === SPELLSTEAL_ID,
  );
  const isRepeat = (r: IRow) =>
    r.f[9] === SPELLSTEAL_ID &&
    !ownPress.some(
      (c) =>
        c.f[1] === r.f[1] && c.f[5] === r.f[5] && Math.abs(c.ms - r.ms) <= 5,
    ) &&
    repeatAnchors.some(
      (a) =>
        a.f[1] === r.f[1] &&
        a.f[5] === r.f[5] &&
        Math.abs(r.ms - a.ms - SPELLSTEAL_REPEAT_MS) <= 100,
    );
  for (const r of rows) {
    if (r.f[0] !== "SPELL_DISPEL" && r.f[0] !== "SPELL_STOLEN") continue;
    // keyed on the tool's NAME: Mass Dispel logs its immunity removal as
    // 39897 and the rest as 32592 in one press (653da914 r6 1:33)
    const tool = nameOf(r.f[9], r.f[10]);
    const k = `${r.f[1]}|${tool}|${r.f[5]}`;
    const list = groups.get(k) ?? [];
    const last = list[list.length - 1];
    const buff = nameOf(r.f[12], r.f[13]);
    const purgeable =
      getDispelType(r.f[12] ?? "") === "Magic" &&
      !UNPURGEABLE_MAGIC_AURAS.has(r.f[12] ?? "");
    const repeat = isRepeat(r);
    if (
      last &&
      r.ms - last.ms <= 300 &&
      r.f[9] !== KLEPTOMANIA_TICK_ID &&
      !repeat &&
      !last.repeat
    ) {
      last.buffs.push(buff);
      if (purgeable) last.countedIds.add(r.f[12] ?? "");
      last.counted = last.countedIds.size;
    } else
      list.push({
        src: r.f[1]!,
        tool,
        dest: r.f[5]!,
        ms: r.ms,
        buffs: [buff],
        counted: purgeable ? 1 : 0,
        countedIds: new Set(purgeable ? [r.f[12] ?? ""] : []),
        repeat,
      });
    groups.set(k, list);
  }
  return [...groups.values()].flat();
}

function purgeRemovalCount(ctx: IRoundCtx): void {
  const presses = pressesOf(ctx);
  const sec = (ms: number) => Math.floor((ms - ctx.start) / 1000);
  let renderedMulti = "";
  const multiTools: string[] = [];
  for (const l of ctx.lines) {
    const pm =
      /^(\d+:\d\d) {2}\[PURGE\] {3}(\d+)\([^)]*\)(?:'s \w+)? purged (.*) \(([^()]+)\)$/.exec(
        l,
      );
    const om =
      /^(\d+:\d\d) {2}\[YOU\] \[CAST\] {3}(.+?)(?: → (\d+)\(| \(|\s\[).*\[removed: (.+?) — (\d+) of (\d+) /.exec(
        l,
      );
    const entries: Array<{
      s: number;
      actor: any;
      tool: string;
      buff: string;
      target: any;
      k: number;
    }> = [];
    if (pm) {
      const actor = ctx.unitOfPid(pm[2]);
      for (const part of pm[3]!.split(/(?<=on it\)), /)) {
        const e = /^(.+?) off (\d+)\([^)]*\) \((\d+) of (\d+) purgeable/.exec(
          part,
        );
        if (e)
          entries.push({
            s: secOf(pm[1]!),
            actor,
            tool: pm[4]!,
            buff: e[1]!,
            target: ctx.unitOfPid(e[2]),
            k: +e[3]!,
          });
      }
    } else if (om)
      entries.push({
        s: secOf(om[1]!),
        actor: ctx.owner,
        tool: om[2]!.trim(),
        buff: om[4]!.split(", ")[0]!,
        target: om[3] ? ctx.unitOfPid(om[3]) : undefined,
        k: +om[5]!,
      });
    for (const e of entries) {
      if (!e.actor) continue;
      const press = presses.find(
        (p) =>
          ownerOrSelf(ctx, p.src) === e.actor.id &&
          p.tool === e.tool &&
          (!e.target || p.dest === e.target.id) &&
          Math.abs(sec(p.ms) - e.s) <= 1 &&
          p.buffs.includes(e.buff),
      );
      if (!press) continue;
      ctx.bump("purgeRemovalCount");
      if (press.counted >= 2 && !renderedMulti)
        renderedMulti = `${e.tool} at ${fmtS(e.s)} removed ${press.buffs.join(" + ")}`;
      if (
        press.counted >= 2 &&
        !REMOVE_ALL_TOOLS.has(e.tool) &&
        !multiTools.includes(e.tool)
      )
        multiTools.push(e.tool);
      if (Math.max(1, press.counted) !== e.k)
        ctx.violate(
          "purgeRemovalCount",
          `perPress:${e.tool}`,
          press.ms,
          `${press.src}:${press.dest}:${press.ms}:${e.buff}`,
          `${fmtS(e.s)} ${e.tool} on ${e.target?.name ?? "?"}: printed ${e.k} for ${e.buff}, the press removed ${press.counted} purgeable (${press.buffs.join(", ")})`,
          l,
        );
    }
  }
  // the purge legend, in either wording (residual 2026-10-28: keyed on the
  // old "A purge removes ONE of them" alone, the check left the denominator
  // with the wording — 1,797 legend bumps of 4,946 — while the per-press
  // entries stayed 3,149 on both sides). The new wording names the tools that
  // remove more than one; a multi-removal press of another tool is wrong too.
  if (ctx.lines.some((l) => /`N purgeable buffs on it then`/.test(l))) {
    ctx.bump("purgeRemovalCount");
    const oldOne =
      ctx.lines.some((l) => /A purge removes/.test(l)) &&
      ctx.lines.some((l) => /\bONE of them\b/.test(l));
    const named = ctx.lines
      .join("\n")
      .match(/\(1 for most purges, \d+ for ([^)]*)\)/)?.[1];
    const namedTools = named
      ? named.split(/, | and /).map((x) => x.trim())
      : [];
    const unnamedMulti = multiTools.find((t) => !namedTools.includes(t));
    if (oldOne && renderedMulti)
      ctx.violate(
        "purgeRemovalCount",
        "legend",
        ctx.start,
        "legend",
        `legend says one purge removes ONE buff; ${renderedMulti}`,
      );
    else if (!oldOne && unnamedMulti)
      ctx.violate(
        "purgeRemovalCount",
        "legend",
        ctx.start,
        "legend",
        `legend names ${named ?? "no multi-removal tool"}; ${unnamedMulti} removed ≥ 2 with one press`,
      );
  }
  // the menu's missed-purge definition. The findings file holds the menu,
  // not the type definitions (GH #167: keyed on the definition's old "a
  // purge removes ONE of them" in it, the check never ran on either
  // corpus); the definition prints `PURGE_PRESS_REMOVALS_TEXT`, so with
  // the type on the menu that is the text read — every tool a purger of
  // the owner's team removed ≥ 2 with in one press must be named in it.
  // A purge is an enemy's buffs taken: a cleanse of the purger's own side
  // (Purify off a teammate) is no purge press (codex 20-G167-03).
  if (/"missed-purge"/.test(ctx.menu)) {
    ctx.bump("purgeRemovalCount");
    const team = String(ctx.owner.info?.teamId);
    const multi = presses.find(
      (p) =>
        p.counted >= 2 &&
        !REMOVE_ALL_TOOLS.has(p.tool) &&
        teamOf(ctx, ownerOrSelf(ctx, p.src)) === team &&
        teamOf(ctx, p.dest) !== undefined &&
        teamOf(ctx, p.dest) !== team &&
        !purgeTextNames(p.tool),
    );
    if (multi)
      ctx.violate(
        "purgeRemovalCount",
        "menuDefinition",
        multi.ms,
        "menu",
        `missed-purge definition (${PURGE_PRESS_REMOVALS_TEXT}) leaves out ${multi.tool}; at ${fmtS(sec(multi.ms))} it removed ${multi.buffs.join(" + ")}`,
      );
  }
}

/** Does the purge-count wording name this tool among the multi-removal
 * ones (`2 for Greater Purge and Fire Breath`)? */
function purgeTextNames(tool: string): boolean {
  return PURGE_PRESS_REMOVALS_TEXT.split(/, | and | for /).includes(tool);
}

// ── entry ───────────────────────────────────────────────────────────────────

export function run(ctx: IRoundCtx): void {
  const infos = unitInfos(ctx);
  const rows = resRows(ctx);
  overrideVariantPressMissing(ctx, infos);
  resEnemyDuplicateWindow(ctx, rows, infos);
  resEnemySameSecondPressMissing(ctx, rows);
  groundingAteOmitted(ctx);
  ccAvoidedLandedElsewhere(ctx);
  purgeRemovalCount(ctx);
}

export function report(): string[] {
  return variantSource ? [`singles2 override variants: ${variantSource}`] : [];
}

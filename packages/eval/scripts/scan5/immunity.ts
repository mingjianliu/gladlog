/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (auraEvents, missesIn, damageIn, spellCastEvents) */
/**
 * scan5/immunity.ts — the fact class "is the target immune at this instant"
 * (fact6 F20 research/immunity.md; D8, D14, D17). Every reader that claims a
 * target was or was not immune is checked against one truth read off the
 * round's own rows — never through the product's immunity sets
 * (`ENEMY_IMMUNITY_SAVE_AURAS`, `KW_UNTARGETABLE_AURA_IDS`,
 * `auraBlocksMechanic`, `CC_AVOIDANCE_BUFF_SPELLS`, `immunityCoversSpell`,
 * `MITIGATION_TABLE` pct-100 rows).
 *
 * TRUTH, per round:
 *  - aura runs on every player: its own APPLIED / REFRESH → REMOVED rows; a
 *    run the log never closes ends at the holder's first own successful cast
 *    or own non-periodic hit after it went up (an unseen carrier), else at the
 *    round's end (`inferred`).
 *  - the round's immunity set T — a Curated-List FORWARD check: every
 *    non-periodic `*_MISSED … IMMUNE` row on a player from the other side
 *    (srcFlags / destFlags hostile bits differ), explained by a greedy cover
 *    over the auras up on the victim at that row. Candidates are limited to
 *    auras with an official immunity row (DB2 aura 39 `immuneSchools`, aura 77
 *    `immuneMech` / immune-all, `spellSchoolsGenerated` /
 *    `spellMechanicsGenerated` — lookups) or a signed form (Spirit of
 *    Redemption 27827 / 215769, Mass Invisibility 414664, Phase Shift 408558,
 *    Vanish 11327, Burrow 409293); co-occurring passives (Stretch Time, poisons,
 *    Sign of the Explorer) never enter. An aura's damage cover = its official
 *    school mask (immune-all / a signed form: every school) minus every school
 *    of which a direct (non-periodic) hostile hit LANDED on a carrier at least
 *    1 s into a run of it this round (Cloak of Shadows' DB2 127, inherited
 *    from its 1 s trigger 35729, comes out 0x7e once a physical hit lands); its
 *    control cover = its official mechanic immunities. A miss is explained by
 *    an aura when the miss's school lies inside the damage cover, or the miss
 *    is a control (DB2 DiminishType stun / incapacitate / disorient /
 *    silence) whose mechanic the aura lists. An aura enters T when it
 *    explains ≥ `MIN_EXPLAINED` of the misses still unexplained; the most
 *    explaining first. Spirit of Redemption (both forms) is a full immunity
 *    by the user's statement (2026-10-28: "both forms count as full immunity
 *    in game") and is always in T — a priest in the form is rarely shot at,
 *    so a round seldom has its rows (c992ce75: none).
 *  - a REFUSED press: a player's SPELL_CAST_SUCCESS on an enemy player with a
 *    non-periodic IMMUNE miss row of the same spell id, same source, same
 *    dest, in [cast − 0.1 s, cast + 2.5 s] and before that source's next cast
 *    of the spell, and no damage row of that id from that source on that dest
 *    in [cast, cast + 2.5 s].
 *
 * CHECKS (rendered lines are the context timeline, `ctx.lines`):
 *  - `immunityCcBookmark` (A, D8): `m:ss–m:ss  [CC BOOKMARK]  X → N(Spec):` —
 *    the legend says the target was "not immune" on every second of the
 *    span. Violation: a T aura covering X (school from the owner's own cast
 *    row of X, else DB2; mechanic from DB2) on the target overlaps [s, s+1)
 *    for some s of the span (the render-second policy the bookmark claims).
 *    Kind = the aura.
 *  - `immunityPeelOption` (B): `m:ss–m:ss  [PEEL OPTION]  N(Spec) X → M(Spec)…:
 *    usable K s` — K above the span's seconds minus the seconds a covering T
 *    aura overlapped.
 *  - `immunityBurstAnchor` (D, D14): `[a–b] on NAME — X burst (` (KILL
 *    ATTEMPTS; ` (cast into …)` stripped) — every team press of X aimed at
 *    the target in [a − 3 s, b + 1 s] was refused. Lines whose X has no press
 *    aimed at the target are not checked (named off a hit of its effect).
 *  - `immunityPressTag` (E, D14): every refused press of a player of the
 *    owner's side whose `[YOU]` / `[TEAM]` `[CD]` / `[CC]` / `[CAST]` /
 *    `[PROC]` line (its second, its caster, its English name) lacks
 *    `[IMMUNE`. Kind `no press line` (out of the total): the press prints no
 *    such line (a control the timeline states as `[CC NOT LANDED]`).
 *  - `immunityEnemyDef` (F, D17): every run ≥ 1 s of a T aura with a damage
 *    cover, on an ENEMY player, put up by the enemy side (our own Cyclone is
 *    no defensive of theirs), started inside the round, with ≥ 1 IMMUNE row
 *    of our side's inside it — and no `m:ss  [ENEMY DEF]` line within ±1 s of
 *    its start naming the aura and the carrier's pid (self line or `→ pid`).
 *  - `immunityDefenseless` (G): `(defenseless a–b)` of a `[KILL WINDOW]`, or a
 *    `[VULNERABLE] a–b … no major defensives` — a T aura with a damage cover
 *    (magic-only Peaceweaver included: user ruling 3, 2026-10-28) on the
 *    target overlapping the span's interior (a + 1 s … b s): the render floor
 *    makes a span opening in the second an immunity ended (or closing in the
 *    second one began) no contradiction.
 *  - `immunityHealerReady` (H): `[CONTESTED] a–b (…): X ready on enemy healer
 *    NAME` / `[OPPORTUNITY] m:ss (slack Ns): X ready; enemy healer NAME` —
 *    the healer under a T aura covering X for every whole second of the span
 *    (floor convention as G).
 *
 * Exclusions: misses and hits outside [round start, end of play]; periodic
 * rows (a DoT tick says nothing of a press); runs longer than 30 s (passives)
 * never explain a miss.
 */
import { DR_CATEGORIES_GENERATED } from "@gladlog/analysis/src/data/drCategoriesGenerated";
import mechanicsRaw from "@gladlog/analysis/src/data/spellMechanicsGenerated.json";
import schoolsRaw from "@gladlog/analysis/src/data/spellSchoolsGenerated.json";

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
  "immunityCcBookmark",
  "immunityPeelOption",
  "immunityBurstAnchor",
  "immunityPressTag",
  "immunityEnemyDef",
  "immunityDefenseless",
  "immunityHealerReady",
] as const;

export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "immunityPressTag|no press line",
]);

const MECH = (
  mechanicsRaw as unknown as {
    spells: Record<
      string,
      { mech?: number; immuneAll?: boolean; immuneMech?: number[] } | undefined
    >;
  }
).spells;
const SPELL_SCHOOLS_GENERATED = schoolsRaw as unknown as Record<
  string,
  { school?: number; immuneSchools?: number } | undefined
>;
const ALL = 0x7f;
const PHYS = 0x01;
const MIN_EXPLAINED = 2;
const PASSIVE_RUN_MS = 30_000;
const LANDED_AFTER_MS = 1000;
const PRESS_MISS_LEAD_MS = 100;
const PRESS_MISS_WINDOW_MS = 2500;
/** signed forms the product reads as immunities with no (or a partial) DB2
 * immunity row — candidates only; they enter T on the round's own rows */
const SIGNED_FORMS = new Set([
  "27827",
  "215769",
  "414664",
  "408558",
  "11327",
  "409293",
]);
/** the user's statement (2026-10-28): both Spirit of Redemption forms are a
 * full immunity in game — in T whatever the round's rows */
const ALWAYS_FULL = new Set(["27827", "215769"]);
const CONTROL_IDS = new Set<string>(
  ["stun", "incapacitate", "disorient", "silence"].flatMap(
    (c) => DR_CATEGORIES_GENERATED[c] ?? [],
  ),
);
const PERIODIC_MISS = "SPELL_PERIODIC_MISSED";
const PERIODIC_DMG = "SPELL_PERIODIC_DAMAGE";

const hostileBit = (f: unknown) => (Number(f) & 0x40) !== 0;
const crossSide = (r: any) =>
  hostileBit(r.srcUnitFlags) !== hostileBit(r.destUnitFlags);
/** the school a row states (`0x..` at params[10]); a swing is physical */
function rowSchool(r: any): number | undefined {
  if (ev(r) === "SWING_MISSED" || ev(r) === "SWING_DAMAGE") return PHYS;
  const p = r.logLine?.parameters?.[10];
  if (typeof p === "string" && /^0x/i.test(p)) return parseInt(p, 16);
  return SPELL_SCHOOLS_GENERATED[String(r.spellId)]?.school;
}
const schoolInside = (s: number | undefined, mask: number) =>
  s !== undefined && s !== 0 && (s & ~mask) === 0;

interface IRun {
  auraId: string;
  from: number;
  to: number;
  srcId: string;
  inferred: boolean;
}
interface ICover {
  mask: number;
  mechs: "all" | number[];
}

/** a unit's aura runs, by its own rows */
function runsOf(u: any, ctx: IRoundCtx): IRun[] {
  const out: IRun[] = [];
  const open = new Map<string, { from: number; srcId: string }>();
  const evs = ((u.auraEvents ?? []) as any[])
    .filter((a) => a.destUnitId === u.id && a.spellId)
    .sort((a, b) => tsOf(a) - tsOf(b));
  // the holder's own acts (a successful cast, a non-periodic hit it dealt):
  // what ends a run whose REMOVED the log never wrote
  const acts = [
    ...successesOf(u).map(tsOf),
    ...((u.damageOut ?? []) as any[])
      .filter(
        (d) =>
          d.srcUnitId === u.id &&
          ev(d) !== PERIODIC_DMG &&
          ev(d) !== "SPELL_ABSORBED",
      )
      .map(tsOf),
  ].sort((x, y) => x - y);
  const unseenEnd = (from: number, cap: number) =>
    Math.min(acts.find((t) => t > from + 150) ?? cap, cap);
  /** a press of this aura's id by the APPLIED row's source at that row */
  const pressedAt = (a: any, id: string, t: number) => {
    const src = ctx.units.find((x) => x.id === a.srcUnitId);
    return (
      !!src &&
      successesOf(src).some(
        (c) => String(c.spellId) === id && Math.abs(tsOf(c) - t) <= 500,
      )
    );
  };
  for (const a of evs) {
    const id = String(a.spellId);
    const t = tsOf(a);
    const e = ev(a);
    if (e === APPLIED) {
      const o = open.get(id);
      // an APPLIED of an aura already up with no press behind it is the
      // server re-sending the holder's auras (a stealth / Mass Invisibility
      // flag change re-lists every buff: s1/63-4 Divine Shield 57.4 s
      // re-APPLIED 60.2 s, REMOVED 65.4 s) — the same run (within a
      // passive's length; later, a new application of an unclosed run)
      if (o && !pressedAt(a, id, t) && t - o.from <= PASSIVE_RUN_MS) continue;
      // a new press (or a late re-application) over a run the log never
      // closed: that run's end went unwritten (s1/110-6 Mass Invisibility
      // 44.2 s, re-pressed 173.1 s)
      if (o)
        out.push({
          auraId: id,
          from: o.from,
          to: unseenEnd(o.from, t),
          srcId: o.srcId,
          inferred: true,
        });
      open.set(id, { from: t, srcId: a.srcUnitId });
    } else if (e === REFRESH) {
      if (!open.has(id)) open.set(id, { from: t, srcId: a.srcUnitId });
    } else if (e === REMOVED) {
      const o = open.get(id);
      open.delete(id);
      out.push({
        auraId: id,
        from: o?.from ?? ctx.start,
        to: t,
        srcId: o?.srcId ?? a.srcUnitId,
        inferred: false,
      });
    }
  }
  for (const [id, o] of open)
    out.push({
      auraId: id,
      from: o.from,
      to: unseenEnd(o.from, ctx.end),
      srcId: o.srcId,
      inferred: true,
    });
  return out;
}

function officialCover(id: string): ICover | undefined {
  const m = MECH[id];
  const sch = SPELL_SCHOOLS_GENERATED[id]?.immuneSchools;
  if (m?.immuneAll || SIGNED_FORMS.has(id)) return { mask: ALL, mechs: "all" };
  if (sch !== undefined || (m?.immuneMech?.length ?? 0) > 0)
    return { mask: sch ?? 0, mechs: m?.immuneMech ?? [] };
  return undefined;
}

interface IRoundTruth {
  runsByUnit: Map<string, IRun[]>;
  T: Map<string, ICover>;
  derived: Map<string, number>;
}

function deriveTruth(ctx: IRoundCtx): IRoundTruth {
  const runsByUnit = new Map<string, IRun[]>();
  for (const u of ctx.players) runsByUnit.set(u.id, runsOf(u, ctx));
  const inRound = (t: number) => t >= ctx.start && t <= ctx.roundEndAt;
  // the official cover, narrowed by what landed through it this round
  const cover = new Map<string, ICover>();
  const landedSchools = new Map<string, number>();
  for (const u of ctx.players) {
    const runs = runsByUnit.get(u.id)!;
    for (const d of (u.damageIn ?? []) as any[]) {
      const t = tsOf(d);
      if (!inRound(t) || ev(d) === PERIODIC_DMG || !crossSide(d)) continue;
      const s = rowSchool(d);
      if (!s) continue;
      for (const r of runs)
        if (
          r.from + LANDED_AFTER_MS <= t &&
          t <= r.to &&
          r.to - r.from <= PASSIVE_RUN_MS
        )
          landedSchools.set(r.auraId, (landedSchools.get(r.auraId) ?? 0) | s);
    }
  }
  const coverOf = (id: string): ICover | undefined => {
    if (cover.has(id)) return cover.get(id);
    const c = officialCover(id);
    if (!c) return undefined;
    const landed = ALWAYS_FULL.has(id) ? 0 : (landedSchools.get(id) ?? 0);
    const out: ICover = { mask: c.mask & ~landed, mechs: c.mechs };
    cover.set(id, out);
    return out;
  };
  // the round's IMMUNE rows and the candidates that could explain each
  const misses: Array<Set<string>> = [];
  for (const u of ctx.players) {
    const runs = runsByUnit.get(u.id)!;
    for (const m of (u.missesIn ?? []) as any[]) {
      const t = tsOf(m);
      if (
        m.missType !== "IMMUNE" ||
        ev(m) === PERIODIC_MISS ||
        !inRound(t) ||
        !crossSide(m)
      )
        continue;
      const s = rowSchool(m);
      const id = String(m.spellId);
      const mech = CONTROL_IDS.has(id) ? MECH[id]?.mech : undefined;
      const can = new Set<string>();
      for (const r of runs) {
        if (r.from > t || t > r.to || r.to - r.from > PASSIVE_RUN_MS) continue;
        const c = coverOf(r.auraId);
        if (!c) continue;
        if (
          schoolInside(s, c.mask) ||
          (mech !== undefined && (c.mechs === "all" || c.mechs.includes(mech)))
        )
          can.add(r.auraId);
      }
      misses.push(can);
    }
  }
  const T = new Map<string, ICover>();
  const derived = new Map<string, number>();
  let left = misses;
  for (;;) {
    const n = new Map<string, number>();
    for (const c of left) for (const a of c) n.set(a, (n.get(a) ?? 0) + 1);
    const best = [...n].sort(
      (x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1),
    )[0];
    if (!best || best[1] < MIN_EXPLAINED) break;
    T.set(best[0], coverOf(best[0])!);
    derived.set(best[0], best[1]);
    left = left.filter((c) => !c.has(best[0]));
  }
  for (const id of ALWAYS_FULL) T.set(id, { mask: ALL, mechs: "all" });
  return { runsByUnit, T, derived };
}

/** the school and mechanic of a spell the line names, by its English name:
 * the caster's own cast row first, else any player's, else unknown */
function spellFacts(
  ctx: IRoundCtx,
  name: string,
  caster: any,
): { school?: number; mech?: number; ids: Set<string> } {
  const ids = new Set<string>();
  let school: number | undefined;
  for (const u of [caster, ...ctx.players].filter(Boolean))
    for (const c of successesOf(u))
      if (nameOf(c.spellId, c.spellName) === name) {
        ids.add(String(c.spellId));
        school ??= rowSchool(c);
      }
  let mech: number | undefined;
  for (const id of ids) mech ??= MECH[id]?.mech;
  return {
    ...(school !== undefined ? { school } : {}),
    ...(mech !== undefined ? { mech } : {}),
    ids,
  };
}

const coversControl = (c: ICover, f: { school?: number; mech?: number }) =>
  (f.school !== undefined ? schoolInside(f.school, c.mask) : c.mask === ALL) ||
  c.mechs === "all" ||
  (f.mech !== undefined && c.mechs.includes(f.mech));

const derivedInventory = new Map<string, { n: number; rounds: number }>();

export function run(ctx: IRoundCtx): void {
  const truth = deriveTruth(ctx);
  if (ctx.firstOwnerOfRound)
    for (const [id, n] of truth.derived) {
      const x = derivedInventory.get(id) ?? { n: 0, rounds: 0 };
      x.n += n;
      x.rounds++;
      derivedInventory.set(id, x);
    }
  const { runsByUnit, T } = truth;
  const rel = (ms: number) => (ms - ctx.start) / 1000;
  const ownerHostile = ctx.owner.reaction;
  const ours = (u: any) => !!u && u.reaction === ownerHostile;
  const tRuns = (u: any, pick: (c: ICover) => boolean) =>
    (runsByUnit.get(u?.id) ?? []).filter((r) => {
      const c = T.get(r.auraId);
      return !!c && pick(c);
    });
  const overlapSec = (r: IRun, s: number) =>
    r.from < ctx.start + (s + 1) * 1000 && ctx.start + s * 1000 < r.to;
  /** a control its carrier put on itself: its own cast reflected back
   * (Spell Reflection on a Cyclone — s0/34-2 Giveer 77.6 s, s0/101-3,
   * s1/184-1). No defensive of theirs and no save they chose: our side's
   * doing, read as our own Cyclone on them is (F / G / H). */
  const reflectedOwn = (r: IRun, u: any) =>
    r.srcId === u?.id && CONTROL_IDS.has(r.auraId);

  /** the second of the press behind a run: a cast of its aura id by its
   * source from 2.5 s before the aura showed (a Blessing of Protection on a
   * stealthed rogue: cast 2:07.9, its aura visible 2:09.2 — s0/135-2) */
  const pressSecOf = (r: IRun): number | undefined => {
    const src = ctx.units.find((x) => x.id === r.srcId);
    if (!src) return undefined;
    const at = successesOf(src)
      .filter(
        (c) =>
          String(c.spellId) === r.auraId &&
          tsOf(c) >= r.from - PRESS_MISS_WINDOW_MS &&
          tsOf(c) <= r.from + 500,
      )
      .map(tsOf)
      .pop();
    return at === undefined ? undefined : Math.floor(rel(at));
  };
  /** the `m:ss  [ENEMY DEF]` line naming this run's aura on its carrier's
   * pid, at the run's start second ±1 or at its press's second */
  const enemyDefLineOf = (
    r: IRun,
    u: any,
  ): { sec: number; line: string } | undefined => {
    const pid = ctx.pidOf(u.name);
    if (!pid) return undefined;
    const name = nameOf(r.auraId, r.auraId);
    const s0 = Math.floor(rel(r.from));
    const ps = pressSecOf(r);
    const secs = new Set([
      s0 - 1,
      s0,
      s0 + 1,
      ...(ps !== undefined ? [ps] : []),
    ]);
    for (const l of ctx.lines) {
      if (!l.includes("[ENEMY DEF]") || !l.includes(name)) continue;
      if (!l.includes(`${pid}(`)) continue;
      const m = /^(\d+:\d\d) {2}/.exec(l);
      if (m && secs.has(secOf(m[1]!))) return { sec: secOf(m[1]!), line: l };
    }
    return undefined;
  };
  /** the run as its `[ENEMY DEF]` line prints it: the line's second plus
   * the printed length (`(… N.Ns`), when the line prints one */
  const renderedSpanOf = (
    r: IRun,
    u: any,
  ): { from: number; to: number } | undefined => {
    const hit = enemyDefLineOf(r, u);
    if (!hit) return undefined;
    const esc = nameOf(r.auraId, r.auraId).replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
    const m = new RegExp(
      `${esc}(?: → \\d+\\([^)]*\\))? \\([^)]*?(\\d+\\.\\d)s`,
    ).exec(hit.line);
    if (!m) return undefined;
    const from = ctx.start + hit.sec * 1000;
    return { from, to: from + Number(m[1]) * 1000 };
  };

  // ── refused presses (D, E) ──
  const refused = (caster: any, c: any): boolean => {
    const t = tsOf(c);
    const id = String(c.spellId);
    const next = successesOf(caster)
      .filter((x) => String(x.spellId) === id && tsOf(x) > t + 5)
      .map(tsOf);
    const miss = ((caster.missesOut ?? []) as any[]).some(
      (m) =>
        m.missType === "IMMUNE" &&
        ev(m) !== PERIODIC_MISS &&
        String(m.spellId) === id &&
        m.destUnitId === c.destUnitId &&
        tsOf(m) >= t - PRESS_MISS_LEAD_MS &&
        tsOf(m) <= t + PRESS_MISS_WINDOW_MS &&
        !next.some((n) => n <= tsOf(m) + PRESS_MISS_LEAD_MS),
    );
    if (!miss) return false;
    return !((caster.damageOut ?? []) as any[]).some(
      (d) =>
        d.srcUnitId === caster.id &&
        String(d.spellId) === id &&
        d.destUnitId === c.destUnitId &&
        tsOf(d) >= t &&
        tsOf(d) <= t + PRESS_MISS_WINDOW_MS,
    );
  };

  const CCB_RE =
    /^(\d+:\d\d)–(\d+:\d\d)\s+\[CC BOOKMARK\]\s+(.+?) → (\d+)\([^)]*\):/;
  const PEEL_RE =
    /^(\d+:\d\d)–(\d+:\d\d)\s+\[PEEL OPTION\]\s+(\d+)\([^)]*\) (.+?) → (\d+)\([^)]*\)(?: \(the victim's own CC\))?: usable (\d+) s/;
  const KA_RE = /^\s+\[(\d+:\d\d)–(\d+:\d\d)\] on (.+?) — (.+?) burst \(/;
  const KW_RE =
    /^\s+\[(KILL WINDOW|VULNERABLE)\] (\d+:\d\d)–(\d+:\d\d) on [^(]+\(([^)]+)\)(.*)$/;
  const CONT_RE =
    /^\s+\[CONTESTED\] (\d+:\d\d)–(\d+:\d\d) \([^)]*\): (.+?) ready on enemy healer (\S+) /;
  const OPP_RE =
    /^\s+\[OPPORTUNITY\] (\d+:\d\d) \(slack (\d+)s\): (.+?) ready; enemy healer (\S+) /;
  const seenSpan = new Set<string>();

  for (const l of ctx.lines) {
    // A / B
    const a = CCB_RE.exec(l);
    const p = a ? null : PEEL_RE.exec(l);
    if (a || p) {
      const from = secOf((a ?? p)![1]!);
      const to = secOf((a ?? p)![2]!);
      const caster = a ? ctx.owner : ctx.unitOfPid(p![3]);
      const spell = a ? a[3]! : p![4]!;
      const target = ctx.unitOfPid(a ? a[4] : p![5]);
      if (!target) continue;
      const f = spellFacts(ctx, spell, caster);
      const runs = tRuns(target, (c) => coversControl(c, f));
      const bad: number[] = [];
      for (let s = from; s <= to; s++)
        if (runs.some((r) => overlapSec(r, s))) bad.push(s);
      const auras = [
        ...new Set(
          runs
            .filter((r) => bad.some((s) => overlapSec(r, s)))
            .map((r) => nameOf(r.auraId, r.auraId)),
        ),
      ];
      if (a) {
        ctx.bump("immunityCcBookmark");
        if (bad.length > 0)
          ctx.violate(
            "immunityCcBookmark",
            auras.join(" + "),
            ctx.start + bad[0]! * 1000,
            `${ctx.owner.name}:${target.name}:${spell}:${from}-${to}`,
            `${spell} → ${target.name} ${fmtS(from)}–${fmtS(to)}: immune (${auras.join(", ")}) at ${bad.map(fmtS).join(",")}`,
            l,
          );
      } else {
        ctx.bump("immunityPeelOption");
        const usable = Number(p![6]);
        if (bad.length > 0 && usable > to - from + 1 - bad.length)
          ctx.violate(
            "immunityPeelOption",
            auras.join(" + "),
            ctx.start + bad[0]! * 1000,
            `${caster?.name}:${target.name}:${spell}:${from}-${to}`,
            `usable ${usable} s of ${to - from + 1}, immune (${auras.join(", ")}) at ${bad.map(fmtS).join(",")}`,
            l,
          );
      }
      continue;
    }
    // D
    const k = KA_RE.exec(l);
    if (k) {
      const from = secOf(k[1]!);
      const to = secOf(k[2]!);
      const target = ctx.byName.get(k[3]!);
      const anchor = k[4]!.replace(/ \(cast into .*\)$/, "");
      if (!target) continue;
      const presses: Array<{ u: any; c: any }> = [];
      for (const u of ctx.players.filter(ours))
        for (const c of successesOf(u))
          if (
            c.destUnitId === target.id &&
            nameOf(c.spellId, c.spellName) === anchor &&
            rel(tsOf(c)) >= from - 3 &&
            rel(tsOf(c)) <= to + 1
          )
            presses.push({ u, c });
      if (presses.length === 0) continue;
      ctx.bump("immunityBurstAnchor");
      // …and none of its own hits landed on the target later: a hit of the
      // same name from the caster (its effect under another id — Takedown
      // 1250646 refused, its leap 1253859 hit, s0/167-2 1:33; a Frozen Orb
      // tick at +2.5 s, s2/166-1 0:29) before the caster's next press of it,
      // inside the bracket and its 5 s after
      const landedAnyway = (u: any, c: any) => {
        const t = tsOf(c);
        const next =
          successesOf(u)
            .filter(
              (x) =>
                nameOf(x.spellId, x.spellName) === anchor && tsOf(x) > t + 5,
            )
            .map(tsOf)[0] ?? Infinity;
        const hi = Math.min(next, ctx.start + (to + 5) * 1000);
        return ((u.damageOut ?? []) as any[]).some(
          (d) =>
            d.destUnitId === target.id &&
            nameOf(d.spellId, d.spellName) === anchor &&
            tsOf(d) >= t &&
            tsOf(d) <= hi,
        );
      };
      if (presses.every(({ u, c }) => refused(u, c) && !landedAnyway(u, c)))
        ctx.violate(
          "immunityBurstAnchor",
          anchor,
          tsOf(presses[0]!.c),
          `${target.name}:${from}-${to}`,
          `${anchor} burst on ${target.name}: every press (${presses.map(({ c }) => fmtS(rel(tsOf(c)))).join(",")}) logged IMMUNE on it`,
          l,
        );
      continue;
    }
    // G
    const w = KW_RE.exec(l);
    if (w) {
      const target = ctx.byName.get(w[4]!);
      const dl = /\(defenseless (\d+:\d\d)–(\d+:\d\d)\)/.exec(w[5]!);
      let from: number;
      let to: number;
      if (dl) {
        from = secOf(dl[1]!);
        to = secOf(dl[2]!);
      } else if (w[1] === "VULNERABLE" && /no major defensives/.test(w[5]!)) {
        from = secOf(w[2]!);
        to = secOf(w[3]!);
      } else continue;
      if (!target) continue;
      const sk = `${target.id}:${from}:${to}`;
      if (seenSpan.has(sk)) continue;
      seenSpan.add(sk);
      ctx.bump("immunityDefenseless");
      const lo = ctx.start + (from + 1) * 1000;
      const hi = ctx.start + to * 1000;
      for (const r of tRuns(target, (c) => c.mask !== 0)) {
        if (reflectedOwn(r, target)) continue;
        // the span is cut on the save's `[ENEMY DEF]` line as printed — its
        // second plus its printed length (the product's
        // `renderedExternalSpanS`, Shared-Predicate: anchored to the rendered
        // value): s0/161-6 `1:44 … Blessing of Protection → 5(BDruid) (2.3s —
        // dispelled …)` ends 1:46.3 on the page, 1:47.013 in the log, and
        // `defenseless 1:46–2:05` opens on the page's end
        const shown = renderedSpanOf(r, target);
        const upFrom = shown?.from ?? r.from;
        const upTo = shown?.to ?? r.to;
        if (
          upFrom < hi &&
          upTo > lo &&
          r.to - r.from >= 1000 &&
          !ours(ctx.units.find((u) => u.id === r.srcId))
        )
          ctx.violate(
            "immunityDefenseless",
            nameOf(r.auraId, r.auraId),
            r.from,
            `${sk}:${r.auraId}:${r.from}`,
            `${target.name} defenseless ${fmtS(from)}–${fmtS(to)}: ${nameOf(r.auraId, r.auraId)} up ${rel(r.from).toFixed(1)}–${rel(r.to).toFixed(1)}`,
            l,
          );
      }
      continue;
    }
    // H
    const h = CONT_RE.exec(l);
    const o = h ? null : OPP_RE.exec(l);
    if (h || o) {
      const from = secOf((h ?? o)![1]!);
      const to = h ? secOf(h[2]!) : from + Number(o![2]);
      const spell = (h ?? o)![3]!;
      const healer = ctx.byName.get((h ?? o)![4]!);
      if (!healer) continue;
      ctx.bump("immunityHealerReady");
      const f = spellFacts(ctx, spell, ctx.owner);
      const runs = tRuns(healer, (c) => coversControl(c, f)).filter(
        (r) => !reflectedOwn(r, healer),
      );
      const whole = (s: number) =>
        runs.some(
          (r) =>
            r.from <= ctx.start + s * 1000 &&
            ctx.start + (s + 1) * 1000 <= r.to,
        );
      let all = to > from;
      for (let s = from; s < to; s++) if (!whole(s)) all = false;
      if (all)
        ctx.violate(
          "immunityHealerReady",
          spell,
          ctx.start + from * 1000,
          `${ctx.owner.name}:${healer.name}:${spell}:${from}-${to}`,
          `${spell} ready on ${healer.name} ${fmtS(from)}–${fmtS(to)}: immune throughout`,
          l,
        );
    }
  }

  // ── E: refused presses and their press lines ──
  const enemyIds = new Set(
    ctx.players.filter((u) => !ours(u)).map((u) => u.id),
  );
  for (const u of ctx.players.filter(ours)) {
    const label =
      u.id === ctx.owner.id ? "[YOU]" : `${ctx.pidOf(u.name) ?? "?"}(`;
    for (const c of successesOf(u)) {
      const t = tsOf(c);
      if (t < ctx.start || t > ctx.roundEndAt || !enemyIds.has(c.destUnitId))
        continue;
      if (!refused(u, c)) continue;
      ctx.bump("immunityPressTag");
      const name = nameOf(c.spellId, c.spellName);
      const sec = fmtS(rel(t));
      // the name as a whole word: "Devour" is no part of "(Devourer Demon
      // Hunter)" (F20 wide residual, s2/34-20 0:34: a Blur line read as the
      // Devour press's)
      const nameRe = new RegExp(
        `(?<![\\p{L}\\p{N}'])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}'])`,
        "u",
      );
      const pressLines = ctx.lines.filter(
        (l) =>
          l.startsWith(`${sec}  `) &&
          /\[(YOU|TEAM)\] \[(CD|CC|CAST|PROC)\]/.test(l) &&
          nameRe.test(l) &&
          (label === "[YOU]"
            ? l.includes("[YOU]")
            : l.includes(`[TEAM]`) && l.includes(` ${label}`)),
      );
      // a spam fold that counts the press beside the press's own per-cast
      // line (`(xN over Ms)` starting at that second) is not its line
      const own = pressLines.filter((l) => !/ \(x\d+ over \d+s\)/.test(l));
      if (own.length > 0) pressLines.splice(0, pressLines.length, ...own);
      const fact = `${u.name}:${t}:${c.spellId}`;
      if (pressLines.length === 0) {
        ctx.violate(
          "immunityPressTag",
          "no press line",
          t,
          fact,
          `${u.name} ${name} at ${sec} refused IMMUNE; no press line`,
        );
        continue;
      }
      for (const pl of pressLines)
        if (!pl.includes("[IMMUNE"))
          ctx.violate(
            "immunityPressTag",
            "press line without [IMMUNE",
            t,
            fact,
            `${u.name} ${name} at ${sec}: its own row logged IMMUNE on ${c.destUnitName}`,
            pl,
          );
    }
  }

  // ── F: an enemy immunity our side ran into, with no [ENEMY DEF] line ──
  for (const u of ctx.players.filter((x) => !ours(x))) {
    const pid = ctx.pidOf(u.name);
    for (const r of tRuns(u, (c) => c.mask !== 0)) {
      if (r.from < ctx.start || r.from > ctx.roundEndAt || r.to - r.from < 1000)
        continue;
      if (reflectedOwn(r, u)) continue;
      const src = ctx.units.find((x) => x.id === r.srcId);
      if (
        ours(src) ||
        (src?.ownerId && ours(ctx.units.find((x) => x.id === src.ownerId)))
      )
        continue;
      const hits = ((u.missesIn ?? []) as any[]).filter(
        (m) =>
          m.missType === "IMMUNE" &&
          ev(m) !== PERIODIC_MISS &&
          crossSide(m) &&
          tsOf(m) >= r.from &&
          tsOf(m) <= r.to,
      ).length;
      if (hits === 0) continue;
      ctx.bump("immunityEnemyDef");
      const name = nameOf(r.auraId, r.auraId);
      const ok = !!pid && enemyDefLineOf(r, u) !== undefined;
      if (!ok)
        ctx.violate(
          "immunityEnemyDef",
          name,
          r.from,
          `${u.name}:${r.auraId}:${r.from}`,
          `${u.name} under ${name} ${rel(r.from).toFixed(1)}–${rel(r.to).toFixed(1)} (${hits} IMMUNE rows of ours), no [ENEMY DEF]`,
        );
    }
  }
}

export function report(): string[] {
  return [
    "immunity: the auras the rounds' IMMUNE rows put in T (forward check; misses explained, rounds):",
    ...[...derivedInventory]
      .sort((a, b) => b[1].n - a[1].n)
      .map(
        ([id, x]) =>
          `  ${id} ${nameOf(id, id)}: ${x.n} misses, ${x.rounds} rounds`,
      ),
  ];
}

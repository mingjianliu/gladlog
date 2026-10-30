/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (auraEvents, spellCastEvents) */
/**
 * scan5/dr.ts — `drReaderAgreement` (fact6 D10 D29): the diminishing-returns
 * level of one control, as EVERY reader of the timeline states it, against
 * the DR the log itself shows.
 *
 * Log truth (rows, not the product's DR walk): per unit, its aura rows (dest
 * = the unit), `auraType` DEBUFF, an id with a DR family in
 * `DR_CATEGORY_MAP` (lookup; `spell:` fallbacks and roots are no family),
 * from EVERY source except a holder-self aura that is not a control
 * (`ccSpellIds`) — a control reflected back onto its caster, a pet's, a
 * teammate's while charmed all count (user default 2026-10-28). One
 * application per `spellId|source`: an APPLIED while it is open is the same
 * application (a re-send) unless its source (or its owner) recast it in
 * between (`castsOfEffectAura` / same name — a lookup) or it ran past its
 * official length; a REMOVED → APPLIED ≤ 50 ms is a re-broadcast (merged);
 * every REFRESH of an open application is a new application, recast or not
 * (the game re-times it at the next tier — F20 dr, measured). It ends at
 * its REMOVED (a BROKEN row names the breaker as source; the REMOVED that
 * follows is the end); never closed → its official length, cut at the
 * round's end. Chain per family, in landing order: an application joins the
 * chain when it lands before the chain's end (the MAX end of its members) +
 * the reset (`drResetMsAt`, imported constant; ≥ resets); Full / 50% /
 * Immune for 0 / 1 / ≥ 2 members before it.
 *   Q1 "the DR this application landed at": the applications before it.
 *   Q2 "the DR a control of the family lands at at t": those landed ≤ t.
 *
 * Readers (kinds), each line of the context timeline:
 *  - `ccTag`: `[CC ON TEAM|ENEMY] P ← Spell (by …|reflected back) … [DR: Cat L]`
 *    — Q1 of the application on P of that spell landing in that second.
 *  - `castTag`: `[YOU] [CC] Spell → P … [DR: Cat L]` / `[TEAM] [CC] … cast
 *    Spell → P` and the per-target `[DR: Cat — 4(X) L, 5(Y) L]` — Q1, the
 *    landing in the press second or the next.
 *  - `drClash`: `[DR CLASH] … Spell on P landed at 50%|Immune DR` — Q1.
 *  - `notLanded`: `[CC NOT LANDED] P ← Spell (by …) … (DR: Cat Immune)` —
 *    Q2 somewhere in that second must be Immune.
 *  - `exposure` / `exposureAlreadyIn`: `[HEALER EXPOSURE]` threats `IN LoS:
 *    Spec: Spell L DR, …; …` — Q2 on our healer somewhere in the line's
 *    second; with `healer already in X until`, no earlier than X's landing
 *    (the line says the levels count it). The threat's family by name
 *    (an enemy's logged aura / cast id of that name, else the DR table).
 *  - `peelBookmark`: `[PEEL OPTION]` / `[CC BOOKMARK]` `| at m:ss: …, DR L` — Q2
 *    on the target in that second (the owner's control, family by name).
 *  - `killWindow`: `[KILL WINDOW]` / `[VULNERABLE]` `Spell (enemy healer DR: L)`
 *    — Q2 on the enemy healer in the window's first second.
 *  - `ccBroken`: `[CC BROKEN] … broke …'s Spell on P — Ns of CC wasted` — N
 *    against `ccFullDurationForApplication` (duration lookup: DB2 + caster
 *    talents + Oppressing Roar on the holder at the landing, read here from
 *    the holder's own Roar rows) × the Q1 share − time held; |Δ| > 0.15 s.
 *  - `ccRemoved`: `[CC REMOVED] … removed …'s Spell from P after … (~Ns of
 *    it left)` — the same arithmetic, whole seconds (|Δ| > 0.55 s).
 *
 * Out of the total: `<reader>:unmatched` (no application of that spell on
 * that unit in that second), `<reader>:boundary` (the printed level is the
 * truth at a reset 0.5 s shorter or longer — the server's timer jitters
 * around the cut: fact5 D2 measured the switch across 20.05–20.35 s),
 * `<reader>:unresolved` (a threat / ready control whose family the name does
 * not give), `ccBroken|ccRemoved:noDuration`.
 */
import { castsOfEffectAura } from "@gladlog/analysis/src/data/castEffectAuras";
import {
  ccFullDurationSeconds,
  OPPRESSING_ROAR_AURA_IDS,
  spellEffectData,
} from "@gladlog/analysis/src/data/spellEffectData";
import { ccSpellIds } from "@gladlog/analysis/src/data/spellTags";
import { CAST_ROW_LAG_MAX_MS } from "@gladlog/analysis/src/utils/castRowLag";
import { ccFullDurationForApplication } from "@gladlog/analysis/src/utils/ccDuration";
import { isHealerSpec } from "@gladlog/analysis/src/utils/cooldowns";
import {
  DR_CATEGORY_MAP,
  drCategoryOfCast,
  drResetMsAt,
} from "@gladlog/analysis/src/utils/drAnalysis";

import {
  APPLIED,
  ev,
  fmtS,
  type IRoundCtx,
  nameOf,
  REFRESH,
  REMOVED,
  secOf,
  SUCCESS,
  tsOf,
} from "./ctx";

export const CHECKS = ["drReaderAgreement"] as const;
const C = "drReaderAgreement";
const READERS = [
  "ccTag",
  "castTag",
  "drClash",
  "notLanded",
  "exposure",
  "exposureAlreadyIn",
  "peelBookmark",
  "killWindow",
  "ccBroken",
  "ccRemoved",
];
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set(
  READERS.flatMap((r) => [
    `${C}|${r}:unmatched`,
    `${C}|${r}:boundary`,
    `${C}|${r}:unresolved`,
    `${C}|${r}:noDuration`,
  ]),
);

/** a 0.5 s band either side of the reset: the level there is the server's */
const BOUNDARY_MS = 500;
const REBROADCAST_MS = 50;
const CAST_BACKED_MS = 3000;
const BROKEN = new Set(["SPELL_AURA_BROKEN", "SPELL_AURA_BROKEN_SPELL"]);
type Level = "Full" | "50%" | "Immune";
const SHARE: Record<Level, number> = { Full: 1, "50%": 0.5, Immune: 0 };

interface IApp {
  spellId: string;
  name: string;
  cat: string;
  src: string;
  apply: number;
  end: number;
  /** order on the holder's aura stream (same-ms ties) */
  idx: number;
  brokeAt?: number;
  roar: boolean;
}

/** the DR family name → the ids the table files under it (name lookup) */
let familyByName: Map<string, Set<string>> | undefined;
function familiesOfName(name: string): Set<string> {
  if (!familyByName) {
    familyByName = new Map();
    for (const [id, cat] of Object.entries(DR_CATEGORY_MAP)) {
      const n = nameOf(id, "");
      if (!n) continue;
      const s = familyByName.get(n) ?? new Set<string>();
      s.add(cat);
      familyByName.set(n, s);
    }
  }
  return familyByName.get(name) ?? new Set();
}

function walk(apps: readonly IApp[], t: number, resetMs: number): Level {
  let chain = 0;
  let chainEnd = -Infinity;
  for (const a of apps) {
    if (chain > 0 && a.apply >= chainEnd + resetMs) {
      chain = 0;
      chainEnd = -Infinity;
    }
    chain++;
    chainEnd = Math.max(chainEnd, a.end);
  }
  if (chain === 0 || t >= chainEnd + resetMs) return "Full";
  return chain === 1 ? "50%" : "Immune";
}

export function run(ctx: IRoundCtx): void {
  const RESET = drResetMsAt(ctx.start);
  const unitById = new Map(ctx.units.map((u) => [u.id, u]));
  const castsBy = new Map<string, any[]>();
  const castsOf = (id: string): any[] => {
    let c = castsBy.get(id);
    if (!c) {
      c = ((unitById.get(id)?.spellCastEvents ?? []) as any[]).filter(
        (x) => ev(x) === SUCCESS,
      );
      castsBy.set(id, c);
    }
    return c;
  };
  /** did `src` (or its owner) press a cast that applies `auraId` in (a, b]
   * — or up to `CAST_ROW_LAG_MAX_MS` after b: a press row can be logged
   * after the aura it caused (b3dea9f6 r1 stealth Rake: stun REFRESH
   * 19.0498, cast row 19.0508), as `ccRecastBetween` reads it — at `target`
   * or untargeted, when a target is given? */
  const recast = (
    src: string,
    auraId: string,
    a: number,
    b: number,
    target?: string,
  ) => {
    const ids = new Set([auraId, ...castsOfEffectAura(auraId)]);
    const nm = nameOf(auraId, "");
    const owner = unitById.get(src)?.ownerId;
    for (const who of [src, owner])
      if (who)
        for (const c of castsOf(who)) {
          const t = tsOf(c);
          if (
            t > a &&
            t <= b + CAST_ROW_LAG_MAX_MS &&
            (ids.has(String(c.spellId)) ||
              (nm && nameOf(c.spellId, "") === nm)) &&
            (target === undefined ||
              !c.destUnitId ||
              /^0+$/.test(String(c.destUnitId)) ||
              c.destUnitId === target)
          )
            return true;
        }
    return false;
  };

  // ── the log's applications per unit ──
  const appsCache = new Map<string, IApp[]>();
  const appsOn = (u: any): IApp[] => {
    const hit = appsCache.get(u.id);
    if (hit) return hit;
    const rows = (u.auraEvents ?? []) as any[];
    const roarRows = rows.filter((a) =>
      OPPRESSING_ROAR_AURA_IDS.has(String(a.spellId)),
    );
    const roarOn = (at: number): boolean => {
      let until = -Infinity;
      for (const r of roarRows) {
        if (tsOf(r) > at) break;
        const e = ev(r);
        if (e === APPLIED || e === REFRESH)
          until =
            tsOf(r) +
            (spellEffectData[String(r.spellId)]?.durationSeconds ?? 10) * 1000;
        else if (e === REMOVED) until = -Infinity;
      }
      return at < until;
    };
    const apps: IApp[] = [];
    const open = new Map<string, IApp>();
    const lastClosed = new Map<string, IApp>();
    const officialMs = (id: string) => (ccFullDurationSeconds(id) ?? 8) * 1000;
    const openApp = (a: any, i: number, id: string, cat: string) => {
      const app: IApp = {
        spellId: id,
        name: nameOf(id, a.spellName ?? id),
        cat,
        src: String(a.srcUnitId),
        apply: tsOf(a),
        end: NaN,
        idx: i,
        roar: roarOn(tsOf(a)),
      };
      apps.push(app);
      open.set(`${id}|${a.srcUnitId}`, app);
    };
    const earliestOpenOf = (id: string): string | undefined => {
      let best: string | undefined;
      let bestApply = Infinity;
      for (const [k, o] of open)
        if (k.startsWith(`${id}|`) && o.apply < bestApply) {
          bestApply = o.apply;
          best = k;
        }
      return best;
    };
    rows.forEach((a, i) => {
      const id = String(a.spellId ?? "");
      const cat = DR_CATEGORY_MAP[id];
      if (!cat || a.auraType !== "DEBUFF") return;
      if (a.srcUnitId === u.id && !ccSpellIds.has(id)) return;
      const key = `${id}|${a.srcUnitId}`;
      const e = ev(a);
      const t = tsOf(a);
      if (e === APPLIED) {
        const o = open.get(key);
        if (o) {
          const isNew =
            recast(o.src, id, o.apply + REBROADCAST_MS, t) ||
            t >= o.apply + officialMs(id);
          if (!isNew) return;
          o.end = Math.min(t, o.apply + officialMs(id));
          open.delete(key);
          openApp(a, i, id, cat);
          return;
        }
        // a recast is logged before the REMOVED it causes (3035741a r3
        // 50.366 Cheap Shot cast → REMOVED 50.367 → APPLIED 50.368): look
        // back from the APPLIED, past the opening, at casts at the holder
        const lc = lastClosed.get(key);
        if (
          lc &&
          t - lc.end <= REBROADCAST_MS &&
          !recast(
            lc.src,
            id,
            Math.max(lc.apply + REBROADCAST_MS, t - CAST_BACKED_MS),
            t,
            u.id,
          )
        ) {
          lc.end = NaN;
          open.set(key, lc);
          lastClosed.delete(key);
          return;
        }
        openApp(a, i, id, cat);
      } else if (e === REFRESH) {
        // every REFRESH of an open control is a new application, recast or
        // not — the game re-times it at the next DR tier (F20 dr, measured
        // on the 605 corpus; `ccRefreshIsNewApplication`)
        const o = open.get(key);
        if (o) {
          o.end = t;
          open.delete(key);
          openApp(a, i, id, cat);
        }
      } else if (e === REMOVED) {
        // its own source's open one; else — a REMOVED logged under another
        // source than the APPLIED (two mages' Polymorphs on one ms: APPLIED
        // under the first, REMOVED under the second — F20 wide residual,
        // ffd6ac67 r1 0:32) — the earliest open one of this spell, as the
        // product pairs it (`matchPendingCcKey`); left open it ran 32.6 s
        // to the next Polymorph's break
        const k = open.has(key) ? key : earliestOpenOf(id);
        const o = k ? open.get(k) : undefined;
        if (!o || !k) return;
        o.end = t;
        open.delete(k);
        lastClosed.set(k, o);
      } else if (BROKEN.has(e)) {
        // the row's source is the breaker: mark the open one of this spell
        // (the breaker's own when it is the caster — a Shatter on its own
        // Polymorph — else the earliest)
        const k = open.has(key) ? key : earliestOpenOf(id);
        const o = k ? open.get(k) : undefined;
        if (o) o.brokeAt ??= t;
      }
    });
    for (const o of open.values())
      o.end = Math.min(o.apply + officialMs(o.spellId), ctx.roundEndAt);
    apps.sort((x, y) => x.apply - y.apply || x.idx - y.idx);
    appsCache.set(u.id, apps);
    return apps;
  };

  const before = (apps: IApp[], x: IApp) =>
    apps.filter(
      (a) =>
        a.cat === x.cat &&
        (a.apply < x.apply || (a.apply === x.apply && a.idx < x.idx)),
    );
  /** Q1 levels of an application at the reset and at reset ± 0.5 s */
  const q1 = (u: any, x: IApp) => {
    const prior = before(appsOn(u), x);
    return {
      at: walk(prior, x.apply, RESET),
      band: new Set([
        walk(prior, x.apply, RESET - BOUNDARY_MS),
        walk(prior, x.apply, RESET + BOUNDARY_MS),
      ]),
    };
  };
  /** Q2 over the instants `ts` */
  const q2 = (u: any, cat: string, ts: number[]) => {
    const apps = appsOn(u).filter((a) => a.cat === cat);
    const at = new Set<Level>();
    const band = new Set<Level>();
    for (const t of ts) {
      const upTo = apps.filter((a) => a.apply <= t);
      at.add(walk(upTo, t, RESET));
      band.add(walk(upTo, t, RESET - BOUNDARY_MS));
      band.add(walk(upTo, t, RESET + BOUNDARY_MS));
    }
    return { at, band };
  };
  const secStart = (S: number) => ctx.start + S * 1000;
  const landedIn = (u: any, name: string, S0: number, S1: number) =>
    appsOn(u).filter((a) => {
      const s = Math.floor((a.apply - ctx.start) / 1000);
      return a.name === name && s >= S0 && s <= S1;
    });
  const fid = (u: any, x: IApp | undefined, extra: string) =>
    `${u.id}:${x ? `${x.spellId}:${x.apply - ctx.start}` : extra}`;
  /** judge a printed level against Q1 of the candidates */
  const judgeQ1 = (
    reader: string,
    u: any,
    xs: IApp[],
    printed: string,
    l: string,
    S: number,
    what: string,
  ) => {
    ctx.bump(C);
    if (xs.length === 0) {
      ctx.violate(
        C,
        `${reader}:unmatched`,
        secStart(S),
        `${u.id}:${what}:${S}`,
        `${what} on ${u.name} at ${fmtS(S)}: no landing in the log`,
        l,
      );
      return;
    }
    const at = new Set<string>();
    const band = new Set<string>();
    for (const x of xs) {
      const r = q1(u, x);
      at.add(r.at);
      for (const b of r.band) band.add(b);
    }
    if (at.has(printed)) return;
    const x = xs[0]!;
    const prior = before(appsOn(u), x)
      .filter((a) => x.apply - a.end < 30_000)
      .map(
        (a) =>
          `${a.name}${a.src === u.id ? "(self)" : ""} ${((a.apply - ctx.start) / 1000).toFixed(2)}–${((a.end - ctx.start) / 1000).toFixed(2)}`,
      );
    ctx.violate(
      C,
      band.has(printed) ? `${reader}:boundary` : reader,
      x.apply,
      fid(u, x, what),
      `${what} on ${u.name} at ${((x.apply - ctx.start) / 1000).toFixed(3)}: printed ${printed}, log ${[...at].join("/")} (before it: ${prior.join("; ") || "none"})`,
      l,
    );
  };
  const judgeQ2 = (
    reader: string,
    u: any,
    cat: string,
    ts: number[],
    printed: string,
    l: string,
    what: string,
  ) => {
    ctx.bump(C);
    const r = q2(u, cat, ts);
    if (r.at.has(printed as Level)) return;
    ctx.violate(
      C,
      r.band.has(printed as Level) ? `${reader}:boundary` : reader,
      ts[0]!,
      `${u.id}:${cat}:${what}:${Math.floor((ts[0]! - ctx.start) / 1000)}`,
      `${what} (${cat}) on ${u.name} at ${fmtS((ts[0]! - ctx.start) / 1000)}: printed ${printed}, log ${[...r.at].join("/")}`,
      l,
    );
  };
  /** the DR family of a control named in a line (one family, or undefined) */
  const familyOf = (name: string, casters: any[]): string | undefined => {
    const fams = new Set<string>();
    for (const c of casters) {
      for (const x of castsOf(c.id))
        if (nameOf(x.spellId, "") === name) {
          const f = drCategoryOfCast(String(x.spellId));
          if (!f.startsWith("spell:")) fams.add(f);
        }
      for (const p of ctx.players)
        for (const a of (p.auraEvents ?? []) as any[])
          if (
            a.srcUnitId === c.id &&
            DR_CATEGORY_MAP[String(a.spellId)] &&
            nameOf(a.spellId, "") === name
          )
            fams.add(DR_CATEGORY_MAP[String(a.spellId)]!);
    }
    if (fams.size === 0) for (const f of familiesOfName(name)) fams.add(f);
    return fams.size === 1 ? [...fams][0] : undefined;
  };
  const petsOf = (u: any) => ctx.units.filter((x) => x.ownerId === u.id);

  const ownSide = ctx.players.filter((p) => p.reaction === ctx.owner.reaction);
  const otherSide = ctx.players.filter(
    (p) => p.reaction !== ctx.owner.reaction,
  );
  const ourHealer = ownSide.find((p) => isHealerSpec(p.spec));
  const theirHealer = otherSide.find((p) => isHealerSpec(p.spec));
  const DR_TAG = /\[DR: ([^\]—]+?) (Full|50%|Immune)\]/;

  for (const l of ctx.lines) {
    const tm = /^(\d+):(\d\d)\s+(.*)$/.exec(l);
    const S = tm ? Number(tm[1]) * 60 + Number(tm[2]) : NaN;
    const body = tm?.[3] ?? "";

    // ── [CC ON TEAM] / [CC ON ENEMY] ──
    let m =
      /^\[CC ON (?:TEAM|ENEMY)\]\s+(\d+)\([^)]*\) ← (.+?) \((?:by |reflected back)/.exec(
        body,
      );
    const dr = DR_TAG.exec(body);
    if (tm && m && dr) {
      const u = ctx.unitOfPid(m[1]);
      if (u) judgeQ1("ccTag", u, landedIn(u, m[2]!, S, S), dr[2]!, l, S, m[2]!);
      continue;
    }
    // ── [YOU] [CC] / [TEAM] [CC] ──
    m = /^\[(?:YOU|TEAM)\] \[CC\]\s+(?:.*? cast )?(.+?) → (\d+)\(/.exec(body);
    if (tm && m) {
      const spell = m[1]!;
      const per = /\[DR: [^\]—]+? — ([^\]]+)\]/.exec(body);
      const pairs: Array<[string, string]> = per
        ? [...per[1]!.matchAll(/(\d+)\([^)]*\) (Full|50%|Immune)/g)].map(
            (p) => [p[1]!, p[2]!],
          )
        : dr
          ? [[m[2]!, dr[2]!]]
          : [];
      for (const [pid, lv] of pairs) {
        const u = ctx.unitOfPid(pid);
        if (u)
          judgeQ1("castTag", u, landedIn(u, spell, S, S + 1), lv, l, S, spell);
      }
      continue;
    }
    // ── [DR CLASH] ──
    m =
      /^\[DR CLASH\]\s+(?:your|\d+\([^)]*\)'s) (.+?) on (\d+)\([^)]*\) landed at (50%|Immune) DR/.exec(
        body,
      );
    if (tm && m) {
      const u = ctx.unitOfPid(m[2]);
      if (u)
        judgeQ1(
          "drClash",
          u,
          landedIn(u, m[1]!, S - 1, S + 1),
          m[3]!,
          l,
          S,
          m[1]!,
        );
      continue;
    }
    // ── [CC NOT LANDED] … (DR: Cat Immune) ──
    m =
      /^\[CC NOT LANDED\]\s+(\d+)\([^)]*\) ← (.+?) \(by .*\(DR: (\w+) Immune\)/.exec(
        body,
      );
    if (tm && m) {
      const u = ctx.unitOfPid(m[1]);
      if (u)
        judgeQ2(
          "notLanded",
          u,
          m[3]!,
          [secStart(S), secStart(S) + 999],
          "Immune",
          l,
          m[2]!,
        );
      continue;
    }
    // ── [HEALER EXPOSURE] ──
    if (tm && body.startsWith("[HEALER EXPOSURE]") && ourHealer) {
      let ts = [secStart(S), secStart(S) + 999];
      const al = /healer already in (.+?) until/.exec(body);
      if (al) {
        const x = appsOn(ourHealer).find(
          (a) =>
            a.name === al[1] &&
            a.apply <= secStart(S) + 999 &&
            a.end > secStart(S),
        );
        if (x) ts = [Math.max(x.apply, secStart(S)), secStart(S) + 999];
      }
      const los = /IN LoS: (.*?)(?: \| |$)/.exec(body)?.[1] ?? "";
      for (const grp of los.split("; ")) {
        const g = /^([^:]+): (.*)$/.exec(grp);
        if (!g) continue;
        // the threat's family: what any enemy logged under that name
        const casters = otherSide;
        for (const th of g[2]!.split(", ")) {
          const t2 = /^(.+) (Full|50%) DR$/.exec(th);
          if (!t2) continue;
          const reader = al ? "exposureAlreadyIn" : "exposure";
          const cat = familyOf(t2[1]!, [
            ...casters,
            ...casters.flatMap(petsOf),
          ]);
          if (!cat) {
            ctx.bump(C);
            ctx.violate(
              C,
              `${reader}:unresolved`,
              ts[0]!,
              `${t2[1]}:${S}`,
              `${t2[1]}: no DR family by name`,
              l,
            );
            continue;
          }
          judgeQ2(reader, ourHealer, cat, ts, t2[2]!, l, t2[1]!);
        }
      }
      continue;
    }
    // ── [PEEL OPTION] / [CC BOOKMARK] ──
    m =
      /\[(?:PEEL OPTION|CC BOOKMARK)\]\s+(?:\d+\([^)]*\) )?(.+?) → (\d+)\(.*?\| at (\d+:\d\d): [^|]*?DR (Full|50%)/.exec(
        l,
      );
    if (m) {
      const u = ctx.unitOfPid(m[2]);
      const at = secOf(m[3]!);
      const cat = familyOf(m[1]!, [
        ctx.owner,
        ...petsOf(ctx.owner),
        ...ownSide,
      ]);
      if (u && cat)
        judgeQ2(
          "peelBookmark",
          u,
          cat,
          [secStart(at), secStart(at) + 999],
          m[4]!,
          l,
          m[1]!,
        );
      else if (u) {
        ctx.bump(C);
        ctx.violate(
          C,
          "peelBookmark:unresolved",
          secStart(at),
          `${m[1]}:${at}`,
          `${m[1]}: no DR family by name`,
          l,
        );
      }
      continue;
    }
    // ── [KILL WINDOW] / [VULNERABLE] (enemy healer DR: L) ──
    m = /\[(?:KILL WINDOW|VULNERABLE)\] (\d+:\d\d)–/.exec(l);
    if (m && theirHealer && l.includes("enemy healer DR:")) {
      const at = secOf(m[1]!);
      for (const k of l.matchAll(
        /(?:: |, )([^,;:()]+?) \(enemy healer DR: (Full|50%)\)/g,
      )) {
        const name = k[1]!.trim();
        const cat = familyOf(name, [ctx.owner, ...petsOf(ctx.owner)]);
        if (!cat) {
          ctx.bump(C);
          ctx.violate(
            C,
            "killWindow:unresolved",
            secStart(at),
            `${name}:${at}`,
            `${name}: no DR family by name`,
            l,
          );
          continue;
        }
        judgeQ2(
          "killWindow",
          theirHealer,
          cat,
          [secStart(at), secStart(at) + 999],
          k[2]!,
          l,
          name,
        );
      }
      continue;
    }
    // ── [CC BROKEN] Ns of CC wasted / [CC REMOVED] ~Ns of it left ──
    const br =
      /^\[CC BROKEN\]\s+.* broke .*?'s (.+?) on (\d+)\([^)]*\) — (\d+(?:\.\d+)?)s of CC wasted/.exec(
        body,
      );
    const rm =
      /^\[CC REMOVED\]\s+.* removed (?:\d+\([^)]*\)'s )?(.+?) from (\d+)\([^)]*\) after \S+ \(~(\d+)s of it left\)/.exec(
        body,
      );
    const hit = br ?? rm;
    if (tm && hit) {
      const reader = br ? "ccBroken" : "ccRemoved";
      const u = ctx.unitOfPid(hit[2]);
      if (!u) continue;
      const spell = hit[1]!;
      const printed = Number(hit[3]);
      const endOf = (a: IApp) => (br ? a.brokeAt : a.end);
      const xs = appsOn(u).filter((a) => {
        const e = endOf(a);
        if (a.name !== spell || e === undefined || Number.isNaN(e))
          return false;
        const s = Math.floor((e - ctx.start) / 1000);
        return s >= S - 1 && s <= S;
      });
      ctx.bump(C);
      if (xs.length === 0) {
        ctx.violate(
          C,
          `${reader}:unmatched`,
          secStart(S),
          `${u.id}:${spell}:${S}`,
          `${spell} on ${u.name}: no ${br ? "break" : "removal"} at ${fmtS(S)}`,
          l,
        );
        continue;
      }
      // every application of that spell ending in the window is a
      // candidate — the line names one of them (4bba0c31 r1 8:52: a Fear
      // broken at 531.514 and the recast one broken at 532.254); judged by
      // the closest, reported on the one ending in the line's second
      xs.sort((a, b) => {
        const sa = Math.floor((endOf(a)! - ctx.start) / 1000) === S ? 0 : 1;
        const sb = Math.floor((endOf(b)! - ctx.start) / 1000) === S ? 0 : 1;
        return sa - sb;
      });
      const tol = br ? 0.15 : 0.55;
      const judged = xs.map((x) => {
        const full = ccFullDurationForApplication(
          x.spellId,
          unitById.get(x.src),
          x.roar,
        );
        if (full === undefined) return { x, full };
        const held = (endOf(x)! - x.apply) / 1000;
        const left = (lv: string) =>
          Math.max(0, full * SHARE[lv as Level] - held);
        const r = q1(u, x);
        return {
          x,
          full,
          held,
          left,
          r,
          ok: Math.abs(left(r.at) - printed) <= tol,
          inBand: [...r.band].some((b) => Math.abs(left(b) - printed) <= tol),
        };
      });
      if (judged.some((j) => j.ok)) continue;
      const j = judged[0]!;
      const x = j.x;
      const full = j.full;
      if (full === undefined || !j.left || !j.r) {
        ctx.violate(
          C,
          `${reader}:noDuration`,
          x.apply,
          fid(u, x, spell),
          `${spell}: no official length`,
          l,
        );
        continue;
      }
      const held = j.held!;
      const left = j.left;
      const r = j.r;
      const inBand = judged.some((k) => k.inBand);
      ctx.violate(
        C,
        inBand ? `${reader}:boundary` : reader,
        x.apply,
        fid(u, x, spell),
        `${spell} on ${u.name} landed ${((x.apply - ctx.start) / 1000).toFixed(3)} at ${r.at} (full ${full.toFixed(1)} s${x.roar ? " incl. Roar" : ""}), held ${held.toFixed(2)} s → ${left(r.at).toFixed(1)} s left; printed ${printed} s`,
        l,
      );
    }
  }
}

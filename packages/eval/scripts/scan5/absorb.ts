/* eslint-disable @typescript-eslint/no-explicit-any -- the check walks the untyped legacy parse objects (auraEvents, absorbsIn, spellCastEvents) */
/**
 * scan5/absorb.ts — F20 class "the target's own absorb shield ends
 * `defenseless`" (round-6 D15 D16 D18 D21; research `fix/research/absorb.md`).
 * User ruling 1 (2026-10-28): a press-triggered own shield counts — the
 * Power Word: Shield family incl. Unfolding Vision's 1300008 / 1300009, and a
 * talent shield that rides an own press (Chi Cocoon with Invoke Chi-Ji /
 * Enveloping Mist); a passive talent absorb (Divine Aegis, Soul Leech, Fel
 * Armor, Angelic Bulwark …) does not, nor does a deferral (Stretch Time).
 *
 *  - `ownAbsorbDefenseless`: every `[KILL WINDOW] … (defenseless a–b)` and
 *    every `[VULNERABLE] a–b … no major defensives` line of the context
 *    timeline (one span per unit and printed bounds — two windows naming the
 *    same `defenseless` span are one item). The printed bounds are floored,
 *    so the span certainly holds [a+1, b] (s since the round start). From the
 *    log, per shield id X the unit T put on itself:
 *      · aura — a run of X (APPLIED, or a REFRESH with no open run → REMOVED;
 *        an unclosed run lasts DB2's duration + 1 s) with src = dest = T, X a
 *        DB2 absorb (`abilityEffectsGenerated[X].absorbs`), covering a whole
 *        interior second [s, s+1), s ∈ a+1 … b−1;
 *      · absorbed — a SPELL_ABSORBED row with T the absorber and the shield's
 *        caster, amount > 0, at a time in [a+1, b].
 *    One fact per span × X. Its kind is the link to an own press, read from
 *    the log (never through `ownPressedShieldSpansMs` /
 *    `KW_OWN_ROTATIONAL_ABSORB_AURA_IDS`), first that holds:
 *      · `deferral` — T took damage of its own under X's name this round
 *        (Stretch Time 410355 → 413924, Fel Armor 386124): a delay, no
 *        shield;
 *      · `ruled` — X's name with a trailing `(…)` stripped is Power Word:
 *        Shield or Void Shield (ruling 1's family by name — the product's
 *        derivation is the DB2 class mask, so the two agree independently);
 *      · `neverAbsorbed` — X never absorbed for T this round (no absorbsIn
 *        row of X with T the shield's caster): an aura DB2 calls an absorb
 *        that absorbs nothing is no shield — Defensive Stance 386208's 15 %
 *        stance and Glimpse 354610's 20 % reduction (0 of 732 / 1,172
 *        applications absorbed on the 605), Masterwork: Bulwark's trigger;
 *        the kill windows' evidence rule (`ownPressedShieldSpansMs`, b41 /
 *        b42). A real shield up through a span in which its holder took no
 *        damage reads here too (s1/73-1-409 Chi Cocoon 1:37–1:47, Freezing
 *        Trap'd, 0 hits) — harmless, out of the total;
 *      · `pressed` — an own SUCCESS of X, of a cast `castsOfEffectAura` lists
 *        for X, or of X's name, in the 60 s before the run's first moment
 *        inside the span / the row (+150 ms aura-before-cast lag) —
 *        corpusFactScan2 E6, the product's run ∩ [press, press + 60 s];
 *      · `rider` — X is in `RIDERS` and an own SUCCESS of one of its casts
 *        falls in that same window, or T logged no cast of any of them this
 *        round (the application stands for the unlogged press: the
 *        Devourer's Shift → First In, Last Out) and X's own id is no logged
 *        press (`CAST_AS_ITSELF`). `RIDERS` is a COPY of the product's
 *        corpus-selected table (`ownShieldLinksGenerated.json`, F20 residual
 *        regen on the 605, 2026-10-28: ≥ 90 % of a class-owned absorb's
 *        self-applications within ±150 ms of its holder's press of another
 *        spell over the holders that logged a carrying cast that round, ≥ 10,
 *        absorbing — the ruling's "corpus ≥ 90 %"): the scan
 *        runs from the pre-fix tree, which has no table, and one pass cannot
 *        know an aura's capture-wide share before its facts are counted.
 *        `report()` re-measures every listed and unlisted aura with this
 *        module's own predicate and flags any disagreement;
 *      · `riderUnlisted` — not in `RIDERS`, but the run's APPLIED (the run
 *        an absorbed row belongs to: the latest of X on T starting before
 *        it) lies within ±150 ms (`AURA_BEFORE_CAST_ROW_MAX_MS`) of an own
 *        SUCCESS of any spell, and so does every other own application of X
 *        by T this round. Per application, so a proc that happens to land on
 *        a press reads here (Divine Aegis off a Radiance crit, 71 %
 *        capture-wide; Worldsoul Cradle's enchant beside a healer's casts);
 *        out of the total — `report()` re-buckets these facts by the
 *        capture-wide share;
 *      · `passive` — none of the above, the shield had an own run;
 *      · `noAura` — absorbed rows only, no own run of X on T at all (Danger
 *        Sense, Tempted Fate log no aura; Mindgames 375902's
 *        aura sits on its victim, the priest's rows are not a shield on her
 *        — read before `pressed` when the press that names the rows went on
 *        another unit; Darkness 209426, pressed untargeted, stays `pressed`).
 *    `deferral`, `neverAbsorbed`, `riderUnlisted`, `passive` and `noAura`
 *    are out of the total (ruling 1).
 *    Exclusions (corpusFactScan2 E6): Alter Time 342246 / 110909, Obsidian
 *    Scales 363916; a caster-side link (an own SUCCESS of X within ±150 ms of
 *    the APPLIED whose target is another unit — Blessing of Sacrifice 6940's
 *    aura on the paladin who threw it); ally-cast shields (caster ≠ T) are
 *    another fact (research Q3), not read here.
 *
 *  `report()`: the inventory over the capture's rounds (each round once) —
 *  per DB2-absorb aura id players put on themselves: applications and the
 *  share within ±150 ms of an own SUCCESS, with the top casts — the input for
 *  the rider table's threshold on 605 + wide.
 */
import abilityEffects from "@gladlog/analysis/src/data/abilityEffectsGenerated.json";
import { castsOfEffectAura } from "@gladlog/analysis/src/data/castEffectAuras";
import spellEffects from "@gladlog/analysis/src/data/spellEffectGenerated.json";

import {
  ABSORBED,
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

export const CHECKS = ["ownAbsorbDefenseless"] as const;
const C = "ownAbsorbDefenseless";
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  `${C}|passive`,
  `${C}|deferral`,
  `${C}|noAura`,
  `${C}|neverAbsorbed`,
  `${C}|riderUnlisted`,
]);

/** E6's press lookback (`E6_OWN_SHIELD_PRESS_WINDOW_MS`) */
const PRESS_LOOKBACK_MS = 60_000;
/** an aura logged up to this far before its cast row is still the press's */
const LAG_MS = 150;
const RULED_NAMES = new Set(["Power Word: Shield", "Void Shield"]);
const EXCLUDED = new Set(["342246", "110909", "363916"]);
const RIDER_SHARE = 0.9;
const RIDER_MIN_APPS = 10;
/** riders whose own id is a logged press (`castAsItself` in the table):
 * their application does not stand for an unlogged carrier (Ice Barrier —
 * 17 of 739 on mages with no Blazing Barrier had no cast of either in the
 * 2 s before) */
const CAST_AS_ITSELF: ReadonlySet<string> = new Set([
  "11426",
  "367364", // Reversion: pressed as 366155 (codex F20-25)
  "461867",
]);
/** COPY of `ownShieldLinksGenerated.json` riders (aura → carrying casts),
 * the F20 residual regen on the 605 files (2026-10-28) — see `rider` above */
const RIDERS: ReadonlyMap<string, readonly string[]> = new Map([
  ["184662", ["403876", "408385"]], // Shield of Vengeance
  ["196440", ["527"]], // Purification
  ["385787", ["22812", "61336"]], // Matted Fur
  ["406139", ["322118"]], // Chi Cocoon (Invoke Yu'lon)
  ["406220", ["325197"]], // Chi Cocoon (Invoke Chi-Ji)
  ["427901", ["185123", "210152", "337819", "188499", "444686", "228537"]], // Deflecting Dance
  ["442749", ["115203"]], // Niuzao's Protection
  ["461867", ["255937", "454351", "427453", "431398", "408385"]], // Sacrosanct Crusade
  ["1239002", ["415388", "20473", "1279187"]], // Lesser Bulwark
  ["1241717", ["156322", "85673"]], // Seraphic Barrier
  ["1246768", ["33076"]], // Power Word: Shield (Holy's proc; ruled anyway)
  ["1260681", ["124682"]], // Chi Cocoon (Enveloping Mist)
  ["1266619", ["195072"]], // First In, Last Out (Fel Rush)
  ["11426", ["235313"]], // Ice Barrier (the fire mage's, with Blazing Barrier)
  // Reversion (Merithra's Blessing; its own Reversion press links by name —
  // the own-or-other rule, F20 wide residual 2026-10-29)
  ["367364", ["1256581"]],
]);

const absorbs = (id: string): boolean =>
  !!(abilityEffects as Record<string, { absorbs?: boolean }>)[id]?.absorbs;
const durationS = (id: string): number =>
  (spellEffects as Record<string, { durationSeconds?: number }>)[id]
    ?.durationSeconds ?? 10;
const stem = (n: string): string => n.replace(/\s*\([^)]*\)\s*$/, "");

const SPAN_RE =
  /^\s+\[(KILL WINDOW|VULNERABLE)\] (\d+:\d\d)–(\d+:\d\d)(?: \(\d+s\))? on [^(]+ \(([^()]+(?:\([^()]*\)[^()]*)*)\):(.*)$/;

// ── capture-wide inventory (each round once) ──
const inv = new Map<
  string,
  {
    apps: number;
    near: number;
    casts: Map<string, number>;
    /** a listed rider's applications whose holder logged one of its
     * carrying casts that round, and those within ±LAG_MS of a press */
    carrierApps: number;
    carrierNear: number;
  }
>();
/** rider facts by shield id (distinct), for the re-bucketing in report() */
const riderFacts = new Map<string, Set<string>>();

interface IRun {
  fromMs: number;
  toMs: number;
  inferredEnd: boolean;
  /** the own SUCCESS within ±LAG_MS of the APPLIED, if any */
  nearPress?: string;
  linkOnly: boolean;
}

export function run(ctx: IRoundCtx): void {
  const succByUnit = new Map<string, any[]>();
  const succOf = (u: any): any[] => {
    let s = succByUnit.get(u.id);
    if (!s) {
      s = successesOf(u);
      succByUnit.set(u.id, s);
    }
    return s;
  };
  /** own self-applied DB2-absorb runs of unit u, by aura id */
  const runsCache = new Map<string, Map<string, IRun[]>>();
  const runsOf = (u: any): Map<string, IRun[]> => {
    const hit = runsCache.get(u.id);
    if (hit) return hit;
    const out = new Map<string, IRun[]>();
    const open = new Map<string, number>();
    const seenLine = new Set<string>();
    const rows = ((u.auraEvents ?? []) as any[])
      .filter(
        (a) =>
          a.srcUnitId === u.id &&
          a.destUnitId === u.id &&
          absorbs(String(a.spellId)) &&
          !EXCLUDED.has(String(a.spellId)),
      )
      .sort((x, y) => tsOf(x) - tsOf(y));
    const succ = succOf(u);
    const close = (id: string, fromMs: number, toMs: number, inf: boolean) => {
      const near = succ.find((c) => Math.abs(tsOf(c) - fromMs) <= LAG_MS);
      // a caster-side link: the same spell's press went on another unit
      const linkOnly = succ.some(
        (c) =>
          String(c.spellId) === id &&
          Math.abs(tsOf(c) - fromMs) <= LAG_MS &&
          !!c.destUnitId &&
          c.destUnitId !== u.id &&
          !/^0+$/.test(c.destUnitId),
      );
      const list = out.get(id) ?? [];
      list.push({
        fromMs,
        toMs,
        inferredEnd: inf,
        ...(near ? { nearPress: String(near.spellId) } : {}),
        linkOnly,
      });
      out.set(id, list);
    };
    for (const a of rows) {
      const k = `${a.logLine?.lineIndex ?? ""}|${tsOf(a)}|${ev(a)}|${a.spellId}`;
      if (seenLine.has(k)) continue;
      seenLine.add(k);
      const id = String(a.spellId);
      const e = ev(a);
      if (e === APPLIED && open.has(id)) {
        // a second APPLIED while a run is open: the first one's REMOVED was
        // lost — it ended by its DB2 length at the latest (a431153b r5:
        // First In, Last Out 1:31.6, consumed at 1:32.3, no REMOVED, next
        // APPLIED 2:04.3 — not one shield up for 33 s)
        const from = open.get(id)!;
        close(
          id,
          from,
          Math.min(tsOf(a), from + (durationS(id) + 1) * 1000),
          true,
        );
        open.set(id, tsOf(a));
      } else if (e === APPLIED || (e === REFRESH && !open.has(id))) {
        if (!open.has(id)) open.set(id, tsOf(a));
      } else if (e === REMOVED && open.has(id)) {
        close(id, open.get(id)!, tsOf(a), false);
        open.delete(id);
      }
    }
    for (const [id, from] of open)
      close(id, from, from + (durationS(id) + 1) * 1000, true);
    runsCache.set(u.id, out);
    return out;
  };
  /** the shields that absorbed for unit u this round (its own absorbsIn
   * rows, u the shield's caster) */
  const ateCache = new Map<string, Set<string>>();
  const ateOf = (u: any): Set<string> => {
    let s = ateCache.get(u.id);
    if (!s) {
      s = new Set(
        ((u.absorbsIn ?? []) as any[])
          .filter((r) => r.srcUnitId === u.id)
          .map((r) => String(r.spellId)),
      );
      ateCache.set(u.id, s);
    }
    return s;
  };
  const deferralIds = new Map<string, Set<string>>();
  const deferralOf = (u: any): Set<string> => {
    let d = deferralIds.get(u.id);
    if (d) return d;
    d = new Set<string>();
    const selfDot = new Set(
      ((u.damageIn ?? []) as any[])
        .filter((h) => h.srcUnitId === u.id)
        .map((h) => nameOf(String(h.spellId), h.spellName ?? "")),
    );
    for (const id of runsOf(u).keys()) if (selfDot.has(nameOf(id))) d.add(id);
    for (const r of (u.absorbsIn ?? []) as any[])
      if (selfDot.has(nameOf(String(r.spellId), r.spellName ?? "")))
        d.add(String(r.spellId));
    deferralIds.set(u.id, d);
    return d;
  };

  // ── the inventory, each round once ──
  if (ctx.firstOwnerOfRound)
    for (const p of ctx.players)
      for (const [id, runs] of runsOf(p)) {
        const x = inv.get(id) ?? {
          apps: 0,
          near: 0,
          casts: new Map(),
          carrierApps: 0,
          carrierNear: 0,
        };
        const carriers = RIDERS.get(id);
        const carrierLogged =
          !!carriers &&
          succOf(p).some((c) => carriers.includes(String(c.spellId)));
        for (const r of runs) {
          if (r.linkOnly) continue;
          x.apps++;
          if (carrierLogged) x.carrierApps++;
          if (r.nearPress) {
            x.near++;
            if (carrierLogged) x.carrierNear++;
            x.casts.set(r.nearPress, (x.casts.get(r.nearPress) ?? 0) + 1);
          }
        }
        inv.set(id, x);
      }

  // ── ownAbsorbDefenseless ──
  const seen = new Set<string>();
  for (const l of ctx.lines) {
    const m = SPAN_RE.exec(l);
    if (!m) continue;
    const u = ctx.byName.get(m[4]!);
    if (!u) continue;
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
    const sk = `${u.id}:${a}:${b}`;
    if (seen.has(sk)) continue;
    seen.add(sk);
    ctx.bump(C);
    const fromMs = ctx.start + (a + 1) * 1000;
    const toMs = ctx.start + b * 1000;
    const runs = runsOf(u);
    const succ = succOf(u);
    const ids = new Set<string>();
    /** per id: interior seconds an own run covers, the runs that do */
    const cover = new Map<string, { secs: number; runs: IRun[] }>();
    for (const [id, rs] of runs)
      for (const r of rs) {
        if (r.linkOnly) continue;
        let secs = 0;
        for (let s = a + 1; s <= b - 1; s++) {
          const s0 = ctx.start + s * 1000;
          if (r.fromMs <= s0 && r.toMs >= s0 + 1000) secs++;
        }
        if (secs === 0) continue;
        const c = cover.get(id) ?? { secs: 0, runs: [] };
        c.secs += secs;
        c.runs.push(r);
        cover.set(id, c);
        ids.add(id);
      }
    /** per id: absorbed rows inside */
    const ate = new Map<
      string,
      { sum: number; rows: number; first: number; at: number[] }
    >();
    for (const r of (u.absorbsIn ?? []) as any[]) {
      if (ev(r) !== undefined && ev(r) !== ABSORBED) continue;
      const t = tsOf(r);
      if (t < fromMs || t > toMs || r.srcUnitId !== u.id) continue;
      const id = String(r.spellId);
      if (EXCLUDED.has(id)) continue;
      const amt = Math.abs(Number(r.absorbedAmount) || 0);
      if (amt <= 0) continue;
      const x = ate.get(id) ?? { sum: 0, rows: 0, first: t, at: [] };
      x.sum += amt;
      x.rows++;
      x.at.push(t);
      ate.set(id, x);
      ids.add(id);
    }
    for (const id of ids) {
      const cv = cover.get(id);
      const ab = ate.get(id);
      // the runs the evidence belongs to: covering runs, and for each
      // absorbed row the latest own run of X started before it
      const ownRuns = (runs.get(id) ?? []).filter((r) => !r.linkOnly);
      const linked = new Set<IRun>(cv?.runs ?? []);
      for (const t of ab?.at ?? []) {
        const r = [...ownRuns].reverse().find((x) => x.fromMs <= t + LAG_MS);
        if (r) linked.add(r);
      }
      const name = nameOf(id, id);
      // a press links the shield when its minute [press, press + 60 s]
      // meets the shield inside the span — a run's part in the span (not
      // its start: a Holy Bulwark proc run that began 57 s after the last
      // Holy Armaments press is that press's for 3 s at most, F20 wide
      // residual d020c408 r1 1:57; nor its first moment: a press later
      // inside the run links it too, codex F20-25) or an absorbed row — the
      // product's run ∩ [press, press + 60 s] (`ownPressedShieldSpansMs`)
      const segments: Array<[number, number]> = [
        ...[...linked].map(
          (r): [number, number] => [
            Math.max(r.fromMs, fromMs),
            Math.min(r.toMs, toMs),
          ],
        ),
        ...(ab?.at ?? []).map((t): [number, number] => [t, t]),
      ].filter(([a, b]) => a <= b);
      const linkedPress = (isLink: (cid: string, c: any) => boolean) =>
        succ.find(
          (c) =>
            isLink(String(c.spellId), c) &&
            segments.some(
              ([a, b]) =>
                tsOf(c) <= b + LAG_MS && tsOf(c) + PRESS_LOOKBACK_MS >= a,
            ),
        );
      const riderCasts = RIDERS.get(id);
      const riderPress = riderCasts
        ? linkedPress((cid) => riderCasts.includes(cid))
        : undefined;
      // no cast of any carrier logged this round: the application stands
      // for the unlogged press (the Devourer's Shift → First In, Last Out;
      // codex 20-F20-12 P2)
      const carrierUnlogged =
        !!riderCasts &&
        !CAST_AS_ITSELF.has(id) &&
        !succ.some((c) => riderCasts.includes(String(c.spellId)));
      let kind: string;
      let via = "";
      const ownPress = linkedPress(
        (cid, c) =>
          cid === id ||
          castsOfEffectAura(id).includes(cid) ||
          nameOf(cid, c.spellName ?? "") === name,
      );
      if (deferralOf(u).has(id)) kind = "deferral";
      else if (RULED_NAMES.has(stem(name))) kind = "ruled";
      else if (!ateOf(u).has(id)) kind = "neverAbsorbed";
      else if (
        linked.size === 0 &&
        ownPress?.destUnitId &&
        ownPress.destUnitId !== u.id &&
        !/^0+$/.test(ownPress.destUnitId)
      ) {
        // absorbed rows only, and the press that names them went on another
        // unit: the aura sits on its victim, no shield on T (Mindgames
        // 375901 → 375902 on the enemy, its rows absorb that enemy's hits —
        // on the priest too; F20 wide residual f820ae35 r4 1:33)
        kind = "noAura";
        via = " (its press went on another unit)";
      } else if (ownPress) kind = "pressed";
      else if (riderPress) {
        kind = "rider";
        via = ` ~${nameOf(String(riderPress.spellId), String(riderPress.spellId))}`;
      } else if (carrierUnlogged) {
        kind = "rider";
        via = " ~(no carrier cast logged this round)";
      } else {
        // every own application of X this round rode a press — not just
        // the one inside the span (a frequent proc such as Soul Leech or
        // Yu'lon's Grace lands beside some press by chance)
        const rider = [...linked].find((r) => r.nearPress);
        if (rider && ownRuns.every((r) => r.nearPress)) {
          kind = "riderUnlisted";
          via = ` ~${nameOf(rider.nearPress, rider.nearPress)}`;
        } else kind = linked.size > 0 ? "passive" : "noAura";
      }
      const factId = `${u.name}:${a}:${b}:${id}`;
      if (kind === "riderUnlisted") {
        const s = riderFacts.get(id) ?? new Set<string>();
        s.add(`${ctx.roundKey}#${factId}`);
        riderFacts.set(id, s);
      }
      const runTxt = [...linked]
        .slice(0, 3)
        .map(
          (r) =>
            `${fmtS((r.fromMs - ctx.start) / 1000)}–${fmtS((r.toMs - ctx.start) / 1000)}${r.inferredEnd ? "?" : ""}`,
        )
        .join(",");
      ctx.violate(
        C,
        kind,
        cv ? Math.max(fromMs, cv.runs[0]!.fromMs) : ab!.first,
        factId,
        `${u.name} defenseless ${fmtS(a)}–${fmtS(b)}: own ${name} ${id}${via}${cv ? ` up ${cv.secs}s inside` : ""}${ab ? ` ate ${Math.round(ab.sum / 1000)}k in ${ab.rows} row(s)` : ""}${runTxt ? ` (run ${runTxt})` : ""}`,
        l,
      );
    }
  }
}

export function report(): string[] {
  const out: string[] = [];
  const share = (id: string): number => {
    const x = inv.get(id);
    return x && x.apps > 0 ? x.near / x.apps : 0;
  };
  /** one other press carries at least half of the aura's applications —
   * an enchant's proc beside a healer's scattered casts (Worldsoul Cradle
   * 1242003: 95 % beside some press, no cast above 10 %) has no carrier */
  const carried = (id: string): boolean => {
    const x = inv.get(id);
    const top = x && [...x.casts].sort((p, q) => q[1] - p[1])[0];
    return (
      !!top &&
      top[1] / x.apps >= 0.5 &&
      top[0] !== id &&
      nameOf(top[0], top[0]) !== nameOf(id, id)
    );
  };
  const ok: string[] = [];
  const not: string[] = [];
  for (const [id, facts] of riderFacts)
    (share(id) >= RIDER_SHARE &&
    (inv.get(id)?.apps ?? 0) >= RIDER_MIN_APPS &&
    carried(id)
      ? ok
      : not
    ).push(
      `${nameOf(id, id)} ${id} ×${facts.size} (share ${(share(id) * 100).toFixed(0)}%, ${inv.get(id)?.apps ?? 0} apps)`,
    );
  out.push(
    `ownAbsorbDefenseless riderUnlisted facts re-bucketed by capture-wide press share (≥ ${RIDER_SHARE * 100}%, ≥ ${RIDER_MIN_APPS} apps, one other press carrying ≥ 50% = a rider RIDERS lacks, else passive): rider ${ok.length ? ok.join("; ") : "none"} | passive ${not.length ? not.join("; ") : "none"}`,
  );
  // the copied table against this capture: listed auras this module's own
  // predicate measures below the threshold (reverse), unlisted ones carried
  // by another spell's press at or above it (forward)
  // a listed rider's rate over the holders that logged one of its carrying
  // casts that round (the table's denominator: the Devourer's Shift, which
  // carries First In, Last Out, writes no cast row)
  const carrierShare = (id: string): number => {
    const x = inv.get(id);
    return x && x.carrierApps > 0 ? x.carrierNear / x.carrierApps : 0;
  };
  const weak = [...RIDERS.keys()]
    .filter(
      (id) =>
        (inv.get(id)?.carrierApps ?? 0) > 0 && carrierShare(id) < RIDER_SHARE,
    )
    .map(
      (id) =>
        `${nameOf(id, id)} ${id} ${(carrierShare(id) * 100).toFixed(0)}% of ${inv.get(id)!.carrierApps}`,
    );
  const missing = [...inv]
    .filter(
      ([id, x]) =>
        !RIDERS.has(id) &&
        x.apps >= RIDER_MIN_APPS &&
        share(id) >= RIDER_SHARE &&
        carried(id) &&
        !RULED_NAMES.has(stem(nameOf(id, id))),
    )
    .map(([id]) => `${nameOf(id, id)} ${id} ${(share(id) * 100).toFixed(0)}%`);
  out.push(
    `ownAbsorb RIDERS copy vs this capture (own predicate, ±${LAG_MS} ms of any own SUCCESS): listed below ${RIDER_SHARE * 100}% over the holders with a carrier logged: ${weak.length ? weak.join("; ") : "none"} | unlisted ≥ ${RIDER_SHARE * 100}% carried by one other press (≥ 50%), ≥ ${RIDER_MIN_APPS} apps: ${missing.length ? missing.join("; ") : "none"} — a never-absorbing aura (Glimpse), a deferral (Stretch Time) or a shield pressed as itself whose top neighbour is another press (Ice Barrier beside Blazing Barrier) can sit here legitimately`,
  );
  out.push(
    `ownAbsorb inventory — self-applied DB2-absorb auras (players, each round once): apps / own SUCCESS within ±${LAG_MS} ms / top casts`,
  );
  for (const [id, x] of [...inv].sort((p, q) => q[1].apps - p[1].apps)) {
    if (x.apps === 0) continue;
    const top = [...x.casts]
      .sort((p, q) => q[1] - p[1])
      .slice(0, 3)
      .map(
        ([c, n]) => `${nameOf(c, c)} ${c} ${((n / x.apps) * 100).toFixed(0)}%`,
      )
      .join(", ");
    out.push(
      `  ${nameOf(id, id)} ${id}: ${x.apps} apps, ${((x.near / x.apps) * 100).toFixed(0)}% with a press${top ? ` — ${top}` : ""}`,
    );
  }
  return out;
}

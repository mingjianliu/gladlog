/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, casts, aura rows) */
/**
 * scan5/t289.ts — pipeline T289: a Windwalker's Rising Sun Kick, Fists of
 * Fury and Strike of the Windlord pressed before the model has them back. A
 * measurement (count first): which presses the model has impossible is the
 * product's own reading — `unitCooldownEntry` (the one answer every reader
 * outside the ledger asks) and `cdAvailableAt` / `cdMaybeAvailableAt` on the
 * presses before, as `cooldownRecastScan` and scan5/t135 read it — and this
 * module says, per such press, what the log shows in the gap.
 *
 *  - `wwRecast`: a re-press of one of `TARGETS` by a Windwalker the model
 *    has not back yet. Counted: every press after the entry's first that is
 *    not a free one. Out of the total (a question until a mechanism is
 *    priced). Kind = `<spell> | <reading>`, the first that holds:
 *     · `a press of the shared charge pool between` — another spell of the
 *       same DB2 charge pool pressed in the gap (`spendsSharedChargeOf`: it
 *       spends this spell's charge and is no cast of it, so the gap printed
 *       is not the one the cooldown ran);
 *     · `Zenith / SEF press between` — Zenith 1249625 (`resets the remaining
 *       cooldown on Rising Sun Kick`) or Storm, Earth, and Fire 137639
 *       pressed in the gap;
 *     · `Blackout Kick! proc between` — the proc aura 116768 went up in the
 *       gap (Combo Breaker 137384: `the cooldown of Rising Sun Kick is
 *       reset`);
 *     · `Blackout Kicks cover it` — the shortfall is at most 1 s a Blackout
 *       Kick 100784 cast in the gap (Sharp Reflexes 261917, DB2 100784
 *       effect 2: 1000 ms), 2 s a cast inside a Zenith;
 *     · `Blackout Kick between, not covered` — a cast in the gap, the
 *       shortfall larger (Teachings of the Monastery 116645: a 12 % chance
 *       to reset, no row in the log);
 *     · `Heart of the Jade Serpent up` — the recovery-rate aura 443421 was
 *       on the unit in the gap;
 *     · `at 0.7–1.0 of the cooldown` — haste on the recharge (no haste is
 *       read, GH #219);
 *     · `none of these`.
 * `report()` prints, per spell, the holders split of each talent among the
 * impossible presses and all re-presses, and the shortfall after the
 * Blackout Kick reduction is taken.
 */
import {
  cdAvailableAt,
  cdMaybeAvailableAt,
  cdSecondsUntilReady,
  type IMajorCooldownInfo,
  spendsSharedChargeOf,
  unitCooldownEntry,
} from "@gladlog/analysis/src/utils/cooldowns";
import { EVENT_COOLDOWN_REDUCTIONS } from "@gladlog/analysis/src/data/talentScriptedCooldowns";
import {
  getPlayerTalentRanks,
  talentsOf,
} from "@gladlog/analysis/src/utils/talents";

import { APPLIED, ev, type IRoundCtx, REMOVED, successesOf, tsOf } from "./ctx";

export const CHECKS = ["wwRecast"] as const;

const WINDWALKER = "269";
const TARGETS: Readonly<Record<string, string>> = {
  "107428": "Rising Sun Kick",
  "113656": "Fists of Fury",
  "392983": "Strike of the Windlord",
};
const READINGS = [
  "a press of the shared charge pool between",
  "Zenith / SEF press between",
  "Blackout Kick! proc between",
  "Blackout Kicks cover it",
  "Blackout Kick between, not covered",
  "Heart of the Jade Serpent up",
  "at 0.7–1.0 of the cooldown",
  "none of these",
] as const;
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set(
  Object.values(TARGETS).flatMap((n) =>
    READINGS.map((r) => `wwRecast|${n} | ${r}`),
  ),
);

const BLACKOUT_KICK = "100784";
const ZENITH = "1249625";
const SEF = "137639";
const BOK_PROC = "116768";
const JADE_SERPENT = "443421";
/** the talents whose holder split the report prints */
const TALENTS: Readonly<Record<string, string>> = {
  "261917": "Sharp Reflexes",
  "116645": "Teachings of the Monastery",
  "137384": "Combo Breaker",
  "451485": "Brawler's Intensity",
  "443294": "Heart of the Jade Serpent",
  "451576": "Communion With Wind",
  [ZENITH]: "Zenith",
};

interface IPair {
  /** impossible re-presses of holders */
  p: number;
  /** every re-press of holders */
  o: number;
}
interface IRow {
  presses: number;
  impossible: number;
  talents: Record<string, IPair>;
  /** seconds still short after 1 s a Blackout Kick (2 s inside a Zenith),
   * whole-second bins; `<0` = covered */
  shortAfterBok: Record<string, number>;
  /** impossible re-presses after a shared-pool press: whole seconds from
   * that press to the re-press (12 = 12 or more) */
  afterShared: Record<string, number>;
  /** …and from the entry's own press before to that shared-pool press */
  sharedAfterOwn: Record<string, number>;
}
let rows = new Map<string, IRow>();
/** `<spell> <id> | spec <spec>` → entries with a press of the shared charge
 * pool, those presses, and the ones a give-back acted on */
let pools = new Map<
  string,
  { entries: number; shared: number; moved: number }
>();
/** `<trigger>` → instants with the kick down for 3 s more on the static
 * cooldown, and those followed by a kick press within 3 s */
let follow = new Map<string, { n: number; hit: number }>();
/** Blackout Kick! applications by how far behind the unit's last Tiger
 * Palm they come */
let palmLag: Record<string, number> = {};
const TIGER_PALM = "100780";
/** the effect counts as Tiger Palm's when the unit's last Tiger Palm is at
 * most this far before it (the lag histogram: ≤ 0.05 s or ≥ 0.5 s) */
const PALM_PAIR_S = 0.5;
const followOf = (k: string) => {
  let f = follow.get(k);
  if (!f) follow.set(k, (f = { n: 0, hit: 0 }));
  return f;
};
/** the kick's static cooldown, and how long after a trigger a press counts */
const KICK_CD_S = 9;
const FOLLOW_S = 3;
/** every spell an event-reduction row gives back to */
const REDUCED_IDS: readonly string[] = [
  ...new Set(
    Object.values(EVENT_COOLDOWN_REDUCTIONS).flatMap((r) => r.targets),
  ),
];
const rowOf = (name: string): IRow => {
  let r = rows.get(name);
  if (!r)
    rows.set(
      name,
      (r = {
        presses: 0,
        impossible: 0,
        talents: {},
        shortAfterBok: {},
        afterShared: {},
        sharedAfterOwn: {},
      }),
    );
  return r;
};

function before(cd: IMajorCooldownInfo, t: number): IMajorCooldownInfo {
  const keep = (c: { timeSeconds: number }) => c.timeSeconds < t;
  return {
    ...cd,
    casts: cd.casts.filter(keep),
    ...(cd.sharedCasts ? { sharedCasts: cd.sharedCasts.filter(keep) } : {}),
  };
}

function heldTalents(u: any): Set<string> {
  const specId = parseInt(u?.spec ?? "", 10);
  const talents = u ? talentsOf(u) : undefined;
  const out = new Set<string>();
  if (Number.isNaN(specId) || !talents?.length) return out;
  const ranks = getPlayerTalentRanks(specId, talents);
  if (!ranks) return out;
  for (const [id, rank] of ranks) if (rank > 0) out.add(String(id));
  return out;
}

export function run(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  const sec = (ms: number) => (ms - ctx.legacy.startTime) / 1000;
  // every entry the shared-pool give-back can touch: a spell with an
  // event-reduction row whose entry holds a press of its charge pool
  for (const u of ctx.players as any[]) {
    for (const id of REDUCED_IDS) {
      let cd: IMajorCooldownInfo | undefined;
      try {
        cd = unitCooldownEntry(u, ctx.legacy, id);
      } catch {
        continue;
      }
      if (!cd?.sharedCasts?.length || (cd.charges ?? 1) > 1) continue;
      const k = `${cd.spellName} ${id} | spec ${u.spec}`;
      let p = pools.get(k);
      if (!p) pools.set(k, (p = { entries: 0, shared: 0, moved: 0 }));
      p.entries += 1;
      p.shared += cd.sharedCasts.length;
      p.moved += cd.sharedCasts.filter(
        (c) =>
          (c.reductions?.length ?? 0) > 0 ||
          (c.cooldownSecondsOverride !== undefined &&
            c.cooldownSecondsOverride < cd!.cooldownSeconds - 1e-6),
      ).length;
    }
  }
  for (const u of ctx.players as any[]) {
    if (String(u.spec) !== WINDWALKER) continue;
    const held = heldTalents(u);
    const casts = successesOf(u).map((c: any) => ({
      id: String(c.spellId),
      t: sec(tsOf(c)),
      line: c.logLine?.lineIndex as number | undefined,
    }));
    const selfRows = ((u.auraEvents ?? []) as any[]).filter(
      (r) => r.destUnitId === u.id && r.srcUnitId === u.id,
    );
    /** was the unit's own aura `id` up at any instant of (a, b)? */
    const auraUpIn = (id: string, a: number, b: number): boolean => {
      let up = false;
      for (const r of selfRows) {
        if (r.spellId !== id) continue;
        const t = sec(tsOf(r));
        if (t >= b) break;
        if (ev(r) === APPLIED) up = true;
        else if (ev(r) === REMOVED) {
          if (up && t > a) return true;
          up = false;
        }
      }
      return up;
    };
    /** the (from, to) spans the unit's own aura `id` was up */
    const spansOf = (id: string): Array<[number, number]> => {
      const out: Array<[number, number]> = [];
      let from: number | undefined;
      for (const r of selfRows) {
        if (r.spellId !== id) continue;
        const t = sec(tsOf(r));
        if (ev(r) === APPLIED && from === undefined) from = t;
        else if (ev(r) === REMOVED && from !== undefined) {
          out.push([from, t]);
          from = undefined;
        }
      }
      if (from !== undefined) out.push([from, Number.POSITIVE_INFINITY]);
      return out;
    };
    const zenithSpans = spansOf(ZENITH);
    // Is a reset real? At an instant with the kick down for at least
    // FOLLOW_S more on its static cooldown (the last press of either kick
    // id at most KICK_CD_S − FOLLOW_S before), a kick press inside FOLLOW_S
    // needs the cooldown to have come back early. The share after each
    // trigger against the share at the round's other whole seconds.
    {
      const kicks = casts
        // the kick's own id on both sides: a Windwalker's Rushing Wind
        // Kick is pressed while the kick is down and proves nothing back
        // (codex 85-tk-L8-T289-1 #2)
        .filter((x) => x.id === "107428")
        .map((x) => x.t)
        .sort((a, b) => a - b);
      const down = (x: number): boolean => {
        let last: number | undefined;
        for (const k of kicks) if (k < x) last = k;
        return last !== undefined && x - last <= KICK_CD_S - FOLLOW_S;
      };
      // a kick in the trigger's own millisecond answers it when its row
      // comes after the trigger's (codex 85-tk-L8-T289-1d, f95bfff9: Zenith
      // at line 1232, the kick at 1236, both 25.690 s)
      const answeredInMs = new Set<number>();
      for (const z of casts)
        if (
          z.id === ZENITH &&
          z.line !== undefined &&
          casts.some(
            (k) =>
              k.id === "107428" &&
              k.t === z.t &&
              k.line !== undefined &&
              k.line > z.line!,
          )
        )
          answeredInMs.add(z.t);
      const pressedAfter = (x: number): boolean =>
        answeredInMs.has(x) || kicks.some((k) => k > x && k <= x + FOLLOW_S);
      const zenithAt = held.has(ZENITH)
        ? casts.filter((x) => x.id === ZENITH).map((x) => x.t)
        : [];
      const tigerPalmAt = casts
        .filter((x) => x.id === TIGER_PALM)
        .map((x) => x.t);
      /** seconds from the unit's last Tiger Palm to `x`; undefined: none */
      const sincePalm = (x: number): number | undefined => {
        let last: number | undefined;
        for (const p of tigerPalmAt) if (p <= x + 1e-6) last = p;
        return last === undefined ? undefined : x - last;
      };
      const allProcAt = held.has("137384")
        ? selfRows
            .filter((r) => r.spellId === BOK_PROC && ev(r) === APPLIED)
            .map((r) => sec(tsOf(r)))
        : [];
      // how far behind a Tiger Palm the effect goes up
      for (const x of allProcAt) {
        const d = sincePalm(x);
        const k =
          d === undefined
            ? "no Tiger Palm before"
            : d <= 0.05
              ? "≤ 0.05 s"
              : d <= 0.25
                ? "≤ 0.25 s"
                : d <= 0.5
                  ? "≤ 0.5 s"
                  : d <= 1
                    ? "≤ 1 s"
                    : "later";
        palmLag[k] = (palmLag[k] ?? 0) + 1;
      }
      const byPalm = (x: number) => {
        const d = sincePalm(x);
        return d !== undefined && d <= PALM_PAIR_S;
      };
      const procAt = allProcAt.filter(byPalm);
      const otherProcAt = allProcAt.filter((x) => !byPalm(x));
      const endS = (ctx.roundEndAt - ctx.legacy.startTime) / 1000;
      const tally = (k: string, at: readonly number[]) => {
        for (const x of at) {
          // FOLLOW_S of play left to answer in, for a trigger as for the
          // baseline (codex 85-tk-L8-T289-1b #2)
          if (x >= endS - FOLLOW_S) continue;
          if (!down(x)) continue;
          const f = followOf(k);
          f.n += 1;
          if (pressedAfter(x)) f.hit += 1;
        }
      };
      tally("Zenith press", zenithAt);
      tally("Blackout Kick! effect with a Tiger Palm ≤ 0.5 s before", procAt);
      tally("Blackout Kick! effect, no Tiger Palm beside it", otherProcAt);
      const all = [...zenithAt, ...allProcAt];
      const grid: number[] = [];
      for (let x = 1; x < endS - FOLLOW_S; x += 1)
        if (!all.some((a) => Math.abs(a - x) <= FOLLOW_S)) grid.push(x);
      // the trigger cohort's own baseline: a unit that holds no Zenith
      // gives neither side (codex 85-tk-L8-T289-1c #5)
      if (held.has(ZENITH))
        tally("no trigger within 3 s (every whole second)", grid);
    }
    for (const [spellId, name] of Object.entries(TARGETS)) {
      let cd: IMajorCooldownInfo | undefined;
      try {
        cd = unitCooldownEntry(u, ctx.legacy, spellId);
      } catch {
        continue;
      }
      if (!cd || cd.isProcOnly) continue;
      const row = rowOf(name);
      for (const [i, c] of cd.casts.entries()) {
        if (i === 0 || c.freeRecast) continue;
        const t = c.timeSeconds;
        const prior = before(cd, t);
        const prev = prior.casts[prior.casts.length - 1];
        if (!prev) continue;
        ctx.bump("wwRecast");
        row.presses += 1;
        const impossible =
          !cdAvailableAt(prior, t) && !cdMaybeAvailableAt(prior, t);
        for (const id of Object.keys(TALENTS)) {
          if (!held.has(id)) continue;
          const pair = (row.talents[id] ??= { p: 0, o: 0 });
          pair.o += 1;
          if (impossible) pair.p += 1;
        }
        if (!impossible) continue;
        row.impossible += 1;
        const gap = t - prev.timeSeconds;
        const short = cdSecondsUntilReady(prior, t);
        const inGap = (x: { t: number }) => x.t > prev.timeSeconds && x.t < t;
        const boks = casts.filter((x) => x.id === BLACKOUT_KICK && inGap(x));
        const bokSeconds = boks.reduce(
          (n, x) =>
            n + (zenithSpans.some(([a, b]) => x.t >= a && x.t <= b) ? 2 : 1),
          0,
        );
        // what the model already took for the press before is not taken
        // again (codex 85-tk-L8-T289-1 #3)
        const priced = (prev.reductions ?? [])
          .filter((r) => r.atSeconds < t && Number.isFinite(r.seconds))
          .reduce((n, r) => n + r.seconds, 0);
        const after = short - Math.max(0, bokSeconds - priced);
        const bin = after <= 0 ? "<0" : String(Math.floor(after));
        row.shortAfterBok[bin] = (row.shortAfterBok[bin] ?? 0) + 1;
        // seconds from the last shared-pool press to this one, and from the
        // entry's own press before that shared press to it
        let sharedAt: number | undefined;
        const shared = new Map<string, number>();
        for (const e of (u.spellCastEvents ?? []) as any[]) {
          const at = sec(tsOf(e));
          if (at <= prev.timeSeconds || at >= t) continue;
          if (!spendsSharedChargeOf(e, spellId, String(u.spec))) continue;
          sharedAt = at;
          shared.set(
            String(e.spellId),
            (shared.get(String(e.spellId)) ?? 0) + 1,
          );
        }
        if (sharedAt !== undefined) {
          const b = String(Math.min(12, Math.floor(t - sharedAt)));
          row.afterShared[b] = (row.afterShared[b] ?? 0) + 1;
          const b2 = String(
            Math.min(12, Math.floor(sharedAt - prev.timeSeconds)),
          );
          row.sharedAfterOwn[b2] = (row.sharedAfterOwn[b2] ?? 0) + 1;
        }
        const burst = casts.some(
          (x) => (x.id === ZENITH || x.id === SEF) && inGap(x),
        );
        const proc = selfRows.some(
          (r) =>
            r.spellId === BOK_PROC &&
            ev(r) === APPLIED &&
            sec(tsOf(r)) > prev.timeSeconds &&
            sec(tsOf(r)) < t,
        );
        const serpent = auraUpIn(JADE_SERPENT, prev.timeSeconds, t);
        const ratio = gap / (gap + short);
        const reading: (typeof READINGS)[number] =
          shared.size > 0
            ? "a press of the shared charge pool between"
            : burst
              ? "Zenith / SEF press between"
              : proc
                ? "Blackout Kick! proc between"
                : boks.length > 0 && after <= 0
                  ? "Blackout Kicks cover it"
                  : boks.length > 0
                    ? "Blackout Kick between, not covered"
                    : serpent
                      ? "Heart of the Jade Serpent up"
                      : ratio >= 0.7
                        ? "at 0.7–1.0 of the cooldown"
                        : "none of these";
        ctx.violate(
          "wwRecast",
          `${name} | ${reading}`,
          ctx.start + t * 1000,
          `${ctx.roundKey}|${u.id}|${spellId}|${Math.floor(t)}`,
          `${name} ${spellId} at ${t.toFixed(1)}s: ${gap.toFixed(1)}s after the press before, model ${cd.cooldownSeconds}s x${cd.charges ?? 1}, ${short.toFixed(1)}s short (${ratio.toFixed(2)} of it); Blackout Kicks in the gap ${boks.length} = ${bokSeconds}s, Zenith / SEF press ${burst ? "yes" : "no"}, Blackout Kick! proc ${proc ? "yes" : "no"}, Heart of the Jade Serpent ${serpent ? "up" : "no"}, shared-pool presses ${[...shared].map(([k, n]) => `${k}:${n}`).join(" ") || "none"}${sharedAt === undefined ? "" : ` (the last ${(t - sharedAt).toFixed(1)}s before this press, ${(sharedAt - prev.timeSeconds).toFixed(1)}s after the own press before)`}; holds ${
            Object.entries(TALENTS)
              .filter(([id]) => held.has(id))
              .map(([, n]) => n)
              .join(", ") || "none read"
          }`,
        );
      }
    }
  }
}

export function report(): string[] {
  const out = [
    "t289 — Windwalker re-presses the model has not back (impossible / re-presses; per talent: holders' impossible / holders' re-presses; seconds short after 1 s a Blackout Kick, 2 s inside a Zenith):",
  ];
  for (const [name, r] of rows) {
    out.push(
      `  ${name}: ${r.impossible} / ${r.presses}; ${Object.entries(r.talents)
        .map(([id, p]) => `${TALENTS[id]} ${p.p}/${p.o}`)
        .join(", ")}; short after Blackout Kicks s:n ${Object.entries(
        r.shortAfterBok,
      )
        .sort(
          (a, b) =>
            (a[0] === "<0" ? -1 : Number(a[0])) -
            (b[0] === "<0" ? -1 : Number(b[0])),
        )
        .map(([s, n]) => `${s}:${n}`)
        .join(" ")}`,
    );
  }
  const bins = (h: Record<string, number>) =>
    Object.entries(h)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([k, n]) => `${k}:${n}`)
      .join(" ");
  for (const [name, r] of rows)
    if (Object.keys(r.afterShared).length)
      out.push(
        `  ${name}, impossible after a shared-pool press — seconds from that press to the re-press s:n ${bins(r.afterShared)}; from the own press before to the shared press s:n ${bins(r.sharedAfterOwn)}`,
      );
  out.push(
    "t289 — is a reset real: instants with the kick down for 3 s more on its static 9 s, followed by a kick press within 3 s / such instants:",
  );
  for (const [k, f] of follow)
    out.push(
      `  ${k}: ${f.hit} / ${f.n} (${f.n ? ((100 * f.hit) / f.n).toFixed(1) : "-"}%)`,
    );
  out.push(
    `t289 — Blackout Kick! applications of Combo Breaker holders by the time since the unit's last Tiger Palm: ${Object.entries(
      palmLag,
    )
      .map(([k, n]) => `${k} ${n}`)
      .join(", ")}`,
  );
  out.push(
    "t289 — single-charge entries with an event-reduction row and a press of their shared charge pool (entries; shared presses; shared presses a give-back acted on):",
  );
  for (const [k, p] of [...pools].sort((a, b) => b[1].shared - a[1].shared))
    out.push(`  ${k}: ${p.entries}; ${p.shared}; ${p.moved}`);
  return out;
}

export const state = () => ({ rows, pools, follow, palmLag });
export const load = (s: ReturnType<typeof state>): void => {
  ({ rows, pools, follow, palmLag } = s);
};

/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, casts, aura rows) */
/**
 * scan5/t316.ts — pipeline T316: the residual of four cooldowns whose
 * scripted reduction the model already carries, and whose unit still pressed
 * before the model's ready time. A measurement (count first): which presses
 * the model has impossible is the product's own reading — the ledger
 * (`extractMajorCooldowns`) and `cdAvailableAt` / `cdMaybeAvailableAt` /
 * `cdSecondsUntilReady`, exactly scan5/t135's `ledgerPressBeforeBack` — and
 * this module adds, per such press, what the log shows inside the gap.
 *
 *  - `cdResidual`: a ledger press of one of `TARGETS` that the model has
 *    not back yet. Kind = the spell. Counted: every press after the entry's
 *    first that is not a free one. Out of the total: a question, not a
 *    product error, until the mechanism is found.
 *
 * The detail carries the gap, the model's cooldown, the idle credit and the
 * reductions the model took for the press before, and per spell:
 *  - Incarnation: Tree of Life — Grove Guardians (102693) the unit summoned
 *    in the gap, how many had been out 8 s by the press, the Incarnation
 *    buff (117679) rows with no press beside them, and the seconds a fade
 *    would have to be worth for the press to be possible;
 *  - Dark Harvest — the unit's Unstable Affliction / Seed of Corruption
 *    casts in the gap, its aura rows of the two with no cast beside them,
 *    and how many more 1.5 s triggers the press needs;
 *  - Soul Immolation — Void Metamorphosis (1217607) rows on the unit in the
 *    gap and the presses in the 30 s before;
 *  - Guardian Spirit — the two presses' targets, and when the first buff
 *    left its target.
 * Every row also names the unit's own auras that went up in the 3 s before
 * the press, its summons by id (Tree of Life) and its trigger rows by event
 * and id (Dark Harvest).
 *
 * What the passes found (jobs T316-1 to -4 on the wsl2 base capture,
 * 605 | the 12.1.5 files; all still open, none priced):
 *  - Soul Immolation 7 | 4 — a hypothesis for T335, not shown: Undying
 *    Embers 1272405 (`has a chance to reignite after it expires,
 *    reapplying its effect`) read as a press. 7 of the 11 sit about
 *    11–14 s after the press before; one (5f4d0319 r4) is a
 *    SPELL_CAST_SUCCESS 4.5 s after the aura went up, refreshing an aura
 *    still up — no reignite after expiry (codex 85-tk-L8-T316-1c #2).
 *  - Guardian Spirit 3 | 0 — Divine Hymn 64843 (`You gain Guardian Spirit
 *    while channeling Divine Hymn`): 2 of the 3 have Divine Hymn going up
 *    in the 3 s before; the third has none.
 *  - Dark Harvest 6 | 1 — each short by one 1.5 s trigger of Cull the Weak
 *    (0.8–1.5 s). In the gap: 5–11 SPELL_CAST_START and 4–9
 *    SPELL_CAST_SUCCESS rows of Unstable Affliction 1259790 (the scan
 *    reads neither FAILED nor MISSED rows: a SUCCESS is not a hit, and
 *    START minus SUCCESS is not the count of failed casts), no Seed of
 *    Corruption; in all seven, 1–4 Unstable Affliction aura rows of the
 *    unit have no SUCCESS row of it in the 2.5 s before; in 2 of the 7 a
 *    START in the 2.5 s before the press before has no SUCCESS by it.
 *    Leads, not a mechanism: the row is unchanged.
 *  - Tree of Life 6 | 3 — 4.4–13.8 s short, 5.3–6.2 s a fade needed against
 *    the tooltip's 5.0, the fades counted by their own time (a guardian
 *    out before the press before fades inside the gap too).
 *    Each has a Reforestation tree and 2–4 Sylvan Beckoning dryads
 *    (1264618 / 1264911), neither tied to the cooldown by a tooltip. No
 *    mechanism.
 * Recorded singles of the same list (one round each, their rows' reductions
 * in `EVENT_COOLDOWN_REDUCTIONS` unchanged): Frozen Orb 28.8 s apart (White
 * Out, 4.5 s short), Slayer Bladestorm 37.9 s apart (Unrelenting Onslaught,
 * 42.1 s short), Ray of Frost 54.1 s apart (Glaciate, 5.9 s short), Crimson
 * Vial 29.1 s against 30. One Retribution paladin, one archive (2859d3c8,
 * four rounds): Divine Protection 63.3 / 67.7 / 69.1 s against 72 and
 * Blessing of Sacrifice 84.6 / 89.4 s against 90, 0.7–12.1 % early — both
 * came back early for that player; no cause identified, no DB2 row gives
 * one. First Ascendant
 * 462440 (Healing Tide Totem −60 s) and Graceful Spirit 192088
 * (Spiritwalker's Grace −30 s) are already priced (`talentModifiers.json`):
 * the Healing Tide fact was the kit's floor, a quantile printed as a bound
 * (`ownShortestRecast` caps it now).
 *
 * `report()` adds, for Tree of Life, the distribution over EVERY recast of
 * the seconds per faded guardian the recast needs (a recast can come later
 * than the cooldown, so the real value is at least the largest of them).
 */
import {
  cdAvailableAt,
  cdMaybeAvailableAt,
  cdSecondsUntilReady,
  extractMajorCooldowns,
  type IMajorCooldownInfo,
} from "@gladlog/analysis/src/utils/cooldowns";
import {
  parseRawTimestamp,
  splitRawLine,
} from "@gladlog/analysis/src/utils/rawStreams";

import {
  APPLIED,
  ev,
  type IRoundCtx,
  REFRESH,
  REMOVED,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = ["cdResidual"] as const;

const TREE = new Set(["33891", "473909"]);
const DARK_HARVEST = "1257052";
const SOUL_IMMOLATION = "1241937";
const GUARDIAN_SPIRIT = "47788";
const TARGETS: Readonly<Record<string, string>> = {
  "33891": "Incarnation: Tree of Life",
  "473909": "Incarnation: Tree of Life",
  [DARK_HARVEST]: "Dark Harvest",
  [SOUL_IMMOLATION]: "Soul Immolation",
  [GUARDIAN_SPIRIT]: "Guardian Spirit",
};
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set(
  [...new Set(Object.values(TARGETS))].map((n) => `cdResidual|${n}`),
);

const GROVE_GUARDIAN = "102693";
const GUARDIAN_LIFE_S = 8;
const INCARNATION_BUFF = "117679";
const UA = "1259790";
const DIVINE_HYMN = "64843";
const SEED = "27243";
const VOID_META = "1217607";

/** seconds per faded guardian a Tree of Life recast needs, 0.5 s bins */
let treeNeed: Record<string, number> = {};
let treePairs = 0;

/** the entry with only the presses before `t` (scan5/t135's view) */
function before(cd: IMajorCooldownInfo, t: number): IMajorCooldownInfo {
  const keep = (c: { timeSeconds: number }) => c.timeSeconds < t;
  return {
    ...cd,
    casts: cd.casts.filter(keep),
    ...(cd.sharedCasts ? { sharedCasts: cd.sharedCasts.filter(keep) } : {}),
  };
}

export function run(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  const sec = (ms: number) => (ms - ctx.legacy.startTime) / 1000;
  let summons: Array<{ src: string; t: number; id: string }> | undefined;
  const allSummonsOf = (unitId: string) => {
    if (!summons) {
      summons = [];
      for (const l of ctx.rawLines as string[]) {
        if (!l.includes("SPELL_SUMMON")) continue;
        const parts = splitRawLine(l);
        if (!parts || parts.eventName !== "SPELL_SUMMON") continue;
        const ms = parseRawTimestamp(parts.datePart);
        if (ms === null) continue;
        summons.push({
          src: parts.params[0] ?? "",
          t: sec(ms),
          id: parts.params[8] ?? "",
        });
      }
    }
    return summons.filter((s) => s.src === unitId);
  };
  const summonsOf = (unitId: string): number[] =>
    allSummonsOf(unitId)
      .filter((s) => s.id === GROVE_GUARDIAN)
      .map((s) => s.t);

  for (const u of ctx.players as any[]) {
    let entries: IMajorCooldownInfo[];
    try {
      entries = extractMajorCooldowns(u, ctx.legacy);
    } catch {
      continue;
    }
    for (const cd of entries) {
      const name = TARGETS[cd.spellId];
      if (!name || cd.isProcOnly) continue;
      const casts = successesOf(u);
      const castsIn = (ids: readonly string[], a: number, b: number) =>
        casts.filter((c) => {
          const t = sec(tsOf(c));
          return ids.includes(String(c.spellId)) && t > a && t < b;
        });
      const selfAura = (id: string, a: number, b: number, events: string[]) =>
        ((u.auraEvents ?? []) as any[]).filter((r) => {
          const t = sec(tsOf(r));
          return (
            r.spellId === id &&
            r.destUnitId === u.id &&
            events.includes(ev(r)) &&
            t > a &&
            t < b
          );
        });
      /** guardians whose 8 s ran out inside (a, b] */
      const fadesIn = (a: number, b: number): number =>
        summonsOf(u.id).filter(
          (s) => s + GUARDIAN_LIFE_S > a && s + GUARDIAN_LIFE_S <= b,
        ).length;
      for (const [i, c] of cd.casts.entries()) {
        if (i === 0 || c.freeRecast) continue;
        const t = c.timeSeconds;
        const prior = before(cd, t);
        const prev = prior.casts[prior.casts.length - 1]!;
        const gap = t - prev.timeSeconds;
        const idle = prev.idleCreditSeconds ?? 0;
        if (TREE.has(cd.spellId)) {
          const faded = fadesIn(prev.timeSeconds, t);
          if (faded > 0 && gap < cd.cooldownSeconds - idle) {
            treePairs += 1;
            const need = (cd.cooldownSeconds - idle - gap) / faded;
            const b = (Math.floor(need * 2) / 2).toFixed(1);
            treeNeed[b] = (treeNeed[b] ?? 0) + 1;
          }
        }
        ctx.bump("cdResidual");
        if (cdAvailableAt(prior, t) || cdMaybeAvailableAt(prior, t)) continue;
        const short = cdSecondsUntilReady(prior, t);
        const taken = (prev.reductions ?? []).filter(
          (r) => r.atSeconds <= t && Number.isFinite(r.seconds),
        );
        const head = `${u.spec} ${name} ${cd.spellId} at ${t.toFixed(1)}s: ${gap.toFixed(1)}s after the press before, model ${cd.cooldownSeconds}s x${cd.charges ?? 1}, idle credit ${idle.toFixed(1)}s, ${taken.length} reductions = ${taken.reduce((n, r) => n + r.seconds, 0).toFixed(1)}s, ${short.toFixed(1)}s short`;
        // the unit's own auras that went up in the 3 s before the press: what
        // a reset would ride on
        const nearUp = new Map<string, number>();
        for (const r of (u.auraEvents ?? []) as any[]) {
          const at = sec(tsOf(r));
          if (r.destUnitId !== u.id || ev(r) !== APPLIED) continue;
          if (at < t - 3 || at > t + 0.2) continue;
          const k = `${r.spellName ?? "?"} ${r.spellId}`;
          nearUp.set(k, (nearUp.get(k) ?? 0) + 1);
        }
        const near = `; own auras up in the 3 s before: ${[...nearUp.keys()].slice(0, 12).join(", ") || "none"}`;
        let more = "";
        if (TREE.has(cd.spellId)) {
          const all = summonsOf(u.id).filter(
            (s) => s > prev.timeSeconds && s < t,
          );
          // by the fade's own time: a guardian out before the press before
          // fades inside the gap too (codex 85-tk-L8-T316-1 #4)
          const faded = fadesIn(prev.timeSeconds, t);
          const pressTimes = cd.casts.map((x) => x.timeSeconds);
          const procs = selfAura(INCARNATION_BUFF, prev.timeSeconds, t, [
            APPLIED,
          ]).filter(
            (r) => !pressTimes.some((p) => Math.abs(p - sec(tsOf(r))) < 0.5),
          ).length;
          // every summon of the unit in the gap and the 8 s before it, by id
          const byId = new Map<string, number>();
          for (const x of allSummonsOf(u.id)) {
            if (x.t <= prev.timeSeconds - GUARDIAN_LIFE_S || x.t >= t) continue;
            byId.set(x.id, (byId.get(x.id) ?? 0) + 1);
          }
          const pre = summonsOf(u.id).filter(
            (x) =>
              x > prev.timeSeconds - GUARDIAN_LIFE_S && x <= prev.timeSeconds,
          ).length;
          more = `guardians summoned ${all.length}, out 8 s by the press ${faded}, summoned in the 8 s before the press before ${pre}, Incarnation buff with no press ${procs}, needs ${faded > 0 ? ((cd.cooldownSeconds - idle - gap) / faded).toFixed(2) : "-"}s a fade; summons by id ${[...byId].map(([k, n]) => `${k}:${n}`).join(" ")}`;
        } else if (cd.spellId === DARK_HARVEST) {
          const ua = castsIn([UA], prev.timeSeconds, t).length;
          const seed = castsIn([SEED], prev.timeSeconds, t).length;
          const castTimes = castsIn([UA, SEED], prev.timeSeconds, t).map((x) =>
            sec(tsOf(x)),
          );
          let rowsNoCast = 0;
          for (const d of ctx.units as any[])
            for (const r of (d.auraEvents ?? []) as any[]) {
              if (r.srcUnitId !== u.id || r.destUnitId !== d.id) continue;
              if (r.spellId !== UA && r.spellId !== SEED) continue;
              if (ev(r) !== APPLIED && ev(r) !== REFRESH) continue;
              const at = sec(tsOf(r));
              if (at <= prev.timeSeconds || at >= t) continue;
              if (!castTimes.some((p) => at - p >= -0.1 && at - p <= 2.5))
                rowsNoCast += 1;
            }
          const needed = (cd.cooldownSeconds - gap) / 1.5;
          // every row of the unit named like a trigger, by event and id; and
          // the triggers that straddle the press before
          const named = new Map<string, number>();
          let startedBefore = 0;
          let landedJustBefore = 0;
          // the parser keeps cast STARTs apart (`castStartEvents`): read
          // both lists (codex 85-tk-L8-T316-1b #1: every start was dropped)
          for (const x of [
            ...((u.spellCastEvents ?? []) as any[]),
            ...((u.castStartEvents ?? []) as any[]),
          ]) {
            const at = sec(tsOf(x));
            const n = String(x.spellName ?? "");
            if (
              String(x.spellId) !== UA &&
              String(x.spellId) !== SEED &&
              !/Unstable Affliction|Seed of Corruption/.test(n)
            )
              continue;
            const e = ev(x);
            if (at > prev.timeSeconds && at < t) {
              const k = `${e.replace("SPELL_CAST_", "")} ${x.spellId}`;
              named.set(k, (named.get(k) ?? 0) + 1);
            }
            if (
              e === "SPELL_CAST_START" &&
              at > prev.timeSeconds - 2.5 &&
              at <= prev.timeSeconds
            )
              startedBefore += 1;
            if (
              e === "SPELL_CAST_SUCCESS" &&
              at > prev.timeSeconds - 2.5 &&
              at <= prev.timeSeconds
            )
              landedJustBefore += 1;
          }
          more = `UA casts ${ua}, Seed casts ${seed}, UA / Seed aura rows with no cast ≤ 2.5 s before ${rowsNoCast}, the press needs ${needed.toFixed(2)} triggers; rows by event and id ${[...named].map(([k, n]) => `${k}:${n}`).join(" ")}; in the 2.5 s before the press before: started ${startedBefore}, landed ${landedJustBefore}`;
        } else if (cd.spellId === SOUL_IMMOLATION) {
          const meta = selfAura(VOID_META, prev.timeSeconds - 0.5, t, [
            APPLIED,
          ]).map((r) => sec(tsOf(r)).toFixed(1));
          const metaOff = selfAura(VOID_META, prev.timeSeconds - 0.5, t, [
            REMOVED,
          ]).map((r) => sec(tsOf(r)).toFixed(1));
          const recent = cd.casts.filter(
            (x) => x.timeSeconds > t - 30 && x.timeSeconds < t,
          ).length;
          more = `Void Metamorphosis applied at [${meta.join(", ")}], removed at [${metaOff.join(", ")}], presses in the 30 s before ${recent}, log date ${new Date(ctx.start).toISOString().slice(0, 10)}`;
        } else if (cd.spellId === GUARDIAN_SPIRIT) {
          const rows = casts.filter(
            (x) => String(x.spellId) === GUARDIAN_SPIRIT,
          );
          const at = (s: number) =>
            rows.find((x) => Math.abs(sec(tsOf(x)) - s) < 0.3)?.destUnitId;
          // no cast row at an endpoint (the aura alone dates it): the unit
          // the priest's Guardian Spirit went up on then (codex
          // 85-tk-L8-T316-1 #5)
          const auraAt = (s: number): string | undefined => {
            for (const d of ctx.units as any[])
              for (const r of (d.auraEvents ?? []) as any[])
                if (
                  r.spellId === GUARDIAN_SPIRIT &&
                  r.srcUnitId === u.id &&
                  ev(r) === APPLIED &&
                  Math.abs(sec(tsOf(r)) - s) < 0.3
                )
                  return d.id as string;
            return undefined;
          };
          const cast0 = at(prev.timeSeconds);
          const d0 = cast0 ?? auraAt(prev.timeSeconds);
          const d1 = at(t) ?? auraAt(t);
          const target = (ctx.units as any[]).find((x) => x.id === d0);
          const off = ((target?.auraEvents ?? []) as any[])
            .filter(
              (r) =>
                r.spellId === GUARDIAN_SPIRIT &&
                r.srcUnitId === u.id &&
                ev(r) === REMOVED &&
                sec(tsOf(r)) >= prev.timeSeconds,
            )
            .map((r) => (sec(tsOf(r)) - prev.timeSeconds).toFixed(1))[0];
          const hymn = castsIn(
            [DIVINE_HYMN],
            prev.timeSeconds - 0.5,
            prev.timeSeconds + 0.5,
          ).length;
          more = `targets ${d0 === undefined || d1 === undefined ? "?" : d0 === d1 ? "same" : "different"}, the first buff left its target ${off ?? "?"}s after its ${cast0 === undefined ? "application (no cast row)" : "press"}, Divine Hymn casts within 0.5 s of it ${hymn}, press ${prev.unreleased ? "unreleased" : "landed"}`;
        }
        ctx.violate(
          "cdResidual",
          name,
          ctx.start + t * 1000,
          `${ctx.roundKey}|${u.id}|${cd.spellId}|${Math.floor(t)}`,
          `${head}; ${more}${near}`,
        );
      }
    }
  }
}

export function report(): string[] {
  const bins = Object.entries(treeNeed).sort(
    (a, b) => Number(a[0]) - Number(b[0]),
  );
  return [
    `t316 — Tree of Life recasts under the model's cooldown with ≥ 1 faded guardian: ${treePairs}; seconds a fade must be worth, s:n ${bins.map(([s, n]) => `${s}:${n}`).join(" ")}`,
  ];
}

export const state = () => ({ treeNeed, treePairs });
export const load = (s: ReturnType<typeof state>): void => {
  ({ treeNeed, treePairs } = s);
};

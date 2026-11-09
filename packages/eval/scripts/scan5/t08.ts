/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, damageIn, auraEvents) */
/**
 * scan5/t08.ts — T08 (fact12 D32, D33): two round-boundary readings.
 *
 *  - `deathTeardownEarly` (D32): an `[ENEMY DEF] … (Ns — removed early)` line
 *    whose aura came off in its holder's death teardown. The game strips a
 *    dying unit's auras in the millisecond of the lethal hit and can write
 *    UNIT_DIED later (f13566f0 r0 2:17: the Obsidian Scales copy's REMOVED,
 *    PARTY_KILL and the Bladestorm with overkill at 37.841, UNIT_DIED at
 *    37.966, 125 ms on — the line said "removed early", the legend keeps that
 *    for "the log gives no cause"). Truth:
 *    the producer's own event behind the line (`enemyDefensiveEvents` of its
 *    caster: its second, spell and recipient) whose closing row the
 *    producer's own predicate reads as a
 *    death teardown (`deathTeardownWindowsMs` + `removedInDeathTeardown`,
 *    FIX-CONTRACT §7: the scan calls the producer's selection) — the line
 *    and the predicate disagree.
 *  - `burstSpanPastRoundEnd` (D33): a STAYED IN / KITED line printing a
 *    second (its start, a STAYED end, a KITED peak) whose first instant is at
 *    or after the round's end (`roundEndMs`: a Solo Shuffle round's first
 *    player death, else the log's end). f22d547e r0: "2:20 [Moderate burst]
 *    … (peak at 2:30)", the round over at 2:26.46. A KITED line prints no span
 *    end, so a span that ran past the end with its peak inside is not seen.
 *
 * `report()`: the lag from the lethal hit to UNIT_DIED over every player
 * death with one (each round once).
 */
import {
  ENEMY_DEF_ALSO_ON_RE_SRC,
  ENEMY_DEF_TAG_RE_SRC,
  enemyDefensiveEvents,
  type IEnemyDefensiveEvent,
} from "@gladlog/analysis/src/utils/enemyDefensives";
import { burstSpanSampledPastRoundEnd } from "@gladlog/analysis/src/utils/positionAnalysis";
import { roundEndMs } from "@gladlog/analysis/src/utils/roundEnd";
import {
  deathTeardownWindowsMs,
  removedInDeathTeardown,
} from "@gladlog/analysis/src/utils/unitDeath";

import { deathMs, type IRoundCtx, secOf, tsOf } from "./ctx";

export const CHECKS = ["deathTeardownEarly", "burstSpanPastRoundEnd"] as const;

/** the inventory's own reach — how far before UNIT_DIED an overkill hit is
 * bucketed — wider than the product's LETHAL_HIT_DEATH_LAG_MS on purpose:
 * it measures that bound, it does not select (the checks call the
 * producer's `deathTeardownWindowsMs` / `burstSpanSampledPastRoundEnd`,
 * FIX-CONTRACT §7) */
const LETHAL_DEATH_LAG_MAX_MS = 2000;

/** an `[ENEMY DEF]` line ending `— removed early`, whatever leads its
 * duration — `(Ns …)`, `(30%, Ns …)`, `(absorb Nk, Ns …)` (codex
 * 85-tk-A-T08-2c #1) — and with an immunity's `; also on …` after it
 * (`ENEMY_DEF_ALSO_ON_RE_SRC`, codex 85-tk-A-T08-2e #2); the tag is the
 * shared `ENEMY_DEF_TAG_RE_SRC`, so Ultimate Penitence's shield merged onto
 * its `[ENEMY CD]` line is read too (codex 85-tk-A-T08-2f #2) */
const ENEMY_DEF_EARLY = new RegExp(
  String.raw`^(\d+):(\d\d)\s+${ENEMY_DEF_TAG_RE_SRC}\s+(\d+)\(\S+\) \([^)]*\): (.+?)(?: → (\d+)\(\S+\))? \((?:[^()]*?, )?([\d.]+)s — removed early(?:${ENEMY_DEF_ALSO_ON_RE_SRC})?\)`,
);
const KITED =
  /^\s*(\d+):(\d\d) \[\w+ burst\] opened .*?\(peak at (\d+):(\d\d)\)/;
const STAYED = /^\s*(\d+):(\d\d)–(\d+):(\d\d) \[\w+ burst\] /;

const BUCKETS = [100, 200, 500, 1000, 2000] as const;
let lag: Record<string, number> = {};

/** the inventory's reading: the holder's earliest overkill hit it did not
 * survive before its first death, and the death */
function lethalOf(u: any): { lethal: number; death: number } | undefined {
  const death = deathMs(u);
  if (death === Infinity) return undefined;
  let lethal: number | undefined;
  for (const d of (u.damageIn ?? []) as any[]) {
    const t = tsOf(d);
    if (
      (d.overkill ?? 0) > 0 &&
      t <= death &&
      death - t <= LETHAL_DEATH_LAG_MAX_MS &&
      !((u.advancedActions ?? []) as any[]).some(
        (a) =>
          tsOf(a) > t && tsOf(a) < death && (a.advancedActorCurrentHp ?? 0) > 0,
      )
    )
      lethal = lethal === undefined ? t : Math.min(lethal, t);
  }
  return lethal === undefined ? undefined : { lethal, death };
}

/** the producer's `[ENEMY DEF]` events of one caster, as `enemyDef.ts`
 * builds them (the round's units, the round's end), once per round view */
const EVENTS = new WeakMap<object, Map<string, IEnemyDefensiveEvent[]>>();
function enemyDefEventsOf(ctx: IRoundCtx, caster: any): IEnemyDefensiveEvent[] {
  let byCaster = EVENTS.get(ctx.legacy);
  if (!byCaster) EVENTS.set(ctx.legacy, (byCaster = new Map()));
  let out = byCaster.get(caster.id);
  if (!out) {
    const legacy: any = ctx.legacy;
    const team = (ctx.players as any[]).filter(
      (p) => p.reaction === caster.reaction,
    );
    out = enemyDefensiveEvents(
      caster,
      team,
      {
        startTime: ctx.start,
        endTime: legacy.endTime,
        units: legacy.units ?? {},
      } as any,
      roundEndMs(legacy),
    );
    byCaster.set(caster.id, out);
  }
  return out;
}

export function run(ctx: IRoundCtx): void {
  if (ctx.firstOwnerOfRound)
    for (const u of ctx.players) {
      const l = lethalOf(u);
      if (!l) continue;
      const gap = l.death - l.lethal;
      const b = BUCKETS.find((x) => gap <= x);
      const key = b === undefined ? ">2000" : `<=${b}`;
      lag[key] = (lag[key] ?? 0) + 1;
    }

  const endMs = roundEndMs(ctx.legacy);
  for (const line of ctx.lines) {
    const e = ENEMY_DEF_EARLY.exec(line);
    if (e) {
      const holder: any = ctx.unitOfPid(e[5] ?? e[3]);
      if (!holder) continue;
      // the producer's own selection (FIX-CONTRACT §7): the caster's
      // `[ENEMY DEF]` events as the line was built from them, the one this
      // line prints (its second, its spell, its recipient), and that span's
      // own closing row — REFRESH-started spans, re-broadcast joins and
      // source-less closing rows are the producer's (codex 85-tk-A-T08-2d)
      const caster: any = ctx.unitOfPid(e[3]);
      if (!caster) continue;
      const pressS = +e[1]! * 60 + +e[2]!;
      const spellText = e[4]!;
      const d = enemyDefEventsOf(ctx, caster).find(
        (x) =>
          x.removedEarly &&
          Math.floor(x.atSeconds) === pressS &&
          spellText.startsWith(x.spellName) &&
          // the line's holder: `→ X` is an external on X; no arrow is the
          // caster's own copy, never an ally's event of the same press
          // (codex 85-tk-A-T08-2e #1)
          (e[5] === undefined
            ? x.kind !== "external" &&
              (x.recipientId === undefined || x.recipientId === caster.id)
            : x.kind === "external" && x.recipientId === holder.id),
      );
      if (d?.earlyEndAtMs === undefined) continue;
      ctx.bump("deathTeardownEarly");
      const tornMs = d.earlyEndAtMs;
      const windows = deathTeardownWindowsMs(holder);
      if (!removedInDeathTeardown(windows, tornMs)) continue;
      const w =
        windows.find((x) => removedInDeathTeardown([x], tornMs)) ?? windows[0]!;
      ctx.violate(
        "deathTeardownEarly",
        "removedEarly",
        w.fromMs,
        `${holder.name}|${e[4]}|${pressS}`,
        `${e[4]}: removed +${tornMs - ctx.start} ms, lethal hit +${w.fromMs - ctx.start} ms, UNIT_DIED ${w.deathMs - w.fromMs} ms later; the line says removed early`,
        line,
      );
      continue;
    }
    const k = KITED.exec(line);
    const s = k ? undefined : STAYED.exec(line);
    if (!k && !s) continue;
    ctx.bump("burstSpanPastRoundEnd");
    const printed = k
      ? [secOf(`${k[1]}:${k[2]}`), secOf(`${k[3]}:${k[4]}`)]
      : [secOf(`${s![1]}:${s![2]}`), secOf(`${s![3]}:${s![4]}`)];
    const past = printed.filter((x) =>
      burstSpanSampledPastRoundEnd(ctx.start, endMs, x),
    );
    if (past.length === 0) continue;
    ctx.violate(
      "burstSpanPastRoundEnd",
      k ? "kitedPeak" : "stayedEnd",
      ctx.start + printed[0]! * 1000,
      `${ctx.owner?.name}|${printed[0]}`,
      `printed ${printed.join("/")} s, round over at ${((endMs - ctx.start) / 1000).toFixed(2)} s`,
      line,
    );
  }
}

export function report(): string[] {
  const order = [...BUCKETS.map((b) => `<=${b}`), ">2000"];
  return [
    `t08 inventory — player deaths with a lethal hit (overkill > 0) at most ${LETHAL_DEATH_LAG_MAX_MS} ms before UNIT_DIED, by the lag in ms (each round once): ${order
      .map((k) => `${k}: ${lag[k] ?? 0}`)
      .join(", ")}`,
  ];
}
export const state = () => ({ lag });
export const load = (s: ReturnType<typeof state>): void => {
  ({ lag } = s);
};
export const merge = {
  lag: (a: Record<string, number>, b: Record<string, number>) => {
    for (const [k, v] of Object.entries(b)) a[k] = (a[k] ?? 0) + v;
    return a;
  },
};

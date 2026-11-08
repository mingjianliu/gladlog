/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents) */
/**
 * scan5/unseenSelfAura.ts — fact12 D34: an enemy cooldown pressed while its
 * caster was unseen, whose only trace on the caster is a self aura of
 * ANOTHER id that DB2 names after the press (fcee94ea r0 0:18: Ray of Frost
 * 205021 channelled out of Greater Invisibility — no SUCCESS row, its target
 * debuff 205021 and the mage's own channel buff 269748 re-stated in the
 * batch that re-lists the mage; the timeline numbered the later presses
 * `cast 1 of 2` / `2 of 2`).
 *
 * Truth = the log's rows and DB2 lookups: an enemy's SUCCESS of C (so C is
 * in its kit) printed on `[ENEMY CD]` lines; aura N one of C's class-owned
 * DB2 nominations (`nominatedEffectAurasOfCast`) of C's own English name,
 * other than C; an APPLIED of N from the enemy on itself inside a re-stating batch
 * (`isResyncBatchAt`), N not up before it, no SUCCESS of C within 1 s.
 *
 * Check `unseenSelfAuraPress`, kind `noLine`: no `[ENEMY CD]` line of that
 * enemy's C in the batch's second (±1).
 * `report()`: per (C, N) pair, the own APPLIED rows of N, those within
 * 200 ms of a SUCCESS of C, and those new in a re-stating batch with no
 * SUCCESS of C within 1 s (each round once) — the corpus split behind a
 * press-proof aura.
 */
import { nominatedEffectAurasOfCast } from "@gladlog/analysis/src/data/castEffectAuras";
import { isResyncBatchAt } from "@gladlog/analysis/src/utils/resyncBatch";

import {
  APPLIED,
  ev,
  type IRoundCtx,
  nameOf,
  REFRESH,
  REMOVED,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = ["unseenSelfAuraPress"] as const;

const NEAR_CAST_MS = 200;
const PRESS_ROW_MS = 1000;
/** how far back an earlier row of the aura still says it was up */
const UP_BEFORE_MS = 60_000;

let inv: Record<string, [number, number, number]> = {};

export function run(ctx: IRoundCtx): void {
  if (!ctx.owner) return;
  for (const e of ctx.players) {
    const isEnemy = e.reaction !== ctx.owner.reaction;
    if (!isEnemy && !ctx.firstOwnerOfRound) continue;
    const pid = ctx.pidOf(e.name);
    const casts = successesOf(e);
    const cIds = new Set<string>(casts.map((c: any) => String(c.spellId)));
    for (const c of cIds) {
      const cName = nameOf(c);
      if (!cName) continue;
      const head = new RegExp(
        String.raw`^(\d+):(\d\d)\s+\[ENEMY CD\]\s+${pid}\(\S+\) \([^)]*\): ${cName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\b`,
      );
      const lineSecs = ctx.lines
        .map((l) => head.exec(l))
        .filter((m): m is RegExpExecArray => !!m)
        .map((m) => +m[1]! * 60 + +m[2]!);
      const auras = nominatedEffectAurasOfCast(c, { classOwned: true }).filter(
        (n) => n !== c && nameOf(n) === cName,
      );
      if (auras.length === 0) continue;
      const castMs = casts
        .filter((x: any) => String(x.spellId) === c)
        .map(tsOf);
      for (const n of auras) {
        const own = ((e.auraEvents ?? []) as any[]).filter(
          (a) =>
            String(a.spellId) === n &&
            a.srcUnitId === e.id &&
            a.destUnitId === e.id,
        );
        for (const [i, a] of own.entries()) {
          if (ev(a) !== APPLIED) continue;
          const ms = tsOf(a);
          if (ms < ctx.start || ms > ctx.roundEndAt) continue;
          const key = `${c}>${n}`;
          const row = (inv[key] ??= [0, 0, 0]);
          if (ctx.firstOwnerOfRound) row[0]++;
          if (castMs.some((t) => Math.abs(t - ms) <= NEAR_CAST_MS)) {
            if (ctx.firstOwnerOfRound) row[1]++;
            continue;
          }
          if (castMs.some((t) => Math.abs(t - ms) <= PRESS_ROW_MS)) continue;
          if (!isResyncBatchAt(e, ms)) continue;
          const prev = own
            .slice(0, i)
            .filter((b) => tsOf(b) >= ms - UP_BEFORE_MS)
            .at(-1);
          if (prev && (ev(prev) === APPLIED || ev(prev) === REFRESH)) continue;
          if (prev && ev(prev) !== REMOVED) continue;
          if (ctx.firstOwnerOfRound) row[2]++;
          // only where the timeline prints this enemy's C at all
          if (!isEnemy || lineSecs.length === 0) continue;
          ctx.bump("unseenSelfAuraPress");
          const sec = Math.floor((ms - ctx.start) / 1000);
          if (lineSecs.some((s) => Math.abs(s - sec) <= 1)) continue;
          ctx.violate(
            "unseenSelfAuraPress",
            "noLine",
            ms,
            `${e.name}|${c}|${sec}`,
            `${cName}: ${nameOf(n)} ${n} new in a re-stating batch, no ${c} SUCCESS within 1 s; [ENEMY CD] lines at ${lineSecs.join(",")} s`,
          );
        }
      }
    }
  }
}

export function report(): string[] {
  return [
    `unseenSelfAura inventory — cast>aura: own APPLIED / within ${NEAR_CAST_MS} ms of a SUCCESS / new in a re-stating batch with none within ${PRESS_ROW_MS} ms (every player, each round once):`,
    ...Object.entries(inv)
      .filter(([, v]) => v[0] >= 5 || v[2] > 0)
      .sort((a, b) => b[1][2] - a[1][2] || b[1][0] - a[1][0])
      .slice(0, 40)
      .map(([k, v]) => `  ${k} ${nameOf(k.split(">")[0])}: ${v.join(" / ")}`),
  ];
}
export const state = () => ({ inv });
export const load = (s: ReturnType<typeof state>): void => {
  ({ inv } = s);
};
export const merge = {
  inv: (a: Record<string, number[]>, b: Record<string, number[]>) => {
    for (const [k, v] of Object.entries(b))
      a[k] = (a[k] ?? [0, 0, 0]).map((x, i) => x + (v[i] ?? 0));
    return a;
  },
};

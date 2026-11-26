/* eslint-disable @typescript-eslint/no-explicit-any -- the scans walk the untyped legacy parse objects */
/**
 * scan5/t278.ts — pipeline T278 (12.1.5 audit 15-fc0bed09 r0 D1 / D2): when
 * the product says an Adaptation PvP trinket is back (`pvpTrinketUses`'
 * `readyAtMs`, read by every trinket-state line: `[CC ON TEAM]` "Ns left",
 * `[DEATH]` "PvP Trinket available"), against the log's own lockout rows.
 *
 * Truth from the rows: the lockout 336139 APPLIED at or ≤ 1 s after the
 * trigger 283167, its first REMOVED after that, the unit's UNIT_DIED; the
 * lockout's length is DB2's (`spellEffectData` 336139, 60 s — lookups are
 * fine). A REMOVED logged at the unit's death (≤ `AT_DEATH_MS` before its
 * UNIT_DIED) is the death wipe, not the trinket coming back.
 *
 *  - `adaptationReadyAtDeathWipe` (in total): the lockout was removed at the
 *    unit's death before its length ran, and the product's `readyAtMs` is
 *    earlier than the length's end — 336139 APPLIED 3:00.37, REMOVED
 *    3:24.843, UNIT_DIED 3:24.845; "23s left" at 3:02, "PvP Trinket
 *    available" at the death.
 *  - inventory (out of total): the lockout ran its length; removed early with
 *    no death beside it; still up at the round's end.
 */
import { spellEffectData } from "@gladlog/analysis/src/data/spellEffectData";
import {
  ADAPTATION_LOCKOUT_AURA_ID,
  ADAPTATION_TRIGGER_AURA_ID,
  pvpTrinketUses,
} from "@gladlog/analysis/src/utils/pvpTrinketUses";

import { APPLIED, ev, type IRoundCtx, REMOVED, tsOf } from "./ctx";

const C = "adaptationReadyAtDeathWipe";
export const CHECKS = [C] as const;
/** a REMOVED this close before the unit's UNIT_DIED is the death wipe */
const AT_DEATH_MS = 250;
/** a lockout that ran this close to its DB2 length ran it */
const RAN_SLACK_MS = 500;
const RAN = "ran its length";
const EARLY_NO_DEATH = "removed early, no death beside it";
const STILL_UP = "still up at the round's end";
const DEATH_OK = "removed at the death, read to its length";
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set(
  [RAN, EARLY_NO_DEATH, STILL_UP, DEATH_OK].map((k) => `${C}|${k}`),
);

export function run(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  const lenMs =
    (spellEffectData[ADAPTATION_LOCKOUT_AURA_ID]?.durationSeconds ?? 60) * 1000;
  for (const u of ctx.players as any[]) {
    const rows = ((u.auraEvents ?? []) as any[]).filter(
      (a) => a.srcUnitId === u.id || a.destUnitId === u.id,
    );
    const deaths = ((u.deathRecords ?? []) as any[]).map((d) => d.timestamp);
    const uses = pvpTrinketUses(u).filter((x) => x.kind === "adaptation");
    for (const a of rows) {
      if (String(a.spellId) !== ADAPTATION_TRIGGER_AURA_ID) continue;
      if (ev(a) !== APPLIED) continue;
      const t = tsOf(a);
      const on = rows.find(
        (x) =>
          String(x.spellId) === ADAPTATION_LOCKOUT_AURA_ID &&
          ev(x) === APPLIED &&
          tsOf(x) >= t &&
          tsOf(x) - t <= 1000,
      );
      if (!on) continue;
      ctx.bump(C);
      const off = rows.find(
        (x) =>
          String(x.spellId) === ADAPTATION_LOCKOUT_AURA_ID &&
          ev(x) === REMOVED &&
          tsOf(x) >= tsOf(on),
      );
      const use = uses.find((x) => x.atMs === t);
      const key = `${u.name}#${t}`;
      const fullEnd = tsOf(on) + lenMs;
      if (!off) {
        ctx.violate(
          C,
          STILL_UP,
          t,
          key,
          `${u.name} lockout from +${tsOf(on) - ctx.start}ms`,
        );
        continue;
      }
      const offMs = tsOf(off);
      if (offMs >= fullEnd - RAN_SLACK_MS) {
        ctx.violate(C, RAN, t, key, `${u.name} ran ${offMs - tsOf(on)}ms`);
        continue;
      }
      const atDeath = deaths.some(
        (d) => d >= offMs && d - offMs <= AT_DEATH_MS,
      );
      if (!atDeath) {
        ctx.violate(
          C,
          EARLY_NO_DEATH,
          t,
          key,
          `${u.name} removed after ${offMs - tsOf(on)}ms of ${lenMs}`,
        );
        continue;
      }
      const ready = use?.readyAtMs;
      if (ready !== undefined && ready >= fullEnd - RAN_SLACK_MS) {
        ctx.violate(
          C,
          DEATH_OK,
          t,
          key,
          `${u.name} ready +${ready - ctx.start}ms`,
        );
        continue;
      }
      ctx.violate(
        C,
        "back at the death wipe",
        t,
        key,
        `${u.name}: lockout +${tsOf(on) - ctx.start}ms, removed at the death +${offMs - ctx.start}ms (${offMs - tsOf(on)}ms of ${lenMs}); product ready +${ready === undefined ? "none" : ready - ctx.start}ms`,
      );
    }
  }
}

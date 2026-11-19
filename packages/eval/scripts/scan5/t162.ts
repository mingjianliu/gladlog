/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents) */
/**
 * scan5/t162.ts — pipeline T162 (GH #218 item 7.3), count first: an Ice
 * Barrier 11426 a mage carries with no press of it in the log before the
 * application (pressed before the round's first row, then listed again by a
 * resync batch — scan5/t77 `iceBarrierNoPress` counts the applications) is
 * read as a shield nobody pressed (`ownPressedShieldSpansMs` → no span), so
 * a `defenseless` span can run over it while it eats hits.
 *
 * `iceBarrierUnpressedRun` — per owner context, per run of Ice Barrier on an
 * ENEMY mage (its own APPLIED to the next REMOVED, or the round's end) with
 * no press that puts it up in the 2 s before the application and no pressed
 * span by the product's own reading. Kinds:
 *  - `ate hits inside a defenseless window` — the product's own
 *    `computeOffensiveWindows` has a window on the mage that overlaps the
 *    run, and an absorb row of the shield falls in the overlap;
 *  - `ate hits, no window over them` — out of the total;
 *  - `ate nothing` — out of the total.
 */
import { ownShieldPressCastIds } from "@gladlog/analysis/src/data/ownShieldLinks";
import { ownPressedShieldSpansMs } from "@gladlog/analysis/src/utils/enemyDefensives";
import { computeOffensiveWindows } from "@gladlog/analysis/src/utils/offensiveWindows";

import {
  APPLIED,
  ev,
  fmtS,
  type IRoundCtx,
  REMOVED,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = ["iceBarrierUnpressedRun"] as const;
const C = "iceBarrierUnpressedRun";
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  `${C}|ate hits, no window over them`,
  `${C}|ate nothing`,
]);

const ICE_BARRIER = "11426";
const NO_PRESS_BEFORE_MS = 2000;
const OWN_PRESS_ROW_MS = 150;

export function run(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  if (!owner) return;
  const friends = (ctx.players as any[]).filter(
    (p) => p.reaction === owner.reaction,
  );
  const enemies = (ctx.players as any[]).filter(
    (p) => p.reaction !== owner.reaction,
  );
  const presses = ownShieldPressCastIds(ICE_BARRIER);
  let windows: ReturnType<typeof computeOffensiveWindows> | undefined;
  for (const u of enemies) {
    const auras = ((u.auraEvents ?? []) as any[])
      .filter(
        (a) =>
          a.spellId === ICE_BARRIER &&
          a.destUnitId === u.id &&
          tsOf(a) <= ctx.end,
      )
      .sort((a, b) => tsOf(a) - tsOf(b));
    const casts = successesOf(u);
    for (let i = 0; i < auras.length; i++) {
      const a = auras[i];
      if (ev(a) !== APPLIED || a.srcUnitId !== u.id) continue;
      const t = tsOf(a);
      if (
        casts.some(
          (c) =>
            presses.has(c.spellId) &&
            tsOf(c) >= t - NO_PRESS_BEFORE_MS &&
            tsOf(c) <= t + OWN_PRESS_ROW_MS,
        )
      )
        continue;
      const next = auras
        .slice(i + 1)
        .find((b) => ev(b) === REMOVED || ev(b) === APPLIED);
      const endMs = next ? tsOf(next) : ctx.end;
      if (ownPressedShieldSpansMs(u, ICE_BARRIER, t, endMs).length > 0)
        continue;
      ctx.bump(C);
      const eaten = ((u.absorbsIn ?? []) as any[]).filter(
        (r) => r.spellId === ICE_BARRIER && tsOf(r) >= t && tsOf(r) <= endMs,
      );
      const sum = (rows: any[]) =>
        rows.reduce((s, r) => s + Math.abs(r.absorbedAmount ?? 0), 0);
      windows ??= computeOffensiveWindows(
        enemies as never,
        friends as never,
        { ...ctx.legacy, startTime: ctx.start, endTime: ctx.end } as never,
      );
      const inWindow = eaten.filter((r) =>
        windows!.some(
          (w) =>
            w.targetUnitId === u.id &&
            tsOf(r) >= ctx.start + w.fromSeconds * 1000 &&
            tsOf(r) <= ctx.start + w.toSeconds * 1000,
        ),
      );
      const at = (ms: number) => fmtS((ms - ctx.start) / 1000);
      ctx.violate(
        C,
        inWindow.length > 0
          ? "ate hits inside a defenseless window"
          : eaten.length > 0
            ? "ate hits, no window over them"
            : "ate nothing",
        t,
        `${owner.name}#${u.id}#${t}`,
        `${u.name}: Ice Barrier ${at(t)}–${at(endMs)} with no press in the log; ate ${(sum(eaten) / 1000).toFixed(0)}k, ${(sum(inWindow) / 1000).toFixed(0)}k of it inside a defenseless window`,
      );
    }
  }
}

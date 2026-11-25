/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, players) */
/**
 * scan5/t281.ts — pipeline T281, count first: a cast that landed BEFORE an
 * immunity or a wall, read as going into it.
 *
 *  - `immuneTagAfterEarlierHit` (audit-1215 17 D1, 0d211b8b r1 1:32:
 *    Merithra's Blessing healed its target, Cyclone landed 64 ms later, a
 *    later pulse met IMMUNE and the line read `[IMMUNE — Cyclone was up]`):
 *    every IMMUNE row the product's reading keeps as a refusal of a
 *    non-control press (`pressImmuneMissRows`, as `setup.ts` calls it) with
 *    a damage / heal row of the same press on that unit logged before the
 *    refusal's own instant. Each side's players, each round once. Kind: the
 *    press's name.
 *  - `wasteCastNotInsideWall` (audit-1215 10 D1, 50b433c2 r5 2:31: `Wrath +
 *    Starsurge into Ironbark` — the Wrath row is logged before Ironbark's
 *    APPLIED in one millisecond, the Starsurge met Ice Block IMMUNE): every
 *    cast ABILITIES INTO IMMUNITY/DR counts into a wall (its own selection,
 *    `buildOffensiveWasteSummary`'s trace). Kinds: `landing row logged before
 *    the wall's APPLIED row` and `IMMUNE landing inside a damage-reduction
 *    wall`, each `, listed` (the row prints) or `, not listed`; and
 *    `listed line would lose its door` for a printed row that falls under
 *    its threshold without them.
 */
import { ccSpellIds } from "@gladlog/analysis/src/data/spellTags";
import {
  isControlCast,
  isPressHitRow,
  missBelongsToCast,
  PRESS_LANDED_SAME_INSTANT_MS,
  pressImmuneMissRows,
} from "@gladlog/analysis/src/utils/castMissRows";
import { wallStopsEveryHit } from "@gladlog/analysis/src/utils/enemyDefensives";
import {
  buildOffensiveWasteSummary,
  type IOffensiveWasteTraceRow,
} from "@gladlog/analysis/src/utils/offensiveWasteAnalysis";

import {
  APPLIED,
  ev,
  fmtS,
  type IRoundCtx,
  nameOf,
  successesOf,
  tsOf,
} from "./ctx";

const A = "immuneTagAfterEarlierHit";
const B = "wasteCastNotInsideWall";
export const CHECKS = [A, B] as const;

export function run(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  const units = ctx.units as any[];
  const players = ctx.players as any[];

  // ── A ──
  const appliedBy = (id: string) =>
    units.flatMap((u) =>
      ((u.auraEvents ?? []) as any[]).filter((a) => a.srcUnitId === id),
    );
  for (const u of players) {
    const misses = (u.missesOut ?? []) as any[];
    if (!misses.some((m) => m.missType === "IMMUNE")) continue;
    const casts = successesOf(u);
    const landed = [...(u.damageOut ?? []), ...(u.healOut ?? [])] as any[];
    const applied = appliedBy(u.id);
    const seen = new Set<any>();
    for (const c of casts) {
      const id = String(c.spellId ?? "");
      if (!id || ccSpellIds.has(id) || isControlCast(id)) continue;
      const t = tsOf(c);
      if (t > ctx.end) continue;
      const same = casts.filter((x) => String(x.spellId) === id).map(tsOf);
      const kept = pressImmuneMissRows(
        misses,
        id,
        same,
        t,
        c.destUnitId
          ? { casts: u.spellCastEvents ?? [], destUnitId: c.destUnitId }
          : undefined,
        landed,
        applied,
      );
      for (const m of kept) {
        if (seen.has(m) || !m.destUnitId) continue;
        seen.add(m);
        ctx.bump(A);
        const name = nameOf(id, c.spellName);
        const earlier = landed.find(
          (r) =>
            r.destUnitId === m.destUnitId &&
            !String(ev(r) ?? "").startsWith("SPELL_PERIODIC_") &&
            missBelongsToCast(same, t, tsOf(r)) &&
            tsOf(r) < tsOf(m) - PRESS_LANDED_SAME_INSTANT_MS &&
            isPressHitRow(id, name, r),
        );
        if (!earlier) continue;
        ctx.violate(
          A,
          name,
          t,
          `${u.id}|${id}|${t}|${m.destUnitId}`,
          `${u.name} ${name} pressed ${fmtS((t - ctx.start) / 1000)}: ${ev(earlier)} on ${m.destUnitName ?? m.destUnitId} ${tsOf(m) - tsOf(earlier)} ms before its IMMUNE row`,
        );
      }
    }
  }

  // ── B ──
  const combat = { ...ctx.legacy, startTime: ctx.start, endTime: ctx.end };
  for (const side of new Set(players.map((p) => p.reaction as number))) {
    const friends = players.filter((p) => p.reaction === side);
    const enemies = players.filter((p) => p.reaction !== side);
    if (friends.length === 0 || enemies.length === 0) continue;
    const rows: IOffensiveWasteTraceRow[] = [];
    try {
      buildOffensiveWasteSummary(combat as never, friends, enemies, (r) =>
        rows.push(r),
      );
    } catch {
      continue;
    }
    for (const r of rows) {
      const caster = friends.find((f) => f.id === r.casterId);
      const target = enemies.find((e) => e.id === r.window.unitId);
      if (!caster || !target) continue;
      const openMs = ctx.start + r.window.fromSeconds * 1000;
      const openRow = ((target.auraEvents ?? []) as any[]).find(
        (a) =>
          a.spellId === r.window.spellId &&
          ev(a) === APPLIED &&
          Math.abs(tsOf(a) - openMs) <= 1,
      );
      const openLine: number | undefined = openRow?.logLine?.lineIndex;
      const fullStop = wallStopsEveryHit(r.window.spellId);
      let off = 0;
      const tag = r.listed ? ", listed" : ", not listed";
      for (const c of r.wasteCasts) {
        ctx.bump(B);
        const atMs = ctx.start + c.atSeconds * 1000;
        const name = nameOf(c.spellId, c.spellName);
        const rowsAt = [
          ...((caster.damageOut ?? []) as any[]),
          ...((caster.missesOut ?? []) as any[]),
        ].filter(
          (d) =>
            d.destUnitId === target.id &&
            Math.abs(tsOf(d) - atMs) <= 1 &&
            nameOf(d.spellId, d.spellName) === name,
        );
        const before =
          openLine !== undefined &&
          Math.abs(atMs - openMs) <= 1 &&
          rowsAt.length > 0 &&
          rowsAt.every(
            (d) =>
              d.logLine?.lineIndex !== undefined &&
              d.logLine.lineIndex < openLine,
          );
        const immune =
          !fullStop &&
          rowsAt.length > 0 &&
          rowsAt.every((d) => d.missType === "IMMUNE");
        if (!before && !immune) continue;
        off++;
        ctx.violate(
          B,
          (before
            ? "landing row logged before the wall's APPLIED row"
            : "IMMUNE landing inside a damage-reduction wall") + tag,
          atMs,
          `${caster.id}|${target.id}|${r.window.spellId}|${atMs}|${c.spellId}`,
          `${caster.name} ${name} ${fmtS(c.atSeconds)} into ${target.name}'s ${r.window.defenseName} (${fmtS(r.window.fromSeconds)}–${fmtS(r.window.toSeconds)})`,
        );
      }
      if (r.listed && off > 0 && r.wasteCasts.length - off < r.threshold)
        ctx.violate(
          B,
          "listed line would lose its door",
          openMs,
          `${caster.id}|${target.id}|${r.window.spellId}|${openMs}|door`,
          `${caster.name} into ${target.name}'s ${r.window.defenseName} ${fmtS(r.window.fromSeconds)}: ${r.wasteCasts.length} casts, ${off} not inside, door ${r.threshold}`,
        );
    }
  }
}

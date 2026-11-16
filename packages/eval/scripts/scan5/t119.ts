/* eslint-disable @typescript-eslint/no-explicit-any -- the check walks the untyped legacy parse objects */
/**
 * scan5/t119.ts — ticket T119 (fact12 retest, cf63da4a r0 0:22): a
 * `[MINOR DISPELS]` line is stamped at its source's first removal and its
 * non-deliberate parts (`X (passive)`, `X (side effect of the cast)`) carry
 * no time of their own, so a part that removed nothing until later reads as
 * removing at the line's second (Fortifying Brew, first removal 1:43, on a
 * line stamped 0:22).
 *
 *  - `minorPartStampedEarly`: per non-deliberate part of a player's line
 *    (pet / guardian lines skipped), the removals the product folds into
 *    that part — the events of the round's two `reconstructDispelSummary`
 *    calls (the fold's inputs) of that source and spell whose
 *    `minorDispelPartTag` is the part's tag — merged by
 *    `MINOR_DISPEL_CAST_MERGE_S`. Violation `firstLater`: the part's first
 *    removal is in a later second than the line's stamp. Kind `foldedLater`
 *    (out of the total): the first is in the stamp's second, a later one is
 *    not — the counted `xN` fold. Counted: every such part with a row.
 */
import {
  MINOR_DISPEL_CAST_MERGE_S,
  minorDispelPartTag,
} from "@gladlog/analysis/src/context/timelineSections/minorDispels";
import {
  type IDispelEvent,
  reconstructDispelSummary,
} from "@gladlog/analysis/src/utils/dispelAnalysis";

import { fmtS, type IRoundCtx, secOf } from "./ctx";

export const CHECKS = ["minorPartStampedEarly"] as const;
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "minorPartStampedEarly|foldedLater",
]);

const LINE =
  /^\s*(\d+:\d\d)\s+\[MINOR DISPELS\]\s+(\d+)\([^)]*\)('s \w+)?: (.*) \(low-priority, folded\)\s*$/;
const PART = /^(.+?) \((passive|side effect of the cast)\)(?: x\d+)?$/;

/** top-level `, ` split (a deliberate part's list nests `, +N`) */
function partsOf(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth === 0 && body.startsWith(", ", i)) {
      out.push(cur);
      cur = "";
      i++;
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** the product's two dispel summaries of a round, per owner side (the
 * calls `buildMatchContext` makes; pets of both sides) */
const summaries = new WeakMap<object, Map<number, IDispelEvent[]>>();
function foldedEventsOf(ctx: IRoundCtx): IDispelEvent[] {
  const bySide = summaries.get(ctx.legacy) ?? new Map<number, IDispelEvent[]>();
  summaries.set(ctx.legacy, bySide);
  const side = ctx.owner.reaction as number;
  const hit = bySide.get(side);
  if (hit) return hit;
  const players = ctx.players as any[];
  const friends = players.filter((u) => u.reaction === side);
  const enemies = players.filter((u) => u.reaction !== side);
  const fIds = new Set(friends.map((u) => u.id));
  const eIds = new Set(enemies.map((u) => u.id));
  const units = Object.values(ctx.legacy.units) as any[];
  const fPets = units.filter((u) => u.ownerId && fIds.has(u.ownerId));
  const ePets = units.filter((u) => u.ownerId && eIds.has(u.ownerId));
  let out: IDispelEvent[] = [];
  try {
    const ds = reconstructDispelSummary(
      friends,
      enemies,
      ctx.legacy,
      fPets,
      ePets,
    );
    const eds = reconstructDispelSummary(
      enemies,
      friends,
      ctx.legacy,
      ePets,
      fPets,
    );
    // the fold's own inputs (`emitMinorDispelEntries`)
    out = [
      ...ds.allyCleanse,
      ...ds.ourPurges,
      ...ds.hostilePurges,
      ...eds.allyCleanse,
    ];
  } catch {
    out = [];
  }
  bySide.set(side, out);
  return out;
}

export function run(ctx: IRoundCtx): void {
  if (!ctx.owner) return;
  checkMinorParts(ctx, foldedEventsOf(ctx));
}

/** the check over a round's lines and the fold's events (exported for the
 * unit test) */
export function checkMinorParts(
  ctx: Pick<IRoundCtx, "lines" | "unitOfPid" | "bump" | "violate" | "start">,
  events: readonly IDispelEvent[],
): void {
  const C = "minorPartStampedEarly";
  for (const l of ctx.lines) {
    const m = LINE.exec(l);
    if (!m || m[3]) continue;
    const stamp = secOf(m[1]!);
    const unit = ctx.unitOfPid(m[2]);
    if (!unit) continue;
    for (const part of partsOf(m[4]!)) {
      const p = PART.exec(part.trim());
      if (!p) continue;
      const name = p[1]!;
      const tag = `(${p[2]!})`;
      // the part's own removals: the player's (not a pet's) events of that
      // spell carrying the part's tag (`minorDispelPartTag`, the fold's own
      // key — codex 85-tk-L-T119-1: a passive and a side-effect part of one
      // spell are two parts)
      const instants: number[] = [];
      for (const t of events
        .filter(
          (e) =>
            !e.summonUnitId &&
            // the fold's own skip: a High / Critical removal that is no
            // rider has a line of its own (`foldMinor`)
            !(
              (e.priority === "Critical" || e.priority === "High") &&
              e.dispelKind !== "rider"
            ) &&
            e.sourceName === unit.name &&
            (e.dispelSpellName || "unknown") === name &&
            minorDispelPartTag(e) === tag,
        )
        .map((e) => e.timeSeconds)
        .sort((a, b) => a - b))
        if (!instants.some((x) => Math.abs(x - t) <= MINOR_DISPEL_CAST_MERGE_S))
          instants.push(t);
      if (instants.length === 0) continue;
      ctx.bump(C);
      const secs = instants.map((t) => Math.floor(t));
      const atMs = ctx.start + instants[0]! * 1000;
      if (secs[0]! > stamp)
        ctx.violate(
          C,
          "firstLater",
          atMs,
          `${unit.id}#${part}#${m[1]}`,
          `${part} first removed at ${fmtS(secs[0]!)}; the line is stamped ${m[1]}`,
          l.trim(),
        );
      else if (secs.some((s) => s > stamp))
        ctx.violate(
          C,
          "foldedLater",
          atMs,
          `${unit.id}#${part}#${m[1]}`,
          `${part} removed at ${secs.map(fmtS).join(", ")}; the line is stamped ${m[1]}`,
          l.trim(),
        );
    }
  }
}

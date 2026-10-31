/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents) */
/**
 * scan5/talentWall.ts — class 11 of the round-7 audit (fact7 F21, D39 / D57):
 * a wall printed at a percentage a talent modifier raised, against what the
 * round's hits measured. Oakskin's 10 points on Survival Instincts read 60 %
 * on lines where the log halves each hit.
 *
 * Printed truth: `<wall> (N%, …)` on a press line of an aura in
 * `TALENT_MITIGATION_MODIFIERS`. Log truth, rows only: the unit's non-critical
 * direct hits, (amount + absorbed + blocked) / base, inside the printed wall's
 * own run with no other table aura up, each over the median of the SAME
 * spell's hits in the round outside every table aura (one spell, one round:
 * the audits' reading; pooled spells move the median by more than the wall).
 * Needs ≥ `MIN_HITS` such hits; a wall whose measured reduction sits within
 * `TOLERANCE_PTS` of the print passes.
 */
import { MITIGATION_TABLE } from "@gladlog/analysis/src/data/mitigationData";
import { TALENT_MITIGATION_MODIFIERS } from "@gladlog/analysis/src/data/talentMitigationModifiers";
import { parseLine } from "@gladlog/parser";

import { APPLIED, ev, type IRoundCtx, nameOf, REMOVED, tsOf } from "./ctx";

export const CHECKS = ["talentWallPrinted"] as const;

const MIN_HITS = 5;
const TOLERANCE_PTS = 7;
const LINE =
  /^\s*(\d+):(\d\d)\s+\[(?:ENEMY DEF|YOU\] \[CD|TEAM\] \[CD)\]\s+(?:(\d+)\([^)]*\)(?: \([^)]*\))?: )?(.+?) \((\d+)%, /;
const TALENTED = new Set(TALENT_MITIGATION_MODIFIERS.map((m) => m.auraSpellId));
const nameToAura = new Map([...TALENTED].map((id) => [nameOf(id), id]));
const median = (xs: number[]): number =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

/** [from, to] runs of `id` on the unit, from its own aura rows */
function runsOf(unit: any, ids: ReadonlySet<string>): [number, number][] {
  const out: [number, number][] = [];
  let open: number | undefined;
  for (const a of (unit.auraEvents ?? []) as any[]) {
    if (!ids.has(a.spellId) || a.destUnitId !== unit.id) continue;
    if (ev(a) === APPLIED && open === undefined) open = tsOf(a);
    else if (ev(a) === REMOVED && open !== undefined) {
      out.push([open, tsOf(a)]);
      open = undefined;
    }
  }
  return out;
}

export function run(ctx: IRoundCtx): void {
  const allTable = new Set(Object.keys(MITIGATION_TABLE));
  for (const line of ctx.lines) {
    const m = LINE.exec(line);
    if (!m) continue;
    const aura = nameToAura.get(m[4]!);
    if (!aura) continue;
    const unit = m[3] ? ctx.unitOfPid(m[3]) : ctx.owner;
    if (!unit) continue;
    const printed = +m[5]!;
    const t = +m[1]! * 60 + +m[2]!;
    const at = ctx.start + t * 1000;
    const run = runsOf(unit, new Set([aura])).find(
      ([a, b]) => b >= at && a < at + 1000,
    );
    if (!run) continue;
    const others = runsOf(
      unit,
      new Set([...allTable].filter((id) => id !== aura)),
    );
    const anyWall = [...others, ...runsOf(unit, new Set([aura]))];
    const inside: Array<[string, number]> = [];
    const outside = new Map<string, number[]>();
    for (const raw of ctx.rawLines) {
      if (!raw.includes("_DAMAGE,") || !raw.includes(unit.id)) continue;
      const pl: any = parseLine(raw);
      if (!pl?.damage || !pl.base || pl.base.destGuid !== unit.id) continue;
      if (pl.eventName === "DAMAGE_SPLIT" || pl.eventName.startsWith("SWING"))
        continue;
      if (pl.damage.critical || !pl.damage.baseAmount) continue;
      const ms = pl.timestamp as number;
      const r =
        (pl.damage.amount + pl.damage.absorbed + pl.damage.blocked) /
        pl.damage.baseAmount;
      const spell = String(pl.spell?.spellId ?? "");
      if (ms >= run[0] && ms <= run[1]) {
        if (!others.some(([a, b]) => ms >= a && ms <= b))
          inside.push([spell, r]);
      } else if (!anyWall.some(([a, b]) => ms >= a && ms <= b))
        outside.set(spell, [...(outside.get(spell) ?? []), r]);
    }
    const ratios = inside.flatMap(([spell, r]) => {
      const out = outside.get(spell);
      return out && out.length >= 2 ? [r / median(out)] : [];
    });
    if (ratios.length < MIN_HITS) continue;
    ctx.bump("talentWallPrinted");
    const measured = Math.round((1 - median(ratios)) * 100);
    if (Math.abs(measured - printed) <= TOLERANCE_PTS) continue;
    ctx.violate(
      "talentWallPrinted",
      m[4]!,
      at,
      `${unit.name}#${aura}#${run[0]}`,
      `${unit.name} ${m[4]} printed ${printed}%, measured ${measured}% (${ratios.length} hits)`,
      line,
    );
  }
}

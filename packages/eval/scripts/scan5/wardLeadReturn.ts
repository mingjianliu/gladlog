/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, damageIn, missesOut) */
/**
 * scan5/wardLeadReturn.ts — fact12 D16: a Nether Ward return logged BEFORE
 * its own REFLECT row. An instant spell's return under 212295 is written in
 * the millisecond of the caster's press, its REFLECT row ~135 ms later
 * (64e9a3f3 r0 1:44: Fire Blast cast 40.2678, its 12.3k back in that ms,
 * REFLECT 40.4048) — the pairing gave each such row an earlier reflect, and
 * the Pyroblast between two Fire Blasts lost its 99.7k and its line.
 *
 * Truth = the log's rows: a Nether Ward row on the caster (landed, or fully
 * absorbed) that a SUCCESS of the caster's spell S immediately precedes
 * (`LEAD_CAST_MS`), with a REFLECT row of S by that reflector after it
 * within `REFLECT_OWN_ID_LEAD_MS`, and no REFLECT row in its own
 * millisecond (an instant reflect's return comes in its REFLECT row's ms: a
 * Lava Burst pressed 1 ms before an Earth Shock's reflect and return), came
 * back from that S. The product's
 * pairing (`pairNetherWardReturns` over every REFLECT row of the caster on
 * that reflector, the rows' own-millisecond names) must give it that
 * REFLECT row of S — not an earlier one of S, which another return owns.
 *
 * Check `wardLeadReturn`, kinds:
 *  - `pairedElsewhere`: paired to another spell's REFLECT row;
 *  - `unpaired`: paired to none.
 * `report()`: how far the return trails the press, over every Nether Ward
 * row with a REFLECT row of a pressed spell ahead of it (each round once).
 */
import {
  isCountedReflectRow,
  NETHER_WARD_ID,
  netherWardNamedSpells,
  pairNetherWardReturns,
  REFLECT_OWN_ID_LEAD_MS,
} from "@gladlog/analysis/src/context/spellOutcomeLines";
import * as outcomeLines from "@gladlog/analysis/src/context/spellOutcomeLines";

import { type IRoundCtx, nameOf, successesOf, tsOf } from "./ctx";

/** the product's press reading when the code under test has one (the fix's
 * own; absent on the parent, so the same file measures both sides) */
const pressedSpells = (outcomeLines as Record<string, unknown>)[
  "netherWardPressedSpells"
] as ((caster: any, ts: number) => Set<string>) | undefined;

export const CHECKS = ["wardLeadReturn"] as const;

/** a return in its press's millisecond, give or take the log's 1 ms jitter:
 * the product's own constants when the code under test exports them (shared
 * predicate; codex review of B5), the fix's values on the parent */
const sharedMs = (name: string, parentValue: number): number => {
  const v = (outcomeLines as Record<string, unknown>)[name];
  return typeof v === "number" ? v : parentValue;
};
const LEAD_CAST_MS = sharedMs("NETHER_WARD_PRESS_ROW_MS", 5);
const SAME_MS_JITTER_MS = sharedMs("NETHER_WARD_SAME_MS_JITTER_MS", 1);

let hist: Record<string, number> = {};
const bucket = (d: number): string =>
  d <= 1
    ? "0-1"
    : d <= 5
      ? "2-5"
      : d <= 20
        ? "6-20"
        : d <= 100
          ? "21-100"
          : d <= 500
            ? "101-500"
            : ">500";

export function run(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  for (const caster of ctx.players) {
    const reflects = ((caster.missesOut ?? []) as any[]).filter(
      (m) => isCountedReflectRow(m) && m.timestamp >= ctx.start,
    );
    const reflectors = new Set(reflects.map((m) => m.destUnitId as string));
    for (const src of reflectors) {
      const landed = ((caster.damageIn ?? []) as any[])
        .filter((d) => d.spellId === NETHER_WARD_ID && d.srcUnitId === src)
        .map(tsOf);
      const ownRows = [
        ...landed,
        ...((caster.absorbsIn ?? []) as any[])
          .filter(
            (a) =>
              a.attackSpellId === NETHER_WARD_ID &&
              a.attackerId === src &&
              !landed.includes(tsOf(a)),
          )
          .map(tsOf),
      ];
      if (ownRows.length === 0) continue;
      const rows = reflects.filter((m) => m.destUnitId === src);
      const rowName = new Map<number, string>(
        rows.map((m) => [m.timestamp, nameOf(m.spellId, m.spellName ?? "")]),
      );
      const pairs = pairNetherWardReturns(
        rows.map((m) => m.timestamp),
        ownRows,
        {
          reflectRowSpells: new Map(
            rows.map((m) => [m.timestamp, new Set([String(m.spellId)])]),
          ),
          ownRowNames: new Map(
            ownRows.map((ts) => [ts, netherWardNamedSpells(caster, src, ts)]),
          ),
          ...(pressedSpells
            ? {
                ownRowPresses: new Map(
                  ownRows.map((ts) => [ts, pressedSpells(caster, ts)]),
                ),
              }
            : {}),
        },
      );
      const casts = successesOf(caster);
      for (const ts of new Set(ownRows)) {
        // the REFLECT rows ahead of the return, and the press of each
        const ahead = rows.filter(
          (m) => m.timestamp > ts && m.timestamp <= ts + REFLECT_OWN_ID_LEAD_MS,
        );
        let lead: { name: string; d: number; row: number } | undefined;
        for (const m of ahead) {
          const name = nameOf(m.spellId, m.spellName ?? "");
          const press = casts
            .filter(
              (c: any) =>
                tsOf(c) <= ts && nameOf(c.spellId, c.spellName ?? "") === name,
            )
            .at(-1);
          if (!press) continue;
          const d = ts - tsOf(press);
          if (!lead || d < lead.d || (d === lead.d && m.timestamp < lead.row))
            lead = { name, d, row: m.timestamp };
        }
        if (!lead) continue;
        // a REFLECT row in the return's own millisecond owns it (an instant
        // reflect returned at once): no lead
        if (rows.some((m) => Math.abs(m.timestamp - ts) <= SAME_MS_JITTER_MS))
          continue;
        hist[bucket(lead.d)] = (hist[bucket(lead.d)] ?? 0) + 1;
        if (lead.d > LEAD_CAST_MS) continue;
        ctx.bump("wardLeadReturn");
        const paired = pairs.get(ts);
        const got = paired === undefined ? undefined : rowName.get(paired);
        if (paired === lead.row) continue;
        ctx.violate(
          "wardLeadReturn",
          got === undefined ? "unpaired" : "pairedElsewhere",
          ts,
          `${caster.name}|${ts}`,
          `${lead.name} pressed ${lead.d} ms before, REFLECT +${lead.row - ts} ms; paired to ${got ?? "none"}${paired === undefined ? "" : ` ${paired - ts} ms`}`,
        );
      }
    }
  }
}

export function report(): string[] {
  return [
    `wardLeadReturn inventory — Nether Ward rows with a REFLECT row of a pressed spell ahead within ${REFLECT_OWN_ID_LEAD_MS} ms, by ms after that press: ${Object.entries(
      hist,
    )
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ")}`,
  ];
}
export const state = () => ({ hist });
export const load = (s: ReturnType<typeof state>): void => {
  ({ hist } = s);
};

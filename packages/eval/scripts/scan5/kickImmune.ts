/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units) */
/**
 * scan5/kickImmune.ts — GH #168 / #126 row 243: "could a kick land on the
 * unit right now". Truth = the log's own aura rows on the unit, kept by DB2
 * (aura 77 mechanic 26 or every school, `auraBlocksInterrupt`: a lookup), and
 * its SPELL_INTERRUPT rows. Obsidian Scales 363916 carries the row in every
 * state and is an immunity only on the press of a holder of Obsidian Mettle
 * 378444: on 605 files 15 kicks landed inside it, 10 were refused, and an
 * ally's copy takes kicks whoever holds the talent; every other aura of the
 * set took 0 kicks on 12,000+ applications.
 *
 * Check `kickImmuneNote`, kinds (the two line kinds read `interruptImmuneWindows`
 * itself, the gate's predicate: a rendered note must agree with it, including
 * the aura's end at its official length when its REMOVED is lost):
 *  - `upWhileImmune`: `[YOU] [CD]` channel line with an enemy-interrupt note
 *    pressed under such an aura;
 *  - `immuneNotUp`: `interrupt-immune (…)` pressed with no such aura up;
 *  - `kickInsideWindow`: the log's truth against the windows, a SPELL_INTERRUPT
 *    landed inside one (Thunder Focus Tea 116680 read as the immunity).
 */
import {
  interruptImmuneWindowAt,
  interruptImmuneWindows,
} from "@gladlog/analysis/src/utils/talentBehaviors";

import {
  ev,
  fmtS,
  type IRoundCtx,
  nameOf,
  secOf,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = ["kickImmuneNote"] as const;

const NOTE =
  /^(\d+:\d\d)\s+\[YOU\] \[CD\]\s+(.+?)(?: →| \(| \[| \|).*\| (enemy interrupts UP|no enemy interrupt|interrupt-immune)/;

export function run(ctx: IRoundCtx): void {
  const combat = { startTime: ctx.start, endTime: ctx.end };
  const casters = new Map(ctx.units.map((u: any) => [u.id, u]));
  const windowsOf = (u: any) => interruptImmuneWindows(u, combat, casters);
  const ownerWindows = ctx.owner ? windowsOf(ctx.owner) : [];
  for (const line of ctx.lines) {
    const m = NOTE.exec(line);
    if (!m) continue;
    const second = secOf(m[1]!);
    const press = successesOf(ctx.owner).find(
      (c) =>
        Math.floor((tsOf(c) - ctx.start) / 1000) === second &&
        nameOf(c.spellId) === m[2],
    );
    if (!press) continue;
    ctx.bump("kickImmuneNote");
    const at = tsOf(press);
    const up = interruptImmuneWindowAt(ownerWindows, at);
    if (up && m[3] !== "interrupt-immune")
      ctx.violate(
        "kickImmuneNote",
        "upWhileImmune",
        at,
        `${ctx.roundKey}|up|${ctx.owner.id}|${m[1]}`,
        `${m[2]} at ${fmtS(second)} under ${up.auraName} ${up.spellId}`,
        line,
      );
    if (!up && m[3] === "interrupt-immune")
      ctx.violate(
        "kickImmuneNote",
        "immuneNotUp",
        at,
        `${ctx.roundKey}|notUp|${ctx.owner.id}|${m[1]}`,
        `${m[2]} at ${fmtS(second)}`,
        line,
      );
  }
  if (!ctx.firstOwnerOfRound) return;
  for (const u of ctx.players) {
    const windows = windowsOf(u);
    if (windows.length === 0) continue;
    for (const k of u.actionIn ?? []) {
      if (ev(k) !== "SPELL_INTERRUPT") continue;
      ctx.bump("kickImmuneNote");
      const at = tsOf(k);
      const w = interruptImmuneWindowAt(windows, at);
      if (w)
        ctx.violate(
          "kickImmuneNote",
          "kickInsideWindow",
          at,
          `${ctx.roundKey}|kick|${u.id}|${at}`,
          `${k.spellName ?? k.spellId} landed on ${u.name} inside ${w.reason}`,
        );
    }
  }
}

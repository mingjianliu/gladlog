/**
 * FT-T02b scan: is damage a deferral shield only DELAYED counted once?
 *
 * Time Dilation and Stretch Time write the delayed half of a hit as a
 * SPELL_ABSORBED by the shield, and write it again as the tick that takes the
 * health (`DEFERRAL_SHIELD_DAMAGE_IDS`, shield id → tick id). The pressure
 * predicate (`incomingPressureEvents`) must hold the damage once — as the
 * tick.
 *
 * Per match / shuffle round, over the player units:
 *   DOUBLE     absorb events of a deferral shield that `incomingPressureEvents`
 *              still returns (amount)                              → must be 0
 *   RECONCILE  per shield over the whole input: delayed (the shield's
 *              SPELL_ABSORBED total) vs came back (its ticks landed + its
 *              ticks a real shield absorbed). The Game-Behaviour Rule's
 *              arithmetic leg, re-runnable: a ratio far below 1 means the
 *              shield → tick pairing no longer describes the game (a tick
 *              still pending at a death or the round's end is the normal
 *              shortfall — 98–99 % on the 2026-10-08 re-eval logs).
 *              FLAG below 0.9, report only.
 *
 * Usage: npx tsx packages/eval/scripts/deferredDamageScan.ts <raw.txt | dir>...
 * Exit code 1 when DOUBLE is non-zero.
 *
 * The scan itself (`scanLegacy`, `reconcile`) is exported for
 * test/deferredDamageScan.test.ts; `scanLegacy` takes the pressure predicate
 * as a parameter so the test can hand in one that still returns the absorb
 * and watch DOUBLE fire. Only the `process.argv` guard at the bottom runs
 * the CLI.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { ensureAnalysisData } from "@gladlog/analysis";
import * as incomingPressure from "@gladlog/analysis/src/utils/incomingPressure";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { type IArenaMatch, toLegacyMatch } from "@gladlog/parser-compat";

// The literal is only a stand-in so the scan can print the BEFORE number on a
// commit that predates the table; from FT-T02b on the table is the export.
export const TABLE: Readonly<Record<string, string>> = (
  incomingPressure as { DEFERRAL_SHIELD_DAMAGE_IDS?: Record<string, string> }
).DEFERRAL_SHIELD_DAMAGE_IDS ?? { "357170": "361029", "410355": "413924" };
const SHIELD_OF_TICK = new Map(Object.entries(TABLE).map(([s, t]) => [t, s]));

/** RECONCILE is reported only; a ratio under this is flagged. */
export const RECONCILE_FLAG_BELOW = 0.9;

function rawFiles(arg: string): string[] {
  if (!statSync(arg).isDirectory()) return [arg];
  const out: string[] = [];
  for (const entry of readdirSync(arg).sort()) {
    const p = path.join(arg, entry);
    if (statSync(p).isDirectory()) out.push(...rawFiles(p));
    else if (entry === "raw.txt") out.push(p);
  }
  return out;
}

export interface ShieldTally {
  delayed: number;
  ticksLanded: number;
  ticksAbsorbed: number;
  rounds: number;
}

export interface DeferredTally {
  rounds: number;
  roundsWithDeferral: number;
  double: number;
  doubleEvents: number;
  byShield: Map<string, ShieldTally>;
}

export const newDeferredTally = (): DeferredTally => ({
  rounds: 0,
  roundsWithDeferral: 0,
  double: 0,
  doubleEvents: 0,
  byShield: new Map(),
});

export function addDeferredTally(into: DeferredTally, t: DeferredTally): void {
  into.rounds += t.rounds;
  into.roundsWithDeferral += t.roundsWithDeferral;
  into.double += t.double;
  into.doubleEvents += t.doubleEvents;
  for (const [shield, s] of t.byShield) {
    const cur = into.byShield.get(shield) ?? {
      delayed: 0,
      ticksLanded: 0,
      ticksAbsorbed: 0,
      rounds: 0,
    };
    cur.delayed += s.delayed;
    cur.ticksLanded += s.ticksLanded;
    cur.ticksAbsorbed += s.ticksAbsorbed;
    cur.rounds += s.rounds;
    into.byShield.set(shield, cur);
  }
}

/** The RECONCILE reading of one shield: came-back ÷ delayed (1 with nothing
 * delayed), and whether it is flagged. */
export function reconcile(s: ShieldTally): { ratio: number; flag: boolean } {
  const back = s.ticksLanded + s.ticksAbsorbed;
  const ratio = s.delayed > 0 ? back / s.delayed : 1;
  return { ratio, flag: ratio < RECONCILE_FLAG_BELOW };
}

/** One match / shuffle round, already converted to the legacy shape.
 * `pressureEventsOf` is the product's `incomingPressureEvents` by default. */
export function scanLegacy(
  legacy: Pick<IArenaMatch, "units">,
  pressureEventsOf: (
    u: incomingPressure.PressureUnit,
  ) => incomingPressure.IPressureEvent[] = (u) =>
    incomingPressure.incomingPressureEvents(u),
): DeferredTally {
  const t = newDeferredTally();
  t.rounds = 1;
  const tally = (shield: string): ShieldTally => {
    let s = t.byShield.get(shield);
    if (!s) {
      s = { delayed: 0, ticksLanded: 0, ticksAbsorbed: 0, rounds: 0 };
      t.byShield.set(shield, s);
    }
    return s;
  };
  const seen = new Set<string>();
  for (const u of Object.values(legacy.units)) {
    if (!u.info) continue;
    for (const a of u.absorbsIn ?? []) {
      const amount = Math.abs(Number(a.absorbedAmount) || 0);
      if (a.spellId && a.spellId in TABLE) {
        tally(a.spellId).delayed += amount;
        seen.add(a.spellId);
      }
      const shield = SHIELD_OF_TICK.get(a.attackSpellId ?? "");
      if (shield) tally(shield).ticksAbsorbed += amount;
    }
    for (const d of u.damageIn ?? []) {
      const shield = SHIELD_OF_TICK.get(d.spellId ?? "");
      if (shield) tally(shield).ticksLanded += Math.abs(d.effectiveAmount);
    }
    for (const e of pressureEventsOf(u)) {
      if (e.isAbsorb && e.spellId in TABLE) {
        t.double += e.amount;
        t.doubleEvents++;
      }
    }
  }
  for (const s of seen) tally(s).rounds++;
  if (seen.size > 0) t.roundsWithDeferral++;
  return t;
}

export function itemsOfRawText(text: string): IArenaMatch[] {
  const items: GladMatch[] = [];
  const p = new GladLogParser();
  p.on("match", (m: GladMatch) => items.push(m));
  p.on("shuffle", (sh) => {
    for (const r of sh.rounds) items.push(r as never);
  });
  for (const line of text.split("\n")) p.push(line);
  p.end();
  const out: IArenaMatch[] = [];
  for (const m of items) {
    try {
      out.push(toLegacyMatch({ ...m, rawLines: [] } as GladMatch));
    } catch {
      continue;
    }
  }
  return out;
}

async function main(): Promise<void> {
  await ensureAnalysisData();
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("usage: deferredDamageScan.ts <raw.txt | dir>...");
    process.exit(2);
  }

  const total = newDeferredTally();
  let files = 0;
  for (const file of args.flatMap(rawFiles)) {
    files++;
    const ft = newDeferredTally();
    for (const legacy of itemsOfRawText(readFileSync(file, "utf8")))
      addDeferredTally(ft, scanLegacy(legacy));
    addDeferredTally(total, ft);
    const fileDelayed = [...ft.byShield.values()].reduce(
      (n, s) => n + s.delayed,
      0,
    );
    if (fileDelayed > 0)
      console.log(
        `${path.basename(path.dirname(file))} delayed=${Math.round(fileDelayed)} DOUBLE=${Math.round(ft.double)}`,
      );
  }

  console.log(
    `\n=== ${files} files, ${total.rounds} matches / rounds (${total.roundsWithDeferral} with a deferral shield) ===`,
  );
  for (const [shield, s] of total.byShield) {
    const back = s.ticksLanded + s.ticksAbsorbed;
    const { ratio, flag } = reconcile(s);
    console.log(
      `RECONCILE shield ${shield} → tick ${TABLE[shield]}: delayed ${Math.round(s.delayed)} · came back ${Math.round(back)} ` +
        `(landed ${Math.round(s.ticksLanded)} + absorbed by a real shield ${Math.round(s.ticksAbsorbed)}) = ${(ratio * 100).toFixed(1)}% ` +
        `over ${s.rounds} rounds${flag ? "  FLAG" : ""}`,
    );
  }
  console.log(
    `DOUBLE ${Math.round(total.double)} damage in ${total.doubleEvents} deferral-shield absorb events still counted as pressure`,
  );
  process.exit(total.double > 0 ? 1 : 0);
}

if (process.argv[1]?.includes("deferredDamageScan")) void main();

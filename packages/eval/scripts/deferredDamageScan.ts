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
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { ensureAnalysisData } from "@gladlog/analysis";
import * as incomingPressure from "@gladlog/analysis/src/utils/incomingPressure";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch } from "@gladlog/parser-compat";

await ensureAnalysisData();

// The literal is only a stand-in so the scan can print the BEFORE number on a
// commit that predates the table; from FT-T02b on the table is the export.
const TABLE: Readonly<Record<string, string>> = (
  incomingPressure as { DEFERRAL_SHIELD_DAMAGE_IDS?: Record<string, string> }
).DEFERRAL_SHIELD_DAMAGE_IDS ?? { "357170": "361029", "410355": "413924" };
const SHIELD_OF_TICK = new Map(Object.entries(TABLE).map(([s, t]) => [t, s]));

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

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: deferredDamageScan.ts <raw.txt | dir>...");
  process.exit(2);
}

interface ShieldTally {
  delayed: number;
  ticksLanded: number;
  ticksAbsorbed: number;
  rounds: number;
}
const byShield = new Map<string, ShieldTally>();
const tally = (shield: string): ShieldTally => {
  let t = byShield.get(shield);
  if (!t) {
    t = { delayed: 0, ticksLanded: 0, ticksAbsorbed: 0, rounds: 0 };
    byShield.set(shield, t);
  }
  return t;
};

let files = 0;
let rounds = 0;
let roundsWithDeferral = 0;
let double = 0;
let doubleEvents = 0;

for (const file of args.flatMap(rawFiles)) {
  const items: GladMatch[] = [];
  const p = new GladLogParser();
  p.on("match", (m: GladMatch) => items.push(m));
  p.on("shuffle", (sh) => {
    for (const r of sh.rounds) items.push(r as never);
  });
  for (const line of readFileSync(file, "utf8").split("\n")) p.push(line);
  p.end();
  files++;
  let fileDouble = 0;
  let fileDelayed = 0;
  for (const m of items) {
    let legacy;
    try {
      legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
    } catch {
      continue;
    }
    rounds++;
    const seen = new Set<string>();
    for (const u of Object.values(legacy.units)) {
      if (!u.info) continue;
      for (const a of u.absorbsIn ?? []) {
        const amount = Math.abs(Number(a.absorbedAmount) || 0);
        if (a.spellId && a.spellId in TABLE) {
          tally(a.spellId).delayed += amount;
          fileDelayed += amount;
          seen.add(a.spellId);
        }
        const shield = SHIELD_OF_TICK.get(a.attackSpellId ?? "");
        if (shield) tally(shield).ticksAbsorbed += amount;
      }
      for (const d of u.damageIn ?? []) {
        const shield = SHIELD_OF_TICK.get(d.spellId ?? "");
        if (shield) tally(shield).ticksLanded += Math.abs(d.effectiveAmount);
      }
      for (const e of incomingPressure.incomingPressureEvents(u)) {
        if (e.isAbsorb && e.spellId in TABLE) {
          double += e.amount;
          fileDouble += e.amount;
          doubleEvents++;
        }
      }
    }
    for (const s of seen) tally(s).rounds++;
    if (seen.size > 0) roundsWithDeferral++;
  }
  if (fileDelayed > 0)
    console.log(
      `${path.basename(path.dirname(file))} delayed=${Math.round(fileDelayed)} DOUBLE=${Math.round(fileDouble)}`,
    );
}

console.log(
  `\n=== ${files} files, ${rounds} matches / rounds (${roundsWithDeferral} with a deferral shield) ===`,
);
for (const [shield, t] of byShield) {
  const back = t.ticksLanded + t.ticksAbsorbed;
  const ratio = t.delayed > 0 ? back / t.delayed : 1;
  console.log(
    `RECONCILE shield ${shield} → tick ${TABLE[shield]}: delayed ${Math.round(t.delayed)} · came back ${Math.round(back)} ` +
      `(landed ${Math.round(t.ticksLanded)} + absorbed by a real shield ${Math.round(t.ticksAbsorbed)}) = ${(ratio * 100).toFixed(1)}% ` +
      `over ${t.rounds} rounds${ratio < 0.9 ? "  FLAG" : ""}`,
  );
}
console.log(
  `DOUBLE ${Math.round(double)} damage in ${doubleEvents} deferral-shield absorb events still counted as pressure`,
);
process.exit(double > 0 ? 1 : 0);

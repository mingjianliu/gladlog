/**
 * FT-T01 fact-vs-raw scan: does every melee swing in the raw log reach the
 * parsed damage arrays exactly once?
 *
 * A swing is logged as `SWING_DAMAGE` (attacker's advanced block) and / or
 * `SWING_DAMAGE_LANDED` (victim's). The parser keeps the first and has to keep
 * a LANDED line that has no twin — a guardian the logging client has no owner
 * for swings with LANDED lines only. A parser drop is invisible to the prompt
 * gates (they read the parser's own output), so this scan re-reads `rawLines`.
 *
 * The twin predicate is the parser's own (`swingLandedTwins`, registered in
 * docs/predicate-index.md); the scan reports its pair-gap histogram so the
 * window can be re-checked on a new corpus.
 *
 * Classes (per match / shuffle round, rawLines-indexed):
 *   MISSING    LANDED-only line, amount > 0, target is a parsed unit, and the
 *              line is in nobody's damageIn                       → must be 0
 *   DOUBLE     twin LANDED line that IS in a damage array (the swing counted
 *              twice)                                             → must be 0
 *   ZERO-NOABS LANDED-only line with amount 0 and absorbed > 0 whose absorbed
 *              amount is not met by SPELL_ABSORBED records of the same swing
 *              (melee form, same attacker and victim, `totalAmount` = the
 *              line's `baseAmount`, inside the twin window; each record used
 *              once). Such a line is not made a damage event because its
 *              absorb is already an absorb event — this is that claim
 *                                                                 → must be 0
 *
 * Usage: npx tsx packages/eval/scripts/swingLandedScan.ts [--show] <raw.txt | dir>...
 *   --show prints every offending raw line (class, match id, rawLines index)
 *   (a dir is walked for raw.txt files; one file at a time)
 * Exit code 1 when any must-be-0 class is non-zero.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import {
  GladLogParser,
  type GladMatchBase,
  type ParsedLine,
  parseLine,
  SWING_TWIN_WINDOW_MS,
  swingLandedTwins,
} from "@gladlog/parser";

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

const GAP_EDGES = [0, 5, 25, 50, 100, 200, 500, SWING_TWIN_WINDOW_MS];

interface Tally {
  items: number;
  swing: number;
  landed: number;
  pairs: number;
  landedFirst: number;
  maxGapMs: number;
  gaps: number[];
  landedOnly: number;
  landedOnlyHit: number;
  landedOnlyHitDamage: number;
  missing: number;
  missingDamage: number;
  missingOnPlayer: number;
  missingOnPlayerDamage: number;
  missingKillingBlows: number;
  targetNotAUnit: number;
  double: number;
  doubleDamage: number;
  zero: number;
  zeroNoAbsorb: number;
  amountDiffers: number;
}

const newTally = (): Tally => ({
  items: 0,
  swing: 0,
  landed: 0,
  pairs: 0,
  landedFirst: 0,
  maxGapMs: 0,
  gaps: GAP_EDGES.map(() => 0),
  landedOnly: 0,
  landedOnlyHit: 0,
  landedOnlyHitDamage: 0,
  missing: 0,
  missingDamage: 0,
  missingOnPlayer: 0,
  missingOnPlayerDamage: 0,
  missingKillingBlows: 0,
  targetNotAUnit: 0,
  double: 0,
  doubleDamage: 0,
  zero: 0,
  zeroNoAbsorb: 0,
  amountDiffers: 0,
});

function add(into: Tally, t: Tally): void {
  for (const k of Object.keys(t) as (keyof Tally)[]) {
    if (k === "gaps") t.gaps.forEach((n, i) => (into.gaps[i]! += n));
    else if (k === "maxGapMs") into.maxGapMs = Math.max(into.maxGapMs, t[k]);
    else (into[k] as number) += t[k] as number;
  }
}

const SHOW = process.argv.includes("--show");
function show(cls: string, m: GladMatchBase, r: ParsedLine): void {
  if (SHOW)
    console.log(`  ${cls} ${m.id} #${r.lineIndex} ${r.raw.slice(0, 160)}`);
}

function scanItem(m: GladMatchBase): Tally {
  const t = newTally();
  t.items = 1;
  const records: ParsedLine[] = [];
  m.rawLines.forEach((raw, i) => {
    const r = parseLine(raw);
    if (!r) return;
    r.lineIndex = i;
    records.push(r);
  });

  const inDamageArrays = new Set<number>();
  for (const u of Object.values(m.units)) {
    for (const e of [...u.damageIn, ...u.damageOut])
      if (e.lineIndex != null) inDamageArrays.add(e.lineIndex);
  }

  // Melee SPELL_ABSORBED records keyed attacker|victim|totalAmount (a spell's
  // absorb names the attacking spell; a Soul Link share names the pet).
  const meleeAbsorbs = new Map<
    string,
    { at: number; amount: number; used: boolean }[]
  >();
  for (const r of records) {
    if (!r.absorbed || r.absorbed.attackSpellId !== null) continue;
    const key = `${r.absorbed.attackerGuid}|${r.absorbed.victimGuid}|${r.absorbed.totalAmount}`;
    const list = meleeAbsorbs.get(key) ?? [];
    list.push({
      at: r.timestamp,
      amount: r.absorbed.absorbedAmount,
      used: false,
    });
    meleeAbsorbs.set(key, list);
  }
  const absorbCovered = (r: ParsedLine): boolean => {
    const near = (
      meleeAbsorbs.get(
        `${r.base!.srcGuid}|${r.base!.destGuid}|${r.damage!.baseAmount}`,
      ) ?? []
    )
      .filter(
        (a) => !a.used && Math.abs(a.at - r.timestamp) <= SWING_TWIN_WINDOW_MS,
      )
      .sort(
        (a, b) => Math.abs(a.at - r.timestamp) - Math.abs(b.at - r.timestamp),
      );
    let left = r.damage!.absorbed;
    for (const a of near) {
      if (left <= 0) break;
      a.used = true;
      left -= a.amount;
    }
    return left <= 0;
  };

  const twins = swingLandedTwins(records);

  for (const r of records) {
    if (r.eventName === "SWING_DAMAGE" && r.damage && r.base) t.swing++;
  }

  for (const r of records) {
    if (r.eventName !== "SWING_DAMAGE_LANDED" || !r.damage || !r.base) continue;
    t.landed++;
    const idx = r.lineIndex!;
    const { amount, absorbed, overkill } = r.damage;
    // Pair statistics come from the matcher's own pairing, never a second
    // derivation of it.
    const twin = twins.get(r);
    if (twin) {
      t.pairs++;
      const gap = Math.abs(twin.timestamp - r.timestamp);
      t.maxGapMs = Math.max(t.maxGapMs, gap);
      t.gaps[GAP_EDGES.findIndex((e) => gap <= e)]!++;
      if (twin.lineIndex! > idx) t.landedFirst++;
      if (twin.damage!.amount !== amount) t.amountDiffers++;
      if (inDamageArrays.has(idx)) {
        t.double++;
        show("DOUBLE", m, r);
        t.doubleDamage += amount;
      }
      continue;
    }
    t.landedOnly++;
    if (!(amount > 0)) {
      t.zero++;
      if (absorbed > 0 && !absorbCovered(r)) {
        t.zeroNoAbsorb++;
        show("ZERO-NOABS", m, r);
      }
      continue;
    }
    t.landedOnlyHit++;
    t.landedOnlyHitDamage += amount;
    if (!m.units[r.base.destGuid]) {
      t.targetNotAUnit++;
      continue;
    }
    if (!inDamageArrays.has(idx)) {
      t.missing++;
      show("MISSING", m, r);
      t.missingDamage += amount;
      if (r.base.destGuid.startsWith("Player-")) {
        t.missingOnPlayer++;
        t.missingOnPlayerDamage += amount;
      }
      if (overkill > 0) t.missingKillingBlows++;
    }
  }
  return t;
}

const args = process.argv.slice(2).filter((a) => a !== "--show");
if (args.length === 0) {
  console.error("usage: swingLandedScan.ts <raw.txt | dir>...");
  process.exit(2);
}

const total = newTally();
let files = 0;
for (const file of args.flatMap(rawFiles)) {
  const items: GladMatchBase[] = [];
  const p = new GladLogParser();
  p.on("match", (m: GladMatchBase) => items.push(m));
  p.on("shuffle", (sh: { rounds: GladMatchBase[] }) => {
    for (const r of sh.rounds) items.push(r);
  });
  for (const line of readFileSync(file, "utf8").split("\n")) p.push(line);
  p.end();
  const t = newTally();
  for (const m of items) add(t, scanItem(m));
  add(total, t);
  files++;
  const tag = path.basename(path.dirname(file));
  console.log(
    `${tag} items=${t.items} landed=${t.landed} pairs=${t.pairs} landedOnlyHit=${t.landedOnlyHit} ` +
      `MISSING=${t.missing} (${t.missingDamage} dmg, on players ${t.missingOnPlayerDamage}, killing blows ${t.missingKillingBlows}) ` +
      `DOUBLE=${t.double} ZERO-NOABS=${t.zeroNoAbsorb}/${t.zero}`,
  );
}

console.log(`\n=== ${files} files, ${total.items} matches / rounds ===`);
console.log(
  `SWING_DAMAGE ${total.swing} · SWING_DAMAGE_LANDED ${total.landed} · pairs ${total.pairs} ` +
    `(LANDED first in ${total.landedFirst}; amount differs in ${total.amountDiffers}) · max gap ${total.maxGapMs} ms`,
);
console.log(
  "pair gap ≤ms: " +
    GAP_EDGES.map((e, i) => `${e}:${total.gaps[i]}`).join("  "),
);
console.log(
  `LANDED-only ${total.landedOnly}: amount>0 ${total.landedOnlyHit} (${total.landedOnlyHitDamage} dmg), ` +
    `amount=0 ${total.zero}; target not a parsed unit ${total.targetNotAUnit}`,
);
console.log(
  `MISSING ${total.missing} lines / ${total.missingDamage} dmg ` +
    `(on players ${total.missingOnPlayer} / ${total.missingOnPlayerDamage}; killing blows ${total.missingKillingBlows})`,
);
console.log(`DOUBLE ${total.double} lines / ${total.doubleDamage} dmg`);
console.log(`ZERO-NOABS ${total.zeroNoAbsorb} of ${total.zero}`);
process.exit(
  total.missing > 0 || total.double > 0 || total.zeroNoAbsorb > 0 ? 1 : 0,
);

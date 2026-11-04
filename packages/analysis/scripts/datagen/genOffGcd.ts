/**
 * Table of off-GCD active abilities (official data): the spell has a row in
 * DB2 SpellCooldowns and StartRecoveryTime == 0 -- pressable by the player
 * and not consuming the GCD (trinkets / interrupts / charges / racials).
 * Used for GCD lane folding: when several spells at the same instant are
 * folded, the on-GCD one is the main chip and off-GCD ones fold into small
 * icons. Restricted to the observed universe (observedSpellIdsGenerated), so
 * the table is tiny.
 *
 * Also emits the complement over rows that exist: `ON_GCD_SPELL_IDS`, a
 * SpellCooldowns row with StartRecoveryTime > 0 — a press that starts the
 * global cooldown. A spell with no row at all (a passive trigger such as
 * Shadowy Apparition 148859, a pet command such as Spell Lock 119910) is in
 * neither set (fact10 D22 / codex 20-F25-01).
 */
import fs from "fs-extra";

import { writeArtifact } from "./lib/emit";
import {
  assertColumns,
  fetchTable,
  parseCsv,
  resolveBuild,
} from "./lib/wagoCsv";

async function main() {
  const build = await resolveBuild(process.argv[2]);
  const cacheDir = process.env.DATAGEN_CACHE ?? undefined;
  const observed = new Set(
    (
      JSON.parse(
        fs.readFileSync(
          new URL(
            "../../src/data/observedSpellIdsGenerated.json",
            import.meta.url,
          ).pathname,
          "utf8",
        ),
      ) as number[]
    ).map(String),
  );
  const parsed = parseCsv(await fetchTable("SpellCooldowns", build, cacheDir));
  assertColumns(
    parsed.header,
    ["SpellID", "DifficultyID", "StartRecoveryTime"],
    "SpellCooldowns",
  );
  const off: number[] = [];
  const on: number[] = [];
  const seen = new Set<string>();
  for (const row of parsed.rows) {
    if (row.DifficultyID !== "0" || !row.SpellID || seen.has(row.SpellID))
      continue;
    seen.add(row.SpellID);
    if (!observed.has(row.SpellID)) continue;
    if (Number(row.StartRecoveryTime) === 0) off.push(Number(row.SpellID));
    else if (Number(row.StartRecoveryTime) > 0) on.push(Number(row.SpellID));
  }
  off.sort((a, b) => a - b);
  on.sort((a, b) => a - b);
  const outPath = new URL("../../src/data/offGcdGenerated.ts", import.meta.url)
    .pathname;
  const header = `/**\n * Generated at: ${new Date().toISOString()}\n * Build: ${build}\n * Source: SpellCooldowns has a row and StartRecoveryTime==0 (off-GCD player-\n *   activated abilities), restricted to the observed universe\n * ids: ${off.length} off, ${on.length} on\n */\n\n`;
  writeArtifact(
    outPath,
    header +
      `export const OFF_GCD_SPELL_IDS: ReadonlySet<string> = new Set(\n  ${JSON.stringify(off.map(String))},\n);\n\n` +
      `/** SpellCooldowns row with StartRecoveryTime > 0: a press that starts the GCD. */\n` +
      `export const ON_GCD_SPELL_IDS: ReadonlySet<string> = new Set(\n  ${JSON.stringify(on.map(String))},\n);\n`,
  );
  console.log(
    `offGcdGenerated.ts: ${off.length} off-GCD, ${on.length} on-GCD ids (build ${build})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Table of off-GCD active abilities (official data): the spell has a row in
 * DB2 SpellCooldowns and StartRecoveryTime == 0 -- pressable by the player
 * and not consuming the GCD (trinkets / interrupts / charges / racials).
 * Used for GCD lane folding: when several spells at the same instant are
 * folded, the on-GCD one is the main chip and off-GCD ones fold into small
 * icons. Restricted to the observed universe (observedSpellIdsGenerated), so
 * the table is tiny.
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
  const seen = new Set<string>();
  for (const row of parsed.rows) {
    if (row.DifficultyID !== "0" || !row.SpellID || seen.has(row.SpellID))
      continue;
    seen.add(row.SpellID);
    if (!observed.has(row.SpellID)) continue;
    if (Number(row.StartRecoveryTime) === 0) off.push(Number(row.SpellID));
  }
  off.sort((a, b) => a - b);
  const outPath = new URL("../../src/data/offGcdGenerated.ts", import.meta.url)
    .pathname;
  const header = `/**\n * Generated at: ${new Date().toISOString()}\n * Build: ${build}\n * Source: SpellCooldowns has a row and StartRecoveryTime==0 (off-GCD player-\n *   activated abilities), restricted to the observed universe\n * ids: ${off.length}\n */\n\n`;
  writeArtifact(
    outPath,
    header +
      `export const OFF_GCD_SPELL_IDS: ReadonlySet<string> = new Set(\n  ${JSON.stringify(off.map(String))},\n);\n`,
  );
  console.log(`offGcdGenerated.ts: ${off.length} off-GCD ids (build ${build})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

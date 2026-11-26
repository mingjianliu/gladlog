/**
 * A spell's damage class (official data, DB2 SpellCategories.DefenseType: 1
 * Magic, 2 Melee, 3 Ranged), restricted to the observed universe
 * (observedSpellIdsGenerated) like spellParryGenerated. The class, not the
 * school, is what a proc's "taken melee / ranged" flags read
 * (SpellAuraOptions.ProcTypeMask: 0x20 taken melee-class spell, 0x200 taken
 * ranged-class spell): Final Verdict is Holy and class 2, Flurry Strikes is
 * Physical and class 1.
 *
 * `MELEE_CLASS_SPELL_IDS` is DefenseType 2, `RANGED_CLASS_SPELL_IDS`
 * DefenseType 3. DefenseType 0, 1 or no row is in neither set.
 * `SUPPRESS_TARGET_PROCS_SPELL_IDS` is SpellMisc Attributes_3 bit 17
 * (SPELL_ATTR3_SUPPRESS_TARGET_PROCS, TrinityCore SharedDefines.h): a hit of
 * such a spell fires none of its target's procs (Divine Storm 224239). The
 * class sets are read through `data/spellDamageClass.ts`, the suppress set by
 * `hostileTakenTriggers` (`talentScriptedCooldowns.ts`).
 */
import fs from "fs-extra";

import { writeArtifact } from "./lib/emit";
import {
  assertColumns,
  fetchTable,
  parseCsv,
  resolveBuild,
} from "./lib/wagoCsv";

const DEFENSE_TYPE_MELEE = "2";
const DEFENSE_TYPE_RANGED = "3";
const SUPPRESS_TARGET_PROCS_BIT = 17; // Attributes_3

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
  const cats = parseCsv(await fetchTable("SpellCategories", build, cacheDir));
  assertColumns(
    cats.header,
    ["SpellID", "DifficultyID", "DefenseType"],
    "SpellCategories",
  );
  const melee: number[] = [];
  const ranged: number[] = [];
  const seen = new Set<string>();
  for (const row of cats.rows) {
    if (row.DifficultyID !== "0" || !row.SpellID || seen.has(row.SpellID))
      continue;
    seen.add(row.SpellID);
    if (!observed.has(row.SpellID)) continue;
    if (row.DefenseType === DEFENSE_TYPE_MELEE) melee.push(Number(row.SpellID));
    else if (row.DefenseType === DEFENSE_TYPE_RANGED)
      ranged.push(Number(row.SpellID));
  }
  const misc = parseCsv(await fetchTable("SpellMisc", build, cacheDir));
  assertColumns(
    misc.header,
    ["SpellID", "DifficultyID", "Attributes_3"],
    "SpellMisc",
  );
  const suppress: number[] = [];
  const seenMisc = new Set<string>();
  for (const row of misc.rows) {
    if (row.DifficultyID !== "0" || !row.SpellID || seenMisc.has(row.SpellID))
      continue;
    seenMisc.add(row.SpellID);
    if (!observed.has(row.SpellID)) continue;
    const n = Number(row.Attributes_3 ?? "0");
    if (Number.isFinite(n) && ((n >>> SUPPRESS_TARGET_PROCS_BIT) & 1) === 1)
      suppress.push(Number(row.SpellID));
  }
  suppress.sort((a, b) => a - b);
  melee.sort((a, b) => a - b);
  ranged.sort((a, b) => a - b);
  const outPath = new URL(
    "../../src/data/spellDamageClassGenerated.ts",
    import.meta.url,
  ).pathname;
  const header = `/**\n * Generated at: ${new Date().toISOString()}\n * Build: ${build}\n * Source: SpellCategories.DefenseType (2 Melee, 3 Ranged) and SpellMisc\n *   Attributes_3 bit 17 (Suppress Target Procs), restricted to the observed\n *   universe\n * ids: ${melee.length + ranged.length + suppress.length}\n */\n\n`;
  writeArtifact(
    outPath,
    header +
      `export const MELEE_CLASS_SPELL_IDS: ReadonlySet<string> = new Set(\n  ${JSON.stringify(melee.map(String))},\n);\n\n` +
      `export const RANGED_CLASS_SPELL_IDS: ReadonlySet<string> = new Set(\n  ${JSON.stringify(ranged.map(String))},\n);\n\n` +
      `export const SUPPRESS_TARGET_PROCS_SPELL_IDS: ReadonlySet<string> = new Set(\n  ${JSON.stringify(suppress.map(String))},\n);\n`,
  );
  console.log(
    `spellDamageClassGenerated.ts: ${melee.length} melee, ${ranged.length} ranged, ${suppress.length} suppress target procs (build ${build})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

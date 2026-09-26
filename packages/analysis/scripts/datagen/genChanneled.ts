/**
 * Table of channelled spells (official data): DB2 SpellMisc Attributes_1 bit 2
 * ("Is Channelled", SPELL_ATTR1_IS_CHANNELLED — SimulationCraft attribute
 * index 34). Restricted to the observed universe (observedSpellIdsGenerated),
 * like offGcdGenerated.
 *
 * Reliability round 3 W1k: a kick after a spell's own SPELL_CAST_SUCCESS hit
 * the CHANNEL, not the cast bar — but a chain-caster whose next cast start was
 * not logged looks the same, and the first pass tagged 22 Smites / Chaos Bolts
 * / Flash Heals as channel kicks. The attribute separates them cleanly on the
 * audited spells: every channel (Mind Control, Drain Soul, Void Torrent, Ray
 * of Frost, Arcane Missiles, Soothing Mist, Tranquility, Divine Hymn …) has
 * the bit, no hardcast does; empowered spells (Fire / Dream Breath) carry only
 * bit 6 and are deliberately not channels here.
 */
import fs from "fs-extra";

import { writeArtifact } from "./lib/emit";
import {
  assertColumns,
  resolveBuild,
  fetchTable,
  parseCsv,
} from "./lib/wagoCsv";

export const IS_CHANNELLED_BIT = 2; // Attributes_1

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
  const parsed = parseCsv(await fetchTable("SpellMisc", build, cacheDir));
  assertColumns(
    parsed.header,
    ["SpellID", "DifficultyID", "Attributes_1"],
    "SpellMisc",
  );
  const ids: number[] = [];
  const seen = new Set<string>();
  for (const row of parsed.rows) {
    if (row.DifficultyID !== "0" || !row.SpellID || seen.has(row.SpellID))
      continue;
    seen.add(row.SpellID);
    if (!observed.has(row.SpellID)) continue;
    const a1 = Number(row.Attributes_1 ?? "0");
    if (Number.isFinite(a1) && ((a1 >>> IS_CHANNELLED_BIT) & 1) === 1)
      ids.push(Number(row.SpellID));
  }
  ids.sort((a, b) => a - b);
  const outPath = new URL(
    "../../src/data/channeledGenerated.ts",
    import.meta.url,
  ).pathname;
  const header = `/**\n * Generated at: ${new Date().toISOString()}\n * Build: ${build}\n * Source: SpellMisc Attributes_1 bit ${IS_CHANNELLED_BIT} (Is Channelled), restricted to the\n *   observed universe\n * ids: ${ids.length}\n */\n\n`;
  writeArtifact(
    outPath,
    header +
      `export const CHANNELED_SPELL_IDS: ReadonlySet<string> = new Set(\n  ${JSON.stringify(ids.map(String))},\n);\n`,
  );
  console.log(
    `channeledGenerated.ts: ${ids.length} channelled ids (build ${build})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

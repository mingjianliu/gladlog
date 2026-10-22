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
 *
 * fact3 D36 (2026-10-21): bit 6 ("Is Self Channelled", 0x40) without bit 2 is
 * a channel too, unless the spell is empowered (its own `SpellEmpower` row).
 * Dark Harvest 1257052 carries only 0x40: a Spell Lock 0.6 s into its channel
 * read as no channel kick (6f49c8f0 0:26). Observed 0x40-only ids on
 * 12.1.5.70391: 14 — Fire Breath ×3, Dream Breath ×2 and Azerite Surge have
 * an empower row; Dark Harvest, Emerald Communion, Celestial Conduit, Time
 * Skip, Cannibalize, Dream Projection … do not.
 */
import fs from "fs-extra";

import { writeArtifact } from "./lib/emit";
import {
  assertColumns,
  fetchTable,
  parseCsv,
  resolveBuild,
} from "./lib/wagoCsv";

export const IS_CHANNELLED_BIT = 2; // Attributes_1
export const IS_SELF_CHANNELLED_BIT = 6; // Attributes_1

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
  const empowered = new Set(
    parseCsv(await fetchTable("SpellEmpower", build, cacheDir)).rows.map(
      (r) => r.SpellID,
    ),
  );
  const ids: number[] = [];
  const seen = new Set<string>();
  for (const row of parsed.rows) {
    if (row.DifficultyID !== "0" || !row.SpellID || seen.has(row.SpellID))
      continue;
    seen.add(row.SpellID);
    if (!observed.has(row.SpellID)) continue;
    const a1 = Number(row.Attributes_1 ?? "0");
    if (!Number.isFinite(a1)) continue;
    if (
      ((a1 >>> IS_CHANNELLED_BIT) & 1) === 1 ||
      (((a1 >>> IS_SELF_CHANNELLED_BIT) & 1) === 1 &&
        !empowered.has(row.SpellID))
    )
      ids.push(Number(row.SpellID));
  }
  ids.sort((a, b) => a - b);
  const outPath = new URL(
    "../../src/data/channeledGenerated.ts",
    import.meta.url,
  ).pathname;
  const header = `/**\n * Generated at: ${new Date().toISOString()}\n * Build: ${build}\n * Source: SpellMisc Attributes_1 bit ${IS_CHANNELLED_BIT} (Is Channelled), or bit\n *   ${IS_SELF_CHANNELLED_BIT} (Is Self Channelled) without a SpellEmpower row, restricted to\n *   the observed universe\n * ids: ${ids.length}\n */\n\n`;
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

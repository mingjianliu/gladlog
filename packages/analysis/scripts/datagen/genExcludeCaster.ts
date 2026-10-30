/**
 * Spells that cannot target their own caster (official data): DB2 SpellMisc
 * Attributes_1 bit 19 ("Exclude Caster", SPELL_ATTR1_EXCLUDE_CASTER).
 * Restricted to the observed universe (observedSpellIdsGenerated), like
 * channeledGenerated.
 *
 * GH #167 (Curated-List Completeness): `SELF_CAST_NOOP_EXTERNAL_IDS`
 * (cooldowns.ts) is the hand list of externals that do nothing when pressed
 * on oneself; its evidence was this bit on one spell (Blessing of Sacrifice
 * 6940 / 199448). This table is the forward check — every observed
 * ally-castable defensive carrying the bit must be on the hand list
 * (`test/selfCastNoopForward.test.ts`). On 12.1.5.70391: of the 15 observed
 * ally-castable defensives, Blessing of Sacrifice alone.
 */
import fs from "fs-extra";

import { writeArtifact } from "./lib/emit";
import {
  assertColumns,
  fetchTable,
  parseCsv,
  resolveBuild,
} from "./lib/wagoCsv";

export const EXCLUDE_CASTER_BIT = 19; // Attributes_1

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
    if (!Number.isFinite(a1)) continue;
    if (((a1 >>> EXCLUDE_CASTER_BIT) & 1) === 1) ids.push(Number(row.SpellID));
  }
  ids.sort((a, b) => a - b);
  const outPath = new URL(
    "../../src/data/excludeCasterGenerated.ts",
    import.meta.url,
  ).pathname;
  const header = `/**\n * Generated at: ${new Date().toISOString()}\n * Build: ${build}\n * Source: SpellMisc Attributes_1 bit ${EXCLUDE_CASTER_BIT} (Exclude Caster), restricted to the\n *   observed universe\n * ids: ${ids.length}\n */\n\n`;
  writeArtifact(
    outPath,
    header +
      `export const EXCLUDE_CASTER_SPELL_IDS: ReadonlySet<string> = new Set(\n  ${JSON.stringify(ids.map(String))},\n);\n`,
  );
  console.log(
    `excludeCasterGenerated.ts: ${ids.length} exclude-caster ids (build ${build})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

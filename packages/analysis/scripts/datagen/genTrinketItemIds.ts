import {
  parseCsv,
  resolveBuild,
  fetchTable,
  assertColumns,
} from "./lib/wagoCsv";
import { writeArtifact } from "./lib/emit";

export const ADAPTATION_NAME_FRAGMENT = "Sigil of Adaptation";
export const RELENTLESS_NAME_FRAGMENT = "Relentless";
export const TRINKET_INVENTORY_TYPE = "12";
/** Gladiator's Medallion on-use spell. Items carrying it are found through
 * ItemEffect.SpellID → ItemXItemEffect.ItemID — the official link, not a name
 * match (reliability round 3 W1j: a player with no Medallion equipped was
 * rendered "PvP Trinket available"). */
export const GLADIATOR_MEDALLION_SPELL_ID = "336126";

/** Item ids whose on-use effect is `spellId`. */
export function extractItemsWithOnUse(
  itemEffectRows: Record<string, string>[],
  itemXItemEffectRows: Record<string, string>[],
  spellId: string,
): string[] {
  const effectIds = new Set(
    itemEffectRows.filter((r) => r["SpellID"] === spellId).map((r) => r["ID"]),
  );
  return uniqueSortedIds(
    itemXItemEffectRows
      .filter((r) => effectIds.has(r["ItemEffectID"] ?? ""))
      .map((r) => r["ItemID"] ?? ""),
  );
}

function uniqueSortedIds(ids: string[]): string[] {
  return Array.from(new Set(ids.filter((id) => /^\d+$/.test(id)))).sort(
    (a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10),
  );
}

export function extractTrinketIds(itemSparseRows: Record<string, string>[]): {
  adaptationItemIds: string[];
  relentlessItemIds: string[];
} {
  const trinketRows = itemSparseRows.filter(
    (r) => r["InventoryType"] === TRINKET_INVENTORY_TYPE,
  );

  const adaptationItemIds = uniqueSortedIds(
    trinketRows
      .filter((r) =>
        (r["Display_lang"] ?? "").includes(ADAPTATION_NAME_FRAGMENT),
      )
      .map((r) => r["ID"])
      .filter(Boolean),
  );

  const relentlessItemIds = uniqueSortedIds(
    trinketRows
      .filter((r) =>
        (r["Display_lang"] ?? "").includes(RELENTLESS_NAME_FRAGMENT),
      )
      .map((r) => r["ID"])
      .filter(Boolean),
  );

  return {
    adaptationItemIds,
    relentlessItemIds,
  };
}

export async function main(): Promise<void> {
  const build = await resolveBuild();
  const cacheDir = process.env.DATAGEN_CACHE ?? undefined;

  const itemSparseRaw = await fetchTable("ItemSparse", build, cacheDir);
  const itemSparseParsed = parseCsv(itemSparseRaw);
  assertColumns(
    itemSparseParsed.header,
    ["ID", "Display_lang", "InventoryType"],
    "ItemSparse",
  );

  const { adaptationItemIds, relentlessItemIds } = extractTrinketIds(
    itemSparseParsed.rows,
  );

  const itemEffect = parseCsv(await fetchTable("ItemEffect", build, cacheDir));
  assertColumns(itemEffect.header, ["ID", "SpellID"], "ItemEffect");
  const itemXItemEffect = parseCsv(
    await fetchTable("ItemXItemEffect", build, cacheDir),
  );
  assertColumns(
    itemXItemEffect.header,
    ["ItemEffectID", "ItemID"],
    "ItemXItemEffect",
  );
  const gladiatorItemIds = extractItemsWithOnUse(
    itemEffect.rows,
    itemXItemEffect.rows,
    GLADIATOR_MEDALLION_SPELL_ID,
  );

  const output = {
    generatedAt: new Date().toISOString(),
    sources: {
      itemSparseCsv: `https://wago.tools/db2/ItemSparse/csv?build=${encodeURIComponent(
        build,
      )}`,
      itemEffectCsv: `https://wago.tools/db2/ItemEffect/csv?build=${encodeURIComponent(
        build,
      )}`,
      itemXItemEffectCsv: `https://wago.tools/db2/ItemXItemEffect/csv?build=${encodeURIComponent(
        build,
      )}`,
    },
    adaptationNameFragment: ADAPTATION_NAME_FRAGMENT,
    relentlessNameFragment: RELENTLESS_NAME_FRAGMENT,
    adaptationItemIds,
    relentlessItemIds,
    gladiatorMedallionSpellId: GLADIATOR_MEDALLION_SPELL_ID,
    gladiatorItemIds,
  };

  const outPath = new URL("../../src/data/trinketItemIds.json", import.meta.url)
    .pathname;

  writeArtifact(outPath, `${JSON.stringify(output, null, 2)}\n`);
}

if (
  typeof process !== "undefined" &&
  process.argv &&
  process.argv[1]?.endsWith("genTrinketItemIds.ts")
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

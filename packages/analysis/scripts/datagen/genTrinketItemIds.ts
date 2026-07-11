import {
  parseCsv,
  fetchLatestBuild,
  fetchTable,
  assertColumns,
} from "./lib/wagoCsv";
import { writeArtifact } from "./lib/emit";

export const ADAPTATION_NAME_FRAGMENT = "Sigil of Adaptation";
export const RELENTLESS_NAME_FRAGMENT = "Relentless";
export const TRINKET_INVENTORY_TYPE = "12";

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
      .filter((r) => (r["Display_lang"] ?? "").includes(RELENTLESS_NAME_FRAGMENT))
      .map((r) => r["ID"])
      .filter(Boolean),
  );

  return {
    adaptationItemIds,
    relentlessItemIds,
  };
}

export async function main(): Promise<void> {
  const build = await fetchLatestBuild();
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

  const output = {
    generatedAt: new Date().toISOString(),
    sources: {
      itemSparseCsv: `https://wago.tools/db2/ItemSparse/csv?build=${encodeURIComponent(
        build,
      )}`,
    },
    adaptationNameFragment: ADAPTATION_NAME_FRAGMENT,
    relentlessNameFragment: RELENTLESS_NAME_FRAGMENT,
    adaptationItemIds,
    relentlessItemIds,
  };

  const outPath = new URL(
    "../../src/data/trinketItemIds.json",
    import.meta.url,
  ).pathname;

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

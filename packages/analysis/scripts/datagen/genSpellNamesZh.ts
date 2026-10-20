import { readFileSync } from "fs";

import { writeArtifact } from "./lib/emit";
import {
  assertMinRows,
  fetchLatestBuild,
  fetchTable,
  parseCsv,
} from "./lib/wagoCsv";

/** The zhCN spell-name table: only keep entries that "have an icon AND differ
 * from the enUS name". wago falls back to English in the same column for
 * untranslated entries → equal to enMap means untranslated, so drop it (the
 * runtime fallback chain is this match's log name > this table > the English
 * name as-is, so a missing entry naturally lands on English). */
export function transformSpellNamesZh(
  csvText: string,
  iconIds: ReadonlySet<string>,
  enMap: Record<string, string>,
): Record<string, string> {
  const { rows } = parseCsv(csvText);
  const map: Record<string, string> = {};
  for (const row of rows) {
    const id = row.ID;
    const zh = row.Name_lang;
    if (!iconIds.has(id)) continue;
    if (!zh || zh === enMap[id]) continue;
    map[id] = zh;
  }
  return map;
}

export async function main(): Promise<void> {
  const dataDir = new URL("../../src/data/", import.meta.url).pathname;
  const icons = JSON.parse(
    readFileSync(dataDir + "spellIconsGenerated.json", "utf8"),
  ) as { ids: Record<string, number> };
  const enMap = JSON.parse(
    readFileSync(dataDir + "spellNames.json", "utf8"),
  ) as Record<string, string>;

  // DATAGEN_BUILD pins the build number: the zh table must be regenerated on
  // the same build as the repo's other artifacts, never each calling
  // fetchLatestBuild() on its own and drifting apart (see
  // datagen-manifest.json).
  const build = process.env.DATAGEN_BUILD ?? (await fetchLatestBuild());
  const csv = await fetchTable(
    "SpellName",
    build,
    process.env.DATAGEN_CACHE,
    "zhCN",
  );
  const map = transformSpellNamesZh(
    csv,
    new Set(Object.keys(icons.ids)),
    enMap,
  );
  // The icon set has ~42k entries and the vast majority of player spells have
  // a real translation; dropping below 10k means the locale parameter or the
  // filtering logic is broken — better to fail loudly.
  assertMinRows(Object.keys(map), 10000, "SpellName(zhCN)");
  writeArtifact(dataDir + "spellNamesZhGenerated.json", JSON.stringify(map));
  console.log(Object.keys(map).length, build);
}

if (
  typeof process !== "undefined" &&
  process.argv &&
  process.argv[1]?.endsWith("genSpellNamesZh.ts")
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

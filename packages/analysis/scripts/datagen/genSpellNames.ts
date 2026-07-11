import { parseCsv, fetchLatestBuild, fetchTable, assertMinRows } from "./lib/wagoCsv";
import { writeArtifact } from "./lib/emit";

export function transformSpellNames(csvText: string): Record<string, string> {
  const { rows } = parseCsv(csvText);
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.ID] = row.Name_lang;
  }
  return map;
}

export async function main(): Promise<void> {
  const build = await fetchLatestBuild();
  const csv = await fetchTable("SpellName", build);
  const map = transformSpellNames(csv);
  assertMinRows(Object.keys(map), 100000, "SpellName");
  const outPath = new URL("../../src/data/spellNames.json", import.meta.url)
    .pathname;
  writeArtifact(outPath, JSON.stringify(map));
  console.log(Object.keys(map).length, build);
}

if (
  typeof process !== "undefined" &&
  process.argv &&
  process.argv[1]?.endsWith("genSpellNames.ts")
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

import {
  parseCsv,
  fetchLatestBuild,
  fetchTable,
  assertColumns,
} from "./lib/wagoCsv";
import { writeArtifact } from "./lib/emit";
import { collectCandidateIds } from "./lib/candidates";

export function classesForMask(mask: number): number[] {
  const result: number[] = [];
  let temp = mask;
  let bit = 0;
  while (temp > 0 && bit < 32) {
    if ((temp & 1) === 1) {
      result.push(bit + 1);
    }
    temp = temp >>> 1;
    bit++;
  }
  return result;
}

export function buildSpellClassMap(
  skillLineAbilityRows: Record<string, string>[],
  candidates: Set<string>,
): Record<string, number[]> {
  const map: Record<string, Set<number>> = {};
  for (const row of skillLineAbilityRows) {
    const id = row.Spell;
    if (!id || !candidates.has(id)) {
      continue;
    }
    const mask = Number(row.ClassMask);
    if (!mask || isNaN(mask)) {
      continue;
    }
    const classes = classesForMask(mask);
    if (classes.length === 0) {
      continue;
    }
    if (!map[id]) {
      map[id] = new Set<number>();
    }
    for (const c of classes) {
      map[id].add(c);
    }
  }

  const result: Record<string, number[]> = {};
  for (const id of Object.keys(map)) {
    result[id] = Array.from(map[id]).sort((a, b) => a - b);
  }
  return result;
}

export async function main(): Promise<void> {
  const build = await fetchLatestBuild();
  const cacheDir = process.env.DATAGEN_CACHE ?? undefined;

  const skillLineAbilityRaw = await fetchTable("SkillLineAbility", build, cacheDir);
  const skillLineAbilityParsed = parseCsv(skillLineAbilityRaw);
  assertColumns(
    skillLineAbilityParsed.header,
    ["Spell", "ClassMask"],
    "SkillLineAbility",
  );

  const pvpTalentRaw = await fetchTable("PvpTalent", build, cacheDir);
  const pvpTalentParsed = parseCsv(pvpTalentRaw);
  assertColumns(pvpTalentParsed.header, ["SpellID"], "PvpTalent");

  const candidates = collectCandidateIds(pvpTalentParsed.rows);
  const map = buildSpellClassMap(skillLineAbilityParsed.rows, candidates);

  const content = `/**
 * Generated at: ${new Date().toISOString()}
 * Build: ${build}
 * Entries: ${Object.keys(map).length}
 */

export const SPELL_TO_CLASSES: Record<string, number[]> = ${JSON.stringify(map, null, 2)};
`;

  const outPath = new URL(
    "../../src/data/spellClassMapGenerated.ts",
    import.meta.url,
  ).pathname;
  writeArtifact(outPath, content);
}

if (
  typeof process !== "undefined" &&
  process.argv &&
  process.argv[1]?.endsWith("genSpellClassMap.ts")
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

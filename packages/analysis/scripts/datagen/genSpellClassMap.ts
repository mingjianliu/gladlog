/**
 * spellId → 职业(DB2 SkillLineAbility.ClassMask)。
 *
 * ⚠️ **已有条目正确,但严重不全 —— 不要当成完整的职业归属数据接线。**
 * 2026-08-22 实测(GH #29 阶段 0 复核,用户裁定「数据正确就留着」):
 *   · 250 条条目,与 classMetadata 同时覆盖的 15 个 id **15/15 一致,0 不一致**;
 *   · 但 classMetadata 的 122 个技能里,这张表**只覆盖 15 个,缺 107 个**
 *     (盾墙、破釜沉舟、集结呐喊、鲁莽、剑刃风暴…全不在)。
 * 这是 SkillLineAbility 在 12.x 不完整的老问题(见 memory「正式数据优先于启发式」:
 * 官方表也要实测)。当前全仓**零消费者**,保留是因为数据本身没错、重新生成要重拉
 * DB2;真要用它之前必须先补完备性,否则「查不到 = 不是这个职业的」会直接错。
 */
import { collectCandidateIds } from "./lib/candidates";
import { writeArtifact } from "./lib/emit";
import {
  assertColumns,
  fetchTable,
  parseCsv,
  resolveBuild,
} from "./lib/wagoCsv";

export function classesForMask(mask: number): number[] {
  const result: number[] = [];
  // >>> converts to unsigned, preventing an early exit when bit31 is set and
  // the int32 would be negative (final review F4)
  let temp = mask >>> 0;
  let bit = 0;
  while (temp !== 0 && bit < 32) {
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
  const build = await resolveBuild();
  const cacheDir = process.env.DATAGEN_CACHE ?? undefined;

  const skillLineAbilityRaw = await fetchTable(
    "SkillLineAbility",
    build,
    cacheDir,
  );
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

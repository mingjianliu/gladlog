/**
 * Forward completeness check for CC classification: official DR-table ids
 * (DB2 DiminishType, drCategoriesGenerated) that the corpus actually shows but
 * SPELL_CATEGORIES does not classify. Every such id is a CC the prompt's [CC]
 * labels and the cc-cooldown candidates (both keyed on ccSpellIds ⊂
 * SPELL_CATEGORIES) are blind to, while hard-CC windows (DR_CATEGORY_MAP) see
 * it — two predicates for one fact. 2026-08-21 S2 archive: 63 ids.
 *
 * Usage: tsx packages/eval/scripts/drGapScan.ts <observedIds.json>
 *   (observedIds.json = observedSpellIds.ts output over the corpus of interest)
 */
import { getEnglishSpellName,SPELL_CATEGORIES } from "@gladlog/analysis";
import { readFileSync } from "fs";

import { DR_CATEGORIES_GENERATED } from "../../analysis/src/data/drCategoriesGenerated";
const observed = new Set((JSON.parse(readFileSync(process.argv[2], "utf8")) as number[]).map(String));
let total = 0;
for (const [cat, ids] of Object.entries(DR_CATEGORIES_GENERATED)) {
  const gaps = ids.filter((id) => observed.has(id) && !SPELL_CATEGORIES[id]);
  const seen = ids.filter((id) => observed.has(id));
  total += gaps.length;
  console.log(`${cat}: official ${ids.length}, seen in S2 ${seen.length}, seen-but-unclassified ${gaps.length}` + (gaps.length ? "\n   " + gaps.map((id) => `${id} ${getEnglishSpellName(id) ?? "?"}`).join("\n   ") : ""));
}
console.log(`TOTAL seen-but-unclassified: ${total}`);

import {
  parseCsv,
  fetchLatestBuild,
  fetchTable,
  assertColumns,
} from "./lib/wagoCsv";
import { writeArtifact } from "./lib/emit";
import { collectCandidateIds } from "./lib/candidates";
import type { IMinedSpell } from "../../src/data/spellEffectData";

export function mineSpellEffects(
  csv: {
    spellMisc: Record<string, string>[];
    spellDuration: Record<string, string>[];
    spellCooldowns: Record<string, string>[];
    spellCategories: Record<string, string>[];
    spellCategory: Record<string, string>[];
    spellName: Record<string, string>[];
  },
  candidates: Set<string>,
): Record<string, IMinedSpell> {
  const nameMap = new Map<string, string>();
  for (const row of csv.spellName) {
    if (row.ID && row.Name_lang) {
      nameMap.set(row.ID, row.Name_lang);
    }
  }

  const miscMap = new Map<string, (typeof csv.spellMisc)[0]>();
  for (const row of csv.spellMisc) {
    if (row.DifficultyID === "0") {
      miscMap.set(row.SpellID, row);
    }
  }

  const durationMap = new Map<string, (typeof csv.spellDuration)[0]>();
  for (const row of csv.spellDuration) {
    if (row.ID) {
      durationMap.set(row.ID, row);
    }
  }

  const cooldownsMap = new Map<string, (typeof csv.spellCooldowns)[0]>();
  for (const row of csv.spellCooldowns) {
    if (row.DifficultyID === "0") {
      cooldownsMap.set(row.SpellID, row);
    }
  }

  const categoriesMap = new Map<string, (typeof csv.spellCategories)[0]>();
  for (const row of csv.spellCategories) {
    if (row.DifficultyID === "0") {
      categoriesMap.set(row.SpellID, row);
    }
  }

  const categoryMap = new Map<string, (typeof csv.spellCategory)[0]>();
  for (const row of csv.spellCategory) {
    if (row.ID) {
      categoryMap.set(row.ID, row);
    }
  }

  const result: Record<string, IMinedSpell> = {};

  for (const id of candidates) {
    const name = nameMap.get(id);
    if (!name || name.trim() === "") {
      continue;
    }

    const mined: IMinedSpell = {
      spellId: id,
      name: name,
    };

    // Duration logic
    const miscRow = miscMap.get(id);
    if (miscRow) {
      const durationIndex =
        miscRow.PvPDurationIndex !== "0" && miscRow.PvPDurationIndex !== ""
          ? miscRow.PvPDurationIndex
          : miscRow.DurationIndex;

      if (durationIndex && durationIndex !== "0" && durationIndex !== "") {
        const durRow = durationMap.get(durationIndex);
        if (durRow && durRow.Duration) {
          const durSeconds = Number(durRow.Duration) / 1000;
          if (durSeconds > 0) {
            mined.durationSeconds = durSeconds;
          }
        }
      }
    }

    // Cooldown logic
    const cdRow = cooldownsMap.get(id);
    if (cdRow) {
      const recTime = Number(cdRow.RecoveryTime) || 0;
      const catRecTime = Number(cdRow.CategoryRecoveryTime) || 0;
      const ms = Math.max(recTime, catRecTime);
      // GCD 伪影过滤:≤1.5s 的"冷却"是全局公共 CD,不是技能 CD
      // (charge 型技能的真 CD 在 chargeCooldownSeconds)
      if (ms > 1500) {
        mined.cooldownSeconds = ms / 1000;
      }
    }

    // DispelType + Charges logic
    const catRow = categoriesMap.get(id);
    if (catRow) {
      const dispelTypeMap: Record<
        string,
        "Magic" | "Curse" | "Disease" | "Poison"
      > = {
        "1": "Magic",
        "2": "Curse",
        "3": "Disease",
        "4": "Poison",
      };
      const dispType = dispelTypeMap[catRow.DispelType];
      if (dispType) {
        mined.dispelType = dispType;
      }

      const chargeCategory = catRow.ChargeCategory;
      if (chargeCategory && chargeCategory !== "0" && chargeCategory !== "") {
        const chargeCatRow = categoryMap.get(chargeCategory);
        if (chargeCatRow) {
          const maxCharges = Number(chargeCatRow.MaxCharges) || 0;
          if (maxCharges > 0) {
            const chargeRecTime = Number(chargeCatRow.ChargeRecoveryTime) || 0;
            mined.charges = {
              charges: maxCharges,
              chargeCooldownSeconds: chargeRecTime / 1000,
            };
          }
        }
      }
    }

    result[id] = mined;
  }

  return result;
}

export async function main(): Promise<void> {
  const build = await fetchLatestBuild();
  const cacheDir = process.env.DATAGEN_CACHE ?? undefined;

  const spellMiscRaw = await fetchTable("SpellMisc", build, cacheDir);
  const spellMiscParsed = parseCsv(spellMiscRaw);
  assertColumns(
    spellMiscParsed.header,
    ["SpellID", "DifficultyID", "DurationIndex", "PvPDurationIndex"],
    "SpellMisc",
  );

  const spellDurationRaw = await fetchTable("SpellDuration", build, cacheDir);
  const spellDurationParsed = parseCsv(spellDurationRaw);
  assertColumns(
    spellDurationParsed.header,
    ["ID", "Duration"],
    "SpellDuration",
  );

  const spellCooldownsRaw = await fetchTable("SpellCooldowns", build, cacheDir);
  const spellCooldownsParsed = parseCsv(spellCooldownsRaw);
  assertColumns(
    spellCooldownsParsed.header,
    ["SpellID", "DifficultyID", "RecoveryTime", "CategoryRecoveryTime"],
    "SpellCooldowns",
  );

  const spellCategoriesRaw = await fetchTable(
    "SpellCategories",
    build,
    cacheDir,
  );
  const spellCategoriesParsed = parseCsv(spellCategoriesRaw);
  assertColumns(
    spellCategoriesParsed.header,
    ["SpellID", "DifficultyID", "DispelType", "ChargeCategory"],
    "SpellCategories",
  );

  const spellCategoryRaw = await fetchTable("SpellCategory", build, cacheDir);
  const spellCategoryParsed = parseCsv(spellCategoryRaw);
  assertColumns(
    spellCategoryParsed.header,
    ["ID", "MaxCharges", "ChargeRecoveryTime"],
    "SpellCategory",
  );

  const spellNameRaw = await fetchTable("SpellName", build, cacheDir);
  const spellNameParsed = parseCsv(spellNameRaw);
  assertColumns(spellNameParsed.header, ["ID", "Name_lang"], "SpellName");

  const pvpTalentRaw = await fetchTable("PvpTalent", build, cacheDir);
  const pvpTalentParsed = parseCsv(pvpTalentRaw);
  assertColumns(pvpTalentParsed.header, ["SpellID"], "PvpTalent");

  const csv = {
    spellMisc: spellMiscParsed.rows,
    spellDuration: spellDurationParsed.rows,
    spellCooldowns: spellCooldownsParsed.rows,
    spellCategories: spellCategoriesParsed.rows,
    spellCategory: spellCategoryParsed.rows,
    spellName: spellNameParsed.rows,
  };

  const candidates = collectCandidateIds(pvpTalentParsed.rows);
  const mined = mineSpellEffects(csv, candidates);

  if (Object.keys(mined).length < 300) {
    throw new Error(
      `Mined spell count is too low: ${Object.keys(mined).length}`,
    );
  }

  const content = `/**
 * Generated at: ${new Date().toISOString()}
 * Build: ${build}
 * Candidates: ${candidates.size}
 * Mined: ${Object.keys(mined).length}
 */

import type { IMinedSpell } from "./spellEffectData";

export const SPELL_EFFECTS_GENERATED: Record<string, IMinedSpell> = ${JSON.stringify(mined, null, 2)};
`;

  const outPath = new URL(
    "../../src/data/spellEffectGenerated.ts",
    import.meta.url,
  ).pathname;
  writeArtifact(outPath, content);
}

if (
  typeof process !== "undefined" &&
  process.argv &&
  process.argv[1]?.endsWith("genSpellEffects.ts")
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

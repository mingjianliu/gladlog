import fs from "node:fs";

import type { IMinedSpell } from "../../src/data/spellEffectData";
import { collectCandidateIds } from "./lib/candidates";
import { writeArtifact } from "./lib/emit";
import {
  assertColumns,
  fetchTable,
  parseCsv,
  resolveBuild,
} from "./lib/wagoCsv";

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
      // GCD artifact filter: a "cooldown" of <=1.5s is the global cooldown,
      // not the spell's own cooldown (a charge-based spell's real cooldown
      // lives in chargeCooldownSeconds)
      if (ms > 1500) {
        mined.cooldownSeconds = ms / 1000;
      }
    }

    // DispelType + Charges logic
    const catRow = categoriesMap.get(id);
    if (catRow) {
      // DB2 `SpellCategories.DispelType` enum. 11 = Bleed was missing until
      // 2026-08-17: the analysis side has had a full Bleed branch all along
      // (`DispelType` union, `BLEED_REMOVERS` = the three Evoker specs'
      // Cauterizing Flame, `canDefensiveCleanse`'s "Bleed" case) but nothing
      // ever fed it — no spell could carry the type, so the branch was dead
      // code. Verified against this build's own CSV: Rake (155722), Barbed
      // Shot (217200), Bloodshed (321538) and Rip (388539) all carry
      // DispelType=11, and all four are observed being removed by Cauterizing
      // Flame in the corpus. Values deliberately NOT mapped: 9 = Enrage
      // (soothe/Tranquilizing Shot territory — an OFFENSIVE dispel, not a
      // defensive cleanse), 5/6/8 (stealth/invisibility class, not cleansable
      // off an ally).
      const dispelTypeMap: Record<
        string,
        "Magic" | "Curse" | "Disease" | "Poison" | "Bleed"
      > = {
        "1": "Magic",
        "2": "Curse",
        "3": "Disease",
        "4": "Poison",
        "11": "Bleed",
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
  const build = await resolveBuild();
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

  // The data lives in a .json of the same name: a 295KB .ts object literal
  // would be parsed as SOURCE by V8 (a smaller version of the same disease as
  // the 22s spellNames incident), and vite's json.stringify only applies to
  // .json files.
  const jsonPath = new URL(
    "../../src/data/spellEffectGenerated.json",
    import.meta.url,
  ).pathname;
  fs.writeFileSync(jsonPath, JSON.stringify(mined));

  const content = `/**
 * Generated at: ${new Date().toISOString()}
 * Build: ${build}
 * Candidates: ${candidates.size}
 * Mined: ${Object.keys(mined).length}
 * The data lives in the .json of the same name (vite json.stringify ->
 * JSON.parse loading — the big-JSON lesson).
 */

import type { IMinedSpell } from "./spellEffectData";
import rawEffects from "./spellEffectGenerated.json";

export const SPELL_EFFECTS_GENERATED: Record<string, IMinedSpell> =
  rawEffects as unknown as Record<string, IMinedSpell>;
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

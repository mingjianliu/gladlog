import { classMetadata } from "../../src/data/classSpells";
import { spellClassMap } from "../../src/data/drCategories";
import observedSpellIds from "../../src/data/observedSpellIdsGenerated.json";
import { PVP_TALENT_POOL_GENERATED } from "../../src/data/pvpTalentPoolGenerated";
import { SPELL_CATEGORIES } from "../../src/data/spellCategories";
import spellIdLists from "../../src/data/spellIdLists";
import talentIdMap from "../../src/data/talentIdMap.json";
import { TEAM_HEAL_CD_IDS } from "../../src/utils/cooldowns";
import { writeArtifact } from "./lib/emit";
import {
  applyHotfixOverlay,
  dataDirOf,
  loadHotfixOverlay,
} from "./lib/simcHotfix";
import {
  buildTalentInventory,
  CLASS_ID_TO_FAMILY_FALLBACK,
  compileCooldownModifiers,
  deriveClassFamilies,
  type ICDModifier,
  serializeTalentInventory,
  talentClassMapOf,
} from "./lib/talentInventory";
import { fetchTable, parseCsv, resolveBuild } from "./lib/wagoCsv";

/** Re-exported from the inventory module (GH #96 M1): one definition. */
export type { ICDModifier } from "./lib/talentInventory";

function toInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Cooldown / charge talent modifiers for the tracked spells.
 *
 * GH #96 M1 (2026-09-13): a thin wrapper over the shared talent evidence
 * inventory (`lib/talentInventory.ts` → `buildTalentInventory`) and its
 * cooldown compiler (`compileCooldownModifiers`). Every rule that used to live
 * here — Path A class mask, Path B charge category (category effects only),
 * Path C direct id, SPELLMOD_COOLDOWN gating, aura 454, temporary-carrier
 * exclusion, row-identity dedup, one-effect-two-mechanisms reconciliation,
 * custom modifiers, tracked filter — moved there unchanged; the tests in
 * test/datagen/talentModifiers.test.ts exercise it through this signature.
 */
export function extractTalentModifiers(
  spellEffectRows: Record<string, string>[],
  spellClassOptionsRows: Record<string, string>[],
  spellCategoriesRows: Record<string, string>[],
  _spellNameRows: Record<string, string>[],
  trackedSpellIds: Set<string>,
  /**
   * Finite-duration carrier spells: their cooldown / charge SpellMods only
   * apply while the buff is up (Berserk 50334 "Frenzied Regeneration −100 %",
   * Avatar 107574 "Thunder Clap −50 %"), so they emit no permanent modifier.
   * `replace_spell` rows are kept. Optional so synthetic-row tests keep their
   * old behaviour; `main` always passes it.
   */
  temporarySourceIds: ReadonlySet<string> = new Set(),
): Record<string, ICDModifier[]> {
  const inventory = buildTalentInventory({
    talentTrees: talentIdMap as never,
    pvpPool: PVP_TALENT_POOL_GENERATED,
    spellEffectRows,
    spellClassOptionsRows,
    spellCategoriesRows,
    temporarySpellIds: temporarySourceIds,
    trackedSpellIds,
  });
  return compileCooldownModifiers(inventory, trackedSpellIds);
}

export async function main(): Promise<void> {
  const build = await resolveBuild();
  const cacheDir = process.env.DATAGEN_CACHE ?? undefined;

  const [
    spellEffectRaw,
    spellClassOptionsRaw,
    spellCategoriesRaw,
    spellNameRaw,
    spellMiscRaw,
    spellDurationRaw,
  ] = await Promise.all([
    fetchTable("SpellEffect", build, cacheDir),
    fetchTable("SpellClassOptions", build, cacheDir),
    fetchTable("SpellCategories", build, cacheDir),
    fetchTable("SpellName", build, cacheDir),
    fetchTable("SpellMisc", build, cacheDir),
    fetchTable("SpellDuration", build, cacheDir),
  ]);

  const spellEffectRows = parseCsv(spellEffectRaw).rows;
  // Live hotfixes on top of the client build (BACKLOG #41 (3)): cooldown /
  // charge modifiers are EffectBasePointsF too, and Blizzard tunes them.
  const hf = applyHotfixOverlay(
    spellEffectRows,
    loadHotfixOverlay(dataDirOf(import.meta.url)),
  );
  console.log(`hotfix overlay: ${hf.applied} writes on ${hf.rowsTouched} rows`);
  const spellClassOptionsRows = parseCsv(spellClassOptionsRaw).rows;
  const spellCategoriesRows = parseCsv(spellCategoriesRaw).rows;
  const spellNameRows = parseCsv(spellNameRaw).rows;

  const trackedSpellIds = new Set<string>();

  for (const c of classMetadata) {
    for (const a of c.abilities) {
      trackedSpellIds.add(a.spellId);
    }
  }
  for (const list of Object.values(spellIdLists)) {
    for (const id of list) {
      trackedSpellIds.add(String(id));
    }
  }
  for (const key of Object.keys(SPELL_CATEGORIES)) {
    trackedSpellIds.add(key);
  }
  if (spellClassMap.diminishingReturns) {
    for (const catList of Object.values(spellClassMap.diminishingReturns)) {
      for (const item of catList) {
        trackedSpellIds.add(item.spellId);
      }
    }
  }
  for (const id of TEAM_HEAL_CD_IDS) {
    trackedSpellIds.add(id);
  }
  // Corpus-observed ids (2026-08-17/18). Every other source above is a
  // HAND-MAINTAINED list, so step 6's "sanity filter" was silently throwing
  // away correctly-mined modifiers for any spell nobody had listed — the same
  // closed loop `collectCandidateIds` had for `dispelType`. Verified against
  // DB2 build 12.1.0.69273: Celerity (115173) emits BOTH `Aura=453
  // MiscValue_0=1365 BasePoints=-5000` (charge recovery −5s) and `Aura=411
  // MiscValue_0=1365 BasePoints=+1` (max charges +1) for Roll's charge
  // category, Warp (429483) `Aura=453 Misc=1948 −5000` and Aerial Mastery
  // (365933) `Aura=411 Misc=1948 +1` for Hover's, Wings of Liberty (1241704)
  // `Aura=411 Misc=2471 +1` for Verdant Embrace's — all matched by Path B
  // correctly, all discarded at the filter because Roll / Hover / Verdant
  // Embrace appear in none of the hand lists. (Talent effect text
  // cross-checked on murlok.io: Celerity "Reduces the cooldown of Roll by
  // 5 sec and increases its maximum number of charges by 1", Aerial Mastery
  // "Hover gains 1 additional charge", Warp "Hover's cooldown is also reduced
  // by 5 sec", Wings of Liberty "Verdant Embrace gains an additional
  // charge".)
  for (const id of observedSpellIds as number[]) {
    trackedSpellIds.add(String(id));
  }

  const extraKeys = [
    "1044",
    "49028",
    "50322",
    "55342",
    "93985",
    "102543",
    "102558",
    "114052",
    "185422",
    "192249",
    "194249",
    "198067",
    "199448",
    "204021",
    "264735",
    "305395",
    "361175",
    "383410",
    "386071",
    "387278",
    "389539",
    "389722",
    "390414",
    "403876",
    "410358",
    "414658",
    "454351",
    "454373",
    "466772",
    "1219480",
    "1236574",
    "1250646",
    "1261559",
  ];
  for (const id of extraKeys) {
    trackedSpellIds.add(id);
  }

  // Temporary-buff sources: a finite SpellDuration (> 0 ms). Passive talents
  // carry DurationIndex 0 or an infinite (-1) duration and stay eligible.
  const durationMs = new Map<string, number>();
  for (const row of parseCsv(spellDurationRaw).rows)
    durationMs.set(row.ID, toInt(row.Duration));
  const temporarySourceIds = new Set<string>();
  for (const row of parseCsv(spellMiscRaw).rows) {
    if (row.DifficultyID !== "0") continue;
    if ((durationMs.get(row.DurationIndex) ?? 0) > 0)
      temporarySourceIds.add(row.SpellID);
  }

  // DB2-derived class families must agree with the verified constants on real
  // data — a disagreement means either a class set moved or the derivation
  // broke, and both must stop the run (the 126/127/128 bug hid for weeks).
  const { derived } = deriveClassFamilies(
    talentClassMapOf(talentIdMap as never, PVP_TALENT_POOL_GENERATED),
    spellClassOptionsRows,
  );
  for (const [classId, fam] of Object.entries(CLASS_ID_TO_FAMILY_FALLBACK)) {
    if (derived[Number(classId)] !== fam)
      throw new Error(
        `class family mismatch for classId ${classId}: DB2 mode ${derived[Number(classId)]} vs verified ${fam}`,
      );
  }

  const filteredResults = extractTalentModifiers(
    spellEffectRows,
    spellClassOptionsRows,
    spellCategoriesRows,
    spellNameRows,
    trackedSpellIds,
    temporarySourceIds,
  );

  console.log(
    `Generated talent modifiers for ${Object.keys(filteredResults).length} tracked spells.`,
  );

  const outputPath = new URL(
    "../../src/data/talentModifiers.json",
    import.meta.url,
  ).pathname;

  writeArtifact(outputPath, `${JSON.stringify(filteredResults, null, 2)}\n`);
  console.log(`Wrote generated talent modifiers to ${outputPath}`);

  // GH #96 M1: the shared talent evidence inventory itself. Not imported by the
  // product; the later duration / mitigation compilers and eval scans read it.
  const spellMiscRows = parseCsv(spellMiscRaw).rows;
  const knownDurationSpellIds = new Set(
    spellMiscRows.filter((r) => r.DifficultyID === "0").map((r) => r.SpellID),
  );
  const inventory = buildTalentInventory({
    talentTrees: talentIdMap as never,
    pvpPool: PVP_TALENT_POOL_GENERATED,
    spellEffectRows,
    spellClassOptionsRows,
    spellCategoriesRows,
    temporarySpellIds: temporarySourceIds,
    knownDurationSpellIds,
    trackedSpellIds,
  });
  const inventoryPath = new URL(
    "../../src/data/talentEffectInventoryGenerated.json",
    import.meta.url,
  ).pathname;
  writeArtifact(inventoryPath, serializeTalentInventory(inventory, build));
  console.log(
    `Wrote talent inventory: ${inventory.rows.length} rows, ${inventory.edges.length} edges, ${inventory.meta.truncatedTriggerEdges} trigger edges truncated`,
  );
}

if (
  typeof process !== "undefined" &&
  process.argv &&
  process.argv[1]?.endsWith("genTalentModifiers.ts")
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

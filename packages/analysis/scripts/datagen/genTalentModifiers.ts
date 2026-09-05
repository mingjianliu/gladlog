import { classMetadata } from "../../src/data/classSpells";
import { spellClassMap } from "../../src/data/drCategories";
import observedSpellIds from "../../src/data/observedSpellIdsGenerated.json";
import { SPELL_CATEGORIES } from "../../src/data/spellCategories";
import spellIdLists from "../../src/data/spellIdLists";
import talentIdMap from "../../src/data/talentIdMap.json";
import { TEAM_HEAL_CD_IDS } from "../../src/utils/cooldowns";
import { CUSTOM_TALENT_MODIFIERS } from "./customTalentModifiers";
import { writeArtifact } from "./lib/emit";
import {
  applyHotfixOverlay,
  dataDirOf,
  loadHotfixOverlay,
} from "./lib/simcHotfix";
import { fetchTable, parseCsv, resolveBuild } from "./lib/wagoCsv";

const EFFECT_MOD_CHARGES = 121;
const EFFECT_MOD_COOLDOWN = 148;
const EFFECT_APPLY_AURA = 6;

const AURA_MOD_MAX_CHARGES = 411;
// 107/108 are TrinityCore's SPELL_AURA_ADD_FLAT_MODIFIER / SPELL_AURA_ADD_PCT_MODIFIER —
// generic "apply a SpellMod" auras, NOT dedicated cooldown auras. Which spell property
// they touch (cooldown, cast time, one numbered effect's value, ...) is selected by
// EffectMiscValue_0 acting as a SpellModOp code; only SPELLMOD_COOLDOWN (11) legitimately
// reduces a cooldown timer. Blindly treating every 107/108 hit as a cooldown reduction
// misclassified e.g. spellId 265187's Master Summoner modifier (MiscValue_0=10,
// SPELLMOD_CASTING_TIME — a 0.5s cast-time cut, not a CD cut) and spellId 1719's Reckless
// Abandon modifier (MiscValue_0=23, SPELLMOD_EFFECT3 — modifies Recklessness's rage-gain
// effect, not its CD) as ~500 *seconds* of cooldown reduction, driving cooldownSeconds
// negative (BACKLOG §29a). Gated below on `miscValue0 === SPELLMOD_COOLDOWN`.
const AURA_ADD_FLAT_MODIFIER = 107;
const AURA_ADD_PCT_MODIFIER = 108;
const SPELLMOD_COOLDOWN = 11; // TrinityCore SpellModOp code for "this SpellMod targets cooldown"
const AURA_MOD_CATEGORY_COOLDOWN = 453; // SPELL_AURA_CHARGE_RECOVERY_MOD — dedicated, MiscValue_0 is a ChargeCategory id (Path B below), not a SpellModOp code
const AURA_OVERRIDE_ACTION_SPELL = 332; // Replaces base spell with another

// Mapping of ClassID to SpellFamilyName (SpellClassSet)
const CLASS_ID_TO_FAMILY: Record<number, number> = {
  1: 4, // Warrior
  2: 10, // Paladin
  3: 9, // Hunter
  4: 8, // Rogue
  5: 6, // Priest
  6: 15, // Death Knight
  7: 11, // Shaman
  8: 3, // Mage
  9: 5, // Warlock
  10: 126, // Monk
  11: 7, // Druid
  12: 127, // Demon Hunter
  13: 128, // Evoker
};

function toInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface ICDModifier {
  talentSpellId: string;
  // `reduce_cd` is a flat-seconds subtraction; `reduce_cd_pct` is a percentage
  // multiplier (`value: 30` means -30%, applied as `base *= (1 - 30/100)`).
  // The two must never be conflated: DB2 aura 108 (SPELL_AURA_ADD_PCT_MODIFIER)
  // stores a plain percentage in EffectBasePointsF, not a flat second count —
  // review of 2d5993c caught this being subtracted as flat seconds, wrong by
  // roughly an order of magnitude on long CDs (fix-29a-review.md finding #1).
  effect: "extra_charge" | "reduce_cd" | "reduce_cd_pct" | "replace_spell";
  value: number;
  isConditional?: boolean;
}

export function extractTalentModifiers(
  spellEffectRows: Record<string, string>[],
  spellClassOptionsRows: Record<string, string>[],
  spellCategoriesRows: Record<string, string>[],
  spellNameRows: Record<string, string>[],
  trackedSpellIds: Set<string>,
): Record<string, ICDModifier[]> {
  const spellNames = new Map<string, string>();
  for (const row of spellNameRows) {
    spellNames.set(row.ID, row.Name_lang || "");
  }

  // 1. Index all player talent spell IDs and their class IDs
  const talentClassMap = new Map<string, number>();
  for (const tree of talentIdMap) {
    const classId = tree.classId as number;
    // heroNodes/subTreeNodes included 2026-08-18: they were missing, so every
    // HERO talent's cooldown/charge modifier was dropped before the effect
    // scan even looked at it — e.g. Warp (429483, Chronowarden) carries
    // `Aura=453 MiscValue_0=1948 BasePoints=-5000`, i.e. "Hover's cooldown is
    // also reduced by 5 sec" (murlok.io), and never reached the output. Build
    // 12.1.0.69273 has 695 hero/subTree talents carrying 44 CD/charge effect
    // rows between them. `collectCandidateIds` (lib/candidates.ts, source 6)
    // already walked all four node kinds — the two files disagreed, and this
    // one was the wrong side.
    const allNodes = [
      ...(tree.classNodes || []),
      ...(tree.specNodes || []),
      ...((tree as { heroNodes?: unknown[] }).heroNodes || []),
      ...((tree as { subTreeNodes?: unknown[] }).subTreeNodes || []),
    ];
    for (const node of allNodes) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const entry of (node as any).entries || []) {
        const spellId = String(entry.spellId || entry.visibleSpellId || "");
        if (spellId && spellId !== "0") {
          talentClassMap.set(spellId, classId);
        }
      }
    }
  }

  // 2. Index target spells by their class mask
  const targetSpellMasks = new Map<
    string,
    { family: number; masks: number[] }
  >();
  for (const row of spellClassOptionsRows) {
    const spellId = row.SpellID;
    if (!spellId || spellId === "0") continue;
    targetSpellMasks.set(spellId, {
      family: toInt(row.SpellClassSet),
      masks: [
        toInt(row.SpellClassMask_0),
        toInt(row.SpellClassMask_1),
        toInt(row.SpellClassMask_2),
        toInt(row.SpellClassMask_3),
      ],
    });
  }

  // 3. Index target spells by their ChargeCategory
  const chargeCategorySpells = new Map<number, string[]>();
  for (const row of spellCategoriesRows) {
    const spellId = row.SpellID;
    const chargeCategory = toInt(row.ChargeCategory);
    if (!spellId || chargeCategory === 0) continue;

    if (!chargeCategorySpells.has(chargeCategory)) {
      chargeCategorySpells.set(chargeCategory, []);
    }
    const categoryTargets = chargeCategorySpells.get(chargeCategory);
    if (categoryTargets) {
      categoryTargets.push(spellId);
    }
  }

  const results: Record<string, ICDModifier[]> = {};

  function addModifier(targetSpellId: string, mod: ICDModifier) {
    if (!results[targetSpellId]) {
      results[targetSpellId] = [];
    }
    // A talent can hit a target spell via more than one matched CSV row
    // (Path A classmask, Path B chargeCategory, Path C direct id, or two
    // different EffectIndex rows on the same talent). Two matched rows for
    // the same (talentSpellId, effect) pair are one of two things:
    //   (a) the SAME real DB2 SpellEffect row, rediscovered through a second
    //       match path — identified by identical `value`. Collapsing to one
    //       entry is correct; keeping both would double-count a single
    //       real-world modifier.
    //   (b) genuinely DISTINCT SpellEffect rows on the same talent spell that
    //       both target this spell with the same effect kind but different
    //       magnitudes — real WoW stacks these rather than picking one. Per
    //       TrinityCore `Player::GetSpellModValues`/`ApplySpellMod`
    //       (Player.cpp:22773-22860, `TrinityCore/TrinityCore@master`,
    //       verified 2026-08-15): every matching SPELLMOD_FLAT mod is summed
    //       (`*flat += value`) and every matching SPELLMOD_PCT mod is
    //       multiplied (`*pct *= 1 + value/100`) — `basevalue = (base +
    //       totalflat) * totalmul`. `cooldowns.ts`'s `applyCdTalentModifiers`
    //       already implements exactly this (sums every `reduce_cd` entry,
    //       multiplies every `reduce_cd_pct` entry it finds for a
    //       talentedSpellId) — it does not assume one entry per
    //       (talentSpellId, effect), so the fix here is purely "stop dropping
    //       distinct-value rows and let the existing consumer stack them",
    //       not a second place doing the arithmetic.
    // "First CSV row wins" (pre-2026-08-15) silently dropped case (b) rows —
    // order-dependent and not a principled choice (BACKLOG: review finding #3
    // of fix-29a-review.md). Fixed: (a) still collapses (order-independent,
    // since the values are identical by definition); (b) now emits both.
    const identical = results[targetSpellId].find(
      (m) =>
        m.talentSpellId === mod.talentSpellId &&
        m.effect === mod.effect &&
        m.value === mod.value,
    );
    if (identical) {
      // Same value re-matched via a second path — same real modifier.
      // `isConditional` is never set by the DB2 scan (only by
      // CUSTOM_TALENT_MODIFIERS), so this only fires if a future custom
      // entry collides with a scanned row that disagrees on conditionality —
      // a genuinely unexpected shape worth a loud warning, not a guess.
      if (!!identical.isConditional !== !!mod.isConditional) {
        console.warn(
          `[genTalentModifiers] same-value modifier re-matched with conflicting isConditional: ` +
            `target=${targetSpellId} talent=${mod.talentSpellId} effect=${mod.effect} value=${mod.value} ` +
            `kept.isConditional=${!!identical.isConditional} new.isConditional=${!!mod.isConditional}`,
        );
      }
      return;
    }
    // Distinct value for the same (talentSpellId, effect): a second real
    // SpellMod row on this talent. Keep it — applyCdTalentModifiers stacks it.
    results[targetSpellId].push(mod);
  }

  // 4. Scan SpellEffect for modifiers
  for (const row of spellEffectRows) {
    const talentSpellId = row.SpellID;
    const talentClassInfo = talentClassMap.get(talentSpellId);
    if (!talentClassInfo) continue;

    const classId = talentClassInfo;
    const familyId = CLASS_ID_TO_FAMILY[classId];
    if (familyId === undefined) continue;

    const effect = toInt(row.Effect);
    const aura = toInt(row.EffectAura);
    const miscValue0 = toInt(row.EffectMiscValue_0);

    let modifierType:
      "extra_charge" | "reduce_cd" | "reduce_cd_pct" | "replace_spell" | null =
      null;
    let value = toInt(row.EffectBasePointsF);

    if (
      effect === EFFECT_MOD_CHARGES ||
      (effect === EFFECT_APPLY_AURA && aura === AURA_MOD_MAX_CHARGES)
    ) {
      modifierType = "extra_charge";
      value = Math.abs(value);
    } else if (
      effect === EFFECT_APPLY_AURA &&
      aura === AURA_ADD_PCT_MODIFIER &&
      miscValue0 === SPELLMOD_COOLDOWN
    ) {
      // Percentage SpellMod (e.g. Unbreakable Spirit -30%, Righteous Protector
      // -50%). DB2 stores this as a plain percentage integer in
      // EffectBasePointsF (confirmed against real rows: 114154 → -30,
      // 204074 → -50, 391271 → -10 — no ms scaling, unlike the flat case
      // below) — applying the >500-implies-ms heuristic to it would be
      // wrong on its own terms even before considering unit; skip it.
      modifierType = "reduce_cd_pct";
      value = Math.abs(value);
    } else if (
      effect === EFFECT_MOD_COOLDOWN ||
      (effect === EFFECT_APPLY_AURA && aura === AURA_MOD_CATEGORY_COOLDOWN) ||
      (effect === EFFECT_APPLY_AURA &&
        aura === AURA_ADD_FLAT_MODIFIER &&
        miscValue0 === SPELLMOD_COOLDOWN)
    ) {
      modifierType = "reduce_cd";
      // Sign is MEANINGFUL and must survive (2026-08-18). DB2 stores a
      // cooldown REDUCTION as a negative EffectBasePointsF and an INCREASE as
      // a positive one — verified on this build: Celerity (115173) → -5000
      // (Roll −5s), Lighter Than Air (449582) → +2000 ("but the cooldown of
      // Roll is increased by 2 sec", murlok.io). The old `Math.abs` collapsed
      // both into "reduce by |v|", so every cooldown-INCREASING talent was
      // recorded as an equal-magnitude reduction — a 2× error in the wrong
      // direction (8 such rows in build 12.1.0.69273, magnitudes up to 60s).
      // Negating instead keeps `reduce_cd`'s "positive value = seconds
      // removed" contract intact for the common case AND lets an increase
      // ride through as a negative reduction, which `applyCdModifiers`'
      // `base - flatReduceSeconds` already handles correctly with no consumer
      // change. This is the other half of the BACKLOG §29a class of bug (that
      // fix gated on MiscValue_0 but left the sign stripped).
      value = -value;
      // DB2 stores some CD effects in ms and others in seconds with no unit
      // flag. Heuristic: no real talent moves a cooldown by >500s, so any
      // magnitude >500 is assumed to be milliseconds. Applied to the
      // magnitude so it holds for increases too.
      if (Math.abs(value) > 500) {
        value = Math.round(value / 1000);
      }
    } else if (
      effect === EFFECT_APPLY_AURA &&
      aura === AURA_OVERRIDE_ACTION_SPELL
    ) {
      modifierType = "replace_spell";
      // Replacement ID is in value
    }

    if (!modifierType) continue;

    const effectMasks = [
      toInt(row.EffectSpellClassMask_0),
      toInt(row.EffectSpellClassMask_1),
      toInt(row.EffectSpellClassMask_2),
      toInt(row.EffectSpellClassMask_3),
    ];

    const hasMask = effectMasks.some((m) => m !== 0);

    // Path A: Match via bitmask
    if (hasMask) {
      for (const [targetId, targetInfo] of targetSpellMasks.entries()) {
        if (targetInfo.family !== familyId) continue;

        const intersects =
          (effectMasks[0] & targetInfo.masks[0]) !== 0 ||
          (effectMasks[1] & targetInfo.masks[1]) !== 0 ||
          (effectMasks[2] & targetInfo.masks[2]) !== 0 ||
          (effectMasks[3] & targetInfo.masks[3]) !== 0;

        if (intersects) {
          addModifier(targetId, {
            talentSpellId,
            effect: modifierType,
            value,
          });
        }
      }
    }

    // Path B: Match via ChargeCategory (stored in MiscValue_0)
    const chargeTargets = chargeCategorySpells.get(miscValue0);
    if (miscValue0 > 0 && chargeTargets) {
      for (const targetId of chargeTargets) {
        addModifier(targetId, {
          talentSpellId,
          effect: modifierType,
          value,
        });
      }
    }

    // Path C: Direct Target Spell ID (stored in MiscValue_0)
    // Used for Effect 332 overrides (e.g. Ice Block -> Ice Cold)
    if (miscValue0 > 0 && !chargeCategorySpells.has(miscValue0)) {
      addModifier(String(miscValue0), {
        talentSpellId,
        effect: modifierType,
        value,
      });
    }
  }

  // 5. Merge Custom Modifiers
  for (const [targetId, mods] of Object.entries(CUSTOM_TALENT_MODIFIERS)) {
    mods.forEach((mod) => addModifier(targetId, mod));
  }

  // 6. Sanity filter: Only include modifiers for spells that are "important" enough to be tracked.
  const filteredResults: Record<string, ICDModifier[]> = {};
  for (const [targetId, mods] of Object.entries(results)) {
    if (trackedSpellIds.has(targetId)) {
      filteredResults[targetId] = mods;
    }
  }

  return filteredResults;
}

export async function main(): Promise<void> {
  const build = await resolveBuild();
  const cacheDir = process.env.DATAGEN_CACHE ?? undefined;

  const [
    spellEffectRaw,
    spellClassOptionsRaw,
    spellCategoriesRaw,
    spellNameRaw,
  ] = await Promise.all([
    fetchTable("SpellEffect", build, cacheDir),
    fetchTable("SpellClassOptions", build, cacheDir),
    fetchTable("SpellCategories", build, cacheDir),
    fetchTable("SpellName", build, cacheDir),
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

  const filteredResults = extractTalentModifiers(
    spellEffectRows,
    spellClassOptionsRows,
    spellCategoriesRows,
    spellNameRows,
    trackedSpellIds,
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

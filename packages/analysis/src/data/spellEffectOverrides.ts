/**
 * A hand-curated minimal spell-effect dataset (the compliant replacement for
 * spellEffects.json; see concession 3 of the 4a spec debate).
 * Source: publicly known Blizzard game facts (spell cooldowns and durations are
 * objective numbers, not upstream expression).
 * Coverage policy: major defensive / major offensive CDs plus interrupts — the
 * utils degrade gracefully (with fallbacks) for every missing entry, and the
 * gap rate is measured by the benchmark batch and disclosed in the realignment
 * report.
 * Once the sub-project 5 data pipeline is built, this file is replaced wholesale
 * by the generated artifact.
 */
import type { IMinedSpell } from "./spellEffectData";
import { SPELL_EFFECTS_GENERATED } from "./spellEffectGenerated";

const e = (
  spellId: string,
  name: string,
  cooldownSeconds?: number,
  durationSeconds?: number,
): IMinedSpell => ({ spellId, name, cooldownSeconds, durationSeconds });

// 2026-08-21 S2 corpus scan (10,682 matches): removed Netherwalk 196555, Fel Barrage 258925, Icy Veins 12472, Dark Soul: Instability 113858, Repentance 20066 (dispel-type row) — 0 occurrences, ability gone in 12.x (eval-private/reports/s2-health-2026-08-21)
export const SPELL_EFFECT_OVERRIDES: Record<string, IMinedSpell> =
  Object.fromEntries(
    [
      // ── Major defensive CDs ──
      e("642", "Divine Shield", 300, 8),
      e("498", "Divine Protection", 60, 8),
      e("216331", "Avenging Crusader", 60, 15),
      e("31821", "Aura Mastery", 180, 8),
      e("64843", "Divine Hymn", 180, 8),
      e("200183", "Apotheosis", 120, 20),
      e("45438", "Ice Block", 240, 10),
      e("31224", "Cloak of Shadows", 120, 5),
      e("5277", "Evasion", 120, 10),
      e("33206", "Pain Suppression", 180, 8),
      e("47788", "Guardian Spirit", 180, 10), // 2026-09-06: back to the DB2 base — the 12 s came from Foreseen Circumstances (+2 s, Priest hero tree), now applied per-caster by BUFF_DURATION_TALENT_MODIFIERS
      // GH #34 ③ (2026-08-29): official read — the cast spell 97462 has DurationIndex 0 in DB2,
      // the buff 97463 is SpellDuration 1 = 10000 ms; without this entry the kill-window
      // builder fell back to DEFAULT_BUFF_DURATION_S = 8 for every Rallying Cry (2 s short).
      e("97462", "Rallying Cry", 180, 10), // GH #34 ①: corpus lifetime 12.0 s (n=210, p10=p90); hand value 10 mis-paired the removal
      e("62618", "Power Word: Barrier", 180, 10),
      e("98008", "Spirit Link Totem", 180, 6),
      e("102342", "Ironbark", 90, 12),
      e("740", "Tranquility", 180, 8),
      e("22812", "Barkskin", 60, 8), // 2026-09-06: back to the DB2 base — the 12 s came from Improved Barkskin (+4 s, Druid class tree), now applied per-caster by BUFF_DURATION_TALENT_MODIFIERS
      e("61336", "Survival Instincts", 180, 6),
      e("871", "Shield Wall", 210, 8),
      e("118038", "Die by the Sword", 120, 8),
      e("184364", "Enraged Regeneration", 120, 8),
      e("48792", "Icebound Fortitude", 120, 8),
      e("55233", "Vampiric Blood", 90, 10),
      e("31850", "Ardent Defender", 120, 8),
      e("86659", "Guardian of Ancient Kings", 300, 8),
      e("6940", "Blessing of Sacrifice", 120, 12),
      e("1022", "Blessing of Protection", 300, 10),
      e("204018", "Blessing of Spellwarding", 180, 10),
      e("116849", "Life Cocoon", 120, 12),
      e("115203", "Fortifying Brew", 360, 15),
      e("122470", "Touch of Karma", 90, 10),
      e("198589", "Blur", 60, 10),
      e("104773", "Unending Resolve", 180, 8),
      e("108271", "Astral Shift", 90, 12),
      e("186265", "Aspect of the Turtle", 180, 8),
      e("109304", "Exhilaration", 120),
      e("363916", "Obsidian Scales", 90, 12),
      e("374348", "Renewing Blaze", 90, 8),
      e("357170", "Time Dilation", 60, 8), // GH #34 ① patched this to a flat 10.4 (corpus lifetime, n=703); 2026-09-06 found the cause — Timeless Magic +15 %/rank on a maxRanks=2 node — so the base returns to DB2 8 and BUFF_DURATION_TALENT_MODIFIERS reproduces 8 / 9.2 / 10.4 at 0 / 1 / 2 ranks instead of charging everyone the 2-rank price
      // ── Major offensive CDs (durationSeconds drives enemyCDs expiry tracking) ──
      // Added by the 2026-07-14 full audit: major burst CDs missing from the
      // generated layer (paired with new spellCategories classifications)
      // Added by the 2026-07-17 spec-level sweep: no generated entry exists;
      // CD/duration are measured from the corpus
      // (min inter-cast gap 60.0s / median buff applied→removed 20.0s)
      // 2026-08-11: Malevolence(442726)/Soul Rot(386997)/Coordinated
      // Assault(360952) dropped — the 12.1 talent tree pulled them into the
      // generated layer with byte-identical cd/dur (and Soul Rot gains
      // dispelType:Magic the override was masking). Shadow Dance(185313)
      // dropped the same day with corpus proof AGAINST the override (60/8):
      // 808-match 12.0 store, cast gaps n=1996 min 6.1s median 18.5s ≈ the
      // generated 20s charge cd; buff 185422 duration n=2261 median 6.5s ≈
      // the generated 6s. Overrides must encode measured truth — this one
      // encoded neither era. Fel Barrage stays below: 0 casts in 808 matches
      // (id appears only in loadouts), unfalsifiable either way — revisit on
      // the first 12.1 cast (BACKLOG #24-2), where DB2 now says dur 8 not 3.
      e("360194", "Deathmark", 120, 16),
      e("13750", "Adrenaline Rush", 180, 20),
      e("121471", "Shadow Blades", 90, 20),
      e("190319", "Combustion", 120, 10),
      e("365350", "Arcane Surge", 90, 15),
      e("1719", "Recklessness", 90, 16),
      e("107574", "Avatar", 90, 20),
      e("227847", "Bladestorm", 90, 6),
      e("47585", "Dispersion", 120, 6),
      e("10060", "Power Infusion", 120, 15), // GH #34 ①: corpus lifetime 15.0 s (n=604, p25=p90); hand value 20 called every PI "ended early"
      e("391109", "Dark Ascension", 60, 20),
      e("375087", "Dragonrage", 120, 18),
      e("51271", "Pillar of Frost", 60, 12),
      e("47568", "Empower Rune Weapon", 120, 20),
      e("275699", "Apocalypse", 90, 15),
      e("207289", "Unholy Assault", 90, 20),
      e("106951", "Berserk", 180, 20),
      e("102560", "Incarnation: Chosen of Elune", 180, 30),
      e("194223", "Celestial Alignment", 180, 20),
      e("323764", "Convoke the Spirits", 120, 4),
      e("288613", "Trueshot", 120, 15),
      e("19574", "Bestial Wrath", 90, 15),
      e("266779", "Coordinated Assault", 120, 20),
      e("137639", "Storm, Earth, and Fire", 90, 15),
      e("123904", "Invoke Xuen, the White Tiger", 120, 20),
      e("31884", "Avenging Wrath", 120, 20), // GH #34 ①: corpus lifetime 20–30 s (p25 24, p50 27, p75 30 — talent-extended); base kept, the pairing now accepts the longer removal
      e("231895", "Crusade", 120, 25),
      e("114050", "Ascendance", 180, 15),
      e("114051", "Ascendance", 180, 15),
      e("205180", "Summon Darkglare", 120, 20),
      e("265187", "Summon Demonic Tyrant", 90, 15),
      e("113860", "Dark Soul: Misery", 120, 20),
      e("191427", "Metamorphosis", 240, 24),
      e("370965", "The Hunt", 90, 6),
      e("359844", "Call of the Wild", 180, 20),
      // ── Interrupts (enemyInterrupts: cooldownSeconds ?? 15) ──
      e("1766", "Kick", 15),
      e("2139", "Counterspell", 24),
      e("6552", "Pummel", 15),
      e("47528", "Mind Freeze", 15),
      e("57994", "Wind Shear", 12),
      e("96231", "Rebuke", 15),
      e("106839", "Skull Bash", 15),
      e("116705", "Spear Hand Strike", 15),
      e("147362", "Counter Shot", 24),
      e("187707", "Muzzle", 15),
      e("183752", "Disrupt", 15),
      e("119910", "Spell Lock", 24),
      e("132409", "Spell Lock", 24),
      e("351338", "Quell", 40),
      e("15487", "Silence", 45),
      e("8122", "Psychic Scream", 30, 6),
      e("78675", "Solar Beam", 60),
    ].map((s) => [s.spellId, s]),
  );

// dispelType additions (public facts; consumed by dispelAnalysis)
/** @internal exported for data/curatedIdRegistry (corpus rot scan) */
export const DISPEL_TYPES: Record<string, string> = {
  "118": "Magic",
  "28271": "Magic",
  "28272": "Magic",
  "51514": "Curse",
  "3355": "Magic",
  "8122": "Magic",
  "5782": "Magic",
  "2637": "Magic",
  "339": "Magic",
  "122": "Magic",
  "217832": "Magic",
  "6789": "Magic",
  "702": "Curse",
  "1714": "Curse",
  "5484": "Magic",
  "605": "Magic",
  "82691": "Magic",
  "9484": "Magic",
  "10060": "Magic",
  "1022": "Magic",
  "6940": "Magic",
};
for (const [id, t] of Object.entries(DISPEL_TYPES)) {
  const cur = SPELL_EFFECT_OVERRIDES[id];
  if (cur) (cur as { dispelType?: string }).dispelType = t;
  else
    // 2026-07-25 fix: a stub entry would shadow the complete generated entry
    // wholesale in spellEffectData's {...GENERATED, ...OVERRIDES} merge — every
    // CC in this table (Frost Nova, Entangling Roots, Hex, …) had its
    // durationSeconds/cooldownSeconds/name silently blanked (caught by the aura
    // duration-cap test). The patch must be layered ON TOP of the generated entry.
    SPELL_EFFECT_OVERRIDES[id] = {
      ...(SPELL_EFFECTS_GENERATED as Record<string, IMinedSpell>)[id],
      spellId: id,
      name:
        (SPELL_EFFECTS_GENERATED as Record<string, IMinedSpell>)[id]?.name ??
        id,
      dispelType: t,
    } as IMinedSpell;
}

// ── Corpus-corrected durations (layered ON TOP of the generated entry, never a
// stub — same shadowing lesson as the DISPEL_TYPES loop above) ────────────────
// Ids whose official DB2 duration is contradicted by the observed aura lifetime.
// Every entry carries its measurement; `ccFullDurationSeconds` (spellEffectData.ts)
// reads the merged table, so this is the only place a corpus-vs-DB2 duration
// disagreement is allowed to live. Registered in curatedIdRegistry.
export const CORPUS_DURATION_PATCHES: Record<string, number> = {
  // Binding Shot stun: DB2 SpellDuration says 2 s, the 12.1 archive says 3 s —
  // S2 605-file sample, n=2290 lifetimes: 3.0 s ×1084 (full-duration cluster),
  // 1.5 s ×309 (the 50 % DR cluster), p90 3.1 s. GH #44 tail, 2026-09-02.
  "117526": 3,
};
for (const [id, durationSeconds] of Object.entries(CORPUS_DURATION_PATCHES)) {
  const cur = SPELL_EFFECT_OVERRIDES[id];
  if (cur)
    (cur as { durationSeconds?: number }).durationSeconds = durationSeconds;
  else
    SPELL_EFFECT_OVERRIDES[id] = {
      ...(SPELL_EFFECTS_GENERATED as Record<string, IMinedSpell>)[id],
      spellId: id,
      name:
        (SPELL_EFFECTS_GENERATED as Record<string, IMinedSpell>)[id]?.name ??
        id,
      durationSeconds,
    } as IMinedSpell;
}

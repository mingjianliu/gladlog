/**
 * Racial abilities (2026-08-12). The combat log carries NO race field —
 * `COMBATANT_INFO` has class, spec, talents and equipment, but nothing that
 * says "human" — so racial ownership can only ever be established **passively**:
 * a cast observed in the log proves the player has it, and the absence of a
 * cast proves nothing at all. Every consumer of this table must therefore be
 * evidence-driven (credit what was cast); nothing here may be used to assert
 * that a player *lacks* an ability, the way the talent trees allow
 * (`talentOwnershipOf`'s "no").
 *
 * How the list was validated (whitelist-rot rule — never hand-curated from
 * memory): a corpus sweep over 150 local matches collected every cast id that
 * is absent from `classMetadata` yet cast by ≥4 distinct classes — the
 * empirical signature of a race-granted button — and each surviving id was
 * named from the raw log text. That sweep confirmed the ids below and also
 * surfaced Spatial Rift's second id (257040, the follow-up teleport), which a
 * hand-written list would have missed. Ids the sweep attributed to items or
 * consumables (Gladiator's Medallion/Badge, Healthstone, …) are deliberately
 * absent. Racials for races nobody in the corpus played are still listed: with
 * a purely passive predicate an unused entry can never fire a false positive,
 * and it makes the table complete when such a player does show up.
 *
 * 2026-09-04 completeness pass (BACKLOG #41 (9)) against SimulationCraft's
 * official race-granted roster (`engine/dbc/generated/racial_spells.inc`, 166
 * spells at 12.1.0.69587, race decoded from its race mask): 59 of them occur
 * in the observed corpus, 20 were missing here. The 12 with a combat effect
 * were added below with their kind read off the official effect facts
 * (abilityEffectsGenerated: dealsDamage → offensive, heals → utility,
 * movement → mobility). The 8 left out on purpose have NO combat effect and
 * would only add noise to the passive predicate: Make Camp 312370, Visage
 * 351239 / Chosen Identity 360022 / Battle Visage 1289789 (Dracthyr form
 * toggles), Calm the Wolf 406087 / Two Forms 68996 / Running Wild 87840
 * (Worgen form / mount). The two ids here that SimC does not list — Tail Swipe
 * 368970 and Spatial Rift's follow-up 257040 — are secondary ids of listed
 * racials, kept.
 */

export type RacialKind =
  /** Removes loss-of-control / impairing effects — the PvP-trinket equivalent. */
  | "break"
  /** Offensive/throughput cooldown (burst windows). */
  | "offensive"
  /** Applies crowd control to the enemy (enters DR). */
  | "cc"
  /** Movement or escape. */
  | "mobility"
  /** Healing, mana, or other utility. */
  | "utility";

export interface RacialAbility {
  /** English name, the render form used everywhere in prompts. */
  name: string;
  kind: RacialKind;
  race: string;
}

export const RACIAL_ABILITIES: Record<string, RacialAbility> = {
  // --- break (trinket-equivalent) ---
  "59752": { name: "Will to Survive", kind: "break", race: "Human" },
  "7744": { name: "Will of the Forsaken", kind: "break", race: "Undead" },
  "20589": { name: "Escape Artist", kind: "break", race: "Gnome" },
  "265221": { name: "Fireblood", kind: "break", race: "Dark Iron Dwarf" },
  "20594": { name: "Stoneform", kind: "break", race: "Dwarf" },
  // --- offensive ---
  "20572": { name: "Blood Fury", kind: "offensive", race: "Orc" },
  "33697": { name: "Blood Fury", kind: "offensive", race: "Orc" },
  "33702": { name: "Blood Fury", kind: "offensive", race: "Orc" },
  "26297": { name: "Berserking", kind: "offensive", race: "Troll" },
  "274738": { name: "Ancestral Call", kind: "offensive", race: "Mag'har Orc" },
  "255647": {
    name: "Light's Judgment",
    kind: "offensive",
    race: "Lightforged Draenei",
  },
  "260364": { name: "Arcane Pulse", kind: "offensive", race: "Nightborne" },
  "312411": { name: "Bag of Tricks", kind: "offensive", race: "Vulpera" },
  // 2026-09-04 SimC roster pass (see header)
  "69041": { name: "Rocket Barrage", kind: "offensive", race: "Goblin" },
  "436344": { name: "Azerite Surge", kind: "offensive", race: "Earthen" },
  "1237885": { name: "Thorn Bloom", kind: "offensive", race: "Haranir" },
  // --- cc ---
  // DR membership is NOT assumed here: the official DB2 SpellCategories
  // DiminishType was probed for every id below (build 12.1.0.69273) and only
  // War Stomp (Stun), Quaking Palm (Incapacitate) and Haymaker (Stun) carry
  // one. Bull Rush, Wing Buffet and Tail Swipe have NO DiminishType, so they
  // must not be hand-added to the DR map — drAnalysis stays the single source
  // and takes its categories from that same official table.
  "20549": { name: "War Stomp", kind: "cc", race: "Tauren" },
  "107079": { name: "Quaking Palm", kind: "cc", race: "Pandaren" },
  "255654": { name: "Bull Rush", kind: "cc", race: "Highmountain Tauren" },
  "287712": { name: "Haymaker", kind: "cc", race: "Kul Tiran" },
  "368970": { name: "Tail Swipe", kind: "cc", race: "Dracthyr" },
  "357214": { name: "Wing Buffet", kind: "cc", race: "Dracthyr" },
  // --- mobility ---
  "58984": { name: "Shadowmeld", kind: "mobility", race: "Night Elf" },
  "68992": { name: "Darkflight", kind: "mobility", race: "Worgen" },
  "69070": { name: "Rocket Jump", kind: "mobility", race: "Goblin" },
  "256948": { name: "Spatial Rift", kind: "mobility", race: "Void Elf" },
  "257040": { name: "Spatial Rift", kind: "mobility", race: "Void Elf" },
  // 2026-09-04 SimC roster pass (see header)
  "358733": { name: "Glide", kind: "mobility", race: "Dracthyr" },
  "369536": { name: "Soar", kind: "mobility", race: "Dracthyr" },
  "1238686": { name: "Rootwalking", kind: "mobility", race: "Haranir" },
  "281954": {
    name: "Pterrordax Swoop",
    kind: "mobility",
    race: "Zandalari Troll",
  },
  // --- utility ---
  "28730": { name: "Arcane Torrent", kind: "utility", race: "Blood Elf" },
  "25046": { name: "Arcane Torrent", kind: "utility", race: "Blood Elf" },
  "50613": { name: "Arcane Torrent", kind: "utility", race: "Blood Elf" },
  "69179": { name: "Arcane Torrent", kind: "utility", race: "Blood Elf" },
  "80483": { name: "Arcane Torrent", kind: "utility", race: "Blood Elf" },
  "129597": { name: "Arcane Torrent", kind: "utility", race: "Blood Elf" },
  "155145": { name: "Arcane Torrent", kind: "utility", race: "Blood Elf" },
  "202719": { name: "Arcane Torrent", kind: "utility", race: "Blood Elf" },
  "232633": { name: "Arcane Torrent", kind: "utility", race: "Blood Elf" },
  "59542": { name: "Gift of the Naaru", kind: "utility", race: "Draenei" },
  "59543": { name: "Gift of the Naaru", kind: "utility", race: "Draenei" },
  "59544": { name: "Gift of the Naaru", kind: "utility", race: "Draenei" },
  "59545": { name: "Gift of the Naaru", kind: "utility", race: "Draenei" },
  "59547": { name: "Gift of the Naaru", kind: "utility", race: "Draenei" },
  "59548": { name: "Gift of the Naaru", kind: "utility", race: "Draenei" },
  "121093": { name: "Gift of the Naaru", kind: "utility", race: "Draenei" },
  "291944": { name: "Regeneratin'", kind: "utility", race: "Zandalari Troll" },
  // 2026-09-04 SimC roster pass (see header)
  "20577": { name: "Cannibalize", kind: "utility", race: "Undead" },
  "28880": { name: "Gift of the Naaru", kind: "utility", race: "Draenei" },
  "370626": { name: "Gift of the Naaru", kind: "utility", race: "Draenei" },
  "416250": { name: "Gift of the Naaru", kind: "utility", race: "Draenei" },
  "312924": {
    name: "Hyper Organic Light Originator",
    kind: "utility",
    race: "Mechagnome",
  },
  "461063": {
    name: "Quiet Contemplation",
    kind: "utility",
    race: "Earthen",
  },
};

const idsOfKind = (kind: RacialKind): Set<string> =>
  new Set(
    Object.entries(RACIAL_ABILITIES)
      .filter(([, v]) => v.kind === kind)
      .map(([id]) => id),
  );

/**
 * Single source for "this cast removed loss of control the way a PvP trinket
 * would". Consumed by ccTrinketAnalysis (crediting a CC as broken) — do not
 * re-derive a second list anywhere else.
 */
export const BREAK_RACIAL_SPELL_IDS: ReadonlySet<string> = idsOfKind("break");

/** Offensive racial cooldowns, for the burst/major-cooldown ledger. */
export const OFFENSIVE_RACIAL_SPELL_IDS: ReadonlySet<string> =
  idsOfKind("offensive");

/**
 * The offensive racials whose press puts a damage buff on the caster — a
 * WINDOW (DB2 duration 12–15 s), the shape every `OFFENSIVE_CD_SPELL_IDS`
 * consumer renders. User ruling 2026-10-20 (fact1215 retest idx 50,
 * 「我觉得都算」): they are offensive cooldowns like any class cooldown — the
 * ledger printed an owner's Blood Fury as a `[YOU] [CD]` while the kill
 * window's "team offensive CDs ready / back inside / pressed inside" and the
 * `[friendly offensive CD active]` tag left it out. Ancestral Call 274738
 * runs as one of four auras (raw 8/20 03:27:14.6249: 274742 Might of the
 * Blackrock APPLIED with the cast, REMOVED 15.0 s later), listed beside it so
 * the aura-side readers see it. NOT the nukes (Light's Judgment, Arcane
 * Pulse, Rocket Barrage, Bag of Tricks, Thorn Bloom: no duration; Azerite
 * Surge: 2.5 s) — the same reason Meteor is not in the table (spellDanger.ts):
 * a nuke that has landed is no window. Registered in curatedIdRegistry.
 */
export const OFFENSIVE_RACIAL_WINDOW_IDS: ReadonlySet<string> = new Set([
  "20572", // Blood Fury — 15 s
  "33697", // Blood Fury — 15 s
  "33702", // Blood Fury — 15 s
  "26297", // Berserking — 12 s
  "274738", // Ancestral Call — 15 s, runs as one of:
  "274739", // Rictus of the Laughing Skull
  "274740", // Zeal of the Burning Blade
  "274741", // Ferocity of the Frostwolf
  "274742", // Might of the Blackrock
]);

/**
 * Racials that share a cooldown lockout with the PvP trinket — official DB2
 * `SpellCategories.Category` 1166 ("PvP Trinket/WOTF", build 12.1.0.69273).
 * Escape Artist is deliberately absent: its Category is 0, i.e. the official
 * data says it shares nothing (it clears movement impairment, not loss of
 * control).
 */
export const SHARED_CD_RACIAL_SPELL_IDS: ReadonlySet<string> = new Set([
  "7744", // Will of the Forsaken
  "20594", // Stoneform
  "59752", // Will to Survive
  "265221", // Fireblood
]);

/**
 * How long pressing Will of the Forsaken / Stoneform / Fireblood locks the
 * PvP trinket, and how long a trinket press locks them: DB2
 * `SpellCooldowns.CategoryRecoveryTime` 30000 on all three (category 1166),
 * the tooltip's "shares a 30 sec cooldown with other similar effects". Corpus
 * (fact6 F20, 2026-10-28; 15 + 605 + wide = 1,348 files): Will of the
 * Forsaken → Medallion successes min 30.1 s (healer, n = 736) / 32.0 s (DPS,
 * n = 54); Medallion → Will of the Forsaken min 30.0 s (n = 377). Stoneform
 * and Fireblood are logged only as buffs and were not paired; they keep the
 * DB2 value.
 */
export const TRINKET_RACIAL_SHARED_LOCKOUT_MS = 30_000;

/**
 * The racial ↔ PvP-trinket lock per racial, before the healer cap below —
 * DB2 `SpellCooldowns.CategoryRecoveryTime` of each category-1166 racial
 * (build 12.1.5.70575): Will to Survive 90000, the others 30000. The tooltip
 * says the same ("shares a 90 sec cooldown" / "30 sec"). Registered in
 * curatedIdRegistry; its keys are `SHARED_CD_RACIAL_SPELL_IDS`.
 */
export const RACIAL_TRINKET_LOCK_MS: Readonly<Record<string, number>> = {
  "7744": TRINKET_RACIAL_SHARED_LOCKOUT_MS, // Will of the Forsaken
  "20594": TRINKET_RACIAL_SHARED_LOCKOUT_MS, // Stoneform
  "59752": 90_000, // Will to Survive
  "265221": TRINKET_RACIAL_SHARED_LOCKOUT_MS, // Fireblood
};

/**
 * A healer's lock is capped at 60 s — DB2 1228476 "PvP - Racial + PvP
 * Trinket Shared Trigger (Healers)", category 1182, CategoryRecoveryTime
 * 60000 (the DPS + tank twin 72757 is 30000). Only Will to Survive is longer
 * than the cap.
 *
 * Game-Behaviour Rule evidence (fact6 F20 D2 / D27 / B9, 2026-10-28; 1,348
 * files, pairs with no trinket use between racial and press, refusals =
 * "item not ready yet" in any locale, role from COMBATANT_INFO):
 *  - Will to Survive → Medallion, DPS/tank: successes n = 122, min 90.2 s;
 *    refusals max 89.8 s (4caab013: refused 66.5 s after it, "El objeto aún
 *    no está listo", while the flat 60 s said "6s left" and then "ready");
 *  - Will to Survive → Medallion, healer: successes n = 59, min 60.3 s;
 *    refusals max 33.9 s;
 *  - Medallion → Will to Survive: DPS min 90.0 s (n = 116, a refusal at
 *    87.4 s), healer min 60.0 s (n = 79).
 * The old flat 60 s (2026-09-25, successes p1 60.1 s n = 482) pooled both
 * roles: the healers set the floor, and its "3 unexplained rejections at
 * 62.1 / 70.4 / 71.0 s" were DPS humans inside the 90 s. The lock is a floor
 * from the press, not added to the trinket's own cooldown:
 * `max(own cooldown end, press + lock)` has 0 contradictions on 188 Will to
 * Survive pairs (25 with the trinket's own cooldown still running), the
 * additive reading 10. Re-measure with
 * packages/eval/scripts/racialTrinketLockScan.ts (update-wow-data.md §7b).
 */
export const HEALER_RACIAL_TRINKET_LOCK_CAP_MS = 60_000;

/** How long pressing this racial locks the PvP trinket — and how long a
 * PvP trinket press locks this racial: the lock is one number both ways
 * (ruling A′15 "and vice versa"; codex 62-POSTHOC-13d #1, 2026-10-23), by
 * role (`isHealer` = `isHealerSpec` of the presser, the same role the
 * trinket's own cooldown reads). */
export function racialTrinketLockoutMs(
  spellId: string,
  isHealer: boolean,
): number {
  const lock = RACIAL_TRINKET_LOCK_MS[spellId] ?? TRINKET_RACIAL_SHARED_LOCKOUT_MS;
  return isHealer ? Math.min(lock, HEALER_RACIAL_TRINKET_LOCK_CAP_MS) : lock;
}

/** English name of a racial spell id, or null when the id is not a racial. */
export function racialName(spellId: string): string | null {
  return RACIAL_ABILITIES[spellId]?.name ?? null;
}

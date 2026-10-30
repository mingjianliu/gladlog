/**
 * Spells whose activation can produce ZERO SPELL_CAST_SUCCESS evidence for a
 * *particular* application — the only on-log evidence for that occurrence is
 * a self-applied buff aura, sometimes under the spell's own id and sometimes
 * under a *different* id (classSpells.ts/spellEffectData/the cooldown
 * ledger's spellId key). Same "光环 id 腐烂" shape as the rest of this
 * codebase's aura/cast id splits, just with the cast side entirely absent
 * for that instance instead of merely under a variant id — the existing
 * English-name fallback below (`getEnglishSpellName(e.spellId, "") ===
 * spell.name`) can't help here because it only scans `spellCastEvents`,
 * which has no row at all for the cast-less occurrence.
 *
 * Two distinct sub-shapes populate this table (batch1 = row 1 only,
 * task-A/2026-08-14 batch2 added rows 2-3):
 * 1. **Structurally cast-less** (Renewing Blaze): the ability is ALWAYS a
 *    reactive proc, never a button press, so 0/N matches ever show a cast
 *    for it — the aura is the only evidence that will ever exist.
 * 2. **Conditionally cast-less** (Avenging Wrath, Ascendance): the ability
 *    is normally a button press (most occurrences DO log a normal
 *    SPELL_CAST_SUCCESS, handled by the ordinary castRawCasts path above)
 *    but a specific talent can ALSO grant it as a free proc off a different
 *    spell's cast, and that proc-grant path applies the buff aura without
 *    going through the cast pipeline at all. `auraOnlyActivationSeconds` is
 *    fallback-only (see its own doc comment): it is consulted ONLY when the
 *    unit has zero real casts of `spellId` in the round, so a unit that DID
 *    press the button normally never has its ledger polluted by a stray
 *    resync-artifact aura for the same id (see that function's doc comment
 *    for the corpus-measured exposure this closed off).
 *
 * - "374348" Renewing Blaze (Evoker) → aura id "374349": a reactive defensive
 *   proc ("gain Renewing Blaze" when triggered, not a button press), so it
 *   has no cast line by design. Confirmed by a full-corpus scan (see
 *   cd-ledger-rot report, 2026-08-14): 0/N matches with a
 *   SPELL_CAST_SUCCESS for 374348 or 374349, vs. many matches where the buff
 *   aura (374349) is applied — e.g. match 76ea5f90, Girlbye-Tichondrius-US,
 *   03:08:19.314. The task-7 brief's original repro cited the flow line
 *   "活化烈焰" (spellId 361469) as the contradicting evidence; that id is
 *   actually Living Flame (spellNames.json/spellNamesZhGenerated.json both
 *   independently agree: 361469/361500/361509 → "Living Flame"/"活化烈焰",
 *   374348/374349 → "Renewing Blaze"/"新生光焰") — a coincidental Chinese-name
 *   mix-up (both contain 烈焰/"blaze"), not the real evidence. The real,
 *   reproducible contradiction in that same match is Renewing Blaze's own
 *   aura (374349) firing at 03:08:19 while the cd ledger says neverUsed.
 *
 * - "31884" Avenging Wrath (Paladin) → aura ids "31884" (base, same id) and
 *   "454351": Herald of the Sun hero-talent build — a Judgment cast has a
 *   chance to proc-grant Avenging Wrath (and a short bundle of related
 *   buffs: "愤怒之锤"/1241410 Hammer of Wrath enable, "安瑟的祝福"/445206
 *   Blessing of Anshe, "诞于日光"/1264050 Born of the Dawn, sometimes
 *   "苍穹之遗"/387178) with zero SPELL_CAST_SUCCESS for Avenging Wrath.
 *   Task-A cd-ledger-rot residual scan (2026-08-14): 7/8 hits show this
 *   exact bundle applying 0.7-9s after a Judgment cast/aura in the SAME
 *   round, no other cast anywhere nearby — e.g. match 8e45b000,
 *   Fantasyext-Illidan-US, aura burst @11.0s and again @20.5s, each right
 *   after a Judgment cast (@7.8s/@20.4s); match c95bd9cc#3,
 *   Retriboosin-Tichondrius-US, @26.3s after Judgment@20.7s; match
 *   6cdbb8a8#4, Belfy-WyrmrestAccord-US, @23.0s after Judgment@20.1s; match
 *   5321ca9b#0, Fantasyext-Illidan-US, @15.5s after Judgment@10.7s; match
 *   2fde172d#0, Picorii-Frostmourne-US, @25.9s after Judgment@18.1s; match
 *   4e71f364#5, Retx-Tichondrius-US, @18.9s; match 237d95ef#1,
 *   Eliory-Tichondrius-US, @28.3s after Judgment@26.9s. The 8th hit (match
 *   72bcb552#0, Lightsmith-Drak'thul-US, @129.7s) shows the same
 *   aura-with-zero-cast shape but embedded in a larger multi-buff batch with
 *   no isolated Judgment adjacency — included on the same aura-evidence
 *   basis even though its exact trigger wasn't pinned down. Contrast: the
 *   OTHER 110/121 batch2 residual hits (Stampeding Roar, Cloak of Shadows,
 *   Incarnation, Trueshot, Shadow Blades, Power Infusion, Ironbark, Evasion,
 *   Aura Mastery, Survival Instincts, Icebound Fortitude, Ice Barrier,
 *   Arcane Surge, Adrenaline Rush) were investigated and are NOT this same
 *   proc shape — see cd-ledger-rot-batch2.md for the full per-spell
 *   evidence; they are a combat-log state-resync artifact (a batch of
 *   already-active, unrelated buffs — Dampening/110310, potions, trinkets,
 *   marks, world blessings — reapplying at the exact same millisecond,
 *   confirming the log is re-syncing existing state rather than logging a
 *   fresh activation) and were deliberately left OUT of this table.
 *
 * - "114052" Ascendance (Shaman, shared id across all 3 specs' talent trees)
 *   → aura id "114052" (same id): a Restoration-tree talent in the same
 *   family as the above — a Riptide cast has a chance to proc-grant a brief
 *   Ascendance (bundled with "潮汐奔涌"/53390, "暗流"/383235,
 *   "先祖活力"/207400), zero SPELL_CAST_SUCCESS for Ascendance. Task-A scan:
 *   all 3/3 hits land on the SAME tick as a Riptide cast/aura, and one match
 *   shows it recurring 5 times in a single round (match 4159c044#4,
 *   Worstrshamn-Stormrage-US, @52.8s/66.4s/93.2s/114.8s — each paired with a
 *   Riptide cast/aura at the same tick); also match 296154b1#1,
 *   Bumbings-Tichondrius-US, @23.8s (Riptide@23.8s); match 296154b1#3, same
 *   player, @1.7s (Riptide@1.6s).
 */
export const AURA_ONLY_ACTIVATION_IDS: Record<string, string[]> = {
  "374348": ["374349"], // Renewing Blaze (Evoker)
  "31884": ["31884", "454351"], // Avenging Wrath (Paladin) — Herald of the Sun Judgment proc
  "114052": ["114052"], // Ascendance (Shaman) — Deeply Rooted Elements-style Riptide proc
  // Doom Winds (Enhancement, 60 s): the press itself is not logged — the log
  // shows the buff 466772 going up, then the storm's 1 s pulses as
  // SPELL_CAST_SUCCESS 469270 for 10 s (2,167 pulses vs 27 logged presses in
  // 605 archive files). The pulses used to stand in for the press (merged to
  // one "cast" every 2+ s, the last one ~6 s after the real press); since GH
  // #106 step 2 they are not presses at all, so the buff is the evidence.
  "384352": ["466772"],
  // Feign Death (Hunter, 30 s): the press is never logged as a success (0 in
  // the library; 7,240 SPELL_CAST_FAILED in the every-6 archive) — Survival
  // Tactics 202748 (PvP talent 202746), self-applied at the feign, is the
  // evidence: 20,704 activations in the every-6 archive, 20,166 with the aura
  // (A9-EVIDENCE §3). Hunters without Survival Tactics stay invisible here.
  "5384": ["202748"],
  // Blessing of Sacrifice (Paladin, 120 s): a caster whose presses log no
  // SPELL_CAST_SUCCESS at all — the press shows as its pair of 6940 auras,
  // one on the paladin (self → self) and one on the ally, removed together
  // 12 s later (corpusFactScan hiddenPressUnused, 103-2 0:58: two such
  // presses in one round, the kit read `[UNUSED]`; castless in 9 of 957
  // presses on the 605-file capture). The self copy only a press puts up.
  "6940": ["6940"],
};

/**
 * Entries of `AURA_ONLY_ACTIVATION_IDS` whose buff IS the press, every time —
 * not a fallback for a missing cast line. For these the buff applications are
 * read even when the round also logged a real cast (the ledger's 2 s merge
 * folds the pair into one press). Doom Winds: 27 logged presses vs ~270 storms
 * in 605 files, so one logged press per round used to hide every other storm
 * and leave the ledger saying "ready" (agy review of GH #106 step 2). The
 * other entries keep the fallback-only rule: their auras also come from procs
 * (Herald of the Sun's Avenging Wrath, a Riptide Ascendance) that must not
 * restart a pressed cooldown.
 */
export const AURA_IS_THE_PRESS_IDS: ReadonlySet<string> = new Set(["384352"]);

/**
 * `AURA_ONLY_ACTIVATION_IDS` keys whose aura can only come from pressing the
 * button, so an activation also proves the player HAS it (the ledger's
 * ownership filter, triage H15 / ruling 2026-09-30 A9-3). Feign Death's
 * Survival Tactics 202748 goes up only at a feign; Doom Winds' buff IS the
 * press. Not the proc-capable keys (Avenging Wrath's Herald procs, Riptide
 * Ascendance, Renewing Blaze). Registered in curatedIdRegistry.
 */
export const AURA_ACTIVATION_PROVES_BUTTON_IDS: ReadonlySet<string> = new Set([
  "5384", // Feign Death ← Survival Tactics 202748
  ...AURA_IS_THE_PRESS_IDS,
]);

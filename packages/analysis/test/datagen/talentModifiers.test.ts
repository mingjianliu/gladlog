import { extractTalentModifiers } from "../../scripts/datagen/genTalentModifiers";
import {
  applyCdTalentModifiers,
  applyCdModifiers,
} from "../../src/utils/cooldowns";
import { spellEffectData } from "../../src/data/spellEffectData";
import { CD_TALENT_MODIFIERS } from "../../src/utils/talentModifiers";

// Mirrors cooldowns.ts's own base-cooldown derivation
// (`effectData.cooldownSeconds ?? effectData.charges?.chargeCooldownSeconds ?? 0`,
// repeated at cooldowns.ts:899-902/955-958/982-985/1010-1013) and its
// MIN_CD_SECONDS=30 majorSpells-inclusion gate (cooldowns.ts:263,903) — a
// spell whose *base* cd is below that gate never reaches the talent-modifier
// step in production, so it must not be counted as a false invariant failure
// here either. This is a trivial 3-line lookup (not the modifier-application
// arithmetic itself — see `applyCdTalentModifiers` below, which the rest of
// this file calls rather than reimplementing), so it stays local to the test.
const MIN_CD_SECONDS = 30;
function effectiveBaseCooldown(spellId: string): number | undefined {
  const eff = spellEffectData[spellId];
  if (!eff) return undefined;
  return eff.cooldownSeconds ?? eff.charges?.chargeCooldownSeconds ?? 0;
}
function effectiveBaseCharges(spellId: string): number {
  return spellEffectData[spellId]?.charges?.charges ?? 1;
}

// BACKLOG §29a: extractMajorCooldowns() produced negative cooldownSeconds for
// spellId 265187 (Summon Demonic Tyrant, base CD 60s) and 1719 (Recklessness,
// base CD 90s) on ~0.3% of sampled team-offensive-CD casts (5/1681, Task 5
// calibration, p1p2-calibration.md).
//
// Root cause: DB2 aura 107 (SPELL_AURA_ADD_FLAT_MODIFIER) and 108
// (SPELL_AURA_ADD_PCT_MODIFIER) are *generic* "apply a SpellMod" auras — which
// spell property they touch (cooldown, cast time, one numbered effect's raw
// value, buff duration, ...) is selected by EffectMiscValue_0 acting as a
// SpellModOp code. Only SPELLMOD_COOLDOWN (11) legitimately reduces a cooldown
// timer. The generator classified *every* 107/108 hit as `reduce_cd`
// regardless of MiscValue_0, so:
//   - Master Summoner (1240189, real DB2 row, build 12.1.0.69273): aura 107,
//     EffectBasePointsF=-500, MiscValue_0=10 (SPELLMOD_CASTING_TIME) — this is
//     "reduces Summon Demonic Tyrant's cast time by 0.5s" (confirmed via
//     wowhead tooltip), not a 500-second cooldown cut. Misclassified as
//     reduce_cd -500 → 500 after Math.abs, driving 60 - 500 = -440.
//   - Reckless Abandon (396749, real DB2 row): aura 107,
//     EffectBasePointsF=500, MiscValue_0=23 (SPELLMOD_EFFECT3) — modifies
//     Recklessness's rage-generation effect value, not its cooldown.
//     Misclassified as reduce_cd 500 → 90 - 500 = -410.
// Fix: gate aura 107/108 classification on `MiscValue_0 === SPELLMOD_COOLDOWN`
// (genTalentModifiers.ts). effect 148 (EFFECT_MOD_COOLDOWN, non-aura) and aura
// 453 (SPELL_AURA_CHARGE_RECOVERY_MOD, dedicated) are untouched — they are not
// the generic ADD_x_MODIFIER indirection and do not carry this ambiguity.
describe("extractTalentModifiers — generic SpellMod aura (107/108) must gate on SPELLMOD_COOLDOWN (BACKLOG §29a)", () => {
  const spellNameRows = [
    { ID: "1240189", Name_lang: "Master Summoner" },
    { ID: "396749", Name_lang: "Reckless Abandon" },
    { ID: "265187", Name_lang: "Summon Demonic Tyrant" },
    { ID: "1719", Name_lang: "Recklessness" },
  ];

  it("Master Summoner (aura 107, MiscValue_0=10 CASTING_TIME) does NOT register as reduce_cd on Summon Demonic Tyrant", () => {
    // Real row (SpellEffect ID 1238364, build 12.1.0.69273).
    const spellEffectRows = [
      {
        SpellID: "1240189",
        Effect: "6", // EFFECT_APPLY_AURA
        EffectAura: "107", // SPELL_AURA_ADD_FLAT_MODIFIER
        EffectBasePointsF: "-500",
        EffectMiscValue_0: "10", // SPELLMOD_CASTING_TIME, not SPELLMOD_COOLDOWN (11)
        EffectSpellClassMask_0: "0",
        EffectSpellClassMask_1: "1073741824",
        EffectSpellClassMask_2: "0",
        EffectSpellClassMask_3: "131072",
      },
    ];
    // Summon Demonic Tyrant shares the classmask bits Master Summoner targets
    // (that's how one talent's cast-time cut legitimately reaches both Summon
    // Felguard and Summon Demonic Tyrant in-game).
    const spellClassOptionsRows = [
      {
        SpellID: "265187",
        SpellClassSet: "5", // Warlock family
        SpellClassMask_0: "0",
        SpellClassMask_1: "1073741824",
        SpellClassMask_2: "0",
        SpellClassMask_3: "131072",
      },
    ];

    const result = extractTalentModifiers(
      spellEffectRows,
      spellClassOptionsRows,
      [],
      spellNameRows,
      new Set(["265187"]),
    );

    expect(result["265187"] ?? []).toEqual([]);
  });

  it("Reckless Abandon (aura 107, MiscValue_0=23 EFFECT3) does NOT register as reduce_cd on Recklessness", () => {
    // Real row (SpellEffect ID 1038325, build 12.1.0.69273).
    const spellEffectRows = [
      {
        SpellID: "396749",
        Effect: "6",
        EffectAura: "107",
        EffectBasePointsF: "500",
        EffectMiscValue_0: "23", // SPELLMOD_EFFECT3, not SPELLMOD_COOLDOWN (11)
        EffectSpellClassMask_0: "0",
        EffectSpellClassMask_1: "16",
        EffectSpellClassMask_2: "0",
        EffectSpellClassMask_3: "0",
      },
    ];
    const spellClassOptionsRows = [
      {
        SpellID: "1719",
        SpellClassSet: "4", // Warrior family
        SpellClassMask_0: "0",
        SpellClassMask_1: "16",
        SpellClassMask_2: "0",
        SpellClassMask_3: "0",
      },
    ];

    const result = extractTalentModifiers(
      spellEffectRows,
      spellClassOptionsRows,
      [],
      spellNameRows,
      new Set(["1719"]),
    );

    expect(result["1719"] ?? []).toEqual([]);
  });

  it("a genuine SPELLMOD_COOLDOWN (11) hit on the same generic aura still registers as reduce_cd (fix is a gate, not a removal)", () => {
    const spellEffectRows = [
      {
        SpellID: "1240189",
        Effect: "6",
        EffectAura: "107",
        EffectBasePointsF: "-5000", // ms; converts to -5s after the >500 heuristic
        EffectMiscValue_0: "11", // SPELLMOD_COOLDOWN
        EffectSpellClassMask_0: "0",
        EffectSpellClassMask_1: "1073741824",
        EffectSpellClassMask_2: "0",
        EffectSpellClassMask_3: "131072",
      },
    ];
    const spellClassOptionsRows = [
      {
        SpellID: "265187",
        SpellClassSet: "5",
        SpellClassMask_0: "0",
        SpellClassMask_1: "1073741824",
        SpellClassMask_2: "0",
        SpellClassMask_3: "131072",
      },
    ];

    const result = extractTalentModifiers(
      spellEffectRows,
      spellClassOptionsRows,
      [],
      spellNameRows,
      new Set(["265187"]),
    );

    expect(result["265187"]).toEqual([
      { talentSpellId: "1240189", effect: "reduce_cd", value: 5 },
    ]);
  });
});

// fix-29a-review.md finding #1: aura 108 (SPELL_AURA_ADD_PCT_MODIFIER) stores
// a *percentage* in EffectBasePointsF, not a flat second count like aura 107.
// The 2d5993c fix correctly gated both 107 and 108 on
// EffectMiscValue_0===SPELLMOD_COOLDOWN, but tagged every surviving hit
// (percentage-origin or flat-origin) as the same `reduce_cd` effect, which
// cooldowns.ts then subtracted as flat seconds — e.g. Unbreakable Spirit's
// real "-30%" was applied as "-30 seconds" (wrong by ~10x on Divine Shield's
// 300s base: real reduction is -90s, not -30s). Fix: aura 108 hits get a
// distinct `reduce_cd_pct` effect tag; cooldowns.ts applies it as a
// multiplier, not a subtraction.
describe("extractTalentModifiers — aura 108 (pct) must tag reduce_cd_pct, not reduce_cd (fix-29a-review.md finding #1)", () => {
  it("Unbreakable Spirit (114154, real DB2 row, aura 108, MiscValue_0=11) on Divine Shield (642) tags reduce_cd_pct with the raw percentage, not reduce_cd", () => {
    // Real row (SpellEffect ID 127297, build 12.1.0.69273): EffectBasePointsF=-30.
    const spellEffectRows = [
      {
        SpellID: "114154",
        Effect: "6",
        EffectAura: "108", // SPELL_AURA_ADD_PCT_MODIFIER
        EffectBasePointsF: "-30",
        EffectMiscValue_0: "11", // SPELLMOD_COOLDOWN
        EffectSpellClassMask_0: "4227072",
        EffectSpellClassMask_1: "0",
        EffectSpellClassMask_2: "8388864",
        EffectSpellClassMask_3: "4194304",
      },
    ];
    const spellClassOptionsRows = [
      {
        SpellID: "642",
        SpellClassSet: "10", // Paladin family
        SpellClassMask_0: "4194304",
        SpellClassMask_1: "0",
        SpellClassMask_2: "0",
        SpellClassMask_3: "0",
      },
    ];
    const result = extractTalentModifiers(
      spellEffectRows,
      spellClassOptionsRows,
      [],
      [
        { ID: "114154", Name_lang: "Unbreakable Spirit" },
        { ID: "642", Name_lang: "Divine Shield" },
      ],
      new Set(["642"]),
    );

    // Red before the fix: this would have been
    // [{ talentSpellId: "114154", effect: "reduce_cd", value: 30 }] — a
    // percentage silently reinterpreted as flat seconds.
    expect(result["642"]).toEqual([
      { talentSpellId: "114154", effect: "reduce_cd_pct", value: 30 },
    ]);
  });
});

// fix-29a-review.md finding #1 (arithmetic side): once a modifier is tagged
// `reduce_cd_pct`, the consumer must apply it as `base *= (1 - value/100)`,
// combined with any flat `reduce_cd` modifiers on the SAME spell in the order
// real WoW's own SpellMod system uses (verified against TrinityCore
// `Player::ApplySpellMod`/`GetSpellModValues`, Player.cpp:22636-22860,
// `TrinityCore/TrinityCore@master`): every matching flat mod is summed into
// the base FIRST, then every matching pct mod's multiplier is applied to
// that sum — `(base + Σflat) × Πpct`, not pct-of-raw-base-then-subtract-flat.
describe("applyCdTalentModifiers — flat vs pct arithmetic (fix-29a-review.md finding #1)", () => {
  it("Divine Shield (642, real production data): Unbreakable Spirit -30% applies as a multiplier (270→210... i.e. base*0.7), NOT flat -30s", () => {
    const base = effectiveBaseCooldown("642")!;
    expect(base).toBe(300); // 5 min, wowhead-confirmed
    const { cooldownSeconds } = applyCdTalentModifiers(
      "642",
      base,
      effectiveBaseCharges("642"),
      new Set(["114154"]), // only Unbreakable Spirit selected
      new Set(),
    );
    // Correct: 300 * (1 - 30/100) = 210. The pre-finding-#1 bug would have
    // produced 300 - 30 = 270 instead — off by 60s (~3x the true reduction).
    expect(cooldownSeconds).toBe(210);
  });

  it("Shield Wall (871, real production data): flat (-60s, Whirling Stars) and pct (-10%, Honed Reflexes) stack as (base + flat) * pct, not pct-then-flat", () => {
    const base = effectiveBaseCooldown("871")!;
    expect(base).toBe(210);
    const allTalents = new Set(
      CD_TALENT_MODIFIERS["871"].map((m) => m.talentSpellId),
    );
    const { cooldownSeconds } = applyCdTalentModifiers(
      "871",
      base,
      effectiveBaseCharges("871"),
      allTalents,
      new Set(),
    );
    // (210 - 60) * (1 - 10/100) = 150 * 0.9 = 135. The wrong order
    // (pct-then-flat) would give 210*0.9 - 60 = 129, a different number —
    // this assertion would catch an order regression, not just a missing
    // multiplier.
    expect(cooldownSeconds).toBeCloseTo(135, 5);
  });
});

// Invariant, run against the real generated+curated production data (not a
// synthetic fixture) THROUGH the real production arithmetic
// (`applyCdTalentModifiers`, not a reimplementation — fix-29a-review.md
// finding #2: an earlier version of this test computed `base - totalReduce`
// itself, which drifted from cooldowns.ts the moment this file grew
// percentage support and would have kept "passing" against the very bug
// finding #1 describes, since it never saw the pct arithmetic at all).
//
// No tracked major-CD spell's cooldownSeconds should be able to go negative,
// at either extreme — (a) every applicable talentSpellId for that spellId
// selected simultaneously (matching how a real unit's talentedSpellIds set
// is passed to `applyCdTalentModifiers` — every entry whose talentSpellId is
// present gets applied, unconditionally, cooldowns.ts's own loop), or (b) any
// one applicable talentSpellId selected alone. This is full coverage over the
// current CD_TALENT_MODIFIERS table (both `reduce_cd` and `reduce_cd_pct`
// entries — 118 tracked spellIds as of build 12.1.0.69273), not a sample —
// the table is small enough to check exhaustively.
describe("CD_TALENT_MODIFIERS invariant — no tracked major CD can go negative at either extreme", () => {
  const isCdModifier = (m: { effect: string }) =>
    m.effect === "reduce_cd" || m.effect === "reduce_cd_pct";
  const spellIdsWithCdModifier = Object.entries(CD_TALENT_MODIFIERS)
    .filter(([, mods]) => mods.some(isCdModifier))
    .map(([spellId]) => spellId);

  it("sanity: the table actually has reduce_cd/reduce_cd_pct entries to check (regression guard against an empty table silently passing everything)", () => {
    expect(spellIdsWithCdModifier.length).toBeGreaterThan(0);
  });

  it.each(spellIdsWithCdModifier)(
    "%s: cooldownSeconds stays >= 0 with every applicable talentSpellId selected simultaneously",
    (spellId) => {
      const base = effectiveBaseCooldown(spellId);
      if (base === undefined || base < MIN_CD_SECONDS) return; // never reaches majorSpells in production
      const allTalentIds = new Set(
        CD_TALENT_MODIFIERS[spellId]
          .filter(isCdModifier)
          .map((m) => m.talentSpellId),
      );
      const { cooldownSeconds } = applyCdTalentModifiers(
        spellId,
        base,
        effectiveBaseCharges(spellId),
        allTalentIds,
        new Set(),
      );
      expect(cooldownSeconds).toBeGreaterThanOrEqual(0);
    },
  );

  it.each(spellIdsWithCdModifier)(
    "%s: cooldownSeconds stays >= 0 with any one applicable talentSpellId selected alone",
    (spellId) => {
      const base = effectiveBaseCooldown(spellId);
      if (base === undefined || base < MIN_CD_SECONDS) return;
      const talentIds = new Set(
        CD_TALENT_MODIFIERS[spellId]
          .filter(isCdModifier)
          .map((m) => m.talentSpellId),
      );
      for (const talentId of talentIds) {
        const { cooldownSeconds } = applyCdTalentModifiers(
          spellId,
          base,
          effectiveBaseCharges(spellId),
          new Set([talentId]),
          new Set(),
        );
        expect(cooldownSeconds).toBeGreaterThanOrEqual(0);
      }
    },
  );
});

// 2026-08-15: `addModifier`'s dedup was keyed on (talentSpellId, effect)
// only. Two matched SpellEffect rows for the same pair with the SAME value
// are the same real modifier rediscovered via a second match path (Path A
// classmask / Path B chargeCategory / Path C direct id, or two EffectIndex
// rows describing one aura) and must collapse to one entry. Two matched rows
// with DIFFERENT values are genuinely distinct SpellEffect rows on the same
// talent — real WoW stacks these (TrinityCore `Player::GetSpellModValues`,
// Player.cpp:22773-22824: every SPELLMOD_FLAT mod sums via `*flat += value`,
// every SPELLMOD_PCT mod multiplies via `*pct *= 1 + value/100`) — dropping
// one ("first CSV row wins", pre-fix) was an order-dependent guess. Fixed:
// identical-value rows still collapse; distinct-value rows are now BOTH kept
// so `applyCdModifiers`/`applyCdTalentModifiers` (cooldowns.ts) — which
// already sums every `reduce_cd` entry and multiplies every `reduce_cd_pct`
// entry it iterates, with no assumption of at-most-one-entry-per-pair — can
// stack them. This keeps stacking arithmetic in exactly one place
// (`applyCdModifiers`); `addModifier` only decides what counts as "the same
// row" vs "a second row".
describe("addModifier — distinct-value collisions on (talentSpellId, effect) stack instead of dropping one (2026-08-15 fix)", () => {
  // Real talentSpellId (Berserk, Druid — classId 11/family 7 in talentIdMap.json)
  // so it passes extractTalentModifiers' own talentClassMap gate; the target
  // spellId and classmask are synthetic/harmless.
  const talentSpellId = "50334";
  const targetSpellId = "900001";
  const spellNameRows: Record<string, string>[] = [];
  const spellClassOptionsRows = [
    {
      SpellID: targetSpellId,
      SpellClassSet: "7", // Druid family (matches CLASS_ID_TO_FAMILY[11])
      SpellClassMask_0: "1",
      SpellClassMask_1: "0",
      SpellClassMask_2: "0",
      SpellClassMask_3: "0",
    },
  ];
  const maskRow = (
    aura: "107" | "108",
    basePoints: string,
  ): Record<string, string> => ({
    SpellID: talentSpellId,
    Effect: "6", // EFFECT_APPLY_AURA
    EffectAura: aura,
    EffectBasePointsF: basePoints,
    EffectMiscValue_0: "11", // SPELLMOD_COOLDOWN
    EffectSpellClassMask_0: "1",
    EffectSpellClassMask_1: "0",
    EffectSpellClassMask_2: "0",
    EffectSpellClassMask_3: "0",
  });

  it("two flat (107) rows and two pct (108) rows on the same talent→target pair are ALL kept (not collapsed to one per effect kind)", () => {
    const spellEffectRows = [
      maskRow("107", "-40"), // flat -40s
      maskRow("107", "-25"), // flat -25s (distinct value, second real row)
      maskRow("108", "-20"), // pct -20%
      maskRow("108", "-10"), // pct -10% (distinct value, second real row)
    ];

    const result = extractTalentModifiers(
      spellEffectRows,
      spellClassOptionsRows,
      [],
      spellNameRows,
      new Set([targetSpellId]),
    );

    expect(result[targetSpellId]).toHaveLength(4);
    expect(result[targetSpellId]).toEqual(
      expect.arrayContaining([
        { talentSpellId, effect: "reduce_cd", value: 40 },
        { talentSpellId, effect: "reduce_cd", value: 25 },
        { talentSpellId, effect: "reduce_cd_pct", value: 20 },
        { talentSpellId, effect: "reduce_cd_pct", value: 10 },
      ]),
    );
  });

  it("a second row with an IDENTICAL value (same real modifier via a second match path) still collapses to one entry", () => {
    const spellEffectRows = [
      maskRow("107", "-40"),
      maskRow("107", "-40"), // same value — same real modifier, rediscovered
    ];

    const result = extractTalentModifiers(
      spellEffectRows,
      spellClassOptionsRows,
      [],
      spellNameRows,
      new Set([targetSpellId]),
    );

    expect(result[targetSpellId]).toEqual([
      { talentSpellId, effect: "reduce_cd", value: 40 },
    ]);
  });

  it("applyCdModifiers stacks the four extracted entries per TrinityCore semantics: (base - Σflat) × Πpct", () => {
    const spellEffectRows = [
      maskRow("107", "-40"),
      maskRow("107", "-25"),
      maskRow("108", "-20"),
      maskRow("108", "-10"),
    ];
    const result = extractTalentModifiers(
      spellEffectRows,
      spellClassOptionsRows,
      [],
      spellNameRows,
      new Set([targetSpellId]),
    );

    const { cooldownSeconds } = applyCdModifiers(
      result[targetSpellId],
      300,
      1,
      new Set([talentSpellId]),
      new Set(),
    );
    // (300 - 40 - 25) * (1 - 20/100) * (1 - 10/100)
    //   = 235 * 0.8 * 0.9 = 169.2
    expect(cooldownSeconds).toBeCloseTo(169.2, 5);
  });
});

// Regression fixture for the real production collision this fix addresses
// (BACKLOG: `addModifier` dedup review finding #3). All four hits land on
// target spellId "11" (a deprecated spell not merged into `spellEffectData`,
// hence zero production impact either before or after this fix — it never
// reaches `filteredResults` in real builds, which don't add "11" to
// trackedSpellIds) via 4 unrelated real talents across 4 classes, values
// confirmed against a live regen on build 12.1.0.69299 (2026-08-15,
// pre-fix): 50334 (Berserk, Druid) reduce_cd_pct 50 vs 100; 381647 (Planes
// Traveler, Shaman) reduce_cd 30 vs 15; 344359 (Ancient Arts, Monk) reduce_cd
// 15 vs 10; 1270255 (Oppressive Darkness, Warlock) reduce_cd 15 vs 5 — the
// pre-fix generator printed a `dedup collision ... kept=X dropped=Y` warning
// for each and silently discarded the second value.
describe("real collision regression — target spellId 11 (2026-08-15, pre-fix live regen)", () => {
  const spellNameRows: Record<string, string>[] = [];
  // No classmask (all zero) so only Path C — the direct-id path keyed on
  // EffectMiscValue_0 — produces these entries, mirroring how the real rows
  // reach target "11" (MiscValue_0 doubles as SPELLMOD_COOLDOWN's op code 11
  // and, via Path C, as a literal target spellId — a separate, out-of-scope
  // quirk; this fixture only exercises addModifier's dedup on the result).
  const cooldownGateRow = (
    spellId: string,
    aura: "107" | "108",
    basePoints: string,
  ): Record<string, string> => ({
    SpellID: spellId,
    Effect: "6",
    EffectAura: aura,
    EffectBasePointsF: basePoints,
    EffectMiscValue_0: "11",
    EffectSpellClassMask_0: "0",
    EffectSpellClassMask_1: "0",
    EffectSpellClassMask_2: "0",
    EffectSpellClassMask_3: "0",
  });

  it("both values survive for each of the 4 real talentSpellIds instead of one being dropped", () => {
    const spellEffectRows = [
      cooldownGateRow("50334", "108", "-50"),
      cooldownGateRow("50334", "108", "-100"),
      cooldownGateRow("381647", "107", "-30"),
      cooldownGateRow("381647", "107", "-15"),
      cooldownGateRow("344359", "107", "-15"),
      cooldownGateRow("344359", "107", "-10"),
      cooldownGateRow("1270255", "107", "-15"),
      cooldownGateRow("1270255", "107", "-5"),
    ];

    const result = extractTalentModifiers(
      spellEffectRows,
      [],
      [],
      spellNameRows,
      new Set(["11"]),
    );

    expect(result["11"]).toEqual(
      expect.arrayContaining([
        { talentSpellId: "50334", effect: "reduce_cd_pct", value: 50 },
        { talentSpellId: "50334", effect: "reduce_cd_pct", value: 100 },
        { talentSpellId: "381647", effect: "reduce_cd", value: 30 },
        { talentSpellId: "381647", effect: "reduce_cd", value: 15 },
        { talentSpellId: "344359", effect: "reduce_cd", value: 15 },
        { talentSpellId: "344359", effect: "reduce_cd", value: 10 },
        { talentSpellId: "1270255", effect: "reduce_cd", value: 15 },
        { talentSpellId: "1270255", effect: "reduce_cd", value: 5 },
      ]),
    );
    expect(result["11"]).toHaveLength(8);
  });
});

// 2026-09-13 talent-integration audit (talentCatalog.ts × talentModifiers.json):
// three generator defects, each pinned with a synthetic row on a REAL talent id
// so it passes the talentClassMap gate.
describe("extractTalentModifiers — 2026-09-13 audit fixes", () => {
  const spellNameRows: Record<string, string>[] = [];
  const row = (
    spellId: string,
    aura: string,
    basePoints: string,
    misc0: string,
    mask0: string,
  ): Record<string, string> => ({
    SpellID: spellId,
    Effect: "6",
    EffectAura: aura,
    EffectBasePointsF: basePoints,
    EffectMiscValue_0: misc0,
    EffectSpellClassMask_0: mask0,
    EffectSpellClassMask_1: "0",
    EffectSpellClassMask_2: "0",
    EffectSpellClassMask_3: "0",
  });
  const classOpt = (spellId: string, set: string, mask0: string) => ({
    SpellID: spellId,
    SpellClassSet: set,
    SpellClassMask_0: mask0,
    SpellClassMask_1: "0",
    SpellClassMask_2: "0",
    SpellClassMask_3: "0",
  });

  it("a Monk class-mask modifier matches SpellClassSet 53 (was keyed on 126 and matched nothing)", () => {
    // Ancient Arts 344359 is a Brewmaster talent.
    const result = extractTalentModifiers(
      [row("344359", "107", "-15000", "11", "4")],
      [classOpt("900053", "53", "4")],
      [],
      spellNameRows,
      new Set(["900053"]),
    );
    expect(result["900053"]).toEqual([
      { talentSpellId: "344359", effect: "reduce_cd", value: 15 },
    ]);
  });

  it("aura 454 (charge recovery %) becomes reduce_cd_pct through the charge category, sign kept", () => {
    const result = extractTalentModifiers(
      [row("344359", "454", "-12", "7777", "0")],
      [],
      [{ SpellID: "900454", ChargeCategory: "7777" }],
      spellNameRows,
      new Set(["900454"]),
    );
    expect(result["900454"]).toEqual([
      { talentSpellId: "344359", effect: "reduce_cd_pct", value: 12 },
    ]);
  });

  it("row identity decides dedup: two distinct DB2 rows with equal values are both kept", () => {
    const withId = (id: string) => ({
      ...row("344359", "107", "-15000", "11", "4"),
      ID: id,
    });
    const result = extractTalentModifiers(
      [withId("5001"), withId("5002"), withId("5001")],
      [classOpt("900053", "53", "4")],
      [],
      spellNameRows,
      new Set(["900053"]),
    );
    expect(result["900053"]).toEqual([
      {
        talentSpellId: "344359",
        effect: "reduce_cd",
        value: 15,
        sourceRowId: "5001",
      },
      {
        talentSpellId: "344359",
        effect: "reduce_cd",
        value: 15,
        sourceRowId: "5002",
      },
    ]);
  });

  it("one talent writing the same reduction as a cooldown SpellMod AND a charge-recovery aura counts once, on the target's own mechanism", () => {
    // 神圣职责 216853 shape: aura 108 op 11 −33 % by class mask + aura 454 −33 %
    // on a charge category. A charged target keeps the charge row; a target
    // reached only by the mask keeps the cooldown row.
    const result = extractTalentModifiers(
      [
        { ...row("344359", "108", "-33", "11", "4"), ID: "7001" },
        { ...row("344359", "454", "-33", "1392", "0"), ID: "7002" },
      ],
      [classOpt("900100", "53", "4"), classOpt("900200", "53", "4")],
      [{ SpellID: "900100", ChargeCategory: "1392" }],
      spellNameRows,
      new Set(["900100", "900200"]),
    );
    expect(result["900100"]).toEqual([
      {
        talentSpellId: "344359",
        effect: "reduce_cd_pct",
        value: 33,
        sourceRowId: "7002",
      },
    ]);
    expect(result["900200"]).toEqual([
      {
        talentSpellId: "344359",
        effect: "reduce_cd_pct",
        value: 33,
        sourceRowId: "7001",
      },
    ]);
  });

  it("a SpellMod row's MiscValue_0 (op 11) is never read as ChargeCategory 11", () => {
    const result = extractTalentModifiers(
      [row("344359", "107", "-15000", "11", "0")],
      [],
      [{ SpellID: "900011", ChargeCategory: "11" }],
      spellNameRows,
      new Set(["900011"]),
    );
    expect(result["900011"]).toBeUndefined();
  });

  it("a temporary-buff source emits no cooldown modifier but keeps replace_spell", () => {
    // Berserk 50334: its −100 % Frenzied Regeneration only holds while Berserk is up.
    const rows = [
      row("50334", "108", "-100", "11", "1"),
      row("50334", "332", "900999", "900007", "0"),
    ];
    const opts = [classOpt("900007", "7", "1")];
    const gated = extractTalentModifiers(
      rows,
      opts,
      [],
      spellNameRows,
      new Set(["900007"]),
      new Set(["50334"]),
    );
    expect(gated["900007"]).toEqual([
      { talentSpellId: "50334", effect: "replace_spell", value: 900999 },
    ]);
    const ungated = extractTalentModifiers(
      rows,
      opts,
      [],
      spellNameRows,
      new Set(["900007"]),
    );
    expect(ungated["900007"]).toEqual(
      expect.arrayContaining([
        { talentSpellId: "50334", effect: "reduce_cd_pct", value: 100 },
      ]),
    );
  });
});

/**
 * Anti-drift test for `spellEffectOverrides`' durations (2026-09-06).
 *
 * The merge in `spellEffectData` is a whole-object spread, so an override entry
 * REPLACES the generated one — a hand duration therefore shadows the official
 * DB2 value silently, and nothing noticed when the two disagreed. A sweep of
 * all 93 entries found 15 disagreements; the corpus (227-file archive,
 * APPLIED→REMOVED lifetimes) adjudicated each one:
 *
 *  · 4 where the official value was right and the hand number was shadowing
 *    it — corrected in place, and pinned below so a DB2 refresh that moves
 *    them turns CI red instead of silently re-opening the gap.
 *  · 3 where the hand number was right because it is the TALENTED value
 *    (Barkskin / Guardian Spirit / Time Dilation) — those keep their override
 *    as the no-caster answer and are priced per caster by
 *    `BUFF_DURATION_TALENT_MODIFIERS`; pinned as a deliberate disagreement.
 *  · the rest are channels (Divine Hymn, Tranquility, The Hunt — observed
 *    lifetime is interruption, not duration) or unresolved (Shadow Blades,
 *    Recklessness, and three with <50 corpus samples). Those stay as they are
 *    and are NOT pinned, so nobody reads this test as blessing them.
 */
import { SPELL_EFFECTS_GENERATED } from "../src/data/spellEffectGenerated";
import { SPELL_EFFECT_OVERRIDES } from "../src/data/spellEffectOverrides";

const gen = SPELL_EFFECTS_GENERATED as Record<
  string,
  { durationSeconds?: number }
>;
const ov = SPELL_EFFECT_OVERRIDES as Record<
  string,
  { durationSeconds?: number }
>;

/** Corpus said the official DB2 duration was right — keep the two equal. */
const OFFICIAL_WINS = ["31850", "204018", "13750", "102560"];

/** Corpus said the hand value was right *because it is the talented one*. */
const DELIBERATELY_TALENTED: Record<string, number> = {
  "22812": 12, // 8 + Improved Barkskin
  "47788": 12, // 10 + Foreseen Circumstances
  "357170": 10.4, // 8 × (1 + 0.15 × 2), Timeless Magic rank 2
};

describe("spellEffectOverrides 的时长不许静默偏离官方值", () => {
  it.each(OFFICIAL_WINS)("%s:手工值 === 官方 DB2 值", (id) => {
    expect(gen[id]?.durationSeconds).toBeDefined();
    expect(ov[id]?.durationSeconds).toBe(gen[id]!.durationSeconds);
  });

  it.each(Object.keys(DELIBERATELY_TALENTED))(
    "%s:刻意不等于官方值(手工值 = 带天赋的典型值)",
    (id) => {
      expect(ov[id]?.durationSeconds).toBe(DELIBERATELY_TALENTED[id]);
      expect(ov[id]?.durationSeconds).not.toBe(gen[id]?.durationSeconds);
    },
  );
});

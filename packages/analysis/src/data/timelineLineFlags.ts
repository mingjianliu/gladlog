/**
 * Switches for timeline lines that ship with a measured alternative, so an
 * A/B or a fact-retrieval probe can render the same round three ways
 * (current / new / cheap alternative) without a code change. Product
 * defaults are the values below; a probe mutates the object per variant
 * (restore afterwards — the flag guard in test/testIsolation.test.ts rejects
 * a test that leaves them dirty).
 *
 * GH #97 (2026-09-15, first Opus 5 baseline): both lines answer the two
 * "sufficiency 4 / scaffolding 4" reasons the judges named most — enemy
 * defensives exist only in the KILL ATTEMPTS summary, and the owner's
 * spam-folded heals hide what was cast on whom in the seconds before a
 * friendly death. Formats settled with agy (round 2 CONCEDE); costs measured
 * on 432 archive rounds: [ENEMY DEF] ≈ +71 tokens/round, the death-window
 * unfold ≈ +14.
 */
export const TIMELINE_LINE_FLAGS = {
  /**
   * Enemy defensive cooldowns.
   *  - "timeline": a `[ENEMY DEF]` line at the aura's start, with the
   *    official pct and the OBSERVED duration (`— removed early` when the
   *    aura ended before its full duration — a dispel or an immunity break).
   *  - "stamp": no timeline line; the KILL ATTEMPTS summary appends `@m:ss`
   *    to `popped X` / `saved by external (X)` (the cheap alternative).
   *  - "off": the pre-#97 prompt.
   */
  enemyDef: "timeline" as "off" | "timeline" | "stamp",
  /**
   * The owner's spam-folded spells (≥ SPAM_FOLD_THRESHOLD casts) inside a
   * friendly-death window (death − DEATH_WINDOW_S … death).
   *  - "perCast": each cast renders on its own line with the target's HP at
   *    that rendered second (the [STATE] sampler), capped per window.
   *  - "summary": one `[YOU] [HEALS]` line per window with counts by spell
   *    and target (the cheap alternative — loses order vs the HP trajectory).
   *  - "off": the pre-#97 prompt (folded for the whole match).
   */
  deathWindowUnfold: "perCast" as "off" | "perCast" | "summary",
  /**
   * GH #91 (value gate passed 2026-09-22): what each friendly who had hit the
   * recipient in the 3 s before an ally-applied external kept doing while it
   * was up, appended to that `[ENEMY DEF]` line as `| during it: …`
   * (`utils/externalDamage.ts`, the pre-registered contract).
   *  - "annotate": the annotation is rendered.
   *  - "off": the pre-#91 line.
   */
  duringExternal: "annotate" as "off" | "annotate",
};

/** Seconds before a friendly death that count as its window. */
export const DEATH_WINDOW_S = 10;
/** Per-window cap on unfolded cast lines (measured p90 of all owner casts in
 * a death window is 8, so the cap almost never binds). */
export const DEATH_WINDOW_UNFOLD_CAP = 8;

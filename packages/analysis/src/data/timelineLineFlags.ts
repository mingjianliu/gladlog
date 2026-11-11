/**
 * Constants of the two timeline lines GH #97 added (2026-09-15, first Opus 5
 * baseline): the `[ENEMY DEF]` line at an enemy defensive's start, and the
 * per-cast unfold of the owner's spam-folded heals in the seconds before a
 * friendly death. Costs measured on 432 archive rounds: [ENEMY DEF] ≈ +71
 * tokens/round, the death-window unfold ≈ +14.
 *
 * This file used to hold `TIMELINE_LINE_FLAGS`, a three-way switch per line
 * for the fact-retrieval probe that chose them ("off" / "stamp" for
 * `[ENEMY DEF]`, "off" / "summary" for the unfold, "off" for the GH #91
 * `| during it:` annotation). Nothing set a non-default position after the
 * probes (0 setters outside tests), so the positions and the switch are
 * gone (GH #150 D3, 2026-11-11); the probe's record is GH #97.
 */

/** Seconds before a friendly death that count as its window. */
export const DEATH_WINDOW_S = 10;
/** Per-window cap on unfolded cast lines (measured p90 of all owner casts in
 * a death window is 8, so the cap almost never binds). */
export const DEATH_WINDOW_UNFOLD_CAP = 8;

/**
 * What is left of the two mana candidates (`mana-pressure`, `mana-efficiency`;
 * BACKLOG #26, declined at the value gate 2026-08-16, successor #33 declined
 * 2026-09-05): the one threshold a live reader still uses. The producers,
 * their calibration constants and tests were deleted on 2026-11-11 (T79,
 * GH #150 D2) — the registry rows are `deleted`.
 */

/** The mana% under which a contiguous run of raw-stream samples is an OOM
 * window (`oomWindowsOf`). Read by eval's `matchExplore mana` sub-command for
 * its OOM-window listing. Calibrated for the retired `mana-pressure`
 * candidate (full-corpus sweep n=1028 matches / 3434 rounds over
 * LOW_PCT ∈ {5, 10, 15}; 15 was the loosest corner tested). */
export const MANA_PRESSURE_LOW_PCT = 15;

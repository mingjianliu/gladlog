/**
 * Buttons DB2 gives no SpellCooldowns row (`isButtonPress` false) — the
 * missing row does not make a passive of them, and no product table tells
 * the two apart, so the ones read on raw rows are listed here.
 *
 * No product reader consumes this list: it is the reviewed exemption of
 * scan5 `castLineNoButton` (packages/eval/scripts/scan5/fact11.ts), the
 * forward check of `PASSIVE_PROC_CAST_IDS` — a `[YOU] [CAST]` line whose
 * every row is no button by DB2 is a passive's row unless it is listed here
 * (counted out of the scan's total) or an item's on-use spell (DB2
 * ItemEffect, read by the scan). It lives in the analysis package so that
 * `curatedIdRegistry.ts` can register it (Curated-List Completeness Rule;
 * pipeline T329).
 *
 * Counts are `castLineNoButton` rows on the 605 archives.
 */
export const NO_COOLDOWN_ROW_BUTTON_IDS: ReadonlyMap<string, string> = new Map([
  [
    "155777",
    "Rejuvenation (Germination) — the press beside its 774 companion (`COMPANION_CAST_ROWS`); 1,084 rows (T243, scan triage 2026-11-22)",
  ],
  ["115008", "Chi Torpedo — Roll's charge-based replacement; 211 rows (T243)"],
  ["61391", "Typhoon — a pressed knockback; 64 rows (T243)"],
  ["62124", "Hand of Reckoning — a pressed taunt; 20 rows (T243)"],
  [
    "433568",
    "Rite of Sanctification (Paladin) — a pressed weapon imbue, SPELL_CAST_START then SPELL_CAST_SUCCESS by the paladin 1.8 s later (11346ea9 r3 0:03); 8 rows in 8 archives (pipeline T329, 605 at 87e3bc72c)",
  ],
  [
    "443591",
    "Unity Within (Mistweaver Monk) — the Celestial Conduit recast, pressed on an enemy inside the 443028 channel (b49d3eed r1 0:30: 1.2 s into the channel); on the global cooldown by SpellCategories 133 only; 5 rows in 4 archives (pipeline T329, 605 at 87e3bc72c)",
  ],
]);

v405 (2026-10-16, F15 batch 2 — fact1215 R1, user ruling relayed by
round1+2: 「我现在只关心事实层的东西」 — every printed "lowest / low / team
min" is the true minimum; point readings keep the 2026-09-23 last-line rule):
`hpTroughInWindow` reads every line of an instant (a hit and the heal it
provoked share one ms — 332b9b2f printed 43 % over 36.8 %); the `[KILL
WINDOW]` team min reads `hpTroughInEventSpan` instead of whole-second ticks
(8cd58545 `team min HP 33%` over a paladin at 3.8 %); `[CD PRIOR]` "bottomed
at" prints the dip's trough (its ranking and gating stay on the grid).
Deliberately unchanged (predicate-index "Not yet unified"): `[SLACK]` /
`[CONTESTED]` team min (the grid band IS the segment), an event span's
first-second tick (62fdbf2e), `hpAtPress`. 605 files: no candidate added or
removed; 49 rows' HP facts move (kick-eaten 25, missed-sync-window 14,
slow-defensive-response 7, position-mistake 3); troughFactScan: [DMG SPIKE]
lows below the log 106 → 0 of 3,239, [KILL WINDOW] team min 2,215 → 0 of
3,891; two burst target lines gain a `(low …)` the same-ms dip now clears.

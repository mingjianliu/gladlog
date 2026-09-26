/** Version key of the analysis cache: the main process writing the cache, the
 *  main process reading it, and E2E seeding it all share this one constant.
 *
 *  Single-source predicate — a hardcoded copy fails silently on a version bump:
 *  getCached discards the cache, the panel sits idle, and E2E only reports the
 *  undirected failure "there are no findings".
 *
 *  Bump when prompt text or the candidate menu changes; one bump per batch.
 *  Full history in docs/prompt-version-history.md (append new entries there);
 *  the last few entries stay inline so a reader sees the format:
 *
 *  v152 (2026-09-25, reliability round 3 W1k): a kick after an officially
 *  channelled spell (DB2 SpellMisc "Is Channelled") had gone out is a channel
 *  kick — kick-eaten carries phase=channel + channelS instead of a clamped
 *  kickDepthPct, and the legend / consequence rule no longer say it "never
 *  landed" or invite fake-casting. 605 files: 273 of 1,536 kick-eaten lines
 *  are channel kicks, 33 lose kickDepthPct; nothing else moves.
 *  v153 (2026-09-26, GH #115): Radiant Glory's proc Avenging Wrath (454351)
 *  is Avenging Wrath's EFFECT for every burst consumer (offensiveEffectCdId /
 *  isOffensiveSpell; not a press) — weighted like 31884, its own 8 s, no
 *  "available again"; our own Ret's proc into a wall is accused like a press
 *  (user 2026-09-26 「指控」: 1,406 / 1,406 procs follow a Wake of Ashes press
 *  within 0.02 s). 605 files at ccb3db74: slow-defensive-response healer
 *  101 → 129 (+33 / −5, 28 led by 454351), position-mistake dps 615 → 654 /
 *  healer 10 → 12 (57 stayed-in), burst-into-mitigation dps 35 → 44 (all
 *  Avenging Wrath), missed-cleanse −4 (the 08-19 timing gate now sees the
 *  burst), cd-hoarded 9 swapped; [ENEMY CD] Avenging Wrath lines appear.
 *  v154 (2026-09-26, reliability round 2 W1g): control cooldowns enter the
 *  ledger by their CAST id (Freezing Trap, Binding Shot, Intimidation,
 *  Blinding Light, Capacitor Totem, Ring of Frost were listed by aura id and
 *  never admitted) and 14 missing control cooldowns are listed; an unmapped
 *  cast's DR is "n/a", never "Full"; CC USE counts every Control cooldown, a
 *  disarm only on a melee target (user 2026-09-25). 605 files at 9a39c98c:
 *  menu identical; 3,418 contexts change (loadouts / [RES] / cast lines gain
 *  the control kit); [CC BOOKMARK] 412 → 733; context gates 0 → 0.
 */
export const PROMPT_VERSION = 154;

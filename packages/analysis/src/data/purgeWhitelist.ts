/**
 * The enemy-buff purge whitelist (emit side) and the entries of it that cannot
 * currently be emitted for lack of dispelType data. Moved out of
 * context/matchTimeline.ts unchanged (GH #116); registered in
 * curatedIdRegistry; pinned by context/matchTimeline.purgeWhitelist.test.ts.
 */

/**
 * Emit-side whitelist: which enemy buffs are worth reporting as "you could
 * have purged this".
 *
 * ⚠ This set is **not** the only gate. For a miss to reach here it must first
 * clear two gates in dispelAnalysis:
 *   ① spellEffectData[id].dispelType === "Magic"   (DB2 mining + manual overrides)
 *   ② SPELL_CATEGORIES[id] type maps to Critical/High (absent → Low → dropped)
 * All three lists assert the same fact ("this buff is purgeable and worth
 * purging") yet are maintained independently — 2026-07-21 full-corpus
 * measurement: 7 of the 9 entries were dead, the product could only ever emit
 * Power Infusion and BoP.
 *
 * So consistency between this set and its upstream gates is asserted by
 * `matchTimeline.purgeWhitelist.test.ts`; entries known to be dead for lack of
 * dispelType data are registered in `PURGE_WHITELIST_DATA_BLOCKED`, and the
 * test will surface them the next time the DB2 data is refreshed. Do not just
 * add an id here — adding one alone has no effect.
 */
// 2026-08-21 S2 corpus scan (10,682 matches): removed Dark Soul: Instability 113858, 113861 (no DB2 name), Icy Veins 12472, Temporal Shield 198111; old Alter Time 110909 → live 342246 — 0 occurrences, ability gone in 12.x (eval-private/reports/s2-health-2026-08-21)
export const HIGH_VALUE_PURGEABLE_BUFFS = new Set<string>([
  "10060", // Power Infusion
  "1022", // Blessing of Protection
  "1044", // Blessing of Freedom
  "342246", // Alter Time (live id; getDispelType → Magic, so not data-blocked)
  "6940", // Blessing of Sacrifice
  // 2026-07-22 decision: added seven discrete active CDs (no permanent
  // HoTs/shields) — validated both ways against the corpus; see the same-day
  // note in spellCategories.ts.
  "210256", // Blessing of Sanctuary
  "29166", // Innervate
  "212295", // Nether Ward
  "378441", // Time Stop
  "370553", // Tip the Scales
  "132158", // Nature's Swiftness
  "378081", // Nature's Swiftness (variant id)
  "79206", // Spiritwalker's Grace
]);

/**
 * Whitelist entries that currently cannot be emitted — what is missing is
 * dispelType (DB2 mining only covers 123 of 3560 spells; absent ≠ not
 * dispellable, it just was not mined). These are not "should not report", they
 * are "cannot report". Delete them from here once the data is filled in.
 */
// 2026-08-21 S2 corpus scan (10,682 matches): removed 113858/113861/12472/198111 (see above); 110909 replaced by 342246 which has dispelType Magic and is therefore not blocked — 0 occurrences, ability gone in 12.x (eval-private/reports/s2-health-2026-08-21)
// 2026-08-23:燃烧 190319 从这里**和**上面的白名单一起摘掉 —— 它不是「缺 dispelType
// 数据所以暂时发不出」,是**根本偷不掉**。归档 400 个文件实测:上身 440 次、施放 425 次、
// 出现在 55 个文件,而 SPELL_STOLEN 与 SPELL_DISPEL **各 0 次**;官方 getDispelType 也是
// null。不是样本不足,是这个 buff 在 12.1 就偷不走。用户 2026-08-23 裁定「不能」。
export const PURGE_WHITELIST_DATA_BLOCKED = new Set<string>([]);

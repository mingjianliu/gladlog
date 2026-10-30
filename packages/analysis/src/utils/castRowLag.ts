/**
 * How long a press's own SPELL_CAST_SUCCESS row can be logged AFTER the
 * effect it caused — one measured tolerance for every "the press came after
 * its own effect" reading (round-3 fact audit, 2026-10-21: three fixes had
 * each set 50 ms beside an older one, and real presses fell outside it —
 * a Vanish cast 53 ms after its 11327 aura read `[no press logged]`, two
 * Medallions 72 / 85 ms after the CC removal they caused bound nothing).
 *
 * Corpus (605 archive files, `NR%60` of the new-season manifest): Vanish
 * 1856 cast vs its own 11327 APPLIED — 504 pairs, 98.4 % in [0, 10) ms,
 * every one ≤ 89 ms; a PvP-trinket cast vs the last DEBUFF removal on its
 * caster within 300 ms — 2,997 pairs, 98.3 % in [0, 10), 99.2 % ≤ 100 ms,
 * a flat tail to 280 ms (a debuff that ended some other way first). 100 ms
 * covers the lag; a removal the log gives another cause for (a BROKEN row,
 * a dispel) is excluded by the readers themselves.
 */
export const CAST_ROW_LAG_MAX_MS = 100;

/**
 * How long AFTER an aura its own press's SPELL_CAST_SUCCESS row can be
 * logged (corpusFactScan auraCastGap, 2026-10-21). 605 new-season files,
 * every 30th: 128,870 self-aura → own cast pairs (no cast of it in the 1 s
 * before the aura; Prayer of Mending bounces left out) — 128,683 ≤ 50 ms,
 * 90 at 50–100, 22 at 100–150, 21 at 150–300 (Eternal Flame, Malevolence,
 * Disintegrate — no wall); Gladiator's Medallion: all 6,017 casts, max
 * 150 ms. 100 ms (`CAST_ROW_LAG_MAX_MS`) missed real presses: Die by the
 * Sword 104 ms read `[no press logged]` (82-5 1:48). A removal-before-cast
 * reader keeps `CAST_ROW_LAG_MAX_MS`: widening it binds a press to a control
 * that ran out on its own.
 */
export const AURA_BEFORE_CAST_ROW_MAX_MS = 150;

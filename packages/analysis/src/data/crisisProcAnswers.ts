/**
 * crisisProcAnswers.ts — the low-HP protection procs and the casts they make,
 * a leaf table: the crisis reading (`analysis/crisisDecisionPoints.ts`, which
 * re-exports it) and the cooldown ledger (`utils/procTriggeredCast.ts`) both
 * read it, and the ledger cannot import the crisis module (it imports the
 * ledger).
 */
/**
 * Low-HP protection procs (BACKLOG #43, user ruling 2026-09-14 "自动 proc 可以
 * 算进去,但话术要变" and 2026-09-17 "可以做一下"). Keyed by the proc's MARKER
 * aura — the internal-cooldown buff the game applies to the owner the instant
 * the talent fires — with the spell(s) the proc casts, so those casts can be
 * subtracted from the owner's own presses. Only talents whose marker is
 * actually observed in the archive as a self-applied low-HP trigger are
 * listed (crisisProcMarkerProbe.ts, 1/40 archive, 2026-09-17):
 *  - Well-Honed Instincts 382912: 1,039 applications, 1,039 self-sourced,
 *    985 at ≤ 49 % [STATE] HP (364 at ≤ 40 %, 621 in 40–49 % — the 1 s grid
 *    reads the crossing late). The proc's Frenzied Regeneration is almost
 *    never logged as a SPELL_CAST_SUCCESS (25 within 1 s, 92 within 3 s,
 *    922 none) — only its heal events carry 22842, which is why the trigger
 *    id is subtracted from the HEAL side too, not just the cast side.
 *  - Dream Guide 1278914 is NOT a proc marker: 153 applications, only 22
 *    self-sourced, 88 at ≥ 80 % HP — it is the buff the talent hands out,
 *    so it is deliberately absent.
 *  - Guided Prayer 404357 and Last Resort 209258 have no observable sibling
 *    id at all. An undetectable proc must not be guessed from a cast
 *    (BACKLOG #43 待做 1: "逐个用日志核实,不要猜").
 * Registered in curatedIdRegistry.
 */
export interface CrisisProcAnswer {
  name: string;
  /** `proc` = a low-HP auto-protection (heals / shields / reduces on its
   * own); `cheatDeath` = a lethal hit was converted into survival — the
   * crisis went all the way to the death line, so the phrasing differs
   * ("X saved you from a killing blow") */
  kind: "proc" | "cheatDeath";
  /** how the marker shows in the log: an aura APPLIED self→self, or a heal
   * event self→self carrying the marker id */
  via: "aura" | "heal";
  /** spells the proc casts / heals with, subtracted from the owner's presses */
  triggers: ReadonlySet<string>;
}
// Second probe run 2026-09-17 (user: 「好 可以 看看效果」), 1/40 archive =
// 2,993 rounds, every candidate sibling id of every automatic protection
// talent; the bar is self-sourced ≈ 100 % AND low HP at the instant (the
// [STATE] grid reads the SAME second, so an instant heal shows post-heal HP):
//   Blood Draw 454871       aura 318/318 self, 317 ≤ 40 %          → proc
//   Nature's Guardian 31616 heal 771/771 self (40 % instant heal, HP read
//                           after it: 193 in the 30s, 165/176 in 50s/60s) → proc
//   Veteran Vitality 441387 aura 55 + heal 165, 220/220 self, 189 ≤ 50 %   → proc
//   Golden Val'kyr 393108   aura 6/6 self, 6 ≤ 40 % (Prot only, 2 units)   → proc
//   Cauterize 87023         aura 251/251 self, 244 ≤ 40 % (HP set to 35 %) → cheatDeath
//   Cheat Death 45182       aura 25/25 self, 23 in the 0s bucket (7 % HP)  → cheatDeath
// Rejected: Defy Fate (8 events, 1 unit, heals allies too), Purgatory (1),
// Last Resort 209261 (0), Battle-Scarred Veteran (0), Elixir of Determination
// (2), Whirling Steel (15, only 2 ≤ 40 %), Dream Guide (hand-out buff),
// Guided Prayer (no sibling id).
export const CRISIS_PROC_ANSWERS: ReadonlyMap<string, CrisisProcAnswer> =
  new Map<string, CrisisProcAnswer>([
    // Well-Honed Instincts (Druid class talent, ~100 % pick): below 40 % HP,
    // casts Frenzied Regeneration 22842 once per 120 s; 382912 = the 120 s marker.
    [
      "382912",
      {
        name: "Well-Honed Instincts",
        kind: "proc",
        via: "aura",
        triggers: new Set(["22842"]),
      },
    ],
    // Blood Draw (DK class, 96 %): below 30 % drains nearby enemies (heal id
    // 374606) and takes 10 % less damage for 8 s; 454871 = the buff.
    [
      "454871",
      {
        name: "Blood Draw",
        kind: "proc",
        via: "aura",
        triggers: new Set(["374606"]),
      },
    ],
    // Nature's Guardian (Shaman class, 100 %): below 35 % heals 40 % max HP
    // instantly; the heal event itself (31616) is the only trace.
    [
      "31616",
      {
        name: "Nature's Guardian",
        kind: "proc",
        via: "heal",
        triggers: new Set(["31616"]),
      },
    ],
    // Veteran Vitality (Warrior hero, 7 %): at 35 % heals 12 % over 2 s.
    [
      "441387",
      {
        name: "Veteran Vitality",
        kind: "proc",
        via: "aura",
        triggers: new Set(["441387"]),
      },
    ],
    // Gift of the Golden Val'kyr (Prot Paladin, 97 %): below 30 % grants
    // Guardian of Ancient Kings for 4 s (393879 = the guardian aura).
    [
      "393108",
      {
        name: "Gift of the Golden Val'kyr",
        kind: "proc",
        via: "aura",
        triggers: new Set(["393879"]),
      },
    ],
    // Cauterize (Mage, 100 %): a killing blow leaves the mage at 35 % and
    // burning 28 % over 6 s; 87023 = the burn, 108843 = the speed buff.
    [
      "87023",
      {
        name: "Cauterize",
        kind: "cheatDeath",
        via: "aura",
        triggers: new Set(["87023", "108843"]),
      },
    ],
    // …and its own heal 1286444: the burn aura is not always written (fact4
    // D61 — 211 of 1,011 procs on 605 files every 3rd had the heal and no
    // 87023); one proc's two markers name it once (`procNames`)
    [
      "1286444",
      {
        name: "Cauterize",
        kind: "cheatDeath",
        via: "heal",
        triggers: new Set(["1286444"]),
      },
    ],
    // Cheat Death (Rogue, 5 %): a killing blow leaves the rogue at 7 % with
    // 85 % damage reduction for 3 s; 45182 = that reduction.
    [
      "45182",
      {
        name: "Cheat Death",
        kind: "cheatDeath",
        via: "aura",
        triggers: new Set(["45182"]),
      },
    ],
  ]);
/** a triggered cast this close to the marker application belongs to the proc */
export const CRISIS_PROC_TRIGGER_TOL_MS = 1500;

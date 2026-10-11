/**
 * Talent effects on a cooldown that DB2 carries only as a dummy aura (server
 * script) and that the corpus shows the cooldown model missing — talent
 * impact audit 2026-09-26 (eval-private reports/talent-impact-audit-2026-09-26,
 * corpus-findings.md; all-ledger impossible-cast scan, new-season archive
 * every 10th file: 225,314 presses, 752 the model called impossible).
 *
 * Two shapes, both hand tables (registered in curatedIdRegistry), both keyed
 * by the TALENT so ownership is one lookup:
 *
 *  - FREE_RECAST_WINDOWS: after a press, the same spell can be pressed again
 *    within `windowS` ignoring its cooldown. The free press neither spends nor
 *    restarts the cooldown; while the window is open and unused the spell is
 *    available.
 *  - EVENT_COOLDOWN_REDUCTIONS: every successful cast of a trigger spell takes
 *    `seconds` off the remaining cooldown of the targets. The ready instant of
 *    a press is the fixed point R = press + cd − seconds × #triggers in
 *    (press, R); `remaining(t)` is monotone and reaches 0 exactly at R, so
 *    "available at t" ⇔ R ≤ t — no event after t can change the answer at t.
 */
import {
  CombatUnitSpec,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import { type ILogDatedNumber, logDatedNumberAt } from "../utils/logEra";

export interface IFreeRecastWindow {
  /** the spell whose press opens the window */
  spellId: string;
  windowS: number;
  note: string;
}

export const FREE_RECAST_WINDOWS: Readonly<Record<string, IFreeRecastWindow>> =
  {
    // Escape from Reality: "After you use Transcendence: Transfer, you can use
    // Transcendence: Transfer again within 10 sec, ignoring its cooldown."
    // DB2: dummy auras only (343249). Corpus: 83 presses of 119996 inside the
    // 45 s model, gaps 2.2–3.3 s; 91.6 % of monks take it.
    "394110": {
      spellId: "119996",
      windowS: 10,
      note: "Escape from Reality — Transcendence: Transfer again within 10 s",
    },
    // Save the Day (FT board item 1 follow-up, 2026-10-10): one more Leap of
    // Faith within 6 s of a press, ignoring its cooldown (the talent-coverage
    // join's tooltip row: "+1 free cast within 6s"). DB2: one dummy aura
    // (SpellEffect 1134708, aura 4, no mask — a server script).
    // Corpus, 605 new-season files, ranks from COMBATANT_INFO: 324 holder
    // rounds, 143 recast gaps, 39 inside the modelled cooldown and all of
    // them 2.0–6.0 s after the opener; 134 non-holder rounds, 21 gaps, 0
    // inside the cooldown. The press after a pair comes ≥ 64.9 s after the
    // OPENER on a 60 s cooldown — the cooldown stays anchored on it, this
    // table's shape. (Two holder gaps of 51 / 55 s stay unexplained.)
    // The row only exists on the ledger since Leap of Faith entered it for
    // every priest spec (`ENEMY_ONLY_SAVE_IDS`); before that these presses
    // were the healer gap-filler's and carried no cooldown.
    "440669": {
      spellId: "73325",
      windowS: 6,
      note: "Save the Day — Leap of Faith again within 6 s",
    },
  };

export interface IEventCooldownReduction {
  /** spells whose remaining cooldown drops */
  targets: readonly string[];
  /** the unit's own successful casts that drop it */
  triggerCastIds: readonly string[];
  /** A talent worded "each enemy hit by X": the unit's own damage rows of
   * these ids drop it too — one trigger per enemy hit (`eventTriggerTimesMs`). */
  triggerHitIds?: readonly string[];
  /** With `triggerHitIds`: at most this many hits of one use count (the
   * talent's "up to N sec" cap ÷ `seconds`). */
  maxHitsPerUse?: number;
  /** What one trigger gives back. Not always one number, so no reader takes
   * it from here: `eventTriggersFor` hands every trigger out with its own
   * seconds (`eventReductionSecondsAt`). */
  seconds: number | IHolderSeconds;
  note: string;
}

/** Seconds the game changed on a date (`ILogDatedNumber`, utils/logEra.ts —
 * read through `logDatedNumberAt`). */
export type ILogDatedSeconds = ILogDatedNumber;

/** Seconds that are not the same for every holder: `bySpec` for a holder of
 * that spec (the unit's COMBATANT_INFO spec id), `base` for everyone else. */
export interface IHolderSeconds {
  base: number;
  bySpec: Readonly<Partial<Record<string, ILogDatedSeconds>>>;
}

/**
 * Storm Conduit's Restoration hotfix: 4 s → 2 s per cast (the entry below has
 * the evidence). The day is a community source's, the hour is not known, so
 * the instant is the start of that calendar day in UTC — the way 12.1
 * go-live is a `Date.UTC` instant (`PATCH_121_GOLIVE_EPOCH_MS`), and asked
 * the same way (`logIsFrom`, utils/logEra.ts, which also says how far a log
 * timestamp can be from the true instant). The holders' files that decide
 * the two values are dated 08-13 … 08-16 and 08-18 18:54 … 08-22 in their own
 * local time, and a log from the evening of 08-17 in the Americas already
 * reads 2 s here.
 *
 * The same instant dates the talent's other number, the interrupted-cast
 * lockout (`KICK_LOCKOUT_VICTIM_MODIFIERS`, utils/kickLockout.ts), and that
 * half places the change more exactly: the old lockout is still what the log
 * shows at 2026-08-18 18:56 in an Oceanic file (UTC+10, so 08:56 UTC), the
 * new one from 2026-08-19 04:37 UTC on. The true instant is therefore at
 * least nine hours after this one, and a log of 08-18 before the hotfix went
 * live reads the NEW numbers here — the longer lockout and the smaller
 * give-back, the side on which the model claims less. Not moved: the day is
 * the ruling's wording and the hour is still not known.
 */
export const STORM_CONDUIT_HOTFIX_EPOCH_MS = Date.UTC(2026, 7, 18, 0, 0, 0);

/** Every shaman totem is Nature school (DB2 SpellMisc.SchoolMask 8 for all
 * of these at 12.1.5.69594), so Storm Conduit's "Nature totems" is every
 * totem. Stone Bulwark 108270 and Mana Tide 16191 are Nature too but have
 * zero corpus casts (observedSpellIdsGenerated) — left out, a dead id only
 * looks authoritative (Curated-List Completeness Rule). */
const SHAMAN_TOTEM_IDS = [
  "192058", // Capacitor Totem
  "108280", // Healing Tide Totem
  "98008", // Spirit Link Totem
  "204336", // Grounding Totem
  "8143", // Tremor Totem
  "2484", // Earthbind Totem
  "51485", // Earthgrab Totem
  "192077", // Wind Rush Totem
  "5394", // Healing Stream Totem
  "383013", // Poison Cleansing Totem
  "355580", // Static Field Totem
  "444995", // Surging Totem
  "1267068", // Stormstream Totem
] as const;

export const EVENT_COOLDOWN_REDUCTIONS: Readonly<
  Record<string, IEventCooldownReduction>
> = {
  // Storm Conduit (PvP, Elemental / Restoration): "Casting Lightning Bolt or
  // Chain Lightning reduces the cooldown of Astral Shift, Gust of Wind, Wind
  // Shear and your Nature totems by 1 sec." DB2 dummy 1000 ms. Corpus
  // (holders vs non-holders, shortest recast gap): Astral Shift 68.7 vs 90,
  // Healing Tide 77.9 vs 120, Spirit Link 132.6 vs 180, Capacitor 32.6 vs
  // 34.9; Lightning Lasso / Nature's Swiftness / Hex / Ascendance unchanged
  // (not named, not totems).
  //
  // RESTORATION holders get more than the tooltip's second, and the number
  // moved once — modelled BY THE DATE OF THE LOG (user ruling 2026-10-11):
  // 4 s per cast before 2026-08-18, 2 s from then on
  // (`STORM_CONDUIT_HOTFIX_EPOCH_MS`). Every other holder keeps DB2's 1 s.
  // FLAG (Game-Behaviour Rule — this is NOT three-way evidence, and stays
  // flagged in docs/talent-coverage-gaps.md §8):
  //  - DB2 has no leg for the seconds: a dummy effect of 1000 ms run by a
  //    server script, no class mask, no label, nothing per spec. What DB2
  //    does show is that the talent was changed then — its companion aura
  //    1223529 (interrupted-cast duration) went −65 → −40 between builds
  //    12.1.0.69382 and 69404.
  //  - The day and the two values are a community wiki's hotfix note
  //    (warcraft.wiki.gg/wiki/Storm_Conduit, read as a fetched summary, not
  //    the page itself): 2026-08-18, "Restoration 4 s → 2 s".
  //  - The corpus carries the numbers. 605 new-season files (fix-FT
  //    `n6_storm_conduit_fit.py` → `n6-stormConduit-fit-605.txt`): recast
  //    pairs of Healing Tide / Capacitor / Spirit Link / Astral Shift by
  //    holders, R = press + cd − s × #casts in (press, R), "early" = the
  //    next press more than 0.5 s before R. 11 files have recast pairs (78);
  //    in 9 of them (70 pairs) some pair is shorter than the unreduced
  //    cooldown, and the rest is about those. At 1 s: 28 early. Logs dated
  //    before 08-18 (4 files, 50 pairs): at 2 s 19 early, all in the two
  //    08-14 files, which need ≥ 3.56 / 4.26 s; at 4 s 1 early, by 2.4 s —
  //    unexplained. Logs dated 08-18 or later (5 files, 20 pairs): at 2 s 0
  //    early, the tightest file needs ≥ 1.95 s.
  //    The product's own predicate on five of those files
  //    (`ledgerImpossibleCastScan`, `cdAvailableAt` at each holder's recast
  //    of a target, 59 recasts): 27 pressed while the ledger said "not
  //    ready" at 1 s → 1 with the dated value; every other ledger entry in
  //    the same files 2 of 933 → 2 of 933.
  //
  // ELEMENTAL holders stay at DB2's 1 s — measured 2026-10-11 and too thin to
  // move (Game-Behaviour Rule 7: upward on corpus evidence only). The same
  // fit on every single-cooldown target, per spec and per side of the
  // cutover (fix-FT `scl_elemental_fit.ts` → `scl-elemental-fit-605.txt`):
  // the 605 files hold ONE Elemental holder — one player, three files of one
  // evening after the hotfix, 28 recast pairs, 5 of them shorter than the
  // unreduced cooldown. Four of the five fit 1 s, the press 0.4 – 1.4 s
  // after its ready instant. The fifth, a Gust of Wind 17.8 s after the last
  // on a 20 s cooldown with one Lightning Bolt in between, comes 1.2 s
  // before it: that one pair fits 2 s a cast — and equally 1 s a cast plus
  // 1 s for each of the two Lightning Bolt Overload hits that bolt made, a
  // second TRIGGER which Restoration's fit cannot speak to. No Elemental
  // holder before the hotfix. Control: 804 pairs of Elemental non-holders,
  // none shorter than the cooldown. Enhancement cannot take the talent (the
  // PvP talent pool; 0 of 113 unit-rounds in the corpus).
  // The same run on Restoration, all targets: before the cutover 281 pairs,
  // early at 2 s 52, at 4 s 3 (two Grounding Totem pairs of one file that
  // need 6.7 s a cast — some other source, not looked into — and the 2.4 s
  // Healing Tide one); since, 124 pairs, early at 1 s 2, at 2 s 0. Wind
  // Shear, Earthgrab, Grounding and Static Field are in those counts (Wind
  // Shear before: 32 pairs, early at 2 s 4, at 4 s 0).
  // Still not measured: Healing Stream / Stormstream Totem (charges, no
  // single cooldown to fit); a log older than 08-13 in the corpus — one
  // 07-27 Restoration match read outside it fits 4 s (29 pairs, early at 2 s
  // 5, at 4 s 0).
  "1217092": {
    targets: ["108271", "192063", "57994", ...SHAMAN_TOTEM_IDS],
    triggerCastIds: ["188196", "188443"],
    seconds: {
      base: 1,
      bySpec: {
        [CombatUnitSpec.Shaman_Restoration]: {
          cutoverEpochMs: STORM_CONDUIT_HOTFIX_EPOCH_MS,
          before: 4,
          since: 2,
        },
      },
    },
    note: "Storm Conduit — Lightning Bolt / Chain Lightning −1 s; Restoration −4 s before the 2026-08-18 hotfix, −2 s since (corpus + community date, FLAG)",
  },
  // Lethal Calibration (Survival, FT F20 2026-10-11): "Each enemy hit by
  // Wildfire Bomb reduces the cooldown of Boomstick by 2.0 sec, up to 10
  // sec." DB2 12.1.5.69594: SpellEffect 1272696 (aura 42, a server proc —
  // no trigger spell, no class mask) base 2000 ms, and 1285246 dummy 5 = the
  // cap in hits; the tooltip is `$s1/1000` and `$s1/1000*$s2`.
  // Corpus, 605 new-season files (ledgerImpossibleCastScan, talents from
  // COMBATANT_INFO): 4 holders, 32 Boomstick recast gaps, 19 under the
  // modelled 45 s (shortest 29.3 s) and all 10 "impossible" presses; 30
  // non-holders, 131 gaps, none under it (shortest 44.9 s). On three
  // holders' files (fix-FT `n6_event_fit.py`), R = press + 45 − 2 ×
  // #hits in (press, R): 0 of 31 recasts come before R, the tightest 0.0 /
  // 1.0 / 1.1 / 1.3 / 1.5 s after it; at 1 s per hit 9 come early, at 3 s
  // none lands within 2 s of R, and counting bomb CASTS fits no value.
  // A hit is a SPELL_DAMAGE row of the explosion (265157), or a SPELL_MISSED
  // one a shield soaked whole (ABSORB) — without those one recast is 2.0 s
  // early. IMMUNE misses are not counted (4 rows in the three files; none
  // decides a recast).
  "1262409": {
    targets: ["1261193"],
    triggerCastIds: [],
    triggerHitIds: ["265157"],
    maxHitsPerUse: 5,
    seconds: 2,
    note: "Lethal Calibration — each enemy hit by Wildfire Bomb −2 s (≤ 5 hits a bomb)",
  },
};

/** Hits of one use land together; rows of `triggerHitIds` further apart than
 * this are different uses (`maxHitsPerUse` counts per use). The Wildfire
 * Bomb's explosion rows sit within 0.1 s of each other and two bombs are at
 * least a global cooldown apart. */
export const EVENT_HIT_SAME_USE_MS = 1_000;

/**
 * When a reduction's triggers fired for `unit` (epoch ms, ascending) — the
 * ONE reading of "a trigger happened" for the ledger (`extractMajorCooldowns`),
 * the [RES] utility entries (`resUtilityCds`) and the interrupt cooldown
 * (`interruptReadyAtMs`), which all get it through `eventTriggersFor`: the
 * unit's own successful casts of `triggerCastIds`, plus, for a per-hit
 * talent, its damage rows of `triggerHitIds` (and the hits a shield soaked
 * whole, logged as an ABSORB miss), at most `maxHitsPerUse` per use.
 */
export function eventTriggerTimesMs(
  unit: Pick<ICombatUnit, "spellCastEvents" | "damageOut" | "missesOut">,
  r: Pick<
    IEventCooldownReduction,
    "triggerCastIds" | "triggerHitIds" | "maxHitsPerUse"
  >,
): number[] {
  const out = unit.spellCastEvents
    .filter(
      (e) =>
        e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
        r.triggerCastIds.includes(String(e.spellId)),
    )
    .map((e) => e.logLine.timestamp);
  const hitIds = r.triggerHitIds;
  if (hitIds?.length) {
    const hits = [
      ...unit.damageOut.filter(
        (e) =>
          e.logLine.event === LogEvent.SPELL_DAMAGE &&
          hitIds.includes(String(e.spellId)),
      ),
      ...(unit.missesOut ?? []).filter(
        (e) =>
          e.logLine.event === LogEvent.SPELL_MISSED &&
          e.missType === "ABSORB" &&
          hitIds.includes(String(e.spellId)),
      ),
    ]
      .map((e) => e.logLine.timestamp)
      .sort((a, b) => a - b);
    const cap = r.maxHitsPerUse ?? Number.POSITIVE_INFINITY;
    let useStart = Number.NEGATIVE_INFINITY;
    let counted = 0;
    for (const t of hits) {
      if (t - useStart > EVENT_HIT_SAME_USE_MS) {
        useStart = t;
        counted = 0;
      }
      if (counted < cap) {
        out.push(t);
        counted++;
      }
    }
  }
  return out.sort((a, b) => a - b);
}

/**
 * The seconds ONE trigger of `r` gives back to a holder of spec `holderSpec`
 * when it fires at `logEpochMs` — the one reading of "how much", next to
 * `eventTriggerTimesMs`'s "when".
 *
 * The date is the trigger's own log timestamp, not the match start: the three
 * readers all hold it (the interrupt cooldown is asked with a unit and an
 * instant, no combat), so none of them can ask with a different day, and a
 * round played across the cutover gives each cast what the game gave then.
 * It is the DR gate's reading — `drResetMsAt` is asked with the timestamp of
 * the CC being applied.
 *
 * A timestamp that is not a number is not a date and takes the CURRENT value
 * (`since`), never the old one (`logDatedNumberAt`, the reading the lockout
 * half shares): the dated value is a past exception, and for
 * the one entry that has one the current number is the smaller give-back —
 * the cooldown reads "not ready" for longer, so the model claims less was in
 * hand, not more. (A real trigger always has its timestamp; a fixture's
 * small synthetic epoch is a date long before any cutover, as it is for the
 * DR gate.)
 */
export function eventReductionSecondsAt(
  r: Pick<IEventCooldownReduction, "seconds">,
  holderSpec: string | undefined,
  logEpochMs: number,
): number {
  if (typeof r.seconds === "number") return r.seconds;
  const dated =
    holderSpec === undefined ? undefined : r.seconds.bySpec[holderSpec];
  if (!dated) return r.seconds.base;
  return logDatedNumberAt(dated, logEpochMs);
}

/** One trigger of an event reduction: when it fired and what it gave back. */
export interface IEventTrigger {
  atMs: number;
  seconds: number;
}

/**
 * Every trigger of `reductions` for `unit`, ascending — what the three
 * readers walk. "When" is `eventTriggerTimesMs`, "how much" is
 * `eventReductionSecondsAt` at that same instant for the unit's spec; a
 * reader has no other way to the seconds.
 */
export function eventTriggersFor(
  unit: Pick<
    ICombatUnit,
    "spec" | "spellCastEvents" | "damageOut" | "missesOut"
  >,
  reductions: readonly IEventCooldownReduction[],
): IEventTrigger[] {
  const holderSpec = unit.spec === undefined ? undefined : String(unit.spec);
  return reductions
    .flatMap((r) =>
      eventTriggerTimesMs(unit, r).map((atMs) => ({
        atMs,
        seconds: eventReductionSecondsAt(r, holderSpec, atMs),
      })),
    )
    .sort((a, b) => a.atMs - b.atMs);
}

export interface IOnInterruptCooldownReduction {
  /** the interrupt (its CAST id) whose own cooldown the talent shortens */
  spellId: string;
  /** seconds off the cooldown of a press that interrupted a cast */
  seconds: number;
  note: string;
}

/**
 * A third shape (FT-T11c, 2026-10-09): the talent shortens the interrupt's
 * OWN cooldown when the press interrupts a cast — nothing happens on a press
 * that stops nothing. Keyed by the talent, hand table, registered in
 * curatedIdRegistry.
 *
 * Three-way evidence (Game-Behaviour Rule), 605 new-season files, gaps
 * between two casts of the kick by one player in one round, split by
 * COMBATANT_INFO ownership × "the first press has a SPELL_INTERRUPT of the
 * player's within LANDED_PAIR_MS" (eval-private fix-FT
 * `t11c_onInterruptScan.ts`):
 *  - Coldthirst 378848 → Mind Freeze 47528, −3 s. DB2: the talent triggers
 *    378849, effect 292 on cooldown category 88 (the interrupt category
 *    Quick Witted's aura 341 names), −3000 ms. Corpus: holders after a
 *    landed kick 245 gaps, shortest 12.0 s, 40 under 14.5 s, none under
 *    11.5 s; holders after a kick that stopped nothing 108 gaps, 3 under
 *    14.5 s; non-holders 279 gaps, none under 14.5 s.
 *  - Light of the Sun 202918 → Solar Beam 78675, −15 s. DB2: dummy aura,
 *    base points 15 (tooltip: 15 sec when it interrupts the primary
 *    target). Corpus: holders after a landed beam 30 gaps, shortest 45.1 s,
 *    17 under 59.5 s, none under 44.5 s; holders otherwise 104 gaps, 2 under
 *    59.5 s; non-holders 9 gaps, shortest 61.4 s.
 * The five short gaps after a press with no interrupt line stay unexplained.
 */
export const ON_INTERRUPT_COOLDOWN_REDUCTIONS: Readonly<
  Record<string, IOnInterruptCooldownReduction>
> = {
  "378848": {
    spellId: "47528",
    seconds: 3,
    note: "Coldthirst — Mind Freeze −3 s when it interrupts",
  },
  "202918": {
    spellId: "78675",
    seconds: 15,
    note: "Light of the Sun — Solar Beam −15 s when it interrupts",
  },
};

/** Seconds a holder's press of `spellId` (the interrupt's cast id) gets back
 * when it interrupts a cast; 0 for everyone else. */
export function onInterruptReductionFor(
  spellId: string,
  holds: (talentSpellId: string) => boolean,
): number {
  let seconds = 0;
  for (const [talent, r] of Object.entries(ON_INTERRUPT_COOLDOWN_REDUCTIONS))
    if (r.spellId === spellId && holds(talent)) seconds += r.seconds;
  return seconds;
}

/** The free-recast window a spell has for a holder of these talents. */
export function freeRecastWindowFor(
  spellId: string,
  holds: (talentSpellId: string) => boolean,
): IFreeRecastWindow | undefined {
  for (const [talent, w] of Object.entries(FREE_RECAST_WINDOWS))
    if (w.spellId === spellId && holds(talent)) return w;
  return undefined;
}

/** Event reductions on `spellId` for a holder, flattened. */
export function eventReductionsFor(
  spellId: string,
  holds: (talentSpellId: string) => boolean,
): IEventCooldownReduction[] {
  return Object.entries(EVENT_COOLDOWN_REDUCTIONS)
    .filter(([talent, r]) => r.targets.includes(spellId) && holds(talent))
    .map(([, r]) => r);
}

/**
 * The effective cooldown of ONE press under event reductions: R − press,
 * where R is the fixed point described above. `triggers` are the holder's
 * (`eventTriggersFor`) on the press's clock — match seconds, any order —
 * each with the seconds it gave back.
 */
export function eventReducedCooldownSeconds(
  pressSeconds: number,
  cooldownSeconds: number,
  triggers: ReadonlyArray<{ atSeconds: number; seconds: number }>,
): number {
  if (!triggers.length || !(cooldownSeconds > 0)) return cooldownSeconds;
  const events = triggers
    .filter((g) => g.atSeconds > pressSeconds)
    .sort((a, b) => a.atSeconds - b.atSeconds);
  // walk forward: each trigger before the (current) ready instant pulls it in
  let ready = pressSeconds + cooldownSeconds;
  for (const e of events) {
    if (e.atSeconds >= ready) break;
    ready = Math.max(e.atSeconds, ready - e.seconds);
  }
  return ready - pressSeconds;
}

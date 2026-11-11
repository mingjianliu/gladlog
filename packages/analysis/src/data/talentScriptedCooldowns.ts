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
 *
 * Two more below, each with its own header: ON_INTERRUPT_COOLDOWN_REDUCTIONS
 * (the press's own cooldown, when it interrupts) and IDLE_COOLDOWN_CREDITS
 * (the time a spell sat ready comes off its next cooldown).
 */
import {
  CombatUnitSpec,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import { buffFullDurationForCaster } from "../utils/buffDuration";
import type { LogInstant } from "../utils/logEra";
import { logInstantOf } from "../utils/logEra";
import {
  type ILogDatedNumber,
  logDatedNumberAt,
  PATCH_1215_ZONE_BAND_TAKES,
} from "../utils/logEra";
import { isResyncBatchAt } from "../utils/resyncBatch";
import { PATCH_1215_GOLIVE_EPOCH_MS } from "../utils/talents";
import { type ISetBonusEventCredit, wearsSetBonus } from "./classSetBonuses";
import { spellEffectData } from "./spellEffectData";
import { spellSchoolMask } from "./spellSchools";

export interface IFreeRecastWindow {
  /** the spell whose press opens the window */
  spellId: string;
  windowS: number;
  note: string;
  /** A self aura the game applies for the window (its DB2 duration is
   * `windowS`): when the log carries it, the window is that aura's life —
   * applied after the press lands, removed in the free press's own
   * millisecond or on expiry — rather than `windowS` from the press. */
  windowAuraId?: string;
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
    // Strafing Run (fact8 class 1, D5–8, D28–29): "Deep Breath … can be cast
    // again within 18 sec of being used"; its buff 1266165 (18 s, DB2) reads
    // "Deep Breath can be cast for free". Scalecommander hero tree, so the
    // press is the override 433874 (OVERRIDE_VARIANTS_GENERATED) — no holder
    // press of 357210 in the wide sample. Corpus, 1-in-5 of the wide manifest:
    // 11 holder rounds, 56 presses all with a buff edge in the same ms, 27
    // free presses 1.71–9.19 s after the opener; a free press → next opener
    // gap as short as 39.45 s, so the cooldown stays on the opener, this
    // table's shape.
    "1266151": {
      spellId: "433874",
      windowS: 18,
      note: "Strafing Run — Deep Breath again within 18 s",
    },
    // Death's Arrival (Rogue, GH #176): "[Shadowstep][Grappling Hook] may be
    // used a second time within 3 sec (457333, DB2 3 s) with no cooldown, but
    // its total cooldown is increased by 5 sec" (aura 453, PvP multiplier 2:
    // the +10 s the model already prints, 55 s). Grappling Hook only — the
    // Shadowstep branch (Assassination) is a sub-45 s button. Corpus, 605
    // files: holders' gaps 0.87 / 1.03 / 1.18 / 2.09 / 2.20 / 3.09 s (6 of 19),
    // then 4.84 s on; 5 holder presses the model called impossible.
    // The window is the aura 457343 (DB2 3 s; GH #179 batch 3c): applied when
    // the hook lands, 0.55–0.84 s after the press (19/19 opener presses in the
    // 605 files); each of the 6 free presses has its REMOVED in its own
    // millisecond, logged right after the cast row; the 13 unused ones expire
    // 2.99–3.02 s after the APPLIED. Timed from the press, the 3.09 s gap
    // (2.43 s into the aura) fell outside the window.
    "454433": {
      spellId: "195457",
      windowS: 3,
      note: "Death's Arrival — Grappling Hook again within 3 s",
      windowAuraId: "457343",
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
  /** A talent worded "when X fades": the unit's own SPELL_SUMMON rows of
   * these ids drop it, `summonFadeMs` after the summon (`eventTriggerTimesMs`). */
  triggerSummonIds?: readonly string[];
  /** With `triggerSummonIds`: how long the summon lives (its DB2 duration). */
  summonFadeMs?: number;
  /** "Interrupting a spell with X": the unit's own SPELL_INTERRUPT rows of
   * these (interrupt-effect) ids. */
  triggerInterruptIds?: readonly string[];
  /** "When X is removed": an aura of these ids the unit applied ends —
   * SPELL_AURA_REMOVED or SPELL_AURA_REFRESH (a recast over a live one)
   * sourced by the unit, wherever it sits (the copy an enemy stole too). */
  triggerOwnAuraEndIds?: readonly string[];
  /** "Entering X": the unit's own buff of these ids applied on itself. */
  triggerSelfAuraAppliedIds?: readonly string[];
  /** A proc the log shows only as the unit's own SPELL_ENERGIZE row of these
   * ids (Ace Up Your Sleeve 394120: the 4 combo points and the reset are one
   * effect, logged as the energize on the press's own millisecond). */
  triggerEnergizeIds?: readonly string[];
  /** "Being attacked": a direct hit, a miss or a debuff applied on the unit
   * by anyone else (arena has no friendly fire) — periodic ticks excluded —
   * at most one trigger per `internalCooldownMs`, none while the unit's own
   * `notWhileSelfAuraId` buff is up (`hostileTakenTriggers`). */
  triggerHostileTaken?: {
    internalCooldownMs: number;
    notWhileSelfAuraId?: string;
    /** "Taking direct Physical damage": only hits whose school lies inside
     * this mask (a swing is Physical; a spell row reads the hit's own
     * school, else its DB2 one), only ABSORB misses (a hit a shield ate
     * whole — a dodge or an immunity is no damage taken), and no debuff
     * applications */
    damageSchoolMask?: number;
  };
  /** Bonuses on every give-back of this entry, added up: `pct` while the
   * unit's own `whileSelfAuraId` buff is up (Apotheosis +200 %), `pctPerRank`
   * per purchased rank of `talentId` (Light of the Naaru +10 %). */
  creditBonus?: {
    whileSelfAura?: { auraId: string; pct: number };
    perRank?: { talentId: string; pctPerRank: number };
  };
  /** A class set bonus that adds seconds to every give-back of this entry
   * for a unit wearing it (`wearsSetBonus`; Devastation 12.1 4pc on
   * Causality, GH #175 row 6). Not on a reset. */
  setBonus?: ISetBonusEventCredit;
  /** "Your Arcane abilities": the unit's own successful casts whose DB2
   * school mask (`spellSchoolMask`) shares a bit with this mask. */
  triggerCastSchoolMask?: number;
  /** "Each time X deals damage", for a channel: every periodic row of
   * `tickIds` — SPELL_PERIODIC_DAMAGE, or SPELL_PERIODIC_MISSED (a tick a
   * shield or an immunity ate) — on the TARGET of the unit's own cast of
   * `byCastIds` it belongs to, from that cast's millisecond up to the next
   * cast's (at most `windowMs`). A tick that also hits other units (Mass Disintegrate) is
   * one tick: their rows do not count. */
  triggerCastTargetTicks?: {
    byCastIds: readonly string[];
    tickIds: readonly string[];
    windowMs: number;
  };
  /** With `triggerHitIds`: every logged hit row is a trigger — separate
   * projectiles of one use, not "each enemy hit" (no one-credit-per-unit, no
   * cap). */
  hitsCountEachRow?: boolean;
  /** With `triggerHitIds`: "when it strikes at least N targets" — one
   * trigger per use, at the use's first hit, when the use hit this many
   * distinct units. */
  minHitsPerUse?: number;
  /** "Every N Rage you spend": each own successful cast gives back its
   * spent power ÷ `unitsPerSecond` (`powerSpendTriggers`). */
  triggerPowerSpend?: IPowerSpendTrigger;
  /** A baseline passive of these specs, owned without a talent (Restless
   * Blades, Outlaw). */
  ownedBySpecIds?: readonly string[];
  /** The talent that owns this row when its key is not that talent's id —
   * one talent with give-backs to several spells (Serendipity: Smite →
   * Chastise, Flash Heal → Serenity, Prayer of Healing → Sanctify). The
   * holder check, the registry and the coverage doc read
   * `eventReductionOwner`. */
  talentSpellId?: string;
  /** The row applies only to a holder of this talent as well (Ultimate
   * Serenity moves Sanctify's give-backs to Serenity). */
  requiresTalentId?: string;
  /** The row does not apply to a holder of this talent. */
  unlessTalentId?: string;
  /** With `seconds: Infinity`: the trigger gives back ONE charge — the
   * recharge under way keeps its progress — not every charge (Apotheosis
   * with Miracle Worker: 「获得一次圣言术的使用次数」). On a one-charge spell
   * it is the reset it says without the talent. */
  oneCharge?: true;
  /** "Using Sudden Death": the unit's own buff of `auraIds` removed (or a
   * dose of it) within `withinMs` of its own cast of `byCastIds` — an
   * expiry or a cast without the removal is no use. With `perStackOfAuraId`
   * the use gives `seconds` × that buff's stacks just before it (none → 0). */
  triggerAuraConsumed?: {
    auraIds: readonly string[];
    byCastIds: readonly string[];
    withinMs: number;
    perStackOfAuraId?: string;
  };
  /** "Each stack of X shattered": one trigger per stack of the unit's own
   * `auraIds` on another unit lost — a REMOVED_DOSE's drop, a REMOVED's
   * whole count — in the millisecond of one of the unit's own hit rows of
   * `atOwnHitIds` on that unit (`ownAuraStacksLostTimesMs`). A loss with no
   * such hit (the aura running out) shattered nothing. */
  triggerOwnAuraStacksLost?: {
    auraIds: readonly string[];
    atOwnHitIds: readonly string[];
  };
  /** "Mass Disintegrate … for each target struck": a use is the unit's own
   * cast of `byCastIds` that consumed `auraIds` within `withinMs` of it. One
   * trigger per distinct unit its rows of `hitIds` reached — damage, periodic
   * damage or a miss, from the cast to the next cast of `byCastIds` or
   * `windowMs`, at that unit's first row. */
  triggerBuffedUseTargets?: {
    auraIds: readonly string[];
    byCastIds: readonly string[];
    hitIds: readonly string[];
    withinMs: number;
    windowMs: number;
  };
  /** What one trigger gives back. Not always one number, so no reader takes
   * it from here: `eventTriggersFor` hands every trigger out with its own
   * seconds (`eventReductionSecondsAt`). `Infinity` is a RESET: the spell is
   * back at the trigger (every charge of a charge spell). */
  seconds: number | IHolderSeconds;
  note: string;
}

export interface IPowerSpendTrigger {
  /** `CombatUnitPowerType` of the spend (Rage 1, Combo Points 4, Runic
   * Power 6) */
  powerType: number;
  /** cost units (the log's own: tenths for Rage and Runic Power, whole
   * Combo Points) per second given back, by holder spec */
  unitsPerSecond: { base: number; bySpec?: Readonly<Record<string, number>> };
  /** casts that do not count, for these specs ("on attacks": Ignore Pain) */
  exclude?: { castIds: readonly string[]; specIds: readonly string[] };
  /** The log states a cast's cost BEFORE the caster's reductions; the game
   * gives back what was spent. A reduction applies to `castIds`, while the
   * caster's `whileAuraId` buff is up and / or for a holder of `talentId`
   * (holder unknown → applied: the smaller give-back). */
  /** While one of the caster's own `whileAuraIds` buffs is up at the spend,
   * the give-back is `pct` % larger (DB2 aura 108 on the talent's own class
   * mask: Triple Threat / Jackpot +30 % on Restless Blades). */
  boosts?: ReadonlyArray<{ whileAuraIds: readonly string[]; pct: number }>;
  /** A finisher a proc made free logs no cost of `powerType`; the game
   * counts it as the maximum (Outlaw 12.1 4pc Fang Strike 1301405: 「your
   * next Dispatch … as if you spent the maximum combo points」, GH #198,
   * user ruling 2026-11-07 — Restless Blades too). A press of `castIds`
   * with the unit's own `consumedAuraId` removed within `withinMs` of it
   * spends the `powerType` maximum its nearest advanced reading states. */
  freeSpendAsMax?: {
    castIds: readonly string[];
    consumedAuraId: string;
    withinMs: number;
  };
  costReductions?: ReadonlyArray<{
    castIds: readonly string[];
    pct?: number;
    flat?: number;
    whileAuraId?: string;
    talentId?: string;
  }>;
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

/** Devastation 12.1 4pc 1296640 (set 2058, spec 1467, 4 pieces; GH #175
 * row 6): 「Causality reduces the remaining cooldown of your empower spells
 * by an additional ${$s1/-1000}.1 sec each time the effect occurs」. Effects
 * 0 and 1 are aura 219 base −100 on SpellLabel 6673, a label only Causality
 * 375777 carries, misc 3 / 12 (its effect 0 / effect 1 points: the
 * Disintegrate and the Pyre give-back), × PvpMultiplier 0.5 = 0.05 s more
 * per trigger. */
const DEVASTATION_4PC_CAUSALITY: ISetBonusEventCredit = {
  bonusSpellId: "1296640",
  itemSetId: "2058",
  pieces: 4,
  specs: ["1467"],
  addSeconds: 0.05,
};

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
  // Cull the Weak (fact8 class 6, D21 / D48): "Casting Unstable Affliction or
  // Seed of Corruption reduces the cooldown of Dark Harvest by 1.5 sec." DB2
  // 12.1.5.70575: 1259886 effect 0, aura 4 (a dummy, no mask), base 1500 ms,
  // PvpMultiplier 1. Corpus, every 4th file of the wide manifest, press gaps of
  // one unit in one round: 38 on holders, lowest 47.14 s, 13 below 59.5 s on
  // the bare 60; next press − (press + 60 − 1.5 × casts) lowest 0.0 / 0.1 /
  // 0.41 s, 0 of 38 below −0.5 s. 22 gaps on non-holders, lowest 59.98 s: the
  // talent is what splits them. No Seed cast fell inside a holder's gap in
  // that sample; Seed is the tooltip's half.
  "1259886": {
    targets: ["1257052"],
    triggerCastIds: ["1259790", "27243"],
    seconds: 1.5,
    note: "Cull the Weak — Unstable Affliction / Seed of Corruption −1.5 s",
  },
  // Wingleader (fact8 class 1, D7 / D8 / D28 / D29): "Mass Disintegrate reduces
  // the remaining cooldown of Deep Breath by 1.0 sec for each target struck."
  // DB2 12.1.5.70391: SpellEffect 1135533 (aura 4, a dummy, no mask) base
  // 1000 ms; 1135534 base 1500 ms is the Breath of Eons half ("441206:eons"
  // below). Ranks from COMBATANT_INFO: every Strafing Run holder in the wide
  // manifest took it (57 distinct rounds, 106 opener pairs), so there is no
  // control group and none is required. R = opener
  // + 60 − #targets of its buffed Disintegrates: 0 of 106 next openers come
  // more than 0.5 s before R, the tightest 0.0 / 0.0 / 0.17 / 0.36 s after it.
  // Every other reading fails: 1 s per use 60 of 106, players only 30, a cap
  // of 3 targets per use 12. A miss counts (shields, immunities).
  "441206": {
    targets: ["433874"],
    triggerCastIds: [],
    triggerBuffedUseTargets: {
      auraIds: ["436336"], // Mass Disintegrate
      byCastIds: ["356995"], // Disintegrate
      hitIds: ["356995"],
      withinMs: 250,
      windowMs: 3600,
    },
    seconds: 1,
    note: "Wingleader — Deep Breath −1 s per target struck by a Mass Disintegrate",
  },
  // Wingleader's Augmentation half (fact10 D1 / D16): "Mass Eruption reduces
  // the remaining cooldown of Breath of Eons by 1.5 sec for each target
  // struck." DB2 12.1.5.70391: SpellEffect 1135534 (aura 4, a dummy, no
  // mask) base 1500 ms. The use is the unit's own Eruption that consumed
  // Mass Eruption; its hits are Eruption's and the extra targets' row.
  // Every Augmentation BoE holder in the corpus and the downloaded logs took
  // it (37 press pairs, 18 files; ranks from COMBATANT_INFO). R = press + 120
  // − 1.5 × #targets of its Mass Eruptions (Time Skip's rate window on the
  // clock): 0 of 37 next presses more than 0.5 s before R, the tightest
  // 0.55 / 1.46 / 1.70 s after it. 1 s per target fails 9, Eruption's own
  // row without 438653 fails 13, no reduction 33.
  "441206:eons": {
    talentSpellId: "441206",
    targets: ["403631"],
    triggerCastIds: [],
    triggerBuffedUseTargets: {
      auraIds: ["438588"], // Mass Eruption
      byCastIds: ["395160"], // Eruption
      hitIds: ["395160", "438653"],
      withinMs: 250,
      windowMs: 3600,
    },
    seconds: 1.5,
    note: "Wingleader — Breath of Eons −1.5 s per target struck by a Mass Eruption",
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
  // Cenarius' Guidance (Restoration, GH #154, 2026-10-20): "During
  // Incarnation: Tree of Life, you summon a Grove Guardian every 10 sec. The
  // cooldown of Incarnation: Tree of Life is reduced by 5.0 sec when Grove
  // Guardians fade." DB2 12.1.5.70391: 393381 dummy −5000 (no class mask, a
  // server script), 393418 the 10 s summon pulse; a Grove Guardian (102693)
  // lives 8 s. Every guardian counts — pressed, summoned by the pulse, or by
  // Reforestation's free Tree of Life. The fade is read as summon + 8 s: a
  // killed guardian may fade sooner, never later, so the model's ready
  // instant is never before the game's. 98 % of Restoration Druids take it.
  // Corpus, 2,000 new-season files (every 3rd of the 08-28 manifest), 317
  // Tree of Life recast pairs (form re-shifts dropped): the bare 180 s holds
  // for few of them; 180 − 5 × (guardians summoned in the gap) − 15 ×
  // (holds Control of the Dream, below) holds for 307, the worst miss 9.1 s.
  // Ancient of Lore (473909) is the PvP talent that replaces Tree of Life
  // (PvpTalent 5739 OverridesSpellID 33891, the same class mask 0x10800),
  // and the script follows the slot (GH #179, 2026-11-03): 13 files, 59
  // recast pairs on its own 90 s, 35 come back early by up to 31 s; with
  // Guidance's 5 s per faded guardian and Control of the Dream's credit 2
  // are left, at 2.7 and 3.9 s — inside a guardian killed before its 8 s.
  "393371": {
    targets: ["33891", "473909"],
    triggerCastIds: [],
    triggerSummonIds: ["102693"],
    summonFadeMs: 8000,
    seconds: 5,
    note: "Cenarius' Guidance — Incarnation: Tree of Life −5 s as each Grove Guardian fades",
  },
  // Cooldown mastery round, 2026-10-20 (eval-private runs/cd-mastery-2026-10-20
  // research/*.md — DB2 12.1.5.70391, the 2,240-file ledger scan, raw-log
  // replays). Every row below is a dummy (server script) in DB2: the value
  // is the tooltip's, the trigger the log's.
  //
  // Offering from Beyond (Farseer, Elemental): "When an Ancestor is called,
  // they reduce the cooldown of Stormkeeper by 3 sec" — dummy −3 000 on the
  // Elemental branch (`$?a137040`; Restoration's −2 s is Riptide's, not
  // Stormkeeper's). Each Ancestor is the shaman's SPELL_SUMMON 445624.
  // Holders 706 of 927 Stormkeeper recasts under the 60 s model, non-holders
  // 0 of 79; replay (2 files, 233 summons): 30 impossible → 0 at 3 s, 12 at 2.
  "443451": {
    targets: ["191634"],
    triggerCastIds: [],
    triggerSummonIds: ["445624"],
    seconds: 3,
    note: "Offering from Beyond — Stormkeeper −3 s per Ancestor called",
  },
  // Savage Momentum (PvP, Feral): "Interrupting a spell with Skull Bash
  // reduces the remaining cooldown of Tiger's Fury, Survival Instincts and
  // Dash by 10 sec" — dummy 10. The interrupt row is SPELL_INTERRUPT 93985
  // (not the cast id 106839). Survival Instincts: holders 4 of 6 recasts
  // under the model, non-holders 0 of 13; replay 1 → 0.
  "205673": {
    targets: ["61336", "5217", "1850"],
    triggerCastIds: [],
    triggerInterruptIds: ["93985"],
    seconds: 10,
    note: "Savage Momentum — Skull Bash interrupt: Tiger's Fury / Survival Instincts / Dash −10 s",
  },
  // Energy Transfer (Monk): "Successfully interrupting an enemy reduces the
  // cooldown of Paralysis and Roll by 5 sec" — dummy −5 000. Windwalker
  // holders 27 of 303 Paralysis recasts under the 30 s model (the 13
  // impossible ones 24.4–27.2 s: one interrupt each), non-holders 0 of 1,121.
  "450631": {
    targets: ["115078", "109132"],
    triggerCastIds: [],
    triggerInterruptIds: ["116705"],
    seconds: 5,
    note: "Energy Transfer — Spear Hand Strike interrupt: Paralysis / Roll −5 s",
  },
  // Lunation (Elune's Chosen, Balance): "Your Arcane abilities reduce the
  // cooldown of Fury of Elune by 1.5 sec" — dummy −1 500. "Arcane" read as
  // the cast's DB2 school having the Arcane bit (0x40; Astral 0x48 counts).
  // Holders 141 of 161 recasts under the model, non-holders 0 of 137;
  // replay (242 triggering casts): 14 impossible → 0 at 1.5 s, 8 at 1 s.
  "429539": {
    targets: ["202770"],
    triggerCastIds: [],
    triggerCastSchoolMask: 0x40,
    seconds: 1.5,
    note: "Lunation — Fury of Elune −1.5 s per Arcane-school cast",
  },
  // Spellfrost Teachings (Spellslinger, Frost): "Direct damage from Frost
  // Splinters reduces the cooldown of Frozen Orb by 0.30 sec" — dummy 300.
  // Every Frost Splinter (443722) row is a trigger — damage, or a hit a
  // shield soaked whole; separate projectiles, no per-enemy dedupe (the
  // fit needs up to 0.86 s a hit without the absorbed rows). Holders 92 %
  // of recasts under the 60 s model, shortest gap 22.0 s; replay (8 files,
  // 180 recasts): 165 early → 2 at 0.29 s → 0 at 0.30 s, every round's
  // tightest needs ≤ 0.295 s.
  // GH #176: Concentrated Coolness turns Frozen Orb into 198149, which the
  // row missed (605: 7 presses of 198149 the model called impossible, each
  // inside 60 − 0.3 × its hits).
  "444986": {
    targets: ["84714", "198149"],
    triggerCastIds: [],
    triggerHitIds: ["443722"],
    hitsCountEachRow: true,
    seconds: 0.3,
    note: "Spellfrost Teachings — Frozen Orb −0.3 s per Frost Splinter hit",
  },
  // Rumbling Earth (Warrior): "when it strikes at least 3 targets its
  // cooldown is reduced by 15 sec" — dummies 3 and 15. A strike counts a
  // unit's SPELL_DAMAGE or whole-absorb miss of Shockwave 46968 (pets
  // count, immune misses are not needed). Arms holders' floor is exactly
  // 25.0 s (= 40 − 15), holders whose Shockwave hit fewer than 3 never
  // under 40.2; 41 of 41 reduced pairs follow a 3+ hit.
  "275339": {
    targets: ["46968"],
    triggerCastIds: [],
    triggerHitIds: ["46968"],
    minHitsPerUse: 3,
    seconds: 15,
    note: "Rumbling Earth — Shockwave −15 s when it strikes 3+ targets",
  },
  // Anger Management (Warrior): "Every 20 Rage you spend [on attacks]
  // reduces the remaining cooldown on Avatar and Colossus Smash /
  // Recklessness / Shield Wall by 1 sec" — three dummies of 20, one per spec
  // branch; Fury's carries PvpMultiplier 0.5 → 10 Rage a second in the
  // arena (at 20, 190 of 194 Fury recast pairs break; at 10, none). The log
  // states Rage ×10 and the cost before the caster's reductions; the game
  // gives back what was spent (Battlelord's Mortal Strike −33 %,
  // Efficiency's Slam −25 %, Rampaging Berserker's Rampage −15 Rage during
  // Recklessness): with the stated cost no Fury pair comes within 2.8 s of
  // ready, with the spent cost the tightest is 0.81 s, 0 violations.
  // Colossus Smash holders 76.5 % of recasts under the 45 s model,
  // non-holders 0 of 24; Arms replay 191 pairs, 0 violations, 32 within
  // 1 s. Arms / Fury: Ignore Pain is no attack.
  "152278": {
    targets: ["107574", "167105", "1719", "871"],
    triggerCastIds: [],
    triggerPowerSpend: {
      powerType: 1,
      unitsPerSecond: { base: 200, bySpec: { "72": 100 } },
      exclude: { castIds: ["190456", "1277297"], specIds: ["71", "72"] },
      costReductions: [
        { castIds: ["12294"], pct: 33, whileAuraId: "386631" },
        { castIds: ["1464"], pct: 25, talentId: "1261047" },
        {
          castIds: ["184367"],
          flat: 150,
          whileAuraId: "1719",
          talentId: "1269309",
        },
      ],
    },
    seconds: 0,
    note: "Anger Management — Rage spent: Avatar / Colossus Smash / Recklessness / Shield Wall −1 s per 20 (Fury 10 in PvP)",
  },
  // Unrelenting Onslaught (Slayer, 444780): "Using Sudden Death causes you
  // to … reduce the cooldown of Bladestorm by 5 sec … per stack of
  // Executioner you have" — dummy 5; it also replaces Bladestorm 227847
  // with 446035 (aura 332), so the 446035 row is the holders'. A use is the
  // Sudden Death buff (Arms 52437, Fury 280776) removed within 0.15 s of the
  // unit's own Execute (163201 / 281000 / 280735 / 5308); the stacks are
  // Executioner 445584's just before. Holders 1,640 of 1,712 recasts under
  // the 90 s model, non-holders (227847) 0 of 130. Arms replay: flat 5 s a
  // use breaks 107 of 130 pairs, 5 s × stacks 0 of 129 (21 within 1 s).
  // Fury's buff and Execute ids are DB2's, not replayed (61 entries).
  "444780": {
    targets: ["446035"],
    triggerCastIds: [],
    triggerAuraConsumed: {
      auraIds: ["52437", "280776"],
      byCastIds: ["163201", "281000", "280735", "5308"],
      withinMs: 150,
      perStackOfAuraId: "445584",
    },
    seconds: 5,
    note: "Unrelenting Onslaught — Bladestorm −5 s per Executioner stack when Sudden Death is used",
  },
  // Barrier Diffusion (Frost, 455428): "When Ice Barrier is removed, its
  // remaining cooldown is reduced by 5 sec" — dummy 5 000, PvpMultiplier
  // 0.5 → 2.5 s in the arena (5 s runs ahead of the game). Ice Barrier has
  // two charges: the give-back goes to the charge recharging
  // (`IChargeEffects`). Three things are a removal: the barrier fading, a
  // recast over a live one (REFRESH), and the copy an enemy Spellsteal'd
  // fading on the thief — all aura rows the mage sourced. Replay (12 files,
  // 361 recasts): static 115 early, fades only 18, + refreshes 11, + the
  // stolen copy 0; at 2 s 44. Holders 29 % of recasts under the model,
  // non-holders 0 of 188. Blazing / Prismatic Barrier, the same talent (GH
  // #183, 2026-11-03): 52 of 52 Arcane mages hold it; Prismatic replay on
  // 605-file subsets, dev 53 of 188 presses early → 0, hold-out 67 of 259 →
  // 1 (a barrier with no REMOVED row); at 5 s the closest presses sit
  // 4.99–5.01 s past it, one give-back too many. Blazing is never early
  // there — on the tooltip alone. Each spec has its one barrier.
  "455428": {
    targets: ["11426", "235313", "235450"],
    triggerCastIds: [],
    triggerOwnAuraEndIds: ["11426", "235313", "235450"],
    seconds: 2.5,
    note: "Barrier Diffusion — Ice / Blazing / Prismatic Barrier −2.5 s (PvP) each time a barrier is removed",
  },
  // Protector of the Frail (Discipline, 373035): "Power Word: Shield reduces
  // the cooldown of Pain Suppression by 3 sec" — effect 1, dummy −3 000 (its
  // extra charge is a masked row, already modelled). The press is Power
  // Word: Shield 17 or, upgraded by Master the Darkness, Void Shield
  // 1253593. Pain Suppression has two charges (`IChargeEffects`). Replay (3
  // files): PW:S only still 13–18 s short; with Void Shield 0 violations,
  // the tightest presses 0.1 / 0.6 s after the predicted instant.
  "373035": {
    targets: ["33206"],
    triggerCastIds: ["17", "1253593"],
    seconds: 3,
    note: "Protector of the Frail — Pain Suppression −3 s per Power Word: Shield / Void Shield",
  },
  // Driven to Madness (PvP, Shadow, 199259): "While Voidform is not active,
  // being attacked reduces the cooldown of Voidform by 3 sec" — a proc
  // (aura 42 → 199260, effect 77, −3 000) with ProcCategoryRecovery 1 000 ms
  // and a proc mask of taken melee / ranged / spell / negative magic (no
  // periodic). Voidform's buff is 194249. Holders 742 gaps, p5 55.9 s on a
  // 120 s model; non-holders 42 gaps, p5 121.1. Replay (7 files, 39 pairs):
  // damage + misses + debuffs 0 violations; damage alone 1, by 11.1 s.
  "199259": {
    targets: ["228260"],
    triggerCastIds: [],
    triggerHostileTaken: {
      internalCooldownMs: 1000,
      notWhileSelfAuraId: "194249",
    },
    seconds: 3,
    note: "Driven to Madness — Voidform −3 s per attack taken (≤ 1 a second, not during Voidform)",
  },
  // GH #183 (2026-11-03): the [PRESS] whitelist's buttons under 45 s, each
  // replayed on 605-file subsets (eval-private runs/g8-183-2026-11-04,
  // research/evoker + research/cd4; dev and a disjoint hold-out, "early" =
  // the next press > 0.5 s before the modelled ready instant).
  //
  // Impish Instincts (PvP, Warlock, 409835): "Taking direct Physical damage
  // reduces the cooldown of Demonic Circle by 3 sec. Can only occur once
  // every 5 sec." DB2: aura 42 bp −3000, ProcCategoryRecovery 5000, proc
  // mask 680 (taken melee / ranged). Physical direct hits — swings, Physical
  // spell rows, and the ones a shield ate whole. Holders 107 of 249 early
  // (dev) / 91 of 207 (hold-out) under the base model, non-holders 1 of 8 /
  // 0 of 14; replay 9 / 0. Any school / every miss type cut it further but
  // thin the pile of presses landing right at the ready instant (13 / 9 →
  // 1–5), so DB2's numbers.
  "409835": {
    targets: ["48020"],
    triggerCastIds: [],
    triggerHostileTaken: { internalCooldownMs: 5000, damageSchoolMask: 1 },
    seconds: 3,
    note: "Impish Instincts — Demonic Circle: Teleport −3 s per direct Physical hit taken (≤ 1 per 5 s)",
  },
  // Causality (Devastation, 375777): "Disintegrate reduces the remaining
  // cooldown of your empower spells by 0.50 sec each time it deals damage.
  // Pyre reduces the remaining cooldown of your empower spells by 0.40 sec
  // per enemy struck, up to 2.0 sec." DB2: dummies bp −500 / −400,
  // PvpMultiplier 1 (no mask or label: the tooltip is the coverage leg).
  // 29 of 29 dev / 24 of 24 hold-out Devastation units hold it. A tick is
  // the cast target's periodic row, absorbed or immuned ones too; a Mass
  // Disintegrate tick on 3–4 units is one (crediting every row made a Fire
  // Breath "ready" 4.8 s before two "Not yet recovered" failures).
  // Replay: Eternity Surge dev 98 of 141 early → 1, hold-out 73 of 89 → 0;
  // Fire Breath 105 of 158 → 2, 68 of 84 → 0. At 0.5 s 13 dev / 11
  // hold-out presses land within 0.5 s of the ready instant; at 0.55 s that
  // pile is gone, at 0.45 s 15 / 8 come early.
  "375777": {
    targets: ["357208", "382266", "359073", "382411"],
    triggerCastIds: [],
    triggerCastTargetTicks: {
      byCastIds: ["356995"],
      tickIds: ["356995"],
      windowMs: 6000,
    },
    seconds: 0.5,
    setBonus: DEVASTATION_4PC_CAUSALITY,
    note: "Causality — Fire Breath / Eternity Surge −0.5 s per Disintegrate tick",
  },
  "375777:pyre": {
    talentSpellId: "375777",
    targets: ["357208", "382266", "359073", "382411"],
    triggerCastIds: [],
    triggerHitIds: ["357212"],
    maxHitsPerUse: 5,
    seconds: 0.4,
    setBonus: DEVASTATION_4PC_CAUSALITY,
    note: "Causality — Fire Breath / Eternity Surge −0.4 s per enemy struck by Pyre (≤ 2 s)",
  },
  // Chaotic Transformation (Havoc, 388112): "When you activate
  // Metamorphosis, the cooldowns of Blade Dance and Eye Beam are
  // immediately reset." The press is logged as the landing 200166 (191427
  // never is); entering demon form through Demonic (Eye Beam itself) is no
  // reset. Every Eye Beam pair under the 20 s floor has a 200166 between
  // (dev 87, hold-out 64). Abyssal Gaze 452497 shares Eye Beam's category.
  // Every Havoc unit holds it — no control group, none required.
  "388112": {
    targets: ["198013", "452497"],
    triggerCastIds: ["200166"],
    seconds: Number.POSITIVE_INFINITY,
    note: "Chaotic Transformation — Metamorphosis resets Eye Beam",
  },
  // Time Walk (Mage, 1244087): "Alter Time resets the cooldown of Blink and
  // Shimmer when you return." Dummy only. The return is the end of the
  // mage's own Alter Time aura 342246 (recast or expiry; keyed on the 342247
  // recast instead 46 dev / 17 hold-out stay early). Every charge comes
  // back (one charge leaves 11 / 4). Shimmer holders 132 of 289 early under
  // the base model, non-holders 1 of 29; replay dev 129 of 413 → 4,
  // hold-out 63 of 178 → 1.
  "1244087": {
    targets: ["212653", "1953"],
    triggerCastIds: [],
    triggerOwnAuraEndIds: ["342246"],
    seconds: Number.POSITIVE_INFINITY,
    note: "Time Walk — Alter Time's return resets Blink / Shimmer",
  },
  // HOLY WORD: CHASTISE (Holy Priest; research/holyword.md — 21 clean raw
  // files replayed: 221 of 497 Chastise presses early → 0). Its static
  // cooldown is right only once the 12.1.0 talent map is used for 12.1.0
  // logs (`talentsOf`, utils/talents.ts: Holy Celerity / Ultimate Serenity
  // traded definitions at 12.1.5).
  // Serendipity (Holy baseline 63733): "Smite / Holy Nova reduce the
  // cooldown of Holy Word: Chastise by 4 sec" — 88625 effect 1 bp 4
  // (tooltip `$?s63733`). The replay's slack test: 3 s leaves 5 presses
  // before ready, 5 s none within 0.5 s of it, 4 s a tight pile and 0 early.
  "63733": {
    targets: ["88625"],
    triggerCastIds: ["585", "132157"],
    ownedBySpecIds: ["257"],
    seconds: 4,
    creditBonus: {
      whileSelfAura: { auraId: "200183", pct: 200 },
      perRank: { talentId: "196985", pctPerRank: 10 },
    },
    note: "Serendipity — Smite / Holy Nova: Holy Word: Chastise −4 s",
  },
  // Voice of Harmony (390994; 3,014 of 3,014 Holy rows): Holy Fire →
  // Chastise, 4 × PvpMultiplier 0.5 = 2 s (at 4 s the earliest press lands
  // 2.0 s after "ready", none tight; at 2 s, 10 within ±0.5 s of it).
  "390994": {
    targets: ["88625"],
    triggerCastIds: ["14914"],
    seconds: 2,
    creditBonus: {
      whileSelfAura: { auraId: "200183", pct: 200 },
      perRank: { talentId: "196985", pctPerRank: 10 },
    },
    note: "Voice of Harmony — Holy Fire: Holy Word: Chastise −2 s (PvP)",
  },
  // (Both carry Apotheosis's "increasing the cooldown reductions to your Holy
  // Words by 200 %" while its buff 200183 is up — +100 % leaves 125 early
  // presses, +200 % 13 — and Light of the Naaru's +10 % a rank, added to it.)
  //
  // HOLY WORD: SERENITY 2050 / SANCTIFY 34861 (GH #176, 2026-11-02: an
  // off-list press line needs their cooldown; research/holyword.md M2–M7,
  // the 21-file replay: Serenity 944 → 12 of 1,235 presses early, Sanctify
  // 58 → 0 of 166). Tooltips, 12.1.5.70575 zhCN:
  //  - Serendipity 63733 「快速治疗会使圣言术：静的冷却时间缩短$2050s2秒。
  //    治疗祷言会使圣言术：灵的冷却时间缩短$34861s3秒」, 6 s each; Serenity's
  //    own 「快速治疗$?a1246517[或治疗祷言][]」 — Ultimate Serenity 1246517
  //    「原本影响圣言术：灵的天赋效果现在改为影响圣言术：静」 sends Prayer of
  //    Healing's to Serenity (a holder never presses Sanctify: 262 of 340
  //    mapped "US only" August units did, the era swap, research §1).
  //    Benediction 1262763 is the upgraded Flash Heal (M2).
  //  - Voice of Harmony 390994 「愈合祷言$?S120517&?a1246517[和施放光晕][]会
  //    使圣言术：静的冷却时间缩短$s2秒。$?S120517&!?a1246517[光晕会使圣言术：灵
  //    的冷却时间缩短$s1秒。][]」, 4 s each (PvpMultiplier 1); a Halo is the
  //    holder's own 120517 APPLIED (M6).
  //  - Energy Cycle 453828 (Archon) 「消耗圣光涌动使得圣言术：静 / 灵的冷却时间
  //    降低4秒」 by Ultimate Serenity; Surge of Light 114255 spent by a Flash
  //    Heal / Benediction / Prayer of Healing (M7, 37 holder rows).
  // Each carries Apotheosis's +200 % and Light of the Naaru's +10 % a rank
  // (M9 / M10, the Chastise rows' bonus).
  "63733:2050": {
    talentSpellId: "63733",
    targets: ["2050"],
    triggerCastIds: ["2061", "1262763"],
    ownedBySpecIds: ["257"],
    seconds: 6,
    creditBonus: {
      whileSelfAura: { auraId: "200183", pct: 200 },
      perRank: { talentId: "196985", pctPerRank: 10 },
    },
    note: "Serendipity — Flash Heal / Benediction: Holy Word: Serenity −6 s",
  },
  "63733:34861": {
    talentSpellId: "63733",
    targets: ["34861"],
    triggerCastIds: ["596"],
    ownedBySpecIds: ["257"],
    unlessTalentId: "1246517",
    seconds: 6,
    creditBonus: {
      whileSelfAura: { auraId: "200183", pct: 200 },
      perRank: { talentId: "196985", pctPerRank: 10 },
    },
    note: "Serendipity — Prayer of Healing: Holy Word: Sanctify −6 s",
  },
  "63733:2050:us": {
    talentSpellId: "63733",
    targets: ["2050"],
    triggerCastIds: ["596"],
    ownedBySpecIds: ["257"],
    requiresTalentId: "1246517",
    seconds: 6,
    creditBonus: {
      whileSelfAura: { auraId: "200183", pct: 200 },
      perRank: { talentId: "196985", pctPerRank: 10 },
    },
    note: "Serendipity + Ultimate Serenity — Prayer of Healing: Holy Word: Serenity −6 s",
  },
  "390994:2050": {
    talentSpellId: "390994",
    targets: ["2050"],
    triggerCastIds: ["33076"],
    seconds: 4,
    creditBonus: {
      whileSelfAura: { auraId: "200183", pct: 200 },
      perRank: { talentId: "196985", pctPerRank: 10 },
    },
    note: "Voice of Harmony — Prayer of Mending: Holy Word: Serenity −4 s",
  },
  "390994:34861:halo": {
    talentSpellId: "390994",
    targets: ["34861"],
    triggerCastIds: [],
    triggerSelfAuraAppliedIds: ["120517"],
    unlessTalentId: "1246517",
    seconds: 4,
    creditBonus: {
      whileSelfAura: { auraId: "200183", pct: 200 },
      perRank: { talentId: "196985", pctPerRank: 10 },
    },
    note: "Voice of Harmony — Halo: Holy Word: Sanctify −4 s",
  },
  "390994:2050:halo": {
    talentSpellId: "390994",
    targets: ["2050"],
    triggerCastIds: [],
    triggerSelfAuraAppliedIds: ["120517"],
    requiresTalentId: "1246517",
    seconds: 4,
    creditBonus: {
      whileSelfAura: { auraId: "200183", pct: 200 },
      perRank: { talentId: "196985", pctPerRank: 10 },
    },
    note: "Voice of Harmony + Ultimate Serenity — Halo: Holy Word: Serenity −4 s",
  },
  "453828": {
    targets: ["34861"],
    triggerCastIds: [],
    triggerAuraConsumed: {
      auraIds: ["114255"],
      byCastIds: ["2061", "1262763", "596"],
      withinMs: 300,
    },
    unlessTalentId: "1246517",
    seconds: 4,
    creditBonus: {
      whileSelfAura: { auraId: "200183", pct: 200 },
      perRank: { talentId: "196985", pctPerRank: 10 },
    },
    note: "Energy Cycle — Surge of Light spent: Holy Word: Sanctify −4 s",
  },
  "453828:2050": {
    talentSpellId: "453828",
    targets: ["2050"],
    triggerCastIds: [],
    triggerAuraConsumed: {
      auraIds: ["114255"],
      byCastIds: ["2061", "1262763", "596"],
      withinMs: 300,
    },
    requiresTalentId: "1246517",
    seconds: 4,
    creditBonus: {
      whileSelfAura: { auraId: "200183", pct: 200 },
      perRank: { talentId: "196985", pctPerRank: 10 },
    },
    note: "Energy Cycle + Ultimate Serenity — Surge of Light spent: Holy Word: Serenity −4 s",
  },
  // RESETS (seconds: Infinity — back at the trigger, every charge).
  //
  // Apotheosis (Holy, 200183): 「$?s235587[获得一次圣言术的使用次数]
  // [重置圣言术的冷却时间]」 — one charge of each Holy Word with Miracle
  // Worker 235587 (Serenity, and Sanctify without Ultimate Serenity, hold two),
  // a reset without it: one charge back either way (`oneCharge`; a full reset
  // of a two-charge Serenity over-credits, research §6 (c)). Its buff can
  // land with no cast (out of Shadowmeld), so the trigger is the buff
  // applied.
  "200183": {
    targets: ["88625", "2050", "34861"],
    triggerCastIds: [],
    triggerSelfAuraAppliedIds: ["200183"],
    seconds: Number.POSITIVE_INFINITY,
    oneCharge: true,
    note: "Apotheosis — a charge of each Holy Word back (a reset of one that holds one)",
  },
  //
  // Demonic Intensity (Aldrachi / Devourer, 452415): "… and casting
  // Collapsing Star resets its cooldown" (The Hunt) — dummy rows only. All 4
  // impossible Hunt recasts (44.7 / 39.0 / 41.2 / 55.2 s on 90) have a
  // Collapsing Star 1221150 cast between; 26 other gaps in 12 files are all
  // ≥ 90 s. Predator's Wake 1259431 shares The Hunt's cooldown (DB2
  // SpellCategories Category 2427 on 1246167 and 1259431, both 90 s; the
  // aura-332 button swap under Demonsurge — 1263fff6 recasts it 7.4 s apart
  // across a Collapsing Star): it is a press of 1246167 through
  // `SPELL_CANONICAL_IDS` (F20 D23), so this one target covers it.
  "452415": {
    targets: ["1246167"],
    triggerCastIds: ["1221150"],
    seconds: Number.POSITIVE_INFINITY,
    note: "Demonic Intensity — Collapsing Star resets The Hunt",
  },
  // Violent Transformation (Devourer branch, 452409): "Entering Void
  // Metamorphosis resets the cooldown of Voidblade and Soul Immolation" —
  // dummy only. Entering = buff 1217607 applied on the demon hunter.
  // Holders 96 of 964 Soul Immolation pairs under the model, non-holders 0
  // of 180. Replay (6 files, 161 presses): static 53 impossible, reset to
  // full charges 9, one charge 15. (Leaving Void Meta as a second reset
  // would take 9 → 6 — unproven, not modelled.)
  // Voidblade 1245412 (its Void Meta variant Pierce the Veil 1245483 is the
  // same button, `overrideVariantsGenerated`) is named by the tooltip on both
  // eras (12.1.0.69587 "… resets the cooldown of Voidblade and The Hunt",
  // 12.1.5 "… Voidblade and Soul Immolation"); GH #179: the `[PRESS]` line's
  // `back` sat 9–20 s after a Pierce the Veil pressed right after an entry.
  "452409": {
    targets: ["1245412"],
    triggerCastIds: [],
    triggerSelfAuraAppliedIds: ["1217607"],
    seconds: Number.POSITIVE_INFINITY,
    note: "Violent Transformation — entering Void Metamorphosis resets Voidblade",
  },
  // Soul Immolation from 12.1.5 only (codex 20-F26-07 #1): the 12.1.0
  // tooltip names The Hunt instead (the dated row below), so an August log
  // gets no Soul Immolation reset from it.
  "452409:si-1215": {
    talentSpellId: "452409",
    targets: ["1241937"],
    triggerCastIds: [],
    triggerSelfAuraAppliedIds: ["1217607"],
    seconds: {
      base: 0,
      bySpec: {
        [CombatUnitSpec.DemonHunter_Devourer]: {
          cutoverEpochMs: PATCH_1215_GOLIVE_EPOCH_MS,
          before: 0,
          since: Number.POSITIVE_INFINITY,
          zoneBandTakes: PATCH_1215_ZONE_BAND_TAKES,
        },
      },
    },
    note: "Violent Transformation from 12.1.5 — entering Void Metamorphosis resets Soul Immolation (dated)",
  },
  // Violent Transformation before 12.1.5 (GH #193, fact11; user ruling
  // 2026-11-07 「两个都修」): the 12.1.0 tooltip (69299 / 69587 enUS, 69933
  // zhCN 「进入虚空变形时，重置虚空之刃和恶魔追击的冷却时间」) resets Voidblade
  // and The Hunt; from 12.1.5.70340 it names Soul Immolation instead (the
  // row above). Before 12.1.5 Predator's Wake 1259431 — The Hunt's button
  // under Demonsurge — is its own 90 s cooldown (`OVERRIDE_VARIANT_SHARES_
  // BY_ERA`), so it is a target of its own. 12 August files (08-28
  // manifest): 39 Wake re-presses, all 34 under 90 s (37.0–67.8 s) with a
  // Void Metamorphosis entry 1217607 between, none without; Wake pressed a
  // median 2.5 s after the latest entry (n 75). Every Wake user held the
  // talent (no non-holder control); that the reset reaches the Wake variant
  // rests on those timings, not on DB2 (dummy effects only).
  "452409:hunt-1210": {
    talentSpellId: "452409",
    targets: ["1246167", "1259431"],
    triggerCastIds: [],
    triggerSelfAuraAppliedIds: ["1217607"],
    seconds: {
      base: 0,
      bySpec: {
        [CombatUnitSpec.DemonHunter_Devourer]: {
          cutoverEpochMs: PATCH_1215_GOLIVE_EPOCH_MS,
          before: Number.POSITIVE_INFINITY,
          since: 0,
          zoneBandTakes: PATCH_1215_ZONE_BAND_TAKES,
        },
      },
    },
    note: "Violent Transformation before 12.1.5 — entering Void Metamorphosis resets The Hunt and Predator's Wake (12.1.0 tooltip; dated)",
  },
  // Cold Snap (Frost, 235219): resets Ice Block and Ice Barrier (and Frost
  // Nova / Cone of Cold, not ledger spells). 0.5 % of Frost hold it (the
  // choice node against Glacial Bulwark); its casts explain the 3 Ice
  // Barrier impossible presses of one file and Ice Block gaps of 46.9 /
  // 83.6 s on a 240 s model, the reset visible in the log.
  "235219": {
    targets: ["45438", "11426"],
    triggerCastIds: ["235219"],
    seconds: Number.POSITIVE_INFINITY,
    note: "Cold Snap — resets Ice Block and Ice Barrier",
  },
  // Preparation (Outlaw, 1277933): an active talent — SPELL_CAST_SUCCESS
  // 1277933 (140 of 147 Outlaw rounds take it). Replay (1 file): Adrenaline
  // Rush static 4 impossible → 1 with the reset. Its tooltip names four more
  // (GH #176, 2026-11-02, 12.1.5.70575 zhCN): 「立即重置冲动、正中眉心、剑刃
  // 乱舞、刀锋冲刺和影舞步的冷却时间」 — Between the Eyes 315341, Blade Flurry
  // 13877, Blade Rush 271877, Killing Spree 51690.
  "1277933": {
    targets: ["13750", "315341", "13877", "271877", "51690"],
    triggerCastIds: ["1277933"],
    seconds: Number.POSITIVE_INFINITY,
    note: "Preparation — resets Adrenaline Rush, Between the Eyes, Blade Flurry, Blade Rush and Killing Spree",
  },
  // Valiance (Paladin Lightsmith, 432919; GH #176): "Consuming Infusion of
  // Light / Shining Light reduces the cooldown of Holy Armaments by 3.0 s"
  // (DB2 effect bp 3000, PvP ×1). Holy Bulwark 432459 and Sacred Weapon
  // 432472 are one charge pool (category 2220). Spent by Flash of Light,
  // Holy Light, Judgment, Hammer of Wrath (Holy: 54149) and Word of Glory
  // (Protection: 327510). 605 files: 265 of 265 holders take it (no control
  // group); the replay at 3 s takes the 537 presses the model called
  // impossible to 2, against 112 at 2.5 s and 19 at 2.9 s.
  "432919": {
    targets: ["432459", "432472"],
    triggerCastIds: [],
    triggerAuraConsumed: {
      auraIds: ["54149", "327510"],
      byCastIds: ["19750", "82326", "275773", "1241413", "85673"],
      withinMs: 150,
    },
    seconds: 3,
    note: "Valiance — Infusion of Light / Shining Light spent: Holy Armaments −3 s",
  },
  // Ace Up Your Sleeve (Outlaw, 381828; GH #176): 「正中眉心每消耗一个连击
  // 点数，便有3%的几率获得4个连击点数并重置其冷却时间」. The proc is logged
  // only as its energize 394120 on the press's own millisecond (605 file
  // 0284fcd9: 21:47:41.978 Between the Eyes + energize, pressed again 0.8 s
  // later).
  "381828": {
    targets: ["315341"],
    triggerCastIds: [],
    triggerEnergizeIds: ["394120"],
    seconds: Number.POSITIVE_INFINITY,
    note: "Ace Up Your Sleeve — the proc (energize 394120) resets Between the Eyes",
  },
  // Gravedigger (Outlaw, 1265863; GH #176): 「当你藏了6颗子弹时，你的下一次
  // 正中眉心不再消耗能量，而是消耗这些子弹，产生6个连击点数，并立即重置其冷却
  // 时间」 — logged as its energize 1279356 on that press's millisecond.
  "1265863": {
    targets: ["315341"],
    triggerCastIds: [],
    triggerEnergizeIds: ["1279356"],
    seconds: Number.POSITIVE_INFINITY,
    note: "Gravedigger — the bullet-fed Between the Eyes (energize 1279356) resets its own cooldown",
  },
  // Summon Doomguard (Demonology, 1276672; GH #176): its own tooltip
  // 「消耗一个恶魔之核可使召唤末日守卫的冷却时间缩短$s2秒」, s2 = 3 s (PvP
  // 1). A Demonic Core 264173 is spent by a Demonbolt 264178.
  "1276672": {
    targets: ["1276672"],
    triggerCastIds: [],
    triggerAuraConsumed: {
      auraIds: ["264173"],
      byCastIds: ["264178"],
      withinMs: 300,
    },
    seconds: 3,
    note: "Summon Doomguard — each Demonic Core spent: −3 s",
  },
  // White Out (Frost, 1281638; GH #176): 「冰枪术使寒冰宝珠的冷却时间缩短
  // ${$s1/1000}.1秒，每粉碎一层冻结额外缩短${$s2/1000}.1秒」 — DB2 1281638
  // s1 500, s2 100: 0.5 s an Ice Lance, plus 0.1 s a Freezing 1221389 stack
  // it shatters. fact12 D17 (T16): the 0.5 s is per Ice Lance HIT (228598 —
  // Splitting Ice's second bolt too), and the stacks are the log's own: the
  // caster's Freezing on the struck unit dropping (REMOVED_DOSE n → m, or
  // REMOVED) in the millisecond of its Ice Lance or Shatter 1246949 hit
  // there (`triggerOwnAuraStacksLost`). 584 downloaded logs, 28 Frozen Orb
  // recast gaps of White Out + Spellfrost Teachings holders: per cast and
  // no stacks (this row before) 7 recasts impossible, up to 7.9 s early
  // (64e9a3f3 r0 1:14 → 1:40, 26.0 s: 72 splinters, 9 casts / 18 hits, 38
  // stacks); per hit with the shattered stacks 1 (a gap whose 2 s are
  // 21 stacks that ran out, no hit — not shattered, left out).
  "1281638": {
    targets: ["84714", "198149"],
    triggerCastIds: [],
    triggerHitIds: ["228598"],
    hitsCountEachRow: true,
    seconds: 0.5,
    note: "White Out — each Ice Lance hit: Frozen Orb −0.5 s",
  },
  "1281638:shatter": {
    talentSpellId: "1281638",
    targets: ["84714", "198149"],
    triggerCastIds: [],
    triggerOwnAuraStacksLost: {
      auraIds: ["1221389"],
      atOwnHitIds: ["228598", "1246949"],
    },
    seconds: 0.1,
    note: "White Out — each Freezing stack an Ice Lance shatters: Frozen Orb −0.1 s",
  },
  // Red Thirst (Blood): "Every 10 Runic Power spent reduces the cooldown of
  // Vampiric Blood by 2.0 sec" — s1 2 000, s2 10. Runic Power is ×10 in the
  // log (Death Strike 450 = 45). Holders 13 of 13 recasts under the model,
  // non-holders 0 of 3; replay 12 impossible → 0 at 2 s per 10.
  "205723": {
    targets: ["55233"],
    triggerCastIds: [],
    triggerPowerSpend: { powerType: 6, unitsPerSecond: { base: 50 } },
    seconds: 0,
    note: "Red Thirst — Vampiric Blood −2 s per 10 Runic Power spent",
  },
  // Restless Blades (Outlaw baseline 79096): finishers reduce "many Rogue
  // skills" by `$<cdr>` sec per combo point — dummy 10 (1.0 s), PvpMultiplier
  // 0.8. Combo points are the finisher row's second cost (whole points).
  // DB2 leaves two readings, 1.0 s and 0.8 s; the corpus picks 1.0 — the
  // server script reads the dummy's base, the PvP multiplier does not reach
  // it (GH #179, 2026-11-03). Outlaw files of the 08-28 manifest, every 5th
  // (13 files, 1,064 checked `back`s): presses the model calls impossible on
  // the Restless Blades kit 39 at 0.8 → 3 at 1.0; hold-out, every 5th from
  // the 3rd (12 files, 516): 23 → 2. What is left is ≤ 5.5 s, one each.
  "79096": {
    targets: [
      "13750",
      "315341",
      "13877",
      "271877",
      "195457",
      "381989",
      "51690",
      "1214909",
      "2983",
    ],
    triggerCastIds: [],
    ownedBySpecIds: ["260"],
    triggerPowerSpend: {
      powerType: 4,
      unitsPerSecond: { base: 1 },
      // Triple Threat 1214935 / Jackpot 1214937 (Roll the Bones outcomes,
      // GH #176): aura 108 +30 % on mask 0/0/8192/0 — Restless Blades' own
      boosts: [{ whileAuraIds: ["1214935", "1214937"], pct: 30 }],
      // GH #198 (user ruling 2026-11-07): a Fang Strike Dispatch (Outlaw
      // 12.1 4pc 1296589, buff 1301405) logs no combo-point cost; counted
      // at the maximum. 11 Outlaw logs, 39 Sprint intervals: recasts before
      // the model 2 → 1 (the third needs a finisher logged ≤ 0.1 s before
      // the press). The opposite side — 7–8 intervals where Sprint failed
      // `not yet recovered` after the model called it back — stays open.
      freeSpendAsMax: {
        castIds: ["2098"],
        consumedAuraId: "1301405",
        withinMs: 100,
      },
    },
    seconds: 0,
    note: "Restless Blades — Outlaw finishers: −1 s per combo point on Adrenaline Rush and the Outlaw kit",
  },
};

/** Hits of one use land together; rows of `triggerHitIds` further apart than
 * this are different uses (`maxHitsPerUse` and the one-credit-per-unit rule
 * count per use). The Wildfire Bomb's explosion rows sit within 0.1 s of
 * each other. Two bombs are at least a global cooldown apart when CAST
 * (0.75 s at the haste floor), but they are projectiles: the second can be
 * thrown from closer, so their IMPACTS can be nearer than the casts — a
 * window of 1 s merged two bombs landing 0.8–0.96 s apart on one enemy and,
 * with one credit per unit, dropped the second (review 40-FT-70,
 * 2026-10-11). 0.3 s is three times one explosion's spread and under the
 * closest two impacts can get (a 0.75 s cast gap less the ~0.3 s of flight
 * a unit can close in that time). */
export const EVENT_HIT_SAME_USE_MS = 300;

/**
 * When an aura of `auraIds` the unit sourced ended (epoch ms, ascending) —
 * `triggerOwnAuraEndIds`' reading: every SPELL_AURA_REMOVED / REFRESH row
 * the unit sourced, wherever the aura sat, plus the ends the log left out on
 * the unit itself (GH #179 batch 3c). An APPLIED of its own aura on itself
 * while the last one has no end row ended that one there — no later than its
 * DB2 duration after its own APPLIED; the last one with no end row ends its
 * duration after its APPLIED; no inferred end lies past `untilMs`. An APPLIED in a re-state batch (`isResyncBatchAt`:
 * the log re-listing the unit's auras after a stall — 83 of the 106 such
 * re-applies in the 605 files) is the same aura still up and ends nothing.
 * 605 files, own APPLIED with no end row before the next: Ice Barrier 11
 * of 1,113, Blazing 6 of 1,103, Prismatic 4 of 631, Alter Time 2 of 822
 * (outside re-state batches); 18 more still open at the round's end.
 */
export function ownAuraEndTimesMs(
  unit: Partial<Pick<ICombatUnit, "actionOut" | "auraEvents" | "id">>,
  auraIds: readonly string[],
  /** the round's end (epoch ms): no end is inferred past it — the log goes
   * on recording a unit after the round is decided (codex review of batch
   * 3c round 2). Absent → the logged end rows only. */
  untilMs?: number,
): number[] {
  const out: number[] = [];
  const rows = (unit.actionOut ?? []).filter((e) =>
    auraIds.includes(String(e.spellId)),
  );
  const isEnd = (e: (typeof rows)[number]) =>
    e.logLine.event === LogEvent.SPELL_AURA_REMOVED ||
    e.logLine.event === LogEvent.SPELL_AURA_REFRESH;
  for (const e of rows) if (isEnd(e)) out.push(e.logLine.timestamp);
  const self = unit.id;
  if (self === undefined || untilMs === undefined) return out;
  // the unit's own copy in log order (a same-millisecond REMOVED after an
  // APPLIED is that aura removed at once, not the one before it — codex
  // review of batch 3c #1)
  const own = rows
    .filter(
      (e) =>
        e.destUnitId === self &&
        e.srcUnitId === self &&
        (isEnd(e) || e.logLine.event === LogEvent.SPELL_AURA_APPLIED),
    )
    .sort(
      (a, b) =>
        a.logLine.timestamp - b.logLine.timestamp ||
        (a.logLine.lineIndex ?? 0) - (b.logLine.lineIndex ?? 0),
    );
  const open = new Map<string, number>();
  const lastsMs = (id: string) =>
    (spellEffectData[id]?.durationSeconds ?? 0) * 1000;
  const infer = (ms: number) => {
    if (ms <= untilMs) out.push(ms);
  };
  // an end row that is the open aura's, logged right after the APPLIED of
  // the next one in the same millisecond (a recast): read once, as that end
  const endOfPrevious = new Set<(typeof own)[number]>();
  for (let i = 0; i < own.length; i++) {
    const e = own[i]!;
    const id = String(e.spellId);
    const at = e.logLine.timestamp;
    if (e.logLine.event === LogEvent.SPELL_AURA_REMOVED) {
      if (!endOfPrevious.has(e)) open.delete(id);
      continue;
    }
    // a recast over a live one: that one ended, this one is up
    if (e.logLine.event === LogEvent.SPELL_AURA_REFRESH) {
      open.set(id, at);
      continue;
    }
    if (
      unit.auraEvents &&
      isResyncBatchAt({ id: self, auraEvents: unit.auraEvents }, at)
    )
      continue;
    const prev = open.get(id);
    // (one opened in this very millisecond is this aura's own row pair)
    if (prev !== undefined && prev < at) {
      const sameMsEnd = own
        .slice(i + 1)
        .find(
          (n) =>
            String(n.spellId) === id && n.logLine.timestamp === at && isEnd(n),
        );
      // …only while the open one can still be up: one already past its
      // duration ended then, and this end row is the new one's (codex 3c
      // round 3)
      const prevLive = lastsMs(id) === 0 || prev + lastsMs(id) >= at;
      if (sameMsEnd && prevLive) endOfPrevious.add(sameMsEnd);
      else infer(Math.min(prev + lastsMs(id), at));
    }
    open.set(id, at);
  }
  // the last one with no end row: its duration after its APPLIED, inside the
  // round (d510865c r5: a stolen Alter Time applied at 0:24, never REMOVED —
  // its return reset Shimmer, pressed again at 1:46, 24 s into a 28.5 s
  // recharge)
  for (const [id, at] of open) if (lastsMs(id) > 0) infer(at + lastsMs(id));
  return out.sort((a, b) => a - b);
}

/**
 * When a reduction's triggers fired for `unit` (epoch ms, ascending) — the
 * ONE reading of "a trigger happened" for the ledger (`extractMajorCooldowns`),
 * the [RES] utility entries (`resUtilityCds`) and the interrupt cooldown
 * (`interruptReadyAtMs`), which all get it through `eventTriggersFor`: the
 * unit's own successful casts of `triggerCastIds`, plus, for a per-hit
 * talent, its damage rows of `triggerHitIds` (and the hits a shield soaked
 * whole, logged as an ABSORB miss), at most `maxHitsPerUse` per use; for a
 * fade talent, each of its summons of `triggerSummonIds` `summonFadeMs` after
 * the summon.
 */
export function eventTriggerTimesMs(
  unit: Pick<ICombatUnit, "spellCastEvents" | "damageOut" | "missesOut"> &
    Partial<Pick<ICombatUnit, "actionOut" | "auraEvents" | "id">>,
  r: Pick<
    IEventCooldownReduction,
    | "triggerCastIds"
    | "triggerHitIds"
    | "maxHitsPerUse"
    | "triggerSummonIds"
    | "summonFadeMs"
    | "triggerInterruptIds"
    | "triggerOwnAuraEndIds"
    | "triggerSelfAuraAppliedIds"
    | "triggerEnergizeIds"
    | "triggerCastSchoolMask"
    | "hitsCountEachRow"
    | "minHitsPerUse"
  >,
  /** the round's end (epoch ms), for the aura ends the log left out
   * (`ownAuraEndTimesMs`) */
  untilMs?: number,
): number[] {
  const schoolMask = r.triggerCastSchoolMask;
  const out = unit.spellCastEvents
    .filter(
      (e) =>
        e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
        (r.triggerCastIds.includes(String(e.spellId)) ||
          (schoolMask !== undefined &&
            ((spellSchoolMask(String(e.spellId)) ?? 0) & schoolMask) !== 0)),
    )
    .map((e) => e.logLine.timestamp);
  const appliedIds = r.triggerSelfAuraAppliedIds;
  if (appliedIds?.length)
    for (const e of unit.actionOut ?? [])
      if (
        e.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
        e.destUnitId === e.srcUnitId &&
        appliedIds.includes(String(e.spellId))
      )
        out.push(e.logLine.timestamp);
  const energizeIds = r.triggerEnergizeIds;
  if (energizeIds?.length)
    for (const e of unit.actionOut ?? [])
      if (
        e.logLine.event === LogEvent.SPELL_ENERGIZE &&
        energizeIds.includes(String(e.spellId))
      )
        out.push(e.logLine.timestamp);
  const auraEndIds = r.triggerOwnAuraEndIds;
  if (auraEndIds?.length)
    out.push(...ownAuraEndTimesMs(unit, auraEndIds, untilMs));
  const interruptIds = r.triggerInterruptIds;
  if (interruptIds?.length)
    for (const e of unit.actionOut ?? [])
      if (
        e.logLine.event === LogEvent.SPELL_INTERRUPT &&
        interruptIds.includes(String(e.spellId))
      )
        out.push(e.logLine.timestamp);
  const summonIds = r.triggerSummonIds;
  if (summonIds?.length)
    for (const e of unit.actionOut ?? [])
      if (
        e.logLine.event === LogEvent.SPELL_SUMMON &&
        summonIds.includes(String(e.spellId))
      )
        out.push(e.logLine.timestamp + (r.summonFadeMs ?? 0));
  const hitIds = r.triggerHitIds;
  if (hitIds?.length) {
    const hits = landedHitRows(unit, hitIds)
      .map((e) => ({ t: e.logLine.timestamp, dest: e.destUnitId }))
      .sort((a, b) => a.t - b.t);
    if (r.hitsCountEachRow) {
      out.push(...hits.map((h) => h.t));
      return out.sort((a, b) => a - b);
    }
    if (r.minHitsPerUse !== undefined) {
      // one trigger per use that struck enough distinct units
      let start = Number.NEGATIVE_INFINITY;
      let units = new Set<string>();
      const flush = () => {
        if (units.size >= r.minHitsPerUse!) out.push(start);
      };
      for (const { t, dest } of hits) {
        if (t - start > EVENT_HIT_SAME_USE_MS) {
          flush();
          start = t;
          units = new Set();
        }
        if (dest) units.add(dest);
      }
      flush();
      return out.sort((a, b) => a - b);
    }
    const cap = r.maxHitsPerUse ?? Number.POSITIVE_INFINITY;
    let useStart = Number.NEGATIVE_INFINITY;
    // One use credits each unit it hits once — "per enemy hit", not per
    // logged row: a second row on the same unit inside the use (a hit and
    // the part of it a shield soaked, a re-logged hit) is the same enemy
    // (codex review 45-FT-101, 2026-10-11).
    let hitUnits = new Set<string>();
    for (const { t, dest } of hits) {
      if (t - useStart > EVENT_HIT_SAME_USE_MS) {
        useStart = t;
        hitUnits = new Set();
      }
      // a row that names no destination is not evidence of another enemy
      // (the parser allows an empty one — review 40-FT-72)
      if (!dest || hitUnits.has(dest)) continue;
      if (hitUnits.size < cap) {
        out.push(t);
        hitUnits.add(dest);
      }
    }
  }
  return out.sort((a, b) => a - b);
}

/** The unit's own hit rows of `hitIds` that landed — a SPELL_DAMAGE, or a
 * SPELL_MISSED a shield ABSORBed; an immune, reflected or dodged one is no
 * hit. The one reading of "an enemy hit by X" for every trigger kind. */
export function landedHitRows(
  unit: Pick<ICombatUnit, "damageOut"> &
    Partial<Pick<ICombatUnit, "missesOut">>,
  hitIds: readonly string[],
): Array<
  | ICombatUnit["damageOut"][number]
  | NonNullable<ICombatUnit["missesOut"]>[number]
> {
  return [
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
  ];
}

/**
 * `triggerOwnAuraStacksLost`: one instant per stack of the unit's own aura
 * lost on a unit in the millisecond of one of its own landed hits there
 * (`landedHitRows`: an immune or reflected Ice Lance shatters nothing). Stacks
 * are read off the unit's own aura rows in log order (APPLIED 1 — a
 * restated one keeps the count —, a DOSE row's count, REMOVED 0).
 */
export function ownAuraStacksLostTimesMs(
  unit: Pick<ICombatUnit, "damageOut"> &
    Partial<Pick<ICombatUnit, "missesOut" | "actionOut">>,
  c: NonNullable<IEventCooldownReduction["triggerOwnAuraStacksLost"]>,
): number[] {
  const hitAt = new Set<string>();
  for (const e of landedHitRows(unit, c.atOwnHitIds))
    if (e.destUnitId) hitAt.add(`${e.destUnitId}@${e.logLine.timestamp}`);
  const rows = (unit.actionOut ?? [])
    .filter((e) => e.destUnitId && c.auraIds.includes(String(e.spellId)))
    .sort(
      (a, b) =>
        a.logLine.timestamp - b.logLine.timestamp ||
        (a.logLine.lineIndex ?? 0) - (b.logLine.lineIndex ?? 0),
    );
  const stacks = new Map<string, number>();
  const out: number[] = [];
  for (const e of rows) {
    const key = `${e.destUnitId}|${e.spellId}`;
    const before = stacks.get(key) ?? 0;
    const ev = e.logLine.event;
    const count = Number(e.logLine.parameters?.at(-1));
    let after = before;
    if (ev === LogEvent.SPELL_AURA_APPLIED) after = before > 0 ? before : 1;
    else if (
      ev === LogEvent.SPELL_AURA_APPLIED_DOSE ||
      ev === LogEvent.SPELL_AURA_REMOVED_DOSE
    )
      after = Number.isFinite(count) ? count : before;
    else if (ev === LogEvent.SPELL_AURA_REMOVED) after = 0;
    stacks.set(key, after);
    if (after < before && hitAt.has(`${e.destUnitId}@${e.logLine.timestamp}`))
      for (let i = 0; i < before - after; i++) out.push(e.logLine.timestamp);
  }
  return out;
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
  logEpochMs: LogInstant,
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
  /** one charge back, not every one (`IEventCooldownReduction.oneCharge`) */
  oneCharge?: true;
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
  > &
    Partial<
      Pick<
        ICombatUnit,
        "actionOut" | "auraEvents" | "id" | "damageIn" | "missesIn" | "info"
      >
    >,
  reductions: readonly IEventCooldownReduction[],
  /** the holder's talents, for a power trigger's talent-gated cost
   * reductions; absent → every reduction applies */
  holds?: (talentSpellId: string) => boolean,
  /** the holder's purchased rank of a talent (`creditBonus.perRank`);
   * absent → no per-rank bonus */
  rankOf?: (talentSpellId: string) => number,
  /** the round's end (epoch ms): the ledger passes it so an own aura's end
   * the log left out is read (`ownAuraEndTimesMs`); absent → logged ends only */
  untilMs?: number,
): IEventTrigger[] {
  const holderSpec = unit.spec === undefined ? undefined : String(unit.spec);
  const bonused = (
    r: IEventCooldownReduction,
    gs: IEventTrigger[],
  ): IEventTrigger[] => {
    const b = r.creditBonus;
    if (!b) return gs;
    const rankPct = b.perRank
      ? b.perRank.pctPerRank * (rankOf?.(b.perRank.talentId) ?? 0)
      : 0;
    return gs.map((g) => {
      const auraPct =
        b.whileSelfAura && selfAuraUpAt(unit, b.whileSelfAura.auraId, g.atMs)
          ? b.whileSelfAura.pct
          : 0;
      return g.seconds === Number.POSITIVE_INFINITY
        ? g
        : { ...g, seconds: g.seconds * (1 + (rankPct + auraPct) / 100) };
    });
  };
  const charged = (
    r: IEventCooldownReduction,
    gs: IEventTrigger[],
  ): IEventTrigger[] =>
    r.oneCharge ? gs.map((g) => ({ ...g, oneCharge: true as const })) : gs;
  const setBonused = (
    r: IEventCooldownReduction,
    gs: IEventTrigger[],
  ): IEventTrigger[] => {
    const b = r.setBonus;
    if (!b || !wearsSetBonus(unit, b)) return gs;
    return gs.map((g) =>
      g.seconds === Number.POSITIVE_INFINITY
        ? g
        : { ...g, seconds: g.seconds + b.addSeconds },
    );
  };
  return reductions
    .flatMap((r) =>
      charged(
        r,
        setBonused(
          r,
          bonused(r, [
            ...eventTriggerTimesMs(unit, r, untilMs).map((atMs) => ({
              atMs,
              seconds: eventReductionSecondsAt(
                r,
                holderSpec,
                logInstantOf(unit, atMs),
              ),
            })),
            ...(r.triggerPowerSpend
              ? powerSpendTriggers(unit, r.triggerPowerSpend, holderSpec, holds)
              : []),
            ...(r.triggerAuraConsumed ? auraConsumedTriggers(unit, r) : []),
            ...(r.triggerOwnAuraStacksLost
              ? ownAuraStacksLostTimesMs(unit, r.triggerOwnAuraStacksLost).map(
                  (atMs) => ({
                    atMs,
                    seconds: eventReductionSecondsAt(
                      r,
                      holderSpec,
                      logInstantOf(unit, atMs),
                    ),
                  }),
                )
              : []),
            ...(r.triggerBuffedUseTargets
              ? buffedUseTargetTriggers(unit, r)
              : []),
            ...(r.triggerHostileTaken ? hostileTakenTriggers(unit, r) : []),
            ...(r.triggerCastTargetTicks
              ? castTargetTickTriggers(unit, r, holderSpec)
              : []),
          ]),
        ),
      ),
    )
    .sort((a, b) => a.atMs - b.atMs);
}

/** The triggers of a channel's ticks on its cast's target
 * (`triggerCastTargetTicks`). */
export function castTargetTickTriggers(
  unit: Pick<ICombatUnit, "spellCastEvents" | "damageOut" | "missesOut">,
  r: Pick<IEventCooldownReduction, "triggerCastTargetTicks" | "seconds">,
  holderSpec: string | undefined,
): IEventTrigger[] {
  const c = r.triggerCastTargetTicks;
  if (!c) return [];
  type Row = { logLine: { timestamp: number; lineIndex?: number } };
  // log order: the millisecond, then the line (codex review round 2: the
  // old channel's last tick and the new cast share a millisecond)
  const before = (a: Row, b: Row) =>
    a.logLine.timestamp < b.logLine.timestamp ||
    (a.logLine.timestamp === b.logLine.timestamp &&
      (a.logLine.lineIndex ?? 0) < (b.logLine.lineIndex ?? 0));
  const casts = unit.spellCastEvents
    .filter(
      (e) =>
        e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
        c.byCastIds.includes(String(e.spellId)) &&
        !!e.destUnitId,
    )
    .sort((a, b) => (before(a, b) ? -1 : before(b, a) ? 1 : 0));
  const ticks = [
    ...unit.damageOut.filter(
      (e) => e.logLine.event === LogEvent.SPELL_PERIODIC_DAMAGE,
    ),
    ...(unit.missesOut ?? []).filter(
      (e) => e.logLine.event === LogEvent.SPELL_PERIODIC_MISSED,
    ),
  ].filter((e) => c.tickIds.includes(String(e.spellId)));
  const out: IEventTrigger[] = [];
  for (const e of ticks) {
    const t = e.logLine.timestamp;
    // the first cast it belongs to: on that cast's target, from the cast's
    // millisecond (its first tick can be logged before the cast row), and
    // before the next cast in log order — counted once
    const owner = casts.find((cast, i) => {
      const from = cast.logLine.timestamp;
      const next = casts[i + 1];
      return (
        e.destUnitId === cast.destUnitId &&
        t >= from &&
        t < from + c.windowMs &&
        (next === undefined || before(e, next))
      );
    });
    if (owner)
      out.push({
        atMs: t,
        seconds: eventReductionSecondsAt(r, holderSpec, logInstantOf(unit, t)),
      });
  }
  return out.sort((a, b) => a.atMs - b.atMs);
}

/** The triggers of a "being attacked" talent (`triggerHostileTaken`). */
export function hostileTakenTriggers(
  unit: Partial<
    Pick<ICombatUnit, "id" | "damageIn" | "missesIn" | "auraEvents">
  >,
  r: Pick<IEventCooldownReduction, "triggerHostileTaken" | "seconds">,
): IEventTrigger[] {
  const h = r.triggerHostileTaken;
  if (!h) return [];
  const per = typeof r.seconds === "number" ? r.seconds : r.seconds.base;
  const times: number[] = [];
  const other = (src: string | undefined) => !!src && src !== unit.id;
  const mask = h.damageSchoolMask;
  const inMask = (e: {
    spellId?: string;
    logLine: { event: string };
    spellSchoolId?: string;
    damageSchoolId?: string;
  }): boolean => {
    if (mask === undefined) return true;
    const school = e.logLine.event.startsWith("SWING_")
      ? 1
      : parseInt(e.damageSchoolId ?? e.spellSchoolId ?? "", 16) ||
        (spellSchoolMask(String(e.spellId)) ?? 0);
    return school > 0 && (school & ~mask) === 0;
  };
  for (const e of unit.damageIn ?? [])
    if (
      e.logLine.event !== LogEvent.SPELL_PERIODIC_DAMAGE &&
      other(e.srcUnitId) &&
      inMask(e)
    )
      times.push(e.logLine.timestamp);
  for (const e of unit.missesIn ?? [])
    if (
      e.logLine.event !== LogEvent.SPELL_PERIODIC_MISSED &&
      other(e.srcUnitId) &&
      (mask === undefined || (e.missType === "ABSORB" && inMask(e)))
    )
      times.push(e.logLine.timestamp);
  for (const e of unit.auraEvents ?? [])
    if (
      mask === undefined &&
      e.auraType === "DEBUFF" &&
      e.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
      other(e.srcUnitId)
    )
      times.push(e.logLine.timestamp);
  times.sort((a, b) => a - b);
  const out: IEventTrigger[] = [];
  let last = Number.NEGATIVE_INFINITY;
  for (const t of times) {
    if (t - last < h.internalCooldownMs) continue;
    if (h.notWhileSelfAuraId && selfAuraUpAt(unit, h.notWhileSelfAuraId, t))
      continue;
    last = t;
    out.push({ atMs: t, seconds: per });
  }
  return out;
}

/** Stacks of the unit's own buff `auraId` strictly before `atMs` (a gain or
 * a loss at that very instant is the use's own, not its state). */
function selfAuraStacksBefore(
  unit: Partial<Pick<ICombatUnit, "auraEvents">>,
  auraId: string,
  atMs: number,
): number {
  let stacks = 0;
  for (const e of unit.auraEvents ?? []) {
    if (String(e.spellId) !== auraId || e.logLine.timestamp >= atMs) continue;
    const ev = e.logLine.event;
    if (ev === LogEvent.SPELL_AURA_REMOVED) stacks = 0;
    else if (
      ev === LogEvent.SPELL_AURA_APPLIED_DOSE ||
      ev === LogEvent.SPELL_AURA_REMOVED_DOSE
    )
      stacks = e.amount ?? stacks;
    else if (ev === LogEvent.SPELL_AURA_APPLIED) stacks = e.amount ?? 1;
  }
  return stacks;
}

/** The uses of a consumed-buff talent (`triggerAuraConsumed`). */
export function auraConsumedTriggers(
  unit: Pick<ICombatUnit, "spellCastEvents"> &
    Partial<Pick<ICombatUnit, "auraEvents">>,
  r: Pick<IEventCooldownReduction, "triggerAuraConsumed" | "seconds">,
): IEventTrigger[] {
  const c = r.triggerAuraConsumed;
  if (!c) return [];
  const per = typeof r.seconds === "number" ? r.seconds : r.seconds.base;
  const casts = unit.spellCastEvents
    .filter(
      (e) =>
        e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
        c.byCastIds.includes(String(e.spellId)),
    )
    .map((e) => e.logLine.timestamp);
  const out: IEventTrigger[] = [];
  let lastUse = Number.NEGATIVE_INFINITY;
  for (const e of unit.auraEvents ?? []) {
    const ev = e.logLine.event;
    if (
      (ev !== LogEvent.SPELL_AURA_REMOVED &&
        ev !== LogEvent.SPELL_AURA_REMOVED_DOSE) ||
      !c.auraIds.includes(String(e.spellId))
    )
      continue;
    const t = e.logLine.timestamp;
    if (!casts.some((ct) => Math.abs(ct - t) <= c.withinMs)) continue;
    if (t - lastUse <= c.withinMs) continue; // one removal row per use
    lastUse = t;
    const stacks = c.perStackOfAuraId
      ? selfAuraStacksBefore(unit, c.perStackOfAuraId, t)
      : 1;
    if (stacks > 0) out.push({ atMs: t, seconds: per * stacks });
  }
  return out;
}

/** The per-target triggers of a buffed use (`triggerBuffedUseTargets`). */
export function buffedUseTargetTriggers(
  unit: Pick<ICombatUnit, "spellCastEvents" | "damageOut"> &
    Partial<Pick<ICombatUnit, "auraEvents" | "missesOut">>,
  r: Pick<IEventCooldownReduction, "triggerBuffedUseTargets" | "seconds">,
): IEventTrigger[] {
  const c = r.triggerBuffedUseTargets;
  if (!c) return [];
  const per = typeof r.seconds === "number" ? r.seconds : r.seconds.base;
  const casts = unit.spellCastEvents
    .filter(
      (e) =>
        e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
        c.byCastIds.includes(String(e.spellId)),
    )
    .map((e) => e.logLine.timestamp)
    .sort((a, b) => a - b);
  const consumed = (unit.auraEvents ?? [])
    .filter(
      (e) =>
        (e.logLine.event === LogEvent.SPELL_AURA_REMOVED ||
          e.logLine.event === LogEvent.SPELL_AURA_REMOVED_DOSE) &&
        c.auraIds.includes(String(e.spellId)),
    )
    .map((e) => e.logLine.timestamp);
  const rows = [
    ...unit.damageOut.filter((e) => c.hitIds.includes(String(e.spellId))),
    ...(unit.missesOut ?? []).filter((e) =>
      c.hitIds.includes(String(e.spellId)),
    ),
  ]
    .map((e) => ({ t: e.logLine.timestamp, dest: e.destUnitId }))
    .sort((a, b) => a.t - b.t);
  const out: IEventTrigger[] = [];
  casts.forEach((t, i) => {
    if (!consumed.some((x) => Math.abs(x - t) <= c.withinMs)) return;
    const endMs = Math.min(casts[i + 1] ?? Infinity, t + c.windowMs);
    const seen = new Set<string>();
    for (const h of rows) {
      if (h.t < t - BUFFED_USE_ROW_LEAD_MS || h.t > endMs) continue;
      // a row that names no destination is not evidence of another enemy
      if (!h.dest || seen.has(h.dest)) continue;
      seen.add(h.dest);
      out.push({ atMs: h.t, seconds: per });
    }
  });
  return out;
}

/** A hit row can sit a few ms before its cast row in the log. */
const BUFFED_USE_ROW_LEAD_MS = 50;

/** Is the unit's own buff `auraId` up at `atMs` (a removal at that very
 * instant still counts — a cost reduction is consumed by the cast it
 * reduces)? */
/** @internal exported for test/fact4Batch6a.test.ts */
export function selfAuraUpAt(
  unit: Partial<Pick<ICombatUnit, "auraEvents" | "id">>,
  auraId: string,
  atMs: number,
): boolean {
  // up from an APPLIED / REFRESH until its REMOVED — or, only when the log
  // lost that REMOVED (none before the next application), until the aura's
  // caster-resolved official length after that row: `buildAuraIntervals`'
  // cap (codex 59-POSTHOC-11e #6 / 60-POSTHOC-08d #1: an Apotheosis with no
  // REMOVED gave Smite 12 s of Chastise reduction instead of 4). A logged
  // REMOVED is the end even past the official length (Voidform, extended,
  // ran 0:21–0:57 on a 20 s row).
  const rows = (unit.auraEvents ?? []).filter(
    (e) => String(e.spellId) === auraId,
  );
  let lastOn: number | undefined;
  let k = -1;
  for (let i = 0; i < rows.length; i++) {
    const t = rows[i]!.logLine.timestamp;
    if (t > atMs) break;
    if (rows[i]!.logLine.event === LogEvent.SPELL_AURA_REMOVED) {
      if (t < atMs) lastOn = undefined;
    } else {
      lastOn = t;
      k = i;
    }
  }
  if (lastOn === undefined) return false;
  // its own end: the first REMOVED after it, before another APPLIED
  for (let i = k + 1; i < rows.length; i++) {
    const ev = rows[i]!.logLine.event;
    if (ev === LogEvent.SPELL_AURA_REMOVED) return true;
    if (ev === LogEvent.SPELL_AURA_APPLIED) break;
  }
  const d =
    buffFullDurationForCaster(
      auraId,
      (unit as { spellCastEvents?: unknown }).spellCastEvents !== undefined
        ? (unit as never)
        : undefined,
      lastOn,
    ) ?? spellEffectData[auraId]?.durationSeconds;
  return !(typeof d === "number" && d > 0) || atMs <= lastOn + d * 1000;
}

/**
 * The give-backs of a power-spend talent: each own successful cast that
 * states a cost of `powerType` gives back the power actually spent ÷
 * `unitsPerSecond`. A cast whose row states no cost gives nothing (unknown,
 * not free — documents stored before 2026-10-11 carry no costs at all).
 */
/** The `powerType` maximum a free finisher spent (`freeSpendAsMax`), 0 when
 * the press is not one or no advanced reading states the maximum. */
function freeSpendMax(
  unit: Partial<Pick<ICombatUnit, "auraEvents" | "id" | "advancedActions">>,
  p: IPowerSpendTrigger,
  castId: string,
  atMs: number,
): number {
  const f = p.freeSpendAsMax;
  if (!f || !f.castIds.includes(castId)) return 0;
  const consumed = (unit.auraEvents ?? []).some(
    (a) =>
      a.logLine.event === LogEvent.SPELL_AURA_REMOVED &&
      String(a.spellId) === f.consumedAuraId &&
      a.destUnitId === unit.id &&
      Math.abs(a.logLine.timestamp - atMs) <= f.withinMs,
  );
  if (!consumed) return 0;
  let best: { dt: number; max: number } | undefined;
  for (const s of unit.advancedActions ?? []) {
    if (s.advancedActorId !== unit.id) continue;
    const max = s.advancedActorPowers.find(
      (w) => (w.type as number) === p.powerType,
    )?.max;
    if (!max) continue;
    const dt = Math.abs(s.timestamp - atMs);
    if (!best || dt < best.dt) best = { dt, max };
  }
  return best?.max ?? 0;
}

export function powerSpendTriggers(
  unit: Pick<ICombatUnit, "spellCastEvents"> &
    Partial<Pick<ICombatUnit, "auraEvents" | "id" | "advancedActions">>,
  p: IPowerSpendTrigger,
  holderSpec: string | undefined,
  holds?: (talentSpellId: string) => boolean,
): IEventTrigger[] {
  const units =
    (holderSpec !== undefined
      ? p.unitsPerSecond.bySpec?.[holderSpec]
      : undefined) ?? p.unitsPerSecond.base;
  const out: IEventTrigger[] = [];
  for (const e of unit.spellCastEvents) {
    if (e.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
    const id = String(e.spellId);
    if (
      p.exclude?.castIds.includes(id) &&
      holderSpec !== undefined &&
      p.exclude.specIds.includes(holderSpec)
    )
      continue;
    const stated =
      e.powerCosts?.find((c) => c.type === p.powerType)?.cost ||
      freeSpendMax(unit, p, id, e.logLine.timestamp);
    if (!stated || stated <= 0) continue;
    let cost = stated;
    for (const red of p.costReductions ?? []) {
      if (!red.castIds.includes(id)) continue;
      if (red.talentId && holds && !holds(red.talentId)) continue;
      if (
        red.whileAuraId &&
        !selfAuraUpAt(unit, red.whileAuraId, e.logLine.timestamp)
      )
        continue;
      if (red.pct !== undefined) cost *= 1 - red.pct / 100;
      if (red.flat !== undefined) cost -= red.flat;
    }
    let mult = 1;
    for (const b of p.boosts ?? [])
      if (
        b.whileAuraIds.some((a) => selfAuraUpAt(unit, a, e.logLine.timestamp))
      )
        mult *= 1 + b.pct / 100;
    if (cost > 0)
      out.push({ atMs: e.logLine.timestamp, seconds: (cost / units) * mult });
  }
  return out;
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

/**
 * Time Spiral (Evoker 374968, GH #176): "allowing you and your allies within
 * 40 yds to cast their major movement ability once in the next 10 sec, even
 * if it is on cooldown". Each class gets its own 10 s aura; the press that
 * consumes it neither spends a charge nor restarts the cooldown. Keyed by the
 * aura; the spells are DB2's own: the aura's effect is either aura 383
 * (ignore cooldown) with a class mask, or aura 411 / 500 on a charge
 * category, resolved here to the spells of that category (SpellCategories,
 * 12.1.5.70575) — only the ids the corpus has seen (observedSpellIds; DB2's
 * other members of those categories — Infernal Strike 189110, Displacer
 * Beast 137452, the 1294067/8 Blink and Shimmer rows, 361138 Roll, 430762
 * Hover, 433693 Steed, 336471 Leap of Faith — have no row). The press is
 * the cast row the aura's REMOVED follows by at most `TIME_SPIRAL_PAIR_MS` — 605 files: 143 of 145 movement presses paired
 * with a REMOVED at +0…16 ms (the two others 287 / 468 ms BEFORE the row: an
 * aura that ran out, not a consumed one).
 */
export const TIME_SPIRAL_FREE_PRESSES: Readonly<
  Record<string, { spellIds: readonly string[]; note: string }>
> = {
  // aura 411/500, charge category 1941
  "375226": {
    spellIds: ["48265", "444347"],
    note: "Death Knight — Death's Advance / Death Charge",
  },
  // charge categories 1545 / 2448
  "375229": {
    spellIds: ["195072", "344865", "1234796"],
    note: "Demon Hunter — Fel Rush / Shift",
  },
  // aura 383, class mask
  "375230": {
    spellIds: ["1850", "252216"],
    note: "Druid — Dash / Tiger Dash",
  },
  // charge category 1948
  "375234": { spellIds: ["358267"], note: "Evoker — Hover" },
  // aura 383, class mask
  "375238": { spellIds: ["186257"], note: "Hunter — Aspect of the Cheetah" },
  // charge categories 1446 / 1632
  "375240": {
    spellIds: ["1953", "212653"],
    note: "Mage — Blink / Shimmer",
  },
  // charge category 1365
  "375252": {
    spellIds: ["109132", "115008"],
    note: "Monk — Roll / Chi Torpedo",
  },
  // charge category 1662
  "375253": { spellIds: ["190784"], note: "Paladin — Divine Steed" },
  // charge category 2308
  "375254": { spellIds: ["73325"], note: "Priest — Leap of Faith" },
  // aura 383, class mask
  "375255": { spellIds: ["2983"], note: "Rogue — Sprint" },
  // aura 383, class mask
  "375256": {
    spellIds: ["79206", "58875", "192063"],
    note: "Shaman — Spiritwalker's Grace / Spirit Walk / Gust of Wind",
  },
  // aura 383, class mask on Demonic Circle: Teleport (GH #183: the one class
  // without a row; a press with the aura REMOVED on its millisecond)
  "375257": { spellIds: ["48020"], note: "Warlock — Demonic Circle: Teleport" },
  // charge category 1211
  "375258": { spellIds: ["6544"], note: "Warrior — Heroic Leap" },
};
/**
 * A talent that shortens a press's OWN cooldown by the stacks of a buff the
 * holder had up just before it (GH #183) — keyed by the spell. Cycle of
 * Hatred 258887 (Havoc): "Activating Eye Beam reduces the cooldown of your
 * next Eye Beam by 2.5 sec, stacking up to 10 sec." Dummy only; its stack
 * buff 1214887 lasts the round, up to 4 stacks. Every Havoc unit holds it,
 * so the split is by stack count: the shortest Eye Beam gaps at 0 … 4
 * stacks are 30.01 / 27.49 / 24.99 / 22.51 / 19.99 s (n 7 / 67 / 69 / 60 /
 * 149, 605-file subsets). A second APPLIED with no REMOVED between restates
 * the buff and keeps its count.
 */
export const PER_PRESS_STACK_COOLDOWNS: Readonly<
  Record<
    string,
    {
      talentSpellId: string;
      auraId: string;
      secondsPerStack: number;
      maxStacks: number;
      /** the row needs this class set bonus held as well (`wearsSetBonus`:
       * the bonus's spec and pieces — the one set-bonus gate) */
      requiresSet?: {
        bonusSpellId: string;
        itemSetId: string;
        pieces: number;
        specs: readonly string[];
      };
      /** the press's own dose of the aura counts too: the stacks up
       * `PER_PRESS_OWN_DOSE_MS` after the press, not strictly before it */
      ownDoseCounts?: true;
      note: string;
    }
  >
> = {
  "198013": {
    talentSpellId: "258887",
    auraId: "1214887",
    secondsPerStack: 2.5,
    maxStacks: 4,
    note: "Cycle of Hatred — Eye Beam −2.5 s per stack up before the press (≤ 4)",
  },
  // Havoc 12.1 4pc 1296612 (GH #197, fact11 D35–D37): 「Essence Break now
  // applies and benefits from the effects of Cycle of Hatred」 — scripted, no
  // cooldown row in DB2 (why the talent inventory found nothing). 40 − 4 ×
  // 2.5 = 30.0 s, the corpus minimum. 25 downloaded logs, 228 recast gaps:
  // holders' minimum gap by stacks up before the press 29.99 s at 4 (n 201),
  // 35.25 at 3, 38.76 at 2; each Essence Break press adds a 1214887 dose.
  // The one 0-piece player (73 Havoc logs) got no dose from Essence Break,
  // gaps 43.7–55.8 s with 3–4 stacks up — a single-player control.
  // fact12 D4 (T16): the press's own dose counts — it applies the stack and
  // benefits from it (`ownDoseCounts`; the dose row 0–60 ms after the
  // SUCCESS). 584 downloaded logs, 61 recast gaps of presses that add a
  // dose: stacks strictly before the press call 14 recasts impossible (12 at
  // 1 stack, up to 3.2 s early: 1d26a991 r0 0:17, 1 stack, recast 34.3 s
  // later against 37.5); with the own dose 1 (that one, 0.7 s under 35);
  // stacks gained later in the cooldown taking time off too would leave no
  // recast within 1.85 s of its return — 0 of 61, so they do not.
  "258860": {
    talentSpellId: "258887",
    auraId: "1214887",
    secondsPerStack: 2.5,
    maxStacks: 4,
    requiresSet: {
      bonusSpellId: "1296612",
      itemSetId: "2056",
      pieces: 4,
      specs: ["577"],
    },
    ownDoseCounts: true,
    note: "Havoc 12.1 4pc — Essence Break −2.5 s per Cycle of Hatred stack up once the press's own dose is in (≤ 4)",
  },
};

/** How long after a press its own dose of a `PER_PRESS_STACK_COOLDOWNS`
 * aura is still that press's (`ownDoseCounts`): the 1214887 dose row comes
 * 0–60 ms after Essence Break's SUCCESS (61 presses, 584 logs). */
export const PER_PRESS_OWN_DOSE_MS = 100;

/** Stacks of `unit`'s own `auraId` strictly before `atMs`, a restated
 * APPLIED (no REMOVED since the last one) keeping the count. */
export function ownStacksBefore(
  unit: Pick<ICombatUnit, "id"> & Partial<Pick<ICombatUnit, "auraEvents">>,
  auraId: string,
  atMs: number,
): number {
  let stacks = 0;
  let up = false;
  for (const e of unit.auraEvents ?? []) {
    if (
      String(e.spellId) !== auraId ||
      e.destUnitId !== unit.id ||
      e.logLine.timestamp >= atMs
    )
      continue;
    const ev = e.logLine.event;
    if (ev === LogEvent.SPELL_AURA_REMOVED) {
      stacks = 0;
      up = false;
    } else if (
      ev === LogEvent.SPELL_AURA_APPLIED_DOSE ||
      ev === LogEvent.SPELL_AURA_REMOVED_DOSE
    ) {
      stacks = e.amount ?? stacks;
      up = true;
    } else if (ev === LogEvent.SPELL_AURA_APPLIED) {
      if (!up) stacks = e.amount ?? 1;
      up = true;
    }
  }
  return stacks;
}

/**
 * Rate carriers whose speed-up is per STACK, not per aura (GH #183): the
 * generated rate row (`conditionalCooldownsGenerated.json`) prices one stack
 * for as long as the buff is up; the recovery runs at 1 + `pctPerStack` % ×
 * the stacks up at the time. The APPLIED row carries no count: it opens at
 * `appliedStacks`, each APPLIED_DOSE / REMOVED_DOSE row then states it.
 * Temporal Burst 431698 (Chronowarden): DB2 bp 1 × PvpMultiplier 0.5 per
 * stack, 30 stacks, one dropping about every second (the log's REMOVED_DOSE
 * 29, 28, … from the APPLIED). Replay on 605-file subsets with the rest of
 * the evoker model on: Preservation Fire Breath dev 1 → 0, Dream Breath 3
 * → 2; hold-out 3 → 0, 1 → 0.
 */
export const STACKED_RATE_CARRIERS: Readonly<
  Record<string, { pctPerStack: number; appliedStacks: number; note: string }>
> = {
  "431698": {
    pctPerStack: 0.5,
    appliedStacks: 30,
    note: "Temporal Burst — cooldowns recover 0.5 % faster per stack (PvP)",
  },
};

/** a Time Spiral aura's REMOVED this long after a cast row is that press */
export const TIME_SPIRAL_PAIR_MS = 50;

/** The instants (ms) `unit` pressed `spellId` for free under Time Spiral:
 * a cast row of the spell followed within `TIME_SPIRAL_PAIR_MS` by the
 * REMOVED of the unit's own Time Spiral aura that lists it. */
export function timeSpiralFreePressMs(
  unit: Pick<ICombatUnit, "id" | "auraEvents">,
  spellId: string,
  castMs: readonly number[],
): number[] {
  const auras = Object.entries(TIME_SPIRAL_FREE_PRESSES)
    .filter(([, r]) => r.spellIds.includes(spellId))
    .map(([a]) => a);
  if (!auras.length || !castMs.length) return [];
  const removed = (unit.auraEvents ?? [])
    .filter(
      (a) =>
        a.logLine.event === LogEvent.SPELL_AURA_REMOVED &&
        a.destUnitId === unit.id &&
        auras.includes(a.spellId ?? ""),
    )
    .map((a) => a.logLine.timestamp);
  const out: number[] = [];
  for (const r of removed) {
    const press = castMs
      .filter((c) => c <= r && r - c <= TIME_SPIRAL_PAIR_MS)
      .reduce((best, c) => Math.max(best, c), Number.NEGATIVE_INFINITY);
    if (Number.isFinite(press) && !out.includes(press)) out.push(press);
  }
  return out;
}

/**
 * A cast row of the same spell this soon after a Time Spiral free press is
 * the free press's echo, not a press (GH #176 codex review): on the 132
 * Time Spiral / Stasis files of the 605 set, 2 of 143 free presses have one,
 * 0.255 s and 0.258 s later (Subtlety Sprint, Marksmanship Aspect of the
 * Cheetah), both 2.7 s / 8.6 s before the cooldown could be back and neither
 * putting its aura up. The next-nearest row is an Evoker's Hover charge
 * 0.94 s later, a press of its own.
 */
export const TIME_SPIRAL_ECHO_MS = 500;

/** The rows of `castMs` that echo a Time Spiral free press of `spellId`. */
export function timeSpiralEchoMs(
  unit: Pick<ICombatUnit, "id" | "auraEvents">,
  spellId: string,
  castMs: readonly number[],
): number[] {
  const free = timeSpiralFreePressMs(unit, spellId, castMs);
  if (!free.length) return [];
  return castMs.filter((c) =>
    free.some((f) => c > f && c - f <= TIME_SPIRAL_ECHO_MS),
  );
}

export interface IIdleCooldownCredit {
  /** spells whose next cooldown the idle time comes off */
  targets: readonly string[];
  /** at most this many seconds a press */
  capSeconds: number;
  note: string;
}

/**
 * A fourth shape (GH #154, 2026-10-20): the time a spell sat READY before a
 * press comes off the cooldown that press starts, up to a cap. Keyed by the
 * talent, hand table, registered in curatedIdRegistry; applied by the
 * ledger's `applyEventReductions`, press by press (each press's idle time
 * starts at the previous press's ready instant, credit and event reductions
 * included).
 *
 * Control of the Dream (Keeper of the Grove, 434249): "Time elapsed while
 * your major abilities are available to be used or at maximum charges is
 * subtracted from that ability's cooldown after the next time you use it, up
 * to 15 seconds. Affects Nature's Swiftness, Incarnation: Tree of Life,
 * [Force of Nature,] [Incarnation: Chosen of Elune | Celestial Alignment,]
 * and Convoke the Spirits" (Restoration the first two, Balance the bracketed
 * ones). DB2 12.1.5.70391: one dummy aura, base points 15, no class mask —
 * a server script, invisible to the mask-keyed talent tables; the log shows
 * no buff for it either, so the idle time is the ledger's own.
 * Targets are the ids the ledger keys (Celestial Alignment 194223 and
 * Chosen of Elune 102560 also log as 383410 / 390414, which the ledger reads
 * as the same entry). A multi-charge target (two charges of Chosen of
 * Elune) gets it through the charge simulation (`IChargeEffects`, 2026-10-20):
 * the time spent at full charges comes off the recharge the next press
 * starts — holders' Chosen of Elune floors at 105 s on a 120 s recharge,
 * non-holders never under it (other.md research, 44 of 326 pairs).
 * Corpus, 2,000 new-season files (every 3rd of the 08-28 manifest),
 * Restoration, Nature's Swiftness recast gaps of players without Call of
 * Ohn'ahra, talents from COMBATANT_INFO (entry 117894): with the talent 34 %
 * come back before the modelled cooldown and none more than 15 s before it;
 * without it 0 %.
 * A round's first press gets the whole cap: the spell sat ready through the
 * preparation phase. Counted from the round's start instead, the ledger's
 * own scan (`ledgerImpossibleCastScan`, the same 2,000 files plus 240
 * downloaded ones) called 55 Balance Force of Nature presses impossible —
 * nearly all the round's second press, 30.0–31.2 s after a first one made
 * well inside 15 s of the gates, on a 45 s cooldown: 45 − 15.
 */
export const IDLE_COOLDOWN_CREDITS: Readonly<
  Record<string, IIdleCooldownCredit>
> = {
  "434249": {
    targets: [
      "132158",
      "33891",
      "473909", // Ancient of Lore, Tree of Life's replacement (GH #179)
      "391528",
      "205636",
      "102560",
      "194223",
    ],
    capSeconds: 15,
    note: "Control of the Dream — the time a target sat ready comes off its next cooldown, ≤ 15 s",
  },
};

/** The idle-credit cap a holder of these talents has on `spellId`; 0 when
 * none applies. */
export function idleCreditCapFor(
  spellId: string,
  holds: (talentSpellId: string) => boolean,
): number {
  let cap = 0;
  for (const [talent, r] of Object.entries(IDLE_COOLDOWN_CREDITS))
    if (r.targets.includes(spellId) && holds(talent))
      cap = Math.max(cap, r.capSeconds);
  return cap;
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
/** The talent a row of `EVENT_COOLDOWN_REDUCTIONS` belongs to: its key, or
 * `talentSpellId` for a talent's second row. */
export function eventReductionOwner(
  key: string,
  r: Pick<IEventCooldownReduction, "talentSpellId">,
): string {
  return r.talentSpellId ?? key;
}

export function eventReductionsFor(
  spellId: string,
  holds: (talentSpellId: string) => boolean,
  /** the unit's spec, for a baseline passive (`ownedBySpecIds`) */
  specId?: string,
): IEventCooldownReduction[] {
  return Object.entries(EVENT_COOLDOWN_REDUCTIONS)
    .filter(
      ([key, r]) =>
        r.targets.includes(spellId) &&
        (holds(eventReductionOwner(key, r)) ||
          (specId !== undefined && !!r.ownedBySpecIds?.includes(specId))) &&
        (r.requiresTalentId === undefined || holds(r.requiresTalentId)) &&
        (r.unlessTalentId === undefined || !holds(r.unlessTalentId)),
    )
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
  // a trigger in the press's own instant counts (codex 59-POSTHOC-11e #7 /
  // 60-POSTHOC-08d #2, 5b724629 r2: a Shockwave's six hits in its own ms —
  // Rumbling Earth — were dropped, and the ledger kept 40 s instead of 25)
  const events = triggers
    .filter((g) => g.atSeconds >= pressSeconds)
    .sort((a, b) => a.atSeconds - b.atSeconds);
  // walk forward: each trigger before the (current) ready instant pulls it in
  let ready = pressSeconds + cooldownSeconds;
  for (const e of events) {
    if (e.atSeconds >= ready) break;
    ready = Math.max(e.atSeconds, ready - e.seconds);
  }
  return ready - pressSeconds;
}

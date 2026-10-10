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
  };

export interface IEventCooldownReduction {
  /** spells whose remaining cooldown drops */
  targets: readonly string[];
  /** the unit's own successful casts that drop it */
  triggerCastIds: readonly string[];
  seconds: number;
  note: string;
}

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
  "1217092": {
    targets: ["108271", "192063", "57994", ...SHAMAN_TOTEM_IDS],
    triggerCastIds: ["188196", "188443"],
    seconds: 1,
    note: "Storm Conduit — Lightning Bolt / Chain Lightning −1 s",
  },
};

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
 * where R is the fixed point described above. `triggerSeconds` are the
 * holder's trigger casts (any order, match seconds).
 */
export function eventReducedCooldownSeconds(
  pressSeconds: number,
  cooldownSeconds: number,
  reductions: readonly IEventCooldownReduction[],
  triggerSecondsOf: (r: IEventCooldownReduction) => readonly number[],
): number {
  if (!reductions.length || !(cooldownSeconds > 0)) return cooldownSeconds;
  const events = reductions
    .flatMap((r) =>
      triggerSecondsOf(r)
        .filter((t) => t > pressSeconds)
        .map((t) => ({ t, s: r.seconds })),
    )
    .sort((a, b) => a.t - b.t);
  // walk forward: each trigger before the (current) ready instant pulls it in
  let ready = pressSeconds + cooldownSeconds;
  for (const e of events) {
    if (e.t >= ready) break;
    ready = Math.max(e.t, ready - e.s);
  }
  return ready - pressSeconds;
}

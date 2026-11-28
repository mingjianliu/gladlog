/**
 * Talent duration extensions the talent's own tooltip states and the corpus
 * confirms (GH #155, 2026-10-21) — the product half of the tooltip reader.
 *
 * User correction 2026-10-21: 「你们完全没有去读天赋……这些已经写得很清楚了。
 * 我们只需要验证就行，不需要盲猜」. The reading is
 * `scripts/datagen/genTalentDurations.ts` (every talent tooltip that says a
 * duration is extended → `talentDurationTooltipsGenerated.json`); the
 * verifying is `packages/eval/scripts/talentDurationVerify.ts`. A row is here
 * only when both agree: on the 605-file new-season capture the holders'
 * lifetimes that ran their course land at base + extension, the
 * non-holders' at the base (`h` = holder lifetimes at the extended value /
 * at the base, `n` = non-holder lifetimes at the base / at the extended
 * value). Rows the hand table (`BUFF_DURATION_TALENT_MODIFIERS`) already
 * prices are not repeated; `test/talentDurationTooltips.test.ts` pins every
 * number here against the generated tooltip reading, so a season's tooltip
 * change turns CI red instead of rotting.
 *
 * Not here, on purpose: Frost Nova 122 (+2 s by 343183, confirmed h 60/5 —
 * a control: control durations keep their official number unless the user
 * rules otherwise); Shadow Word: Pain and Avenging Crusader, whose observed
 * length is the hand table's (another talent stacks — the tooltip row is
 * part of it); every entry the verifier could not confirm.
 *
 * Registered in curatedIdRegistry.
 */

export interface ITooltipDurationRow {
  talentSpellId: string;
  /** DB2 duration of the aura, seconds */
  untalentedBaseSeconds: number;
  addSeconds?: number;
  pct?: number;
  /** the specs whose tooltip branch states it (`CombatUnitSpec` values) */
  specs: readonly string[];
  /** never set here — the hand table's shapes, so one row type reads both */
  specBaseSeconds?: undefined;
  replaceSeconds?: undefined;
}

/** aura id → the confirmed fixed extensions on it */
export const TOOLTIP_DURATION_ROWS: Readonly<
  Record<string, readonly ITooltipDurationRow[]>
> = {
  // Stampeding Roar — Pack's Endurance 441844 「狂奔怒吼的持续时间延长25%」
  // (fact10 D14: 44942dae 0:22 printed 8 s, the aura ran 10.0 s). Verified on
  // the 71 downloaded / fact10-library files holding a Roar (the 605 set has
  // no holder): 77764 h 15/0, n 73/0; 106898 h 6/0, n 18/0. The bear-form
  // copy 77761 (GH #191; the 42 downloaded files that log it, 2026-11-05):
  // holders 2 runs, both 10 s, none at 8 s; non-holders 16 runs, 11 at 8 s,
  // none at 10 s — n = 2 is under talentDurationVerify's 5, priced on the
  // DB2 row + the tooltip's target list (77761 is one of its spellIds) and
  // these runs, upward only (Game-Behaviour Rule 7).
  "77761": [
    {
      talentSpellId: "441844",
      untalentedBaseSeconds: 8,
      pct: 25,
      specs: ["103", "104"],
    },
  ],
  "77764": [
    {
      talentSpellId: "441844",
      untalentedBaseSeconds: 8,
      pct: 25,
      specs: ["103", "104"],
    },
  ],
  "106898": [
    {
      talentSpellId: "441844",
      untalentedBaseSeconds: 8,
      pct: 25,
      specs: ["103", "104"],
    },
  ],
  // Apotheosis — 1215245 「神圣化身的持续时间延长12秒」; h 35/1, n 633/0
  "200183": [
    {
      talentSpellId: "1215245",
      untalentedBaseSeconds: 20,
      addSeconds: 12,
      specs: ["257"],
    },
  ],
  // Havoc — 1244460 +5 s; h 46/0, n 199/0
  "80240": [
    {
      talentSpellId: "1244460",
      untalentedBaseSeconds: 15,
      addSeconds: 5,
      specs: ["267"],
    },
  ],
  // Power Surge — 1272308 +5 s; h 101/0
  "453113": [
    {
      talentSpellId: "1272308",
      untalentedBaseSeconds: 10,
      addSeconds: 5,
      specs: ["257", "258"],
    },
  ],
  // Power Word: Shield — 238135 「…持续时间延长5秒」 (Discipline); h 54/5, n 7/0
  "17": [
    {
      talentSpellId: "238135",
      untalentedBaseSeconds: 15,
      addSeconds: 5,
      specs: ["256"],
    },
  ],
  // Immolate — 388832 +3 s; h 6/0
  "157736": [
    {
      talentSpellId: "388832",
      untalentedBaseSeconds: 18,
      addSeconds: 3,
      specs: ["267"],
    },
  ],
  // Zenith — 391370 +5 s; h 5/0, n 424/0
  "1249625": [
    {
      talentSpellId: "391370",
      untalentedBaseSeconds: 15,
      addSeconds: 5,
      specs: ["269"],
    },
  ],
  // Renew — 440671's Holy branch 「你的恢复的持续时间延长40%」; h 576/26
  "139": [
    {
      talentSpellId: "440671",
      untalentedBaseSeconds: 15,
      pct: 40,
      specs: ["257"],
    },
  ],
  // Darkness — Long Night 389781 「黑暗的持续时间延长${$s1/1000}秒」 (+3 s; DB2
  // row 1026249: aura 107 misc 1, +3000 ms, class mask [0,0,8192,0] covering
  // 196718) and Cover of Darkness 357419 (PvP) 「…持续时间延长${$s2/1000}秒」
  // (+4 s; row 891976, the same aura / mask). Darkness logs no aura, so
  // talentDurationVerify measures nothing; the corpus leg is the zone's own
  // absorb rows (209426, source = the demon hunter), press → last row (GH #173
  // Q5, 2026-11-07; 605 + wide cap-final2, talents from COMBATANT_INFO): Long
  // Night alone 92 presses, last row up to 11.02 s (60 past 8.5 s); neither
  // talent 381 presses, none past 8.02 s (fact11 39-23-361: rows to +10.65 s
  // beside a span the 8 s model called defenseless). Cover of Darkness: 5
  // presses — alone 2, at 11.26 / 11.61 s (≤ 12); with Long Night 3, up to
  // 12.31 s (≤ 15). Upward only (Game-Behaviour Rule 7).
  "196718": [
    {
      talentSpellId: "389781",
      untalentedBaseSeconds: 8,
      addSeconds: 3,
      specs: ["577", "581", "1480"],
    },
    {
      talentSpellId: "357419",
      untalentedBaseSeconds: 8,
      addSeconds: 4,
      specs: ["577", "581", "1480"],
    },
  ],
  // Atonement — 440671's Discipline branch +4 s; h 252/6, n 89/7
  "194384": [
    {
      talentSpellId: "440671",
      untalentedBaseSeconds: 15,
      addSeconds: 4,
      specs: ["256"],
    },
  ],
  // Remorseless Winter (Frost) — 444099 +2 s; h 15/0, n 106/1
  "1233152": [
    {
      talentSpellId: "444099",
      untalentedBaseSeconds: 12,
      addSeconds: 2,
      specs: ["251"],
    },
  ],
  // 450342 — 450514 +3 s; h 12/0, n 54/0
  "450342": [
    {
      talentSpellId: "450514",
      untalentedBaseSeconds: 5,
      addSeconds: 3,
      specs: ["268", "269", "270"],
    },
  ],
  // Cloak of Shadows — 457022 +2 s; h 21/0, n 416/0
  "31224": [
    {
      talentSpellId: "457022",
      untalentedBaseSeconds: 5,
      addSeconds: 2,
      specs: ["259", "261"],
    },
  ],
  // Renewing Mist — 458431 +2 s; h 136/12, n 2/0
  "119611": [
    {
      talentSpellId: "458431",
      untalentedBaseSeconds: 20,
      addSeconds: 2,
      specs: ["270"],
    },
  ],
  // Desperate Prayer — 458718 「绝望祷言的持续时间提高10秒」; h 133/0, n 56/0
  "19236": [
    {
      talentSpellId: "458718",
      untalentedBaseSeconds: 10,
      addSeconds: 10,
      specs: ["256", "257"],
    },
  ],
  // Anti-Magic Zone — Assimilation 374383 「反魔法领域的冷却时间缩短…，持续时间延长
  // ${$s2/1000}秒」 (+2 s; DB2 row 1245953: aura 107 misc 1, +2000 ms, class mask
  // [0,524288,0,0] covering 51052 and 145629). The zone's aura is written with
  // no source (`0000000000000000,nil`), so until pipeline T14 the verifier
  // had no holder at all; caster = the one player whose Anti-Magic Zone
  // SUCCESS came ≤ 1 s before it: h 7/0, n 0/103 (605 set, 2026-11-08). The
  // cast id carries the same row for the kit's `lasts` and the save lifetime.
  "145629": [
    {
      talentSpellId: "374383",
      untalentedBaseSeconds: 6,
      addSeconds: 2,
      specs: ["250", "251", "252"],
    },
  ],
  "51052": [
    {
      talentSpellId: "374383",
      untalentedBaseSeconds: 6,
      addSeconds: 2,
      specs: ["250", "251", "252"],
    },
  ],
  // Lightning Rod — 468625 +4 s; h 8/0, n 6/0
  "197209": [
    {
      talentSpellId: "468625",
      untalentedBaseSeconds: 8,
      addSeconds: 4,
      specs: ["262"],
    },
  ],
};

interface ITooltipPerEventBase {
  talentSpellId: string;
  untalentedBaseSeconds: number;
  /** seconds added by each qualifying event while the aura is up */
  addSecondsPerEvent: number;
  specs: readonly string[];
}

/** The event is one of the caster's own presses. */
export interface ITooltipPerPressDuration extends ITooltipPerEventBase {
  event: "press";
  /** the most the presses can add; absent when the tooltip names none */
  capSeconds?: number;
  /** the presses that count — 「带有施法时间的法术」: the class's spells
   * whose DB2 cast time is > 0, instant or not on that press */
  qualifyingSpellIds: ReadonlySet<string>;
  /** qualifying casts the game makes with no SPELL_CAST_SUCCESS row, read
   * off their effect rows (`hiddenCastRows`), by effect id */
  hiddenCastEffects?: Readonly<Record<string, IHiddenCastEffect>>;
  /** the caster's next press of one of these ends the application as its
   * REMOVED does: no later press extends it (a re-roll replaces the roll) */
  endsAtCastIds?: readonly string[];
  /** `addSecondsPerEvent` is one purchased rank's (a tiered talent); the
   * caster's rank multiplies it (`talentRankOf` — a rank that cannot be
   * read adds nothing) */
  perRank?: true;
  /** presses that add a share of the amount, by cast id — the rest add all
   * of it (a recast the game makes at reduced effectiveness) */
  eventShareBySpellId?: Readonly<Record<string, number>>;
  /** the caster's own aura of the same application, when this one sits on
   * another unit (a pet): the run the walk is bounded by */
  runAuraId?: string;
}

/** An effect row id whose rows can stand for casts the log did not write. */
export interface IHiddenCastEffect {
  /** the logged cast that sends one row of it at its own target */
  castId: string;
  /** other presses that send rows of it with no cast row of that spell */
  otherTriggerIds?: readonly string[];
}

/** The event is a critical tick of the aura's own damage on the unit it is
 * on — a fully absorbed crit (SPELL_PERIODIC_MISSED ABSORB, crit flag set)
 * counts too. Each copy on each unit grows on its own, so it is priced only
 * for one application on one unit (`buffFullDurationForCaster`'s
 * `onUnitId`); a reader with neither prints the base. No cap. */
export interface ITooltipPerCritDuration extends ITooltipPerEventBase {
  event: "own-crit";
}

/** The event is the caster gaining (a stack of) another aura of its own —
 * each APPLIED / APPLIED_DOSE row of `gainAuraId` on it while the aura is
 * up. No cap. */
export interface ITooltipAuraGainDuration extends ITooltipPerEventBase {
  event: "aura-gain";
  gainAuraId: string;
  /** a second talent that lengthens the application at its start by the
   * stacks of an aura the caster holds at that instant (the press spends
   * them) */
  startStacks?: {
    talentSpellId: string;
    stackAuraId: string;
    secondsPerStack: number;
    capSeconds: number;
  };
}

export type ITooltipPerEventDuration =
  ITooltipPerPressDuration | ITooltipPerCritDuration | ITooltipAuraGainDuration;

// Spiritwalker's Momentum 443425: 「使用带有施法时间的法术会使灵魂行者的恩赐和
// 灵魂行者的神盾的持续时间延长1秒，最多可延长4秒」. 605 files, per holder
// application, base + min(4, qualifying presses) vs the logged lifetime:
// Spiritwalker's Grace 131 of 159 within 0.5 s (0 presses +0 ×3, 1 → +1
// ×12, 2 → +2 ×7, 3 → +3 ×7, 4+ → +4 ×101), non-holders 178 of 195 at 15 s;
// Spiritwalker's Aegis 118 of 162 (the misses run LONGER, open).
// T246 — casts with no cast row extend it too, each at the time of the
// press that sent it (`hiddenCastRows`): a Lava Burst cast also lands on
// other enemies (c5b55e06 r2 2:13: one cast, hits on two enemies, Aegis
// 7.0 s), Ascendance 114050 fires a volley of them (f85431cc r1 0:34: six
// hits, one logged Lava Burst after, Aegis 9.0 s), and under Restoration's
// Ascendance a Healing Wave heals a second ally (7f107afb r1 2:33; the
// 114052 tooltip names the additional ally). A volley pressed before the
// aura went on extends nothing, though hits of it land after (c5b55e06
// 18:45:34 log time: 8.0 s with three such rows inside); Lava Burst
// Overload 285466 rows do not count (same run). DB2 gives Momentum the 1 s
// and the 4 s cap with zero class masks and no spell list, so what counts
// is read off the logs.
// An Ascendance logged just ahead of the aura's APPLIED row in one
// millisecond is inside the run with its whole volley (2cd6b75d r1 6:37:
// Aegis 9.0 s; daac4802 r4 0:27).
// Counts below are a raw-log replica of this rule (a script over the log
// rows, without the same-millisecond ordering), not the product's own
// output. 605 files, every closed run on a holder with no dispel or steal
// row of that holder's aura, prediction vs logged life within 0.5 s — cast
// rows alone → with these:
// Spiritwalker's Aegis (162 runs) 109 → 158 exact, 50 → 1 short, 3 → 3
// past; Spiritwalker's Grace (153) 129 → 139 exact, 11 → 1 short, 13 → 13
// past. No run moves to "past" (an aura that ended before its printed
// length: 11 of the 13 Grace runs ended under 14.5 s, a death (17664ae3
// r3: PARTY_KILL in the removal's millisecond) or a cancel; 28c39eb1 r4
// and eadf9636 r3 ran 17.6 / 17.8 s against 19 on both readings, open).
// Still short, open: 197491d6 r5 Aegis 9.0 s against 7 (a Lava Burst cast
// 0.1 s before the aura, its hits after) and cf909ac1 r1 Grace 24.0 s
// against 19.
// The 285 files of the 12.1.5 set, same replica: Aegis (250 runs) 178 →
// 244 exact, 68 → 1 short, 4 → 5 past — the one run that moves to "past"
// (cfe9ade3 r2, 9 against 8.2 s) ended at its shaman's death, Grace with
// it; Grace (231) 188 → 209 exact, 21 → 0 short, 22 → 22 past. The
// product itself, counted by the reviewer on the tree before the
// same-millisecond fix (codex 85-tk-L1-T246-1c): Aegis 242 of 250, Grace
// 210 of 231.
const SHAMAN_HIDDEN_CAST_EFFECTS: Readonly<Record<string, IHiddenCastEffect>> =
  {
    // Lava Burst's hit; Ascendance 114050 fires it with no Lava Burst cast row
    "285452": { castId: "51505", otherTriggerIds: ["114050"] },
    // Healing Wave's heal
    "77472": { castId: "77472" },
  };
const SHAMAN_CAST_TIME_SPELLS: ReadonlySet<string> = new Set([
  "1064",
  "2008",
  "3606",
  "8004",
  "51505",
  "51514",
  "57984",
  "73920",
  "77472",
  "117014",
  "118297",
  "118905",
  "120588",
  "157331",
  "157348",
  "188196",
  "188443",
  "191634",
  "210873",
  "211004",
  "211015",
  "269352",
  "277778",
  "277784",
  "309328",
  "452201",
  "458147",
]);

/**
 * What a Roll the Bones press (1214909) gives: one combat enhancement per
 * roll, the aura its length is read from (`PRESS_OUTCOME_AURAS`). Raw rows
 * of the 605 and the 285-file 12.1.5 set (pipeline T273): 402 of 402 rolls
 * are followed by exactly one APPLIED of these within 0.3 s.
 */
export const ROLL_THE_BONES_CAST_ID = "1214909";
export const ROLL_ENHANCEMENT_AURA_IDS = [
  "1214933", // One of a Kind
  "1214934", // Double Trouble
  "1214935", // Triple Threat
  "1214937", // Jackpot
] as const;

/**
 * A press whose length is that of another aura it gives, not of the aura
 * under its own id: cast id → those auras. Roll the Bones' own 1214909 is a
 * marker that Keep It Rolling does not always extend (1ce02e10 r3: the
 * marker gone at 30.0 s, One of a Kind at 60.0 s). Read by
 * `pressAuraCandidates`, so the [PRESS] line and its gate follow the same
 * row. Registered in curatedIdRegistry.
 */
export const PRESS_OUTCOME_AURAS: Readonly<Record<string, readonly string[]>> =
  { [ROLL_THE_BONES_CAST_ID]: ROLL_ENHANCEMENT_AURA_IDS };

// Keep It Rolling 381989 — live 12.1.5 tooltip: "Increase the remaining
// duration of your active Roll the Bones combat enhancement by ${$s1/1000}
// sec" (effect 0 dummy, bp 30000); a press of its own, so the talent is the
// cast. It extends the enhancement the roll gave (DB2 30 s each), and the
// next roll replaces that enhancement: a press after it extends the new one
// (52816a5f r1: One of a Kind at 23.3 s, re-rolled into Jackpot at 45.4 s,
// Keep It Rolling at 47.4 s — the first roll ran its 30 s share only).
// Pipeline T273, raw rows of the 605 and the 285-file 12.1.5 set, each
// roll's enhancement from its APPLIED to its REMOVED against 30 s + 30 s
// per press inside it and before the next roll (84 | 302 with a REMOVED):
// at the model 48 | 114, ended sooner (a re-roll, a death, the round's
// end) 36 | 187, longer 0 | 1 (9af1eba3 r1: a re-roll removed it at 31.3 s).
const ROLL_ENHANCEMENT_ROWS: Record<string, ITooltipPerPressDuration> =
  Object.fromEntries(
    ROLL_ENHANCEMENT_AURA_IDS.map((id) => [
      id,
      {
        event: "press" as const,
        talentSpellId: "381989",
        untalentedBaseSeconds: 30,
        addSecondsPerEvent: 30,
        specs: ["260"],
        qualifyingSpellIds: new Set(["381989"]),
        endsAtCastIds: [ROLL_THE_BONES_CAST_ID],
      },
    ]),
  );

// Dark Transformation 1233448 (pipeline T309, user ruling 2026-11-27: an
// aura that outlives its official length has a mechanism to model). Its own
// tooltip: 「凋零缠绕和扩散会使此效果的持续时间延长${$390268s1/1000}.1秒」 —
// Death Coil and Epidemic extend it by 1 s (Eternal Agony 390268 effect 0,
// a dummy with base 1000 ms and no class mask or label: scripted, so what
// counts is read off the logs, as for Spiritwalker's Momentum). The talent
// is the press itself, so every Unholy caster of it has the row. The press
// puts 1235391 on the death knight and 1233448 on the ghoul; both end in one
// millisecond (96ada059 r0: 19.011 s after four Death Coils).
// Raw rows, every closed run of 1235391 with no REFRESH inside, logged life
// against 15 s + 1 s per own cast inside it of Death Coil 47541 / Epidemic
// 207317 and of what replaces each on the bar, Necrotic Coil 1242174 /
// Graveyard 383269, within 0.2 s — 605 files | the 1215-set:
//   at the model 632 of 751 | 311 of 379 (at a flat 15 s: 16 | 20);
//   shorter 115 | 63 — the round ended inside it 74 | 37, its death knight
//   died 21 | 12, neither 20 | 14 (open: the ghoul's death is not read);
//   longer 4 | 5, by 0.4–2.0 s (open).
// Death Strike does not count (96ada059 r0: 17.008 s with two Death Coils
// and one Death Strike), nor a Death Coil cast by a summoned rider (445513,
// a creature's row). No cap is named and none shows (26.0 s with nine).
const DARK_TRANSFORMATION_ROW: ITooltipPerPressDuration = {
  event: "press",
  talentSpellId: "1233448",
  untalentedBaseSeconds: 15,
  addSecondsPerEvent: 1,
  specs: ["252"],
  qualifyingSpellIds: new Set(["47541", "207317", "1242174", "383269"]),
};
const DARK_TRANSFORMATION_ROWS: Record<string, ITooltipPerPressDuration> = {
  // the ghoul's aura, under the cast's id — walked on the death knight's
  // own copy, which goes up and off with it
  "1233448": { ...DARK_TRANSFORMATION_ROW, runAuraId: "1235391" },
  // the death knight's own
  "1235391": DARK_TRANSFORMATION_ROW,
};

/** aura id → its per-event extension */
export const TOOLTIP_PER_EVENT_DURATIONS: Readonly<
  Record<string, ITooltipPerEventDuration>
> = {
  "79206": {
    event: "press",
    talentSpellId: "443425",
    untalentedBaseSeconds: 15,
    addSecondsPerEvent: 1,
    capSeconds: 4,
    specs: ["262", "264"],
    qualifyingSpellIds: SHAMAN_CAST_TIME_SPELLS,
    hiddenCastEffects: SHAMAN_HIDDEN_CAST_EFFECTS,
  },
  "378078": {
    event: "press",
    talentSpellId: "443425",
    untalentedBaseSeconds: 5,
    addSecondsPerEvent: 1,
    capSeconds: 4,
    specs: ["262", "264"],
    qualifyingSpellIds: SHAMAN_CAST_TIME_SPELLS,
    hiddenCastEffects: SHAMAN_HIDDEN_CAST_EFFECTS,
  },
  // Capacitance 1270724 (Mountain Thane): 「在天神下凡期间，雷霆轰击会使天神
  // 下凡的持续时间延长2秒」, read for Fury and Protection, no cap named. GH
  // #173 D13 / T76: Arms runs are 20.0 s; Fury runs are 24 / 26 / 28 s —
  // 20 + 2 per Thunder Blast (435222) pressed inside the growing window.
  "107574": {
    event: "press",
    talentSpellId: "1270724",
    untalentedBaseSeconds: 20,
    addSecondsPerEvent: 2,
    specs: ["72", "73"],
    qualifyingSpellIds: new Set(["435222"]),
  },
  ...ROLL_ENHANCEMENT_ROWS,
  ...DARK_TRANSFORMATION_ROWS,
  // FLAG, not modelled (pipeline T309): Vengeful Beast 1265818 — 「恶魔变形
  // 的持续时间延长${$s1/1000}秒」, DB2 aura 107 op 1 +5000 ms, class mask
  // covering Vengeance's Metamorphosis 187827 — has no corpus leg: 0 lives
  // of 187827 in the 605 files and in the 1215-set.
  // Combustion 190319 (pipeline T309 c), two Fire talents:
  // · Fired Up 1257348: 「焚烧殆尽现在会将燃烧的持续时间延长${$s2/1000}.1秒」
  //   — effect 1 is a label modifier (aura 219, op 23, label 5673, base
  //   1000 ms) whose label covers no observed spell, and nothing of the
  //   talent reaches 190319 by class mask or label: the script reads the
  //   value. Each gain of its buff 1257350 (APPLIED / APPLIED_DOSE on the
  //   mage) while Combustion is up adds 1 s
  //   (05b762f1: 13.0 / 12.0 / 13.0 s with 3 / 2 / 3 gains). Every Fire
  //   mage in both sets holds it.
  // · Savor the Moment 449412 (Sunfury): 「当你施放燃烧时，每有一个法术火焰
  //   宝珠，其持续时间就延长${$s1/1000}.1秒，最多${$s2/1000}.1秒」 — 0.8 s
  //   per Spellfire Sphere 448604 held at the cast, up to 2.4 s (effect 0:
  //   aura 219, op 23, 800 ms on label 3511 = the sphere; effect 1: 2400);
  //   the cast removes the spheres 1–23 ms after Combustion's APPLIED.
  // Raw rows, pressed closed runs not cut by a death or the round's end,
  // life against 10 s + 1 s per gain inside the growing window, within
  // 0.3 s — 605 files | the 1215-set: non-holders of Savor the Moment 169
  // of 169 | 92 of 93 (at a flat 10 s: 3 | 3 of all 446 | 419); its
  // holders run 0.8 / 1.6 / 2.4 s past that reading with 1 / 2 / 3 spheres.
  // FLAG, known open (buffDurationScan --per-app, clean lives exact: 471 of
  // 479 | 433 of 451, shorter 0): reads short by 0.8 s per uncounted start
  // sphere, never long — the sphere count comes from numbered DOSE rows
  // only, and 19 of the 27 longer lives have a sphere-sized gap with no
  // numbered row before the cast (562fab04: 12.8 s read, 14.4 s logged =
  // three spheres). Reading it off sphere REFRESH rows / Glorious
  // Incandescence procs is pipeline T338.
  "190319": {
    event: "aura-gain",
    talentSpellId: "1257348",
    untalentedBaseSeconds: 10,
    addSecondsPerEvent: 1,
    specs: ["63"],
    gainAuraId: "1257350",
    startStacks: {
      talentSpellId: "449412",
      stackAuraId: "448604",
      secondsPerStack: 0.8,
      capSeconds: 2.4,
    },
  },
  // Chosen of Frostbrood 1265633 (pipeline T309 b; two ranks): 「冰霜巨龙
  // 之怒使一个激活的冰霜之柱的持续时间延长${$s1/1000}.1秒」 — effect 0 a
  // dummy, base 2000 ms per rank, no class mask and no label (scripted).
  // Its node also lets Frostwyrm's Fury be cast again 「以$s2%的效果」
  // (1265637 effect 1: 50) — the recast is 1265384, and it extends by that
  // share. Every holder in both sets has rank 2 (COMBATANT_INFO): 4 s per
  // Frostwyrm's Fury 279302 and 2 s per recast. Raw rows, closed runs of
  // 51271 not cut by a death or the round's end, holders of The Long Winter
  // apart, life against 12 + 4 × 279302 + 2 × 1265384 cast inside, within
  // 0.3 s — 605 files | the 1215-set: 121 of 121 | 44 of 44 (at a flat
  // 12 s: 49 | 23; lives of 12 / 14 / 16 / 18 s).
  // Open: The Long Winter 456240 (auto-attack crits, +1 s each up to 4 s)
  // stacks on the same aura — one holder in both sets (68e7d162, 14 lives),
  // not modelled; a rank-1 holder is unseen (the row prices it at 2 / 1 s,
  // DB2's per-rank value).
  "51271": {
    event: "press",
    talentSpellId: "1265633",
    untalentedBaseSeconds: 12,
    addSecondsPerEvent: 2,
    perRank: true,
    specs: ["251"],
    qualifyingSpellIds: new Set(["279302", "1265384"]),
    eventShareBySpellId: { "1265384": 0.5 },
  },
  // Burn to Ash 446663: 「真理觉醒爆击时，其持续时间延长$s1秒」 (effect 0
  // dummy, bp 2) on Truth's Wake 403695, Wake of Ashes' DoT (DB2 9 s). GH
  // #183, 2026-11-03, raw ticks of 605-file subsets: non-holders 54 of 54
  // run 9 s; holders run 9 + 2 × their crit ticks — absorbed crits
  // included — save 1–2 (a crit at the REMOVED millisecond)
  "403695": {
    event: "own-crit",
    talentSpellId: "446663",
    untalentedBaseSeconds: 9,
    addSecondsPerEvent: 2,
    specs: ["70"],
  },
};

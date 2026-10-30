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

export interface ITooltipPerEventDuration {
  talentSpellId: string;
  untalentedBaseSeconds: number;
  /** seconds added by each qualifying press while the aura is up */
  addSecondsPerEvent: number;
  capSeconds: number;
  specs: readonly string[];
  /** the presses that count — 「带有施法时间的法术」: the class's spells
   * whose DB2 cast time is > 0, instant or not on that press */
  qualifyingSpellIds: ReadonlySet<string>;
}

// Spiritwalker's Momentum 443425: 「使用带有施法时间的法术会使灵魂行者的恩赐和
// 灵魂行者的神盾的持续时间延长1秒，最多可延长4秒」. 605 files, per holder
// application, base + min(4, qualifying presses) vs the logged lifetime:
// Spiritwalker's Grace 131 of 159 within 0.5 s (0 presses +0 ×3, 1 → +1
// ×12, 2 → +2 ×7, 3 → +3 ×7, 4+ → +4 ×101), non-holders 178 of 195 at 15 s;
// Spiritwalker's Aegis 118 of 162 (the misses run LONGER, open).
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

/** aura id → its per-event extension */
export const TOOLTIP_PER_EVENT_DURATIONS: Readonly<
  Record<string, ITooltipPerEventDuration>
> = {
  "79206": {
    talentSpellId: "443425",
    untalentedBaseSeconds: 15,
    addSecondsPerEvent: 1,
    capSeconds: 4,
    specs: ["262", "264"],
    qualifyingSpellIds: SHAMAN_CAST_TIME_SPELLS,
  },
  "378078": {
    talentSpellId: "443425",
    untalentedBaseSeconds: 5,
    addSecondsPerEvent: 1,
    capSeconds: 4,
    specs: ["262", "264"],
    qualifyingSpellIds: SHAMAN_CAST_TIME_SPELLS,
  },
};

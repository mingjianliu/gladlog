/**
 * castMissRows.ts — which `SPELL_MISSED` row is a control cast's own, and
 * which miss types say the control did not land. One reading for
 *  - the fail tags of our own control casts (`[IMMUNE …]`, `[MISSED on …]`,
 *    `[REFLECTED by …]` on `[YOU] [CC]` / `[TEAM] [CC]` lines —
 *    `timelineSections/setup.ts`: `ccImmuneTagFor`, `ccMissTagFor`), and
 *  - the `logged <TYPE>` half of a `[CC AVOIDED?]` line (FT-T16 D15 "3c" —
 *    `ccTrinketAnalysis.ts`), whose gate
 *    (`promptQualityCheck.checkCcAvoidedMissType`) re-parses the type.
 *
 * Extracted from `setup.ts` when the second reader arrived (Shared-Predicate
 * Rule); the windows, the attribution rule and the type table are unchanged.
 */
import { LogEvent } from "@gladlog/parser-compat";

import {
  castAndEffectIds,
  effectAuraHitShare,
  effectAurasOfCast,
  effectAuraViaName,
} from "../data/castEffectAuras";
import { PRESS_TRIGGERED_CAST_IDS } from "../data/pressTriggeredCastsGenerated";
import { getEnglishSpellName } from "../data/spellEffectData";
import { ccSpellIds } from "../data/spellTags";
import { toRenderSecond } from "./renderGrid";

/** How often a cast's control effect must follow the cast for a miss of the
 * cast's own id to stand for that control (`missReportsControl`). */
export const CONTROL_EFFECT_MIN_HIT_SHARE = 0.5;

/**
 * Does a SPELL_MISSED row of this id say a CONTROL did not land? Yes for a
 * control's own id (`ccSpellIds`). For a cast whose control lives on another
 * id (the cast→effect table), only when that control is the cast's usual
 * result — it followed at least half of the corpus's casts. A control the
 * game applies only to some targets is not: Wake of Ashes' stun 255941 takes
 * demons and undead, after 1,240 of 5,228 casts (24 %), and the IMMUNE / MISS
 * row of its damage id 255937 on any other player is a damage miss (fact1215
 * C10, 0f894aee 1:54: 66 `[CC NOT LANDED] … Wake of Ashes` lines on the 605
 * capture). The unconditional pairs sit well above the bar: Holy Word:
 * Chastise → 200200 83 %, Capacitor Totem → 118905 84 %, Sigil of Misery →
 * 207685 72 %, Storm Bolt → 132169 95 %.
 */
export function missReportsControl(missSpellId: string): boolean {
  return isControlCast(missSpellId);
}

/**
 * fact2 C10 (2026-10-20): is this CAST id a control — the one answer for every
 * reader that holds a press and asks the aura-keyed hard-CC set
 * (`ccSpellIds` lists Ring of Frost by its 82691, Freezing Trap by 3355,
 * Intimidation by 24394, Song of Chi-Ji by 198909, Sigil of Misery by 207685,
 * Lightning Lasso by 305485 …): the `[YOU] [CC]` / `[TEAM]` line kind,
 * cc-held, the team's control cooldowns, peel options, the healer's CC
 * counts, the crisis control answers, the miss rows above. Yes for a
 * control's own id; for a cast whose control lives on another id, when that
 * control is the cast's own effect — DB2 names it after the cast (`via`
 * "name") — and its usual result (`CONTROL_EFFECT_MIN_HIT_SHARE` of the
 * casts). Not Wake of Ashes' demon-and-undead stun (24 %), not Summon
 * Infernal's Infernal Awakening (a triggered spell of another name: the
 * press is the offensive cooldown, the stun is what its summon does on
 * landing).
 */
export function isControlCast(castSpellId: string): boolean {
  return castControlsIn(castSpellId, ccSpellIds);
}

/**
 * Control ids whose control the game never puts on a PLAYER (fact6 D19 /
 * D20, 2026-10-28): the press reaches players with its damage or another
 * effect, and its control aura lands on NPCs only. The aura stays a control
 * (`ccSpellIds` keeps it: a stunned pet is stunned — DR, dispel priority and
 * `isCastBlockingAuraType` read the aura); a PRESS or a MISS ROW of one is no
 * control aimed at a player (`castControlsIn`, `controlReachesPlayers`).
 * Game-Behaviour evidence per entry:
 *  - 200166 Metamorphosis (Havoc landing). DB2 `Spell.Description_lang` of
 *    191427 (12.1.5.70391): "…并使其昏迷$200166d。如果是玩家则改为眩晕
 *    $247121d。" — players are Dazed (247121, mechanic 11) instead. The
 *    SpellEffect rows (aura 12 stun, targets 22/15) carry no player
 *    exclusion; the tooltip is the official statement. Corpus (605
 *    every-30, 155 files): 200166 applied on players 0, on NPCs 36; its
 *    SPELL_DAMAGE on players 72. Before: a400c9d8 2:26 / cb851d66 0:38
 *    `[CC AVOIDED?] … Metamorphosis … logged IMMUNE` (the damage and daze
 *    bouncing off Ice Block / Cyclone), and friendly DHs' `[CC NOT LANDED]
 *    … Metamorphosis — logged MISS`.
 * Not listed: Wake of Ashes' 255941 ("demons and undead"; no player row in
 * the 155 files — its cast 255937 already fails the hit-share rule).
 * Completeness: `controlNoPlayerEffect`'s forward inventory
 * (`packages/eval/scripts/scan5/ccLanded.ts`).
 */
export const NO_PLAYER_CONTROL_IDS: ReadonlySet<string> = new Set(["200166"]);

/** Can a press / miss row of this id be a control on a player? */
export function controlReachesPlayers(spellId: string): boolean {
  return !NO_PLAYER_CONTROL_IDS.has(spellId);
}

/** `isControlCast` over another aura-keyed control set (the crisis answers'
 * hard CC ∪ roots ∪ interrupts): the cast's own id is in it, or its own
 * same-named effect aura is, after at least `CONTROL_EFFECT_MIN_HIT_SHARE`
 * of its casts. */
export function castControlsIn(
  castSpellId: string,
  auraIds: ReadonlySet<string>,
): boolean {
  if (!controlReachesPlayers(castSpellId)) return false;
  if (auraIds.has(castSpellId)) return true;
  return effectAurasOfCast(castSpellId).some(
    (aura) =>
      auraIds.has(aura) &&
      effectAuraViaName(castSpellId, aura) &&
      (effectAuraHitShare(castSpellId, aura) ?? 0) >=
        CONTROL_EFFECT_MIN_HIT_SHARE,
  );
}

/** A miss row can precede its cast's SPELL_CAST_SUCCESS by this much (same
 * instant, logged in either order). */
export const CAST_MISS_LEAD_MS = 100;
/** … and follow it by this much: an instant control misses on the same
 * instant, a Polymorph projectile lands up to ~1.5 s later. */
export const CAST_MISS_WINDOW_MS = 2500;

/** The fields of a `SPELL_MISSED` row the twin test asks. */
export interface IMissTwinRow {
  timestamp: number;
  spellId?: string;
  spellName?: string;
  missType?: string;
}

/**
 * One failure of one press, logged twice — under the cast id and under its
 * control effect's id (95127ab4: Maim 22570 and its stun 203123, 4 ms apart;
 * fact12 D30, ee79ddb7 r0 0:45: Intimidation 474421 and its stun 24394 in one
 * millisecond), or as two parts of one control in one rendered second (wide
 * 197-3 2:33: Binding Shot's tether 117405 and its stun 117526, 315 ms
 * apart): the same miss type, and within `CAST_MISS_LEAD_MS` of each other or
 * the same English name in the same rendered second. Whose rows they are (the
 * caster, its summon) and on whom is the caller's to ask. Readers:
 * `[CC NOT LANDED]` (`missStatedOnAnotherLine`) and the ENEMY CC KIT's
 * `aimed at … N×` (`aimedControlsForKit`), which counts presses.
 */
export function isTwinMissRow(
  a: IMissTwinRow,
  b: IMissTwinRow,
  matchStartMs: number,
): boolean {
  if (a.missType !== b.missType) return false;
  if (Math.abs(a.timestamp - b.timestamp) <= CAST_MISS_LEAD_MS) return true;
  const nameOf = (x: IMissTwinRow) =>
    getEnglishSpellName(x.spellId ?? "", x.spellName ?? "");
  const secondOf = (x: IMissTwinRow) =>
    toRenderSecond((x.timestamp - matchStartMs) / 1000);
  return (
    nameOf(a) !== "" && nameOf(a) === nameOf(b) && secondOf(a) === secondOf(b)
  );
}

/**
 * The miss falls in the cast's window AND no later cast of the same spell by
 * the same caster happened at or before it — it belongs to the latest cast
 * before it (codex astra 2026-09-25: with only a window, a Polymorph reflected
 * at 31.55 s tagged the landed 30.0 s cast and left the reflected 31.5 s cast
 * bare).
 *
 * @param sameSpellCastMs every SPELL_CAST_SUCCESS time of that spell by that
 *   caster (the cast itself may be among them).
 * @param afterMs how long after the cast the miss may come — a control that
 *   lands seconds after its cast is asked with its own landing delay.
 */
export function missBelongsToCast(
  sameSpellCastMs: readonly number[],
  castMs: number,
  missMs: number,
  afterMs: number = CAST_MISS_WINDOW_MS,
): boolean {
  if (missMs < castMs - CAST_MISS_LEAD_MS || missMs > castMs + afterMs)
    return false;
  return !sameSpellCastMs.some(
    (t) => t > castMs + 5 && t <= missMs + CAST_MISS_LEAD_MS,
  );
}

/** The fields of a `SPELL_MISSED` row the press-refused reading asks. */
export interface IPressMissRow {
  spellId?: string;
  missType: string;
  destUnitId?: string;
  timestamp: number;
  logLine?: { event?: unknown };
}

/**
 * The IMMUNE rows that are ONE press's own refusal: a non-periodic
 * `missType IMMUNE` row of the cast's id or one of its effect auras
 * (`castAndEffectIds` — Storm Bolt's IMMUNE is logged under its stun 132169)
 * that belongs to the press by the cast window (`missBelongsToCast`). A later
 * DoT tick's IMMUNE is not the press going into an immunity (fact2,
 * 2026-10-20, 15c06404 1:54: Kingsbane's own hit landed; its ticks at +2.0 s
 * met a Spellwarding thrown 1.7 s later).
 *
 * The one "did the game refuse this press" reading (fact6 D14, F20): the cast
 * line's `[IMMUNE …]` tag (`setup.ts ccImmuneTagFor`), the KILL ATTEMPTS burst
 * anchor (`killAttempts.ts anchorNameOf` — a press refused on the target is
 * not the burst that hit it: 2b3fba97-r0 2:27 Deathmark into Time Stop), and
 * the buff-fade estimate's "this press put no buff anywhere"
 * (`timelineHelpers.ts`, fact4 D1).
 *
 * @param misses the caster's `missesOut`.
 * @param sameSpellCastMs every SPELL_CAST_SUCCESS time of that spell by that
 *   caster (`missBelongsToCast`).
 * @param followUp the caster's cast rows and the press's target: the IMMUNE
 *   rows of the press's follow-up impact rows count too
 *   (`pressFollowUpCastRows` — The Hunt's 1246169).
 */
export function pressImmuneMissRows<T extends IPressMissRow>(
  misses: readonly T[] | undefined,
  spellId: string,
  sameSpellCastMs: readonly number[],
  castMs: number,
  followUp?: IPressFollowUp,
  /** the caster's damage and heal rows (`damageOut` + `healOut`): an IMMUNE
   * on a unit a non-control press landed on anyway is one component refused,
   * not the press (`pressLandedOn`, fact11 D10) */
  landed?: readonly IPressHitRow[],
): T[] {
  if (!misses || misses.length === 0) return [];
  const out = pressImmuneMissRowsAll(
    misses,
    spellId,
    sameSpellCastMs,
    castMs,
    followUp,
  );
  // a control's refused control is the refusal whatever else of it landed
  // (Storm Bolt's damage into a stun immunity: the stun 132169 IMMUNE is the
  // press refused) — the landed reading is for a press whose purpose is not
  // the component the immunity stopped
  if (!landed || ccSpellIds.has(spellId)) return out;
  // the press and the cast rows its effect triggers (`pressFollowUpCastRows`:
  // Predator's Wake 1259431 lands as The Hunt 1246169 — be1686eb 0:34, the
  // root 370970 IMMUNE and the impact's damage in one millisecond)
  const ids = [
    spellId,
    ...(followUp
      ? pressFollowUpCastRows(
          followUp.casts,
          spellId,
          sameSpellCastMs,
          castMs,
          followUp.destUnitId,
        ).map((r) => r.spellId!)
      : []),
  ];
  return out.filter(
    (m) =>
      !m.destUnitId ||
      !ids.some((id) =>
        pressLandedOn(
          landed,
          id,
          getEnglishSpellName(id, ""),
          sameSpellCastMs,
          castMs,
          m.destUnitId!,
          m.timestamp,
        ),
      ),
  );
}

/** The fields of a damage / heal row the landed reading asks: the hit's own
 * id, or — on a SPELL_ABSORBED row — the attack's (`attackSpellId`). */
export interface IPressHitRow {
  spellId?: string;
  spellName?: string;
  attackSpellId?: string;
  attackSpellName?: string;
  destUnitId?: string;
  logLine: { timestamp: number; event?: string };
}

/** Is this damage / heal row a hit of the press `spellId` — its id or an
 * effect aura's (`castAndEffectIds`), or a row of the same English name
 * (the damage under another id: Execute 281000 → 260798; The Hunt's impact
 * 370966)? A SPELL_ABSORBED row is the attack's (`attackSpellId`). The one
 * reading of "a hit of this press": `pressLandedOn` and the KILL ATTEMPTS
 * burst anchor (`killAttempts.ts`). */
export function isPressHitRow(
  spellId: string,
  spellName: string,
  row: IPressHitRow,
): boolean {
  const id = row.attackSpellId ?? row.spellId;
  if (!id) return false;
  if (castAndEffectIds(spellId).has(id)) return true;
  const rowName = row.attackSpellId ? row.attackSpellName : row.spellName;
  const a = getEnglishSpellName(id, rowName ?? "") || id;
  const b = getEnglishSpellName(spellId, spellName) || spellId;
  return a === b;
}

/**
 * Did the press land on `destUnitId` anyway — a hit of it (`isPressHitRow`)
 * on that unit inside the press's cast window (`missBelongsToCast`)? fact11
 * D10 (16bc5861 1:10 / 3:14 / 4:31): The Hunt's root 370970 met Blessing of
 * Freedom IMMUNE, its impact 370966 and DoT 370969 landed in the same
 * millisecond — three `[IMMUNE — Blessing of Freedom was up]` read as the
 * whole cooldown refused.
 */
export function pressLandedOn(
  rows: readonly IPressHitRow[],
  spellId: string,
  spellName: string,
  sameSpellCastMs: readonly number[],
  castMs: number,
  destUnitId: string,
  /** the refusal row's own ms: a hit counts only in its instant
   * (`PRESS_LANDED_SAME_INSTANT_MS`) */
  refusedAtMs?: number,
): boolean {
  return rows.some(
    (r) =>
      r.destUnitId === destUnitId &&
      // a periodic row is a tick of an application already running, not
      // the new press landing (GH #192: an old Flame Shock's tick in the
      // instant a new one met IMMUNE)
      !r.logLine.event?.startsWith("SPELL_PERIODIC_") &&
      missBelongsToCast(sameSpellCastMs, castMs, r.logLine.timestamp) &&
      (refusedAtMs === undefined ||
        Math.abs(r.logLine.timestamp - refusedAtMs) <=
          PRESS_LANDED_SAME_INSTANT_MS) &&
      isPressHitRow(spellId, spellName, r),
  );
}

/** A hit of the press is the press landing through a refused component only
 * in the refusal's own instant — The Hunt's impact and its root's IMMUNE share
 * a millisecond (fact11 D10). A same-named hit seconds later is a separate
 * trigger landing once the immunity is gone: Arcane Surge 365350 IMMUNE into
 * Ice Block, its 453326 "Arcane Surge" 2.4 s later on the unblocked mage. */
export const PRESS_LANDED_SAME_INSTANT_MS = CAST_MISS_LEAD_MS;

function pressImmuneMissRowsAll<T extends IPressMissRow>(
  misses: readonly T[],
  spellId: string,
  sameSpellCastMs: readonly number[],
  castMs: number,
  followUp?: IPressFollowUp,
): T[] {
  const ownRows = (id: string, castTimes: readonly number[], atMs: number) => {
    const family = castAndEffectIds(id);
    return misses.filter(
      (m) =>
        m.missType === "IMMUNE" &&
        m.spellId !== undefined &&
        family.has(m.spellId) &&
        m.logLine?.event !== LogEvent.SPELL_PERIODIC_MISSED &&
        missBelongsToCast(castTimes, atMs, m.timestamp),
    );
  };
  const out = ownRows(spellId, sameSpellCastMs, castMs);
  if (!followUp) return out;
  for (const row of pressFollowUpCastRows(
    followUp.casts,
    spellId,
    sameSpellCastMs,
    castMs,
    followUp.destUnitId,
  )) {
    const id = row.spellId!;
    const times = followUp.casts
      .filter(
        (c) =>
          c.logLine?.event === LogEvent.SPELL_CAST_SUCCESS && c.spellId === id,
      )
      .map((c) => c.timestamp);
    for (const m of ownRows(id, times, row.timestamp))
      if (!out.includes(m)) out.push(m);
  }
  return out;
}

/** The fields of a `SPELL_CAST_SUCCESS` row the follow-up reading asks. */
export interface IPressCastRow {
  spellId?: string;
  spellName?: string;
  destUnitId?: string;
  timestamp: number;
  logLine?: { event?: unknown };
}

/** The caster's cast rows and the unit its press was aimed at, for
 * `pressImmuneMissRows`' follow-up rows. */
export interface IPressFollowUp {
  casts: readonly IPressCastRow[];
  destUnitId: string;
}

/**
 * Press id → the ids its own effect triggers as a second `SPELL_CAST_SUCCESS`
 * at the press's target: every DB2 charge effect (SpellEffect Effect 96
 * CHARGE / 149 CHARGE_DEST) with an EffectTriggerSpell — the impact — whose
 * two ends are both observed ids (`observedSpellIdsGenerated.json`):
 *  - The Hunt 370965 → 370966, 1246167 → 1246169 (row 1247652);
 *  - Predator's Wake 1259431 → 1246169 (row 1268534);
 *  - Charge 432113 → Wicked Cleave 432120; Interpose 1244088 → 1244091.
 * The DB2 link is the evidence a row is the press's impact and not a press of
 * its own; a shared English name is not (codex 20-F20-28: Moonfire 8921 and
 * Lunar Inspiration's Moonfire 155625 share the name and no link).
 * Generated from that DB2 query (`genPressTriggeredCasts.ts` →
 * `data/pressTriggeredCastsGenerated.ts`; GH #167.21 — it was a hand copy,
 * and a hand pick had missed 370965, codex 20-F20-33). Why the charge effect
 * is the rule: of the 437 SpellEffect trigger edges between observed ids
 * (12.1.5.70575), read against the 605 files' casts — a triggered id cast by
 * the presser at the press's target within 2.5 s — exactly these are
 * impacts: 370965 → 370966 followed 457 of 477 presses (100 % of 370966's
 * rows), 1259431 → 1246169 118 / 123, 1246167 → 1246169 74 / 74, 1244088 →
 * 1244091 6 / 7; the other followed edges are effect 64 / 6 procs and ticks
 * (Mutilate's off-hand, Throw Glaive's bounce, Odyn's Fury's hits, Divine
 * Hymn). Registered in curatedIdRegistry (a renumbered end drops out of the
 * observed universe, and the rot scan reads the table's ids).
 */
export { PRESS_TRIGGERED_CAST_IDS };

/**
 * A press whose impact is logged as a SECOND `SPELL_CAST_SUCCESS` of an id
 * its effect triggers (`PRESS_TRIGGERED_CAST_IDS`), at the same target (F20
 * wide residual, 0373256a r1 2:14: The Hunt is pressed as 1246167 and lands
 * as 1246169; the impact's IMMUNE row on a Blessing of Spellwarding paladin
 * was the press's refusal, and the line said nothing). The follow-up rows:
 * the caster's casts of a triggered id, aimed at the press's target, in
 * (cast, cast + `CAST_MISS_WINDOW_MS`], with no other press between the two
 * that could own the row — the press's own id, an id of its English name, or
 * another press that triggers the same id.
 */
export function pressFollowUpCastRows<T extends IPressCastRow>(
  casts: readonly T[],
  spellId: string,
  sameSpellCastMs: readonly number[],
  castMs: number,
  destUnitId: string,
): T[] {
  const triggered = PRESS_TRIGGERED_CAST_IDS.get(spellId);
  if (!triggered) return [];
  const name = getEnglishSpellName(spellId, "");
  const nextOwn = Math.min(
    Infinity,
    ...sameSpellCastMs.filter((t) => t > castMs + 5),
  );
  const success = casts.filter(
    (c) => c.logLine?.event === LogEvent.SPELL_CAST_SUCCESS && !!c.spellId,
  );
  // another press between the two that could own a row of `id`
  const ownerBetween = (id: string, from: number, to: number) =>
    success.some(
      (c) =>
        c.timestamp > from + 5 &&
        c.timestamp < to &&
        !triggered.includes(c.spellId!) &&
        (c.spellId === spellId ||
          (!!name &&
            getEnglishSpellName(c.spellId!, c.spellName ?? "") === name) ||
          !!PRESS_TRIGGERED_CAST_IDS.get(c.spellId!)?.includes(id)),
    );
  return success.filter(
    (c) =>
      triggered.includes(c.spellId!) &&
      c.destUnitId === destUnitId &&
      c.timestamp > castMs &&
      c.timestamp <= castMs + CAST_MISS_WINDOW_MS &&
      c.timestamp < nextOwn &&
      !ownerBetween(c.spellId!, castMs, c.timestamp),
  );
}

/** Was this press refused as IMMUNE on `destId` (`pressImmuneMissRows` with
 * a miss on that unit)? */
export function pressRefusedImmuneOn(
  misses: readonly IPressMissRow[] | undefined,
  spellId: string,
  sameSpellCastMs: readonly number[],
  castMs: number,
  destId: string,
  /** the caster's cast rows: a follow-up impact row's IMMUNE counts
   * (`pressFollowUpCastRows`) */
  casts?: readonly IPressCastRow[],
  /** the caster's damage and heal rows (`pressImmuneMissRows`' `landed`) */
  landed?: readonly IPressHitRow[],
): boolean {
  return pressImmuneMissRows(
    misses,
    spellId,
    sameSpellCastMs,
    castMs,
    casts ? { casts, destUnitId: destId } : undefined,
    landed,
  ).some((m) => m.destUnitId === destId);
}

/**
 * The miss types, other than IMMUNE, that say a control did not land on the
 * unit, with the word the cast-line tag prints (2026-09-25). Season sample
 * (1 file in 60): MISS 397, REFLECT 60, PARRY / DODGE 17 against IMMUNE
 * 1,866; after one of them the caster's CC aura appeared on that target
 * within 0.5 s 0 / 474 times. ABSORB is not here on purpose: it reports the
 * control's damage part, and the aura followed it 957 / 1,072 times (89 %).
 */
export const CC_MISS_TAG_WORD: Readonly<Record<string, string>> = {
  MISS: "MISSED",
  REFLECT: "REFLECTED by",
  PARRY: "PARRIED by",
  DODGE: "DODGED by",
  EVADE: "EVADED by",
  DEFLECT: "DEFLECTED by",
};

/** Every miss type that establishes a failed control: IMMUNE and the types
 * of `CC_MISS_TAG_WORD`. */
export const CONTROL_FAILED_MISS_TYPES: ReadonlySet<string> = new Set([
  "IMMUNE",
  ...Object.keys(CC_MISS_TAG_WORD),
]);

/**
 * The end of an unseen-end stealth-kind immunity at its holder's own action
 * (`untargetableEndS`) and the predicates behind it — moved out of
 * `enemyDefensives.ts` (which re-exports them) so the casting locks and the
 * kill target's defensive state can share the one reading without an import
 * cycle (pipeline T113, batch review 80-PIPE-110-B97).
 */
import { ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { castsOfEffectAura } from "../data/castEffectAuras";
import { spellEffectData } from "../data/spellEffectData";
import {
  ENEMY_IMMUNITY_HOLDS_ITS_AURA_IDS,
  ENEMY_INVISIBILITY_AURAS,
} from "../data/spellIdLists";
import { ALLOWED_WHILE_STEALTHED_SPELL_IDS } from "../data/spellStateAttrsGenerated";
import { buildAuraIntervals, SAVE_CAST_AURA_PAIR_S } from "./auraIntervals";
import { AURA_BEFORE_CAST_ROW_MAX_MS } from "./castRowLag";
import { ccMechanicOf, SNARED_MECHANIC } from "./spellMechanics";

/** The GUID a row with no unit carries. */
export const NO_TARGET_GUID = "0000000000000000";

/** Damage on the carrier inside this first stretch of a stealth-kind
 * immunity was already on its way (U-KA3: "a hit inside the aura's first
 * second"); after it, an aimed hit is the unit being a target again. */
export const STEALTH_IMMUNITY_IN_FLIGHT_MS = 1000;

/**
 * User ruling 2026-10-21 (round-3 q6, 「修」 — settle it with the log): a
 * unit under Mass Invisibility is not hit. 605 archive files (`NR%60`): 425
 * Mass Invisibility spans, 564 s in all — 0 melee swings, 1 ranged hit, 98
 * direct spell hits (79 within 0.5 s of the aura going up, the rest by 2 s,
 * none after: already in flight), 175 periodic ticks (DoTs keep ticking).
 * Re-measured 2026-10-22 on the every-30th new-season files (911 aura runs,
 * mage and allies, median 0.63 s): landed direct hits ≤ 0.5 s after it went
 * up 273, 0.5–2 s 75, > 2 s 8 — all area damage (Bladestorm, Wake of Ashes,
 * Consecration, a guardian's Wrath of Nathreza), no melee / ranged / single
 * target spell; the user kept the ruling (「都不改」).
 * Phase Shift 408558 (Fade's talent: every attack and spell avoided for its
 * second) the same (fact3 D54). Both end `defenseless` while up; an aura
 * whose REMOVED the log never shows (an opponent who went unseen takes the
 * line with them) is over at the holder's first action after it, as
 * Greater Invisibility's is (`SAVE_AURA_END_UNSEEN_IDS`).
 */
export const KW_UNTARGETABLE_AURA_IDS: ReadonlySet<string> = new Set([
  "414664",
  "408558",
]);

/**
 * The auras a kill window's `defenseless` span is cut for while they are UP
 * and for nothing else: `KW_UNTARGETABLE_AURA_IDS`, and the invisibility a
 * fact line states (`ENEMY_INVISIBILITY_AURAS`: Greater Invisibility). User
 * ruling R58 (2026-11-18) took Greater Invisibility out of the mitigation
 * roster — it reduces no damage, is no immunity, and a ready one protects
 * nothing — and with the roster row went the only thing that kept its
 * seconds out of a span (batch review 80-PIPE-160-B146, 1405c83e round 2:
 * applied 165.612 s, removed 166.205 s, inside `defenseless 158.6–166.9 s`).
 * A unit nobody can see is no kill target while the aura is up; the end is
 * `untargetableEndS` — the logged REMOVED, or the holder's first own action
 * for an end the log never showed. Nothing is read from a ready button.
 */
export const KW_SPAN_UNSEEN_AURA_IDS: ReadonlySet<string> = new Set([
  ...KW_UNTARGETABLE_AURA_IDS,
  ...Object.keys(ENEMY_INVISIBILITY_AURAS),
]);

/**
 * When a `KW_UNTARGETABLE_AURA_IDS` interval stops the unit being a target,
 * match seconds: its logged end, or — for an end the log never showed
 * (`inferredEnd`) — the holder's first own press or hit after it went up.
 * One reading for the kill-window saves and the CC samplers' "not immune"
 * (fact4 D27, 3f433db1 0:23: a Blind counted usable on a mage 0.2 s into
 * Mass Invisibility).
 */
export function untargetableEndS(
  holder: Pick<ICombatUnit, "id" | "spellCastEvents" | "damageOut"> &
    Partial<Pick<ICombatUnit, "auraEvents">>,
  iv: {
    spellId?: string;
    srcUnitId?: string;
    fromS: number;
    toS: number;
    inferredEnd?: boolean;
  },
  matchStartMs: number,
  /** the round's units (`holderFirstOwnActionAfterMs`'s stealth opener) */
  units?: readonly ICombatUnit[],
): number {
  if (!iv.inferredEnd) return iv.toS;
  // the application's own row: a same-millisecond action logged below it
  // came after it (codex 80-PIPE-111-B98 #2)
  const fromMs = matchStartMs + iv.fromS * 1000;
  const applied = (holder.auraEvents ?? []).find(
    (a) =>
      a.spellId === iv.spellId &&
      a.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
      // the application's own source: two of one millisecond (two mages'
      // Mass Invisibility) each keep their row (codex 85-tk-N-T113-5 #1)
      (!iv.srcUnitId || a.srcUnitId === iv.srcUnitId) &&
      Math.abs(a.logLine.timestamp - fromMs) < 1,
  );
  const first = holderFirstOwnActionAfterMs(
    holder,
    applied ? applied.logLine.timestamp : fromMs,
    iv.spellId,
    units,
    applied?.logLine.lineIndex,
  );
  return Math.min(iv.toS, (first - matchStartMs) / 1000);
}

/**
 * `ivs` (the holder's own aura intervals) with each stealth-kind immunity
 * (`ENEMY_IMMUNITY_HOLDS_ITS_AURA_IDS`) whose end the log never showed ended
 * at its holder's first own action (`untargetableEndS`) — the end every
 * reader of these auras shares (pipeline T113, batch review 80-PIPE-110-B97:
 * the moment snapshot, the casting locks and the vision windows held a
 * Burrow for its official 5 s past the shaman's own cast).
 */
export function withStealthActionEnds<
  T extends {
    spellId: string;
    fromS: number;
    toS: number;
    inferredEnd?: boolean;
  },
>(
  holder: Pick<ICombatUnit, "id" | "spellCastEvents" | "damageOut"> &
    Partial<Pick<ICombatUnit, "auraEvents">>,
  ivs: readonly T[],
  combat: { startTime: number; units?: Record<string, ICombatUnit> },
): T[] {
  const units = Object.values(combat.units ?? {});
  return ivs.map((iv) =>
    ENEMY_IMMUNITY_HOLDS_ITS_AURA_IDS.has(iv.spellId) && iv.inferredEnd
      ? { ...iv, toS: untargetableEndS(holder, iv, combat.startTime, units) }
      : iv,
  );
}

/**
 * Where the stealth-kind immunity a press put on its own holder
 * (`ENEMY_IMMUNITY_HOLDS_ITS_AURA_IDS`, up within `SAVE_CAST_AURA_PAIR_S` of
 * the press) stopped protecting it, match seconds — only when the log never
 * showed its end and the holder's own action came before the official
 * length (`untargetableEndS`); undefined otherwise. The press timers read
 * it so a timed press ends where the aura's own span readers end it
 * (pipeline T113, batch review 80-PIPE-110-B97: Burrow pressed at 20 s, a
 * Healing Surge begun at 22 s, the kill window held shut to 25 s). The aura
 * must be the press's own (its id, or a cast `castsOfEffectAura` names):
 * a Greater Invisibility pressed a second after a Mass Invisibility is not
 * that Mass Invisibility's press, and keeps D6's official length.
 */
export function stealthImmunityPressActionEndS(
  holder: ICombatUnit,
  combat: Parameters<typeof buildAuraIntervals>[1],
  castS: number,
  pressSpellId: string,
): number | undefined {
  const units = Object.values(combat.units ?? {});
  for (const iv of buildAuraIntervals(holder, combat)) {
    if (
      !ENEMY_IMMUNITY_HOLDS_ITS_AURA_IDS.has(iv.spellId) ||
      (iv.spellId !== pressSpellId &&
        !castsOfEffectAura(iv.spellId).includes(pressSpellId)) ||
      !iv.inferredEnd ||
      Math.abs(iv.fromS - castS) > SAVE_CAST_AURA_PAIR_S
    )
      continue;
    const end = untargetableEndS(holder, iv, combat.startTime, units);
    if (end < iv.toS) return end;
  }
  return undefined;
}

/**
 * The unseen-end stealth a press allowed while stealthed leaves running
 * (`ALLOWED_WHILE_STEALTHED_SPELL_IDS`, DB2): Vanish 11327, DB2 aura 16
 * (MOD_STEALTH); Greater Invisibility and Mass Invisibility are aura 18 and
 * end at any action. fact7 `unseenEndOpener`, the visible runs of 24 archives:
 * presses with the attribute 34 left the run going, 1 sat at its end; Sap
 * 12 / 12 and Blind 2 / 2 survived as debuffs, every opener without it (Cheap
 * Shot, Garrote, Gouge, Kidney Shot) ended the run in its own instant.
 * Prowl 5215 and Incarnation's Prowl 102547 (pipeline T77, GH #173 item 36):
 * DB2 aura 16 as well; the 605 capture's runs whose REMOVED is logged
 * (scan5 t77 `stealthVisibleRunPress`, the holder's first press in the run):
 * with the attribute 176 left the run going and 2 sat at its end (Tiger's
 * Fury, Wild Charge, Dash, Stampeding Roar), without it 185 ended it and 2
 * did not. Shadowmeld 58984 is not in this set: 3 kept and 2 ended on the
 * same capture — it also ends on movement, so its runs are short and the
 * split does not say. Registered in curatedIdRegistry.
 */
export const STEALTH_KEPT_BY_ALLOWED_PRESS_IDS: ReadonlySet<string> = new Set([
  "11327",
  "5215",
  "102547",
]);

/**
 * The holder's first own action strictly after `afterMs` (log ms; Infinity
 * when none) — or in that millisecond, logged below the application's row
 * (`afterLine`): a successful press, or a direct hit the holder itself dealt.
 * What ends an unseen-end invisibility / stealth (`untargetableEndS`, the
 * burst ledger's `SAVE_AURA_END_UNSEEN_IDS` walls). Not an action of the
 * holder: a pet's or guardian's hit (parser-compat folds those into the
 * owner's `damageOut` — a Frost Mage's Water Elemental keeps attacking
 * through Greater Invisibility) and a periodic tick (DoTs keep ticking
 * through it, D6's 175 periodic ticks). Nor, when `auraId` names the aura
 * that went up at `afterMs`, its own press's cast row logged up to
 * `AURA_BEFORE_CAST_ROW_MAX_MS` after it (the measured aura-before-cast lag:
 * a Greater Invisibility 110960 whose 110959 row came 120 ms later ended at
 * its own press — found by the log-shape matrix, castRowLag). Nor, on a
 * `STEALTH_KEPT_BY_ALLOWED_PRESS_IDS` aura, a press stealth allows.
 *
 * With `units`, also a debuff the holder put on another unit
 * (`holderOpenerDebuffAfterMs`): an unseen unit's cast row is not always
 * written, and its opener then shows only as the aura it landed (fact7 D59).
 */
export function holderFirstOwnActionAfterMs(
  holder: Pick<ICombatUnit, "id" | "spellCastEvents" | "damageOut"> &
    Partial<Pick<ICombatUnit, "missesOut" | "castStartEvents" | "auraEvents">>,
  afterMs: number,
  auraId?: string,
  units?: readonly ICombatUnit[],
  /** the application row's `lineIndex`: a row of `afterMs` itself logged
   * after it is after it (codex 80-PIPE-111-B98 #2: Burrow APPLIED at
   * 20.000, a Healing Surge START below it in the same millisecond) */
  afterLine?: number,
): number {
  // unnamed, the application's row is the holder's APPLIED of `auraId` at
  // `afterMs` itself
  const fromLine =
    afterLine ??
    (auraId
      ? (holder.auraEvents ?? []).find(
          (a) =>
            a.spellId === auraId &&
            a.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
            a.logLine.timestamp === afterMs,
        )?.logLine.lineIndex
      : undefined);
  const after = (t: number, line: number | undefined): boolean =>
    t > afterMs ||
    (t === afterMs &&
      fromLine !== undefined &&
      line !== undefined &&
      line > fromLine);
  const ownPress = auraId
    ? new Set([auraId, ...castsOfEffectAura(auraId)])
    : undefined;
  const allowed = stealthAllowsPress(auraId);
  let first = Infinity;
  for (const c of holder.spellCastEvents ?? [])
    if (c.logLine.event === LogEvent.SPELL_CAST_SUCCESS) {
      const t = c.logLine.timestamp;
      if (
        ownPress?.has(c.spellId ?? "") &&
        t <= afterMs + AURA_BEFORE_CAST_ROW_MAX_MS
      )
        continue;
      if (allowed(c.spellId ?? "")) continue;
      if (after(t, c.logLine.lineIndex) && t < first) first = t;
    }
  // a cast bar begun is the holder acting, whether or not the cast came off
  // (pipeline T113, fact13 D21: a Polymorph bar begun 9.0 s into Mass
  // Invisibility and feared off — no SUCCESS row, and the immunity read
  // 10.8 s). Measured on the 605 capture's runs whose REMOVED is logged
  // (scan5 t113 `visibleRunCastStart`, the holder's first own row in the
  // run): a cast bar begun ended Mass Invisibility 16 / 16 and Greater
  // Invisibility 45 / 45.
  for (const c of holder.castStartEvents ?? []) {
    if (allowed(c.spellId ?? "")) continue;
    const t = c.timestamp;
    if (after(t, c.logLine?.lineIndex) && t < first) first = t;
  }
  // a tick a shield ate is logged as a SPELL_ABSORBED row with no periodic
  // flag (its `spellId` is the shield, `attackSpellId` the hit's): the hit
  // of a spell this holder ticks this round is a tick too (codex 30-RV-01
  // #1, 0373256a r1: an absorbed Flame Shock tick ended Mass Invisibility
  // at 44.3 s, the next own press came at 45.1 s). A DoT's first hit comes
  // with its press, which ends it anyway.
  const ticking = new Set<string>();
  for (const d of holder.damageOut ?? [])
    if (
      d.srcUnitId === holder.id &&
      d.logLine.event === LogEvent.SPELL_PERIODIC_DAMAGE &&
      d.spellId
    )
      ticking.add(d.spellId);
  // …or a periodic miss of it (a tick fully absorbed logs SPELL_PERIODIC_
  // MISSED ABSORB beside its SPELL_ABSORBED row, and maybe never a
  // PERIODIC_DAMAGE that round — codex 20-F18-06 #2, 2b380381 r5: a Fel
  // Armor tick 12 ms into Mass Invisibility)
  for (const m of holder.missesOut ?? [])
    if (
      m.srcUnitId === holder.id &&
      m.logLine?.event === LogEvent.SPELL_PERIODIC_MISSED &&
      m.spellId
    )
      ticking.add(m.spellId);
  for (const d of holder.damageOut ?? []) {
    if (d.srcUnitId !== holder.id) continue;
    if (d.logLine.event === LogEvent.SPELL_PERIODIC_DAMAGE) continue;
    if (
      d.logLine.event === LogEvent.SPELL_ABSORBED &&
      ticking.has((d as { attackSpellId?: string }).attackSpellId ?? "")
    )
      continue;
    const t = d.logLine.timestamp;
    // a spell hit the holder dealt in the aura's first second was on its
    // way before it went up — no action (pipeline T113; the incoming side's
    // `STEALTH_IMMUNITY_IN_FLIGHT_MS`, U-KA3). Same measurement: such a hit
    // as the run's first own row left it going 182 times and sat at its end
    // 45 (Mass Invisibility 70 / 11, Greater Invisibility 53 / 21, Vanish
    // 59 / 13); a later spell hit ended it 19 / 30. A melee swing is never
    // in flight (`isMeleeSwingRow`): it stays the holder's action (codex
    // 85-tk-N-T113-1 / -1b; a first-second swing ended Vanish 5 / 9).
    if (
      auraId &&
      !isMeleeSwingRow(d) &&
      t <= afterMs + STEALTH_IMMUNITY_IN_FLIGHT_MS
    )
      continue;
    if (after(t, d.logLine.lineIndex) && t < first) first = t;
  }
  return units
    ? holderOpenerDebuffAfterMs(holder, after, first, units, allowed)
    : first;
}

/**
 * A melee swing row of a unit's `damageOut`: `SWING_DAMAGE` /
 * `SWING_DAMAGE_LANDED`, or a swing a shield ate whole (the parser's
 * `SPELL_ABSORBED` row with no attacking spell). A swing is never in flight,
 * so the in-flight first second of `holderFirstOwnActionAfterMs` does not
 * apply to it (pipeline T113, codex 85-tk-N-T113-1 / -1b); scan5/t113 reads
 * the same split.
 */
export function isMeleeSwingRow(d: {
  logLine: { event: string };
  attackSpellId?: string;
}): boolean {
  const e = d.logLine.event;
  return (
    e === LogEvent.SWING_DAMAGE ||
    e === LogEvent.SWING_DAMAGE_LANDED ||
    (e === LogEvent.SPELL_ABSORBED && !d.attackSpellId)
  );
}

const stealthAllowsPress =
  (auraId: string | undefined) =>
  (spellId: string): boolean =>
    !!auraId &&
    STEALTH_KEPT_BY_ALLOWED_PRESS_IDS.has(auraId) &&
    ALLOWED_WHILE_STEALTHED_SPELL_IDS.has(spellId);

/**
 * The first debuff the holder landed on another unit after `afterMs` that
 * says it acted, if that comes before `firstMs`; else `firstMs`. fact7 D59
 * (4f8a5947 0:26): a Vanish at 25.934, Cheap Shot's aura on the target at
 * 26.404 with no cast row of the rogue's, and the burst ledger read the
 * Vanish as up for its full 1.5 s. 15 rounds, 30 auras with no end row: 10
 * first show their holder through such a row (Cheap Shot, Garrote, Garrote -
 * Silence, Frost Nova, Dragon's Breath).
 *
 * What counts: a debuff with a DB2 mechanic (`ccMechanicOf`) — a passive's
 * rows have none (Ignite, a Rune of Reverberation rider: both land through
 * an invisibility). What does not: a snare, which is a press's rider (Chilled:
 * 3 of 3 runs survived it; a Hamstring has its cast row); a debuff of a press
 * the stealth allows (`stealthAllows`: Sap, Blind); a row a standing effect
 * of an earlier press wrote, within that press's official length (Ring of
 * Frost, Smoke Bomb: an enemy walked in) — a press with no unit on its row,
 * which is what a standing effect is: a Garrote pressed 15.5 s earlier on a
 * player stands nowhere (fact7 `unseenEndOpener`, a7c8de4c r1: its 703 aura
 * 0.34 s into a Vanish was read as such a row, the Vanish printed 1.0 s).
 * Nor the landing of a press logged above the application's row in the
 * debuff's own millisecond (pipeline T261: a Polymorph that came off just
 * before Greater Invisibility, its debuff written below the invisibility).
 */

function holderOpenerDebuffAfterMs(
  holder: Pick<ICombatUnit, "id" | "spellCastEvents">,
  after: (t: number, line: number | undefined) => boolean,
  firstMs: number,
  units: readonly ICombatUnit[],
  stealthAllows: (spellId: string) => boolean,
): number {
  let first = firstMs;
  for (const u of units) {
    if (u.id === holder.id) continue;
    for (const a of u.auraEvents ?? []) {
      const t = a.logLine.timestamp;
      if (!(after(t, a.logLine.lineIndex) && t < first)) continue;
      if (
        a.logLine.event !== LogEvent.SPELL_AURA_APPLIED ||
        a.srcUnitId !== holder.id ||
        a.auraType !== "DEBUFF" ||
        !a.spellId
      )
        continue;
      const mechanic = ccMechanicOf(a.spellId);
      if (mechanic === undefined || mechanic === SNARED_MECHANIC) continue;
      const pressIds = new Set([a.spellId, ...castsOfEffectAura(a.spellId)]);
      if ([...pressIds].some(stealthAllows)) continue;
      const standing = (holder.spellCastEvents ?? []).some(
        (c) =>
          c.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
          !!c.spellId &&
          pressIds.has(c.spellId) &&
          (!c.destUnitId || c.destUnitId === NO_TARGET_GUID) &&
          !after(c.logLine.timestamp, c.logLine.lineIndex) &&
          c.logLine.timestamp +
            (spellEffectData[c.spellId]?.durationSeconds ?? 0) * 1000 >=
            t,
      );
      if (standing) continue;
      // the landing of a press logged before the application's row: its
      // SUCCESS on this unit in the debuff's own millisecond, above the
      // application — the debuff the press carried, not an action after the
      // invisibility (pipeline T261, v0.1.44 wide check, 0c2f3878 16:20:00.769:
      // Polymorph SUCCESS, Greater Invisibility APPLIED, its two cast rows,
      // then the Polymorph DEBUFF APPLIED; the mage next acted 1.4 s later)
      const ownLanding = (holder.spellCastEvents ?? []).some(
        (c) =>
          c.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
          !!c.spellId &&
          pressIds.has(c.spellId) &&
          c.destUnitId === u.id &&
          c.logLine.timestamp === t &&
          !after(c.logLine.timestamp, c.logLine.lineIndex),
      );
      if (!ownLanding) first = t;
    }
  }
  return first;
}

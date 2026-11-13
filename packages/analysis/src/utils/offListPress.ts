/**
 * GH #176 (user ruling 2026-11-02): a major press no hand list names gets a
 * `[PRESS]` line of its own. "Major" = an official cooldown (DB2,
 * `effectiveCooldownSeconds`) of at least `PRESS_LINE_MIN_CD_SECONDS`, or a
 * button under it the user picked (`PRESS_LINE_WHITELIST_IDS`, GH #183).
 *
 * The rosters a press has to pass to be printed by another family
 * (`classMetadata`, `OFFENSIVE_CD_SPELL_IDS`, `SPELL_EFFECT_OVERRIDES`) are
 * `isRosterPressId`; the press families that print a press under a tag of
 * their own (a CC, a kick, a purge…) are `PRESS_LINE_TAG`. Both are shared
 * with the Curated-List forward check `listGapPress`
 * (`packages/eval/scripts/scan5/listGap.ts`): the check counts a press with no
 * line by the same two predicates the renderer uses to decide to print one.
 *
 * The numbers on the line are the shared cooldown model's
 * (`unitCooldownEntry`: this unit's talents, its per-press reductions and
 * resets), never the static DB2 value, and the duration is the caster's
 * talented one (`buffFullDurationForCaster`) for an aura its press put up.
 */
import {
  AtomicArenaCombat,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import { NO_CAST_LOG_PRESS_IDS } from "../data/auraActivation";
import { effectAurasOfCast } from "../data/castEffectAuras";
import { classMetadata } from "../data/classSpells";
import {
  PRESS_CHAIN_HANDOVER_MS,
  PRESS_EFFECT_CHAIN_AURAS,
  PRESS_EFFECT_CHAIN_HOLDER_SOURCED,
} from "../data/pressEffectChains";
import {
  effectiveCooldownSeconds,
  OPPRESSING_ROAR_PVP_CC_DURATION_MULT,
  PRISMATIC_BARRIER_PVP_MAGIC_DURATION_MULT,
} from "../data/spellEffectData";
import { timeSpiralEchoMs } from "../data/talentScriptedCooldowns";
import {
  buffDurationIsFloorForCaster,
  buffFullDurationForCaster,
} from "./buffDuration";
import { isNoPressRow } from "./castPress";
import { AURA_BEFORE_CAST_ROW_MAX_MS } from "./castRowLag";
import { oppressingRoarOnAt, prismaticBarrierOnAtMs } from "./ccBreakAnalysis";
import {
  oppressingRoarLengthens,
  prismaticBarrierShortens,
} from "./ccDuration";
import { isStasisReplayCast } from "./combatStates";
import {
  canonicalSpellId,
  type IMajorCooldownInfo,
  pressReadyAgainAtSeconds,
  unitCooldownEntry,
  unreleasedHoldMs,
} from "./cooldowns";
import { SAVE_CAST_AURA_PAIR_S } from "./enemyDefensives";
import { isResyncBatchAt } from "./hiddenPress";
import {
  OFFENSIVE_CD_SPELL_IDS,
  OFFENSIVE_PRESS_FACT_IDS,
  SPELL_EFFECT_OVERRIDES,
} from "./spellDanger";
import { equippedBadgeCount, GLADIATOR_BADGE_SPELL_ID } from "./trinketType";

/** user ruling 2026-11-02 (GH #176): 45 s, not 30 s; 14.1 lines per owner
 * view on the 605 set against 33.0 at 30 s */
export const PRESS_LINE_MIN_CD_SECONDS = 45;

/**
 * GH #183 (user picks, 2026-11-03, from the 605 set's `offListUnder45`
 * presses): buttons under `PRESS_LINE_MIN_CD_SECONDS` that still get a
 * `[PRESS]` line. Keyed on the cast id: a picked spell's other cast ids
 * (an override variant, a Font of Magic id) are listed on their own, as the
 * user picked them. Everything else a `[PRESS]` line needs (no roster, no
 * other family's tag) still applies.
 */
export const PRESS_LINE_WHITELIST_IDS: ReadonlySet<string> = new Set([
  // defensive / survival
  "586", // Fade
  "204336", // Grounding Totem
  "235313", // Blazing Barrier
  "235450", // Prismatic Barrier
  "1244088", // Interpose
  "3411", // Intervene
  // control / utility
  "51490", // Thunderstorm
  "57934", // Tricks of the Trade
  "15487", // Silence
  "353753", // Bonds of Fel
  "210873", // Hex (variant)
  "269352", // Hex (variant)
  "277778", // Hex (variant)
  // mobility
  "48020", // Demonic Circle: Teleport
  "212653", // Shimmer
  "101545", // Flying Serpent Kick
  // healer throughput
  "116680", // Thunder Focus Tea
  "443454", // Ancestral Swiftness
  "355936", // Dream Breath
  // short offensive cooldowns
  "212431", // Explosive Shot
  "198013", // Eye Beam
  "357208", // Fire Breath
  "382266", // Fire Breath (Font of Magic)
  "255937", // Wake of Ashes
  "258860", // Essence Break
  "80240", // Havoc
  "1233272", // Lunar Eclipse
  "1233346", // Solar Eclipse
  "1245412", // Voidblade
  "1245483", // Pierce the Veil (Voidblade's override variant)
  "359073", // Eternity Surge
  "382411", // Eternity Surge (Font of Magic)
  "436358", // Demolish
]);

/** a printed `[tag]` that states a press of the spell it names */
export const PRESS_LINE_TAG =
  /\[(YOU|TEAM)\] \[(CD|CC|PROC|CAST)\]|\[ENEMY (CD|DEF|UTILITY|HEAL CD|TRINKET|HARD CAST|PURGE|CLEANSE)\]|\[TRINKET\]|\[PRESS\]|\[(CLEANSE|PURGE|GRIP|KICK|DISARM|SILENCE|SHIELD|ROOT|DISPEL|MINOR DISPELS|CC ON ENEMY|CC ON TEAM|CC NOT LANDED|ENEMY SUMMON)\]/;

/** Gladiator's Medallion, Adaptation's activation, the two racials that share
 * the PvP trinket's lock: printed by `[TRINKET]` / `[ENEMY TRINKET]` */
export const TRINKET_LINE_IDS: ReadonlySet<string> = new Set([
  "336126",
  "336135",
  "59752",
  "7744",
]);
/** the group heal of the class (fact7 D51, D55), printed `[ENEMY HEAL CD]` */
export const FILLED_HEAL_IDS: ReadonlySet<string> = new Set(["15286"]);

const rosterIds = new Set(
  classMetadata.flatMap((c) => c.abilities.map((a) => a.spellId)),
);

/** On a hand roster some family prints a press of from (the ids `listGapPress`
 * calls `listed`). */
export function isRosterPressId(id: string): boolean {
  const canon = canonicalSpellId(id);
  return (
    rosterIds.has(id) ||
    rosterIds.has(canon) ||
    OFFENSIVE_CD_SPELL_IDS.has(id) ||
    OFFENSIVE_CD_SPELL_IDS.has(canon) ||
    id in SPELL_EFFECT_OVERRIDES
  );
}

/** A press of `id` is the `[PRESS]` line's to print, when no other line does:
 * a major official cooldown on no roster, not a trinket and not a press fact
 * another family already owns. */
export function isOffListPressId(id: string): boolean {
  return (
    ((effectiveCooldownSeconds(id) ?? 0) >= PRESS_LINE_MIN_CD_SECONDS ||
      PRESS_LINE_WHITELIST_IDS.has(id)) &&
    !isRosterPressId(id) &&
    !TRINKET_LINE_IDS.has(id) &&
    !FILLED_HEAL_IDS.has(id) &&
    !OFFENSIVE_PRESS_FACT_IDS.has(id)
  );
}

const FIRST_UNIT = /(?:^|[\s(])(\d+)\(/;
const BY_UNIT = /^ \((?:by|from) (\d+)\(/;
const OWNED_BY_UNIT = /(\d+)\([^)]*\)'s (?:\w+'s )?$/;

/**
 * Whose press a line's mention of `spell` states: the unit its own `(by N)` /
 * `(from N)` names (`← Dragon's Breath (by 3(FMage))`) or `N's` claims
 * (`interrupted 5(SPriest)'s Void Torrent`), the owner on a `[YOU]` line or a
 * `your X`, else the line's first unit (`[TEAM] [CD] 3(AWarrior) …`, `[PURGE]
 * 1(FMage) purged … (Spellsteal)`). `spell` undefined: the line's own subject,
 * a trinket line naming no spell. Returns the roster number (`"4"`).
 */
export function pressLineCaster(
  text: string,
  spell: string | undefined,
  ownerNumber: string | undefined,
): string | undefined {
  const at = spell === undefined ? -1 : text.indexOf(spell);
  if (at >= 0) {
    const by = BY_UNIT.exec(text.slice(at + spell!.length));
    if (by) return by[1];
    const owns = OWNED_BY_UNIT.exec(text.slice(0, at));
    if (owns) return owns[1];
  }
  if (/\[YOU\]|\byour /.test(at >= 0 ? text.slice(0, at) : text))
    return ownerNumber;
  return FIRST_UNIT.exec(text)?.[1];
}

/** a press-tag line within this many whole seconds of the press states it */
export const PRESS_LINE_NEAR_S = 1;

/** Does a rendered line (time stripped) state this unit's press of `name`? */
export function lineStatesPress(
  text: string,
  name: string,
  casterNumber: string | undefined,
  ownerNumber: string | undefined,
): boolean {
  return (
    text.includes(name) &&
    PRESS_LINE_TAG.test(text) &&
    pressLineCaster(text, name, ownerNumber) === casterNumber
  );
}

export interface IOffListPress {
  unit: ICombatUnit;
  spellId: string;
  timeSeconds: number;
  /** the model's cooldown for this unit (talents and charges resolved) */
  cooldownSeconds: number;
  charges: number;
  /** when the model gives a press back (`pressReadyAgainAtSeconds`); the
   * press's own second = a charge is still in hand; null = the model does
   * not count this row as a press of its entry */
  readyAgainAtSeconds: number | null;
  /** the talented duration of the aura this press put up (its own or its
   * effect aura's), when one went up — or was refreshed — within
   * `PRESS_AURA_LEAD_MS` */
  durationSeconds?: number;
  /** `durationSeconds` is a floor (`pressDuration`'s `floor`): the line
   * prints `lasts 10s+` */
  durationIsFloor?: true;
  /** where `durationSeconds` was read: the unit and the APPLIED row
   * (`pressDuration`). The press scan measures the
   * life of this row, not one of its own choosing. */
  durationAura?: { unitId: string; spellId: string; atMs: number };
  /** the model's free press (`freeRecast` — Time Spiral, Death's Arrival,
   * Escape from Reality …): it spent no charge and restarted nothing;
   * `readyAgainAtSeconds` is the cooldown it stands on */
  free?: true;
  /** two of the item worn, a cooldown each (Gladiator's Badge,
   * `equippedBadgeCount`): `readyAgainAtSeconds` is when either is back */
  equipped?: number;
}

/** The entry as it stood at the press: its later presses out. The ready
 * reading samples `CD_INSTANT_SLACK_S` past the instant, so a press 0.8 s
 * later (Between the Eyes after Ace Up Your Sleeve reset it) would be read
 * as this one's. */
function upToPress(entry: IMajorCooldownInfo, t: number): IMajorCooldownInfo {
  const keep = (c: { timeSeconds: number }) => c.timeSeconds <= t + 0.05;
  return {
    ...entry,
    casts: entry.casts.filter(keep),
    ...(entry.sharedCasts
      ? { sharedCasts: entry.sharedCasts.filter(keep) }
      : {}),
  };
}

/** a shorter aura is the press's own blink (Berserker Shout's 0.1 s), not
 * an effect that runs: no `lasts` */
export const PRESS_LINE_MIN_DURATION_S = 1;

/** the press's own aura is applied within this of its cast row */
export const PRESS_AURA_LEAD_MS = 1000;

/** A press's aura on its cast's target may land this long after the cast
 * row: Holy Armaments travel (GH #179, 22 files: 370 target applications,
 * 200 within 1 s, 360 within 2 s, the latest 3.8 s). */
export const PRESS_TARGET_AURA_LEAD_MS = 4000;

/** An empowered press logs its SPELL_CAST_SUCCESS when the empower starts;
 * its effect goes out at the release (SPELL_EMPOWER_END), up to
 * `EMPOWER_RELEASE_MAX_MS` later. The release of `cast`, before the caster's
 * next press of the spell; undefined for a press with none (not empowered,
 * or Tip the Scales' instant release). */
export const EMPOWER_RELEASE_MAX_MS = 6000;
export function empowerReleaseMs(
  caster: Pick<ICombatUnit, "empowerEnds">,
  cast: { spellId?: string; logLine: { timestamp: number } },
  untilMs = Infinity,
): number | undefined {
  const at = cast.logLine.timestamp;
  return (caster.empowerEnds ?? []).find(
    (e) =>
      String(e.spellId) === cast.spellId &&
      e.logLine.timestamp >= at &&
      e.logLine.timestamp < untilMs &&
      e.logLine.timestamp <= at + EMPOWER_RELEASE_MAX_MS,
  )?.logLine.timestamp;
}

/** The aura rows a press may have put up — APPLIED / REFRESH by the caster
 * of its own or its effect aura's id — one per unit, the cast's target's
 * first: on the target within `PRESS_TARGET_AURA_LEAD_MS` (never at or past
 * the caster's next press of the spell, `untilMs`), on anyone else within
 * `PRESS_AURA_LEAD_MS`. A press that arms its target and its caster too
 * (Holy Armaments) prints the target's: the caster's copy is stretched by
 * later procs (GH #179, 2026-11-03: lives 26–48 s on the caster where the
 * target's ran its 20 s). */
export function pressAuraCandidates(
  caster: ICombatUnit,
  cast: {
    spellId?: string;
    destUnitId?: string;
    logLine: { timestamp: number };
  },
  allUnits: readonly ICombatUnit[],
  untilMs = Infinity,
  /** only these of the cast's auras (`pressDuration` after a re-stated row:
   * the same aura on another unit) */
  onlyAuraIds?: ReadonlySet<string>,
  /** how far ahead of the cast row a row may be logged — the re-state
   * fallback (GH #179 128-5: Holy Bulwark's 432496 on the caster 1 ms before
   * the SUCCESS) and a press with no row at or after its cast row (GH #179
   * 3d). Otherwise 0: widening it for every press moved lines that had read
   * a row of their own. */
  leadMs = 0,
): Array<{ unit: ICombatUnit; row: ICombatUnit["auraEvents"][number] }> {
  const release = empowerReleaseMs(caster, cast, untilMs);
  const at = release ?? cast.logLine.timestamp;
  const auraIds = new Set([cast.spellId!, ...effectAurasOfCast(cast.spellId!)]);
  if (onlyAuraIds)
    for (const id of [...auraIds]) if (!onlyAuraIds.has(id)) auraIds.delete(id);
  // an empowered press's own id on the caster is the empower channel (Fire
  // Breath's 2.5 s), not its effect — on a released press and on one the
  // player let go of with no release (cancelled: no effect at all)
  if (
    release !== undefined ||
    (caster.empowerEnds ?? []).some((e) => String(e.spellId) === cast.spellId)
  )
    auraIds.delete(cast.spellId!);
  const ordered = [
    ...allUnits.filter((u) => u.id === cast.destUnitId),
    ...allUnits.filter((u) => u.id !== cast.destUnitId),
  ];
  const out: Array<{
    unit: ICombatUnit;
    row: ICombatUnit["auraEvents"][number];
  }> = [];
  for (const u of ordered) {
    const end =
      u.id === cast.destUnitId
        ? Math.min(at + PRESS_TARGET_AURA_LEAD_MS, untilMs - 1)
        : at + PRESS_AURA_LEAD_MS;
    const rows = (u.auraEvents ?? []).filter(
      (a) =>
        (a.logLine.event === LogEvent.SPELL_AURA_APPLIED ||
          a.logLine.event === LogEvent.SPELL_AURA_REFRESH) &&
        a.srcUnitId === caster.id &&
        !!a.spellId &&
        auraIds.has(a.spellId) &&
        a.logLine.timestamp >= at - leadMs &&
        a.logLine.timestamp <= end,
    );
    // a row at or after the press first; one logged ahead of it only when
    // there is none, the latest of them (codex 20-179a #1: a previous
    // press's APPLIED 100 ms ahead and this press's REFRESH 10 ms after —
    // the REFRESH is this press's) — the first logged in that millisecond,
    // as at the press (GH #179 3d: Holy Bulwark's 432496 then its shield
    // 432607 1 ms ahead; the shield is re-laid every 2 s and ran 40 s)
    const lastAhead = rows[rows.length - 1]?.logLine.timestamp;
    const row =
      rows.find((a) => a.logLine.timestamp >= at) ??
      rows.find((a) => a.logLine.timestamp === lastAhead);
    if (row) out.push({ unit: u, row });
  }
  return out;
}

/** Time Stop: the Evoker's aura on a unit that stops every aura on it from
 * running down ("auras do not progress"). */
export const TIME_STOP_AURA_IDS: ReadonlySet<string> = new Set(["378441"]);

/**
 * GH #179 (2026-11-05): the seconds a Time Stop on `unit` held an aura that
 * went up at `fromMs` and was to run `seconds` — each logged Time Stop span
 * that starts inside the (growing) run adds its own length. 605 files:
 * Gladiator's Badge 19.96 / 19.95 s under a 5.0 s self Time Stop (5 others
 * 15.00–15.01 s), Explosive Shot 8.97 s ×2 under the target's own 5.0 s one,
 * Spirit Walk 9.34 = 8 + an ally's 1.33 s one. A Time Stop with no logged
 * end adds nothing (its length is not read), and neither does one that
 * starts after the aura's own REMOVED — it held nothing (Time Spiral's 375234
 * consumed 1.1 s after its press, a self Time Stop 3.2 s later: the first
 * cut printed `lasts 15s` for the 10 s press, 605 capture 41-2).
 */
export function timeStopHeldSeconds(
  unit: Pick<ICombatUnit, "id" | "auraEvents">,
  fromMs: number,
  seconds: number,
  /** the held aura: its first REMOVED on `unit` after `fromMs` ends what a
   * Time Stop can hold */
  aura?: {
    spellId?: string;
    srcUnitId?: string;
    logLine?: { lineIndex?: number };
  },
): number {
  // a REMOVED in the aura's own millisecond ends it when it is logged after
  // the aura's row (codex 20-179a #4: consumed at once); with no line index
  // on either side, the same millisecond counts as after
  const afterAura = (a: ICombatUnit["auraEvents"][number]) =>
    a.logLine.timestamp > fromMs ||
    (a.logLine.timestamp === fromMs &&
      (a.logLine.lineIndex ?? Infinity) >
        (aura?.logLine?.lineIndex ?? -Infinity));
  const goneMs = aura
    ? (unit.auraEvents ?? []).find(
        (a) =>
          a.logLine.event === LogEvent.SPELL_AURA_REMOVED &&
          a.spellId === aura.spellId &&
          a.srcUnitId === aura.srcUnitId &&
          a.destUnitId === unit.id &&
          afterAura(a),
      )?.logLine.timestamp
    : undefined;
  // paired per caster: an unclosed Time Stop never borrows another
  // Evoker's REMOVED (codex 20-179a #2)
  const spans: Array<{ from: number; to: number }> = [];
  const open = new Map<string, number>();
  for (const a of unit.auraEvents ?? []) {
    if (!TIME_STOP_AURA_IDS.has(a.spellId ?? "") || a.destUnitId !== unit.id)
      continue;
    const src = a.srcUnitId ?? "";
    if (a.logLine.event === LogEvent.SPELL_AURA_APPLIED)
      open.set(src, a.logLine.timestamp);
    else if (a.logLine.event === LogEvent.SPELL_AURA_REMOVED) {
      const from = open.get(src);
      if (from !== undefined) spans.push({ from, to: a.logLine.timestamp });
      open.delete(src);
    }
  }
  let endMs = fromMs + seconds * 1000;
  let held = 0;
  for (const sp of spans.sort((x, y) => x.from - y.from)) {
    if (sp.from < fromMs || sp.from >= endMs) continue;
    if (goneMs !== undefined && sp.from >= goneMs) continue;
    held += sp.to - sp.from;
    endMs += sp.to - sp.from;
  }
  return held / 1000;
}

/** A re-stating batch this soon after the press is the press's own bundle,
 * not the unit coming back into sight (`pressDuration`). */
export const PRESS_RESTATE_MIN_LAG_MS = 1000;

/** One follow-up aura of a listed chain: who applies it, and its APPLIED
 * row when the log shows one. */
export interface IPressChainFollowUp {
  spellId: string;
  source: ICombatUnit;
  applied?: ICombatUnit["auraEvents"][number];
}

/**
 * The follow-up auras of the series `head` starts on `unit`
 * (`PRESS_EFFECT_CHAIN_AURAS`), in order: each one's source (the press's
 * caster, or the unit itself — `PRESS_EFFECT_CHAIN_HOLDER_SOURCED`) and its
 * APPLIED row — the one logged within `PRESS_CHAIN_HANDOVER_MS` of the
 * REMOVED that ends the aura before it (the hand-over is what makes it this
 * series': codex 85-tk-G-T40-1b #3, an ally's own Cheetah 30 s later was
 * read as the second phase of a copy that had ended without one), before
 * `untilMs` (the caster's next press of the button, the round's end). A
 * follow-up the log does not show (the series was cut, the aura before it
 * has no logged end or was applied again first, the round ended) has no
 * row, and neither has any after it. One reading for the line's length
 * (`pressDuration`) and the scans that follow the series to its end (scan5
 * `offListPressLine`, `pressChainLasts`).
 */
export function pressChainFollowUps(
  caster: ICombatUnit,
  unit: ICombatUnit,
  head: ICombatUnit["auraEvents"][number],
  untilMs = Infinity,
): IPressChainFollowUp[] {
  const ids = PRESS_EFFECT_CHAIN_AURAS[head.spellId ?? ""];
  if (!ids) return [];
  const source = PRESS_EFFECT_CHAIN_HOLDER_SOURCED.has(head.spellId!)
    ? unit
    : caster;
  const events = unit.auraEvents ?? [];
  let prev: ICombatUnit["auraEvents"][number] | undefined = head;
  return ids.map((spellId) => {
    const from: number = prev === undefined ? -1 : events.indexOf(prev);
    let applied: ICombatUnit["auraEvents"][number] | undefined;
    if (prev !== undefined && from >= 0) {
      // the end of the aura before it: its own REMOVED, read in row order
      // (an older instance's REMOVED in the row's millisecond sits before
      // the row); a second APPLIED first is another application, whose end
      // is not this one's
      const own = (a: ICombatUnit["auraEvents"][number]) =>
        a.spellId === prev!.spellId &&
        a.srcUnitId === prev!.srcUnitId &&
        a.destUnitId === unit.id;
      const next = events
        .slice(from + 1)
        .find(
          (a) =>
            own(a) &&
            (a.logLine.event === LogEvent.SPELL_AURA_REMOVED ||
              a.logLine.event === LogEvent.SPELL_AURA_APPLIED),
        );
      const endMs =
        next?.logLine.event === LogEvent.SPELL_AURA_REMOVED
          ? next.logLine.timestamp
          : undefined;
      if (endMs !== undefined)
        applied = events.find(
          (a) =>
            a !== prev &&
            a.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
            a.spellId === spellId &&
            a.srcUnitId === source.id &&
            a.destUnitId === unit.id &&
            Math.abs(a.logLine.timestamp - endMs) <= PRESS_CHAIN_HANDOVER_MS &&
            a.logLine.timestamp >= prev!.logLine.timestamp &&
            a.logLine.timestamp < untilMs,
        );
    }
    prev = applied;
    return { spellId, source, ...(applied ? { applied } : {}) };
  });
}

/** The duration a press's line prints, and the APPLIED row it is read
 * from: the first of `pressAuraCandidates` (bounded by the caster's next
 * press of the spell among `casterRows`) whose talented duration is at least
 * `PRESS_LINE_MIN_DURATION_S`; none when the first is a REFRESH. Shared by
 * the line and its gate (`offListPressLine` lastsBeyond, scan5). */
export function pressDuration(
  caster: ICombatUnit,
  cast: {
    spellId?: string;
    destUnitId?: string;
    logLine: { timestamp: number };
  },
  allUnits: readonly ICombatUnit[],
  casterRows: ICombatUnit["spellCastEvents"],
  /** the round's end: no follow-up row of a series is read past it (codex
   * 85-tk-G-T40-1b #2) */
  roundEndAtMs = Infinity,
):
  | {
      durationSeconds: number;
      /** the length is a floor: the caster's copy runs past it by an amount
       * the log cannot price (`buffDurationIsFloorForCaster`, Timewalker) */
      floor: boolean;
      unit: ICombatUnit;
      row: ICombatUnit["auraEvents"][number];
      /** the follow-ups of the series `row` heads (`pressChainFollowUps`),
       * their lengths in `durationSeconds`; empty for a single aura */
      followUps: IPressChainFollowUp[];
    }
  | undefined {
  const at = cast.logLine.timestamp;
  const nextPressMs = casterRows.find(
    (r) =>
      r.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
      r.spellId === cast.spellId &&
      r.logLine.timestamp > at,
  )?.logLine.timestamp;
  let candidates = pressAuraCandidates(caster, cast, allUnits, nextPressMs);
  // none at or after the cast row: a row the log wrote ahead of it is the
  // press's own (GH #179 3d — Divine Steed's 221883 1 ms before its
  // SUCCESS). Only then: widening every press moved lines that already read
  // a row of their own (a Holy Armament's self REFRESH 1 ms ahead hid the
  // ally's APPLIED it had printed)
  if (!candidates.length)
    candidates = pressAuraCandidates(
      caster,
      cast,
      allUnits,
      nextPressMs,
      undefined,
      AURA_BEFORE_CAST_ROW_MAX_MS,
    );
  // an empowered press lands at its release (codex 20-179a #3: Dream
  // Breath's bundle at a 2 s release is no re-state)
  const landAt = empowerReleaseMs(caster, cast, nextPressMs) ?? at;
  const skipped = new Set<ICombatUnit>();
  for (let k = 0; k < candidates.length; k++) {
    const { unit, row } = candidates[k]!;
    // laid on an aura already up: the life is what was left plus the
    // press's share, not the table's length (Holy Armaments: 605 files,
    // 96 + 71 of the presses printed `lasts 20s` lived 26–48 s)
    if (row.logLine.event === LogEvent.SPELL_AURA_REFRESH) return undefined;
    // a row the log re-stated after the unit was unseen (Vanish, Mass
    // Invisibility) is when the aura showed again, not when it went up —
    // the press's own row is the next candidate (GH #179: a Holy Bulwark
    // read off the target's re-state 2.1 s after its Vanish printed 20 s
    // and ran 29.9 s with the caster's own refreshed copy). Only a row
    // apart from the press: the press's own millisecond carries its own
    // bundle of APPLIED rows on the caster (a Gladiator's Badge beside
    // wings and trinket procs — the first cut dropped `lasts` off 447
    // [PRESS] lines in the 605 capture)
    if (
      row.logLine.timestamp - landAt > PRESS_RESTATE_MIN_LAG_MS &&
      isResyncBatchAt(unit, row.logLine.timestamp)
    ) {
      // the rest are the same aura on the other units: a press's other
      // effect aura is not its length (Holy Bulwark's 432607 is the shield
      // it re-lays every 2 s — 47.4 s on the caster, 605 capture 128-5)
      skipped.add(unit);
      candidates.splice(
        k + 1,
        Infinity,
        ...pressAuraCandidates(
          caster,
          cast,
          allUnits,
          nextPressMs,
          new Set([row.spellId!]),
          AURA_BEFORE_CAST_ROW_MAX_MS,
        ).filter((c) => !skipped.has(c.unit)),
      );
      continue;
    }
    // nor when a second copy lands on it in the same millisecond: a Holy
    // Armament cast on oneself by a paladin it also arms — APPLIED then
    // REFRESH, and the aura runs 40 s (GH #179: 2 of 79 self-casts in 22
    // files, both 40.0 s)
    if (
      (unit.auraEvents ?? []).some(
        (a) =>
          a !== row &&
          a.logLine.event === LogEvent.SPELL_AURA_REFRESH &&
          a.srcUnitId === caster.id &&
          a.spellId === row.spellId &&
          a.logLine.timestamp === row.logLine.timestamp,
      )
    )
      return undefined;
    // priced at the aura's own row, not the press: an empowered breath logs
    // its SPELL_CAST_SUCCESS when the empower STARTS, so the release
    // (SPELL_EMPOWER_END) that sets its length comes after the press and
    // `castParamAt` (which looks back from the aura) found no level — Fire
    // Breath / Dream Breath printed DB2's 2 s placeholder (GH #183)
    // a row logged ahead of the press reads its cast parameter at the
    // press: the cast that sets it comes after the row (GH #179 3d: a Tip the
    // Scales Dream Breath's 355941 1 ms before its SUCCESS read DB2's 2 s
    // placeholder). Extensions stay bounded by the row (codex 20-179d #1: a
    // Lightning Bolt between Spiritwalker's Grace's row and its SUCCESS
    // extends it)
    const base = buffFullDurationForCaster(
      row.spellId!,
      caster,
      row.logLine.timestamp,
      {
        pressed: true,
        onUnitId: unit.id,
        paramAtMs: Math.max(row.logLine.timestamp, landAt),
      },
    );
    if (base === undefined || base < PRESS_LINE_MIN_DURATION_S) continue;
    // what the game did to this application (GH #179, 2026-11-05): an
    // Oppressing Roar on the unit lengthens a control / slow / root it
    // covers by 30 % (the CC lines' own `ccFullDurationForApplication`
    // reading — Chimaeral Sting's slow 3.90–3.92 s ×4 under it, 2.98–3.02
    // s ×54 without; Flying Serpent Kick 5.21; Landslide 7.81), a Prismatic
    // Barrier up on it shortens a harmful Magic one by 15 % (GH #126, the
    // same reading — a debuff only: the barrier's own buff, or any other
    // Magic buff on its holder, keeps its length; codex 20-cat4A-01 #1), and
    // a Time Stop on the unit holds it for as long as it ran
    const landingMult = (
      spellId: string,
      applied: ICombatUnit["auraEvents"][number],
    ) =>
      (oppressingRoarLengthens(spellId) && oppressingRoarOnAt(unit, applied)
        ? OPPRESSING_ROAR_PVP_CC_DURATION_MULT
        : 1) *
      (applied.auraType === "DEBUFF" &&
      prismaticBarrierShortens(spellId) &&
      prismaticBarrierOnAtMs(unit, applied.logLine.timestamp)
        ? PRISMATIC_BARRIER_PVP_MAGIC_DURATION_MULT
        : 1);
    const own = base * landingMult(row.spellId!, row);
    // pipeline T40: an effect that is a series of auras, each applied when
    // the one before it ends (`PRESS_EFFECT_CHAIN_AURAS` — Chimaeral Sting's
    // three venoms, Aspect of the Cheetah's second phase), lasts the whole
    // series. Each follow-up at its own source's talented length (Aspect of
    // the Fox's +4 s on the second phase), under what sat on the unit as
    // ITS row landed — the two readings above, taken at that row (codex
    // 85-tk-G-T40-1 #2: 38f2679e, a Roar still up when Spider Venom landed
    // and gone before Viper, 3.9 + 3.9 + 3.0 s printed `lasts 9.9s`). A
    // follow-up the log does not show runs its plain length.
    // A Time Stop holds the phase it starts in, each observed phase read
    // on its own (codex 85-tk-G-T40-1b #1: one in Cheetah's second phase,
    // 3 + 9 + 5 s, printed `lasts 12s`).
    const followUps = pressChainFollowUps(
      caster,
      unit,
      row,
      // strictly before the next press; a row AT the round's end is inside
      Math.min(nextPressMs ?? Infinity, roundEndAtMs + 1),
    );
    let len = own + timeStopHeldSeconds(unit, row.logLine.timestamp, own, row);
    for (const f of followUps) {
      const plain =
        buffFullDurationForCaster(
          f.spellId,
          f.source,
          (f.applied ?? row).logLine.timestamp,
          { pressed: true, onUnitId: unit.id },
        ) ?? 0;
      if (!f.applied) {
        len += plain;
        continue;
      }
      const phase = plain * landingMult(f.spellId, f.applied);
      len +=
        phase +
        timeStopHeldSeconds(
          unit,
          f.applied.logLine.timestamp,
          phase,
          f.applied,
        );
    }
    return {
      durationSeconds: len,
      floor: buffDurationIsFloorForCaster(row.spellId!, caster),
      unit,
      row,
      followUps,
    };
  }
  return undefined;
}

/** The round's off-list presses of every player, in time order. */
export function extractOffListPresses(
  players: readonly ICombatUnit[],
  combat: AtomicArenaCombat,
  roundEndAtMs: number,
): IOffListPress[] {
  const out: IOffListPress[] = [];
  const allUnits = Object.values(combat.units) as ICombatUnit[];
  for (const unit of players) {
    const rows = unit.spellCastEvents ?? [];
    for (const c of rows) {
      if (c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS || !c.spellId)
        continue;
      const at = c.logLine.timestamp;
      if (at < combat.startTime || at > roundEndAtMs) continue;
      if (!isOffListPressId(c.spellId) || isNoPressRow(c, rows)) continue;
      // Stasis replaying a stored spell: its copy, not a press (the ledger's
      // own reading, `isStasisReplayCast`)
      if (isStasisReplayCast(unit, c.spellId, at)) continue;
      // nor is a row echoing a Time Spiral free press (`timeSpiralEchoMs`)
      if (
        timeSpiralEchoMs(
          unit,
          c.spellId,
          rows
            .filter(
              (r) =>
                r.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
                r.spellId === c.spellId,
            )
            .map((r) => r.logLine.timestamp),
        ).includes(at)
      )
        continue;
      // a hold never released fired nothing (GH #183): no press to state —
      // read off the row itself (`unreleasedHoldMs`, the scan5 gate's own
      // pairing), not off the ledger, whose dedup may have kept another row
      if (unreleasedHoldMs(unit, c.spellId, [at]).length) continue;
      const entry = unitCooldownEntry(unit, combat, c.spellId);
      if (!entry) continue;
      const t = (at - combat.startTime) / 1000;
      const dur = pressDuration(unit, c, allUnits, rows, roundEndAtMs);
      out.push({
        unit,
        spellId: c.spellId,
        timeSeconds: t,
        // the press's own when it has one (Cycle of Hatred's stacks, GH
        // #183 codex review: `Eye Beam (30s cd, back 1:20)` at 4 stacks)
        // (a cut hold in the same 50 ms is not this press: codex round 5)
        cooldownSeconds:
          entry.casts.find(
            (k) => !k.unreleased && Math.abs(k.timeSeconds - t) < 0.05,
          )?.baseCooldownSeconds ?? entry.cooldownSeconds,
        charges: entry.charges ?? 1,
        readyAgainAtSeconds: pressReadyAgainAtSeconds(upToPress(entry, t), t),
        ...(entry.casts.some(
          (k) =>
            k.freeRecast && !k.unreleased && Math.abs(k.timeSeconds - t) < 0.05,
        )
          ? { free: true as const }
          : {}),
        ...(c.spellId === GLADIATOR_BADGE_SPELL_ID &&
        equippedBadgeCount(unit) >= 2
          ? { equipped: equippedBadgeCount(unit) }
          : {}),
        ...(dur
          ? {
              durationSeconds: dur.durationSeconds,
              ...(dur.floor ? { durationIsFloor: true as const } : {}),
              durationAura: {
                unitId: dur.unit.id,
                spellId: dur.row.spellId!,
                atMs: dur.row.logLine.timestamp,
              },
            }
          : {}),
      });
    }
    // fact11 D42 (ea47f4c6 r0 0:35): a press that logs only its own aura
    // (`NO_CAST_LOG_PRESS_IDS` — Rain from Above, DB2 NO_CAST_LOG; never a
    // proc-capable key): the ledger's aura-read presses, those no logged row
    // of the button backs
    for (const id of NO_CAST_LOG_PRESS_IDS) {
      if (!isOffListPressId(id)) continue;
      const entry = unitCooldownEntry(unit, combat, id);
      if (!entry) continue;
      for (const k of entry.casts) {
        if (k.unreleased) continue;
        const at = combat.startTime + k.timeSeconds * 1000;
        if (at > roundEndAtMs) continue;
        if (
          rows.some(
            (r) =>
              r.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
              r.spellId === id &&
              Math.abs(r.logLine.timestamp - at) <=
                SAVE_CAST_AURA_PAIR_S * 1000,
          )
        )
          continue;
        out.push({
          unit,
          spellId: id,
          timeSeconds: k.timeSeconds,
          cooldownSeconds: k.baseCooldownSeconds ?? entry.cooldownSeconds,
          charges: entry.charges ?? 1,
          readyAgainAtSeconds: pressReadyAgainAtSeconds(
            upToPress(entry, k.timeSeconds),
            k.timeSeconds,
          ),
        });
      }
    }
  }
  return out.sort((a, b) => a.timeSeconds - b.timeSeconds);
}

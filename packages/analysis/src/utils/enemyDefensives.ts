/**
 * Enemy defensives — the ONE predicate for "which enemy abilities count as a
 * real defensive", shared by the KILL ATTEMPTS attribution
 * (`killAttempts.ts`: `popped X` / `saved by external (X)`) and the timeline's
 * `[ENEMY DEF]` lines (`context/matchTimeline.ts`), so the summary block and
 * the timeline can never disagree about what a wall is (CLAUDE.md
 * Shared-Predicate Rule; GH #97, 2026-09-15). The sets lived as module-private
 * consts in killAttempts.ts before this file.
 */
import { ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { saveSchoolMask } from "../analysis/candidates/cooldownTiming";
import { wallDoorPct } from "../data/mitigationComponents";
import {
  MITIGATION_TABLE,
  NO_MITIGATION_IDS,
  SELF_WALL_AURA_TO_CAST_ID,
} from "../data/mitigationData";
import { getEnglishSpellName } from "../data/spellEffectData";
import spellIdListsData, {
  ENEMY_ALLY_SAVE_IDS,
  ENEMY_AREA_SAVE_IDS,
  ENEMY_IMMUNITY_EXTERNAL_CASTS,
  ENEMY_IMMUNITY_HOLDS_ITS_AURA_IDS,
  ENEMY_IMMUNITY_SAVE_AURAS,
  ENEMY_ONLY_SAVE_IDS,
  ENEMY_PROC_SAVES,
  ENEMY_REDIRECT_SAVE_IDS,
  ENEMY_STEALTH_WALL_AURAS,
  type EnemyProcSaveEffect,
} from "../data/spellIdLists";
import { immunitySchoolMask } from "../data/spellSchools";
import { auraEndFromLog, type IAuraEndFromLog } from "./auraEndCause";
import { buildAuraIntervals, type IAuraInterval } from "./auraIntervals";
import { buffFullDurationForCaster } from "./buffDuration";
import { AURA_ONLY_ACTIVATION_IDS } from "./cooldowns";
import { toRenderSecond } from "./renderGrid";

const ALL_SCHOOLS = 0x7f;

export const EXTERNAL_DEF_IDS = new Set<string>(
  (spellIdListsData as unknown as { externalDefensiveSpellIds?: string[] })
    .externalDefensiveSpellIds ?? [],
);

/** Immunities in the official table are recorded as pct 100 (spec decision in
 * mitigationData.ts). Baiting one out is a WIN per the user ruling ("冰箱圣盾
 * 不管,交了也算我们赚") — so it is its own attribution, never a reproach. */
export const IMMUNITY_IDS = new Set<string>(
  Object.entries(MITIGATION_TABLE)
    .filter(([, e]) => e.pct === 100)
    .map(([id]) => id),
);

/** Every damage school (`IMitigationEntry.schoolMask`). */
const EVERY_SCHOOL_MASK = 0x7f;

/** The pct-100 rows that stop EVERY school — Ice Block, Divine Shield, Aspect
 * of the Turtle: under one the unit takes no damage at all.
 *
 * User ruling F-K9b-B (2026-10-02): `IMMUNITY_IDS` is split in two and a
 * reader that asks "can this unit be hurt right now" reads only this half —
 * kick-eaten's low-HP skip and the stayed-in skip of position-mistake import
 * the same two sets, so there is one answer. Derived from the signed table,
 * so a new pct-100 row falls on one side by its mask
 * (`test/immunityTables.test.ts` pins both halves, and their keys against
 * `deathOutcomeAnalysis.IMMUNITY_SPELLS`).
 * Interim: enemy-def F-E24 (ruling A30: a school-limited immunity counts as
 * full when >= 50 % of the incoming damage is of the school it stops) is the
 * finer rule; whether these two readers move to it is decided when it lands. */
export const FULL_IMMUNITY_IDS: ReadonlySet<string> = new Set(
  Object.entries(MITIGATION_TABLE)
    .filter(
      ([, e]) =>
        e.pct === 100 &&
        (e.schoolMask & EVERY_SCHOOL_MASK) === EVERY_SCHOOL_MASK,
    )
    .map(([id]) => id),
);

/** The pct-100 rows that stop one kind of damage only — Blessing of
 * Protection (physical), Blessing of Spellwarding and Cloak of Shadows
 * (magic). A unit under one can still be hurt, and killed, by the other
 * kind. `IMMUNITY_IDS` = this ∪ `FULL_IMMUNITY_IDS`. */
export const SCHOOL_LIMITED_IMMUNITY_IDS: ReadonlySet<string> = new Set(
  [...IMMUNITY_IDS].filter((id) => !FULL_IMMUNITY_IDS.has(id)),
);

/** Feign Death's cast id. Its success is never logged; the ledger reads the
 * press from the aura(s) `AURA_ONLY_ACTIVATION_IDS` lists for it (Survival
 * Tactics 202748), and so does this file — one table for "a Feign Death
 * happened". Hunters without that PvP talent leave only `UNIT_DIED …
 * unconscious=1`, which parser-compat does not carry to the analysis units. */
const FEIGN_DEATH_CAST_ID = "5384";

/**
 * Feign Death's logged aura(s) — an ABSORB shield, not an immunity (user
 * ruling D8, 2026-10-10: "假死印它的吸收"). Read from the ledger's own table,
 * so the two readers of "a Feign Death happened" stay one.
 *
 * Three-way evidence (Game-Behaviour rule), build 12.1.5.69594:
 *  - DB2: Survival Tactics 202748 = aura 69 (SCHOOL_ABSORB) on every school
 *    (`abilityEffectsGenerated`: `absorbs`, mask 127) and no school immunity
 *    (aura 39) — `test/enemyDefensives.test.ts` re-reads both;
 *  - corpus, the 605 new-season files (fix-FT/t07-enemydef-vs-raw-605.txt):
 *    697 `[ENEMY DEF]` lines, every APPLIED carrying a shield amount; an
 *    enemy player's direct damage lands on the hunter inside the aura in 510
 *    (73 %), an IMMUNE miss is logged in 23. Divine Shield: 0 of 209 hit;
 *  - one log (0e0663e6 0:21): APPLIED 594,477 → REMOVED 530,795 two seconds
 *    later, the SPELL_ABSORBED lines naming 202748 between them, the hunter
 *    68 % → 67 %.
 */
export const FEIGN_DEATH_ABSORB_AURA_IDS: ReadonlySet<string> = new Set(
  AURA_ONLY_ACTIVATION_IDS[FEIGN_DEATH_CAST_ID] ?? [],
);

/** Enemy-def F-E5 / F-E6 (user ruling A25, 2026-09-30, narrowed by D8,
 * 2026-10-10): auras the `[ENEMY DEF]` line prints as `immune` and KILL
 * ATTEMPTS reads as "forced a full immunity" although they are no pct-100
 * `MITIGATION_TABLE` row — the unit cannot be hit (Burrow, Time Stop, Mass
 * Invisibility, Vanish, Guardian of the Forgotten Queen). Logged aura id →
 * the ability name to print. `IMMUNITY_IDS` stays the pct-100 slice: other
 * predicates read it as exactly that. Feign Death, Cheat Death, Cauterize
 * and Nature's Guardian left this set with D8 — `effectSaves`. */
export const IMMUNITY_SAVE_AURA_NAMES: ReadonlyMap<string, string> = new Map(
  Object.entries(ENEMY_IMMUNITY_SAVE_AURAS),
);

/** Is this aura an immunity for the enemy-save predicate — a pct-100 table
 * row or an immunity-kind save. The one test the `[ENEMY DEF]` aura loop and
 * the KILL ATTEMPTS `immunity-baited` attribution share. */
export function isImmunitySaveAura(spellId: string): boolean {
  return IMMUNITY_IDS.has(spellId) || IMMUNITY_SAVE_AURA_NAMES.has(spellId);
}

/**
 * Does this immunity hold for as long as its aura is up? KILL ATTEMPTS may
 * count an immunity that was "already up when the attempt began" only then.
 * True for
 *  - the pct-100 table rows (Divine Shield, Ice Block, Blessing of
 *    Protection …),
 *  - an immunity-kind save whose own aura carries DB2's all-school
 *    SCHOOL_IMMUNITY (aura 39, mask 127 — `immunitySchoolMask`): Time Stop
 *    378441 and Guardian of the Forgotten Queen 228050, and
 *  - Burrow 409293, Vanish 11327 and Mass Invisibility 414664, by user
 *    rulings U-KA3 / U-KA3b (2026-10-06, `ENEMY_IMMUNITY_HOLDS_ITS_AURA_IDS`):
 *    the unit cannot be attacked while the aura is up; a DoT already on it,
 *    area damage and a hit inside the aura's first second still land and are
 *    no evidence against it.
 * Until ruling D8 (2026-10-10) the list also held Cauterize, Cheat Death and
 * Feign Death, which only marked the MOMENT a unit could not be killed —
 * the last three rows below; they are no immunity now (`effectSaves`), so
 * every aura left in the list holds while it is up, and the test stays as
 * the guard for an entry added later. Corpus leg, the 605 S2 files —
 * damage on the carrier while the aura was up (0.3 s after it went up to
 * 0.1 s before it dropped), any row (fix-KA/immAuraProbe.ts, 2026-10-02) and
 * rows other than a periodic tick (fix-FU/immSplitRaw.py, 2026-10-06; an
 * aura whose REMOVED the log lost is set aside there):
 *
 *                      auras   any damage   other than a periodic tick
 *   Divine Shield        408        0          0 (Blessing of Sacrifice's
 *                                                 own split aside)
 *   Ice Block            343        1          1 (Spirit Link)
 *   Time Stop             35        1          1 (Spirit Link); 533 IMMUNE
 *   Forgotten Queen        2        0          0;                53 IMMUNE
 *   Burrow                89       80         16 — splash, procs, area
 *   Vanish               533      264        123 of 462 — area damage and
 *                                                 splinters, all ≤ 1.5 s in
 *   Mass Invisibility    691      138         47 of 593, all ≤ 1.0 s in
 *   Cauterize             72       66         62 — melee swings first
 *   Cheat Death           10        7          7
 *   Feign Death (202748) 1,474  1,328      1,135
 *
 * The first cut applied the rule to every immunity-kind aura: 334 attempts
 * became "forced a full immunity" on a target a stun had just landed on, 250
 * of them an enemy mage's opening Mass Invisibility (fix-KA/immcheck.py,
 * 2026-10-01). U-KA3b rules Mass Invisibility in with that on the table. Needs the official spell facts loaded (`ensureAnalysisData`);
 * before that only the table rows answer true.
 */
export function immunityLastsItsAura(spellId: string): boolean {
  if (IMMUNITY_IDS.has(spellId)) return true;
  return (
    IMMUNITY_SAVE_AURA_NAMES.has(spellId) &&
    (ENEMY_IMMUNITY_HOLDS_ITS_AURA_IDS.has(spellId) ||
      ((immunitySchoolMask(spellId) ?? 0) & ALL_SCHOOLS) === ALL_SCHOOLS)
  );
}

/**
 * The save auras whose CARRIER goes unseen, taking the aura's REMOVED line
 * out of the recorder's log: the three stealth-kind immunities of rulings
 * U-KA3 / U-KA3b (`ENEMY_IMMUNITY_HOLDS_ITS_AURA_IDS`: Burrow, Vanish, Mass
 * Invisibility) and the stealth wall ruling D6 adds
 * (`ENEMY_STEALTH_WALL_AURAS`: Greater Invisibility). For these a missing
 * REMOVED says nothing about the aura still being up — on the 605 new-season
 * files 97 % of an opponent's Greater Invisibilities have none, while an
 * ally's is over in 0.74 s (median).
 */
export const SAVE_AURA_END_UNSEEN_IDS: ReadonlySet<string> = new Set([
  ...ENEMY_IMMUNITY_HOLDS_ITS_AURA_IDS,
  ...Object.keys(ENEMY_STEALTH_WALL_AURAS),
]);

/** The same auras by the name their `[ENEMY DEF]` line and a KILL ATTEMPTS
 * cause print — what the gate (`checkKillAttemptUpSinceEndLogged`) and the
 * KILL ATTEMPTS legend read. */
export const SAVE_AURA_END_UNSEEN_NAMES: ReadonlySet<string> = new Set([
  ...[...ENEMY_IMMUNITY_HOLDS_ITS_AURA_IDS].map((id) =>
    IMMUNITY_SAVE_AURA_NAMES.get(id)!,
  ),
  ...Object.values(ENEMY_STEALTH_WALL_AURAS),
]);

/**
 * May a save aura that was ALREADY UP when a kill attempt began count as why
 * it failed (KILL ATTEMPTS rule 2), as far as its END goes? Not when its
 * carrier goes unseen (`SAVE_AURA_END_UNSEEN_IDS`) and the log never showed
 * the aura end: it is then "up" at the attempt's start only by the interval
 * builder's official-length cap (`inferredEnd`).
 *
 * User ruling P-FU-b8 (2026-10-06, option C) set this for the three
 * stealth-kind immunities: "群体隐形只在光环被观测到仍在时算免疫,丢 REMOVED
 * 的不按 12 s 封顶". Ruling D6 (2026-10-10) extends it to Greater
 * Invisibility, a 60 % WALL that never passed through the immunity test: on
 * the 605 new-season files `FAILED: popped Greater Invisibility [up since
 * m:ss]` stood on at least 219 prompt lines, each read off the 20 s cap
 * (fix-FT/T07-notes §2.2) — s2/112-1-757: pressed at 5:49, the mage casting
 * Combustion 3 s later and taking direct damage from 5:54, the attempt at
 * [6:04–6:18] "failed" on it. An aura that went up INSIDE the attempt is
 * untouched: its start is logged.
 *
 * Every other aura keeps the cap (P-FU-b8: "a pct-100 table row or a DB2
 * all-school immunity keeps the cap"; the rulings name no other wall or
 * external): its carrier stays in the recorder's sight, so a missing REMOVED
 * is a lost line, not a unit that left the log.
 */
export function saveAuraCountsWhenAlreadyUp(
  iv: Pick<IAuraInterval, "spellId" | "inferredEnd">,
): boolean {
  return !(SAVE_AURA_END_UNSEEN_IDS.has(iv.spellId) && iv.inferredEnd);
}

/**
 * May an immunity that was ALREADY UP when a kill attempt began count as why
 * it failed (KILL ATTEMPTS rule 2)? `immunityLastsItsAura`, and for the
 * ruled-in stealth-kind auras (`ENEMY_IMMUNITY_HOLDS_ITS_AURA_IDS`: Burrow,
 * Vanish, Mass Invisibility) only an aura the log SAW end — user ruling
 * P-FU-b8, through `saveAuraCountsWhenAlreadyUp`.
 *
 * Why: a unit that goes unseen often takes its aura's REMOVED line with it,
 * and `buildAuraIntervals` then closes the aura at its official length
 * (`inferredEnd`). For Mass Invisibility that is 12 s, while a logged one on
 * an ally ends within 0.6 s (median; an attack or a cast breaks it). Counted
 * at the cap, the 605 S2 files turned 293 attempts into "forced a full
 * immunity [up since …]", 233 of them rows that count stuns which LANDED on
 * the "immune" target. One rule for the three ruled-in auras: they are the
 * ones whose carrier goes unseen. A pct-100 table row or a DB2 all-school
 * immunity keeps the cap, as before.
 */
export function immunityCountsWhenAlreadyUp(
  iv: Pick<IAuraInterval, "spellId" | "inferredEnd">,
): boolean {
  return immunityLastsItsAura(iv.spellId) && saveAuraCountsWhenAlreadyUp(iv);
}

/** What an effect save does, as its `[ENEMY DEF]` line says it: Feign Death's
 * shield, or what a proc is (`ENEMY_PROC_SAVES`). */
export type EnemySaveEffect = "absorb" | EnemyProcSaveEffect;

/** Ability name → its effect, for every effect save. The `[ENEMY DEF]` gate
 * (`checkEnemyDefSaveEffect`) reads the rendered line against this map. */
export const ENEMY_SAVE_EFFECT_BY_NAME: ReadonlyMap<string, EnemySaveEffect> =
  new Map<string, EnemySaveEffect>([
    ["Feign Death", "absorb"],
    ...Object.values(ENEMY_PROC_SAVES).map((p): [string, EnemySaveEffect] => [
      p.name,
      p.effect,
    ]),
  ]);

/** One effect save of a unit (`effectSaves`). */
export interface IEffectSave {
  /** seconds from match start: the aura's start, or the heal's instant */
  atSeconds: number;
  /** the logged id — the aura, or the heal */
  spellId: string;
  spellName: string;
  effect: EnemySaveEffect;
  /** the aura the save is read from; absent for a heal proc, which leaves none */
  interval?: ISaveAuraInterval;
}

/**
 * The unit's own saves that are named by their EFFECT (user ruling D8,
 * 2026-10-10) — Feign Death's absorb shield, Nature's Guardian's heal, a
 * Cheat Death / Cauterize proc — in log order. None of them is pressed in
 * the log (Feign Death's cast is never logged, the other three are passives),
 * so they are read from the unit's own aura intervals (`saveAuraIntervals`)
 * and its heals of itself. One reader for the `[ENEMY DEF]` line and for the
 * KILL ATTEMPTS `self-saved (X)` attribution.
 */
export function effectSaves(
  unit: ICombatUnit,
  intervals: readonly ISaveAuraInterval[],
  matchStartMs: number,
): IEffectSave[] {
  const out: IEffectSave[] = [];
  for (const iv of intervals) {
    if (!isIntervalFrom(iv, unit)) continue;
    if (FEIGN_DEATH_ABSORB_AURA_IDS.has(iv.spellId)) {
      out.push({
        atSeconds: iv.fromS,
        spellId: iv.spellId,
        spellName: "Feign Death",
        effect: "absorb",
        interval: iv,
      });
      continue;
    }
    const proc = ENEMY_PROC_SAVES[iv.spellId];
    if (proc?.via !== "aura") continue;
    out.push({
      atSeconds: iv.fromS,
      spellId: iv.spellId,
      spellName: proc.name,
      effect: proc.effect,
      interval: iv,
    });
  }
  for (const h of unit.healIn ?? []) {
    const proc = h.spellId ? ENEMY_PROC_SAVES[h.spellId] : undefined;
    if (proc?.via !== "heal" || h.srcUnitId !== unit.id) continue;
    out.push({
      atSeconds: (h.logLine.timestamp - matchStartMs) / 1000,
      spellId: h.spellId!,
      spellName: proc.name,
      effect: proc.effect,
    });
  }
  return out.sort((a, b) => a.atSeconds - b.atSeconds);
}

/**
 * What a shield aura absorbed over one application: the sum of the
 * SPELL_ABSORBED lines that name it, on its holder, inside the interval —
 * `auraEndFromLog`'s reading, the one the `— used up, absorbed Nk` end note
 * prints. Undefined when the log has no such line for it: nothing hit the
 * shield, or the record carries no absorb lines — the two are not told
 * apart, so no figure is printed (never a 0).
 */
export function absorbedDuring(
  holder: ICombatUnit,
  iv: ISaveAuraInterval,
  matchStartMs: number,
): number | undefined {
  return auraEndFromLog(
    holder,
    iv.spellId,
    {
      fromMs: Math.round(matchStartMs + iv.fromS * 1000),
      removedMs: Math.round(matchStartMs + iv.toS * 1000),
    },
    iv.srcUnitId ?? holder.id,
  ).absorb?.absorbed;
}

/**
 * What an effect save's `[ENEMY DEF]` line prints in its parenthesis:
 * `absorb 64k, 2.0s` (the amount is left out when the log gives none, and an
 * amount that rounds to 0k reads `<1k`), `heal proc`, `cheat-death proc`.
 * `duration` is the line's own duration text (`2.0s`, `1.2s — used up`,
 * `end not logged`).
 */
export function enemySaveEffectNote(
  effect: EnemySaveEffect,
  absorbedAmount: number | undefined,
  duration: string,
): string {
  if (effect !== "absorb") return effect;
  const k =
    absorbedAmount === undefined
      ? undefined
      : Math.round(absorbedAmount / 1000);
  const amount = k === undefined ? "" : k < 1 ? " <1k" : ` ${k}k`;
  return `absorb${amount}${duration ? `, ${duration}` : ""}`;
}

/**
 * What an `[ENEMY DEF]` line prints in place of a duration when the log has
 * no end for the aura (`IEnemyDefensiveEvent.endNotLogged`; user ruling D6,
 * 2026-10-10: "prints `end not logged`, not the official duration presented
 * as OBSERVED"). One literal for the renderer, the legend and the gate
 * (`checkEnemyDefEndNotLogged`).
 */
export const ENEMY_DEF_END_NOT_LOGGED = "end not logged";

/**
 * The parenthesis that carries `ENEMY_DEF_END_NOT_LOGGED`, whole: the phrase
 * stands where the duration would — after the strength (`immune`, `60%`,
 * `absorb 64k`) or alone on an external — and closes the parenthesis. No end
 * note (`— removed early`, `— still up …`) follows it: an end the log never
 * showed has no cause to state.
 */
export const ENEMY_DEF_END_NOT_LOGGED_SLOT_RE = new RegExp(
  String.raw`\((?:(?:immune|\d+%|absorb(?: (?:\d+|<1)k)?), )?${ENEMY_DEF_END_NOT_LOGGED}\)`,
);

/** The start of `enemySaveEffectNote`'s parenthesis, as rendered. */
const ENEMY_SAVE_EFFECT_NOTE_RE = new RegExp(
  String.raw`^\((?:(absorb)(?: (?:\d+|<1)k)?(?:, \d+\.\ds\b|, ${ENEMY_DEF_END_NOT_LOGGED}\)|\))|(heal proc)\)|(cheat-death proc)\))`,
);

/** The effect a rendered `[ENEMY DEF]` parenthesis states (the text that
 * follows the ability's name, from its `(`), or undefined when it states
 * none — `(immune, 8.0s)`, `(30%, 12.0s)`, `(self-save)`. The gate's reader
 * of what `enemySaveEffectNote` wrote. */
export function enemySaveEffectOfNote(
  parenthesis: string,
): EnemySaveEffect | undefined {
  const m = ENEMY_SAVE_EFFECT_NOTE_RE.exec(parenthesis);
  return (m?.[1] ?? m?.[2] ?? m?.[3]) as EnemySaveEffect | undefined;
}

/** When `unit` carried a FULL immunity (`FULL_IMMUNITY_IDS`), seconds since
 * the match start, from the shared aura pairing. For readers that must not
 * treat an immune unit's HP as pressure (kick-eaten's `ourLow*` /
 * `theirLow*`). A school-limited immunity is not in it (ruling F-K9b-B): a
 * Rogue at 12 % inside Cloak of Shadows still dies to physical damage
 * (cb6f3e66 @79.5). */
export function fullImmunityIntervals(
  unit: ICombatUnit,
  combat: Parameters<typeof buildAuraIntervals>[1],
): Array<{ spellId: string; fromS: number; toS: number }> {
  return buildAuraIntervals(unit, combat)
    .filter((iv) => FULL_IMMUNITY_IDS.has(iv.spellId))
    .map((iv) => ({ spellId: iv.spellId, fromS: iv.fromS, toS: iv.toS }));
}

/** A unit's OWN full immunity: a `FULL_IMMUNITY_IDS` aura the unit put on
 * itself — the POSITIONING skip rule's test (the owner inside their own Ice
 * Block had nothing to kite from; user ruling 2026-09-30, A′13 = C).
 *
 * It reads the shared FULL half (user ruling F-K9b-B, 2026-10-02 — the same
 * names kick-eaten's low-HP skip imports), so two things are out:
 *  - a SCHOOL-LIMITED immunity (`SCHOOL_LIMITED_IMMUNITY_IDS`): a Cloak of
 *    Shadows under a physical burst blocks nothing — on the 605-file slice
 *    three Rogues inside their own Cloak fell to 34 %, 23 % and 32 %. The
 *    finer rule (enemy-def F-E24, ruling A30) is decided when it lands;
 *  - the immunity-kind saves `isImmunitySaveAura` adds for `[ENEMY DEF]`
 *    kind="immune" (Vanish, Burrow, Mass Invisibility, … — enemy-def F-E5 /
 *    F-E6): a unit under Vanish can still move. */
export function isOwnImmunityInterval(
  unit: Pick<ICombatUnit, "name">,
  iv: { spellId: string; srcUnitName: string },
): boolean {
  return iv.srcUnitName === unit.name && FULL_IMMUNITY_IDS.has(iv.spellId);
}

/** Floor for "a real defensive": the same 20 % door as the kill-opportunity
 * gated tier (WALL_IN_HAND_MIT_IDS). Applied twice — to the table value when
 * building MITIGATION_AURA_IDS, and again per aura through `resolveMitigation`
 * so a talent-shared copy on an ally (Obsidian Scales 15 %) does not count as
 * the target having popped a 30 % wall. */
export const MITIGATION_AURA_MIN_PCT = 20;

/** 20–99% self-mitigation aura ids (the non-immune official table slice) —
 * "the target popped a real defensive during the attempt". */
export const MITIGATION_AURA_IDS = new Set<string>(
  Object.entries(MITIGATION_TABLE)
    .filter(([, e]) => e.pct >= MITIGATION_AURA_MIN_PCT && e.pct < 100)
    .map(([id]) => id),
);

/** The `MITIGATION_TABLE` key behind an aura found on a unit: the aura id
 * itself, or — for a wall whose row is keyed by its cast (Blur 198589 logs
 * aura 212800, Greater Invisibility 110959 logs 110960) — that cast id.
 * Enemy-def F-E1a: the `[ENEMY DEF]` aura loop and the KILL ATTEMPTS `popped
 * X` test both resolve an aura through this before asking any wall set. */
export function wallTableIdOfAura(auraSpellId: string): string {
  return SELF_WALL_AURA_TO_CAST_ID[auraSpellId] ?? auraSpellId;
}

/** A school-limited IMMUNITY's mask: a pct-100 `MITIGATION_TABLE` row that
 * does not cover every school (Blessing of Protection 0x1, Spellwarding and
 * Cloak of Shadows 0x7e). KILL ATTEMPTS calls it a full immunity only when
 * the team's damage was mostly in those schools (ruling A30). Undefined = a
 * full immunity, an immunity-kind save, or no immunity at all. */
export function limitedImmunitySchoolMask(spellId: string): number | undefined {
  const row = MITIGATION_TABLE[spellId];
  if (!row || row.pct < 100) return undefined;
  return (row.schoolMask & ALL_SCHOOLS) === ALL_SCHOOLS
    ? undefined
    : row.schoolMask;
}

/** A school-limited ABSORB's mask: a save with no `MITIGATION_TABLE` row
 * whose DB2 absorb covers only some schools — Anti-Magic Shell 48707 / 410358,
 * 0x7e (ruling A7-补: no percentage row; "学派判断直接读 DB2 吸收学派掩码").
 * Read through `saveSchoolMask`, the reader cd-hoarded's `coversCrisisSchool`
 * uses (F-H20), so the two sides cannot disagree on what AMS covers. KILL
 * ATTEMPTS credits such a save only when the team's damage was mostly in its
 * schools. Undefined = not a table-less school-limited absorb. */
export function limitedAbsorbSchoolMask(spellId: string): number | undefined {
  if (MITIGATION_TABLE[spellId]) return undefined;
  const mask = saveSchoolMask(spellId);
  return mask === undefined || (mask & ALL_SCHOOLS) === ALL_SCHOOLS
    ? undefined
    : mask;
}

/** An external save: a cast that helps the ALLY it is cast on. The friendly
 * roster (`EXTERNAL_DEF_IDS`) plus the enemy-only sets — instant heals (Lay on
 * Hands; enemy-def F-E4), grips / redirects (Leap of Faith, Intervene, Roar
 * of Sacrifice, Master's Call; F-E9, rulings A20 + U3) and the casts that put
 * an immunity on an ally (Guardian of the Forgotten Queen, Time Stop). One
 * test for the `[ENEMY DEF]` external branch, the KILL ATTEMPTS
 * `saved by external (X)` attribution and `selfSaveCasts`' "on an ally it is
 * an external, not a self-save" rule. */
export function isExternalSaveId(spellId: string): boolean {
  return (
    EXTERNAL_DEF_IDS.has(spellId) ||
    ENEMY_ALLY_SAVE_IDS.has(spellId) ||
    ENEMY_REDIRECT_SAVE_IDS.has(spellId) ||
    spellId in ENEMY_IMMUNITY_EXTERNAL_CASTS
  );
}

/** Reliability audit B4a (2026-09-25): an enemy's own save that carries no
 * percentage mitigation — Guardian Spirit on itself, Desperate Prayer, Touch
 * of Karma, Renewing Blaze, Life Cocoon on itself, Rallying Cry, Zephyr — the
 * product's "major" lists (external ∪ big defensive) ∩ `NO_MITIGATION_IDS`.
 * Neither the mitigation-aura test nor the external branch saw these, so a
 * kill attempt the target survived with one was attributed "not enough
 * damage" (a9bc48b5 @2:14: the priest's self Guardian Spirit at 2:16 and
 * Desperate Prayer at 2:20). Both lists are already registered in
 * curatedIdRegistry.
 *
 * Triage 2026-09-29 (enemy-def F-E7 / F-E4 / F-E9; rulings A11, A20): plus the
 * enemy-only sets of `data/spellIdLists.ts` — absorb / heal / avoidance saves
 * outside the major lists (Dark Pact, Evasion, Healthstone, Ice Barrier …),
 * and the ally-castable heals and redirects when cast on oneself (Lay on
 * Hands, Roar of Sacrifice, Master's Call). a0a48716: Death Pact at 1:39 and
 * Lichborne at 1:41 had no line; ae9d6fbc: "Dark Pact" 0 times in the prompt. */
export const SELF_SAVE_IDS: ReadonlySet<string> = new Set<string>([
  ...[
    ...EXTERNAL_DEF_IDS,
    ...(
      (spellIdListsData as unknown as { bigDefensiveSpellIds?: string[] })
        .bigDefensiveSpellIds ?? []
    ).map(String),
  ].filter((id) => NO_MITIGATION_IDS.has(id)),
  ...ENEMY_ONLY_SAVE_IDS,
]);

/** The enemy's own presses of a `SELF_SAVE_IDS` save on itself, in cast
 * order (seconds from match start). An external-capable one (Guardian
 * Spirit, Life Cocoon, Lay on Hands, Roar of Sacrifice) counts only when its
 * cast target is the caster — cast on an ally it is an external, which the
 * external branch already reports. */
export function selfSaveCasts(
  enemy: ICombatUnit,
  matchStartMs: number,
): Array<{ atSeconds: number; spellId: string; spellName: string }> {
  const out: Array<{ atSeconds: number; spellId: string; spellName: string }> =
    [];
  for (const cast of enemy.spellCastEvents ?? []) {
    if (cast.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
    if (!cast.spellId || !SELF_SAVE_IDS.has(cast.spellId)) continue;
    if (isExternalSaveId(cast.spellId) && cast.destUnitId !== enemy.id)
      continue;
    out.push({
      atSeconds: (cast.logLine.timestamp - matchStartMs) / 1000,
      spellId: cast.spellId,
      spellName: getEnglishSpellName(cast.spellId, cast.spellName),
    });
  }
  return out;
}

/** How close to an aura's start its cast is logged, either side. The same
 * pairing radius the external branch uses to tie a cast to its aura. */
export const SAVE_CAST_AURA_PAIR_S = 1.5;

/**
 * Enemy-def F-E12: a second `SPELL_AURA_APPLIED` of an aura that is still up,
 * with no `REMOVED` between, is the game re-announcing ONE press — not the
 * first one ending and a new one starting. `buildAuraIntervals` splits there
 * (its anti-artifact rule for a missed REMOVED followed by a real recast), so
 * the `[ENEMY DEF]` line read one Divine Shield as `(immune, 0.9s)` +
 * `(immune, 7.1s)` (f4eb8c87 2:47), one Guardian Spirit as `(1.6s)` +
 * `(10.4s — removed early)` (69546267 2:05), one Feign Death as three.
 *
 * Joined here, at the `[ENEMY DEF]` layer, because `buildAuraIntervals` has
 * many consumers with their own reading of a re-apply. Two back-to-back
 * intervals of one spell from one source are the same press unless the source
 * logged a SECOND cast of that spell around them: a split with at most one
 * cast behind it (the one that opened the first interval, or none for an
 * aura that is never cast) is one press.
 */
export function joinReappliedIntervals(
  intervals: readonly IAuraInterval[],
  /** round seconds of the source's SPELL_CAST_SUCCESS of `spellId` */
  castSecondsOf: (srcUnitName: string, spellId: string) => readonly number[],
): IAuraInterval[] {
  const out: IAuraInterval[] = [];
  const lastOf = new Map<string, IAuraInterval>();
  for (const iv of intervals) {
    const key = `${iv.spellId}:${iv.srcUnitName}`;
    const prev = lastOf.get(key);
    if (
      prev &&
      prev.inferredEnd &&
      Math.abs(prev.toS - iv.fromS) < 1e-6 &&
      castSecondsOf(iv.srcUnitName, iv.spellId).filter(
        (t) =>
          t >= prev.fromS - SAVE_CAST_AURA_PAIR_S &&
          t <= iv.fromS + SAVE_CAST_AURA_PAIR_S,
      ).length <= 1
    ) {
      prev.toS = iv.toS;
      prev.inferredEnd = iv.inferredEnd;
      continue;
    }
    const copy = { ...iv };
    out.push(copy);
    lastOf.set(key, copy);
  }
  return out;
}

/** How long before its aura a logged cast can still be the press that put
 * it up (an `[ENEMY DEF]` aura kind's `pressSeconds`). */
export const PRESS_TO_AURA_MAX_S = 1;
/** …and how long AFTER its aura the press's own cast line may be logged. */
export const AURA_BEFORE_CAST_MAX_S = 0.05;

/** An observed duration as the `[ENEMY DEF]` line prints it: one decimal. */
export function renderedObservedSeconds(observedSeconds: number): number {
  return Math.round(observedSeconds * 10) / 10;
}

/**
 * An external as its `[ENEMY DEF]` line prints it — `m:ss … (N.Ns)`: the
 * rendered second and the printed length. A reader adding the two gets the
 * end the kill-window span is cut at, to the second (codex review of
 * enemy-def F-E2, 2026-10-03: an external at 24.9 s lasting 11.2 s prints
 * `0:24 … (11.2s)`; cut at the raw 36.1 s the next span read `0:36`, the
 * printed facts give 0:35). Undefined when the event has no paired aura, or
 * a length that rounds to 0.0 s (codex review, 2026-10-04).
 *
 * An external whose end the log never showed (`endNotLogged`: the line
 * prints `end not logged`, no length) keeps its span here, at the interval
 * builder's official-length cap. The one reader cuts `[KILL WINDOW]
 * defenseless` with it, and "defenseless" claims that nothing was up: an
 * aura that may still be up for all the log says cannot be read as gone.
 */
export function renderedExternalSpanS(
  d: Pick<IEnemyDefensiveEvent, "atSeconds" | "observedSeconds">,
): { from: number; to: number } | undefined {
  if (d.observedSeconds === undefined) return undefined;
  // a length that prints as 0.0s protected nothing the reader can see
  const length = renderedObservedSeconds(d.observedSeconds);
  if (length <= 0) return undefined;
  const from = toRenderSecond(d.atSeconds);
  return { from, to: from + length };
}

/** An observed aura ended this much before its full duration → "removed
 * early" (dispelled, broken by damage/immunity rules, or cancelled). One
 * second of slack absorbs the log's aura-event jitter. */
export const REMOVED_EARLY_SLACK_S = 1;

export interface IEnemyDefensiveEvent {
  atSeconds: number;
  /** An aura kind's PRESS: the logged cast of the same button by the same
   * enemy that put the aura up — the one nearest the aura, at most
   * `PRESS_TO_AURA_MAX_S` before it or `AURA_BEFORE_CAST_MAX_S` after.
   * The `[ENEMY DEF]` line reads HP at this instant (`hpAtPress`, A21) —
   * the aura can land a few ms after damage the press already took.
   * Undefined when no such cast is logged (a proc / an aura-only press):
   * the line falls back to `atSeconds`. */
  pressSeconds?: number;
  spellId: string;
  spellName: string;
  /** the enemy who pressed it */
  casterName: string;
  casterId?: string;
  /** "self" = a wall on the caster (pct < 100); "immune" = pct 100; "external" = cast on another enemy; "self-save" = the caster's own no-%-mitigation save (`SELF_SAVE_IDS`, or an effect save — see `effect`); "area" = an area save anchored on its cast (`ENEMY_AREA_SAVE_IDS`): who pressed it and when, nothing else */
  kind: "self" | "immune" | "external" | "self-save" | "area";
  /** Set on a self-save that is named by what it does (`effectSaves`, ruling
   * D8): the line prints `(absorb Nk, Ts)` / `(heal proc)` / `(cheat-death
   * proc)` in place of `(self-save)`. */
  effect?: EnemySaveEffect;
  /** What an `effect: "absorb"` save's shield absorbed while it was up
   * (`absorbedDuring`); undefined when the log names no absorb line for it. */
  absorbedAmount?: number;
  /** official mitigation pct (self / immune); undefined for externals and for an immunity-kind save, which has no table row */
  pct?: number;
  /** who received an external */
  recipientName?: string;
  recipientId?: string;
  /** Length of the paired aura interval in seconds; undefined when no
   * interval could be paired. The OBSERVED duration — except with
   * `endNotLogged`, where it is only the interval builder's cap. */
  observedSeconds?: number;
  /** The log has no end for this aura (no REMOVED / BROKEN), and the round
   * did not simply end on it: `observedSeconds` is then the official length
   * the interval builder closed it at, not an observation, and the
   * `[ENEMY DEF]` line prints `end not logged` in its place (user ruling D6,
   * 2026-10-10). On the 605 new-season files 1,302 of 7,541 lines with a
   * duration had no logged end — Vanish 538, Greater Invisibility 320, Mass
   * Invisibility 189 — and 1,129 printed the official maximum
   * (fix-FT/t07-enemydef-vs-raw-605.txt): `Mass Invisibility (immune, 12.0s)`
   * on a mage hit 3.3 s later. Never set with `removedEarly` / `upAtRoundEnd`. */
  endNotLogged?: true;
  /** The paired aura interval of an external, so the `[ENEMY DEF]` line can
   * compute what the attackers did during it (GH #91,
   * `externalDamageForApplication`). Undefined when no interval was paired. */
  auraFromS?: number;
  auraToS?: number;
  auraInferredStart?: boolean;
  auraInferredEnd?: boolean;
  auraSrcName?: string;
  /** observed duration fell short of the caster's full duration by more than the slack */
  removedEarly: boolean;
  /** What the log itself says ended a `removedEarly` aura (FT-T08 step 3):
   * a dispel / steal, its holder's death, an absorb used up. Set only with
   * `removedEarly`; an empty reading means the log gives no cause. */
  earlyEnd?: IAuraEndFromLog;
  /** The aura was still up when the round ended — its REMOVED is logged
   * after it, or the log has none and the round ended inside the aura's
   * official length: shorter than its full duration, but not removed early. */
  upAtRoundEnd?: true;
}

/**
 * The aura intervals on `unit` that the enemy-save predicate reads: the
 * builder's intervals with a re-announced aura joined back into one press
 * (F-E12). The aura's source is looked up among `team` (the unit's own side):
 * a talent-lengthened duration caps an unclosed aura, and the join reads the
 * source's casts. One builder for the `[ENEMY DEF]` events and for the KILL
 * ATTEMPTS attribution's "applied inside the span / up at its start" tests,
 * so the two agree on when a save began and ended.
 */
export function saveAuraIntervals(
  unit: ICombatUnit,
  team: readonly ICombatUnit[],
  combat: { startTime: number; endTime: number },
): ISaveAuraInterval[] {
  const castersById = new Map(team.map((e) => [e.id, e]));
  // The log's own id for each source name on this unit's auras. A name is not
  // a key: one player can be logged under two (138e632d: "Antagonist" in 9
  // lines, "Antagonist-Balnazzar-US" in 20,778), and the unit keeps one.
  const srcIdByName = new Map<string, string>();
  for (const a of unit.auraEvents ?? []) {
    if (a.destUnitId !== unit.id || !a.srcUnitId) continue;
    if (!srcIdByName.has(a.srcUnitName))
      srcIdByName.set(a.srcUnitName, a.srcUnitId);
  }
  const castSecondsOf = (srcUnitName: string, spellId: string): number[] => {
    const srcId = srcIdByName.get(srcUnitName);
    return (
      (srcId !== undefined
        ? castersById.get(srcId)
        : team.find((e) => e.name === srcUnitName)
      )?.spellCastEvents ?? []
    )
      .filter(
        (c) =>
          c.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
          c.spellId === spellId,
      )
      .map((c) => (c.logLine.timestamp - combat.startTime) / 1000);
  };
  return joinReappliedIntervals(
    buildAuraIntervals(unit, combat, castersById),
    castSecondsOf,
  ).map((iv) => {
    const srcUnitId = srcIdByName.get(iv.srcUnitName);
    return srcUnitId === undefined ? iv : { ...iv, srcUnitId };
  });
}

/** An aura interval that also carries its source's unit id (the builder's
 * `IAuraInterval` has the logged name only). */
export type ISaveAuraInterval = IAuraInterval & { srcUnitId?: string };

/**
 * Did `unit` apply this aura? By unit id — the logged name is compared only
 * when the interval carries no id. 138e632d: every aura of the Demon Hunter
 * "Antagonist" is logged from "Antagonist-Balnazzar-US", so compared by name
 * none of his own walls rendered an `[ENEMY DEF]` line while KILL ATTEMPTS
 * (which reads the aura, not the name) said `popped Blur`. On 101 of the 605
 * S2 files 1 of 1,285 player-rounds is logged under two names
 * (fix-KA/nameProbe.ts, 2026-10-01).
 */
export function isIntervalFrom(
  iv: ISaveAuraInterval,
  unit: Pick<ICombatUnit, "id" | "name">,
): boolean {
  return iv.srcUnitId !== undefined
    ? iv.srcUnitId === unit.id
    : iv.srcUnitName === unit.name;
}

/**
 * The aura an external cast put on its recipient: the interval of the cast's
 * aura id (the cast id itself, or the immunity a summon applies —
 * `ENEMY_IMMUNITY_EXTERNAL_CASTS`) that starts within `SAVE_CAST_AURA_PAIR_S`
 * of the cast — from THIS caster (the aura's source id), the nearest one:
 * two Death Knights' Anti-Magic Shells on one ally 0.8 s apart are two
 * presses, not one (codex review, 2026-10-03). The caster test is skipped
 * for an immunity a summon applies (Guardian of the Forgotten Queen's aura
 * comes from the guardian). Undefined for a grip / redirect — the move
 * itself, its aura (Leap of Faith's is ~1 s) is no buff with a duration
 * (rulings A20 + U3) — and for a cast that leaves no aura (Lay on Hands).
 * One pairing for the `[ENEMY DEF]` external line's duration and for KILL
 * ATTEMPTS' "the external was still on the target when the attempt began".
 */
export function externalAuraOf(
  castSpellId: string,
  castAtSeconds: number,
  recipientIntervals: readonly ISaveAuraInterval[],
  casterId?: string,
): ISaveAuraInterval | undefined {
  if (ENEMY_REDIRECT_SAVE_IDS.has(castSpellId)) return undefined;
  const summoned = castSpellId in ENEMY_IMMUNITY_EXTERNAL_CASTS;
  const auraId = ENEMY_IMMUNITY_EXTERNAL_CASTS[castSpellId] ?? castSpellId;
  let best: ISaveAuraInterval | undefined;
  for (const iv of recipientIntervals) {
    if (iv.spellId !== auraId) continue;
    const gap = Math.abs(iv.fromS - castAtSeconds);
    if (gap > SAVE_CAST_AURA_PAIR_S) continue;
    if (
      !summoned &&
      casterId !== undefined &&
      iv.srcUnitId !== undefined &&
      iv.srcUnitId !== casterId
    )
      continue;
    if (!best || gap < Math.abs(best.fromS - castAtSeconds)) best = iv;
  }
  return best;
}

/**
 * Every defensive an enemy unit pressed this round, in cast order — the
 * events the `[ENEMY DEF]` line renders. Self-mitigation and immunities come
 * from the enemy's OWN aura intervals (source = the enemy itself, so a
 * talent-shared copy applied by an ally is not "the target popped a wall");
 * externals from SPELL_CAST_SUCCESS onto another enemy, paired with the
 * recipient's aura interval when one starts within 1.5 s of the cast — plus
 * externals seen only as the recipient's aura (cast event missing from the log).
 */
export function enemyDefensiveEvents(
  enemy: ICombatUnit,
  enemies: ICombatUnit[],
  combat: { startTime: number; endTime: number },
): IEnemyDefensiveEvent[] {
  const out: IEnemyDefensiveEvent[] = [];
  const intervalsByUnit = new Map<string, ISaveAuraInterval[]>();
  const intervalsOf = (u: ICombatUnit) => {
    let iv = intervalsByUnit.get(u.id);
    if (!iv) {
      iv = saveAuraIntervals(u, enemies, combat);
      intervalsByUnit.set(u.id, iv);
    }
    return iv;
  };
  const removedEarly = (spellId: string, observed: number): boolean => {
    const full = buffFullDurationForCaster(spellId, enemy);
    return full !== undefined && observed < full - REMOVED_EARLY_SLACK_S;
  };
  /** `removedEarly` with the cause the log gives for that interval's end —
   * read off the aura's HOLDER (the recipient of an external). */
  const earlyEndOf = (
    holder: ICombatUnit,
    iv: ISaveAuraInterval,
    auraId: string,
  ): Pick<
    IEnemyDefensiveEvent,
    "removedEarly" | "earlyEnd" | "upAtRoundEnd" | "endNotLogged"
  > => {
    const endMs = Math.round(combat.startTime + iv.toS * 1000);
    if (iv.inferredEnd) {
      // The log has no end for this application: the interval builder closed
      // it at its official length, and that number is no observation (ruling
      // D6). One case is not a lost line — the round ended inside the aura's
      // official length, so the aura was simply still up — unless the carrier
      // goes unseen (`SAVE_AURA_END_UNSEEN_IDS`): a Mass Invisibility pressed
      // 10 s before the round's end has no REMOVED either way, and the allied
      // side shows it broken within a second.
      return endMs >= combat.endTime &&
        !SAVE_AURA_END_UNSEEN_IDS.has(iv.spellId)
        ? { removedEarly: false, upAtRoundEnd: true }
        : { removedEarly: false, endNotLogged: true };
    }
    if (!removedEarly(auraId, iv.toS - iv.fromS))
      return { removedEarly: false };
    // The interval builder clamps a REMOVED logged after the round's end onto
    // it (a Shuffle round keeps its trailing lines). Then the aura was still
    // up when the round ended: nothing removed it early, and no line at the
    // clamp can say what did (codex post-hoc review of step 3b).
    // this caster's REMOVED (or one written with no source) — another
    // caster's copy of the spell ending in that ms is not this aura's
    const removedLoggedThere = (holder.auraEvents ?? []).some(
      (a) =>
        a.spellId === iv.spellId &&
        (a.logLine.event as string) === LogEvent.SPELL_AURA_REMOVED &&
        a.logLine.timestamp === endMs &&
        (!iv.srcUnitId ||
          !a.srcUnitId ||
          a.srcUnitId === "0000000000000000" ||
          a.srcUnitId === iv.srcUnitId),
    );
    if (endMs >= combat.endTime && !removedLoggedThere)
      return { removedEarly: false, upAtRoundEnd: true };
    return {
      removedEarly: true,
      earlyEnd: auraEndFromLog(
        holder,
        iv.spellId,
        {
          fromMs: Math.round(combat.startTime + iv.fromS * 1000),
          removedMs: endMs,
        },
        iv.srcUnitId,
      ),
    };
  };
  /** A unit's own SPELL_CAST_SUCCESS seconds of a spell — the press search
   * of an aura kind (`pressSeconds`, F-E11). */
  const castSecondsOf = (srcUnitName: string, spellId: string): number[] =>
    (
      (srcUnitName === enemy.name
        ? enemy
        : enemies.find((e) => e.name === srcUnitName)
      )?.spellCastEvents ?? []
    )
      .filter(
        (c) =>
          c.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
          c.spellId === spellId,
      )
      .map((c) => (c.logLine.timestamp - combat.startTime) / 1000);

  for (const iv of intervalsOf(enemy)) {
    if (!isIntervalFrom(iv, enemy)) continue;
    const immune = isImmunitySaveAura(iv.spellId);
    const tableId = wallTableIdOfAura(iv.spellId);
    if (!immune && !MITIGATION_AURA_IDS.has(tableId)) continue;
    const observed = iv.toS - iv.fromS;
    const saveName = IMMUNITY_SAVE_AURA_NAMES.get(iv.spellId);
    const press = [
      ...castSecondsOf(enemy.name, tableId),
      ...(tableId === iv.spellId ? [] : castSecondsOf(enemy.name, iv.spellId)),
    ]
      // the cast line can also be logged a few ms AFTER its aura (review of
      // F-E11, 2026-10-03: aura 10.000 s, SUCCESS 10.020 s); the nearest
      // candidate is the press
      // in whole log milliseconds: 10.05 - 10 is 0.05000000000000071 in
      // floating point, which rejected a cast exactly 50 ms after its aura
      .filter((t) => {
        const dMs = Math.round(t * 1000) - Math.round(iv.fromS * 1000);
        return (
          dMs <= AURA_BEFORE_CAST_MAX_S * 1000 &&
          -dMs <= PRESS_TO_AURA_MAX_S * 1000
        );
      })
      .reduce(
        (best, t) =>
          Math.abs(t - iv.fromS) < Math.abs(best - iv.fromS) ? t : best,
        Number.POSITIVE_INFINITY,
      );
    out.push({
      atSeconds: iv.fromS,
      ...(Number.isFinite(press) ? { pressSeconds: press } : {}),
      spellId: iv.spellId,
      spellName: saveName ?? getEnglishSpellName(iv.spellId, iv.spellName),
      casterName: enemy.name,
      casterId: enemy.id,
      kind: immune ? "immune" : "self",
      // Priced through the one pricing path (predicate index: "the mitigation
      // % an aura is worth on the unit that carries it"), with the caster's
      // talents — the number burst-into-mitigation's door reads for the same
      // aura. The raw table value printed Barkskin 20 % while the candidate
      // priced it 30 % (GH #114). An immunity-kind save has no table row, so
      // no pct — the line prints `immune` for it.
      pct: wallDoorPct(tableId, { carrierIsCaster: true, caster: enemy }),
      observedSeconds: observed,
      ...earlyEndOf(enemy, iv, iv.spellId),
    });
  }

  // Ruling D8 (2026-10-10): the saves named by their effect. Feign Death's
  // shield lasts its aura and says what it absorbed; a proc is a moment — the
  // aura it leaves (Cauterize's 6 s burn, Cheating Death's 3 s) is not how
  // long anything protected the unit, so no duration is printed for it.
  for (const s of effectSaves(enemy, intervalsOf(enemy), combat.startTime)) {
    const shield = s.effect === "absorb" ? s.interval : undefined;
    const absorbed = shield
      ? absorbedDuring(enemy, shield, combat.startTime)
      : undefined;
    out.push({
      atSeconds: s.atSeconds,
      spellId: s.spellId,
      spellName: s.spellName,
      casterName: enemy.name,
      casterId: enemy.id,
      kind: "self-save",
      effect: s.effect,
      ...(shield
        ? {
            observedSeconds: shield.toS - shield.fromS,
            ...(absorbed !== undefined ? { absorbedAmount: absorbed } : {}),
            ...earlyEndOf(enemy, shield, shield.spellId),
          }
        : { removedEarly: false }),
    });
  }

  for (const cast of enemy.spellCastEvents ?? []) {
    if (cast.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
    if (!cast.spellId || !isExternalSaveId(cast.spellId)) continue;
    const atSeconds = (cast.logLine.timestamp - combat.startTime) / 1000;
    // F-E1b / F-A1b (ruling A15): an area save is anchored on the cast — its
    // aura names no source (Anti-Magic Zone), is never applied (Darkness) or
    // lands on the whole team (Rallying Cry).
    if (ENEMY_AREA_SAVE_IDS.has(cast.spellId)) {
      out.push({
        atSeconds,
        spellId: cast.spellId,
        spellName: getEnglishSpellName(cast.spellId, cast.spellName),
        casterName: enemy.name,
        casterId: enemy.id,
        kind: "area",
        removedEarly: false,
      });
      continue;
    }
    // F-E6: an immunity the caster's summon applies (Guardian of the
    // Forgotten Queen: cast 228049, aura 228050 from the guardian). Cast on
    // an ally it is an external timed by that aura; cast on oneself the aura
    // loop above cannot see it (its source is the guardian), so it is emitted
    // here as the caster's own immunity.
    const immunityAuraId = ENEMY_IMMUNITY_EXTERNAL_CASTS[cast.spellId];
    if (immunityAuraId !== undefined && cast.destUnitId === enemy.id) {
      const own = intervalsOf(enemy).find(
        (iv) =>
          iv.spellId === immunityAuraId &&
          !isIntervalFrom(iv, enemy) &&
          Math.abs(iv.fromS - atSeconds) <= SAVE_CAST_AURA_PAIR_S,
      );
      if (own) {
        const observed = own.toS - own.fromS;
        out.push({
          atSeconds,
          spellId: cast.spellId,
          spellName: getEnglishSpellName(cast.spellId, cast.spellName),
          casterName: enemy.name,
          casterId: enemy.id,
          kind: "immune",
          observedSeconds: observed,
          ...earlyEndOf(enemy, own, immunityAuraId),
        });
      }
      continue;
    }
    const recipient = enemies.find(
      (e) => e.id === cast.destUnitId && e.id !== enemy.id,
    );
    if (!recipient) continue;
    // A grip / redirect is the move itself: no duration to report or to call
    // "removed early", and nothing was "done during it" (`externalAuraOf`).
    const pairedAuraId = immunityAuraId ?? cast.spellId;
    const paired = externalAuraOf(
      cast.spellId,
      atSeconds,
      intervalsOf(recipient),
      enemy.id,
    );
    const observed = paired ? paired.toS - paired.fromS : undefined;
    out.push({
      atSeconds,
      spellId: cast.spellId,
      spellName: getEnglishSpellName(cast.spellId, cast.spellName),
      casterName: enemy.name,
      casterId: enemy.id,
      kind: "external",
      recipientId: recipient.id,
      recipientName: recipient.name,
      observedSeconds: observed,
      // The during-it measurement is defined for mitigation externals; an
      // immunity put on an ally reports its duration only.
      ...(paired && immunityAuraId === undefined
        ? {
            auraFromS: paired.fromS,
            auraToS: paired.toS,
            auraInferredStart: paired.inferredStart,
            auraInferredEnd: paired.inferredEnd,
            auraSrcName: paired.srcUnitName,
          }
        : {}),
      ...(paired
        ? earlyEndOf(recipient, paired, pairedAuraId)
        : { removedEarly: false }),
    });
  }

  // B4a (2026-09-25): the caster's own no-%-mitigation saves.
  for (const c of selfSaveCasts(enemy, combat.startTime)) {
    out.push({
      atSeconds: c.atSeconds,
      spellId: c.spellId,
      spellName: c.spellName,
      casterName: enemy.name,
      casterId: enemy.id,
      kind: "self-save",
      removedEarly: false,
    });
  }

  // Aura-only externals (GH #103 class F, match 44f529e3): the log can carry the
  // recipient's SPELL_AURA_APPLIED without the caster's SPELL_CAST_SUCCESS
  // (Ironbark on an ally at 0:09, cast event absent — the caster was outside
  // the recorder's logging range). KILL ATTEMPTS reads the aura and said
  // "popped Ironbark" while no [ENEMY DEF] line existed for it. The aura is
  // the evidence both sides can see, so an external interval this enemy
  // applied to an ally with no cast already paired to it becomes an event too.
  // Intervals whose start was inferred (up before the log saw it) are skipped
  // — KILL ATTEMPTS only counts SPELL_AURA_APPLIED, and so does this.
  for (const mate of enemies) {
    if (mate.id === enemy.id) continue;
    for (const iv of intervalsOf(mate)) {
      if (!isIntervalFrom(iv, enemy)) continue;
      // The friendly roster plus the enemy-only ally saves (Anti-Magic Shell
      // 410358 on an ally): the same aura evidence, the same missing cast.
      if (
        !(
          EXTERNAL_DEF_IDS.has(iv.spellId) ||
          ENEMY_ALLY_SAVE_IDS.has(iv.spellId)
        ) ||
        iv.inferredStart
      )
        continue;
      const paired = out.some(
        (d) =>
          d.kind === "external" &&
          d.recipientId === mate.id &&
          d.spellId === iv.spellId &&
          Math.abs((d.auraFromS ?? d.atSeconds) - iv.fromS) <=
            SAVE_CAST_AURA_PAIR_S,
      );
      if (paired) continue;
      const observed = iv.toS - iv.fromS;
      out.push({
        atSeconds: iv.fromS,
        spellId: iv.spellId,
        spellName: getEnglishSpellName(iv.spellId, iv.spellName),
        casterName: enemy.name,
        casterId: enemy.id,
        kind: "external",
        recipientId: mate.id,
        recipientName: mate.name,
        observedSeconds: observed,
        auraFromS: iv.fromS,
        auraToS: iv.toS,
        auraInferredStart: iv.inferredStart,
        auraInferredEnd: iv.inferredEnd,
        auraSrcName: iv.srcUnitName,
        ...earlyEndOf(mate, iv, iv.spellId),
      });
    }
  }

  return out.sort((a, b) => a.atSeconds - b.atSeconds);
}

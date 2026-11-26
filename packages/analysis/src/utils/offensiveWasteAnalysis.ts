import {
  AtomicArenaCombat,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import { damageImmuneControlUpAt } from "../analysis/candidates/massDispel";
import { castAndEffectIds, castKeyOfAura } from "../data/castEffectAuras";
import {
  KILL_LIVE_HP_PCT,
  type MitigationVerdict,
  mitigationVerdictOf,
  nonMeleeMitigationVerdictOf,
} from "../data/mitigationVerdicts";
import { SPELL_CATEGORIES } from "../data/spellCategories";
import { getEnglishSpellName } from "../data/spellEffectData";
import { ENEMY_IMMUNITY_HOLDS_ITS_AURA_IDS } from "../data/spellIdLists";
import { parryStopsAttack } from "../data/spellParry";
import { immunityCoversSpell, immunityMechanics } from "../data/spellSchools";
import { isAllyCopyWallId } from "./allyCopyWall";
import { buildAuraIntervals } from "./auraIntervals";
import { isHardCcAura } from "./cannotCastIntervals";
import { empowerSpans, type EmpowerSpanUnit } from "./castCommitSpans";
import { isControlCast, PRESS_LANDED_SAME_INSTANT_MS } from "./castMissRows";
import {
  COMPANION_CAST_ROW_MS,
  isNoPressRow,
  isPressImpactRow,
  pressImpactRow,
} from "./castPress";
import { ccFullDurationForCaster } from "./ccDuration";
import {
  applicableCCAvoidanceIds,
  avoidanceBuffCoversCc,
  avoidanceExplainsMissType,
  CC_AVOIDANCE_BUFF_SPELLS,
  ccAvoidanceBuffsUpAt,
} from "./ccTrinketAnalysis";
import { auraBlocksInterrupt } from "./combatStates";
import {
  hpTroughInEventSpan,
  PRESS_EFFECT_LEAD_MS,
  specToString,
} from "./cooldowns";
import { spellNameKey } from "./damagePress";
import {
  drWallMissesSpellSchool,
  immunityLastsItsAura,
  immunityStopsDamageSpell,
  immunityStopsSpellSchool,
  wallStopsEveryHit,
} from "./enemyDefensives";
import { isDamageSentRow, isDeferralAbsorb } from "./incomingPressure";
import { isAutomaticCastRow } from "./pressRow";
import { fmtTime } from "./renderGrid";
import { roundEndMs } from "./roundEnd";
import { ccMechanicOf } from "./spellMechanics";
import { unitAuraBlocksInterrupt } from "./talentBehaviors";

/**
 * 2026-08-17:两张手打名单(IMMUNITY_AURAS 4 条 / MAJOR_DR_AURAS 5 条)已删除,
 * 改为消费签字裁定册 `data/mitigationVerdicts.ts`。审计查出那两张表既错又缺:
 * 消散(75%)被当成免疫;7 个真免疫里漏掉 4 个(保护祝福/破咒祝福/暗影斗篷/
 * 虚空行走),砸进去一声不吭;而「大减伤」5 条里有 3 条只有 20%(树皮术/圣佑术/
 * 铁木树皮),80% 的伤害照样打进去了却被判「浪费」。
 */

/** How many counted casts into a defensive make a line, by its verdict. */
const WASTE_MIN_CASTS: Record<IDefenseWindow["verdict"], number> = {
  unconditional: 2,
  "kill-live-gated": 3,
};
/** A spell is "high value" for a player when it made at least this share of
 * their damage this round. */
const HIGH_VALUE_DAMAGE_SHARE = 0.05;
/** A hold's own SPELL_CAST_SUCCESS sits this close to its EMPOWER_START —
 * `pressBehindDamageOf`'s hold-start test. */
export const EMPOWER_HOLD_ROW_MS = 500;

interface IOffensiveWasteCast {
  spellId: string;
  spellName: string;
  atSeconds: number;
}

/** The mark a deferral shield's line carries (fact10 D26, user 2026-11-04:
 * Time Dilation holds part of each hit back and the target takes it later —
 * no reduction; it is still counted as the 07-30 ruling's wall). The gates
 * that read the defense name off the line strip it (`withoutDeferralTag`). */
export const INTO_DEFERRAL_TAG = " (deferral)";

/** A line's defense name without `INTO_DEFERRAL_TAG`. */
export function withoutDeferralTag(name: string): string {
  return name.endsWith(INTO_DEFERRAL_TAG)
    ? name.slice(0, -INTO_DEFERRAL_TAG.length)
    : name;
}

interface IOffensiveWasteEvent {
  casterName: string;
  casterSpec: string;
  targetName: string;
  targetSpec: string;
  /** 该减伤在裁定册里的类别 —— 决定这条是不是无条件出面。 */
  verdict: Extract<MitigationVerdict, "unconditional" | "kill-live-gated">;
  defenseName: string;
  /** a deferral shield (`isDeferralAbsorb`): no reduction */
  deferral?: true;
  defenseWindowSeconds: [number, number];
  wasteCasts: IOffensiveWasteCast[];
}

interface IOffensiveWasteSummary {
  events: IOffensiveWasteEvent[];
}

interface IDefenseWindow {
  spellId: string;
  defenseName: string;
  verdict: Extract<MitigationVerdict, "unconditional" | "kill-live-gated">;
  /** the verdict for a non-melee attack into it (Die by the Sword: a parry
   * wall, only its 30 % against spells — user 2026-10-26) */
  nonMeleeVerdict: MitigationVerdict;
  fromSeconds: number;
  toSeconds: number;
  /** the log line of the APPLIED row that opened it, when one did: a row of
   * that millisecond logged before it landed before the wall was up
   * (`landedBeforeWallRow`) */
  fromLine?: number;
  /** the row that closed it (`IAuraInterval.toRow`): a landing logged below
   * it in its millisecond came after the wall (`landedAfterWallRow`) */
  toRow?: { ms: number; lineIndex: number };
  unitId: string;
  unitName: string;
  unitSpec: string;
  /** 用于击杀成立判定的血量采样;不参与其他逻辑。 */
  unit: ICombatUnit;
}

export interface IOffensiveWasteTraceRow {
  casterId: string;
  window: Pick<
    IDefenseWindow,
    | "spellId"
    | "defenseName"
    | "verdict"
    | "fromSeconds"
    | "toSeconds"
    | "unitId"
  >;
  /** the casts the section counts into this reading of the wall */
  wasteCasts: IOffensiveWasteCast[];
  /** the door: how many casts make a line */
  threshold: number;
  /** a kill-live-gated wall whose target was read low: no line */
  killLive: boolean;
  listed: boolean;
}

/**
 * The signed walls on each enemy, as intervals of the shared builder
 * (`buildAuraIntervals` — F15 / fact1215 R8, 2026-10-17). The hand pairing
 * of APPLIED → REMOVED it replaces split one aura at a re-broadcast (a same-ms
 * REMOVED + APPLIED, 09195b87 1:30: one Time Dilation 1:25 → 1:33 read as two
 * walls, and the 1:30 half passed the ≤ 20 % HP rule the whole one did not).
 * As before, only an aura the log shows open and close counts: an interval
 * whose start or end the builder inferred is left out.
 */
function buildDefenseWindows(
  enemies: ICombatUnit[],
  combat: Pick<AtomicArenaCombat, "startTime" | "endTime"> &
    Partial<Pick<AtomicArenaCombat, "units">>,
): IDefenseWindow[] {
  const windows: IDefenseWindow[] = [];
  for (const enemy of enemies) {
    // the log's source id for each source name on this unit — a player can
    // be logged under two names (138e632d; codex 20-F15-08), the id is one
    // (`saveAuraIntervals`' mapping)
    const srcIdByName = new Map<string, string>();
    for (const a of enemy.auraEvents ?? [])
      if (
        a.destUnitId === enemy.id &&
        a.srcUnitId &&
        !srcIdByName.has(a.srcUnitName)
      )
        srcIdByName.set(a.srcUnitName, a.srcUnitId);
    const isOwn = (srcUnitName: string) =>
      (srcIdByName.get(srcUnitName) ?? null) === enemy.id ||
      srcUnitName === enemy.name;
    for (const iv of buildAuraIntervals(enemy, combat)) {
      // the verdict table is keyed by the cast; the wall runs under its own
      // aura id (fact2 C10: Fortifying Brew 120954, Greater Invisibility
      // 110960 never opened a window)
      const verdictKey =
        castKeyOfAura(iv.spellId, (id) => mitigationVerdictOf(id) !== null) ??
        iv.spellId;
      const verdict = mitigationVerdictOf(verdictKey);
      // "never"(不构成真实阻碍)与 "unresolved"(裁定人未遇到过)都不出面。
      if (verdict !== "unconditional" && verdict !== "kill-live-gated")
        continue;
      if (iv.inferredStart || iv.inferredEnd) continue;
      // F15 C1(2026-10-16 默认):签字表签的是施法者自己身上的那份;天赋共享墙
      // 给队友的副本(Flameshaper 黑曜鳞片 15%)低于墙门槛,不是这堵墙。
      if (isAllyCopyWallId(iv.spellId) && !isOwn(iv.srcUnitName)) continue;
      windows.push({
        spellId: iv.spellId,
        // 英文名 —— prompt 侧禁止中文技能名(spellNameZhLint)。
        defenseName: getEnglishSpellName(iv.spellId, iv.spellId),
        verdict,
        nonMeleeVerdict: nonMeleeMitigationVerdictOf(verdictKey) ?? verdict,
        fromSeconds: iv.fromS,
        toSeconds: iv.toS,
        ...(() => {
          const openMs = Math.round(combat.startTime + iv.fromS * 1000);
          const row = (enemy.auraEvents ?? []).find(
            (a) =>
              a.spellId === iv.spellId &&
              a.destUnitId === enemy.id &&
              // the interval's own source: two units can put the same wall
              // on one target in one millisecond
              (iv.srcUnitId === undefined || a.srcUnitId === iv.srcUnitId) &&
              a.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
              a.logLine.timestamp === openMs,
          );
          const line = row?.logLine.lineIndex;
          return line === undefined ? {} : { fromLine: line };
        })(),
        ...(iv.toRow ? { toRow: iv.toRow } : {}),
        unitId: enemy.id,
        unitName: enemy.name,
        unitSpec: specToString(enemy.spec),
        unit: enemy,
      });
    }
  }
  return windows;
}

/**
 * The spells that each made at least 5 % of the unit's damage this round.
 *
 * `damageOut`'s `effectiveAmount` is NEGATIVE for a hit and POSITIVE for the
 * absorbed-part rows interleaved with them (parser-compat convert.ts), so the
 * hits are summed as magnitudes and the absorbed rows — keyed by the shield's
 * id, not by a spell of this unit — are left out. Until FT-T02a (2026-10-09) they were
 * summed signed: the threshold came out negative and `v >= threshold` kept
 * exactly the spells BELOW a 5 % share — 82a2d681's Arms Warrior into Astral
 * Shift was listed as "Rend + Charge + Hamstring" while three Mortal Strikes
 * were dropped.
 *
 * The share is of what the player dealt to the other side (fact7 D53,
 * 7e7b1e51 0:43: a mage's self-inflicted rows in the denominator left Fire
 * Blast out): rows on the player's own team are left out, an ally's Tempered
 * in Battle with them, and a hit a shield ate counts under its own attack
 * spell (`attackSpellId`; none = a swing), a deferral shield's row under
 * nothing.
 *
 * Keyed by the spell, not the row's id (`spellNameKey`): the log writes many
 * a spell's damage under another id than its cast, and the casts below are
 * matched by the same key (fact5 D7 / D8: Execute's cast 281000 lands as
 * 260798 — 17 % of an Arms Warrior's damage, never counted into Barkskin or
 * Divine Protection).
 */
export function getHighValueSpellIds(
  unit: Pick<ICombatUnit, "damageOut">,
  /** the player's team, itself included */
  ownTeamIds: ReadonlySet<string> = new Set(),
): Set<string> {
  const totals: Record<string, number> = {};
  let grandTotal = 0;
  type AbsorbedRow = { attackSpellId?: string; attackSpellName?: string };
  // a stored document from before the attack spell was recorded cannot name
  // an absorbed hit's spell at all (`documentRecordsAttackSpell`'s reading)
  const recordsAttackSpell = unit.damageOut.some(
    (d) => (d as AbsorbedRow).attackSpellId !== undefined,
  );

  for (const dmg of unit.damageOut) {
    if (ownTeamIds.has(dmg.destUnitId) || !isDamageSentRow(dmg)) continue;
    // An absorbed hit is a row of its own in damageOut, keyed by the SHIELD's
    // spell id (convert.ts) — not a spell of this unit.
    const absorbed = (dmg.logLine?.event as string) === LogEvent.SPELL_ABSORBED;
    if (absorbed && !recordsAttackSpell) continue;
    const hit = absorbed
      ? {
          spellId: (dmg as AbsorbedRow).attackSpellId,
          spellName: (dmg as AbsorbedRow).attackSpellName,
        }
      : dmg;
    const id = hit.spellId
      ? spellNameKey(hit.spellId, hit.spellName ?? "")
      : "melee";
    const amount = Math.abs(dmg.effectiveAmount ?? 0);
    totals[id] = (totals[id] ?? 0) + amount;
    grandTotal += amount;
  }

  if (grandTotal === 0) return new Set(Object.keys(totals));
  const threshold = grandTotal * HIGH_VALUE_DAMAGE_SHARE;
  return new Set(
    Object.entries(totals)
      .filter(([, v]) => v >= threshold)
      .map(([k]) => k),
  );
}

/**
 * 这波击杀成立吗 —— 窗口期间目标是否被打到 `KILL_LIVE_HP_PCT` 以下。
 *
 * 判据方向刻意偏向「不指责」:窗口内**任一刻**低于线就算成立,于是「顶着减伤
 * 继续打」被认定为正确操作、不产出浪费。审计结论是本系统整体过度指责
 * (docs/coaching-grounding-audit.md),这个方向是有意选的。
 *
 * 读的是光环在身期间的真实最低值(`hpTroughInEventSpan`)。
 */
function killWasLive(
  w: IDefenseWindow,
  matchStartMs: number,
  roundEndAtMs: number,
): boolean {
  // fact8 D31: the span's true minimum (`hpTroughInEventSpan`), the reading
  // every other "lowest while up" number takes — the legend says "never read
  // 20 % HP or lower while it was up", and a druid at 16 % between two
  // whole-second samples kept its Barkskin row (980d8143 r0 2:34.6). Read
  // inside the round (`roundEndMs`, fact10 D30 follow-up, GH #191): the hits
  // after a Solo Shuffle round's ending death are in no round.
  const low = hpTroughInEventSpan(
    w.unit,
    matchStartMs,
    w.fromSeconds,
    Math.min(w.toSeconds, (roundEndAtMs - matchStartMs) / 1000),
  );
  return low !== null && low.pct <= KILL_LIVE_HP_PCT;
}

export function buildOffensiveWasteSummary(
  combat: Pick<AtomicArenaCombat, "startTime" | "endTime"> &
    Partial<Pick<AtomicArenaCombat, "units">>,
  friends: ICombatUnit[],
  enemies: ICombatUnit[],
  /** every (player, wall reading) the section weighed, a line or not — for
   * a verification scan to read the section's own selection instead of
   * counting casts a second way (pipeline T206) */
  trace?: (row: IOffensiveWasteTraceRow) => void,
): IOffensiveWasteSummary {
  const matchStartMs = combat.startTime;
  const defenseWindows = buildDefenseWindows(enemies, combat);
  const events: IOffensiveWasteEvent[] = [];
  const ownTeamIds = new Set(friends.map((f) => f.id));
  // the round's casts only (`roundEndMs`: a Solo Shuffle round is over at its
  // ending death — codex 60-POSTHOC-09h #1: a cast in the log's tail opened
  // an ABILITIES INTO IMMUNITY row)
  const roundEndAt = roundEndMs({
    ...combat,
    units: combat.units ?? {},
  } as never);

  const allUnits = Object.values(combat.units ?? {}) as ICombatUnit[];

  for (const friend of friends) {
    const highValueIds = getHighValueSpellIds(friend, ownTeamIds);
    const successRows = friend.spellCastEvents.filter(
      (e) =>
        e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
        e.logLine.timestamp < roundEndAt,
    );
    // presses only: a copy / companion row is no press of its own, and one
    // press the log writes under two ids of the spell in one instant (Flame
    // Shock 470411 + 188389) is one cast — matched by the spell, both rows
    // would count (fact5 D7 follow-up)
    // An empowered spell's SPELL_CAST_SUCCESS is written when the hold
    // BEGINS; the spell goes off at the release (`empowerSpans`, the rule
    // `pressBehindDamageOf` reads). A hold never released fired nothing
    // (codex 20-F18-01 #2, d15afa55 r0 2:16: an Eternity Surge held from
    // 136.11 s into an Astral Shift that ran out at 136.54 s).
    const holds = empowerSpans(friend as EmpowerSpanUnit) ?? [];
    const firedAtMs = new Map<object, number | null>();
    for (const e of successRows) {
      const hold = holds.find(
        (h) =>
          spellNameKey(h.spellId, h.spellName) ===
            spellNameKey(e.spellId, e.spellName) &&
          Math.abs(h.startMs - e.logLine.timestamp) <= EMPOWER_HOLD_ROW_MS,
      );
      if (hold) firedAtMs.set(e, hold.interrupted ? null : hold.endMs);
      // a hold the log shows begin and never shows released went off at no
      // instant the log has (codex 20-F18-03 #1): not a cast into anything
      else if (
        ((friend as EmpowerSpanUnit).empowerStarts ?? []).some(
          (st) =>
            spellNameKey(st.spellId, st.spellName) ===
              spellNameKey(e.spellId, e.spellName) &&
            Math.abs(st.timestamp - e.logLine.timestamp) <= EMPOWER_HOLD_ROW_MS,
        )
      )
        firedAtMs.set(e, null);
    }
    const castAtMs = (e: (typeof successRows)[number]): number | null =>
      firedAtMs.has(e) ? firedAtMs.get(e)! : e.logLine.timestamp;
    // a charge press and its impact row are one cast, counted where it hit
    // — the impact (fact10 D28: 915f90ae 2:48 `The Hunt ×2`; 6a545d58 0:52:
    // Predator's Wake 1259431 does no damage itself, its impact 1246169
    // landed inside the Obsidian Scales)
    const castEvents = successRows.filter(
      (e, i) =>
        castAtMs(e) !== null &&
        (!isNoPressRow(e, successRows) || isPressImpactRow(e, successRows)) &&
        // an auto-attack swing or a passive proc is no cast of the player's
        // (pipeline T12, 1d26a991 0:53: two Crusading Strikes swings read
        // as casts into Time Dilation)
        !isAutomaticCastRow(e) &&
        pressImpactRow(e, successRows) === undefined &&
        !successRows.some(
          (o, j) =>
            j < i &&
            o.destUnitId === e.destUnitId &&
            o.spellId !== e.spellId &&
            Math.abs(o.logLine.timestamp - e.logLine.timestamp) <=
              COMPANION_CAST_ROW_MS &&
            !isNoPressRow(o, successRows) &&
            // a press counted at its impact is no companion of that impact
            // (codex 20-F25-03 #3: 6a545d58 r4 The Hunt 1246167 → 1246169
            // 1 ms apart dropped both)
            pressImpactRow(o, successRows) === undefined &&
            spellNameKey(o.spellId, o.spellName) ===
              spellNameKey(e.spellId, e.spellName),
        ),
    );

    // the section counts what LANDED inside the defensive, and a travelling
    // spell lands after its press (fact7 D52, 7e7b1e51 0:41)
    const landings = pressLandingRows(
      castEvents,
      (e) => castAtMs(e)!,
      pressLandingCaster(friend, Object.values(combat.units ?? {})),
      enemies,
    );

    for (const whole of defenseWindows) {
      // a wall whose verdict for spells differs (Die by the Sword's parry):
      // what a parry can stop and the rest are two readings of it
      const parts: Array<{
        window: IDefenseWindow;
        takes: (spellId: string, landingSpellId: string | null) => boolean;
      }> =
        whole.nonMeleeVerdict === whole.verdict
          ? [{ window: whole, takes: () => true }]
          : [
              { window: whole, takes: parryStopsAttack },
              ...(whole.nonMeleeVerdict === "unconditional" ||
              whole.nonMeleeVerdict === "kill-live-gated"
                ? [
                    {
                      window: { ...whole, verdict: whole.nonMeleeVerdict },
                      takes: (id: string, row: string | null) =>
                        !parryStopsAttack(id, row),
                    },
                  ]
                : []),
            ];
      for (const { window, takes } of parts) {
        const threshold = WASTE_MIN_CASTS[window.verdict];

        const wasteCasts: IOffensiveWasteCast[] = castEvents
          .filter((e) => {
            if (e.destUnitId !== window.unitId) return false;
            if (e.spellId && !takes(e.spellId, landings.get(e)!.spellId))
              return false;
            const t = (landings.get(e)!.atMs - matchStartMs) / 1000;
            if (t < window.fromSeconds || t > window.toSeconds) return false;
            if (e.spellId === null) return false;
            // round-1 retest (fact1215 idx 107): a cast the target REFLECTED
            // went back at its caster — it did not land inside the window
            // (c3398b15 0:55: a Mortal Coil reflected by Spell Reflection was
            // listed "into" Die by the Sword)
            if (reflectedBack(friend, e.spellId, window.unitId, castAtMs(e)!))
              return false;
            // round-1 retest idx 43 / 13: a school-limited immunity does not
            // stop the schools it does not cover — a Chaos Bolt into Blessing
            // of Protection, a Sinister Strike into Spellwarding LANDED (the
            // prompt's own legend says so). The official school masks decide
            // (`immunityStopsSpellSchool`); a wall with no immunity mask (Die by the
            // Sword, signed unconditional — ruling C3) keeps its verdict.
            // fact11 D20: a school-limited immunity with no DB2 mask (Cloak
            // of Shadows) reads its hand mask (`immunityStopsSpellSchool`)
            const covers = immunityStopsSpellSchool(window.spellId, e.spellId);
            if (covers === false) return false;
            // pipeline T124: a school-limited damage-reduction wall reduces
            // only its schools — a Mortal Strike into Anti-Magic Zone
            // (magic only) landed at full value
            if (drWallMissesSpellSchool(window.spellId, e.spellId))
              return false;
            if (landedThroughWall(window.spellId, landings.get(e)!))
              return false;
            // pipeline T281: a row logged before the wall's own APPLIED row
            // in one millisecond landed on an unwalled target; an IMMUNE
            // under a damage-reduction wall is another aura's refusal
            if (
              landedBeforeWallRow(
                landings.get(e)!,
                Math.round(matchStartMs + window.fromSeconds * 1000),
                window.fromLine,
              ) ||
              landedAfterWallRow(landings.get(e)!, window.toRow)
            )
              return false;
            {
              const landing = landings.get(e)!;
              if (
                landing.immune &&
                refusedByAnotherAura(
                  window.spellId,
                  landing.spellId ?? e.spellId,
                  landing,
                  aurasRefusingSpellAt(
                    window.unit,
                    allUnits,
                    landing.spellId ?? e.spellId,
                    landing.atMs,
                    landing.lineIndex,
                  ),
                  damageImmuneControlUpAt(
                    window.unit,
                    landing.atMs,
                    (id, src) =>
                      ccFullDurationForCaster(
                        id,
                        friends.find((f) => f.id === src),
                      ),
                    landing.lineIndex,
                  ) !== undefined,
                  window.unit,
                )
              )
                return false;
            }
            // B28: for immunity windows, also count high-value CC/utility spells that do no damage
            // (e.g. Mindgames, HoJ, Silence) which would otherwise be filtered by the damage threshold.
            // Round-1 retest idx 44: only into an immunity that covers it — a
            // Mortal Coil into Die by the Sword (no control immunity) landed.
            // codex 20-F16-09 #4: an immunity with no school mask (Aspect of
            // the Turtle) stops the controls the avoidance table says it does
            // (`applicableCCAvoidanceIds`) — unknown is no "does not cover"
            const isHighValueCC =
              window.verdict === "unconditional" &&
              isControlCast(e.spellId) &&
              (covers === true ||
                (covers === undefined &&
                  applicableCCAvoidanceIds(
                    e.spellId,
                    getEnglishSpellName(e.spellId, e.spellName),
                  ).has(window.spellId)));
            return (
              isHighValueCC ||
              highValueIds.size === 0 ||
              highValueIds.has(spellNameKey(e.spellId, e.spellName))
            );
          })
          .map((e) => ({
            spellId: e.spellId ?? "",
            spellName: e.spellName ?? "",
            atSeconds: (landings.get(e)!.atMs - matchStartMs) / 1000,
          }));

        if (wasteCasts.length < threshold) {
          trace?.({
            casterId: friend.id,
            window,
            wasteCasts,
            threshold,
            killLive: false,
            listed: false,
          });
          continue;
        }
        // 击杀成立时顶着减伤打是正确操作 —— 只有不成立时才算该转火。
        // 无条件类不看这个:打不进去就是打不进去。
        const killLive =
          window.verdict === "kill-live-gated" &&
          killWasLive(window, matchStartMs, roundEndAt);
        trace?.({
          casterId: friend.id,
          window,
          wasteCasts,
          threshold,
          killLive,
          listed: !killLive,
        });
        if (killLive) {
          continue;
        }
        {
          events.push({
            casterName: friend.name,
            casterSpec: specToString(friend.spec),
            targetName: window.unitName,
            targetSpec: window.unitSpec,
            verdict: window.verdict,
            defenseName: window.defenseName,
            ...(isDeferralAbsorb({ spellId: window.spellId })
              ? { deferral: true as const }
              : {}),
            defenseWindowSeconds: [window.fromSeconds, window.toSeconds],
            wasteCasts,
          });
        }
      }
    }
  }

  return { events };
}

/** The cast's own REFLECT miss on `targetId` (its id or an effect aura of
 * it, logged up to `REFLECT_ROW_LAG_MS` after the press). */
export const REFLECT_ROW_LAG_MS = 1500;

/** The caster's rows `pressLandingsMs` reads. */
type LandingCaster = Pick<ICombatUnit, "id" | "damageOut"> &
  Partial<Pick<ICombatUnit, "missesOut">>;

/** One press of a spell, as `pressLandingsMs` needs it. */
type LandingPress = {
  spellId: string | null;
  spellName: string | null;
  destUnitId: string;
  /** the press's own row: a press with no row of its own on the target
   * lands at it, in log order (`landedAfterWallRow`) */
  logLine?: { lineIndex?: number; timestamp?: number };
};

/**
 * When each press landed: its own row on the target — a direct hit, a miss
 * (immune, absorbed whole, parried, …) or the caster's aura of the spell going
 * on — else the press itself: a spell that writes no row of its own landed at
 * no instant the log has (fact7 D52).
 *
 * The log ties no row to a cast, so presses take rows in order, per target and
 * spell (`spellNameKey`): each takes the first row not yet taken from
 * `PRESS_EFFECT_LEAD_MS` before it to `REFLECT_ROW_LAG_MS` after it. One row
 * per press, and two presses of one instant are two presses (7e7b1e51: two
 * SUCCESS at 44.286, two hits at 44.882). A channel's later ticks are nobody's:
 * the next press starts past them. Left out, so one hit is one row: periodic
 * ticks, an eaten one's SPELL_PERIODIC_MISSED with them, and SPELL_ABSORBED (a
 * hit eaten whole also writes its SPELL_MISSED, and a part-absorbed one its
 * damage row).
 */
export function pressLandingsMs<T extends LandingPress>(
  presses: readonly T[],
  atMsOf: (press: T) => number,
  caster: LandingCaster,
  targets: readonly Pick<ICombatUnit, "id" | "auraEvents">[],
): Map<T, number> {
  const landed = new Map<T, number>();
  for (const [press, row] of pressLandingRows(presses, atMsOf, caster, targets))
    landed.set(press, row.atMs);
  return landed;
}

/** The caster as `pressLandingRows` reads it, with its pets' misses: a pet's
 * hits are merged into its owner's `damageOut`, its misses are not, and a
 * press can land as the pet's row alone (Kill Command 34026, the pet's 83381,
 * parried or not). A guardian's same-named spell is no landing of the press:
 * a Dryad's Starsurge 1264677, Whitemane's Death Coil, an Arcane Phoenix's
 * Pyroblast. */
export function pressLandingCaster(
  caster: LandingCaster,
  units: readonly Pick<ICombatUnit, "id" | "ownerId" | "missesOut">[],
): LandingCaster {
  const petMisses = units
    .filter((u) => u.ownerId === caster.id && u.id.startsWith("Pet-"))
    .flatMap((u) => u.missesOut ?? []);
  return petMisses.length === 0
    ? caster
    : {
        ...caster,
        missesOut: [...(caster.missesOut ?? []), ...petMisses],
      };
}

/** Where a press landed: `spellId` is the spell of its hit or miss row,
 * null when it landed as an aura or wrote no row (an aura is no attack:
 * Colossus Smash's debuff is not the strike); `hit` is true when that row is
 * a damage row or a miss of type ABSORB (a hit a shield ate whole) — the
 * attack got through whatever wall the target had up. */
export interface IPressLanding {
  atMs: number;
  spellId: string | null;
  hit: boolean;
  /** the landing row's line in the log, when the row carries one */
  lineIndex?: number;
  /** the press was refused outright: its landing row is an IMMUNE and no
   * hit of the press is logged on that unit in that row's instant
   * (`PRESS_LANDED_SAME_INSTANT_MS` — Rake's stun 163505 IMMUNE and its
   * damage 16 ms later are one press that landed) */
  immune?: true;
}

/**
 * Pipeline T281 (audit-1215 10 D1, 50b433c2 r5 2:31): did this press land
 * BEFORE the wall went up — its landing row in the wall's opening
 * millisecond, logged before the wall's APPLIED row? A Wrath's damage row and
 * Ironbark's APPLIED shared 20:10:57.795 with the Wrath first: it hit an
 * unwalled target and read `Wrath + Starsurge into Ironbark`. The log's own
 * order decides inside one millisecond; a row or a wall with no line number
 * keeps the instant's reading.
 */
export function landedBeforeWallRow(
  landing: Pick<IPressLanding, "atMs" | "lineIndex">,
  wallOpenMs: number,
  wallOpenLine: number | undefined,
): boolean {
  return (
    wallOpenLine !== undefined &&
    landing.lineIndex !== undefined &&
    landing.atMs === wallOpenMs &&
    landing.lineIndex < wallOpenLine
  );
}

/** The DB2 mechanics that take control of a unit (charm, disorient, fear,
 * sleep, stun, freeze, knockout, polymorph, banish, horror, sap) — as
 * opposed to a root, a snare, a silence or an interrupt. */
const LOSS_OF_CONTROL_MECHANICS: ReadonlySet<number> = new Set([
  1, 2, 5, 10, 12, 13, 14, 17, 18, 24, 30,
]);

/** The other end (codex 85-tk-L6-T281-9 #2, 5305d5fa r0: Barkskin's REMOVED
 * on row 1890, a Lightning Bolt's damage on row 1891 of the same
 * millisecond, counted into the Barkskin): a landing logged below the row
 * that closed the wall, in that row's millisecond, came after it. */
export function landedAfterWallRow(
  landing: Pick<IPressLanding, "atMs" | "lineIndex">,
  wallCloseRow: { ms: number; lineIndex: number } | undefined,
): boolean {
  return (
    wallCloseRow !== undefined &&
    landing.lineIndex !== undefined &&
    landing.atMs === wallCloseRow.ms &&
    landing.lineIndex > wallCloseRow.lineIndex
  );
}

/**
 * Pipeline T281: does the data say aura `auraId` stops spell `spellId` —
 * positive evidence only, readings of the aura itself:
 *  - a wall the signed table gives every hit of the spell's school to
 *    (`immunityStopsDamageSpell`: Ice Block, Blessing of Protection against
 *    a physical attack);
 *  - DB2's SCHOOL_IMMUNITY on the aura covering the spell's schools
 *    (`immunityCoversSpell`: Time Stop, Imprison 221527, Freezing Trap
 *    203337 — no table row);
 *  - an immunity that lasts its aura (`immunityLastsItsAura`: the pressed
 *    Spirit of Redemption form 215769) unless its school mask rules the
 *    spell out — not the stealth-kind ones (Vanish, Burrow, Mass
 *    Invisibility: area damage lands through them, rulings U-KA3 / U-KA3b);
 *  - DB2's mechanic immunity on the aura listing the spell's mechanic
 *    (`immunityMechanics`: Dispersion against a root, Icebound Fortitude
 *    against a stun, Precognition against an interrupt, Sanctified Ground
 *    against a silence, Master's Call against a snare). The mechanic is a
 *    label of the spell: a row no table calls a control (`SPELL_CATEGORIES`,
 *    `isHardCcAura`) that carries a loss-of-control label is no control
 *    (Snowdrift's pulse 390171, "stunned", applied under Precognition) and
 *    is not matched; an interrupt or silence immunity a talent decides
 *    answers by the holder's talent (`unitAuraBlocksInterrupt`: Obsidian
 *    Scales). A snare label on a damage row is matched all the same
 *    (Pistol Shot under Blessing of Freedom — recorded, not told apart from
 *    Stormbind's refused snare);
 *  - for a control or root aura whose mechanic DB2 knows (`SPELL_CATEGORIES`
 *    cc / roots; Holy Word: Chastise's damage 88625 is typed cc, has none,
 *    and landed under Deep Breath and Bladestorm), a listed control immunity
 *    that covers it (`CC_AVOIDANCE_BUFF_SPELLS` with `avoidanceBuffCoversCc`:
 *    Deep Breath's flight, Ultimate Penitence — "can explain this IMMUNE
 *    row", not "always refuses": 64 % of controls into Ultimate Penitence
 *    logged IMMUNE) — unless the aura's own DB2
 *    list names loss-of-control mechanics, which then is the whole answer
 *    (Precognition). Movement out of a ground effect (Hover, Blessing of
 *    Freedom — `applicableCCAvoidanceIds`' other half) refuses nothing on
 *    the target and is not asked.
 * Codex 85-tk-L6-T281-3 #4 #5, -4 #2 #3, -5 #2 #3, -6 #1–#3.
 */
export function auraStopsSpell(
  auraId: string,
  spellId: string,
  /** the aura's holder, when known: a talent decides some interrupt
   * immunities (`unitAuraBlocksInterrupt`) */
  holder?: { info?: { pvpTalents?: string[] } | null },
): boolean {
  const mech = ccMechanicOf(spellId);
  const kind = SPELL_CATEGORIES[spellId]?.type;
  const auraMechs = immunityMechanics(auraId);
  return (
    immunityStopsDamageSpell(auraId, spellId) ||
    immunityCoversSpell(auraId, spellId) === true ||
    (immunityLastsItsAura(auraId) &&
      !ENEMY_IMMUNITY_HOLDS_ITS_AURA_IDS.has(auraId) &&
      immunityStopsSpellSchool(auraId, spellId) !== false) ||
    (mech !== undefined &&
      !!auraMechs?.includes(mech) &&
      !(
        kind === undefined &&
        LOSS_OF_CONTROL_MECHANICS.has(mech) &&
        !isHardCcAura(spellId)
      ) &&
      // an interrupt / silence immunity a talent decides (Obsidian Scales
      // without Obsidian Mettle: DB2 carries the row in every state)
      !(
        holder !== undefined &&
        (mech === 9 || mech === 26) &&
        auraBlocksInterrupt(auraId) &&
        !unitAuraBlocksInterrupt(holder, auraId)
      )) ||
    ((kind === "cc" || kind === "roots") &&
      mech !== undefined &&
      CC_AVOIDANCE_BUFF_SPELLS.has(auraId) &&
      !auraMechs?.some((m) => LOSS_OF_CONTROL_MECHANICS.has(m)) &&
      avoidanceBuffCoversCc(auraId, spellId))
  );
}

/**
 * Pipeline T281: the auras up on `target` at a refusal row that stop THIS
 * spell (`auraStopsSpell`) and can write an IMMUNE at all
 * (`avoidanceExplainsMissType`). The auras up are `ccAvoidanceBuffsUpAt`'s,
 * in log order up to the row. It is not the cast tag's cause reading
 * (`setup.ts` `ccImmuneCauseOf`), which is its own and differs both ways.
 * One reader for the section and its gate (scan5 `singles14b`): the aura
 * state is the same on both sides.
 */
export function aurasRefusingSpellAt(
  target: Pick<ICombatUnit, "auraEvents"> &
    Partial<Pick<ICombatUnit, "info" | "spellCastEvents">>,
  units: readonly ICombatUnit[],
  spellId: string,
  atMs: number,
  atLine: number | undefined,
): string[] {
  const stops = (auraId: string): boolean =>
    auraStopsSpell(auraId, spellId, target);
  return ccAvoidanceBuffsUpAt(target, atMs, {
    ...(atLine === undefined ? {} : { atLine }),
    judgedIsMiss: true,
    casterOf: (id) => units.find((u) => u.id === id),
    also: stops,
    units,
  })
    .filter(
      (b) => stops(b.spellId) && avoidanceExplainsMissType(b.spellId, "IMMUNE"),
    )
    .map((b) => b.spellId);
}

/**
 * Pipeline T281 (same round: a Starsurge logged IMMUNE 0.26 s after Ice
 * Block went up, counted into the Ironbark under it): was this press refused
 * outright by ANOTHER aura than the wall — its landing an IMMUNE with no hit
 * of the press beside it (`IPressLanding.immune`), the wall itself not
 * stopping the spell (`auraStopsSpell` — asked of the wall directly, its
 * window being open: a rebroadcast can show it down between two rows of one
 * millisecond), while another aura that stops it was up on the target
 * (`refusingAurasUp`, `aurasRefusingSpellAt`) or a damage-immune control was
 * (`immuneControlUp`: Cyclone)? Then the cast went into that, not into the
 * wall. A wall that stops the spell keeps the cast whatever else is up (an
 * immunity; Dispersion against a root), a wall that does not gives it up
 * even when it is an immunity of other schools (Blessing of Spellwarding and
 * a physical stun Icebound Fortitude refused), and a refusal the log shows
 * no cause for stays (codex 85-tk-L6-T281-1 #4, -2 #4, -3 #2, -4 #4).
 */
export function refusedByAnotherAura(
  wallAuraId: string,
  spellId: string,
  landing: Pick<IPressLanding, "immune">,
  refusingAurasUp: readonly string[],
  immuneControlUp: boolean,
  /** the wall's holder (`auraStopsSpell`) */
  holder?: { info?: { pvpTalents?: string[] } | null },
): boolean {
  return (
    landing.immune === true &&
    !auraStopsSpell(wallAuraId, spellId, holder) &&
    (immuneControlUp || refusingAurasUp.some((id) => id !== wallAuraId))
  );
}

/**
 * Pipeline T281: which of a press's rows is its landing, and where the next
 * press of the spell starts reading. `rows` are the spell's rows on the
 * target in time order, `next` the first one this press can own.
 *  - a row that is no hit (a refusal, the press's aura row, a miss) with a
 *    hit beside it (`PRESS_LANDED_SAME_INSTANT_MS`) landed
 *    at the hit (Rake's stun 163505 IMMUNE, its damage 16 ms later), unless
 *    a later press of the spell went off between the two — the hit is that
 *    one's; both rows are consumed;
 *  - a hit takes the other rows of its own millisecond with it (a hit sorts
 *    before them).
 * One cursor for the section (`pressLandingRows`) and its gate (scan5
 * `singles14b`) — codex 85-tk-L6-T281-3 #1, -4 #1, #5.
 */
export function claimLandingRow<
  R extends { hit: boolean; immune?: true | undefined },
>(
  rows: readonly R[],
  next: number,
  atOf: (row: R) => number,
  /** this press, and every press of the spell on the target */
  pressMs: number,
  pressTimesMs: readonly number[],
): { landing: number; cursor: number } {
  const row = rows[next]!;
  const at = atOf(row);
  // a row that is no hit — a refusal, the press's aura going on, a miss —
  // with a hit of the press beside it landed at the hit (Wildfire Bomb's
  // aura refreshed 12 ms before its 83k hit: 69372d87 r4, codex
  // 85-tk-L6-T281-10 #1)
  if (!row.hit) {
    const beside = rows.findIndex(
      (o, k) =>
        k > next &&
        o.hit &&
        atOf(o) - at <= PRESS_LANDED_SAME_INSTANT_MS &&
        // …and no LATER press than this one went off by the hit: its own
        // projectile can be the hit (two Throw Glaives 440 ms apart, the
        // first dodged 20 ms before the second hit — codex 85-tk-L6-T281-11
        // #1). This press's own success row can be logged after its refusal
        // and is no later press (b3dea9f6: Rake's stun refused 12.606, its
        // success and damage 12.622 — -5 #1).
        !pressTimesMs.some((p) => p > pressMs && p <= atOf(o)),
    );
    return beside >= 0
      ? { landing: beside, cursor: beside + 1 }
      : { landing: next, cursor: next + 1 };
  }
  let cursor = next + 1;
  while (rows[cursor] && !rows[cursor]!.hit && atOf(rows[cursor]!) === at)
    cursor++;
  return { landing: next, cursor };
}

/** Did this landing go THROUGH the defensive `auraId` — a damage row of the
 * press inside a wall whose signed row stops every hit it covers (pct 100:
 * an immunity or a deflection)? Then the wall did not stop it and the cast
 * is no attack "into" it (fact11 D21, 7708f698 1:55: a Chaos Bolt in flight
 * hit for 220k inside Aspect of the Turtle, the hunter left at 4.9 %). A
 * damage-reduction wall is hit through by design and keeps its casts. One
 * reading for ABILITIES INTO IMMUNITY and its gate (`corpusFactScan4`). */
export function landedThroughWall(
  auraId: string,
  landing: Pick<IPressLanding, "hit">,
): boolean {
  return landing.hit && wallStopsEveryHit(auraId);
}

/** The aura rows a press lands as: its debuff applied, refreshed, or a
 * stack added. Without the stack row a press that only added a stack had no
 * landing of its own and an earlier press took the next refresh — Unstable
 * Affliction's stack landed 1.07 s before Survival of the Fittest opened and
 * the line counted three presses into it where two landed (872f275c r0;
 * codex 85-tk-L6-T281-8). One test for the section and its gate. */
export function isAuraLandingEvent(event: string | undefined): boolean {
  return (
    event === LogEvent.SPELL_AURA_APPLIED ||
    event === LogEvent.SPELL_AURA_REFRESH ||
    event === LogEvent.SPELL_AURA_APPLIED_DOSE
  );
}

/** A stack its own periodic tick added is no press's landing: Agony stacks
 * on each tick, and the stack row of a tick 1.28 s after a press was taken
 * as that press's landing, past the Spirit Link Totem it was cast into
 * (3bb93589 r3; codex 85-tk-L6-T281-9 #1). `tickMs` are the caster's
 * periodic damage rows of the spell on that target. */
export const TICK_STACK_ROW_MS = 20;
export function isTickStackRow(
  event: string | undefined,
  atMs: number,
  tickMs: readonly number[],
): boolean {
  return (
    event === LogEvent.SPELL_AURA_APPLIED_DOSE &&
    tickMs.some((t) => Math.abs(t - atMs) <= TICK_STACK_ROW_MS)
  );
}

/** `pressLandingsMs` with the attack each press landed as (`IPressLanding`). */
export function pressLandingRows<T extends LandingPress>(
  presses: readonly T[],
  atMsOf: (press: T) => number,
  caster: LandingCaster,
  targets: readonly Pick<ICombatUnit, "id" | "auraEvents">[],
): Map<T, IPressLanding> {
  const rowsByKey = new Map<string, IPressLanding[]>();
  const add = (
    destUnitId: string,
    spellId: string | null | undefined,
    spellName: string | null | undefined,
    atMs: number,
    attack: boolean,
    hit: boolean,
    lineIndex?: number,
    immune?: boolean,
  ) => {
    const key = `${destUnitId}|${spellNameKey(spellId, spellName)}`;
    const row: IPressLanding = {
      atMs,
      spellId: attack ? (spellId ?? null) : null,
      hit,
      ...(lineIndex === undefined ? {} : { lineIndex }),
      ...(immune ? { immune: true as const } : {}),
    };
    const rows = rowsByKey.get(key);
    if (rows) rows.push(row);
    else rowsByKey.set(key, [row]);
  };
  for (const d of caster.damageOut) {
    const event = d.logLine?.event as string | undefined;
    if (event === LogEvent.SPELL_ABSORBED) continue;
    if (event === LogEvent.SPELL_PERIODIC_DAMAGE) continue;
    add(
      d.destUnitId,
      d.spellId,
      d.spellName,
      d.logLine.timestamp,
      true,
      true,
      d.logLine.lineIndex,
    );
  }
  for (const m of caster.missesOut ?? []) {
    if (m.logLine?.event === LogEvent.SPELL_PERIODIC_MISSED) continue;
    // a hit a shield ate whole is logged as a miss of type ABSORB: it got
    // through whatever wall the target had up (fact11 D20: Tiger Palm into
    // Void Shield inside Cloak of Shadows)
    add(
      m.destUnitId,
      m.spellId,
      m.spellName,
      m.timestamp,
      true,
      m.missType === "ABSORB",
      m.logLine?.lineIndex,
      m.missType === "IMMUNE",
    );
  }
  // the caster's periodic ticks per target and spell (`isTickStackRow`)
  const ticksByKey = new Map<string, number[]>();
  for (const d of caster.damageOut ?? []) {
    if (d.logLine?.event !== LogEvent.SPELL_PERIODIC_DAMAGE) continue;
    const k = `${d.destUnitId}|${spellNameKey(d.spellId ?? "", d.spellName ?? "")}`;
    const list = ticksByKey.get(k);
    if (list) list.push(d.logLine.timestamp);
    else ticksByKey.set(k, [d.logLine.timestamp]);
  }
  for (const unit of targets)
    for (const a of unit.auraEvents ?? []) {
      if (a.srcUnitId !== caster.id) continue;
      if (
        isAuraLandingEvent(a.logLine?.event) &&
        !isTickStackRow(
          a.logLine?.event,
          a.logLine.timestamp,
          ticksByKey.get(
            `${unit.id}|${spellNameKey(a.spellId, a.spellName)}`,
          ) ?? [],
        )
      )
        add(
          unit.id,
          a.spellId,
          a.spellName,
          a.logLine.timestamp,
          false,
          false,
          a.logLine.lineIndex,
        );
    }
  for (const rows of rowsByKey.values()) rows.sort((a, b) => a.atMs - b.atMs);

  const taken = new Map<string, number>();
  const landed = new Map<T, IPressLanding>();
  const inOrder = [...presses].sort((a, b) => atMsOf(a) - atMsOf(b));
  const pressTimesByKey = new Map<string, number[]>();
  for (const o of inOrder) {
    const k = `${o.destUnitId}|${spellNameKey(o.spellId, o.spellName)}`;
    const list = pressTimesByKey.get(k);
    if (list) list.push(atMsOf(o));
    else pressTimesByKey.set(k, [atMsOf(o)]);
  }
  for (const press of inOrder) {
    const atMs = atMsOf(press);
    const key = `${press.destUnitId}|${spellNameKey(press.spellId, press.spellName)}`;
    const rows = rowsByKey.get(key) ?? [];
    let next = taken.get(key) ?? 0;
    while (next < rows.length && rows[next]!.atMs < atMs - PRESS_EFFECT_LEAD_MS)
      next++;
    const row = rows[next];
    if (row !== undefined && row.atMs <= atMs + REFLECT_ROW_LAG_MS) {
      const claim = claimLandingRow(
        rows,
        next,
        (r) => r.atMs,
        atMs,
        pressTimesByKey.get(key) ?? [],
      );
      landed.set(press, rows[claim.landing]!);
      next = claim.cursor;
    } else {
      // no row of its own: it lands at its press, in the log's order (an
      // Incinerate cast logged two rows below Divine Protection's REMOVED,
      // its bolt 1.6 s later: 429a3735 r0, codex 85-tk-L6-T281-10 #2)
      // …when the press is that row: an empowered spell goes off at its
      // release, not at the hold's first row (codex 85-tk-L6-T281-11 #2)
      const lineIndex =
        press.logLine?.timestamp === atMs ? press.logLine.lineIndex : undefined;
      landed.set(press, {
        atMs,
        spellId: null,
        hit: false,
        ...(lineIndex === undefined ? {} : { lineIndex }),
      });
    }
    taken.set(key, next);
  }
  return landed;
}

function reflectedBack(
  caster: ICombatUnit,
  spellId: string,
  targetId: string,
  castMs: number,
): boolean {
  // a hit can log under another id of the spell's name (Lava Burst 51505,
  // its bolt 285452)
  const family = castAndEffectIds(spellId);
  const name = spellNameKey(spellId);
  return (caster.missesOut ?? []).some(
    (m) =>
      m.missType === "REFLECT" &&
      m.destUnitId === targetId &&
      !!m.spellId &&
      (family.has(m.spellId) ||
        spellNameKey(m.spellId, m.spellName) === name) &&
      m.timestamp >= castMs &&
      m.timestamp <= castMs + REFLECT_ROW_LAG_MS,
  );
}

/** Render an ability sequence with canonical English names and run-length
 * collapse of consecutive repeats (e.g. "Throw Glaive ×6") — fixes both the
 * localized-name leak and token spam from un-collapsed repeats. */
function formatAbilitySequence(casts: IOffensiveWasteCast[]): string {
  const names = casts.map((c) => getEnglishSpellName(c.spellId, c.spellName));
  const runs: { name: string; n: number }[] = [];
  for (const name of names) {
    const last = runs[runs.length - 1];
    if (last && last.name === name) last.n++;
    else runs.push({ name, n: 1 });
  }
  return runs.map((r) => (r.n > 1 ? `${r.name} ×${r.n}` : r.name)).join(" + ");
}

export function formatOffensiveWasteForContext(
  summary: IOffensiveWasteSummary,
): string {
  if (summary.events.length === 0) return "";
  // FT-T15 M5: the section was a bare title, and its "DR" (damage
  // reduction) is the timeline legend's word for diminishing returns. The
  // definition states what `buildOffensiveWasteSummary` computes, from the
  // same constants; it prints only with the section (an empty summary
  // returns "" above).
  const lines: string[] = [
    "ABILITIES INTO IMMUNITY/DR",
    "  (DR here = damage reduction, not the timeline's `[DR: …]` diminishing returns. Each line = one enemy defensive, from the",
    "  second it went up (`[m:ss]`) to its logged end, and a player of your team whose casts on that enemy landed inside it.",
    `  Two kinds of defensive are listed: one that makes hitting into it pointless whatever the target's HP (full immunities and`,
    `  the few walls signed the same way) — from ${WASTE_MIN_CASTS.unconditional} casts; and a damage-reduction wall — from ${WASTE_MIN_CASTS["kill-live-gated"]} casts, and only when that enemy never`,
    `  read ${KILL_LIVE_HP_PCT}% HP or lower while it was up. Casts counted: the player's spells that each made at least ${Math.round(HIGH_VALUE_DAMAGE_SHARE * 100)}% of their damage this`,
    "  round, plus their control spells into the first kind. A line marked `(deferral)` is Time Dilation: counted as a",
    "  damage-reduction wall, but it reduces nothing — it holds part of each hit back and the target takes it later.)",
  ];
  for (const ev of summary.events) {
    const t = fmtTime(ev.defenseWindowSeconds[0]);
    const spells = formatAbilitySequence(ev.wasteCasts);
    lines.push(
      `  [${t}] ${ev.casterSpec} (${ev.casterName}): ${spells} into ${ev.targetName}'s ${ev.defenseName}${ev.deferral ? INTO_DEFERRAL_TAG : ""}`,
    );
  }
  return lines.join("\n");
}

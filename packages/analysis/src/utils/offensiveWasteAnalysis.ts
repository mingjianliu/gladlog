import {
  AtomicArenaCombat,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import { castAndEffectIds, castKeyOfAura } from "../data/castEffectAuras";
import {
  KILL_LIVE_HP_PCT,
  type MitigationVerdict,
  mitigationVerdictOf,
  nonMeleeMitigationVerdictOf,
} from "../data/mitigationVerdicts";
import { getEnglishSpellName } from "../data/spellEffectData";
import { parryStopsAttack } from "../data/spellParry";
import { isAllyCopyWallId } from "./allyCopyWall";
import { buildAuraIntervals } from "./auraIntervals";
import { empowerSpans, type EmpowerSpanUnit } from "./castCommitSpans";
import { isControlCast } from "./castMissRows";
import {
  COMPANION_CAST_ROW_MS,
  isNoPressRow,
  isPressImpactRow,
  pressImpactRow,
} from "./castPress";
import { applicableCCAvoidanceIds } from "./ccTrinketAnalysis";
import {
  hpTroughInEventSpan,
  PRESS_EFFECT_LEAD_MS,
  specToString,
} from "./cooldowns";
import { spellNameKey } from "./damagePress";
import {
  immunityStopsSpellSchool,
  wallStopsEveryHit,
} from "./enemyDefensives";
import { isDeferralAbsorb, isDeferralDamageRow } from "./incomingPressure";
import { fmtTime } from "./renderGrid";
import { roundEndMs } from "./roundEnd";

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
const EMPOWER_HOLD_ROW_MS = 500;

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
  unitId: string;
  unitName: string;
  unitSpec: string;
  /** 用于击杀成立判定的血量采样;不参与其他逻辑。 */
  unit: ICombatUnit;
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
    if (ownTeamIds.has(dmg.destUnitId) || isDeferralDamageRow(dmg)) continue;
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
            if (landedThroughWall(window.spellId, landings.get(e)!))
              return false;
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

        if (wasteCasts.length < threshold) continue;
        // 击杀成立时顶着减伤打是正确操作 —— 只有不成立时才算该转火。
        // 无条件类不看这个:打不进去就是打不进去。
        if (
          window.verdict === "kill-live-gated" &&
          killWasLive(window, matchStartMs, roundEndAt)
        ) {
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
  ) => {
    const key = `${destUnitId}|${spellNameKey(spellId, spellName)}`;
    const row = { atMs, spellId: attack ? (spellId ?? null) : null, hit };
    const rows = rowsByKey.get(key);
    if (rows) rows.push(row);
    else rowsByKey.set(key, [row]);
  };
  for (const d of caster.damageOut) {
    const event = d.logLine?.event as string | undefined;
    if (event === LogEvent.SPELL_ABSORBED) continue;
    if (event === LogEvent.SPELL_PERIODIC_DAMAGE) continue;
    add(d.destUnitId, d.spellId, d.spellName, d.logLine.timestamp, true, true);
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
    );
  }
  for (const unit of targets)
    for (const a of unit.auraEvents ?? []) {
      if (a.srcUnitId !== caster.id) continue;
      const event = a.logLine?.event;
      if (
        event === LogEvent.SPELL_AURA_APPLIED ||
        event === LogEvent.SPELL_AURA_REFRESH
      )
        add(unit.id, a.spellId, a.spellName, a.logLine.timestamp, false, false);
    }
  for (const rows of rowsByKey.values()) rows.sort((a, b) => a.atMs - b.atMs);

  const taken = new Map<string, number>();
  const landed = new Map<T, IPressLanding>();
  const inOrder = [...presses].sort((a, b) => atMsOf(a) - atMsOf(b));
  for (const press of inOrder) {
    const atMs = atMsOf(press);
    const key = `${press.destUnitId}|${spellNameKey(press.spellId, press.spellName)}`;
    const rows = rowsByKey.get(key) ?? [];
    let next = taken.get(key) ?? 0;
    while (next < rows.length && rows[next]!.atMs < atMs - PRESS_EFFECT_LEAD_MS)
      next++;
    const row = rows[next];
    if (row !== undefined && row.atMs <= atMs + REFLECT_ROW_LAG_MS) {
      landed.set(press, row);
      next++;
    } else landed.set(press, { atMs, spellId: null, hit: false });
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

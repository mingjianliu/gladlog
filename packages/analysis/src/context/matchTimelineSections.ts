import { ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { CD_WASTE_PRESSURE_HP_PCT } from "../analysis/candidateFindings";
import { saveCoversPressureOn } from "../analysis/candidates/cooldownTiming";
import { getEnglishSpellName } from "../data/spellEffectData";
import {
  IPlayerCCTrinketSummary,
  breakableCcBeforeDeath,
  DEATH_BREAKABLE_CC_LOOKBACK_S,
  pvpTrinketRemainingSecondsAt,
  renderedCcDuration,
} from "../utils/ccTrinketAnalysis";
import {
  cdCanHelpAnotherUnit,
  cdIsProcOnly,
  cdNeverSpent,
  cdReadyInTimeAt,
  DEFENSIVE_TAGS,
  forbearanceStopsPress,
  getUnitHpAtTimestamp,
  HP_SAMPLE_RADIUS_MS,
  hpTroughInWindow,
  IDamageBucket,
  IMajorCooldownInfo,
  isDeadAtRenderSecond,
  isHealerSpec,
  isHpTroughWorthPrinting,
  isSpikeHealedThrough,
  SELF_CAST_NOOP_EXTERNAL_IDS,
  specToBenchmarkKey,
  specToString,
  usableWhileStunned,
} from "../utils/cooldowns";
import {
  COUNTERFACTUAL_WINDOW_S,
  DECISIVE_MARGIN_PCT,
  ICounterfactualHit,
  IMitigationAuditRow,
} from "../utils/counterfactual";
import {
  enemyTargetReaches,
  lockoutWindowCcSpellIds,
  wasLockedOutByStunOnly,
  wasLockedOutThroughWindow,
} from "../utils/deathOutcomeAnalysis";
import {
  documentRecordsAttackSpell,
  sumAbsorbedPressure,
} from "../utils/incomingPressure";
import type { RosterSides } from "../utils/rosterSide";
import {
  HEAL_ABSORB_SELF_SAVE_IDS,
  healAbsorbDeathLine,
  healAbsorbUseOf,
  healerCreditOf,
} from "../utils/healAbsorbSave";
import { executeKillingBlowOf } from "../utils/killingBlow";
import { getHpPercentAtTime } from "../utils/killWindowTargetSelection";
import {
  fmtTime,
  renderedWindowSeconds,
  toRenderSecond,
} from "../utils/renderGrid";
import { type ManaFallback, manaReadingAt } from "../utils/resourceAt";
import { benchmarks } from "../utils/specBaselines";
import {
  damageEventLabel,
  DMG_SPIKE_THRESHOLD,
  getTopDamageSourcesInWindow,
} from "./timelineHelpers";

// ── Rot Pressure (F147) ─────────────────────────────────────────────────────

/** @internal exported for data/curatedIdRegistry (corpus rot scan) */
export const DOT_SPELL_IDS = new Set<string>([
  "980",
  "172",
  "31117",
  "196364",
  "461531",
  "63106",
  "205179",
  "361695", // Warlock
  "589",
  "34914",
  "335467",
  "390978", // Priest
  "164812",
  "8921",
  "164815",
  "93402",
  "202347",
  "1079",
  "155722",
  "1822",
  "192090",
  "106830", // Druid
  "1943",
  "703",
  "2818",
  "122233",
  "121411", // Rogue
  "191587",
  "55078",
  "55095", // DK
  "188389", // Shaman
  "269747",
  "271788",
  "118253",
  "217200", // Hunter
  "12654", // Mage
  "262115",
  "84617", // Warrior
  "357209", // Evoker
]);

const DOT_SPELL_NAMES = new Set<string>([
  "agony",
  "corruption",
  "unstable affliction",
  "wither",
  "shadow word: pain",
  "vampiric touch",
  "devouring plague",
  "sunfire",
  "moonfire",
  "stellar flare",
  "rip",
  "rake",
  "thrash",
  "rupture",
  "garrote",
  "deadly poison",
  "crimson tempest",
  "virulent plague",
  "blood plague",
  "frost fever",
  "flame shock",
  "serpent sting",
  "ignite",
  "deep wounds",
  "fire breath",
]);

interface IDotInterval {
  spellId: string;
  spellName: string;
  startMs: number;
  endMs: number;
}

function extractPlayerDotIntervals(
  player: ICombatUnit,
  matchStartMs: number,
  matchEndMs: number,
): IDotInterval[] {
  const intervals: IDotInterval[] = [];
  const openDots = new Map<string, number>();

  const sortedEvents = player.auraEvents ?? [];

  for (const event of sortedEvents) {
    const ts = event.logLine.timestamp;
    if (ts > matchEndMs) continue;

    const spellId = event.spellId ?? "";
    const spellName = getEnglishSpellName(spellId, event.spellName);
    const spellNameLower = spellName.toLowerCase();

    const isDot =
      DOT_SPELL_IDS.has(spellId) ||
      [...DOT_SPELL_NAMES].some((name) => spellNameLower.includes(name));
    if (!isDot) continue;

    const auraType = event.logLine.parameters[11];
    if (auraType === "BUFF") continue;

    const stateKey = `${spellId}:${event.srcUnitId}`;
    if (event.logLine.event === LogEvent.SPELL_AURA_APPLIED) {
      if (!openDots.has(stateKey)) {
        openDots.set(stateKey, ts);
      }
    } else if (event.logLine.event === LogEvent.SPELL_AURA_REMOVED) {
      const startMs = openDots.get(stateKey);
      if (startMs !== undefined) {
        intervals.push({
          spellId,
          spellName,
          startMs,
          endMs: ts,
        });
        openDots.delete(stateKey);
      }
    }
  }

  for (const [stateKey, startMs] of openDots) {
    const spellId = stateKey.split(":")[0];
    const spellName = getEnglishSpellName(spellId, "");
    intervals.push({
      spellId,
      spellName,
      startMs,
      endMs: matchEndMs,
    });
  }

  return intervals;
}

/** [ROT PRESSURE]'s four numbers — the predicate below and the legend that
 * defines the line read the same constants (FT-T15 M5). */
export const ROT_PRESSURE_HP_PCT = 40;
export const ROT_PRESSURE_MIN_DOTS = 3;
export const ROT_PRESSURE_MIN_SECONDS = 4;
export const ROT_PRESSURE_MIN_PERIODIC_SHARE = 0.5;

/** FT-T15 M5: the family had no definition anywhere in the prompt (1,155
 * lines on the 605 capture, 0 legends). Printed by formatTimeline only when
 * a line of the family rendered. States what `emitRotPressureEntries`
 * computes, nothing more. */
export const ROT_PRESSURE_LEGEND: readonly string[] = [
  `  [ROT PRESSURE] = a player of either team spent ${ROT_PRESSURE_MIN_SECONDS} whole seconds in a row under ${ROT_PRESSURE_HP_PCT}% HP with ${ROT_PRESSURE_MIN_DOTS} or more tracked`,
  `    damage-over-time debuffs on them, and at least ${Math.round(ROT_PRESSURE_MIN_PERIODIC_SHARE * 100)}% of the damage they took in those ${ROT_PRESSURE_MIN_SECONDS} s was periodic. Printed once per`,
  "    such stretch, at the second it is reached, with the HP and the DoT count of that second.",
];

/**
 * Rot Pressure Detection (F147). Emits a [ROT PRESSURE] entry for each player that
 * sustains ≥ROT_PRESSURE_MIN_SECONDS consecutive seconds below ROT_PRESSURE_HP_PCT% HP
 * with ≥ROT_PRESSURE_MIN_DOTS active DoTs, where the recent damage was majority
 * periodic. Pushes entries via the `addEntry` callback.
 */
export function emitRotPressureEntries(params: {
  allPlayers: ICombatUnit[];
  matchStartMs: number;
  matchEndMs: number;
  matchDurationS: number;
  pid: (name: string) => string;
  /** FT-T15 ⑤a: the timeline's roster label for a player of EITHER side
   * (`allPlayers` holds both teams, and `pid` knows the friendly roster
   * only — an enemy printed as its bare character name, realm cut off:
   * 660 of 1,155 lines on the 605 capture). Resolved by the unit, not its
   * name. Absent ⇒ `pid(name)` as before, for callers without a roster. */
  labelOf?: (player: ICombatUnit) => string;
  addEntry: (timeSeconds: number, ...lines: string[]) => void;
}): void {
  const {
    allPlayers,
    matchStartMs,
    matchEndMs,
    matchDurationS,
    pid,
    labelOf,
    addEntry,
  } = params;

  for (const player of allPlayers) {
    const dotIntervals = extractPlayerDotIntervals(
      player,
      matchStartMs,
      matchEndMs,
    );
    const durationSeconds = Math.floor(matchDurationS);
    const dotCounts = new Array(durationSeconds + 1).fill(0);
    for (const interval of dotIntervals) {
      const startSec = Math.max(
        0,
        Math.ceil((interval.startMs - matchStartMs) / 1000),
      );
      const endSec = Math.min(
        durationSeconds,
        Math.floor((interval.endMs - matchStartMs) / 1000),
      );
      for (let t = startSec; t <= endSec; t++) {
        dotCounts[t]++;
      }
    }

    let consecutiveRotSeconds = 0;
    let emittedForThisBlock = false;

    for (let t = 0; t <= durationSeconds; t++) {
      const tsMs = matchStartMs + t * 1000;
      const dotCount = dotCounts[t];

      const hp = getUnitHpAtTimestamp(player, tsMs, HP_SAMPLE_RADIUS_MS);

      if (
        hp !== null &&
        hp < ROT_PRESSURE_HP_PCT &&
        dotCount >= ROT_PRESSURE_MIN_DOTS
      ) {
        consecutiveRotSeconds++;
        if (
          consecutiveRotSeconds >= ROT_PRESSURE_MIN_SECONDS &&
          !emittedForThisBlock
        ) {
          const windowStartMs = tsMs - ROT_PRESSURE_MIN_SECONDS * 1000;
          const windowEndMs = tsMs;

          let periodicDmg = 0;
          let totalDmg = 0;

          for (const dmg of player.damageIn) {
            if (
              dmg.timestamp >= windowStartMs &&
              dmg.timestamp <= windowEndMs
            ) {
              const amount = Math.abs(dmg.effectiveAmount || dmg.amount);
              totalDmg += amount;
              if (
                dmg.logLine.event === "SPELL_PERIODIC_DAMAGE" ||
                dmg.logLine.event === "SPELL_PERIODIC_DAMAGE_SUPPORT"
              ) {
                periodicDmg += amount;
              }
            }
          }

          if (
            totalDmg === 0 ||
            periodicDmg / totalDmg >= ROT_PRESSURE_MIN_PERIODIC_SHARE
          ) {
            addEntry(
              t,
              `${fmtTime(t)}  [ROT PRESSURE]   ${labelOf ? labelOf(player) : pid(player.name)} (${specToString(player.spec)}) at ${Math.round(hp)}% HP with ${dotCount} active DoTs`,
            );
            emittedForThisBlock = true;
          }
        }
      } else {
        consecutiveRotSeconds = 0;
        emittedForThisBlock = false;
      }
    }
  }
}

// ── [DMG SPIKE] events ──────────────────────────────────────────────────────

/**
 * Emits [DMG SPIKE] entries for each pressure window at or above DMG_SPIKE_THRESHOLD,
 * annotating HP velocity, absorbs, and top damage sources. Pushes entries via `addEntry`.
 */
export function emitDmgSpikeEntries(params: {
  pressureWindows: IDamageBucket[];
  friends: ICombatUnit[];
  matchStartMs: number;
  pid: (name: string) => string;
  playerIdMap?: Map<string, number>;
  enemyIdMap?: Map<string, number>;
  /** summon GUID → owner name (`buildSummonOwnerNames`) */
  summonOwners?: ReadonlyMap<string, string>;
  /** unit GUID → roster side (`buildRosterSides`) */
  rosterSides?: RosterSides;
  /** unit GUID → name, to label an attacker known only by id (absorbs) */
  unitNames?: ReadonlyMap<string, string>;
  /** 与 [CC ON TEAM] 行同源的 CC 实例(analyzePlayerCCAndTrinket 产出)——
   *  「敌方 CC 掩护」标注只做窗口重叠 join,不重新推导任何 CC 事实。
   *  缺省时不渲染标注(手搭 fixture 兼容;生产调用点总是传)。 */
  ccTrinketSummaries?: IPlayerCCTrinketSummary[];
  /** owner 名(角色化命名用:you)。 */
  ownerName?: string;
  /** 治疗名单(角色化命名用:healer)。 */
  healerNames?: string[];
  addEntry: (timeSeconds: number, ...lines: string[]) => void;
}): void {
  const {
    pressureWindows,
    friends,
    matchStartMs,
    pid,
    playerIdMap,
    enemyIdMap,
    summonOwners,
    unitNames,
    rosterSides,
    ccTrinketSummaries,
    ownerName,
    healerNames,
    addEntry,
  } = params;

  for (const pw of pressureWindows) {
    if (pw.totalDamage < DMG_SPIKE_THRESHOLD) continue;
    const dmgM = (pw.totalDamage / 1_000_000).toFixed(2);
    // The width of the DISPLAYED endpoints (`renderedWindowSeconds`): 10 for a
    // full bucket, as before; fewer for one that closed at its victim's death
    // or the round's end (T12 ① c) — `0:39–0:45 … in 6s`, not a raw 6.7
    // rounded to 7 beside endpoints 6 apart.
    const windowSec = renderedWindowSeconds(pw.fromSeconds, pw.toSeconds);
    // B20: Prevent Infinityk DPS on sub-second windows
    const dpsK = Math.round(pw.totalDamage / Math.max(1, windowSec) / 1000);

    const targetUnit = friends.find((f) => f.name === pw.targetName);
    // The sampling instant MUST be snapped to the render grid first: this
    // line's timestamp goes through fmtTime (floor), while [STATE] samples on
    // whole seconds. Sampling at the fractional pw.fromSeconds hits a different
    // advancedAction, so two lines under the same displayed second disagree
    // about HP (2026-07-20 eval: 26/50 matches, median 7pp). The radius is
    // HP_SAMPLE_RADIUS_MS everywhere, matching the [STATE] tick (same instant +
    // same radius ⇒ necessarily the same reading). A narrower ±1.5s for
    // critical windows once existed and has been deleted, see cooldowns.ts.
    const fromSec = toRenderSecond(pw.fromSeconds);
    const toSec = toRenderSecond(pw.toSeconds);
    const hpFrom = targetUnit
      ? getUnitHpAtTimestamp(
          targetUnit,
          matchStartMs + fromSec * 1000,
          HP_SAMPLE_RADIUS_MS,
        )
      : null;
    // T12 ① c: a unit dead at the end second reads 0 there — the `[STATE]`
    // tick's own predicate (`isDeadAtRenderSecond`), the burst ledger's
    // `Target:` convention. The sampler alone returned whatever advanced
    // action sat within its radius of a second the unit did not live to see
    // (121-5-690: `33% -> 100% HP, +7%/s` over a death), or nothing at all.
    const hpTo = targetUnit
      ? isDeadAtRenderSecond(targetUnit, matchStartMs, toSec)
        ? 0
        : getUnitHpAtTimestamp(
            targetUnit,
            matchStartMs + toSec * 1000,
            HP_SAMPLE_RADIUS_MS,
          )
      : null;
    let hpStr = "";
    if (hpFrom !== null && hpTo !== null) {
      const hpDelta = hpTo - hpFrom;
      const hpVelocity = hpDelta / Math.max(1, windowSec);
      const sign = hpVelocity > 0 ? "+" : "";
      // labelBias fix (3 independent judge batches, 2026-07-15): a [DMG SPIKE]
      // whose target ends the window at equal-or-higher HP reads as a severity
      // verdict on a non-event. Keep the tag and the percent format (the
      // Layer-A HP gate parses them) but state the outcome explicitly.
      //
      // …unless the endpoints hide a trough (2026-09-15 Opus baseline: 73/309
      // prompts read `81% -> 87% — healed through` over a window whose own
      // [STATE] tick showed 37%). "Worth printing" is isHpTroughWorthPrinting
      // (≥ 10 points under both endpoints, ruling A′14).
      //
      // FT-T03 (user ruling 2026-10-10, D7): the low is a TROUGH — the true
      // minimum of every sample inside the displayed seconds
      // (hpTroughInWindow), printed at the second it occurred — no longer the
      // lowest whole-second tick (141470d0: `low 33% @4:15` over a 6 % reading
      // 0.4 s later; 0e0663e6: `82% -> 98% HP — healed through` over 65 %).
      // The endpoints A / B stay [STATE] readings. The eval gate verifies the
      // weaker invariant: no tick inside the window reads below the low.
      const low = targetUnit
        ? hpTroughInWindow(targetUnit, matchStartMs, fromSec, toSec)
        : null;
      const trough =
        low !== null && isHpTroughWorthPrinting(hpFrom, hpTo, low.pct)
          ? low
          : null;
      const troughTag = trough
        ? `, low ${trough.pct}% @${fmtTime(trough.atSec)}`
        : "";
      const outcomeTag = isSpikeHealedThrough(hpFrom, hpTo, trough !== null)
        ? " — healed through"
        : "";
      hpStr = ` (${hpFrom}% -> ${hpTo}% HP, ${sign}${hpVelocity.toFixed(0)}%/s${troughTag}${outcomeTag})`;
    }

    const benchmarkKey = targetUnit ? specToBenchmarkKey(targetUnit.spec) : "";
    let b = benchmarks.bySpec[benchmarkKey];

    // Fallback logic for missing specs: try generic spec for same class (e.g. Shadow -> Holy Priest baseline)
    if (!b && targetUnit) {
      const className = benchmarkKey.split(" ")[0];
      const fallbackKey = Object.keys(benchmarks.bySpec).find((k) =>
        k.startsWith(className),
      );
      if (fallbackKey) b = benchmarks.bySpec[fallbackKey];
    }

    const fromMs = matchStartMs + pw.fromSeconds * 1000;
    const toMs = matchStartMs + pw.toSeconds * 1000;
    // This used to scan `damageIn` for SPELL_ABSORBED — an event class that
    // array cannot contain (absorbs are their own group), so the annotation
    // printed on 0 of 2,952 windows across 600 new-season rounds. It reads the
    // shared incoming-pressure predicate now, same source the window itself
    // is built from.
    const totalAbsorbed = targetUnit
      ? sumAbsorbedPressure(targetUnit, fromMs, toMs, rosterSides)
      : 0;

    const absorbStr =
      totalAbsorbed > 100_000
        ? ` (${(totalAbsorbed / 1_000_000).toFixed(2)}M absorbed)`
        : "";

    const topSources = targetUnit
      ? getTopDamageSourcesInWindow(
          targetUnit,
          toMs,
          pw.toSeconds * 1000 - pw.fromSeconds * 1000,
          3,
          playerIdMap,
          enemyIdMap,
          summonOwners,
          unitNames,
          rosterSides,
        )
      : [];
    const sourceStr =
      topSources.length > 0
        ? `\n                 Top sources: ${topSources.join(", ")}`
        : "";

    // 「敌方 CC 掩护」标注(2026-08-26,逐行探针报告 R4 —— 模型点名想要的三样
    // 事实之一;GH #34 系列)。三条措辞纪律:
    //  · 只陈述事实不写判决词(labelBias 教训,2026-07-15 三批判官实锤);
    //  · 无 CC 时**显式**写 no enemy CC in window —— 植入实验(100 局)证明缺省
    //    是歧义的(「没看」还是「没有」),而模型对写出来的话照单全收;
    //  · 时间用与 [CC ON TEAM] 行同一个 fmtTime,promptQualityCheck 的
    //    checkDmgSpikeCcCoverConsistency 据此逐条交叉校验(防未来两处漂移)。
    // 排序:受害者(被控 = 不能自保,信息量最大)→ 治疗/owner → 其他;上限 3 条。
    let ccStr = "";
    if (ccTrinketSummaries) {
      const hits: { at: number; pri: number; txt: string }[] = [];
      for (const summary of ccTrinketSummaries) {
        for (const cc of summary.ccInstances) {
          if (
            cc.atSeconds >= pw.toSeconds ||
            cc.atSeconds + cc.durationSeconds <= pw.fromSeconds
          )
            continue;
          const isTarget = summary.playerName === pw.targetName;
          const isOwner =
            ownerName !== undefined && summary.playerName === ownerName;
          const isHealerUnit =
            healerNames?.includes(summary.playerName) ?? false;
          const who = isTarget
            ? isOwner
              ? "the target(you)"
              : "the target"
            : isOwner
              ? "you"
              : isHealerUnit
                ? "healer"
                : pid(summary.playerName);
          hits.push({
            at: cc.atSeconds,
            pri: isTarget ? 0 : isOwner || isHealerUnit ? 1 : 2,
            // cc-dr F-DU1: whole seconds, the one CC formatter
            txt: `${cc.spellName}\u2192${who}@${fmtTime(cc.atSeconds)} (${renderedCcDuration(cc)})`,
          });
        }
      }
      hits.sort((a, b) => a.pri - b.pri || a.at - b.at);
      ccStr = hits.length
        ? ` | enemy CC in window: ${hits
            .slice(0, 3)
            .map((h) => h.txt)
            .join(", ")}${hits.length > 3 ? ` +${hits.length - 3} more` : ""}`
        : " | no enemy CC in window";
    }

    addEntry(
      pw.fromSeconds,
      `${fmtTime(pw.fromSeconds)}–${fmtTime(pw.toSeconds)}  [DMG SPIKE]   ${pid(pw.targetName)} (${pw.targetSpec}): ${dmgM}M in ${windowSec}s (${dpsK}k DPS)${hpStr}${absorbStr}${ccStr}${sourceStr}`,
    );
  }
}

// ── [MANA] markers (F144) ───────────────────────────────────────────────────

/**
 * Adds [MANA] context markers every 30s for long matches (>300s). Pushes entries via
 * `addEntry`. Caller gates the whole block on matchDurationS > 300.
 */
export function emitManaMarkerEntries(params: {
  owner: ICombatUnit;
  friends: ICombatUnit[];
  enemies: ICombatUnit[];
  matchStartMs: number;
  matchDurationS: number;
  friendlyDeathAtByName: Map<string, number>;
  enemyDeathAtByName: Map<string, number>;
  pid: (name: string) => string;
  enemyPid: (name: string) => string;
  addEntry: (timeSeconds: number, ...lines: string[]) => void;
  /** Raw-pass mana fallback (`manaReadingAt`). */
  manaFallback?: ManaFallback;
}): void {
  const {
    manaFallback,
    owner,
    friends,
    enemies,
    matchStartMs,
    matchDurationS,
    friendlyDeathAtByName,
    enemyDeathAtByName,
    pid,
    enemyPid,
    addEntry,
  } = params;

  const friendlyHealers = [
    owner,
    ...friends.filter((f) => f.id !== owner.id),
  ].filter((u) => isHealerSpec(u.spec));
  const enemyHealers = enemies.filter((u) => isHealerSpec(u.spec));
  if (friendlyHealers.length > 0 || enemyHealers.length > 0) {
    for (let t = 0; t <= Math.floor(matchDurationS); t += 30) {
      const tsMs = matchStartMs + t * 1000;

      const friendlyParts: string[] = [];
      for (const u of friendlyHealers) {
        const deathAt = friendlyDeathAtByName.get(u.name);
        const isDead = deathAt !== undefined && t >= Math.floor(deathAt);
        if (isDead) continue;

        const mana = manaReadingAt(u, tsMs, manaFallback);
        if (mana) friendlyParts.push(`${pid(u.name)}:${mana.pct}%`);
      }

      const enemyParts: string[] = [];
      for (const u of enemyHealers) {
        const deathAt = enemyDeathAtByName.get(u.name);
        const isDead = deathAt !== undefined && t >= Math.floor(deathAt);
        if (isDead) continue;

        const mana = manaReadingAt(u, tsMs, manaFallback);
        if (mana) enemyParts.push(`${enemyPid(u.name)}:${mana.pct}%`);
      }

      if (friendlyParts.length > 0 || enemyParts.length > 0) {
        let manaParts: string;
        if (friendlyParts.length > 0 && enemyParts.length > 0) {
          manaParts = `friends ${friendlyParts.join(" ")} / enemies ${enemyParts.join(" ")}`;
        } else if (friendlyParts.length > 0) {
          manaParts = `friends ${friendlyParts.join(" ")}`;
        } else {
          manaParts = `enemies ${enemyParts.join(" ")}`;
        }
        addEntry(t, `${fmtTime(t)}  [MANA]   ${manaParts}`);
      }
    }
  }
}

// ── [DEATH] events ──────────────────────────────────────────────────────────

/** ` | dampening: N%` on a `[DEATH]` line — nothing where no value is stated
 * (2v2 before the first logged stack; `getInitialDampening`, FT-T13 D11). */
function dampeningSuffix(
  dampeningAt: ((atSeconds: number) => number | null) | undefined,
  atSeconds: number,
): string {
  const pct = dampeningAt ? dampeningAt(atSeconds) : null;
  return pct === null ? "" : ` | dampening: ${pct}%`;
}

/**
 * Low-pressure guard note (2026-08-01 production feedback: "damage taken ≈ 0
 * and it still scolded me for not using mitigation").
 *
 * The owner's unused markers in the loadout / cooldown sections ([UNUSED] /
 * STATUS: NEVER USED) are kit facts and ignore pressure; the cd-waste candidate
 * does have a pressure gate (CD_WASTE_PRESSURE_HP_PCT) keeping it off the menu,
 * but the model still improvises "you didn't use your defensives" straight off
 * the unused markers — measured on the local library, 72/92 prompts from
 * low-pressure rounds (minHP >= threshold) carried ungated unused markers while
 * 0 carried a cd-waste candidate.
 *
 * Predicate single-source: this consumes the same constant and the same
 * matchMinHpPct sample as cdWasteEvents (passed in by the caller); both decide
 * the same fact — "was this match actually dangerous" — and they are exactly
 * complementary at the threshold (>= threshold → no cd-waste + this note shows;
 * < threshold → cd-waste fires + this note is absent).
 * Returns null = no note (real pressure / pressure unknown / no unused
 * non-throughput CD).
 *
 * 口径更正(2026-08-22,GH #29 第 5 项逐处量化时发现):上面这行原本写的是
 * 「no unused **mitigation wall**」,但代码判的是 `neverUsed && !isThroughput`,
 * 而 `!isThroughput` 只等于「不是 Offensive-tagged」—— 整个 Control 集合都算数,
 * 一个没放的冰冻陷阱就能触发这条注。**行为不改**:这条注只在 minHP ≥ 阈值
 * (确实没压力)时出现,内容是「别教他交防御」,那在低压力局里无论未用的是墙
 * 还是控都是对的判断,属于抑制性守护注,误触发不产生假指控。语料实测(250 场 /
 * 312 治疗轮,数据完整载入口径):出现 117 次。真要收紧成「墙」,现在有
 * data/abilityProfile.ts 的 isSurvivalWall 可用,但那要先有能证明它修好什么的
 * 数字 —— 目前没有。
 */
export function lowPressureUnusedDefensiveNote(
  cds: (Pick<
    IMajorCooldownInfo,
    "spellId" | "spellName" | "neverUsed" | "isThroughput"
  > &
    Partial<Pick<IMajorCooldownInfo, "tag" | "sharedCasts">> & {
      isProcOnly?: boolean;
    })[],
  minHpPct: number | null,
): string | null {
  if (minHpPct === null || minHpPct < CD_WASTE_PRESSURE_HP_PCT) return null;
  // 这句注印的是「他没用的 **defensive** cooldowns 是正确留着的」,所以触发它的
  // 也只能是 Defensive-tagged 的 CD。原判据 `!isThroughput` 只等于「不是 Offensive」,
  // 于是一个没放的雷鸣怒吼 / 压迫怒吼 / 心灵尖啸就能让这句话冒出来 —— 与 cd-waste
  // 同一个洞、同一个改法。实测(S2 归档非本人治疗 396 轮):这句注出现 218 轮,
  // 其中 **12 轮(5.5%)未用的 CD 里一个 Defensive 都没有**。tag 可选,缺省退回原判据。
  // Triage 2026-09-29 W4: the gate is the OWNER's HP, so it only speaks for
  // what protects the owner. It names the never-spent cooldowns that cannot
  // help another unit (`canHelpAnotherUnit`, the gate cd-hoarded itself uses)
  // and no longer says "do NOT coach pressing defensives" for the whole
  // match — ba8c0510 printed that beside a teammate cd-hoarded line accusing
  // a held Time Dilation. An ally-reaching cooldown is never called "held
  // correctly" here: the owner's HP says nothing about the teammate's.
  // (`!isSelfOnlyDefensive` is NOT the selector: it is true for Tranquility,
  // Divine Hymn and Apotheosis.)
  const held = cds.filter(
    (cd) =>
      cdNeverSpent(cd) &&
      // a proc-only entry has no button to hold (`PROC_ONLY_ACTIVATION_IDS`;
      // the loadout marks it [PASSIVE]) — agy review: Renewing Blaze was
      // named "correctly HELD" in 27 NOTEs
      !cdIsProcOnly(cd) &&
      !cd.isThroughput &&
      (cd.tag === undefined || DEFENSIVE_TAGS.has(cd.tag)) &&
      !cdCanHelpAnotherUnit(cd),
  );
  if (held.length === 0) return null;
  return `  NOTE: the log owner's lowest HP this match was ${Math.floor(minHpPct)}% — they were never under meaningful pressure themselves. Their never-used self-only defensive cooldowns (${held.map((cd) => cd.spellName).join(", ")}) were correctly HELD, not wasted.`;
}

/**
 * Form-A (mitigation audit) independent-estimate disclosure (#17b Task4 review,
 * Important #2) — each arith/immunity/mechanic row is computed on its own; no
 * same-window stacking is modeled. The card header already carries a Chinese
 * version of "each row independent, stacking not modeled", but the prompt side
 * was missing the same sentence; buildMatchContext's closure prepends it as the
 * first array element whenever auditLines is non-empty.
 * causalLint-safe: it states a computation convention, with no causal verbs.
 */
export const MITIGATION_AUDIT_INDEPENDENT_NOTE =
  "Mitigation audit note: each row below is an independent single-technique estimate — no stacking/interaction across rows is modeled";

/**
 * Mitigation audit (form A) single-line formatter (#17b Task4) —
 * buildMatchContext's counterfactualOf closure and this file's tests share one
 * formatter, so numbers/wording are never defined a second time (gate
 * predicates ARE the spec). The kind=arith blocked amount is already
 * back-computed by Task1's computeMitigationAudit; this only renders it. When
 * maxHp is missing (blockedPctMaxHp undefined) the percentage parenthetical is
 * omitted rather than extrapolated.
 */
export function formatMitigationAuditLine(row: IMitigationAuditRow): string {
  const overlap = row.activeOverlapS.toFixed(1);
  // triage G7-P5 (other F-O5 + cc-dr F-MA1, one wording): every form says the
  // overlap is inside the final window before the death
  const inWindow = `in the final ${COUNTERFACTUAL_WINDOW_S}s`;
  if (row.kind === "arith") {
    const blockedK = Math.round((row.blockedAmount ?? 0) / 1000);
    const pctPart =
      row.blockedPctMaxHp !== undefined
        ? ` (≈${row.blockedPctMaxHp}% max HP)`
        : "";
    return `Mitigation audit: ${row.spellName} blocked ~${blockedK}k${pctPart} over ${overlap}s active ${inWindow}`;
  }
  if (row.kind === "deferred") {
    const deferredK = Math.round((row.deferredAmount ?? 0) / 1000);
    const pctPart =
      row.deferredPctMaxHp !== undefined
        ? ` (≈${row.deferredPctMaxHp}% max HP)`
        : "";
    return `Mitigation audit: ${row.spellName} deferred ~${deferredK}k${pctPart} over ${overlap}s active ${inWindow} — delayed, not prevented: it lands later as the unit's own damage`;
  }
  if (row.kind === "immunity") {
    const dmgK = Math.round((row.damageTakenDuringImmunity ?? 0) / 1000);
    const outsideK = Math.round((row.damageOutsideImmunitySchool ?? 0) / 1000);
    const outsidePart =
      outsideK > 0 ? `; ~${outsideK}k of it outside the immunity's school` : "";
    return `Mitigation audit: ${row.spellName} immunity covered ${overlap}s ${inWindow} (still took ~${dmgK}k during it — dmg the immunity did not block${outsidePart})`;
  }
  // other F-O5: 24 of 25 such rows were shields, dodges or heals — "redirect /
  // reflect" named one; say only what is true of all of them
  return `Mitigation audit: ${row.spellName} active ${overlap}s ${inWindow} (not in the mitigation table — not modeled in the arithmetic)`;
}

/**
 * Counterfactual (form B / narrow gate, decisive only) single-line formatter
 * (#17b Task4). causalLint-compatible: uses the hypothetical "would have"
 * rather than causal verbs ("led to / caused / resulted in"). The margin number
 * references DECISIVE_MARGIN_PCT directly (Task1's single-source constant)
 * instead of redefining it.
 */
export function formatDecisiveCounterfactualLine(
  hit: ICounterfactualHit,
): string {
  const subject =
    hit.source === "missed-external" && hit.casterName
      ? `${hit.spellName} from ${hit.casterName}`
      : hit.spellName;
  return `Counterfactual (arithmetic, single-factor): ${subject} would have cut window damage below lethal (margin >${DECISIVE_MARGIN_PCT}% max HP)`;
}

/**
 * Emits friendly [DEATH] entries: unused-defensive / trinket-availability annotations,
 * a deferred resource snapshot, HP trajectory, and top damage sources in the final 10s.
 * `S` is the caller's deferred-snapshot placeholder type; `requestSnapshotPlaceholder`
 * and `addEntry` are passed in so the caller's closure state is preserved.
 */
export function emitFriendlyDeathEntries<S>(params: {
  friendlyDeaths: Array<{
    spec: string;
    name: string;
    atSeconds: number;
    note?: string;
  }>;
  unitsByName: Map<string, ICombatUnit>;
  ccTrinketSummaries: IPlayerCCTrinketSummary[];
  owner: ICombatUnit;
  ownerCDs: IMajorCooldownInfo[];
  teammateCDs: Array<{
    player: ICombatUnit;
    spec: string;
    cds: IMajorCooldownInfo[];
  }>;
  /** Enemy players: a defensive pressed ON AN ENEMY (Touch of Karma) is
   * "Unused" only with a living enemy in reach (`enemyTargetReaches`).
   * Omitted → none in reach, so such a defensive is never listed. */
  enemies?: readonly ICombatUnit[];
  matchStartMs: number;
  pid: (name: string) => string;
  playerIdMap?: Map<string, number>;
  enemyIdMap?: Map<string, number>;
  /** summon GUID → owner name (`buildSummonOwnerNames`) */
  summonOwners?: ReadonlyMap<string, string>;
  /** unit GUID → roster side (`buildRosterSides`) */
  rosterSides?: RosterSides;
  /** unit GUID → name, to label an attacker known only by id (absorbs) */
  unitNames?: ReadonlyMap<string, string>;
  /** GH #103 A1: the dampening at the death instant, same getter as the
   * `[CD] … | dampening: N%` lines. Without it the responder quoted the value
   * of a neighbouring line ("died at 3:15 at 66%" — 66% was 3:16's). Omitted,
   * or `null` at that instant (2v2 before the first logged stack) → no
   * suffix. */
  dampeningAt?: (atSeconds: number) => number | null;
  /**
   * Mitigation audit / counterfactual (#17b Task4): given (victim name, death
   * instant), return a set of already-formatted lines (auditLines /
   * decisiveLines, rendered by formatMitigationAuditLine /
   * formatDecisiveCounterfactualLine). **atSeconds is mandatory** — when the
   * same player dies twice inside one combat, looking up by name alone renders
   * both deaths with the first death's numbers (a critical bug found in the
   * 2026-07-30 review, c.f. the fix record in task-4-report.md). Optional; when
   * omitted no lines are emitted — zero breakage for old callers. An empty
   * array likewise emits nothing (honesty ethic: omit rather than placeholder).
   */
  counterfactualOf?: (
    victimName: string,
    atSeconds: number,
  ) => {
    auditLines: string[];
    decisiveLines: string[];
  };
  requestSnapshotPlaceholder: (
    timeSeconds: number,
    forceFull?: boolean,
    bypassDebounce?: boolean,
    deathOfUnitId?: string,
  ) => S;
  addEntry: (timeSeconds: number, ...lines: (string | S)[]) => void;
}): void {
  const {
    friendlyDeaths,
    unitsByName,
    ccTrinketSummaries,
    owner,
    ownerCDs,
    teammateCDs,
    enemies = [],
    matchStartMs,
    pid,
    playerIdMap,
    enemyIdMap,
    summonOwners,
    unitNames,
    rosterSides,
    counterfactualOf,
    requestSnapshotPlaceholder,
    addEntry,
  } = params;

  const allUnitsById = new Map(
    Array.from(unitsByName.values()).map((u) => [u.id, u]),
  );
  for (const death of friendlyDeaths) {
    const dyingUnit = unitsByName.get(death.name);
    let unusedDefensives = "";
    let trinketAvailable = false;
    if (dyingUnit) {
      const summary = ccTrinketSummaries.find(
        (s) => s.playerName === death.name,
      );
      if (
        summary &&
        (summary.trinketType === "Gladiator" ||
          summary.trinketType === "Adaptation")
      ) {
        // The one readiness predicate (W1j): own cooldown AND the racial lock
        // (e10c6bea: Will to Survive locked the Medallion past this line).
        trinketAvailable =
          pvpTrinketRemainingSecondsAt(summary, death.atSeconds) === 0;
      }

      // F145: Teammate Defensive Persistence Check — find big buttons that were available at death
      const allPlayerCDs = [
        ...ownerCDs.filter(() => owner.name === death.name),
        ...teammateCDs
          .filter((tc) => tc.player.name === death.name)
          .flatMap((tc) => tc.cds),
      ];

      const isLockedOut = summary
        ? wasLockedOutThroughWindow(summary, death.atSeconds)
        : false;
      // finding #1 (2026-08-14 final review): USABLE_WHILE_CC_SPELL_IDS is a
      // stunned-only table — checking it against a lockout window that
      // contains non-stun hard CC (fear/disorient/incap) over-accuses (a
      // stunned-usable wall isn't necessarily fear-usable). Only consult the
      // table when the whole lockout window was stun. See
      // wasLockedOutByStunOnly's doc comment for the full story.
      const isLockedOutStunOnly = summary
        ? wasLockedOutByStunOnly(summary, death.atSeconds)
        : false;
      const allUnits = Array.from(unitsByName.values());

      const readyAtDeath = allPlayerCDs
        .filter((cd) => cd.tag === "Defensive")
        // a row owned on the spec baseline alone is cd-hoarded's only (ruling
        // P-W6): this list has no school gate for a button never shown
        // (Fable review of F-W6, round 9: an Unholy DK killed by pure
        // physical damage read "Unused: Anti-Magic Shell")
        .filter((cd) => !cd.baselineOnly)
        // Single-source predicate (BACKLOG #18 Minor #3): availability at the
        // death instant shares one decision with candidateFindings'
        // death-unused-defensive / external-unused, and no longer goes through
        // availableWindows (that table also applies GRACE_SECONDS short-window
        // trimming, which serves the "cheaper alternative" advice and does not
        // apply to a point-in-time death query).
        .filter((cd) => cdReadyInTimeAt(cd, death.atSeconds))
        // B12/C3: only flag if it was actually usable (not locked out through the lethal window, or
        // is a stunned-usable defensive AND the lockout window was stun-only — see finding #1 above).
        .filter(
          (cd) =>
            !isLockedOut ||
            // 同 death.ts:走谓词而不是直接查无条件集合(单源)。条件层要看
            // 死者的 PvP 天赋(2026-09-26 天赋影响审计:之前传 undefined,
            // 条件层在死亡行里永远不生效)。
            // U-T1: the list is the dying unit's own saves, so a
            // school-limited purge is judged against the stuns that held it.
            (isLockedOutStunOnly &&
              usableWhileStunned(
                cd.spellId,
                new Set<string>(dyingUnit.info?.pvpTalents ?? []),
                summary
                  ? lockoutWindowCcSpellIds(summary, death.atSeconds)
                  : undefined,
              )),
        )
        // Forbearance: a paladin can't press Spellwarding/BoP/LoH/Divine Shield if it self-applied
        // Forbearance in the last 30s — don't list those as "unused" (false accusation).
        // Light's Revocation holders keep Divine Shield (forbearanceBlocks).
        // One predicate with cd-hoarded and the kill sequence
        // (`forbearanceStopsPress`, recipient = the dying unit itself).
        .filter(
          (cd) =>
            !forbearanceStopsPress(
              dyingUnit,
              cd.spellId,
              dyingUnit,
              allUnits,
              death.atSeconds,
              matchStartMs,
            ),
        )
        // Damage-redirect externals are a mechanical no-op on yourself (Blessing
        // of Sacrifice sends 30% of the damage TO the caster), so listing one as
        // a wall this player failed to press at their own death blames them for
        // a button that could not have saved them — 4 of 9 death lines carrying
        // an Unused list across 80 local matches were exactly this. The same set
        // already guards the "cheaper available" advice in cooldowns.ts; both
        // sides import it rather than each keeping a list.
        .filter((cd) => !SELF_CAST_NOOP_EXTERNAL_IDS.has(cd.spellId))
        // A defensive pressed ON AN ENEMY (Touch of Karma) only with a living
        // enemy in its reach — cd-hoarded's and the kill sequence's predicate
        // (codex review of F-W6, round 7: a Windwalker with no Karma cast
        // died with the only enemy 40 yd away, "Unused: Touch of Karma")
        .filter((cd) =>
          enemyTargetReaches(
            cd.spellId,
            dyingUnit,
            enemies as ICombatUnit[],
            matchStartMs + death.atSeconds * 1000,
          ),
        )
        // B-tier B3a (user ruling 2026-10-06): a school-limited save is
        // "unused" only when it covered what was killing them — cd-hoarded's
        // rule over the 2 s up to the death (`saveCoversPressureOn`)
        .filter((cd) =>
          saveCoversPressureOn(
            cd.spellId,
            dyingUnit,
            matchStartMs + death.atSeconds * 1000,
            {
              sides: rosterSides,
              recordsAttackSpell: documentRecordsAttackSpell(allUnits),
            },
          ),
        )
        .map((cd) => cd.spellName);

      if (readyAtDeath.length > 0) {
        unusedDefensives = ` (Unused: ${readyAtDeath.join(", ")})`;
      }
    }

    // A28 (user 2026-09-30, triage F-E28): say whether a CC worth breaking
    // was on them — a bare "available" invited "should have trinketed".
    const trinketSummary = ccTrinketSummaries.find(
      (s) => s.playerName === death.name,
    );
    const trinketPart = !trinketAvailable
      ? ""
      : trinketSummary &&
          breakableCcBeforeDeath(trinketSummary, death.atSeconds)
        ? " (PvP Trinket available)"
        : ` (PvP Trinket available; no breakable CC in the last ${DEATH_BREAKABLE_CC_LOOKBACK_S} s)`;
    const notePart = death.note ? ` [${death.note}]` : "";
    const deathLines: (string | S)[] = [
      `${fmtTime(death.atSeconds)}  [DEATH]  ${pid(death.name)} (${death.spec} — friendly)${unusedDefensives}${trinketPart}${notePart}${dampeningSuffix(params.dampeningAt, death.atSeconds)}`,
      // Anchored at the rendered instant: this [RES] sits directly under the
      // [DEATH] line above and carries no timestamp of its own, so a reader
      // (and the gate) can only read it as the same instant as the death.
      // It used to sample T-3s (uncommented, carried in wholesale by the
      // c54d051 port), so if a cooldown came up during those 3 seconds the
      // ledger printed "on cooldown" while the co-second DEATHS WITH MISSED
      // OPTIONS block printed "available" — neither side miscomputed its own
      // instant; the rendering juxtaposed two instants into one.
      // unusedDefensives on the same line and the MISSED OPTIONS block are both
      // evaluated at death.atSeconds, so this aligns with them. 2026-07-20
      // full corpus: 3/1245 matches contradicted themselves because of this.
      // B14a: under a friendly death, a positional cooldown whose holder
      // stood out of its reach of the dying player is not `rdy:`
      requestSnapshotPlaceholder(death.atSeconds, true, true, dyingUnit?.id),
    ];
    if (dyingUnit) {
      // HP trajectory
      const checkpoints = [15, 10, 5, 3, 2, 1];
      const trajectory: string[] = [];
      for (const secondsBefore of checkpoints) {
        // Integer-second grid (floor) and the one sampling radius — the same
        // instants and the same sampler as the [STATE] ticks — so a checkpoint
        // and a co-second STATE line resolve to the SAME advanced sample and
        // can never print different numbers. (The literal 1 500 ms here was a
        // leftover of the second radius deleted on 07-20; 0 of 540 checkpoints
        // on the 60 triage rounds differ under HP_SAMPLE_RADIUS_MS.)
        const pct = getHpPercentAtTime(
          dyingUnit,
          Math.floor(death.atSeconds) - secondsBefore,
          matchStartMs,
          HP_SAMPLE_RADIUS_MS,
        );
        if (pct !== null)
          trajectory.push(`${Math.round(pct)}% at T-${secondsBefore}s`);
      }
      if (trajectory.length > 0) {
        // Triage hp-state F-L1: T is the rendered death second, not the death
        // instant — a reader took "T-5s" of a 1:35.8 death as 1:30.8. (No
        // literal line tag in the wording: scans find death lines by it.)
        deathLines.push(
          `               HP (T = ${fmtTime(death.atSeconds)}, the death line's second): ${trajectory.join(" → ")} → dead`,
        );
      }

      // Top damage sources in final COUNTERFACTUAL_WINDOW_S seconds — same
      // window as the death-recap counterfactual (#17b Task4)/M-1 hardening:
      // uses shared helper to avoid duplication, and the window length is
      // derived from the constant (not a sibling literal) so the caption
      // can't silently drift from the counterfactual math it describes.
      const deathMs = matchStartMs + death.atSeconds * 1000;
      const topSources = getTopDamageSourcesInWindow(
        dyingUnit,
        deathMs,
        COUNTERFACTUAL_WINDOW_S * 1000,
        3,
        playerIdMap,
        enemyIdMap,
        summonOwners,
        unitNames,
        rosterSides,
      );
      if (topSources.length > 0) {
        deathLines.push(
          `               Top damage in final ${COUNTERFACTUAL_WINDOW_S}s: ${topSources.join(", ")}`,
        );
      }
      // B15a step 2: the death fell under the dying unit's own heal absorb
      // (Death Pact) — quote what it ate, the fact its press line carries
      {
        const press = (dyingUnit.spellCastEvents ?? [])
          .filter(
            (c) =>
              c.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
              !!c.spellId &&
              HEAL_ABSORB_SELF_SAVE_IDS.has(c.spellId) &&
              c.logLine.timestamp <= deathMs,
          )
          .sort((a, b) => b.logLine.timestamp - a.logLine.timestamp)[0];
        const use = press
          ? healAbsorbUseOf(
              dyingUnit,
              press.spellId!,
              press.logLine.timestamp,
              deathMs,
              healerCreditOf(Array.from(unitsByName.values()), summonOwners),
            )
          : null;
        if (press && use && use.ended === "death" && use.endMs === deathMs) {
          const numId = (unitId: string): string => {
            const u = allUnitsById.get(unitId);
            const n = u ? playerIdMap?.get(u.name) : undefined;
            return n !== undefined ? String(n) : (u?.name ?? unitId);
          };
          deathLines.push(
            `               ${healAbsorbDeathLine(
              use,
              getEnglishSpellName(press.spellId!, press.spellName ?? ""),
              dyingUnit.id,
              numId,
              (ms) => fmtTime((ms - matchStartMs) / 1000),
            )}`,
          );
        }
      }
      // B15c-U11: the killing blow, only when it was an execute
      const execute = executeKillingBlowOf(dyingUnit, deathMs);
      if (execute) {
        deathLines.push(
          `               Killing blow: ${damageEventLabel(execute, playerIdMap, enemyIdMap, summonOwners)} (an execute)`,
        );
      }

      // Mitigation audit / decisive counterfactual (#17b Task4) — caller
      // (buildMatchContext) already ran Task1's counterfactual.ts functions
      // and formatted the lines via formatMitigationAuditLine /
      // formatDecisiveCounterfactualLine; we just thread + indent them here.
      // Omitted param or empty arrays → no lines (honest-by-default, no
      // placeholder for the silent marginal/fatal tiers).
      if (counterfactualOf) {
        const { auditLines, decisiveLines } = counterfactualOf(
          death.name,
          death.atSeconds,
        );
        for (const line of auditLines)
          deathLines.push(`               ${line}`);
        for (const line of decisiveLines)
          deathLines.push(`               ${line}`);
      }
    }

    addEntry(death.atSeconds, ...deathLines);
  }
}

/**
 * Emits enemy [DEATH] entries: the death line, a [ROSTER] removal line, a deferred
 * resource snapshot, HP trajectory, and top damage sources in the final 10s.
 */
export function emitEnemyDeathEntries<S>(params: {
  enemyDeaths: Array<{ spec: string; name: string; atSeconds: number }>;
  unitsByName: Map<string, ICombatUnit>;
  matchStartMs: number;
  enemyPid: (name: string) => string;
  playerIdMap?: Map<string, number>;
  enemyIdMap?: Map<string, number>;
  /** summon GUID → owner name (`buildSummonOwnerNames`) */
  summonOwners?: ReadonlyMap<string, string>;
  /** unit GUID → roster side (`buildRosterSides`) */
  rosterSides?: RosterSides;
  /** unit GUID → name, to label an attacker known only by id (absorbs) */
  unitNames?: ReadonlyMap<string, string>;
  /** GH #103 A1 (see emitFriendlyDeathEntries): the dampening at the death instant, same getter as the
   * `[CD] … | dampening: N%` lines. Without it the responder quoted the value
   * of a neighbouring line ("died at 3:15 at 66%" — 66% was 3:16's). Omitted,
   * or `null` at that instant (2v2 before the first logged stack) → no
   * suffix. */
  dampeningAt?: (atSeconds: number) => number | null;
  requestSnapshotPlaceholder: (
    timeSeconds: number,
    forceFull?: boolean,
    bypassDebounce?: boolean,
  ) => S;
  addEntry: (timeSeconds: number, ...lines: (string | S)[]) => void;
}): void {
  const {
    enemyDeaths,
    unitsByName,
    matchStartMs,
    enemyPid,
    playerIdMap,
    enemyIdMap,
    summonOwners,
    unitNames,
    rosterSides,
    dampeningAt,
    requestSnapshotPlaceholder,
    addEntry,
  } = params;

  for (const death of enemyDeaths) {
    const dyingUnit = unitsByName.get(death.name);
    const deathLines: (string | S)[] = [
      `${fmtTime(death.atSeconds)}  [DEATH]  ${enemyPid(death.name)} (${death.spec} — enemy)${dampeningSuffix(dampeningAt, death.atSeconds)}`,
      `${fmtTime(death.atSeconds)}  [ROSTER]  enemy ${enemyPid(death.name)} removed (dead)`,
      // Anchored at the rendered instant: this [RES] sits directly under the
      // [DEATH] line above and carries no timestamp of its own, so a reader
      // (and the gate) can only read it as the same instant as the death.
      // It used to sample T-3s (uncommented, carried in wholesale by the
      // c54d051 port), so if a cooldown came up during those 3 seconds the
      // ledger printed "on cooldown" while the co-second DEATHS WITH MISSED
      // OPTIONS block printed "available" — neither side miscomputed its own
      // instant; the rendering juxtaposed two instants into one.
      // unusedDefensives on the same line and the MISSED OPTIONS block are both
      // evaluated at death.atSeconds, so this aligns with them. 2026-07-20
      // full corpus: 3/1245 matches contradicted themselves because of this.
      requestSnapshotPlaceholder(death.atSeconds, true, true),
    ];

    if (dyingUnit) {
      // HP trajectory
      const checkpoints = [15, 10, 5, 3, 2, 1];
      const trajectory: string[] = [];
      for (const secondsBefore of checkpoints) {
        // Integer-second grid (floor) and the one sampling radius — the same
        // instants and the same sampler as the [STATE] ticks — so a checkpoint
        // and a co-second STATE line resolve to the SAME advanced sample and
        // can never print different numbers. (The literal 1 500 ms here was a
        // leftover of the second radius deleted on 07-20; 0 of 540 checkpoints
        // on the 60 triage rounds differ under HP_SAMPLE_RADIUS_MS.)
        const pct = getHpPercentAtTime(
          dyingUnit,
          Math.floor(death.atSeconds) - secondsBefore,
          matchStartMs,
          HP_SAMPLE_RADIUS_MS,
        );
        if (pct !== null)
          trajectory.push(`${Math.round(pct)}% at T-${secondsBefore}s`);
      }
      if (trajectory.length > 0) {
        // Triage hp-state F-L1: T is the rendered death second, not the death
        // instant — a reader took "T-5s" of a 1:35.8 death as 1:30.8. (No
        // literal line tag in the wording: scans find death lines by it.)
        deathLines.push(
          `               HP (T = ${fmtTime(death.atSeconds)}, the death line's second): ${trajectory.join(" → ")} → dead`,
        );
      }

      // Top damage sources in final COUNTERFACTUAL_WINDOW_S seconds — derived
      // from the constant (see friendly-death twin above / M-1 hardening).
      const deathMs = matchStartMs + death.atSeconds * 1000;
      const topSources = getTopDamageSourcesInWindow(
        dyingUnit,
        deathMs,
        COUNTERFACTUAL_WINDOW_S * 1000,
        3,
        playerIdMap,
        enemyIdMap,
        summonOwners,
        unitNames,
        rosterSides,
      );
      if (topSources.length > 0) {
        deathLines.push(
          `               Top damage in final ${COUNTERFACTUAL_WINDOW_S}s: ${topSources.join(", ")}`,
        );
      }
    }

    addEntry(death.atSeconds, ...deathLines);
  }
}

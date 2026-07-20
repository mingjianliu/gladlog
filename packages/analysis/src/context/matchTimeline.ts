import {
  CombatUnitReaction,
  CombatUnitType,
  getUnitType,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import { getEnglishSpellName, spellEffectData } from "../data/spellEffectData";
import { ccSpellIds } from "../data/spellTags";
import { IPlayerCCTrinketSummary } from "../utils/ccTrinketAnalysis";
import {
  IFormInterval,
  ISpiritOfRedemptionInterval,
  IStasisEvent,
} from "../utils/combatStates";
import {
  cdRoleTag,
  findCheaperDefensiveAlternatives,
  fmtTime,
  getUnitHpAtTimestamp,
  IDamageBucket,
  IMajorCooldownInfo,
  isSelfOnlyDefensive,
  isTeamHealCD,
  THROUGHPUT_EMPOWER_DEFENSIVE_IDS,
  specToString,
  hpSampleRadiusMs,
  toRenderSecond,
} from "../utils/cooldowns";
import {
  buildDampeningEvents,
  getDampeningPercentage,
} from "../utils/dampening";
import {
  canDefensiveCleanse,
  canOffensivePurge,
  IDispelEvent,
  IDispelSummary,
  wasRemovedByAllyDispel,
} from "../utils/dispelAnalysis";
import { DISPEL_FEATURE_FLAGS } from "../data/dispelFeatureFlags";
import { extractAoeCCEvents, IOutgoingCCChain } from "../utils/drAnalysis";
import { IEnemyCDTimeline } from "../utils/enemyCDs";
import { computeEnemyInterruptAvailability } from "../utils/enemyInterrupts";
import { IHealingGap } from "../utils/healingGaps";
import { getHpPercentAtTime } from "../utils/killWindowTargetSelection";
import { getInterruptImmunityConditions } from "../utils/talentBehaviors";
import {
  emitDmgSpikeEntries,
  emitEnemyDeathEntries,
  emitFriendlyDeathEntries,
  emitManaMarkerEntries,
  emitRotPressureEntries,
} from "./matchTimelineSections";
import {
  buildResourceSnapshot,
  computeOnCDDisplayNames,
  computeReadyNames,
  ResourceSnapshotParams,
} from "./resourceSnapshot";
import {
  buildKillSequenceBlock,
  buildMatchEndBlock,
  CHANNELED_CD_SPELL_IDS,
  channelWasInterrupted,
  computeHealingInWindow,
  DMG_SPIKE_THRESHOLD,
  extractEnemyMajorBuffIntervals,
  extractOwnerCDBuffExpiry,
  getNpcIdFromGuid,
  getTopDamageSourcesInWindow,
  GROUNDING_TOTEM_NPC_ID,
  CRITICAL_NON_PLAYER_NPC_NAMES,
  HEALER_CAST_SPELL_ID_TO_NAME,
  HEALING_AMPLIFIER_SPELL_IDS,
  HEALING_WINDOW_EARLY_CD_SECONDS,
  HEALING_WINDOW_MIN_HPS,
  isCriticalNonPlayerUnit,
  PASSIVE_SPELL_BLOCKLIST,
  SPELL_DURATION_OVERRIDES,
} from "./timelineHelpers";

interface DeferredSnapshot {
  type: "resource_snapshot";
  timeSeconds: number;
  forceFull: boolean;
  bypassDebounce?: boolean;
  id: number;
}

function isDeferredSnapshot(line: unknown): line is DeferredSnapshot {
  return !!(
    line &&
    typeof line === "object" &&
    "type" in line &&
    line.type === "resource_snapshot"
  );
}

// ── buildMatchTimeline ─────────────────────────────────────────────────────

export interface BuildMatchTimelineParams {
  owner: ICombatUnit;
  ownerSpec: string;
  ownerCDs: IMajorCooldownInfo[];
  teammateCDs: Array<{
    player: ICombatUnit;
    spec: string;
    cds: IMajorCooldownInfo[];
  }>;
  enemyCDTimeline: IEnemyCDTimeline;
  ccTrinketSummaries: IPlayerCCTrinketSummary[];
  dispelSummary: IDispelSummary;
  /** 敌方视角驱散(他们给自己队友解 —— 我方 CC/dot 被解;2026-07-18 覆盖修复)。 */
  enemyDispelSummary?: IDispelSummary;
  /** 每个敌人的受控摘要(我方 CC 落在敌人身上;owner 的已有施法行,渲染时跳过)。 */
  enemyCCSummaries?: IPlayerCCTrinketSummary[];
  friendlyDeaths: Array<{
    spec: string;
    name: string;
    atSeconds: number;
    note?: string;
  }>;
  enemyDeaths: Array<{ spec: string; name: string; atSeconds: number }>;
  pressureWindows: IDamageBucket[];
  healingGaps: IHealingGap[];
  friends: ICombatUnit[];
  /**
   * Enemy player units. When provided, their HP is included in [STATE] ticks
   * alongside friendly HP, referenced by enemyPid() numeric ID.
   */
  enemies?: ICombatUnit[];
  matchStartMs: number;
  matchEndMs: number;
  isHealer: boolean;
  /**
   * Arena bracket string (e.g. '3v3', '2v2'). When provided, final dampening %
   * is included in the [MATCH END] block.
   */
  bracket?: string;
  /**
   * Friendly player name → numeric ID mapping from buildPlayerLoadout.
   * When provided, friendly names are compressed to short IDs in the timeline.
   */
  playerIdMap?: Map<string, number>;
  /**
   * Enemy player name → numeric ID mapping from buildPlayerLoadout.
   * Required alongside playerIdMap to avoid collision when a friendly and enemy
   * share the same display name.
   */
  enemyIdMap?: Map<string, number>;
  /**
   * AoE CC chains cast by friendly players on enemies. When provided,
   * [CC CAST] events are emitted for AoE spells (non-single-target spells).
   */
  outgoingCCChains?: IOutgoingCCChain[];
  /**
   * Override the resource snapshot function injected after each [YOU] [CD] and [TEAM] [CD] event.
   * Defaults to buildResourceSnapshot (text format). Pass buildJsonSituationSnapshot for JSON format.
   */
  resourceSnapshotFn?: (params: ResourceSnapshotParams) => string;
  allUnits?: ICombatUnit[];
  gateCcAvoidanceToDanger?: boolean;
  stasisEvents?: IStasisEvent[];
  shapeshiftIntervals?: Array<{
    player: ICombatUnit;
    intervals: IFormInterval[];
  }>;
  spiritOfRedemptionIntervals?: Array<{
    player: ICombatUnit;
    intervals: ISpiritOfRedemptionInterval[];
  }>;
  stateFormat?: "inline" | "summary" | "verbose";
  /**
   * 关键窗口秒集合 —— 由 buildMatchContext 用 buildCriticalWindowSet 构建后传入。
   * **必填且不在此处自建**:所有 HP 消费者(STATE / DMG SPIKE / CD / 死亡块)
   * 必须共享同一个集合才能取到同一个采样半径,见 criticalWindows.ts。
   */
  criticalWindowSeconds: ReadonlySet<number>;
}

const HIGH_VALUE_PURGEABLE_BUFFS = new Set<string>([
  "10060", // Power Infusion
  "113858", // Dark Soul: Instability
  "113861", // Dark Soul: Misery
  "190319", // Combustion
  "12472", // Icy Veins
  "1022", // Blessing of Protection
  "1044", // Blessing of Freedom
  "198111", // Temporal Shield
  "110909", // Alter Time
]);

export function buildMatchTimeline(params: BuildMatchTimelineParams): string {
  const {
    owner,
    ownerSpec,
    ownerCDs,
    teammateCDs,
    enemyCDTimeline,
    ccTrinketSummaries,
    dispelSummary,
    enemyDispelSummary,
    enemyCCSummaries,
    friendlyDeaths,
    enemyDeaths,
    pressureWindows,
    healingGaps,
    friends,
    enemies,
    allUnits,
    matchStartMs,
    matchEndMs,
    isHealer,
    playerIdMap,
    enemyIdMap,
    outgoingCCChains,
    resourceSnapshotFn,
    bracket,
    gateCcAvoidanceToDanger,
    stasisEvents = [],
    shapeshiftIntervals = [],
    spiritOfRedemptionIntervals = [],
    stateFormat = "summary",
    criticalWindowSeconds: criticalWindowSet,
  } = params;

  const matchDurationS = (matchEndMs - matchStartMs) / 1000;
  const enemyBuffIntervals = extractEnemyMajorBuffIntervals(
    enemies ?? [],
    matchStartMs,
    matchEndMs,
  );

  // criticalWindowSet 由调用方(buildMatchContext)用 buildCriticalWindowSet 构建后
  // 传入 —— 这里刻意不自建,否则 [CD]/死亡块等模块拿不到同一个集合。

  // F143: Pre-calculate Grounding Totem absorbs
  const groundingAbsorbs: Array<{
    timeSeconds: number;
    spellName: string;
    totemOwnerId: string;
  }> = [];
  if (allUnits) {
    for (const unit of allUnits) {
      const npcId = getNpcIdFromGuid(unit.id);
      if (
        (npcId === GROUNDING_TOTEM_NPC_ID ||
          unit.name.toLowerCase().includes("grounding totem")) &&
        unit.ownerId
      ) {
        for (const absorb of unit.absorbsIn) {
          groundingAbsorbs.push({
            timeSeconds: (absorb.timestamp - matchStartMs) / 1000,
            spellName: getEnglishSpellName(
              absorb.spellId ?? "",
              absorb.spellName ?? "Unknown",
            ),
            totemOwnerId: unit.ownerId,
          });
        }
      }
    }
  }

  // F143: returns " [ABSORBED: x, y]" for a Grounding Totem cast by `totemOwnerId` near
  // `castSeconds`, or '' when nothing was absorbed. Matching by spell ID (204336) keeps this
  // locale-independent; the name check is a fallback for logs without a resolved cd.spellId.
  // The 3.5s window covers the totem's short lifetime.
  const GROUNDING_TOTEM_SPELL_ID = "204336";
  const groundingAbsorbNote = (
    spellId: string,
    spellName: string,
    totemOwnerId: string,
    castSeconds: number,
  ): string => {
    if (spellId !== GROUNDING_TOTEM_SPELL_ID && spellName !== "Grounding Totem")
      return "";
    const absorbs = groundingAbsorbs
      .filter(
        (a) =>
          a.totemOwnerId === totemOwnerId &&
          a.timeSeconds >= castSeconds &&
          a.timeSeconds <= castSeconds + 3.5,
      )
      .map((a) => a.spellName);
    if (absorbs.length === 0) return "";
    return ` [ABSORBED: ${Array.from(new Set(absorbs)).join(", ")}]`;
  };

  // A/B cycle-1 accuracy 回归修复:裸数字 id 迫使 responder 跨几千 token 自映射
  // 单位身份,盲评实证细粒度误归因(宠物/单位 HP/驱散方向串)。每个引用内联
  // 紧凑专精标签;同专精双胞胎仍靠 id 消歧。
  function abbrevSpec(spec: string): string {
    const words = spec.split(" ").filter(Boolean);
    if (words.length <= 1) return spec;
    return (
      words
        .slice(0, -1)
        .map((w) => w[0])
        .join("") + words[words.length - 1]
    );
  }
  const nameSpecTag = new Map<string, string>(
    [...friends, ...(enemies ?? [])].map((u) => [
      u.name,
      abbrevSpec(specToString(u.spec)),
    ]),
  );
  function tagFor(name: string): string {
    const tag = nameSpecTag.get(name);
    return tag ? `(${tag})` : "";
  }

  /**
   * Returns the short numeric ID for a friendly player name, or the raw name
   * if no mapping exists.  Enemy names must be resolved via enemyPid() to avoid
   * ID collision when a friendly and enemy share a display name.
   */
  function pid(name: string): string {
    if (!playerIdMap) return name.split("-")[0];
    const id = playerIdMap.get(name) ?? playerIdMap.get(name.split("-")[0]);
    return id !== undefined ? `${id}${tagFor(name)}` : name.split("-")[0];
  }

  /** Returns the short numeric ID for an *enemy* player name, falling back to name. */
  function enemyPid(name: string): string {
    if (!enemyIdMap) return name.split("-")[0];
    const id = enemyIdMap.get(name) ?? enemyIdMap.get(name.split("-")[0]);
    return id !== undefined ? `${id}${tagFor(name)}` : name.split("-")[0];
  }

  /**
   * 施法者标签(CC 行 "(by X)" 用):玩家 → pid/enemyPid;宠物 → 主人标签
   * + "'s pet";无主可查的本地化名(CJK 宠物名等)→ "[pet]"。
   * 与 [KICK] 行的 resolveKicker 同规 —— 2026-07-17 千场 fuzz:猎人宠
   * Intimidation 的 "(by 狂野獠牙)" 泄漏 CJK 宠物名 ×72。
   */
  function actorLabel(name: string, side: "friendly" | "enemy"): string {
    const primary = side === "friendly" ? pid(name) : enemyPid(name);
    if (/^\d/.test(primary)) return primary; // 命中玩家映射(玩家名不会以数字开头)
    const petUnit = allUnits?.find(
      (u) => u.name === name && u.ownerId.length > 0,
    );
    const roster = [...friends, ...(enemies ?? [])];
    const ownerUnit = petUnit
      ? roster.find((u) => u.id === petUnit.ownerId)
      : undefined;
    if (ownerUnit) {
      const label = friends.some((f) => f.id === ownerUnit.id)
        ? pid(ownerUnit.name)
        : enemyPid(ownerUnit.name);
      return `${label}'s pet`;
    }
    const short = name.split("-")[0];
    return [...short].some((c) => c.charCodeAt(0) > 127) ? "[pet]" : short;
  }

  /**
   * Resolves a cast's destUnitName to a display label for [YOU] [CAST] entries.
   * Returns "self" for self-casts, a numeric ID for known players, or the raw name.
   * Returns "" when destUnitName is empty (AoE spells with no specific log target).
   */
  function resolveTarget(destUnitName: string | null | undefined): string {
    if (!destUnitName || destUnitName === "nil") return "";
    const cleanDest = destUnitName.split("-")[0];
    const cleanOwner = owner.name.split("-")[0];
    if (destUnitName === owner.name || cleanDest === cleanOwner) return "self";
    if (playerIdMap) {
      const id = playerIdMap.get(destUnitName) ?? playerIdMap.get(cleanDest);
      if (id !== undefined) return String(id);
    }
    if (enemyIdMap) {
      const id = enemyIdMap.get(destUnitName) ?? enemyIdMap.get(cleanDest);
      if (id !== undefined) return String(id);
    }
    // Unmapped target = totem/pet/NPC (not one of the arena players, who are all
    // pid-mapped above). Its name comes from the log in the client's locale — do
    // not leak a localized (e.g. Chinese) unit name into an English prompt. Cast
    // lines tag [totem/pet] separately, so suppress the name here; ASCII names
    // (rare English-locale NPCs) still pass through unchanged.
    const isLocalized = [...cleanDest].some((ch) => ch.charCodeAt(0) > 127);
    if (isLocalized) return "";
    return cleanDest;
  }

  function getCDTargetAndVelocityPart(
    spellId: string,
    rawTimeSeconds: number,
    targetName: string | undefined,
    overrideHpPct?: number,
    forceSelf = false,
  ): string {
    // 本行的时间戳经 fmtTime 向下取整,而 [STATE] 按整数秒采样 —— 内嵌 HP 必须
    // 查同一时刻,否则同一显示秒下两个 HP 打架(C 类,见 toRenderSecond 的说明)。
    const timeSeconds = toRenderSecond(rawTimeSeconds);
    // B112/B127: self-only defensives (Obsidian Scales, Divine Shield, Ice Block, …) log whatever
    // unit the caster was targeting — often an enemy — as their "target". forceSelf overrides that so
    // the line renders (self) with the caster's own HP, never "→ <enemy>" with that enemy's HP.
    const isSelf =
      forceSelf ||
      !targetName ||
      targetName === "nil" ||
      targetName === owner.name ||
      targetName.split("-")[0] === owner.name.split("-")[0];
    // F139: no owner fallback — it printed the CASTER's own HP as if it were the target's
    // whenever the dest unit wasn't found by exact name.
    const targetUnit = isSelf
      ? owner
      : _allUnits.find((u) => u.name === targetName);

    // H9: the HP-velocity / incoming-DPS trajectory is defensive context (was this ally
    // dying?). It is meaningless — and misleading — for an offensive CD cast on an enemy
    // (e.g. Maim, which is not in ccSpellIds), so skip it when the target is hostile.
    const targetIsEnemy =
      !isSelf && targetUnit?.reaction === CombatUnitReaction.Hostile;

    let velocityStr = "";
    if (targetUnit && !targetIsEnemy && !ccSpellIds.has(spellId)) {
      const hpNow = getUnitHpAtTimestamp(
        targetUnit,
        matchStartMs + timeSeconds * 1000,
        2_000,
      );
      const hpBefore = getUnitHpAtTimestamp(
        targetUnit,
        matchStartMs + (timeSeconds - 2) * 1000,
        2_000,
      );

      // Preceding 2-second lookback window for incoming DPS
      const fromMs = matchStartMs + (timeSeconds - 2) * 1000;
      const toMs = matchStartMs + timeSeconds * 1000;
      const recentDmg = (targetUnit.damageIn || [])
        .filter((d) => d.timestamp >= fromMs && d.timestamp <= toMs)
        .reduce((sum, d) => sum + Math.abs(d.effectiveAmount || d.amount), 0);
      const recentAbs = (targetUnit.absorbsIn || [])
        .filter((a) => a.timestamp >= fromMs && a.timestamp <= toMs)
        .reduce((sum, a) => sum + a.absorbedAmount, 0);
      const incomingDpsK = Math.round((recentDmg + recentAbs) / 2 / 1000);

      if (hpNow !== null && hpBefore !== null) {
        const perSec = (hpNow - hpBefore) / 2;
        const sign = perSec > 0 ? "+" : "";
        velocityStr = `, ${sign}${perSec.toFixed(0)}%/s, ${incomingDpsK}k DPS`;
      } else {
        velocityStr = `, ${incomingDpsK}k DPS`;
      }
    }

    let targetPart = "";
    if (isTeamHealCD(spellId) && (isSelf || targetIsEnemy)) {
      // B136: team-wide healing CDs (Divine Hymn, Restoral, Rewind, Tranquility, …) have no single
      // target, so this line would otherwise render the CASTER's own HP — usually ~100%, which the
      // model reads as a "premature" cast. Show the lowest-HP ally at cast time instead: that is the
      // context these CDs are judged on.
      let lowUnit: ICombatUnit | undefined;
      let lowHp = Infinity;
      for (const u of _allUnits) {
        if (
          u.type !== CombatUnitType.Player ||
          u.reaction !== CombatUnitReaction.Friendly
        )
          continue;
        const hp = getHpPercentAtTime(u, timeSeconds, matchStartMs);
        if (hp !== null && hp < lowHp) {
          lowHp = hp;
          lowUnit = u;
        }
      }
      if (lowUnit) {
        targetPart = ` (team; lowest ally ${lowHp.toFixed(0)}% HP on ${pid(lowUnit.name)})`;
      } else {
        const hpNow = getHpPercentAtTime(owner, timeSeconds, matchStartMs);
        if (hpNow !== null)
          targetPart = ` (self: ${hpNow.toFixed(0)}% HP${velocityStr})`;
      }
    } else if (!isSelf && targetName !== undefined) {
      // F139: resolve by the target's actual reaction — pid() only knows friendlies, so an
      // offensive CD/CC target (an enemy) rendered as a raw name, or as the WRONG friendly id
      // when both teams had a player with the same display name.
      const shortTarget = targetName.split("-")[0];
      const resolved = targetUnit
        ? targetUnit.reaction === CombatUnitReaction.Hostile
          ? enemyPid(targetName)
          : pid(targetName)
        : shortTarget;
      // Totem/pet/NPC targets resolve through the pid fallback to their log
      // name, which is client-localized (根基图腾 leak, locale audit). Known
      // critical NPCs get their English name via npcId; anything else
      // non-ASCII is suppressed. ASCII English names still pass through.
      const npcEnglish = targetUnit
        ? CRITICAL_NON_PLAYER_NPC_NAMES[getNpcIdFromGuid(targetUnit.id) ?? ""]
        : undefined;
      const targetLabel = [...resolved].some((c) => c.charCodeAt(0) > 127)
        ? (npcEnglish ?? "[pet/NPC]")
        : resolved;
      targetPart = ` → ${targetLabel}`;
      const hpPct =
        overrideHpPct ??
        (targetUnit
          ? getHpPercentAtTime(targetUnit, timeSeconds, matchStartMs)?.toFixed(
              0,
            )
          : undefined);
      if (hpPct !== undefined || velocityStr !== "") {
        targetPart += ` (${hpPct ?? "?"}% HP${velocityStr})`;
      }
    } else if (velocityStr !== "") {
      const hpNow = getHpPercentAtTime(owner, timeSeconds, matchStartMs);
      if (hpNow !== null) {
        targetPart = ` (self: ${hpNow.toFixed(0)}% HP${velocityStr})`;
      }
    }
    return targetPart;
  }

  const snapshotFn = resourceSnapshotFn ?? buildResourceSnapshot;

  const matchEndSeconds = (matchEndMs - matchStartMs) / 1000;

  let nextPlaceholderId = 0;
  function requestSnapshotPlaceholder(
    timeSeconds: number,
    forceFull = false,
    bypassDebounce = false,
  ): DeferredSnapshot {
    return {
      type: "resource_snapshot",
      timeSeconds,
      forceFull,
      bypassDebounce,
      id: nextPlaceholderId++,
    };
  }

  const entries: Array<{
    timeSeconds: number;
    lines: (string | DeferredSnapshot)[];
  }> = [];

  function addEntry(
    timeSeconds: number,
    ...lines: (string | DeferredSnapshot)[]
  ) {
    // B103: skip events that fall past match end — they're irrelevant post-game
    // and would appear with timestamps after [MATCH END] confusing the timeline.
    if (timeSeconds > matchEndSeconds) return;

    entries.push({ timeSeconds, lines: lines.filter(Boolean) });
  }

  // ── Dampening Milestone Alerts (F149) ──────────────────────────────────────
  const allPlayers = friends.concat(enemies ?? []);
  const initialDampening = getDampeningPercentage(
    bracket ?? "3v3",
    allPlayers,
    matchStartMs,
  );
  const emittedMilestones = new Set<number>();
  const milestones = [30, 50, 70, 90];

  for (const milestone of milestones) {
    if (initialDampening >= milestone) {
      addEntry(0, `${fmtTime(0)}  [DAMPENING ALERT: ${milestone}%]`);
      emittedMilestones.add(milestone);
    }
  }

  const events = buildDampeningEvents(allPlayers);
  const dampeningEvents = events.map((e) => ({
    timeSeconds: (e.timestamp - matchStartMs) / 1000,
    stacks: e.stacks,
  }));

  for (const milestone of milestones) {
    if (emittedMilestones.has(milestone)) continue;
    const firstCrossing = dampeningEvents.find((e) => e.stacks >= milestone);
    if (firstCrossing) {
      addEntry(
        firstCrossing.timeSeconds,
        `${fmtTime(firstCrossing.timeSeconds)}  [DAMPENING ALERT: ${milestone}%]`,
      );
      emittedMilestones.add(milestone);
    }
  }

  // ── Rot Pressure Detection (F147) ──────────────────────────────────────────
  emitRotPressureEntries({
    allPlayers,
    matchStartMs,
    matchEndMs,
    matchDurationS,
    pid,
    addEntry,
  });

  // ── [OFFENSIVE WINDOW] synthesized headers ─────────────────────────────────

  for (const burst of enemyCDTimeline.alignedBurstWindows) {
    const overlappingSpike = pressureWindows.find(
      (pw) =>
        pw.totalDamage >= DMG_SPIKE_THRESHOLD &&
        pw.fromSeconds >= burst.fromSeconds - 5 &&
        pw.fromSeconds <= burst.toSeconds + 5,
    );
    if (!overlappingSpike) continue;
    const dmgM = (overlappingSpike.totalDamage / 1_000_000).toFixed(2);
    // 每个 CD 带实际施放时刻——窗口是并集,无时刻列表被读成起点同时全开(059)
    const cdNames = burst.activeCDs
      .map((c) => `${c.spellName}@${fmtTime(c.castSeconds)}`)
      .join(" + ");
    addEntry(
      burst.fromSeconds,
      `${fmtTime(burst.fromSeconds)}  [OFFENSIVE WINDOW]   ${fmtTime(burst.fromSeconds)}–${fmtTime(burst.toSeconds)} | ${dmgM}M on ${pid(overlappingSpike.targetName)} (${overlappingSpike.targetSpec}) | CDs: ${cdNames}`,
    );
  }

  // ── [DEATH] events ────────────────────────────────────────────────────────

  const unitsByName = new Map(
    [...friends, ...(enemies ?? [])].map((u) => [u.name, u]),
  );

  emitFriendlyDeathEntries({
    friendlyDeaths,
    unitsByName,
    ccTrinketSummaries,
    owner,
    ownerCDs,
    teammateCDs,
    matchStartMs,
    pid,
    playerIdMap,
    enemyIdMap,
    requestSnapshotPlaceholder,
    addEntry,
  });

  emitEnemyDeathEntries({
    enemyDeaths,
    unitsByName,
    matchStartMs,
    enemyPid,
    playerIdMap,
    enemyIdMap,
    requestSnapshotPlaceholder,
    addEntry,
  });

  // ── [UNIT DESTROYED] Non-Player Deaths ────────────────────────────────────

  if (allUnits) {
    for (const unit of allUnits) {
      if (
        unit.deathRecords &&
        unit.deathRecords.length > 0 &&
        isCriticalNonPlayerUnit(unit)
      ) {
        const reactionStr =
          unit.reaction === CombatUnitReaction.Friendly
            ? "Friendly"
            : unit.reaction === CombatUnitReaction.Hostile
              ? "Enemy"
              : "Unknown";
        for (const deathRecord of unit.deathRecords) {
          const atSeconds = (deathRecord.timestamp - matchStartMs) / 1000;
          const durationS = (matchEndMs - matchStartMs) / 1000;
          if (atSeconds > durationS) continue; // Match End cleanup suppression

          const deathLines: string[] = [
            `${fmtTime(atSeconds)}  [UNIT DESTROYED]   ${CRITICAL_NON_PLAYER_NPC_NAMES[getNpcIdFromGuid(unit.id) ?? ""] ?? unit.name} (${reactionStr})`,
          ];

          const topSources = getTopDamageSourcesInWindow(
            unit,
            deathRecord.timestamp,
            10_000,
            2,
            playerIdMap,
            enemyIdMap,
          );
          if (topSources.length > 0) {
            deathLines[0] += ` killed by: ${topSources.join(", ")}`;
          }

          addEntry(atSeconds, ...deathLines);
        }
      }
    }
  }

  // ── [YOU] [CD] events ───────────────────────────────────────────────────────

  // F114 (Variant C): precompute which amplifier-spell casts get a [HEALING] block.
  // Per spell, emit only the first eligible cast and the worst subsequent eligible
  // cast (score = overhealPct * 1000 - maxBucketHps; higher = worse). Casts
  // suppressed by the early-low-activity gate are never eligible.
  const healingEmissionTimes = new Map<string, Set<number>>();
  for (const cd of ownerCDs) {
    if (!HEALING_AMPLIFIER_SPELL_IDS.has(cd.spellId)) continue;
    const duration = spellEffectData[cd.spellId]?.durationSeconds;
    if (!duration) continue;
    const eligible: { timeSeconds: number; score: number }[] = [];
    for (const cast of cd.casts) {
      const fromMs = matchStartMs + cast.timeSeconds * 1000;
      const toMs = fromMs + duration * 1000;
      const healStats = computeHealingInWindow(owner.healOut, fromMs, toMs);
      const maxBucketHps = healStats
        ? Math.max(...healStats.buckets.map((b) => b.hps))
        : 0;
      const isEarlyLowActivity =
        cast.timeSeconds < HEALING_WINDOW_EARLY_CD_SECONDS &&
        maxBucketHps < HEALING_WINDOW_MIN_HPS;
      if (isEarlyLowActivity) continue;
      const score = (healStats?.overhealPct ?? 0) * 1000 - maxBucketHps;
      eligible.push({ timeSeconds: cast.timeSeconds, score });
    }
    if (eligible.length === 0) continue;
    const emit = new Set<number>([eligible[0].timeSeconds]);
    if (eligible.length > 1) {
      let worstIdx = 1;
      for (let i = 2; i < eligible.length; i++) {
        if (eligible[i].score > eligible[worstIdx].score) worstIdx = i;
      }
      emit.add(eligible[worstIdx].timeSeconds);
    }
    healingEmissionTimes.set(cd.spellId, emit);
  }

  const _allUnits = allUnits ?? [...friends, ...(enemies ?? [])];

  const cdExpiryEvents = extractOwnerCDBuffExpiry(
    ownerCDs,
    owner.id,
    friends,
    matchStartMs,
  );

  // H13: computed once — used to confirm early-ended channels were a real kick/CC, not a
  // self-cancel/movement, without recomputing the find() per cast.
  const ownerCCSummary = ccTrinketSummaries.find(
    (s) => s.playerName === owner.name,
  );

  // B145: an action taken while the owner is hard-CC'd (stun/incap) is NOT a free choice — the game
  // allowed it because it was a usable-while-stunned defensive, a PvP trinket, or an immune channel
  // (verified against raw logs: e.g. Emerald Communion channels through a full Hammer of Justice stun).
  // Tag [YOU] [CD]/[CAST] lines with the CC so the model reads a forced/immune action as such rather
  // than judging its timing as elective.
  const CC_VERB: Record<string, string> = {
    Stun: "stunned",
    Incapacitate: "incapacitated",
  };
  function ownerHardCcTagAt(timeSeconds: number): string {
    if (!ownerCCSummary) return "";
    for (const cc of ownerCCSummary.ccInstances) {
      const verb = cc.drInfo ? CC_VERB[cc.drInfo.category] : undefined;
      if (!verb) continue;
      if (
        timeSeconds > cc.atSeconds &&
        timeSeconds < cc.atSeconds + cc.durationSeconds
      ) {
        return ` [while ${verb}: ${cc.spellName}]`;
      }
    }
    return "";
  }

  // B139: interrupt/silence-immunity windows granted by the owner's PvP talents (Obsidian Mettle → Obsidian
  // Scales, Zen Focus Tea → Thunder Focus Tea). Each is a passive with no marker aura gated on a normal CD
  // aura, so it's driven by the talentBehaviors catalog (gated on pvpTalents). Used to correct the "enemy
  // interrupts UP" note on the owner's channels — a kick that cannot land is not a risk.
  const interruptImmunityConditions = getInterruptImmunityConditions(
    owner.info?.pvpTalents,
  );
  const interruptImmuneWindows: Array<{
    from: number;
    to: number;
    reason: string;
  }> = [];
  for (const cond of interruptImmunityConditions) {
    const reason = cond.conditionName
      ? `${cond.name} + ${cond.conditionName}`
      : cond.name;
    let openFrom: number | null = null;
    for (const a of owner.auraEvents ?? []) {
      if (a.spellId !== cond.conditionAuraId) continue;
      if (
        a.logLine.event === LogEvent.SPELL_AURA_APPLIED ||
        a.logLine.event === LogEvent.SPELL_AURA_REFRESH
      ) {
        if (openFrom === null) openFrom = a.timestamp;
      } else if (
        a.logLine.event === LogEvent.SPELL_AURA_REMOVED &&
        openFrom !== null
      ) {
        interruptImmuneWindows.push({
          from: openFrom,
          to: a.timestamp,
          reason,
        });
        openFrom = null;
      }
    }
    if (openFrom !== null)
      interruptImmuneWindows.push({ from: openFrom, to: matchEndMs, reason });
  }
  function ownerInterruptImmuneReasonAt(
    timeSeconds: number,
  ): string | undefined {
    if (interruptImmuneWindows.length === 0) return undefined;
    const ms = matchStartMs + timeSeconds * 1000;
    return interruptImmuneWindows.find((w) => ms >= w.from && ms <= w.to)
      ?.reason;
  }

  for (const cd of ownerCDs) {
    // B112/B127: a big personal defensive that cannot be cast on an ally is self-only — force (self)
    // rendering so a self-buff (e.g. Obsidian Scales) logged against the caster's current enemy/ally
    // target is not shown as "→ <unit>" with that unit's HP.
    const forceSelf = isSelfOnlyDefensive(cd.spellId);
    for (const cast of cd.casts) {
      const targetPart = getCDTargetAndVelocityPart(
        cd.spellId,
        cast.timeSeconds,
        cast.targetName,
        cast.targetHpPct,
        forceSelf,
      );

      const isCC = ccSpellIds.has(cd.spellId);
      const extraLines: (string | DeferredSnapshot)[] = [
        // T3: Δ 形式(此前非 CC 强制全量,是 [RES] token 主要来源;全量保留给死亡快照与 60s 定期刷新)
        requestSnapshotPlaceholder(cast.timeSeconds),
      ];

      if (
        HEALING_AMPLIFIER_SPELL_IDS.has(cd.spellId) &&
        healingEmissionTimes.get(cd.spellId)?.has(cast.timeSeconds)
      ) {
        const duration = spellEffectData[cd.spellId]?.durationSeconds;
        if (duration) {
          const fromMs = matchStartMs + cast.timeSeconds * 1000;
          const toMs = fromMs + duration * 1000;
          const healStats = computeHealingInWindow(owner.healOut, fromMs, toMs);
          if (healStats) {
            const bucketParts = healStats.buckets.map(
              (b) =>
                `${b.fromSeconds}–${b.toSeconds}s: ${(b.hps / 1000).toFixed(1)}k HPS`,
            );
            extraLines.push(
              `      [HEALING]    ${bucketParts.join(" | ")} | Overheal: ${healStats.overhealPct}%`,
            );
          } else {
            extraLines.push(
              `      [HEALING]    No healing logged during this window`,
            );
          }
        }
      }

      const prefix = ccSpellIds.has(cd.spellId) ? "[YOU] [CC]" : "[YOU] [CD]";
      const groundingNote = groundingAbsorbNote(
        cd.spellId,
        cd.spellName,
        owner.id,
        cast.timeSeconds,
      );

      let dampeningNote = "";
      if (!isCC) {
        dampeningNote = ` | dampening: ${getDampeningPercentage(params.bracket ?? "3v3", _allUnits, matchStartMs + cast.timeSeconds * 1000)}%`;
        // pressureWindows is sorted by totalDamage descending (see computePressureWindows),
        // so Array.find() would return the biggest future spike rather than the nearest one.
        // Select by minimum fromSeconds among qualifying spikes instead of relying on order.
        const qualifyingSpikes = pressureWindows.filter(
          (pw) =>
            pw.fromSeconds >= cast.timeSeconds &&
            pw.totalDamage >= DMG_SPIKE_THRESHOLD,
        );
        const nextSpike = qualifyingSpikes.reduce<IDamageBucket | undefined>(
          (nearest, pw) =>
            nearest === undefined || pw.fromSeconds < nearest.fromSeconds
              ? pw
              : nearest,
          undefined,
        );
        if (nextSpike) {
          dampeningNote += `, next spike in ${Math.round(nextSpike.fromSeconds - cast.timeSeconds)}s on ${pid(nextSpike.targetName)}`;
        }
      }

      // F166: "cheaper-tool-available" tag — if a shorter-CD defensive was available, flag it.
      // Throughput CDs (e.g. Power Infusion) are excluded by findCheaperDefensiveAlternatives.
      // H11: when this cast was an external thrown on a teammate, only suggest alternatives
      // that can themselves target a teammate — a self-only tool (e.g. Barkskin) can't help.
      let cheaperNote = "";
      if (
        !isCC &&
        cd.tag === "Defensive" &&
        !THROUGHPUT_EMPOWER_DEFENSIVE_IDS.has(cd.spellId)
      ) {
        // B142: a team/raid heal (Divine Hymn, Tranquility, …) covers an injured ALLY, so a
        // self-only tool (Desperate Prayer, Frenzied Regeneration) can't substitute for it — treat it
        // like an external cast so only team-capable alternatives are offered (extends the H11 guard).
        const castTargetIsTeammate =
          isTeamHealCD(cd.spellId) ||
          (!!cast.targetName &&
            cast.targetName !== "nil" &&
            cast.targetName.split("-")[0] !== owner.name.split("-")[0]);
        const cheaperAvailable = findCheaperDefensiveAlternatives(
          cd,
          ownerCDs,
          cast.timeSeconds,
          {
            castTargetIsTeammate,
          },
        );
        if (cheaperAvailable.length > 0) {
          cheaperNote = ` | cheaper available: ${cheaperAvailable.join(", ")}`;
        }
      }

      let channelSuffix = "";
      if (CHANNELED_CD_SPELL_IDS.has(cd.spellId)) {
        const expiry = cdExpiryEvents.find(
          (e) =>
            e.spellId === cd.spellId &&
            Math.abs(e.castAtSeconds - cast.timeSeconds) < 0.01,
        );
        if (expiry) {
          const expectedDuration =
            SPELL_DURATION_OVERRIDES[cd.spellId] ||
            spellEffectData[cd.spellId]?.durationSeconds ||
            0;
          const actualDuration = expiry.expiresAtSeconds - cast.timeSeconds;
          if (expiry.isEstimated) {
            channelSuffix = ` (estimated duration: ${expectedDuration.toFixed(1)}s)`;
          } else if (actualDuration < expectedDuration - 0.2) {
            // C1: a short channel may be a kick, a self-cancel, or movement — the aura
            // lifetime alone can't tell us which.
            // H13: when a real kick (interruptInstance) or control-CC (ccInstance) landed
            // on the caster during the channel window, we can confirm it was an interrupt
            // and say so positively. Otherwise keep the neutral "channeled X of Y" wording.
            const interrupted = channelWasInterrupted(
              ownerCCSummary,
              cast.timeSeconds,
              cast.timeSeconds + actualDuration,
            );
            // B141: this entry is stamped at the channel START (the decision point). State the END
            // time inline so the model judges "premature vs reactive" without inferring it from the
            // separate [BUFF FADED] line or misreading the start-stamp as the completion.
            const channelEnd = fmtTime(cast.timeSeconds + actualDuration);
            channelSuffix = interrupted
              ? ` (interrupted at ${actualDuration.toFixed(1)}s / ${expectedDuration.toFixed(1)}s, ended ${channelEnd})`
              : ` (channeled ${actualDuration.toFixed(1)}s of ${expectedDuration.toFixed(1)}s, ended ${channelEnd})`;
          } else {
            channelSuffix = ` (channeled ${actualDuration.toFixed(1)}s to completion, ended ${fmtTime(
              cast.timeSeconds + actualDuration,
            )})`;
          }
        }
      }
      // B113/B130: append a role tag for throughput/mana/modifier CDs so the model does not invent
      // a mechanic (e.g. "Restoral breaks stuns") for a CD it otherwise sees only as a [YOU] [CD] cast.
      const ownerRole = cdRoleTag(cd.spellId);
      const roleSuffix = ownerRole ? ` [${ownerRole}]` : "";
      const displayNameWithChannel = `${cd.spellName}${roleSuffix}${channelSuffix}`;

      // B128: for the owner's CHANNELED CDs, state whether any enemy had an interrupt available at the
      // cast — so the model can decide "was this a lockout reaction" and "would this have been kicked"
      // instead of guessing. A completed channel with kicks up is skill; an interrupted one with all
      // kicks down was not a kick.
      let interruptNote = "";
      if (
        CHANNELED_CD_SPELL_IDS.has(cd.spellId) &&
        enemies &&
        enemies.length > 0
      ) {
        const immuneReason = ownerInterruptImmuneReasonAt(cast.timeSeconds);
        if (immuneReason) {
          // B139: kicks can't land — a PvP talent grants interrupt/silence immunity here.
          interruptNote = ` | interrupt-immune (${immuneReason})`;
        } else {
          const states = computeEnemyInterruptAvailability(
            enemies,
            matchStartMs + cast.timeSeconds * 1000,
          );
          const upKicks = states.filter((s) => s.cdRemainingSeconds === 0);
          if (upKicks.length > 0) {
            interruptNote = ` | enemy interrupts UP: ${upKicks.map((s) => `${s.spellName}/${s.spec}`).join(", ")}`;
          } else if (states.length > 0) {
            interruptNote = " | no enemy interrupt available (all on CD)";
          }
        }
      }

      addEntry(
        cast.timeSeconds,
        `${fmtTime(cast.timeSeconds)}  ${prefix}   ${displayNameWithChannel}${targetPart}${dampeningNote}${cheaperNote}${groundingNote}${interruptNote}${ownerHardCcTagAt(cast.timeSeconds)}`,
        ...extraLines,
      );
    }
  }

  // ── [BUFF FADED] events (F70, B31: renamed from [CD EXPIRED]) ──────────────
  for (const expiry of cdExpiryEvents) {
    // B129: tag the fade cause so the model does not invent a dispel for a buff that simply expired,
    // and can tell a consumed absorb (ended early) from an expired one. "(estimated)" is retained for
    // expiries inferred from duration (no removal event logged).
    const causeNote =
      expiry.cause === "ended_early"
        ? " (ended early — absorbed, dispelled, or cancelled)"
        : expiry.isEstimated
          ? " (expired, estimated)"
          : " (expired)";
    addEntry(
      expiry.expiresAtSeconds,
      `${fmtTime(expiry.expiresAtSeconds)}  [BUFF FADED]   ${expiry.spellName}${causeNote}`,
    );
  }

  // ── [YOU] [CAST] healer gap-filler (F61) ────────────────────────────────────

  if (isHealer) {
    const trackedCastsBySpellId = new Map<string, Set<number>>();
    for (const cd of ownerCDs) {
      trackedCastsBySpellId.set(
        cd.spellId,
        new Set(
          cd.casts.map((c) => matchStartMs + Math.round(c.timeSeconds * 1000)),
        ),
      );
    }
    const trinketUseTimesMs = new Set(
      ccTrinketSummaries.flatMap((s) =>
        s.trinketUseTimes.map((t) => Math.round(matchStartMs + t * 1000)),
      ),
    );

    // F68/B32: flat list of CC events targeting the owner only (not teammates).
    // B32 fix: restrict disambiguation annotations to CCs that hit the caster,
    // not CCs that hit teammates at a similar timestamp.
    const ownerCCMsTimestamps: number[] = ccTrinketSummaries
      .filter((s) => s.playerName === owner.name)
      .flatMap((s) =>
        s.ccInstances.map((cc) =>
          Math.round(matchStartMs + cc.atSeconds * 1000),
        ),
      );

    // F159: Track owner's successful offensive purges
    // F163: Filter out low/medium priority purges to de-noise the timeline
    const ownerPurges = dispelSummary.ourPurges.filter(
      (p) =>
        p.sourceName === owner.name &&
        (p.priority === "Critical" || p.priority === "High"),
    );

    const seenCasts: Array<{
      name: string;
      target: string;
      timeSeconds: number;
    }> = [];

    let activeFold: {
      displayName: string;
      targetLabel: string;
      startTimeSeconds: number;
      count: number;
    } | null = null;

    const flushFold = () => {
      if (!activeFold) return;
      const { displayName, targetLabel, startTimeSeconds, count } = activeFold;
      const targetPart = targetLabel ? ` → ${targetLabel}` : "";
      const countPart = count > 1 ? ` (x${count})` : "";
      addEntry(
        startTimeSeconds,
        `${fmtTime(startTimeSeconds)}  [YOU] [CAST]   ${displayName}${countPart}${targetPart}`,
      );
      activeFold = null;
    };

    // T-noise A/B (2026-07-15): high-frequency filler casts (Soothing Mist,
    // Crackling Jade Lightning, …) dominated template-duplicate lines corpus-
    // wide (42% of all lines). Spells cast ≥ SPAM_FOLD_THRESHOLD times fold
    // into windowed run-lines that survive interleaved entries and critical
    // windows (entries are time-sorted at assembly, so a fold line emitted at
    // its start second renders chronologically).
    const SPAM_FOLD_THRESHOLD = 12;
    const SPAM_FOLD_MAX_GAP_SECONDS = 30;
    const ownerCastCountByName = new Map<string, number>();
    for (const e of owner.spellCastEvents ?? []) {
      if (e.logLine.event !== LogEvent.SPELL_CAST_SUCCESS || !e.spellId)
        continue;
      const n =
        HEALER_CAST_SPELL_ID_TO_NAME[e.spellId] ??
        getEnglishSpellName(e.spellId, e.spellName);
      if (!n) continue;
      ownerCastCountByName.set(n, (ownerCastCountByName.get(n) ?? 0) + 1);
    }
    const spamFolds = new Map<
      string,
      {
        startTimeSeconds: number;
        lastTimeSeconds: number;
        count: number;
        targets: Set<string>;
      }
    >();
    const flushSpamFold = (displayName: string) => {
      const f = spamFolds.get(displayName);
      if (!f) return;
      spamFolds.delete(displayName);
      const target =
        f.targets.size === 1
          ? [...f.targets][0]
          : f.targets.size > 1
            ? "various"
            : "";
      const targetPart = target ? ` → ${target}` : "";
      const spanSeconds = Math.round(f.lastTimeSeconds - f.startTimeSeconds);
      const countPart =
        f.count > 1
          ? ` (x${f.count}${spanSeconds > 0 ? ` over ${spanSeconds}s` : ""})`
          : "";
      addEntry(
        f.startTimeSeconds,
        `${fmtTime(f.startTimeSeconds)}  [YOU] [CAST]   ${displayName}${countPart}${targetPart}`,
      );
    };

    // T-noise A/B (2026-07-15): channeled CDs re-fire SPELL_CAST_SUCCESS per
    // tick under a different spellId but the same name (Divine Hymn 0:49 +
    // 0:50 + 0:51 …). The [CD] line already states the channel span, so tick
    // [CAST] lines are pure duplication — suppress same-name casts within a
    // short window after a tracked-CD cast (≥30s CDs cannot genuinely recast
    // that fast).
    const CHANNEL_TICK_SUPPRESS_SECONDS = 10;
    const trackedCastTimesByName = new Map<string, number[]>();
    for (const [spellId, times] of trackedCastsBySpellId) {
      const n = getEnglishSpellName(spellId, undefined);
      if (!n) continue;
      const arr = trackedCastTimesByName.get(n) ?? [];
      for (const t of times) arr.push((t - matchStartMs) / 1000);
      trackedCastTimesByName.set(n, arr);
    }

    for (const e of owner.spellCastEvents ?? []) {
      if (e.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      if (!e.spellId) continue;
      const englishName = getEnglishSpellName(e.spellId, e.spellName);
      if (e.spellName && PASSIVE_SPELL_BLOCKLIST.has(e.spellName)) continue;

      const displayName =
        HEALER_CAST_SPELL_ID_TO_NAME[e.spellId] ?? englishName;
      if (!displayName) continue;
      const tsMs = e.logLine.timestamp;
      const trackedSet = trackedCastsBySpellId.get(e.spellId);
      if (
        trackedSet &&
        (trackedSet.has(tsMs) ||
          trackedSet.has(tsMs - 1000) ||
          trackedSet.has(tsMs + 1000))
      )
        continue;
      if (
        trinketUseTimesMs.has(tsMs) ||
        trinketUseTimesMs.has(tsMs - 1000) ||
        trinketUseTimesMs.has(tsMs + 1000)
      )
        continue;
      const timeSeconds = (tsMs - matchStartMs) / 1000;

      // Channel-tick suppression: same-name success within 10s after a
      // tracked-CD cast is a channel tick (different spellId, so the ±1s
      // trackedSet check above misses it); the [CD] line already carries the
      // channel span.
      const trackedTimes = trackedCastTimesByName.get(displayName);
      if (
        trackedTimes?.some(
          (t) =>
            timeSeconds - t > 0 &&
            timeSeconds - t <= CHANNEL_TICK_SUPPRESS_SECONDS,
        )
      )
        continue;

      let stasisAnnotation = "";
      const activeStasis = stasisEvents.find(
        (s) => timeSeconds >= s.startSeconds && timeSeconds < s.releaseSeconds,
      );
      if (activeStasis && activeStasis.spells.includes(displayName)) {
        if (stateFormat === "summary") {
          continue; // Suppress buffered heals in summary mode
        } else if (stateFormat === "inline") {
          stasisAnnotation = " [STASIS STORED]";
        }
      }

      // F68/F89/B32: find nearest CC *on the owner* within 1s — annotate ordering
      // so Claude knows the cast completed before or after incoming CC.
      // B32: only match CCs targeting the log owner, not teammates.
      const CC_PROXIMITY_MS = 1000;
      let nearestCC: number | undefined;
      let minDiff = Infinity;
      for (const ccMs of ownerCCMsTimestamps) {
        const diff = Math.abs(ccMs - tsMs);
        if (diff <= CC_PROXIMITY_MS && diff < minDiff) {
          minDiff = diff;
          nearestCC = ccMs;
        }
      }
      let orderNote = "";
      if (nearestCC !== undefined) {
        if (tsMs < nearestCC) {
          // "succeeded", not "completed": SPELL_CAST_SUCCESS fires at channel
          // START for channeled spells, so a channel broken by this very CC
          // carried both "[completed before CC landed]" and "interrupted at
          // 0.1s" — a direct self-contradiction at pivotal moments (invariant
          // sweep I3, flagged independently by 4+ blind judges).
          orderNote = " [cast succeeded before CC landed]";
        } else if (tsMs > nearestCC) {
          orderNote = " [succeeded after CC arrived — within 1s in log]";
        } else {
          orderNote = " [same server tick as CC — cast succeeded per log]";
        }
      }

      const targetLabel = resolveTarget(e.destUnitName);

      // B21: Dedup same-target, same-name casts within a 0.5s sliding window
      // Prevents arbitrary second-flooring boundaries (Math.floor) from over-collapsing or under-collapsing.
      const isDuplicate = seenCasts.some(
        (c) =>
          c.name === displayName &&
          c.target === targetLabel &&
          Math.abs(c.timeSeconds - timeSeconds) <= 0.5,
      );
      if (isDuplicate) continue;

      seenCasts.push({ name: displayName, target: targetLabel, timeSeconds });

      const targetPart = targetLabel ? ` → ${targetLabel}` : "";
      const destType = getUnitType(e.destUnitFlags ?? 0);
      let totemNote = "";
      if (
        destType === CombatUnitType.Guardian ||
        destType === CombatUnitType.Pet
      ) {
        // B44: distinguish Grounding Totem absorption (wasted cast) from other totem/pet
        // targets. Detect by npcId from the dest GUID (locale-independent — the unit NAME
        // is client-localized and the English substring check misses on non-EN logs),
        // keeping the name check as fallback for GUID-less events.
        const destIsGroundingTotem =
          getNpcIdFromGuid(e.destUnitId ?? "") === GROUNDING_TOTEM_NPC_ID ||
          (e.destUnitName?.toLowerCase().includes("grounding totem") ?? false);
        totemNote = destIsGroundingTotem
          ? " [absorbed: Grounding Totem]"
          : " [totem/pet]";
      }

      // F159 / M-i: Annotate offensive-purge casts with the removed buff.
      // The old ±0.5s proximity window was too loose: two distinct purges landing within
      // half a second of each other could cross-attach (a cast annotated with the OTHER
      // purge's removed buff, or both buffs joined onto both casts). Mirror the B11 fix in
      // dispelAnalysis.wasRemovedByAllyDispel — tighten to a 50ms window AND key the match
      // on the cast target (raw destUnitName) so only the buff removed at essentially the
      // same instant on the same target is attached. join(', ') then only fires when one
      // cast genuinely removed multiple buffs at once.
      const PURGE_MATCH_TOLERANCE_SECONDS = 0.05;
      let purgeNote = "";
      const matchingPurges = ownerPurges.filter(
        (p) =>
          p.targetName === e.destUnitName &&
          Math.abs(p.timeSeconds - timeSeconds) <=
            PURGE_MATCH_TOLERANCE_SECONDS,
      );
      if (matchingPurges.length > 0) {
        const removedNames = matchingPurges
          .map((p) => p.removedSpellName)
          .join(", ");
        purgeNote = ` [removed: ${removedNames}]`;
      }

      // F95: Offensive CC casts should carry a CC annotation or use an [YOU] [CC] prefix.
      if (ccSpellIds.has(e.spellId)) {
        flushFold();
        addEntry(
          timeSeconds,
          `${fmtTime(timeSeconds)}  [YOU] [CC]   ${displayName}${targetPart}${totemNote}${orderNote}${purgeNote}`,
          requestSnapshotPlaceholder(timeSeconds),
        );
        continue;
      }

      // B38: promote major-CD spells (CD ≥ 30s) to [YOU] [CD] format when extractMajorCooldowns
      // missed them (e.g. missing talent data). This keeps Avenging Crusader etc. from appearing
      // as filler casts when they are significant cooldown activations.
      const effectData = spellEffectData[e.spellId];
      const cdSeconds =
        effectData?.cooldownSeconds ??
        effectData?.charges?.chargeCooldownSeconds ??
        0;
      if (cdSeconds >= 30) {
        flushFold();
        // B112/B127: apply the same self-only override here (this promotion path is where MW/Evoker
        // throughput CDs render). B113/B130: append the role tag so the model does not invent mechanics.
        const promotedTargetPart = getCDTargetAndVelocityPart(
          e.spellId,
          timeSeconds,
          e.destUnitName,
          undefined,
          isSelfOnlyDefensive(e.spellId),
        );
        const promotedRole = cdRoleTag(e.spellId);
        const promotedDisplayName = promotedRole
          ? `${displayName} [${promotedRole}]`
          : displayName;
        addEntry(
          timeSeconds,
          `${fmtTime(timeSeconds)}  [YOU] [CD]   ${promotedDisplayName}${promotedTargetPart}${totemNote}${stasisAnnotation}${purgeNote}${ownerHardCcTagAt(timeSeconds)}`,
          // T3: Δ 形式(同 ownerCDs 路径;全量保留给死亡快照与 60s 定期刷新)
          requestSnapshotPlaceholder(timeSeconds),
        );
        continue;
      }

      const hasAnnotation =
        totemNote !== "" ||
        orderNote !== "" ||
        stasisAnnotation !== "" ||
        purgeNote !== "";

      // Spam-spell windowed fold: high-frequency fillers fold across
      // interleaved entries AND inside critical windows — per-cast lines for
      // a spell hit ≥12×/match carry no per-instance signal, only tokens.
      // Annotated casts still render individually (the annotation is the
      // signal) without breaking the running fold.
      if (
        !hasAnnotation &&
        (ownerCastCountByName.get(displayName) ?? 0) >= SPAM_FOLD_THRESHOLD
      ) {
        const f = spamFolds.get(displayName);
        if (f && timeSeconds - f.lastTimeSeconds <= SPAM_FOLD_MAX_GAP_SECONDS) {
          f.count++;
          f.lastTimeSeconds = timeSeconds;
          if (targetLabel) f.targets.add(targetLabel);
        } else {
          flushSpamFold(displayName);
          spamFolds.set(displayName, {
            startTimeSeconds: timeSeconds,
            lastTimeSeconds: timeSeconds,
            count: 1,
            targets: new Set(targetLabel ? [targetLabel] : []),
          });
        }
        continue;
      }

      // F151 Repetitive Cast Folding:
      // Simple casts outside critical windows are foldable.
      const isFoldable =
        !hasAnnotation && !criticalWindowSet.has(Math.floor(timeSeconds));

      if (isFoldable) {
        if (
          activeFold &&
          activeFold.displayName === displayName &&
          activeFold.targetLabel === targetLabel
        ) {
          activeFold.count++;
        } else {
          flushFold();
          activeFold = {
            displayName,
            targetLabel,
            startTimeSeconds: timeSeconds,
            count: 1,
          };
        }
      } else {
        flushFold();
        addEntry(
          timeSeconds,
          `${fmtTime(timeSeconds)}  [YOU] [CAST]   ${displayName}${targetPart}${totemNote}${orderNote}${stasisAnnotation}${purgeNote}`,
        );
      }
    }

    // Flush any remaining active folds at loop end
    flushFold();
    for (const name of [...spamFolds.keys()]) flushSpamFold(name);
  }

  // ── [TEAM] [CD] events ────────────────────────────────────────────────────

  for (const { player, spec, cds } of teammateCDs) {
    for (const cd of cds) {
      const isCC = ccSpellIds.has(cd.spellId);
      for (const cast of cd.casts) {
        const groundingNote = groundingAbsorbNote(
          cd.spellId,
          cd.spellName,
          player.id,
          cast.timeSeconds,
        );

        // B112(a): "[TEAM] [CC] N (Spec): X" was misread as teammate N BEING CC'd. It is actually N
        // CASTING an offensive CC on an enemy — render it in active voice ("cast") with the enemy
        // target so the caster is never confused with the victim. [TEAM] [CD] (buffs/defensives on
        // self) keeps the ": X" form.
        let line: string;
        if (isCC) {
          const tgtLabel =
            cast.targetName && cast.targetName !== "nil"
              ? enemyPid(cast.targetName)
              : "";
          // Suppress localized (non-ASCII) totem/pet/NPC target names — never leak
          // a client-locale unit name into the English prompt.
          const tgt =
            tgtLabel && ![...tgtLabel].some((c) => c.charCodeAt(0) > 127)
              ? ` → ${tgtLabel}`
              : "";
          line = `${fmtTime(cast.timeSeconds)}  [TEAM] [CC]   ${pid(player.name)} (${spec}) cast ${cd.spellName}${tgt}${groundingNote}`;
        } else {
          line = `${fmtTime(cast.timeSeconds)}  [TEAM] [CD]   ${pid(player.name)} (${spec}): ${cd.spellName}${groundingNote}`;
        }
        addEntry(
          cast.timeSeconds,
          line,
          requestSnapshotPlaceholder(cast.timeSeconds),
        );
      }
    }
  }

  // ── [CC CAST] events — AoE CC cast by friendly players on enemies ──────────

  if (outgoingCCChains && outgoingCCChains.length > 0) {
    for (const event of extractAoeCCEvents(outgoingCCChains)) {
      const casterLabel = pid(event.casterName);
      const targetLabels = event.targets
        .map((t) => enemyPid(t.name))
        .join(", ");
      const countNote =
        event.targets.length > 1 ? ` [${event.targets.length} enemies]` : "";
      addEntry(
        event.atSeconds,
        `${fmtTime(event.atSeconds)}  [CC CAST]   ${event.spellName} (by ${casterLabel}) → ${targetLabels}${countNote}`,
      );
    }
  }

  // ── [ENEMY BUFF] / [ENEMY BUFF END] events (F67b) ─────────────────────────

  for (const [enemyName, intervals] of enemyBuffIntervals) {
    for (const interval of intervals) {
      // B117: keep the [ENEMY BUFF] itself (it is useful enemy-burst context) but only tag it
      // "(purgeable)" when the log owner can actually purge — otherwise it invites a non-actionable
      // "you should have purged" finding on a spec with no purge tool.
      const purgeNote =
        interval.purgeable && canOffensivePurge(owner) ? " (purgeable)" : "";
      addEntry(
        interval.startSeconds,
        `${fmtTime(interval.startSeconds)}  [ENEMY BUFF]   ${enemyPid(enemyName)}: ${interval.spellName}${purgeNote}`,
      );
      addEntry(
        interval.endSeconds,
        `${fmtTime(interval.endSeconds)}  [ENEMY BUFF END]   ${enemyPid(enemyName)}: ${interval.spellName}`,
      );
    }
  }

  // ── [ENEMY CD] events ──────────────────────────────────────────────────────
  // B107: annotate each cast with a per-spell sequence index (e.g. `Bestial Wrath [2/4]`)
  // so the model can't collapse short-interval repeats of the same CD into one window.

  for (const player of enemyCDTimeline.players) {
    const totalBySpell = new Map<string, number>();
    for (const cd of player.offensiveCDs) {
      totalBySpell.set(cd.spellName, (totalBySpell.get(cd.spellName) ?? 0) + 1);
    }
    const seqBySpell = new Map<string, number>();
    for (const cd of player.offensiveCDs) {
      const total = totalBySpell.get(cd.spellName) ?? 1;
      const seq = (seqBySpell.get(cd.spellName) ?? 0) + 1;
      seqBySpell.set(cd.spellName, seq);
      const seqAnnotation = total > 1 ? ` [${seq}/${total}]` : "";
      addEntry(
        cd.castTimeSeconds,
        `${fmtTime(cd.castTimeSeconds)}  [ENEMY CD]   ${enemyPid(player.playerName)} (${player.specName}): ${cd.spellName}${seqAnnotation}`,
      );
    }
  }

  // ── F170: [ENEMY HARD CAST] — hard-cast kill spells (Chaos Bolt, Pyroblast) ─
  {
    const HARD_CAST_KILL_SPELLS = new Set(["116858", "11366", "1254294"]); // Chaos Bolt, Pyroblast
    for (const enemy of enemies ?? []) {
      for (const event of enemy.spellCastEvents) {
        if (event.logLine.event !== LogEvent.SPELL_CAST_START) continue;
        if (!event.spellId || !HARD_CAST_KILL_SPELLS.has(event.spellId))
          continue;
        const timeSeconds = (event.timestamp - matchStartMs) / 1000;
        if (timeSeconds < 0 || timeSeconds > matchEndSeconds) continue;
        const spellName = getEnglishSpellName(event.spellId, event.spellName);
        const target = event.destUnitName
          ? ` → ${pid(event.destUnitName)}`
          : "";
        addEntry(
          timeSeconds,
          `${fmtTime(timeSeconds)}  [ENEMY HARD CAST]   ${enemyPid(enemy.name)}: ${spellName}${target}`,
        );
      }
    }
  }

  // ── [TRINKET] and [CC ON TEAM] events ──────────────────────────────────────

  const isDangerousTime = (t: number) => {
    // 1. Teammate death within next 10s
    for (const d of friendlyDeaths) {
      if (t >= d.atSeconds - 10 && t <= d.atSeconds) return true;
    }
    // 2. High pressure window
    for (const pw of pressureWindows) {
      if (
        pw.totalDamage >= DMG_SPIKE_THRESHOLD &&
        t >= pw.fromSeconds - 5 &&
        t <= pw.toSeconds + 5
      ) {
        return true;
      }
    }
    // 3. Enemy burst window
    for (const burst of enemyCDTimeline.alignedBurstWindows) {
      if (t >= burst.fromSeconds - 5 && t <= burst.toSeconds + 5) return true;
    }
    return false;
  };

  for (const summary of ccTrinketSummaries) {
    for (const t of summary.trinketUseTimes) {
      addEntry(
        t,
        `${fmtTime(t)}  [TRINKET]   ${pid(summary.playerName)} used PvP trinket`,
      );
    }

    for (const cc of summary.ccInstances) {
      if (cc.durationSeconds === 0) continue;
      let trinketNote = "";
      if (cc.trinketState === "used") {
        // B111: with the active-at-cast attribution fix, 'used' means the trinket was pressed while this
        // CC was still active — it BROKE the CC. The logged length is the truncated endured time (aura
        // was cut short at the break), NOT the CC's natural duration, so the standalone "| Ns" is
        // suppressed below and this note states how long the player endured and that the CC had NOT
        // expired on its own — otherwise the coach misreads a trinket-shortened "1s" as a trivial CC
        // that was not worth trinketing (see 294 Finding "trinketed a 1-second Hammer").
        trinketNote = ` | trinket broke this CC after ${cc.durationSeconds.toFixed(0)}s (cut short — it had not expired)`;
      } else if (cc.trinketState === "on_cooldown") {
        const cdLeft =
          cc.trinketCDSecondsLeft !== undefined
            ? `${cc.trinketCDSecondsLeft}s left`
            : "on CD";
        trinketNote = ` | trinket: ON CD (${cdLeft})`;
      }

      // F148: Cleanse Success Verification — check if this CC was removed by a friendly dispel
      const isCleansed = wasRemovedByAllyDispel(
        dispelSummary.allyCleanse,
        cc.spellId,
        summary.playerName,
        cc.atSeconds + cc.durationSeconds,
      );
      const cleansedNote = isCleansed ? " [CLEANSED]" : "";

      const drStr =
        DISPEL_FEATURE_FLAGS.F124_ENHANCED_CC_ANNOTATIONS &&
        cc.drInfo &&
        cc.drInfo.category !== "Unknown"
          ? ` [DR: ${cc.drInfo.category} ${cc.drInfo.level}]`
          : "";
      const isBacklash = cc.spellId === "34914" || cc.spellId === "196363";
      const backlashStr =
        DISPEL_FEATURE_FLAGS.F124_ENHANCED_CC_ANNOTATIONS && isBacklash
          ? " [DISPEL BACKLASH CC]"
          : "";

      // B111: for a trinket-broken CC the logged duration is the truncated endured time, not the CC's
      // natural length; suppress the standalone "| Ns" (the trinket note carries the endured time) so it
      // is not misread as the CC's trivial full duration.
      const durStr =
        cc.trinketState === "used"
          ? ""
          : ` | ${cc.durationSeconds.toFixed(0)}s`;

      // B124: surface the caster→target range (and LoS) already computed at CC application, so claims
      // like "walked into the CC" / "should have LoS'd it" become checkable instead of inferred. Only
      // shown when advanced logging supplied positions.
      let posStr = "";
      if (cc.distanceYards !== null) {
        const losTag = cc.losBlocked === true ? ", LoS blocked" : "";
        posStr = ` | ${cc.distanceYards}yd from caster${losTag}`;
      }

      // passive_trinket → player has no active trinket, no annotation
      addEntry(
        cc.atSeconds,
        // B112: "(by N)" not "(N)" — the bare "(6)" caster-id was misread as a "6s" duration.
        `${fmtTime(cc.atSeconds)}  [CC ON TEAM]   ${pid(summary.playerName)} ← ${cc.spellName} (by ${actorLabel(cc.sourceName, "enemy")})${durStr}${drStr}${backlashStr}${posStr}${trinketNote}${cleansedNote}`,
      );
    }

    if (summary.ccAvoidedInstances) {
      for (const avoided of summary.ccAvoidedInstances) {
        if (gateCcAvoidanceToDanger && !isDangerousTime(avoided.atSeconds)) {
          continue;
        }
        addEntry(
          avoided.atSeconds,
          // M-g: state the observed facts (CC cast did not land; avoidance ability present),
          // not a causal verdict. Let the model infer whether the ability caused the avoidance.
          `${fmtTime(avoided.atSeconds)}  [CC AVOIDED?]   ${pid(summary.playerName)}: ${avoided.spellName} (by ${actorLabel(avoided.sourceName, "enemy")}) did not land; ${avoided.avoidanceSpellName} active`,
        );
      }
    }
  }

  // ── [CC ON ENEMY]:我方 CC 落在敌人身上(2026-07-18 覆盖修复)────────────
  // owner 的 CC 仅当有 [YOU] [CC] 施法行(即在追踪 CD 目录内)才跳过——
  // 无追踪 CD 的 CC(Sap/Cheap Shot/Gouge/Polymorph 等)两条路都不渲染,
  // 曾造成 DPS baseline 11 场 CC 覆盖 <80% 尾巴。队友/宠物来源照常补齐。
  const ownerRenderedCcIds = new Set(
    ownerCDs.filter((cd) => ccSpellIds.has(cd.spellId)).map((cd) => cd.spellId),
  );
  if (enemyCCSummaries) {
    for (const summary of enemyCCSummaries) {
      // 敌方饰品使用此前完全不渲染(野生 60 场审计:30/57 场覆盖 <80%,
      // 全部缺口是 hostile 侧)——"目标交没交饰品"是爆发转化审计的核心事实,
      // 缺席时教练只能以"trinket state never observed"降置信。
      for (const t of summary.trinketUseTimes) {
        addEntry(
          t,
          `${fmtTime(t)}  [ENEMY TRINKET]   ${enemyPid(summary.playerName)} used PvP trinket`,
        );
      }
      for (const cc of summary.ccInstances) {
        if (cc.sourceName === owner.name && ownerRenderedCcIds.has(cc.spellId))
          continue;
        const durStr = ` (${cc.durationSeconds.toFixed(0)}s)`;
        addEntry(
          cc.atSeconds,
          `${fmtTime(cc.atSeconds)}  [CC ON ENEMY]   ${enemyPid(summary.playerName)} ← ${cc.spellName} (by ${actorLabel(cc.sourceName, "friendly")})${durStr}`,
        );
      }
    }
  }

  // ── [UNCLEANSED DEBUFF] and [CLEANSE] events ──────────────────────────────────

  for (const miss of dispelSummary.missedCleanseWindows) {
    // B16: only emit if the log owner's spec can actually remove this debuff type
    if (!canDefensiveCleanse(owner, miss.dispelType)) continue;
    const dmgK = Math.round(miss.postCcDamage / 1000);
    const spellName = getEnglishSpellName(miss.spellId, miss.spellName);
    addEntry(
      miss.timeSeconds,
      `${fmtTime(miss.timeSeconds)}  [UNCLEANSED DEBUFF]   ${spellName} on ${pid(miss.targetName)} | ${miss.durationSeconds.toFixed(0)}s | ${dmgK}k taken during | dispel: ${miss.dispelType}`,
    );
  }

  // B117: only the log owner's decisions are actionable, so a "missed purge" is noise unless the
  // owner can actually offensive-purge. Mistweaver/Evoker/Holy Priest/Paladin etc. spammed this tag
  // for enemy buffs (e.g. Power Infusion) they had no tool to remove — the weakest, lowest-confidence
  // findings in the corpus. Gate the whole block to owners who can purge.
  if (
    DISPEL_FEATURE_FLAGS.F152_MISSED_PURGES_TIMELINE &&
    canOffensivePurge(owner)
  ) {
    for (const miss of dispelSummary.missedPurgeWindows) {
      if (HIGH_VALUE_PURGEABLE_BUFFS.has(miss.spellId)) {
        addEntry(
          miss.timeSeconds,
          `${fmtTime(miss.timeSeconds)}  [MISSED PURGE OPPORTUNITY]   ${miss.spellName} active on ${enemyPid(miss.enemyName)} (unpurged for ${Math.round(miss.durationSeconds)}s)`,
        );
      }
    }
  }

  // B14: Consolidate same-second same-source cleanses (e.g. Mass Dispel) into one line.
  // F163: Filter out low/medium priority cleanses to de-noise the timeline.
  {
    const cleanseGroups = new Map<string, IDispelEvent[]>();
    for (const cleanse of dispelSummary.allyCleanse) {
      if (cleanse.priority !== "Critical" && cleanse.priority !== "High")
        continue;
      const key = `${Math.round(cleanse.timeSeconds)}|${cleanse.sourceName}`;
      const group = cleanseGroups.get(key) ?? [];
      group.push(cleanse);
      cleanseGroups.set(key, group);
    }
    for (const group of cleanseGroups.values()) {
      const first = group[0];
      const petTag = group.some((c) => c.isPetDispel) ? " (pet)" : "";
      const fatalCleanse = DISPEL_FEATURE_FLAGS.F18_FATAL_DISPEL
        ? group.find((c) => c.wasFatal)
        : undefined;
      const fatalTag = fatalCleanse
        ? ` [FATAL DISPEL: ${pid(fatalCleanse.fatalUnitName ?? fatalCleanse.sourceName)}]`
        : "";
      const removedSpellName = getEnglishSpellName(
        first.removedSpellId,
        first.removedSpellName,
      );
      // T5(驱散覆盖):具名驱散法术——"用什么驱的"是教练建议(冷却、优先级)
      // 的落点,也是确定性覆盖率的匹配键。
      const viaTag = first.dispelSpellName ? ` (${first.dispelSpellName})` : "";
      if (group.length === 1) {
        addEntry(
          first.timeSeconds,
          `${fmtTime(first.timeSeconds)}  [CLEANSE]   ${pid(first.sourceName)} dispelled ${removedSpellName} off ${pid(first.targetName)}${viaTag}${petTag}${fatalTag}`,
        );
      } else {
        const effects = group
          .map(
            (c) =>
              `${getEnglishSpellName(c.removedSpellId, c.removedSpellName)} off ${pid(c.targetName)}`,
          )
          .join(", ");
        addEntry(
          first.timeSeconds,
          `${fmtTime(first.timeSeconds)}  [CLEANSE]   ${pid(first.sourceName)} dispelled ${group.length} effects: ${effects}${viaTag}${petTag}${fatalTag}`,
        );
      }
    }
  }

  // ── [PURGE] / [ENEMY PURGE] events(T5 驱散覆盖)────────────────────────────
  // 队友的进攻性 purge 与敌方剥我方增益此前完全不可见;同 [CLEANSE] 的
  // F163 去噪(仅 Critical/High)与 B14 同秒同源合并。owner 自己的 purge 已在
  // 其施法行内注记([removed: …]),不重复。
  {
    const purgeGroups = new Map<string, IDispelEvent[]>();
    for (const purge of dispelSummary.ourPurges) {
      // 宠物代施(Devour Magic 等)没有 owner 施法行可注记,不能跳过
      if (purge.sourceName === owner.name && !purge.isPetDispel) continue;
      if (purge.priority !== "Critical" && purge.priority !== "High") continue;
      const key = `${Math.round(purge.timeSeconds)}|${purge.sourceName}`;
      const group = purgeGroups.get(key) ?? [];
      group.push(purge);
      purgeGroups.set(key, group);
    }
    for (const group of purgeGroups.values()) {
      const first = group[0];
      const viaTag = first.dispelSpellName ? ` (${first.dispelSpellName})` : "";
      const effects = group
        .map(
          (c) =>
            `${getEnglishSpellName(c.removedSpellId, c.removedSpellName)} off ${enemyPid(c.targetName)}`,
        )
        .join(", ");
      addEntry(
        first.timeSeconds,
        `${fmtTime(first.timeSeconds)}  [PURGE]   ${pid(first.sourceName)} purged ${effects}${viaTag}`,
      );
    }

    const hostileGroups = new Map<string, IDispelEvent[]>();
    for (const purge of dispelSummary.hostilePurges) {
      if (purge.priority !== "Critical" && purge.priority !== "High") continue;
      const key = `${Math.round(purge.timeSeconds)}|${purge.sourceName}`;
      const group = hostileGroups.get(key) ?? [];
      group.push(purge);
      hostileGroups.set(key, group);
    }
    for (const group of hostileGroups.values()) {
      const first = group[0];
      const viaTag = first.dispelSpellName ? ` (${first.dispelSpellName})` : "";
      const effects = group
        .map(
          (c) =>
            `${getEnglishSpellName(c.removedSpellId, c.removedSpellName)} off ${pid(c.targetName)}`,
        )
        .join(", ");
      addEntry(
        first.timeSeconds,
        `${fmtTime(first.timeSeconds)}  [ENEMY PURGE]   ${enemyPid(first.sourceName)} stripped ${effects}${viaTag}`,
      );
    }

    // [ENEMY CLEANSE]:对面把我方 CC/dot 从他们队友身上解掉(教练关键信息
    // ——"你的 Hex 秒被解";2026-07-18 baseline 排查:此前整类不可见,
    // 42/176 场漏 Purify)。同级 Critical/High 过滤 + 同秒同源合并。
    if (enemyDispelSummary) {
      const enemyCleanseGroups = new Map<string, IDispelEvent[]>();
      for (const c of enemyDispelSummary.allyCleanse) {
        if (c.priority !== "Critical" && c.priority !== "High") continue;
        const key = `${Math.round(c.timeSeconds)}|${c.sourceName}`;
        const group = enemyCleanseGroups.get(key) ?? [];
        group.push(c);
        enemyCleanseGroups.set(key, group);
      }
      for (const group of enemyCleanseGroups.values()) {
        const first = group[0];
        const viaTag = first.dispelSpellName
          ? ` (${first.dispelSpellName})`
          : "";
        const effects = group
          .map(
            (c) =>
              `${getEnglishSpellName(c.removedSpellId, c.removedSpellName)} off ${enemyPid(c.targetName)}`,
          )
          .join(", ");
        addEntry(
          first.timeSeconds,
          `${fmtTime(first.timeSeconds)}  [ENEMY CLEANSE]   ${enemyPid(first.sourceName)} cleansed ${effects}${viaTag}`,
        );
      }
    }
  }

  // ── [MINOR DISPELS] 折叠行(T5 驱散覆盖)──────────────────────────────────
  // F163 滤掉的 low/medium 驱散不逐条上时间轴,但按 (来源, 驱散法术) 折叠成
  // 一行计数——驱散工作量与所用法术对教练可见,token 代价 O(法术种类)。
  {
    const minor = new Map<
      string,
      {
        sourceLabel: string;
        spellName: string;
        count: number;
        firstSeconds: number;
      }
    >();
    const foldMinor = (
      events: IDispelEvent[],
      labelOf: (name: string) => string,
    ) => {
      for (const e of events) {
        if (e.priority === "Critical" || e.priority === "High") continue;
        const spellName = e.dispelSpellName || "unknown";
        const key = `${e.sourceName}|${spellName}`;
        const cur = minor.get(key);
        if (cur) {
          cur.count++;
          cur.firstSeconds = Math.min(cur.firstSeconds, e.timeSeconds);
        } else {
          minor.set(key, {
            sourceLabel: labelOf(e.sourceName),
            spellName,
            count: 1,
            firstSeconds: e.timeSeconds,
          });
        }
      }
    };
    foldMinor(dispelSummary.allyCleanse, pid);
    foldMinor(dispelSummary.ourPurges, pid);
    foldMinor(dispelSummary.hostilePurges, enemyPid);
    if (enemyDispelSummary) foldMinor(enemyDispelSummary.allyCleanse, enemyPid);

    const bySource = new Map<
      string,
      Array<{ spellName: string; count: number; firstSeconds: number }>
    >();
    for (const m of minor.values()) {
      const list = bySource.get(m.sourceLabel) ?? [];
      list.push(m);
      bySource.set(m.sourceLabel, list);
    }
    for (const [sourceLabel, list] of bySource) {
      list.sort((a, b) => a.firstSeconds - b.firstSeconds);
      const firstSeconds = list[0].firstSeconds;
      const parts = list
        .map((m) => (m.count > 1 ? `${m.spellName} x${m.count}` : m.spellName))
        .join(", ");
      addEntry(
        firstSeconds,
        `${fmtTime(firstSeconds)}  [MINOR DISPELS]   ${sourceLabel}: ${parts} (low-priority, folded)`,
      );
    }
  }

  // ── [KICK] events ───────────────────────────────────────────────────────────
  // F20 pilot: landed SPELL_INTERRUPT events from either team. Availability notes
  // ("enemy interrupts UP") tell the model what *could* be kicked, but without
  // these lines every successful kick — including ones that decided a death — is
  // invisible in the timeline.
  {
    const friendlyNames = new Set(friends.map((f) => f.name));
    const enemyNames = new Set((enemies ?? []).map((e) => e.name));
    const playerById = new Map(
      [...friends, ...(enemies ?? [])].map((u) => [u.id, u]),
    );
    // Pet kicks (ghoul Shambling Rush, felhunter Spell Lock, …) log the pet as
    // the source; attribute them to the owning player so the model doesn't
    // have to guess whose pet an unknown name belongs to (F134-adjacent).
    const resolveKicker = (name: string): string => {
      if (friendlyNames.has(name)) return pid(name);
      if (enemyNames.has(name)) return enemyPid(name);
      const petUnit = allUnits?.find(
        (u) => u.name === name && u.ownerId.length > 0,
      );
      const petOwner = petUnit ? playerById.get(petUnit.ownerId) : undefined;
      if (petOwner) {
        const ownerLabel = friendlyNames.has(petOwner.name)
          ? pid(petOwner.name)
          : enemyPid(petOwner.name);
        return `${ownerLabel}'s pet`;
      }
      const short = name.split("-")[0];
      // Unresolved unit = pet/NPC whose owner lookup failed. Its name is
      // client-localized — don't leak a non-ASCII unit name into the prompt.
      const isLocalized = [...short].some((c) => c.charCodeAt(0) > 127);
      return isLocalized ? "[pet]" : short;
    };
    const seenKicks = new Set<string>();
    const allUnitsForKicks = friends ? [...friends] : [];
    if (enemies) {
      allUnitsForKicks.push(...enemies);
    }
    for (const unit of allUnitsForKicks) {
      const actions = [...(unit.actionOut ?? []), ...(unit.actionIn ?? [])];
      for (const action of actions) {
        if (action.logLine.event !== LogEvent.SPELL_INTERRUPT) continue;
        const key = `${action.timestamp}|${action.srcUnitName}|${action.destUnitName}|${action.spellId}`;
        if (seenKicks.has(key)) continue;
        seenKicks.add(key);
        const atSeconds = (action.timestamp - matchStartMs) / 1000;
        if (atSeconds < 0) continue;
        const kicker = resolveKicker(action.srcUnitName);
        // Victims get the same resolution as kickers: players → pid, pets →
        // owner attribution ("N's pet"), localized NPC names suppressed.
        const victim = resolveKicker(action.destUnitName);
        const kickSpell = getEnglishSpellName(
          action.spellId ?? "",
          action.spellName ?? "interrupt",
        );
        const stoppedSpell =
          action.extraSpellId !== undefined
            ? getEnglishSpellName(action.extraSpellId, action.extraSpellName)
            : "";
        addEntry(
          atSeconds,
          `${fmtTime(atSeconds)}  [KICK]   ${kicker} interrupted ${victim}${
            stoppedSpell ? `'s ${stoppedSpell}` : ""
          } (${kickSpell})`,
        );
      }
    }
  }

  // ── [DMG SPIKE] events ─────────────────────────────────────────────────────

  emitDmgSpikeEntries({
    criticalWindowSeconds: criticalWindowSet,
    pressureWindows,
    friends,
    matchStartMs,
    pid,
    playerIdMap,
    enemyIdMap,
    addEntry,
  });

  // ── [HEALER INACTIVITY] events (healer only) ────────────────────────────────────

  if (isHealer) {
    for (const gap of healingGaps) {
      addEntry(
        gap.fromSeconds,
        `${fmtTime(gap.fromSeconds)}  [INACTIVITY]   ${pid(owner.name)} inactive ${gap.durationSeconds.toFixed(1)}s (${gap.freeCastSeconds.toFixed(1)}s of it un-CC'd/free to cast) while ${pid(gap.mostDamagedName)} under pressure`,
      );
    }
  }

  // Compile key moment seconds where major events occur
  const keyMomentSeconds = new Set<number>();
  for (const d of friendlyDeaths) keyMomentSeconds.add(Math.floor(d.atSeconds));
  for (const d of enemyDeaths) keyMomentSeconds.add(Math.floor(d.atSeconds));
  for (const cd of ownerCDs) {
    for (const cast of cd.casts)
      keyMomentSeconds.add(Math.floor(cast.timeSeconds));
  }
  for (const { cds } of teammateCDs) {
    for (const cd of cds) {
      for (const cast of cd.casts)
        keyMomentSeconds.add(Math.floor(cast.timeSeconds));
    }
  }
  for (const player of enemyCDTimeline.players) {
    for (const cd of player.offensiveCDs)
      keyMomentSeconds.add(Math.floor(cd.castTimeSeconds));
  }
  for (const summary of ccTrinketSummaries) {
    for (const cc of summary.ccInstances) {
      if (cc.durationSeconds > 0)
        keyMomentSeconds.add(Math.floor(cc.atSeconds));
    }
    for (const t of summary.trinketUseTimes)
      keyMomentSeconds.add(Math.floor(t));
  }
  for (const pw of pressureWindows) {
    if (pw.totalDamage >= DMG_SPIKE_THRESHOLD)
      keyMomentSeconds.add(Math.floor(pw.fromSeconds));
  }
  for (const miss of dispelSummary.missedCleanseWindows) {
    if (canDefensiveCleanse(owner, miss.dispelType))
      keyMomentSeconds.add(Math.floor(miss.timeSeconds));
  }
  for (const cleanse of dispelSummary.allyCleanse) {
    keyMomentSeconds.add(Math.floor(cleanse.timeSeconds));
  }
  if (outgoingCCChains && outgoingCCChains.length > 0) {
    for (const event of extractAoeCCEvents(outgoingCCChains)) {
      keyMomentSeconds.add(Math.floor(event.atSeconds));
    }
  }

  // Emit HP ticks — use a narrower sample window inside critical windows so adjacent
  // 1-second ticks cannot both claim the same underlying reading (which would give a
  // misleadingly flat HP line during a fast drop).
  // 半径从共享谓词 hpSampleRadiusMs 取(cooldowns.ts)—— 这里曾经是两个局部
  // 常量,而 [DMG SPIKE] 那侧恒用 ±3s,导致同一秒两行 HP 打架(2026-07-20 eval
  // 实证 31/50 场)。别再在这里定义半径常量。

  // B106: when a numeric ID map is present, sort HP tokens by player ID so the model
  // can align HP readings with class labels listed elsewhere in player-ID order.
  // Owner is always assigned ID 1 in buildPlayerLoadout, so sorting by ID also satisfies
  // the "owner first" property; fall back to owner-first ordering when no map is provided.
  const friendlyOrdered: ICombatUnit[] = playerIdMap
    ? [...friends].sort((a, b) => {
        const aId = playerIdMap.get(a.name);
        const bId = playerIdMap.get(b.name);
        if (aId === undefined && bId === undefined) return 0;
        if (aId === undefined) return 1;
        if (bId === undefined) return -1;
        return aId - bId;
      })
    : [
        ...friends.filter((u) => u.name === owner.name),
        ...friends.filter((u) => u.name !== owner.name),
      ];

  const friendlyHpUnits: Array<{
    unit: ICombatUnit;
    label: (name: string) => string;
  }> = friendlyOrdered.map((u) => ({
    unit: u,
    label: (name: string) => pid(name),
  }));

  const enemiesOrdered: ICombatUnit[] = enemyIdMap
    ? [...(enemies ?? [])].sort((a, b) => {
        const aId = enemyIdMap.get(a.name);
        const bId = enemyIdMap.get(b.name);
        if (aId === undefined && bId === undefined) return 0;
        if (aId === undefined) return 1;
        if (bId === undefined) return -1;
        return aId - bId;
      })
    : [...(enemies ?? [])];

  const enemyHpUnits: Array<{
    unit: ICombatUnit;
    label: (name: string) => string;
  }> = enemiesOrdered.map((u) => ({
    unit: u,
    label: (name: string) => enemyPid(name),
  }));

  // B42: Build death-time lookup so [STATE] ticks show :dead instead of silently omitting dead players.
  const friendlyDeathAtByName = new Map<string, number>(
    friendlyDeaths.map((d) => [d.name, d.atSeconds]),
  );
  const enemyDeathAtByName = new Map<string, number>(
    enemyDeaths.map((d) => [d.name, d.atSeconds]),
  );

  const lastEmittedHp = new Map<string, number>();
  const lastEmittedStatus = new Map<string, string>(); // 'alive' | 'dead'
  const STATE_MIN_GAP_SECONDS = 3;
  let lastStateEmitT = -100;

  for (let t = 0; t <= Math.floor(matchDurationS); t++) {
    const tsMs = matchStartMs + t * 1000;
    const sampleWindowMs = hpSampleRadiusMs(t, criticalWindowSet);

    const friendlyParts: string[] = [];
    const currentFriendlies = friendlyHpUnits.map(({ unit, label }) => {
      const deathAt = friendlyDeathAtByName.get(unit.name);
      let isDead = deathAt !== undefined && t >= Math.floor(deathAt);

      const isGhost = spiritOfRedemptionIntervals.some(
        (i) =>
          i.player.name === unit.name &&
          i.intervals.some(
            (int) => t >= int.startSeconds && t <= int.endSeconds,
          ),
      );

      const pct = getUnitHpAtTimestamp(unit, tsMs, sampleWindowMs);
      const clamped = pct !== null ? Math.min(pct, 100) : null;

      if (isGhost) {
        friendlyParts.push(`${label(unit.name)}:ghost`);
        isDead = false;
      } else if (isDead) {
        friendlyParts.push(`${label(unit.name)}:dead`);
      } else if (clamped !== null) {
        if (clamped < 100) {
          friendlyParts.push(`${label(unit.name)}:${clamped}`);
        }
      }
      return { name: unit.name, isDead, hp: clamped };
    });

    const enemyParts: string[] = [];
    const currentEnemies =
      criticalWindowSet.has(t) && enemyHpUnits.length > 0
        ? enemyHpUnits.map(({ unit, label }) => {
            const deathAt = enemyDeathAtByName.get(unit.name);
            let isDead = deathAt !== undefined && t >= Math.floor(deathAt);

            const isGhost = spiritOfRedemptionIntervals.some(
              (i) =>
                i.player.name === unit.name &&
                i.intervals.some(
                  (int) => t >= int.startSeconds && t <= int.endSeconds,
                ),
            );

            const pct = getUnitHpAtTimestamp(unit, tsMs, sampleWindowMs);
            const clamped = pct !== null ? Math.min(pct, 100) : null;

            if (isGhost) {
              enemyParts.push(`${label(unit.name)}:ghost`);
              isDead = false;
            } else if (isDead) {
              enemyParts.push(`${label(unit.name)}:dead`);
            } else if (clamped !== null) {
              if (clamped < 100) {
                enemyParts.push(`${label(unit.name)}:${clamped}`);
              }
            }
            return { name: unit.name, isDead, hp: clamped };
          })
        : [];

    if (friendlyParts.length === 0 && enemyParts.length === 0) continue;

    // B15: Option 2 (Event-Gating) - strictly emit ONLY inside critical windows, or if a player died.
    const isInCritical = criticalWindowSet.has(t);
    const someoneDied =
      currentFriendlies.some((p) => p.isDead) ||
      currentEnemies.some((p) => p.isDead);

    const wasSomeoneDead = Array.from(lastEmittedStatus.values()).some(
      (status) => status === "dead",
    );
    const isFirstDeathTick = someoneDied && !wasSomeoneDead;

    // Only emit if inside critical window, or death. No time anchors!
    if (!isInCritical && !isFirstDeathTick) continue;

    // Decide if it's a key moment or delta change
    let shouldEmit = false;
    if (t === 0) {
      shouldEmit = true; // Always emit first tick
    } else if (keyMomentSeconds.has(t)) {
      shouldEmit = true; // Key moment snapshot
    } else if (
      t - lastStateEmitT < STATE_MIN_GAP_SECONDS &&
      !isFirstDeathTick
    ) {
      // T3: 关键窗口内逐秒 STATE 是时间轴最大 token 源,也是盲评实测的"读串相邻行"
      // 误归因温床;非关键时刻强制 ≥3s 间隔(死亡/keyMoment 不受限)
      shouldEmit = false;
    } else {
      // Check if any player's HP changed by at least 10% or status changed since last emitted tick
      for (const p of [...currentFriendlies, ...currentEnemies]) {
        const lastHp = lastEmittedHp.get(p.name);
        const lastStatus = lastEmittedStatus.get(p.name) ?? "alive";
        const currentStatus = p.isDead ? "dead" : "alive";

        if (currentStatus !== lastStatus) {
          shouldEmit = true;
          break;
        }

        if (p.hp !== null) {
          if (lastHp === undefined || Math.abs(p.hp - lastHp) >= 10) {
            shouldEmit = true;
            break;
          }
        }
      }
    }

    if (!shouldEmit) continue;

    // Update last emitted state
    for (const p of [...currentFriendlies, ...currentEnemies]) {
      if (p.hp !== null) lastEmittedHp.set(p.name, p.hp);
      lastEmittedStatus.set(p.name, p.isDead ? "dead" : "alive");
    }

    let stateParts: string;
    if (friendlyParts.length > 0 && enemyParts.length > 0) {
      stateParts = `friends ${friendlyParts.join(" ")} / enemies ${enemyParts.join(" ")}`;
    } else if (friendlyParts.length > 0) {
      stateParts = `friends ${friendlyParts.join(" ")}`;
    } else {
      stateParts = `enemies ${enemyParts.join(" ")}`;
    }

    lastStateEmitT = t;
    addEntry(t, `${fmtTime(t)}  [STATE]   ${stateParts}`);
  }

  // 8.5 Add Mana Context for long matches (F144)
  if (matchDurationS > 300) {
    emitManaMarkerEntries({
      owner,
      friends,
      enemies: enemies ?? [],
      matchStartMs,
      matchDurationS,
      friendlyDeathAtByName,
      enemyDeathAtByName,
      pid,
      enemyPid,
      addEntry,
    });
  }

  // 9. Add Form shifts (Verbose mode only)
  if (stateFormat === "verbose") {
    for (const { player, intervals } of shapeshiftIntervals) {
      const isOwner = player.id === owner.id;
      const prefix = isOwner
        ? "[YOU]"
        : friends.some((f) => f.id === player.id)
          ? "[TEAM]"
          : "[ENEMY]";
      const pLabel = isOwner ? "" : ` ${pid(player.name)}`;

      for (const interval of intervals) {
        addEntry(
          interval.startSeconds,
          `${fmtTime(interval.startSeconds)}  ${prefix} [SHIFT]${pLabel} entered ${interval.form} Form`,
        );
      }
    }

    for (const { player, intervals } of spiritOfRedemptionIntervals) {
      const isOwner = player.id === owner.id;
      const prefix = isOwner
        ? "[YOU]"
        : friends.some((f) => f.id === player.id)
          ? "[TEAM]"
          : "[ENEMY]";
      const pLabel = isOwner ? "" : ` ${pid(player.name)}`;

      for (const interval of intervals) {
        addEntry(
          interval.startSeconds,
          `${fmtTime(interval.startSeconds)}  ${prefix} [SPIRIT OF REDEMPTION]${pLabel} entered Spirit of Redemption (Ghost Form)`,
        );
        addEntry(
          interval.endSeconds,
          `${fmtTime(interval.endSeconds)}  ${prefix} [SPIRIT OF REDEMPTION]${pLabel} form expired`,
        );
      }
    }
  }

  // 10. Process Stasis Events
  for (const stasis of stasisEvents) {
    if (stateFormat === "summary") {
      // Prefer resolved spell names; fall back to the stored-spell count so an
      // unidentified release is never shown as an empty "→ " (which reads as a
      // wasted Stasis). Only skip releases that genuinely stored nothing.
      const contents =
        stasis.spells.length > 0
          ? stasis.spells.join(", ")
          : stasis.storedCount > 0
            ? `${stasis.storedCount} spell(s) stored (contents not identified)`
            : "";
      if (contents) {
        addEntry(
          stasis.releaseSeconds,
          `${fmtTime(stasis.releaseSeconds)}  [YOU] [STASIS RELEASE] → ${contents}`,
        );
      }
    }
  }

  // Precompute snapshots chronologically
  const placeholders: DeferredSnapshot[] = [];
  for (const entry of entries) {
    for (const line of entry.lines) {
      if (isDeferredSnapshot(line)) {
        placeholders.push(line);
      }
    }
  }

  placeholders.sort((a, b) => {
    if (a.timeSeconds !== b.timeSeconds) {
      return a.timeSeconds - b.timeSeconds;
    }
    if (a.forceFull !== b.forceFull) {
      return (b.forceFull ? 1 : 0) - (a.forceFull ? 1 : 0);
    }
    return a.id - b.id;
  });

  const snapshotResults = new Map<number, string>();
  let prevReadyNamesState: string[] | null = null;
  let prevOnCDNamesState: string[] | null = null;
  let lastSnapshotTime = -100;
  let lastFullSnapshotTime = -100;
  const FULL_SNAPSHOT_REFRESH_SECONDS = 60;

  for (const req of placeholders) {
    const timeSeconds = req.timeSeconds;
    const forceFull = req.forceFull;

    const isSameTime = Math.abs(timeSeconds - lastSnapshotTime) < 0.001;
    const shouldDebounce =
      !req.bypassDebounce && timeSeconds - lastSnapshotTime < 2.0;
    if (isSameTime || shouldDebounce) {
      snapshotResults.set(req.id, "");
      continue;
    }
    lastSnapshotTime = timeSeconds;

    const teammateCDsWithLabel = teammateCDs.map(({ player, cds, spec }) => ({
      cds,
      spec,
      player,
      playerLabel: playerIdMap
        ? String(playerIdMap.get(player.name) ?? player.name)
        : player.name,
    }));
    const currentReadyNames = computeReadyNames(
      timeSeconds,
      ownerCDs,
      teammateCDsWithLabel,
    );
    const currentOnCDNames = computeOnCDDisplayNames(
      timeSeconds,
      ownerCDs,
      teammateCDsWithLabel,
    );
    const forceFullRefresh =
      forceFull ||
      timeSeconds - lastFullSnapshotTime >= FULL_SNAPSHOT_REFRESH_SECONDS;
    const prevReadyNames = forceFullRefresh
      ? undefined
      : (prevReadyNamesState ?? undefined);
    const prevOnCDNames = forceFullRefresh
      ? undefined
      : (prevOnCDNamesState ?? undefined);
    if (forceFullRefresh) lastFullSnapshotTime = timeSeconds;
    prevReadyNamesState = currentReadyNames;
    prevOnCDNamesState = currentOnCDNames;

    const snapshotStr = snapshotFn({
      timeSeconds,
      ownerCDs,
      ownerName: owner.name,
      ownerSpec,
      isOwnerHealer: isHealer,
      teammateCDs,
      ccTrinketSummaries,
      enemyCDTimeline,
      playerIdMap,
      prevReadyNames,
      prevOnCDNames,
      matchStartMs,
      ownerUnit: owner,
    });
    snapshotResults.set(req.id, snapshotStr);
  }

  // Mutate entries in-place to resolve deferred snapshots
  for (const entry of entries) {
    entry.lines = entry.lines
      .map((line) => {
        if (isDeferredSnapshot(line)) {
          return snapshotResults.get(line.id) ?? "";
        }
        return line;
      })
      .filter(Boolean);
  }

  // ── Sort and format ───────────────────────────────────────────────────────

  entries.sort((a, b) => a.timeSeconds - b.timeSeconds);

  const summaryLines: string[] = [];
  if (stateFormat === "summary" && shapeshiftIntervals.length > 0) {
    summaryLines.push("## NOTABLE STATES");
    for (const { player, intervals } of shapeshiftIntervals) {
      const bearTime = intervals
        .filter((i) => i.form === "Bear")
        .reduce((acc, i) => acc + (i.endSeconds - i.startSeconds), 0);
      const catTime = intervals
        .filter((i) => i.form === "Cat")
        .reduce((acc, i) => acc + (i.endSeconds - i.startSeconds), 0);
      const pLabel = player.id === owner.id ? "YOU" : pid(player.name);

      if (bearTime > 0)
        summaryLines.push(
          `- ${pLabel} spent ${Math.round(bearTime)}s in Bear Form.`,
        );
      if (catTime > 0)
        summaryLines.push(
          `- ${pLabel} spent ${Math.round(catTime)}s in Cat Form.`,
        );
    }
    if (summaryLines.length > 1) {
      summaryLines.push("");
    } else {
      summaryLines.length = 0; // Empty if no valid times found
    }
  }

  const outputLines: string[] = [
    ...summaryLines,
    "MATCH TIMELINE",
    "  Units: M = Million damage (1,000,000), k = Thousand damage (1,000)",
    // 2026-07-18 baseline:两个独立 responder 把 [DR: Full] 反读成"已完全
    // 递减/CC 无效"——图例一句话消歧(Full = 无递减 = 全时长 = 最佳 CC 时机)。
    "  [DR: <category> <level>] on CC lines = diminishing returns state when it LANDED:",
    "    Full = NO diminishing returns yet (full duration — the best time to land CC);",
    "    50% / 25% = duration reduced to half / quarter; Immune = DR'd to zero.",
    "",
    `[PERSPECTIVE: Log Owner - ${ownerSpec}]`,
    `(You are the ${ownerSpec} in this match. Your actions are marked with [YOU].)`,
    "",
  ];
  for (const entry of entries) {
    outputLines.push(...(entry.lines as string[]));
  }

  outputLines.push(
    ...buildKillSequenceBlock({
      matchStartMs,
      matchEndSeconds,
      owner,
      friends,
      enemies: enemies ?? [],
      ownerCDs,
      teammateCDs,
      enemyCDTimeline,
      ccTrinketSummaries,
      friendlyDeaths,
      enemyDeaths,
      isHealer,
      pid,
    }),
  );

  outputLines.push(
    ...buildMatchEndBlock({
      matchStartMs,
      matchEndMs,
      matchEndSeconds,
      bracket,
      owner,
      friends,
      enemies: enemies ?? [],
      friendlyDeaths,
      enemyDeaths,
      pid,
      enemyPid,
    }),
  );

  return outputLines.join("\n");
}

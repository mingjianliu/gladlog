import {
  AtomicArenaCombat,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import { getEnglishSpellName } from "../data/spellEffectData";
import { SPELL_CATEGORIES } from "../data/spellCategories";
import { zoneMetadata } from "../data/zoneMetadata";
import { buildArchetypeInjectionHeader } from "../utils/archetypeInjection";
import {
  analyzePlayerCCAndTrinket,
  formatCCTrinketForContext,
} from "../utils/ccTrinketAnalysis";
import { extractStasisEvents } from "../utils/combatStates";
import {
  annotateDefensiveTimings,
  computePressureWindows,
  detectOverlappedDefensives,
  detectPanicDefensives,
  extractMajorCooldowns,
  fmtTime,
  formatOverlappedDefensivesForContext,
  formatPanicDefensivesForContext,
  IEnemyCDTimelineForTiming,
  isHealerSpec,
  specToString,
} from "../utils/cooldowns";
import { isMeleeSpec } from "../utils/cooldowns";
import { formatDampeningForContext } from "../utils/dampening";
import {
  buildDeathOutcomeSummary,
  formatDeathOutcomeForContext,
} from "../utils/deathOutcomeAnalysis";
import {
  annotateMissedPurgesWithKillWindows,
  canOffensivePurge,
  formatDispelContextForAI,
  formatEnemyDispelsForContext,
  reconstructDispelSummary,
} from "../utils/dispelAnalysis";
import {
  analyzeOutgoingCCChains,
  formatOutgoingCCChainsForContext,
} from "../utils/drAnalysis";
import {
  formatEnemyCDTimelineForContext,
  reconstructEnemyCDTimeline,
} from "../utils/enemyCDs";
import {
  analyzeHealerExposureAtBurst,
  buildHealerCCReceivedEvents,
  formatEnemyCCKitHeader,
  formatHealerCCReceivedForContext,
  formatHealerExposureEntries,
  formatHealerExposureForContext,
  IHealerCCReceived,
} from "../utils/healerExposureAnalysis";
import {
  buildHealerOffenseSummary,
  formatHealerOffenseForContext,
  HEALER_OFFENSE_FLAGS,
} from "../utils/healerOffenseAnalysis";
import {
  detectHealingGaps,
  formatHealingGapsForContext,
} from "../utils/healingGaps";
import {
  analyzeKillWindowTargetSelection,
  formatKillWindowTargetSelectionForContext,
} from "../utils/killWindowTargetSelection";
import {
  computeMatchArchetype,
  formatMatchArchetypeForContext,
} from "../utils/matchArchetype";
import {
  buildOffensiveWasteSummary,
  formatOffensiveWasteForContext,
} from "../utils/offensiveWasteAnalysis";
import {
  computeOffensiveWindows,
  formatOffensiveWindowsForContext,
} from "../utils/offensiveWindows";
import {
  computeOwnerPositionEvents,
  formatPositionEventsForContext,
} from "../utils/positionAnalysis";
import {
  benchmarks,
  formatDTPSBaselines,
  formatSpecBaselines,
} from "../utils/specBaselines";
import { getPvpToolkit } from "../utils/talentBehaviors";
import {
  channelWasInterrupted,
  DMG_SPIKE_THRESHOLD,
  mergeTimestampedLines,
} from "./timelineHelpers";
import {
  buildMatchArc,
  buildMatchTimeline,
  BuildMatchTimelineParams,
  buildPlayerLoadout,
  identifyCriticalMoments,
} from "./utils";

// ──────────────────────────────────────────────────────────────────────────────

// B141 port: major healer channels whose expected duration lets us confirm a mid-cast interrupt.
// A kick/CC landing anywhere in [cast, cast+duration] means the channel was cut — largely wasted.
const CHANNELED_HEAL_CD_DURATIONS: Record<string, number> = {
  "740": 6, // Tranquility
  "1236574": 5, // Tranquility (rework)
  "64843": 5, // Divine Hymn
  "421453": 6.5, // Ultimate Penitence
  "370960": 5, // Emerald Communion
};

export function buildMatchContext(
  combat: AtomicArenaCombat,
  friends: ICombatUnit[],
  enemies: ICombatUnit[],
  options: { useTimelinePrompt?: boolean; owner?: ICombatUnit } = {},
): string {
  const { useTimelinePrompt = false } = options;
  const durationSeconds = (combat.endTime - combat.startTime) / 1000;

  // Find the log owner (the player who recorded the log), unless overridden
  const owner =
    options.owner ??
    friends.find((p) => p.id === combat.playerId) ??
    friends[0];
  if (!owner) return "";

  const ownerSpec = specToString(owner.spec);
  const healer = isHealerSpec(owner.spec);

  const myTeam = friends.map((p) => specToString(p.spec)).join(", ");
  const enemyTeam = enemies.map((p) => specToString(p.spec)).join(", ");

  // Arena map name — lets the model apply its own knowledge of the map's pillar/LoS layout
  const zoneName = zoneMetadata[String(combat.startInfo?.zoneId)]?.name;
  const mapSuffix = zoneName ? `  |  Map: ${zoneName}` : "";

  // Match result — OWNER 视角(非记录者视角):shuffle 轮次里 owner 可能不是记录者,
  // 用 recorder 的 playerTeamId 会把胜负写反(2026-07-11 基线 eval 001 场实锤)
  const combatAny = combat as unknown as Record<string, unknown>;
  const perspectiveTeamId = owner?.info?.teamId ?? combat.playerTeamId;
  const playerWon =
    typeof combatAny["winningTeamId"] === "string" && perspectiveTeamId != null
      ? combatAny["winningTeamId"] === String(perspectiveTeamId)
      : null;
  const resultStr =
    playerWon === true ? "Win" : playerWon === false ? "Loss" : "Unknown";

  // Deaths
  const friendlyDeaths = friends
    .filter((p) => p.deathRecords.length > 0)
    .flatMap((p) =>
      p.deathRecords.map((d) => ({
        spec: specToString(p.spec),
        name: p.name,
        atSeconds: (d.timestamp - combat.startTime) / 1000,
      })),
    )
    .sort((a, b) => a.atSeconds - b.atSeconds);

  const enemyDeaths = enemies
    .filter((p) => p.deathRecords.length > 0)
    .flatMap((p) =>
      p.deathRecords.map((d) => ({
        spec: specToString(p.spec),
        name: p.name,
        atSeconds: (d.timestamp - combat.startTime) / 1000,
      })),
    )
    .sort((a, b) => a.atSeconds - b.atSeconds);

  // Compute all feature data upfront
  const cooldowns = extractMajorCooldowns(owner, combat);
  // B126: Evoker Stasis load/release/expiry + stored-spell contents. The timeline already renders
  // [STASIS STORED] / [YOU] [STASIS RELEASE] → contents, but the events were never computed here, so
  // "incomplete Stasis" / "ended holding stored heals" findings were previously unverifiable.
  const stasisEvents = extractStasisEvents(owner, combat);
  const teammateCooldowns = friends
    .filter((p) => p.id !== owner.id)
    .map((p) => ({ player: p, cds: extractMajorCooldowns(p, combat) }));
  const enemyCDTimeline = reconstructEnemyCDTimeline(
    enemies,
    combat,
    owner,
    friends,
  );
  // Annotate defensive timing labels now that we have the enemy CD timeline
  annotateDefensiveTimings(
    cooldowns,
    owner,
    combat,
    enemyCDTimeline as IEnemyCDTimelineForTiming,
  );
  teammateCooldowns.forEach(({ player, cds }) =>
    annotateDefensiveTimings(
      cds,
      player,
      combat,
      enemyCDTimeline as IEnemyCDTimelineForTiming,
    ),
  );
  const pressureWindows = computePressureWindows(friends, combat);
  const overlappedDefensives = detectOverlappedDefensives(friends, combat);
  const panicDefensives = detectPanicDefensives(friends, enemies, combat);
  const healingGaps = healer
    ? detectHealingGaps(owner, friends, enemies, combat)
    : [];
  const offensiveWindows = computeOffensiveWindows(enemies, friends, combat);
  const killWindowTargetEvals = analyzeKillWindowTargetSelection(
    offensiveWindows,
    enemies as ICombatUnit[],
    combat,
  );
  const dispelSummary = reconstructDispelSummary(friends, enemies, combat);
  // 反向视角:敌方给自己队友解(消费同一谓词,双向对称)
  const enemyDispelSummary = reconstructDispelSummary(
    enemies,
    friends,
    combat,
    Object.values(combat.units ?? {}).filter(
      (u) => u.ownerId && enemies.some((e) => e.id === u.ownerId),
    ),
  );
  // 敌方宠物/守卫(ownerId ∈ 敌方玩家):其 CC 也必须进 CC 管线
  const enemyPlayerIds = new Set(enemies.map((e) => e.id));
  const enemyPets = Object.values(combat.units ?? {}).filter(
    (u) => u.ownerId && enemyPlayerIds.has(u.ownerId),
  );
  const ccTrinketSummaries = friends.map((p) =>
    analyzePlayerCCAndTrinket(p, enemies, combat, enemyPets),
  );
  const outgoingCCChains = analyzeOutgoingCCChains(
    friends as ICombatUnit[],
    enemies as ICombatUnit[],
    combat,
  );
  const healerUnit = friends.find((p) => isHealerSpec(p.spec)) as
    ICombatUnit | undefined;
  const healerCCSummary = healerUnit
    ? ccTrinketSummaries.find((s) => s.playerName === healerUnit.name)
    : undefined;
  const healerExposures =
    healerUnit && healerCCSummary
      ? analyzeHealerExposureAtBurst(
          enemyCDTimeline.alignedBurstWindows,
          enemies as ICombatUnit[],
          healerUnit,
          healerCCSummary,
          ccTrinketSummaries,
          combat.startInfo.zoneId,
          combat.startTime,
        )
      : [];

  const deathOutcome = buildDeathOutcomeSummary(
    { startTime: combat.startTime, zoneId: combat.startInfo?.zoneId },
    friends as ICombatUnit[],
    ccTrinketSummaries,
  );
  const offensiveWaste = buildOffensiveWasteSummary(
    combat,
    friends as ICombatUnit[],
    enemies as ICombatUnit[],
  );

  // Signal 3: escalate missed purges that fell inside a friendly kill window
  annotateMissedPurgesWithKillWindows(
    dispelSummary.missedPurgeWindows,
    offensiveWindows,
  );

  // Healer offense V1 (slack-gated facts) — healer log owners only
  const ownerCCSummary = ccTrinketSummaries.find(
    (s) => s.playerName === owner.name,
  );
  const friendlyPets = Object.values(combat.units ?? {}).filter(
    (u) => u.ownerId && friends.some((f) => f.id === u.ownerId),
  );
  // 全部敌人的受控摘要(2026-07-18 覆盖修复):我方(队友/宠物)打到敌人身上
  // 的 CC 此前只有大 CD 目录内的施法行可见 —— [CC ON ENEMY] 光环行补齐,
  // 与 [CC ON TEAM] 同一谓词(analyzePlayerCCAndTrinket)。
  const enemyCCSummaries = enemies.map((e) =>
    analyzePlayerCCAndTrinket(
      e as ICombatUnit,
      friends as ICombatUnit[],
      combat,
      friendlyPets,
    ),
  );
  const enemyHealerUnit = enemies.find((e) => isHealerSpec(e.spec));
  const enemyHealerCCSummary = enemyHealerUnit
    ? enemyCCSummaries[enemies.indexOf(enemyHealerUnit)]
    : undefined;
  const ownerPurgeTimes = dispelSummary.ourPurges
    .filter((p) => p.sourceName === owner.name)
    .map((p) => p.timeSeconds);
  const healerOffense =
    healer && HEALER_OFFENSE_FLAGS.V1_SLACK_GATED
      ? buildHealerOffenseSummary(
          combat,
          owner,
          friends as ICombatUnit[],
          enemies as ICombatUnit[],
          offensiveWindows,
          enemyCDTimeline,
          ownerCCSummary?.ccInstances ?? [],
          enemyHealerCCSummary?.ccInstances ?? [],
          ownerPurgeTimes,
        )
      : null;

  const healerCCReceived: IHealerCCReceived[] =
    healerUnit && healerCCSummary
      ? buildHealerCCReceivedEvents(
          combat,
          healerUnit,
          friends as ICombatUnit[],
          healerCCSummary,
        )
      : [];

  const matchArchetype = computeMatchArchetype(
    friends as ICombatUnit[],
    enemies as ICombatUnit[],
    combat,
    ccTrinketSummaries,
    enemyCDTimeline.alignedBurstWindows,
    healerExposures,
  );

  // ── ARCHETYPE INJECTION ──────────────────────────────────────────────────
  // Classify this match into a global game-situation archetype and produce a
  // [MATCH TYPE: label] header. Returns '' for unsupported brackets, short
  // rounds (<30s), or noise clusters (one-sided fast wins).
  const ownTeamCCEventsTotal = outgoingCCChains.reduce(
    (s, c) => s + c.applications.length,
    0,
  );
  const archetypeHeader = buildArchetypeInjectionHeader(
    combat.startInfo.bracket,
    {
      burstWindowCount: matchArchetype.burstWindowCount,
      ccEventsPerMinute: matchArchetype.ccEventsPerMinute,
      tunnelScore: matchArchetype.friendlyDamageShare[0]?.share ?? 0,
      peakBurstScore: matchArchetype.peakBurstScore,
      criticalOrExposedBurstWindows:
        matchArchetype.criticalOrExposedBurstWindows ?? 0,
      durationSeconds,
      ownTeamCCPerMin:
        durationSeconds > 0 ? (ownTeamCCEventsTotal / durationSeconds) * 60 : 0,
      burstWindowQuality: { low: 0, moderate: 0, high: 0, critical: 0 },
      enemyMeleeCount: matchArchetype.enemyMeleeCount,
      enemyRangedCount: matchArchetype.enemyRangedCount,
      setupStyle: "unknown",
      enemyTeamCCPerMin: 0,
      ownTeamSpecs: [],
      enemyTeamSpecs: [],
    },
  );

  // Identify top critical moments; constrainedTrade flag reused for CC section framing
  const { moments: criticalMoments, constrainedTrade: hasConstrainedTrade } =
    identifyCriticalMoments(
      healer,
      cooldowns,
      enemyCDTimeline,
      friendlyDeaths,
      healingGaps,
      panicDefensives,
      overlappedDefensives,
      ccTrinketSummaries,
      matchArchetype.peakDamagePressure5s,
      durationSeconds,
      friends as ICombatUnit[],
      combat.startTime,
      owner as ICombatUnit,
    );

  // F15 iterations 1–3: owner engagement-state events from real X/Y coordinates
  // (STAYED_IN / KITED during enemy bursts, MISSED_PUSH, offensive CD out of range,
  // SPLIT_PUSH during committed pushes, HEALER_TRAINED camping detection).
  const ownerCCSummaryForPosition = ccTrinketSummaries.find(
    (s) => s.playerName === owner.name,
  );
  const positionEvents = computeOwnerPositionEvents({
    owner: owner as ICombatUnit,
    enemies: enemies as ICombatUnit[],
    combat,
    burstWindows: enemyCDTimeline.alignedBurstWindows,
    ownerCooldowns: cooldowns,
    ownerCCSummary: ownerCCSummaryForPosition,
    isHealer: healer,
    ownerIsMelee: isMeleeSpec(owner.spec),
    friends: friends as ICombatUnit[],
    offensiveWindows,
    friendCCSummaries: ccTrinketSummaries,
    healerExposures,
    // B4 fix: hand the positioning analysis the same damage-spike windows the timeline's
    // [OFFENSIVE WINDOW]/[DMG SPIKE] headers render, so burst-target claims cannot diverge.
    spikeWindows: pressureWindows
      .filter((pw) => pw.totalDamage >= DMG_SPIKE_THRESHOLD)
      .map((pw) => ({
        fromSeconds: pw.fromSeconds,
        toSeconds: pw.toSeconds,
        targetName: pw.targetName,
      })),
  });
  const positionLines = formatPositionEventsForContext(positionEvents);

  // Purge responsibility attribution
  const ownerCanPurge = canOffensivePurge(owner as ICombatUnit);
  const teamPurgers = friends
    .filter((p) => p.id !== owner.id && canOffensivePurge(p as ICombatUnit))
    .map((p) => specToString(p.spec));

  if (useTimelinePrompt) {
    const allTeamCDsWithSpec = teammateCooldowns.map(({ player, cds }) => ({
      player: player as ICombatUnit,
      spec: specToString(player.spec),
      cds,
    }));

    const tLines: string[] = [];
    if (archetypeHeader) {
      tLines.push(archetypeHeader);
      tLines.push("");
    }
    tLines.push("ARENA MATCH — ANALYSIS REQUEST");
    tLines.push("");
    tLines.push("MATCH FACTS");
    tLines.push(
      `  Spec: ${ownerSpec}${healer ? " (Healer)" : ""}  |  Bracket: ${combat.startInfo.bracket}  |  Result: ${resultStr}  |  Duration: ${fmtTime(durationSeconds)}${mapSuffix}`,
    );
    tLines.push(`  My team: ${myTeam}`);
    tLines.push(`  Enemy team: ${enemyTeam}`);
    tLines.push("");

    tLines.push("PURGE RESPONSIBILITY");
    tLines.push(
      `  Log owner (${ownerSpec}): ${ownerCanPurge ? "CAN offensive purge" : "CANNOT offensive purge"}`,
    );
    tLines.push(
      `  Team purgers: ${teamPurgers.length > 0 ? teamPurgers.join(", ") : "none"}`,
    );

    const baselineLines = formatSpecBaselines(ownerSpec, cooldowns, benchmarks);
    if (baselineLines.length > 0) {
      tLines.push("");
      baselineLines.forEach((l) => tLines.push(l));
    }

    const dtpsLines = formatDTPSBaselines(
      friends.map((p) => specToString(p.spec)),
      benchmarks,
    );
    if (dtpsLines.length > 0) {
      tLines.push("");
      dtpsLines.forEach((l) => tLines.push(l));
    }

    tLines.push("");
    formatDampeningForContext(
      combat.startInfo.bracket,
      [...friends, ...enemies],
      combat.startTime,
      combat.endTime,
    ).forEach((l) => tLines.push(l));

    // The timeline path returns early and never reaches the critical-moments render
    // section below — the healer_offense block must be emitted in BOTH paths.
    if (healerOffense) {
      const healerOffenseTimelineLines =
        formatHealerOffenseForContext(healerOffense);
      if (healerOffenseTimelineLines.length > 0) {
        tLines.push("");
        tLines.push("<healer_offense>");
        healerOffenseTimelineLines.forEach((l) => tLines.push(l));
        tLines.push("</healer_offense>");
      }
    }

    tLines.push("");
    const {
      text: loadoutText,
      playerIdMap,
      enemyIdMap,
    } = buildPlayerLoadout(
      owner as ICombatUnit,
      ownerSpec,
      cooldowns,
      allTeamCDsWithSpec,
      enemyCDTimeline,
      enemies as ICombatUnit[],
    );
    tLines.push(loadoutText);

    // Healer exposure at burst windows (LoS/pillar + DR + trinket state). The enemy CC kit
    // is static for the match, so it is stated once here as match-level context; the
    // per-window entries are merged inline into the timeline below so each exposure sits
    // chronologically next to the burst it belongs to (2026-07-09 week-eval:
    // inferenceScaffolding regression from the after-timeline block position).
    const enemyCCKitLines = formatEnemyCCKitHeader(healerExposures);
    if (enemyCCKitLines.length > 0) {
      tLines.push("");
      enemyCCKitLines.forEach((l) => tLines.push(l));
    }

    const timelineText = buildMatchTimeline({
      owner: owner as ICombatUnit,
      ownerSpec,
      ownerCDs: cooldowns,
      teammateCDs: allTeamCDsWithSpec,
      enemyCDTimeline,
      ccTrinketSummaries,
      dispelSummary,
      enemyDispelSummary,
      enemyCCSummaries,
      friendlyDeaths,
      enemyDeaths,
      pressureWindows,
      healingGaps,
      friends: friends as ICombatUnit[],
      enemies: enemies as ICombatUnit[],
      allUnits: Object.values(combat.units),
      matchStartMs: combat.startTime,
      matchEndMs: combat.endTime,
      isHealer: healer,
      playerIdMap,
      enemyIdMap,
      outgoingCCChains,
      bracket: combat.startInfo.bracket,
      stasisEvents,
    } as BuildMatchTimelineParams);

    // Merge each per-window exposure entry into the timeline at its timestamp so the
    // cause (burst + exposure state) sits next to its effects (CC landing, damage,
    // defensive responses) instead of in a block after the timeline.
    const exposureInserts = formatHealerExposureEntries(healerExposures).map(
      (entry) => ({
        atSeconds: entry.atSeconds,
        line: `${fmtTime(entry.atSeconds)}  ${entry.line}`,
      }),
    );
    tLines.push("");
    tLines.push(
      mergeTimestampedLines(timelineText.split("\n"), exposureInserts).join(
        "\n",
      ),
    );

    if (positionLines.length > 0) {
      tLines.push("");
      positionLines.forEach((l) => tLines.push(l));
    }

    // R1(E2E 回归修复):死亡结局块——队友在你死亡时可用未放的救人外置
    // (Pain Suppression / Lay on Hands)+ 死者当时可用的免疫。此前该块只在下方
    // sparse 路径 append,timeline 分支在此 return 前从不渲染(E2E 实测旧 139 场→新 0)。
    const deathOutcomeBlockTimeline =
      formatDeathOutcomeForContext(deathOutcome);
    if (deathOutcomeBlockTimeline) {
      tLines.push("");
      tLines.push(deathOutcomeBlockTimeline);
    }

    // R3(E2E 回归修复):进攻技能打进免疫/DR 块。此前该块也只在下方 sparse 路径 append。
    const offensiveWasteBlockTimeline =
      formatOffensiveWasteForContext(offensiveWaste);
    if (offensiveWasteBlockTimeline) {
      tLines.push("");
      tLines.push(offensiveWasteBlockTimeline);
    }

    return tLines.join("\n");
  }

  const lines: string[] = [];

  if (archetypeHeader) {
    lines.push(archetypeHeader);
    lines.push("");
  }

  // ── MATCH SUMMARY ──────────────────────────────────────────────────────────
  lines.push("ARENA MATCH — DECISION ANALYSIS REQUEST");
  lines.push("");
  lines.push("MATCH SUMMARY");
  lines.push(
    `  Spec: ${ownerSpec}${healer ? " (Healer)" : ""}  |  Bracket: ${combat.startInfo.bracket}  |  Result: ${resultStr}  |  Duration: ${fmtTime(durationSeconds)}${mapSuffix}`,
  );
  lines.push(`  My team: ${myTeam}`);
  lines.push(`  Enemy team: ${enemyTeam}`);
  const deathParts = [
    ...friendlyDeaths.map(
      (d) => `${d.spec} (my team, ${fmtTime(d.atSeconds)})`,
    ),
    ...enemyDeaths.map((d) => `${d.spec} (enemy, ${fmtTime(d.atSeconds)})`),
  ];
  lines.push(
    `  Deaths: ${deathParts.length > 0 ? deathParts.join(", ") : "None"}`,
  );
  // B139: surface the log owner's talent-granted PvP toolkit (magic/CC immunity, dispel, CC-dodge, mobility)
  // so the coach can reason about talent-based options and not recommend abilities the player didn't spec.
  // A castable tool never used in the match is tagged [UNUSED]. (Present in the timeline path via the loadout;
  // this adds it to the production critical-moments path.)
  const ownerCastIds = new Set<string>();
  for (const e of owner.spellCastEvents ?? [])
    if (e.spellId) ownerCastIds.add(e.spellId);
  const pvpToolkit = getPvpToolkit(owner.info?.pvpTalents, ownerCastIds);
  if (pvpToolkit.length > 0) {
    lines.push(
      `  Your PvP toolkit: ${pvpToolkit.map((t) => (t.used === false ? `${t.label} [UNUSED]` : t.label)).join(", ")}`,
    );
  }
  // F173: utility-cast value annotations — HP-only cost/benefit can't see these, so state them.
  // (a) Rescue (370665) that removed a root/snare on the ally <=1.5s after landing = offensive/peel
  //     utility, not a wasted heal-CD (21% of corpus Rescues; verified 4b3025aa audit).
  // (b) Chain Heal (1064) repeatedly landing on SELF for a Resto Shaman is usually the no-target UI
  //     fallback, not a decision — surface it once so the coach recommends a mouseover/focus macro.
  const spellsJson = SPELL_CATEGORIES as Record<string, { type: string }>;
  const rescueNotes: string[] = [];
  let selfChainHeals = 0;
  let chainHeals = 0;
  for (const e of owner.spellCastEvents ?? []) {
    if (e.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
    if (e.spellId === "370665") {
      const ally = friends.find((u) => u.id === e.destUnitId);
      const rootGone = ally?.auraEvents.some(
        (a) =>
          a.spellId &&
          /root|snare|cc/.test(spellsJson[a.spellId]?.type ?? "") &&
          (a.logLine.event === LogEvent.SPELL_AURA_REMOVED ||
            a.logLine.event === LogEvent.SPELL_AURA_BROKEN) &&
          a.logLine.timestamp - e.logLine.timestamp >= 0 &&
          a.logLine.timestamp - e.logLine.timestamp <= 1500,
      );
      if (rootGone && ally) {
        rescueNotes.push(
          `${fmtTime((e.logLine.timestamp - combat.startTime) / 1000)} Rescue freed ${ally.name} from a root/snare`,
        );
      }
    }
    if (e.spellId === "1064") {
      chainHeals++;
      if (e.destUnitId === owner.id) selfChainHeals++;
    }
  }
  if (rescueNotes.length > 0) {
    lines.push(
      `  Utility value: ${rescueNotes.join("; ")} (repositioning/root-break utility — do not judge these casts on HP alone).`,
    );
  }
  if (chainHeals >= 5 && selfChainHeals / chainHeals >= 0.5) {
    lines.push(
      `  NOTE: ${selfChainHeals}/${chainHeals} Chain Heals landed on the caster — likely the no-target self-fallback, not deliberate self-priority; a mouseover/focus macro fixes the default target.`,
    );
  }

  // B141 port: flag the owner's major channels kicked/CC'd mid-cast (largely wasted) — the timeline
  // path shows this per-cast, but the production critical-moments path otherwise only sees the cast.
  const ownerCCForChannels = ccTrinketSummaries.find(
    (s) => s.playerName === owner.name,
  );
  const interruptedChannels: string[] = [];
  for (const cast of owner.spellCastEvents) {
    if (cast.logLine.event !== LogEvent.SPELL_CAST_SUCCESS || !cast.spellId)
      continue;
    const dur = CHANNELED_HEAL_CD_DURATIONS[cast.spellId];
    if (dur === undefined) continue;
    const t = (cast.timestamp - combat.startTime) / 1000;
    if (channelWasInterrupted(ownerCCForChannels, t, t + dur)) {
      interruptedChannels.push(
        `${getEnglishSpellName(cast.spellId, cast.spellName)} at ${fmtTime(t)}`,
      );
    }
  }
  if (interruptedChannels.length > 0) {
    lines.push(
      `  Channels interrupted (a major channel was kicked/CC'd mid-cast — largely wasted): ${interruptedChannels.join(", ")}`,
    );
  }
  lines.push("");
  formatMatchArchetypeForContext(matchArchetype).forEach((l) => lines.push(l));

  // ── MATCH ARC ──────────────────────────────────────────────────────────────
  lines.push("");
  const allTeamCooldownsWithPlayer = [
    ...cooldowns.map((cd) => ({ player: owner as ICombatUnit, cd })),
    ...teammateCooldowns.flatMap(({ player, cds }) =>
      cds.map((cd) => ({ player: player as ICombatUnit, cd })),
    ),
  ];
  buildMatchArc(
    enemyCDTimeline,
    allTeamCooldownsWithPlayer,
    friendlyDeaths,
    durationSeconds,
    combat.startInfo.bracket,
  ).forEach((l) => lines.push(l));

  // ── CRITICAL MOMENTS ───────────────────────────────────────────────────────
  lines.push(
    "CRITICAL MOMENTS (interpret as a sequence where earlier events constrain later options):",
  );
  lines.push("");

  if (criticalMoments.length === 0) {
    lines.push("  No critical moments identified from available data.");
  } else {
    criticalMoments.forEach((m, i) => {
      const impactStr =
        m.roleLabel === "Constraint"
          ? "Context-setting — not a mistake"
          : m.impactLabel;
      lines.push(
        `--- MOMENT ${i + 1} [${m.roleLabel}] (impact: ${impactStr}) ---`,
      );
      lines.push(`${fmtTime(m.timeSeconds)} — ${m.title}`);
      lines.push(`  Enemy state: ${m.enemyState}`);

      if (m.roleLabel === "Constraint") {
        lines.push(
          `  NOTE: This moment is not a mistake. It defines the resource constraints for the rest of the match.`,
        );
        lines.push(`  What happened: ${m.whatHappened}`);
        if (m.implication && m.implication.length > 0) {
          lines.push(`  Implication:`);
          m.implication.forEach((l) => lines.push(`    - ${l}`));
        }
      } else {
        if (m.roleLabel !== "Kill") {
          lines.push(`  Friendly state: ${m.friendlyState}`);
          if (
            !m.isDeath &&
            m.contributingDeathSpec !== undefined &&
            m.contributingDeathAtSeconds !== undefined
          ) {
            const deltaSeconds = Math.round(
              m.contributingDeathAtSeconds - m.timeSeconds,
            );
            lines.push(
              `  ⚠ Contributing factor: ${m.contributingDeathSpec} died ${deltaSeconds}s later at ${fmtTime(m.contributingDeathAtSeconds)}`,
            );
            if (m.roleLabel === "Setup") {
              lines.push(
                `  → This committed resources ${deltaSeconds}s before they were needed at the kill window.`,
              );
            } else if (m.roleLabel === "Consequence") {
              lines.push(
                `  → Resources were already depleted from an earlier commitment — ${deltaSeconds}s gap to the death.`,
              );
            }
          }
        }
        lines.push(`  What happened: ${m.whatHappened}`);
        if (m.rootCauseTrace && m.rootCauseTrace.length > 0) {
          lines.push(
            `  Root cause trace (why the death happened — trace back from here):`,
          );
          m.rootCauseTrace.forEach((t) => lines.push(`    - ${t}`));
        }
      }

      // Kill moments: use three-tier options; others: flat list or legacy availableOptions
      if (m.roleLabel === "Kill" && m.tieredOptions) {
        const { realistic, limited, unavailable } = m.tieredOptions;
        if (
          realistic.length > 0 ||
          limited.length > 0 ||
          unavailable.length > 0
        ) {
          lines.push(
            `  Possible responses (given constraints from earlier moments):`,
          );
          if (realistic.length > 0) {
            lines.push(`    Realistic options:`);
            realistic.forEach((o) => lines.push(`      - ${o}`));
          }
          if (limited.length > 0) {
            lines.push(`    Limited options:`);
            limited.forEach((o) => lines.push(`      - ${o}`));
          }
          if (unavailable.length > 0) {
            lines.push(`    Unavailable:`);
            unavailable.forEach((o) => lines.push(`      - ${o}`));
          }
        }
      } else if (
        m.mechanicalAvailability.length > 0 ||
        m.interpretation.length > 0
      ) {
        lines.push(
          `  Possible responses at this moment (given constraints from earlier moments):`,
        );
        if (m.mechanicalAvailability.length > 0) {
          lines.push(`    Mechanical availability:`);
          m.mechanicalAvailability.forEach((a) => lines.push(`      - ${a}`));
        }
        if (m.interpretation.length > 0) {
          lines.push(`    Interpretation:`);
          m.interpretation.forEach((interp) => lines.push(`      - ${interp}`));
        }
      } else if (m.roleLabel !== "Constraint" && m.roleLabel !== "Kill") {
        lines.push(`  Available options: ${m.availableOptions}`);
      }

      if (m.finalAssessment) {
        lines.push(`  Structural context:`);
        lines.push(`    - ${m.finalAssessment.macroOutcome}`);
        if (m.finalAssessment.microMistakes.length > 0) {
          lines.push(`    Micro-level opportunities:`);
          m.finalAssessment.microMistakes.forEach((mm) =>
            lines.push(`      - ${mm}`),
          );
        }
      }

      lines.push(`  Uncertainty: ${m.uncertainty}`);
      lines.push("");
    });
  }

  // ── SUPPORTING DATA ────────────────────────────────────────────────────────
  lines.push("SUPPORTING DATA (for reference when evaluating moments above):");

  // Purge responsibility — explicit attribution so Claude doesn't blame wrong player
  lines.push("");
  lines.push("PURGE RESPONSIBILITY:");
  if (ownerCanPurge) {
    lines.push(`  Log owner (${ownerSpec}): CAN offensive purge`);
  } else {
    lines.push(
      `  Log owner (${ownerSpec}): CANNOT offensive purge — do not attribute missed purges to the log owner`,
    );
  }
  lines.push(
    teamPurgers.length > 0
      ? `  Team offensive purgers: ${teamPurgers.join(", ")}`
      : "  Team offensive purgers: None (no teammate has an offensive purge ability)",
  );

  const baselineLines = formatSpecBaselines(ownerSpec, cooldowns, benchmarks);
  if (baselineLines.length > 0) {
    lines.push("");
    baselineLines.forEach((l) => lines.push(l));
  }

  // Owner cooldowns
  lines.push("");
  lines.push(`COOLDOWN USAGE — LOG OWNER (${ownerSpec}) — major CDs ≥30s:`);
  if (cooldowns.length === 0) {
    lines.push("  No major cooldown data found for this spec.");
  } else {
    cooldowns.forEach((cd) => {
      lines.push("");
      const chargesSuffix =
        cd.maxChargesDetected > 1 ? `, ${cd.maxChargesDetected} Charges` : "";
      lines.push(
        `  ${cd.spellName} [${cd.tag}, ${cd.cooldownSeconds}s CD${chargesSuffix}]:`,
      );
      if (cd.neverUsed) {
        lines.push(`    STATUS: NEVER USED`);
      } else {
        cd.casts.forEach((c) => {
          const timing =
            c.timingLabel && c.timingLabel !== "Unknown"
              ? ` [${c.timingLabel.toUpperCase()}${c.timingContext ? ` — ${c.timingContext}` : ""}]`
              : "";
          lines.push(`    Cast at: ${fmtTime(c.timeSeconds)}${timing}`);
        });
      }
      if (cd.availableWindows.length > 0) {
        lines.push(
          `    Pressure correlation (counterfactual unknown — not evidence of missed opportunity):`,
        );
        cd.availableWindows.forEach((w) => {
          const overlapping = pressureWindows.filter(
            (p) => p.fromSeconds < w.toSeconds && p.toSeconds > w.fromSeconds,
          );
          const pressureNote =
            overlapping.length > 0
              ? ` — pressure during idle: ${overlapping.map((p) => `${fmtTime(p.fromSeconds)} (${(p.totalDamage / 1_000_000).toFixed(2)}M on ${p.targetSpec})`).join(", ")}`
              : "";
          lines.push(
            `      ${fmtTime(w.fromSeconds)}–${fmtTime(w.toSeconds)} (${Math.round(w.durationSeconds)}s)${pressureNote}`,
          );
        });
      }
    });
  }

  // Trinket timestamps for log owner (sourced from ccTrinketAnalysis — not in major CD list)
  const ownerTrinket = ccTrinketSummaries.find(
    (s) => s.playerName === owner.name,
  );
  if (ownerTrinket && ownerTrinket.trinketType !== "Unknown") {
    const trinketLabel =
      ownerTrinket.trinketType === "Relentless"
        ? "Relentless (passive)"
        : `${ownerTrinket.trinketType} trinket [${ownerTrinket.trinketCooldownSeconds}s CD]`;
    if (ownerTrinket.trinketUseTimes.length === 0) {
      lines.push("");
      lines.push(`  PvP Trinket — ${trinketLabel}: STATUS: NEVER USED`);
    } else {
      lines.push("");
      lines.push(
        `  PvP Trinket — ${trinketLabel}: cast at ${ownerTrinket.trinketUseTimes.map(fmtTime).join(", ")}`,
      );
    }
    if (ownerTrinket.missedTrinketWindows.length > 0) {
      const totalDmg = ownerTrinket.missedTrinketWindows.reduce(
        (s, w) => s + w.damageTakenDuring,
        0,
      );
      lines.push(
        `    ⚠ ${ownerTrinket.missedTrinketWindows.length} missed trinket window(s) — ${Math.round(totalDmg / 1000)}k dmg while trinket available`,
      );
    }
  }

  // Teammate cooldowns
  if (teammateCooldowns.length > 0) {
    lines.push("");
    lines.push("TEAMMATE COOLDOWNS:");
    for (const { player, cds } of teammateCooldowns) {
      const spec = specToString(player.spec);
      if (cds.length === 0) {
        lines.push(`  ${spec} (${player.name}): No major CD data.`);
        continue;
      }
      lines.push(`  ${spec} (${player.name}):`);
      for (const cd of cds) {
        if (cd.neverUsed) {
          const tmChargesSuffix =
            cd.maxChargesDetected > 1
              ? `, ${cd.maxChargesDetected} Charges`
              : "";
          lines.push(
            `    ${cd.spellName} [${cd.cooldownSeconds}s CD${tmChargesSuffix}]: NEVER USED`,
          );
        } else {
          const tmChargesSuffix =
            cd.maxChargesDetected > 1
              ? `, ${cd.maxChargesDetected} Charges`
              : "";
          const castStr = cd.casts
            .map((c) => fmtTime(c.timeSeconds))
            .join(", ");
          const idleStr =
            cd.availableWindows.length > 0
              ? ` | idle: ${cd.availableWindows.map((w) => `${fmtTime(w.fromSeconds)}–${fmtTime(w.toSeconds)}`).join(", ")}`
              : "";
          lines.push(
            `    ${cd.spellName} [${cd.cooldownSeconds}s CD${tmChargesSuffix}]: cast at ${castStr}${idleStr}`,
          );
        }
      }
    }
  }

  lines.push("");
  formatEnemyCDTimelineForContext(enemyCDTimeline, durationSeconds).forEach(
    (l) => lines.push(l),
  );

  lines.push("");
  formatOverlappedDefensivesForContext(overlappedDefensives).forEach((l) =>
    lines.push(l),
  );

  lines.push("");
  formatPanicDefensivesForContext(panicDefensives).forEach((l) =>
    lines.push(l),
  );

  lines.push("");
  formatDispelContextForAI(dispelSummary).forEach((l) => lines.push(l));
  formatEnemyDispelsForContext(enemyDispelSummary).forEach((l) =>
    lines.push(l),
  );

  if (healer) {
    lines.push("");
    formatHealingGapsForContext(healingGaps).forEach((l) => lines.push(l));
  }

  // Suppress ENEMY VULNERABILITY WINDOWS for healer log owners when no friendly offensive CDs
  // are tracked — every window would say "friendly offensive CDs: none tracked" which is noise
  const hasAnyFriendlyOffensiveCDs = offensiveWindows.some(
    (w) => w.friendlyOffensives.length > 0,
  );
  if (!healer || hasAnyFriendlyOffensiveCDs) {
    lines.push("");
    formatOffensiveWindowsForContext(offensiveWindows).forEach((l) =>
      lines.push(l),
    );
  }

  // Skip kill window target selection when log owner is a healer — they observe but cannot enforce target choices
  if (!healer) {
    const targetSelectionLines = formatKillWindowTargetSelectionForContext(
      killWindowTargetEvals,
    );
    if (targetSelectionLines.length > 0) {
      lines.push("");
      targetSelectionLines.forEach((l) => lines.push(l));
    }
  }

  lines.push("");
  formatCCTrinketForContext(ccTrinketSummaries).forEach((l) => lines.push(l));

  const healerExposureLines = formatHealerExposureForContext(healerExposures);
  if (healerExposureLines.length > 0) {
    lines.push("");
    healerExposureLines.forEach((l) => lines.push(l));
  }

  if (positionLines.length > 0) {
    lines.push("");
    positionLines.forEach((l) => lines.push(l));
  }

  const outgoingCCLines = formatOutgoingCCChainsForContext(outgoingCCChains);
  if (outgoingCCLines.length > 0) {
    lines.push("");
    outgoingCCLines.forEach((l) => lines.push(l));
    if (hasConstrainedTrade && friendlyDeaths.length > 0) {
      lines.push(
        `  Note: CC casts in the final phase of this match had limited follow-up potential — major defensive resources were exhausted.`,
      );
    }
  }

  lines.push("");
  formatDampeningForContext(
    combat.startInfo.bracket,
    [...friends, ...enemies],
    combat.startTime,
    combat.endTime,
  ).forEach((l) => lines.push(l));

  const deathOutcomeBlock = formatDeathOutcomeForContext(deathOutcome);
  if (deathOutcomeBlock) {
    lines.push("");
    lines.push(deathOutcomeBlock);
  }

  const offensiveWasteBlock = formatOffensiveWasteForContext(offensiveWaste);
  if (offensiveWasteBlock) {
    lines.push("");
    lines.push(offensiveWasteBlock);
  }

  const healerCCBlock = formatHealerCCReceivedForContext(healerCCReceived);
  if (healerCCBlock) {
    lines.push("");
    lines.push(healerCCBlock);
  }

  if (healerOffense) {
    const healerOffenseLines = formatHealerOffenseForContext(healerOffense);
    if (healerOffenseLines.length > 0) {
      lines.push("");
      lines.push("<healer_offense>");
      healerOffenseLines.forEach((l) => lines.push(l));
      lines.push("</healer_offense>");
    }
  }

  return lines.join("\n");
}

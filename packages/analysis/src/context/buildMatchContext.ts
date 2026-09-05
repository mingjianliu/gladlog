import { AtomicArenaCombat, ICombatUnit } from "@gladlog/parser-compat";

import {
  type BurstWindowDecisionPoint,
  burstWindowDecisionPoints,
} from "../analysis/burstWindowDecisionPoints";
import {
  type CdPriorHoldEpisode,
  cdPriorHoldEpisodes,
} from "../analysis/cdTriggerPrior";
import { lookupCdTriggerPrior } from "../data/cdTriggerPrior";
import { zoneMetadata } from "../data/zoneMetadata";
import { buildArchetypeInjectionHeader } from "../utils/archetypeInjection";
import {
  analyzeBurstLedger,
  auditWindowTargeting,
  formatBurstLedgerForContext,
} from "../utils/burstLedger";
import { analyzeCcBreaks } from "../utils/ccBreakAnalysis";
import { analyzePlayerCCAndTrinket } from "../utils/ccTrinketAnalysis";
import { extractStasisEvents } from "../utils/combatStates";
import {
  annotateDefensiveTimings,
  computePressureWindows,
  extractMajorCooldowns,
  IEnemyCDTimelineForTiming,
  isHealerSpec,
  specToString,
} from "../utils/cooldowns";
import { isMeleeSpec } from "../utils/cooldowns";
import {
  computeMissedExternalCounterfactuals,
  computeMitigationAudit,
  computeUnusedSelfCounterfactuals,
} from "../utils/counterfactual";
import { formatDampeningForContext } from "../utils/dampening";
import {
  buildDeathOutcomeSummary,
  formatDeathOutcomeForContext,
} from "../utils/deathOutcomeAnalysis";
import {
  annotateMissedPurgesWithKillWindows,
  canOffensivePurge,
  reconstructDispelSummary,
} from "../utils/dispelAnalysis";
import { analyzeOutgoingCCChains } from "../utils/drAnalysis";
import { reconstructEnemyCDTimeline } from "../utils/enemyCDs";
import {
  computeHealerExposureEvents,
  formatEnemyCCKitHeader,
  formatHealerExposureEntries,
} from "../utils/healerExposureAnalysis";
import {
  buildHealerOffenseSummary,
  formatHealerOffenseForContext,
  HEALER_OFFENSE_FLAGS,
} from "../utils/healerOffenseAnalysis";
import { detectHealingGaps } from "../utils/healingGaps";
import { analyzeKickAudit } from "../utils/kickAudit";
import {
  extractKillAttempts,
  formatKillAttemptsForContext,
} from "../utils/killAttempts";
import {
  buildDpsKillWindowLines,
  createKillWindowFactsComputer,
} from "../utils/killWindowFacts";
import { matchMinHpPct } from "../utils/killWindowTargetSelection";
import { computeMatchArchetype } from "../utils/matchArchetype";
import {
  buildOffensiveWasteSummary,
  formatOffensiveWasteForContext,
} from "../utils/offensiveWasteAnalysis";
import { computeOffensiveWindows } from "../utils/offensiveWindows";
import {
  computeOwnerPositionEvents,
  formatPositionEventsForContext,
} from "../utils/positionAnalysis";
import { fmtTime, toRenderSecond } from "../utils/renderGrid";
import {
  computeRootReachability,
  formatRootReachabilityEntries,
} from "../utils/rootReachability";
import {
  benchmarks,
  formatDTPSBaselines,
  formatSpecBaselines,
} from "../utils/specBaselines";
import { heroBuildGroupOf } from "../utils/talents";
import { buildCriticalWindowSet } from "./criticalWindows";
import {
  formatDecisiveCounterfactualLine,
  formatMitigationAuditLine,
  lowPressureUnusedDefensiveNote,
  MITIGATION_AUDIT_INDEPENDENT_NOTE,
} from "./matchTimelineSections";
import { DMG_SPIKE_THRESHOLD, mergeTimestampedLines } from "./timelineHelpers";
import {
  buildMatchTimeline,
  BuildMatchTimelineParams,
  buildPlayerLoadout,
} from "./utils";

// ──────────────────────────────────────────────────────────────────────────────

export function buildMatchContext(
  combat: AtomicArenaCombat,
  friends: ICombatUnit[],
  enemies: ICombatUnit[],
  options: { owner?: ICombatUnit } = {},
): string {
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

  // Match result — from the OWNER's perspective, not the recorder's: in a
  // shuffle round the owner may not be the recorder, and using the recorder's
  // playerTeamId flips win/loss (proven on match 001 of the 2026-07-11
  // baseline eval)
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
  // Enemy kits go through the **same extractor** (2026-07-21 evidence-gap
  // survey, P1).
  //
  // Previously the enemy <cooldowns> listed only what was actually cast this
  // match, printing "none tracked" when nothing was cast — across the corpus
  // 805/1245 (65%) of matches had at least one enemy in that state. But the
  // section is called player_loadout, and a loadout is a kit, not a cast log:
  // the friendly side rendered the kit (living up to the name), the enemy side
  // rendered casts (not living up to it).
  //
  // For a healer coach the most valuable enemy information is precisely
  // **what they still have left**, and that is exactly the half being thrown
  // away. The data was always there: measurements show both sides carry
  // COMBATANT_INFO (75–79 talents), and extractMajorCooldowns filters enemies
  // by talent and emits [UNUSED] markers just the same — the enemy path simply
  // never called it.
  //
  // Only the render layer changes; enemyCDTimeline is untouched: its
  // offensiveCDs also feed the burst windows and [ENEMY CD] timeline events,
  // and those **must stay cast-driven** — never-cast CDs must not leak in.
  const enemyCooldowns = (enemies ?? []).map((e) => ({
    player: e,
    cds: extractMajorCooldowns(e as ICombatUnit, combat),
  }));
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
  const healingGaps = healer
    ? detectHealingGaps(owner, friends, enemies, combat)
    : [];
  const offensiveWindows = computeOffensiveWindows(enemies, friends, combat);
  // Pets/guardians on both sides (ownerId ∈ the matching players): both the CC
  // and the dispel pipelines need to see them
  const enemyPlayerIds = new Set(enemies.map((e) => e.id));
  const enemyPets = Object.values(combat.units ?? {}).filter(
    (u) => u.ownerId && enemyPlayerIds.has(u.ownerId),
  );
  const friendlyPets = Object.values(combat.units ?? {}).filter(
    (u) => u.ownerId && friends.some((f) => f.id === u.ownerId),
  );
  // Coverage-tail fix: pass pets from both sides — previously the main summary
  // had no pets, so a Felhunter's Devour Magic landed in no bucket at all, in
  // either direction (our purge / their purge).
  const dispelSummary = reconstructDispelSummary(
    friends,
    enemies,
    combat,
    friendlyPets,
    enemyPets,
  );
  // Mirror perspective: the enemy dispelling their own teammates (consumes the
  // same predicate, symmetric in both directions)
  const enemyDispelSummary = reconstructDispelSummary(
    enemies,
    friends,
    combat,
    enemyPets,
    friendlyPets,
  );
  const ccTrinketSummaries = friends.map((p) =>
    analyzePlayerCCAndTrinket(p, enemies, combat, enemyPets),
  );
  // BACKLOG #36(e): CC-break attribution. `analyzeCcBreaks` has carried the
  // full who-broke-whose-CC attribution since 2026-08-02 (the log's own ground
  // truth — SPELL_AURA_BROKEN_SPELL's src IS the breaker), but only the
  // desktop dashboard consumed it; the prompt never saw it. The teachable
  // bucket is friendlySquander: OUR damage breaking CC our side had landed on
  // an enemy, prefiltered to >= CC_BREAK_REPORT_MIN_REMAINING_S remaining.
  const ccBreakStats = analyzeCcBreaks(
    friends as ICombatUnit[],
    enemies as ICombatUnit[],
    combat,
    friendlyPets as ICombatUnit[],
    enemyPets as ICombatUnit[],
  );
  const outgoingCCChains = analyzeOutgoingCCChains(
    friends as ICombatUnit[],
    enemies as ICombatUnit[],
    combat,
  );
  // Critical windows are built here exactly once and shared by every
  // downstream HP consumer — see criticalWindows.ts.
  const criticalWindowSeconds = buildCriticalWindowSet({
    friendlyDeaths,
    enemyDeaths,
    pressureWindows,
    ccTrinketSummaries,
    matchDurationSeconds: durationSeconds,
  });
  const healerUnit = friends.find((p) => isHealerSpec(p.spec)) as
    ICombatUnit | undefined;
  // Single-source orchestration (#4): hand the orchestrator the pieces already
  // computed here (alignedBurstWindows / ccTrinketSummaries / healerUnit) as
  // precomputed inputs instead of recomputing them — when the renderer passes
  // nothing, the same orchestrator takes its self-compute branch, so both
  // paths converge on the same analyzeHealerExposureAtBurst.
  const healerExposures = computeHealerExposureEvents(combat, {
    alignedBurstWindows: enemyCDTimeline.alignedBurstWindows,
    ccTrinketSummaries,
    healerUnit,
    friends,
    enemies,
  });

  // Feed the **resolved** cooldowns (the very values the [RES] ledger renders)
  // into the death block's availability test — otherwise the two places use
  // separate constants and one prompt states opposite conclusions about the
  // same cooldown (class D).
  const resolvedCdByUnit = new Map<string, Map<string, number>>();
  for (const { player, cds } of [
    { player: owner as ICombatUnit, cds: cooldowns },
    ...teammateCooldowns,
  ]) {
    const bySpell = new Map<string, number>();
    for (const cd of cds) bySpell.set(cd.spellId, cd.cooldownSeconds);
    resolvedCdByUnit.set(player.id, bySpell);
  }

  const deathOutcome = buildDeathOutcomeSummary(
    { startTime: combat.startTime, zoneId: combat.startInfo?.zoneId },
    friends as ICombatUnit[],
    ccTrinketSummaries,
    (unit, spellId) => resolvedCdByUnit.get(unit.id)?.get(spellId),
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
  // CC-received summaries for every enemy (2026-07-18 coverage fix): CC our
  // side (teammates/pets) landed on enemies used to be visible only through
  // cast lines inside the major-CD catalogue — the [CC ON ENEMY] aura lines
  // fill that in, under the same predicate as [CC ON TEAM]
  // (analyzePlayerCCAndTrinket).
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

  // DPS owner (D2): the burst-ledger block — the counterpart of
  // healer_offense. Its predicates are exactly the ones the report card uses
  // (analyzeBurstLedger / auditWindowTargeting / analyzeKickAudit); a healer
  // owner never enters this branch, so healer prompts are byte-identical.
  if (!healer) {
    const ledgerLines = formatBurstLedgerForContext(
      analyzeBurstLedger(
        owner as ICombatUnit,
        friends.filter((p) => p.id !== owner.id) as ICombatUnit[],
        enemies as ICombatUnit[],
        combat,
      ),
      auditWindowTargeting(
        owner as ICombatUnit,
        offensiveWindows,
        enemies as ICombatUnit[],
        combat,
      ),
      analyzeKickAudit(owner as ICombatUnit, enemies as ICombatUnit[], combat),
    );
    if (ledgerLines.length > 0) {
      tLines.push("");
      tLines.push("<burst_ledger>");
      ledgerLines.forEach((l) => tLines.push(l));
      tLines.push("</burst_ledger>");
    }
    // GH #31 ③ (2026-09-02, user-ruled): the DPS view gets the kill-window
    // facts too — a lean block sharing the healer view's span set and the
    // SAME gate-facts computer (killWindowFacts.ts), without the healer-only
    // owner-CC/slack fields. Same [VULNERABLE] accountability gate.
    const kwLines = buildDpsKillWindowLines(
      offensiveWindows,
      enemies as ICombatUnit[],
      createKillWindowFactsComputer(
        combat,
        friends as ICombatUnit[],
        enemies as ICombatUnit[],
      ),
    );
    if (kwLines.length > 0) {
      tLines.push("");
      tLines.push("<kill_windows>");
      tLines.push(
        "KILL WINDOWS (enemy vulnerability spans — team facts, not verdicts):",
      );
      kwLines.forEach((l) => tLines.push(l));
      tLines.push("</kill_windows>");
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
    enemyCooldowns,
  );
  tLines.push(loadoutText);

  // Low-pressure guard note: in a round where the owner was never pressured,
  // the [UNUSED] defensive tags in the loadout are not a teaching point (same
  // predicate as the cd-waste candidate gate, see
  // lowPressureUnusedDefensiveNote).
  const unusedNoteTimeline = lowPressureUnusedDefensiveNote(
    cooldowns,
    matchMinHpPct(owner as ICombatUnit),
  );
  if (unusedNoteTimeline) tLines.push(unusedNoteTimeline);

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

  // Mitigation audit / counterfactuals (#17b Task4): extra lines attached to
  // [DEATH]. Every number is consumed from the three single-source functions
  // in Task1's counterfactual.ts — this code only fetches and formats, it
  // never re-derives mitigated/saved damage. deathS is anchored to fmtTime's
  // render grid (toRenderSecond, i.e. Math.floor) — the gate predicate is
  // the spec: the adjacent [DEATH] line and the HP trace use the same whole
  // second, so the counterfactual window's sampling instant must not quietly
  // drift off the rendered death second.
  //
  // atSeconds **must** be passed in by the caller
  // (emitFriendlyDeathEntries) for that specific death; this function must
  // not guess it by doing friendlyDeaths.find() on victimName — when the same
  // player dies twice within one combat, find() only ever hits the first
  // record, so the second death would render the first death's
  // mitigation/counterfactual numbers (a critical bug caught in the
  // 2026-07-30 review).
  const counterfactualOf = (
    victimName: string,
    atSeconds: number,
  ): { auditLines: string[]; decisiveLines: string[] } => {
    const victim = friends.find((f) => f.name === victimName);
    if (!victim) return { auditLines: [], decisiveLines: [] };
    const deathS = toRenderSecond(atSeconds);

    const victimCds =
      victim.id === owner.id
        ? cooldowns
        : (teammateCooldowns.find((tc) => tc.player.id === victim.id)?.cds ??
          []);
    const victimCcSummary = ccTrinketSummaries.find(
      (s) => s.playerName === victimName,
    );
    const missedExternals =
      deathOutcome.events.find(
        (e) =>
          e.deadPlayer === victimName && Math.abs(e.atSeconds - atSeconds) < 1,
      )?.missedExternals ?? [];

    const audit = computeMitigationAudit(victim, combat, deathS);
    const decisiveHits = [
      ...(victimCcSummary
        ? computeUnusedSelfCounterfactuals(
            victim,
            victimCds,
            victimCcSummary,
            combat,
            deathS,
          )
        : []),
      ...computeMissedExternalCounterfactuals(
        missedExternals,
        victim,
        combat,
        deathS,
      ),
    ];

    // Independent-accounting disclosure (form A, #17b Task4 review
    // Important #2): each row is computed on its own and overlapping windows
    // are not modelled as stacking — the card header already carries the
    // Chinese version of this note, but the prompt side was missing the same
    // sentence, so it is added here (only when there really are audit rows).
    const auditLines = audit.rows.map(formatMitigationAuditLine);
    return {
      auditLines:
        auditLines.length > 0
          ? [MITIGATION_AUDIT_INDEPENDENT_NOTE, ...auditLines]
          : auditLines,
      decisiveLines: decisiveHits.map(formatDecisiveCounterfactualLine),
    };
  };

  // [BURST ANSWERED] context lines (GH #60 follow-up, 2026-09-01). Computed
  // here — the timeline builder has no `combat` — and handed to the timeline
  // as data, so "a burst window" stays the one definition the
  // slow-defensive-response candidate and the corpus reference table share.
  // `friendlyReaction` is the owner's, exactly as `candidateFindings` passes
  // it. Fails silently: an uncomputable engine ⇒ no lines, never a broken
  // timeline (same posture as [ROOT] below).
  let burstWindows: BurstWindowDecisionPoint[] = [];
  try {
    burstWindows = burstWindowDecisionPoints(combat, {
      friendlyReaction: owner?.reaction,
    });
  } catch {
    /* no burst windows → no [BURST ANSWERED] lines */
  }

  // [CD PRIOR] context lines (GH #54 (f) / BACKLOG #38 (a)(h), user ruling
  // 2026-09-04 option 1). Healer owners only — the cohort table is built from
  // healer rounds. The cohort is the owner's spec × hero tree, resolved
  // through the SAME two functions the corpus scan keyed the table with
  // (`specToString` → ownerSpec, `heroBuildGroupOf`); a table with no cell
  // for this cooldown simply yields no episode. Fails silently like the
  // burst windows above.
  let cdPriorEpisodes: CdPriorHoldEpisode[] = [];
  const cdPriorCohort = {
    spec: ownerSpec,
    heroTree: heroBuildGroupOf(owner?.info?.talents),
  };
  if (healer) {
    try {
      cdPriorEpisodes = cdPriorHoldEpisodes(owner, combat, (spellId) =>
        lookupCdTriggerPrior(cdPriorCohort.spec, cdPriorCohort.heroTree, spellId),
      );
    } catch {
      /* no cohort reference → no [CD PRIOR] lines */
    }
  }

  const timelineText = buildMatchTimeline({
    owner: owner as ICombatUnit,
    ownerSpec,
    ownerCDs: cooldowns,
    teammateCDs: allTeamCDsWithSpec,
    enemyCDTimeline,
    ccTrinketSummaries,
    ccBreakEvents: ccBreakStats.friendlySquander,
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
    criticalWindowSeconds,
    counterfactualOf,
    burstWindows,
    cdPriorEpisodes,
    cdPriorCohort,
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
  // [ROOT] context facts (GH #24, 2026-08-30): roots whose target could not
  // reach anyone for >= ROOT_UNREACHABLE_MIN_S. Same merge path as exposure.
  let rootInserts: Array<{ atSeconds: number; line: string }> = [];
  try {
    rootInserts = formatRootReachabilityEntries(
      computeRootReachability(combat, [
        ...(friends as ICombatUnit[]),
        ...(enemies as ICombatUnit[]),
      ]),
      owner.id,
    ).map((entry) => ({
      atSeconds: entry.atSeconds,
      line: `${fmtTime(entry.atSeconds)}  ${entry.line}`,
    }));
  } catch {
    /* no positions → no root facts */
  }
  tLines.push("");
  tLines.push(
    mergeTimestampedLines(timelineText.split("\n"), [
      ...exposureInserts,
      ...rootInserts,
    ]).join("\n"),
  );

  if (positionLines.length > 0) {
    tLines.push("");
    positionLines.forEach((l) => tLines.push(l));
  }

  // R1 (E2E regression fix): the death-outcome block — externals a teammate
  // had available but never used at your death (Pain Suppression / Lay on
  // Hands) plus immunities the victim still had up. This block used to be
  // appended only on the sparse path below, so the timeline branch never
  // rendered it before returning here (measured in E2E: 139 matches before →
  // 0 after).
  const deathOutcomeBlockTimeline = formatDeathOutcomeForContext(deathOutcome);
  if (deathOutcomeBlockTimeline) {
    tLines.push("");
    tLines.push(deathOutcomeBlockTimeline);
  }

  // R3 (E2E regression fix): the block for offensive abilities thrown into
  // immunities/DR. This block, too, used to be appended only on the sparse
  // path below.
  const offensiveWasteBlockTimeline =
    formatOffensiveWasteForContext(offensiveWaste);
  if (offensiveWasteBlockTimeline) {
    tLines.push("");
    tLines.push(offensiveWasteBlockTimeline);
  }

  // R4 (2026-08-20, the same sparse-only wiring bug as R1/R3 — third
  // instance of the class): the [KILL ATTEMPTS] block (v25, 740181f7) was
  // appended only on the sparse path below, so the production timeline
  // prompt NEVER rendered it — measured on the own library: 0/146 timeline
  // contexts contained the block while the attempt-into-trinket CANDIDATE
  // (menu path, independent) worked, which is why the 2026-08-19 smoke
  // passed without noticing. Wired here alongside the v2 burst anchor.
  {
    const attemptLines = formatKillAttemptsForContext(
      extractKillAttempts(friends, enemies as ICombatUnit[], combat),
    );
    if (attemptLines.length > 0) {
      tLines.push("");
      attemptLines.forEach((l) => tLines.push(l));
    }
  }

  return tLines.join("\n");
}

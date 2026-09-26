/**
 * healerExposureAnalysis.ts
 *
 * At each enemy aligned burst window, snapshots healer CC vulnerability:
 *   1. Trinket availability
 *   2. Which enemies have LoS to the healer (can land CC)
 *   3. Healer DR state per CC category at burst start
 *
 * Exposure labels (WoW 12.0, Full → 50% → Immune chain):
 *   Critical  — trinket unavailable + Full DR threat in LoS
 *   Exposed   — Full DR threat in LoS (trinket available), OR 50% DR + trinket unavailable
 *   Pressured — only 50% DR threats in LoS, trinket available
 *   Safe      — all threats pillar-blocked or healer Immune in all relevant categories
 */

import {
  AtomicArenaCombat,
  CombatUnitReaction,
  CombatUnitSpec,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import { ccSpellIds } from "../data/spellTags";
import {
  analyzePlayerCCAndTrinket,
  IPlayerCCTrinketSummary,
  pvpTrinketRemainingSecondsAt,
} from "./ccTrinketAnalysis";
import { isHealerSpec, specToString } from "./cooldowns";
import { ccThreatRadiusYards } from "./spellRange";
import { fmtTime } from "./renderGrid";
import { DR_CATEGORY_MAP, DRLevel, getDRLevelAtTime } from "./drAnalysis";
import { IAlignedBurstWindow, reconstructEnemyCDTimeline } from "./enemyCDs";
import {
  distanceBetween,
  getUnitPositionAtTime,
  getUnitRawPositionAtTime,
  hasLineOfSight,
  IPosition,
  nearestLosBreakOption,
} from "./losAnalysis";
import {
  CC_MAX_CAST_RANGE_YARDS,
  INTERP_MAX_GAP_MS,
  LOS_SWEEP_GAP_MS,
  LOS_SWEEP_SLACK_S,
} from "./positionSampling";

// An enemy standing outside cast range cannot land a CC, line of sight or not.
// The range is the single-source export from positionSampling — note that it and
// "the trusted distance ceiling when recomputing a CC that already happened" are
// two different facts (see the comments in that file); this file makes a
// **forward-looking** judgement, so it uses the range itself, not the number
// carrying an observation tolerance.
// G5 grounding guard (2026-07-14 full-scale audit, same rule as positionAnalysis /
// ccTrinketAnalysis) + G5 take 2 (2026-07-15): the LoS predicate mirrors the eval
// positioning gate. All three constants are imported from the single source
// positionSampling — they used to be declared privately in this file with a
// comment saying "MUST stay equal to positioningScan.ts", whereas CLAUDE.md
// mandates "export the predicate from one place and import it on both sides…
// don't rely on comments".
const POSITION_MAX_GAP_MS = INTERP_MAX_GAP_MS;

/** Returns true if the enemy has an active CC aura at the given timestamp (ms). */
function isEnemyInCC(enemy: ICombatUnit, atMs: number): boolean {
  const active = new Map<string, boolean>();
  for (const e of enemy.auraEvents) {
    if (!e.spellId || !ccSpellIds.has(e.spellId)) continue;
    if (e.logLine.timestamp > atMs) break;
    if (e.logLine.event === LogEvent.SPELL_AURA_APPLIED)
      active.set(e.spellId, true);
    else if (e.logLine.event === LogEvent.SPELL_AURA_REMOVED)
      active.set(e.spellId, false);
  }
  return [...active.values()].some(Boolean);
}

// ---------------------------------------------------------------------------
// Spec → primary CC fallback (for enemies not yet observed casting CC)
//
// NOTE: This list is class-level, not spec-level. It's a best-effort heuristic
// for enemies who haven't cast CC yet in this match. Observed CC data from
// buildEnemyCCHistory() is always preferred over these defaults.
// Known imprecisions: Rogue (Sub primary = Blind, not Kidney), Druid (Feral
// primary = Cyclone/Maim), Warrior (Stormbolt often > Intimidating Shout).
// Order matters: check "Demon Hunter" before "Hunter".
// ---------------------------------------------------------------------------

// GH #83 (2026-09-23): each entry now names the CC AURA id — the id the log
// records for a landed CC, the same key `buildEnemyCCHistory` uses — so the
// DR category comes from `DR_CATEGORY_MAP` (never hand-typed) and the reach
// from `ccThreatReachYards` (through the cast that triggers the aura). Two rows
// corrected on corpus evidence while doing so: Paladin Repentance (20066 and
// every other Repentance id: 0 occurrences in 63,303 season files) → Hammer of
// Justice (3,094 landed on a 1,000-file slice); Evoker Landslide (a root — no
// DR category exists for it, the old "Disorient" was invented) → Sleep Walk
// (Disorient, 1,255 landed). Registered in data/curatedIdRegistry.ts.
export const SPEC_PRIMARY_CC: ReadonlyArray<{
  keyword: string;
  spellName: string;
  spellId: string;
}> = [
  { keyword: "Demon Hunter", spellName: "Imprison", spellId: "217832" },
  { keyword: "Death Knight", spellName: "Strangulate", spellId: "47476" },
  { keyword: "Mage", spellName: "Polymorph", spellId: "118" },
  { keyword: "Rogue", spellName: "Kidney Shot", spellId: "408" },
  { keyword: "Warlock", spellName: "Fear", spellId: "118699" },
  { keyword: "Druid", spellName: "Cyclone", spellId: "33786" },
  { keyword: "Hunter", spellName: "Freezing Trap", spellId: "3355" },
  { keyword: "Shaman", spellName: "Hex", spellId: "51514" },
  { keyword: "Paladin", spellName: "Hammer of Justice", spellId: "853" },
  { keyword: "Warrior", spellName: "Intimidating Shout", spellId: "5246" },
  { keyword: "Monk", spellName: "Paralysis", spellId: "115078" },
  { keyword: "Priest", spellName: "Psychic Scream", spellId: "8122" },
  { keyword: "Evoker", spellName: "Sleep Walk", spellId: "360806" },
];

function getPrimaryCC(
  specName: string,
): { spellName: string; spellId: string; category: string } | null {
  for (const entry of SPEC_PRIMARY_CC) {
    if (!specName.includes(entry.keyword)) continue;
    const category = DR_CATEGORY_MAP[entry.spellId];
    return category ? { ...entry, category } : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HealerExposureLabel = "Critical" | "Exposed" | "Pressured" | "Safe";

export interface IHealerCCThreat {
  enemyName: string;
  enemySpec: string;
  /** DR category of the threat (e.g. "Incapacitate") */
  ccCategory: string;
  /** Representative spell name (e.g. "Polymorph") */
  ccSpellName: string;
  /** DR level healer would be at if this CC lands now */
  healerDRLevel: Exclude<DRLevel, "Immune">;
  /** true = this enemy is behind a pillar relative to the healer */
  losBlocked: boolean;
}

export interface IHealerBurstExposure {
  atSeconds: number;
  burstDangerLabel: string;
  trinketState: "available" | "on_cooldown" | "passive" | "none";
  /** Seconds from match start when trinket returns, if on_cooldown */
  trinketAvailableAtSeconds: number | null;
  /** All non-Immune threats (both exposed and pillar-blocked) */
  threats: IHealerCCThreat[];
  exposureLabel: HealerExposureLabel;
  /** F194: nearest verified LoS-breaking reposition against an exposed threat.
   *  null when the zone is unmapped or no obstacle blocks any exposed threat. */
  losBreak?: { repositionYards: number; blocksEnemyName: string } | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTrinketStateAtSeconds(
  summary: IPlayerCCTrinketSummary,
  atSeconds: number,
): {
  state: "available" | "on_cooldown" | "passive" | "none";
  availableAtSeconds: number | null;
} {
  // No PvP trinket equipped (W1j, 0e0663e6): nothing to press, never "ready"
  if (summary.trinketType === "None")
    return { state: "none", availableAtSeconds: null };
  // Relentless = passive DR reduction; Adaptation = auto-proc break — neither has a manual CD
  if (
    summary.trinketType === "Relentless" ||
    summary.trinketType === "Adaptation"
  )
    return { state: "passive", availableAtSeconds: null };
  // The one readiness predicate (W1j): own cooldown AND the racial lock —
  // e10c6bea printed "healer trinket ready" while the game was still
  // rejecting the Medallion press after Will to Survive.
  const remaining = pvpTrinketRemainingSecondsAt(summary, atSeconds) ?? 0;
  if (remaining <= 0) return { state: "available", availableAtSeconds: null };
  return { state: "on_cooldown", availableAtSeconds: atSeconds + remaining };
}

function computeExposureLabel(
  trinketState: "available" | "on_cooldown" | "passive" | "none",
  exposedThreats: IHealerCCThreat[],
): HealerExposureLabel {
  if (exposedThreats.length === 0) return "Safe";
  const hasFullDR = exposedThreats.some((t) => t.healerDRLevel === "Full");
  const has50DR = exposedThreats.some((t) => t.healerDRLevel === "50%");
  const trinketUnavailable =
    trinketState === "on_cooldown" || trinketState === "none";
  if (hasFullDR && trinketUnavailable) return "Critical";
  if (hasFullDR) return "Exposed";
  if (has50DR && trinketUnavailable) return "Exposed";
  if (has50DR) return "Pressured";
  return "Safe";
}

/**
 * Build a map of enemyName → observed CC categories from all friendly CC summaries.
 * Prefer observed data over spec inference — only falls back to spec if no CC observed.
 */
function buildEnemyCCHistory(
  allFriendlyCCSummaries: IPlayerCCTrinketSummary[],
): Map<
  string,
  Array<{ spellName: string; spellId: string; category: string }>
> {
  const result = new Map<
    string,
    Array<{ spellName: string; spellId: string; category: string }>
  >();
  for (const summary of allFriendlyCCSummaries) {
    for (const cc of summary.ccInstances) {
      const category = DR_CATEGORY_MAP[cc.spellId];
      if (!category) continue;
      const existing = result.get(cc.sourceName) ?? [];
      if (!existing.some((e) => e.category === category)) {
        existing.push({
          spellName: cc.spellName,
          spellId: cc.spellId,
          category,
        });
      }
      result.set(cc.sourceName, existing);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main analysis
// ---------------------------------------------------------------------------

export function analyzeHealerExposureAtBurst(
  burstWindows: readonly IAlignedBurstWindow[],
  enemies: ICombatUnit[],
  healer: ICombatUnit,
  healerCCSummary: IPlayerCCTrinketSummary,
  allFriendlyCCSummaries: IPlayerCCTrinketSummary[],
  zoneId: string,
  matchStartMs: number,
): IHealerBurstExposure[] {
  const enemyCCHistory = buildEnemyCCHistory(allFriendlyCCSummaries);
  const results: IHealerBurstExposure[] = [];

  for (const window of burstWindows) {
    const windowMs = matchStartMs + window.fromSeconds * 1000;

    const healerPos = getUnitPositionAtTime(
      healer,
      windowMs,
      POSITION_MAX_GAP_MS,
    );
    if (!healerPos) continue; // no position data — skip
    const healerRawPosForBreak =
      getUnitRawPositionAtTime(healer, windowMs, POSITION_MAX_GAP_MS) ??
      healerPos;

    const {
      state: trinketState,
      availableAtSeconds: trinketAvailableAtSeconds,
    } = getTrinketStateAtSeconds(healerCCSummary, window.fromSeconds);

    const threats: IHealerCCThreat[] = [];
    const enemyPosByName = new Map<string, IPosition>();

    for (const enemy of enemies) {
      const enemyPos = getUnitPositionAtTime(
        enemy,
        windowMs,
        POSITION_MAX_GAP_MS,
      );
      if (!enemyPos) continue;

      // LoS uses the exact semantics of the eval positioning gate (G5): sweep
      // ±2s at integer seconds with interpolated positions (3s max gap); the
      // enemy is "in LoS" if ANY evaluable instant has LoS (unmapped geometry
      // = visible). Any single-instant check — raw or interpolated — either
      // pairs non-simultaneous samples or crosses pillar edges neither real
      // position crossed; sharing the gate's sweep is the only consistent
      // definition (G5 take 2, 2026-07-15 audit).
      // The sweep anchors on the FLOORED second: the prompt renders fmtTime
      // (floored), and the gate re-parses that rendered time — sweeping from
      // fractional fromSeconds probes different instants than the gate and
      // flips borderline pillar geometry (death-trace fix, same class).
      const flooredWindowMs =
        matchStartMs + Math.floor(window.fromSeconds) * 1000;
      let sawAnyLosSample = false;
      let sawLoS = false;
      for (let dt = -LOS_SWEEP_SLACK_S; dt <= LOS_SWEEP_SLACK_S; dt++) {
        const ts = flooredWindowMs + dt * 1000;
        const hp = getUnitPositionAtTime(healer, ts, LOS_SWEEP_GAP_MS);
        const ep = getUnitPositionAtTime(enemy, ts, LOS_SWEEP_GAP_MS);
        if (!hp || !ep) continue;
        sawAnyLosSample = true;
        if (hasLineOfSight(zoneId, hp, ep) !== false) sawLoS = true;
      }
      // Blocked only when positions exist and NO swept instant had LoS.
      const losBlocked = sawAnyLosSample && !sawLoS;

      // B26: enemies beyond CC range or in CC cannot threaten the healer.
      // GH #83: "beyond CC range" is per CC below (its own reach + how far
      // such casters close in); the flat bound stays as the outer limit.
      const distance = distanceBetween(healerPos, enemyPos);
      if (distance > CC_MAX_CAST_RANGE_YARDS) continue;
      if (isEnemyInCC(enemy, windowMs)) continue;

      // Store the RAW position when one exists — the losBreak suggestion below
      // does pillar geometry and real samples beat interpolated points there.
      enemyPosByName.set(
        enemy.name,
        getUnitRawPositionAtTime(enemy, windowMs, POSITION_MAX_GAP_MS) ??
          enemyPos,
      );

      const enemySpec = specToString(enemy.spec);

      // Use observed CC history; fall back to spec-based primary CC
      const observedCCs = enemyCCHistory.get(enemy.name) ?? [];
      const primaryCC = getPrimaryCC(enemySpec);
      const ccSources =
        observedCCs.length > 0 ? observedCCs : primaryCC ? [primaryCC] : [];

      for (const { spellName, spellId, category } of ccSources) {
        if (distance > ccThreatRadiusYards(enemy, spellId)) continue;
        const healerDRLevel = getDRLevelAtTime(
          healerCCSummary.ccInstances,
          category,
          window.fromSeconds,
          matchStartMs,
        );
        if (healerDRLevel === "Immune") continue; // healer is immune — not a threat

        threats.push({
          enemyName: enemy.name,
          enemySpec,
          ccCategory: category,
          ccSpellName: spellName,
          healerDRLevel: healerDRLevel as Exclude<DRLevel, "Immune">,
          losBlocked,
        });
      }
    }

    if (threats.length === 0) continue;

    const exposedThreats = threats.filter((t) => !t.losBlocked);
    const exposureLabel = computeExposureLabel(trinketState, exposedThreats);

    // F194: directional pillar hint — only offer a spot that verifiably breaks LoS to one
    // of the exposed threats, instead of bare nearest-obstacle geometry (threat-blind).
    const exposedEnemyPositions = Array.from(
      new Set(exposedThreats.map((t) => t.enemyName)),
    )
      .map((name) => ({ name, pos: enemyPosByName.get(name) }))
      .filter(
        (e): e is { name: string; pos: IPosition } => e.pos !== undefined,
      );
    const losBreak =
      exposedEnemyPositions.length > 0
        ? nearestLosBreakOption(
            zoneId,
            healerRawPosForBreak,
            exposedEnemyPositions,
          )
        : null;

    results.push({
      atSeconds: window.fromSeconds,
      burstDangerLabel: window.dangerLabel,
      trinketState,
      trinketAvailableAtSeconds,
      threats,
      exposureLabel,
      losBreak: losBreak
        ? {
            repositionYards: Math.round(losBreak.repositionYards * 10) / 10,
            blocksEnemyName: losBreak.blocksEnemyName,
          }
        : null,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Formatters
//
// The enemy CC kit (spell + DR category per enemy) is static for the match, so
// it is stated ONCE in a kit header instead of being re-enumerated inside every
// burst-window entry (2026-07-09 week-eval, reports/tokens.md proposal #1:
// measured −173 tok/match recoverable). Per-window entries carry only the state
// that actually varies window to window: trinket, DR level, LoS, verdict.
// ---------------------------------------------------------------------------

const EXPOSURE_ENTRY_TAG = "[HEALER EXPOSURE]   ";

export interface IHealerExposureEntry {
  atSeconds: number;
  /** Single line, prefixed with `[HEALER EXPOSURE]   ` — callers prepend their own
   *  timestamp presentation (timeline column or bracketed block style). */
  line: string;
}

/**
 * Enemy reference used inside per-window entries: bare spec when that spec is unique
 * among the enemies appearing in this match's exposures; `Spec (Name)` when two+
 * enemies share a spec. The kit header always carries `Spec (Name)`, so a spec-only
 * reference still resolves unambiguously against it.
 */
function buildEnemyRefMap(
  exposures: IHealerBurstExposure[],
): Map<string, string> {
  const specByEnemyName = new Map<string, string>();
  for (const e of exposures) {
    for (const t of e.threats) {
      if (!specByEnemyName.has(t.enemyName))
        specByEnemyName.set(t.enemyName, t.enemySpec);
    }
  }

  const specCounts = new Map<string, number>();
  for (const spec of specByEnemyName.values()) {
    specCounts.set(spec, (specCounts.get(spec) ?? 0) + 1);
  }

  const refMap = new Map<string, string>();
  for (const [name, spec] of specByEnemyName) {
    refMap.set(
      name,
      (specCounts.get(spec) ?? 0) > 1 ? `${spec} (${name})` : spec,
    );
  }
  return refMap;
}

/**
 * Once-per-match enemy CC kit header: the per-enemy union of (spell, DR category)
 * across ALL burst windows, both in-LoS and pillar-blocked. Stable order: enemies
 * by first appearance, spells by first appearance within each enemy.
 */
export function formatEnemyCCKitHeader(
  exposures: IHealerBurstExposure[],
): string[] {
  const enemyOrder: string[] = [];
  const kits = new Map<
    string,
    { spec: string; spells: Array<{ spellName: string; category: string }> }
  >();

  for (const e of exposures) {
    for (const t of e.threats) {
      let kit = kits.get(t.enemyName);
      if (!kit) {
        kit = { spec: t.enemySpec, spells: [] };
        kits.set(t.enemyName, kit);
        enemyOrder.push(t.enemyName);
      }
      if (
        !kit.spells.some(
          (s) => s.spellName === t.ccSpellName && s.category === t.ccCategory,
        )
      ) {
        kit.spells.push({ spellName: t.ccSpellName, category: t.ccCategory });
      }
    }
  }

  if (enemyOrder.length === 0) return [];

  const parts = enemyOrder.map((name) => {
    const kit = kits.get(name) as {
      spec: string;
      spells: Array<{ spellName: string; category: string }>;
    };
    const spellsStr = kit.spells
      .map((s) => `${s.spellName} [${s.category}]`)
      .join(", ");
    return `${kit.spec} (${name}): ${spellsStr}`;
  });

  return [`ENEMY CC KIT (threats to you): ${parts.join("; ")}`];
}

/** Compact single-line-per-window exposure entries (see module comment above). */
export function formatHealerExposureEntries(
  exposures: IHealerBurstExposure[],
): IHealerExposureEntry[] {
  if (exposures.length === 0) return [];

  const refMap = buildEnemyRefMap(exposures);
  const refOf = (t: IHealerCCThreat) =>
    refMap.get(t.enemyName) ?? `${t.enemySpec} (${t.enemyName})`;

  return exposures.map((e) => {
    // Make the subject explicit (2026-07-16 DPS baseline: in matches 021 and
    // 056 the responder read this trinket state as the owner's own trinket —
    // it is the healer's trinket and must say so)
    const trinketStr =
      e.trinketState === "available"
        ? "healer trinket ready"
        : e.trinketState === "passive"
          ? "healer trinket passive"
          : e.trinketState === "none"
            ? "healer has no PvP trinket"
            : `healer trinket on CD${e.trinketAvailableAtSeconds !== null ? ` (back ${fmtTime(e.trinketAvailableAtSeconds)})` : ""}`;

    const trinketUnavailable =
      e.trinketState === "on_cooldown" || e.trinketState === "none";
    const noTrinket = e.trinketState === "none";
    const labelStr =
      e.exposureLabel === "Critical"
        ? noTrinket
          ? "exposure: Full DR, no trinket"
          : "exposure: Full DR, trinket on CD"
        : e.exposureLabel === "Exposed"
          ? trinketUnavailable
            ? noTrinket
              ? "exposure: 50% DR, no trinket"
              : "exposure: 50% DR, trinket on CD"
            : "exposure: Full DR, trinket ready"
          : e.exposureLabel === "Pressured"
            ? "exposure: 50% DR, trinket ready"
            : e.exposureLabel;

    // Actionable pillar hint: only on dangerous windows, only when a verified LoS-breaking
    // spot is within realistic repositioning distance (~30yd).
    const pillarStr =
      (e.exposureLabel === "Critical" || e.exposureLabel === "Exposed") &&
      e.losBreak &&
      e.losBreak.repositionYards <= 30
        ? ` — LoS break ~${e.losBreak.repositionYards}yd away (pillar-blocks ${e.losBreak.blocksEnemyName})`
        : "";

    const exposed = e.threats.filter((t) => !t.losBlocked);
    const blocked = e.threats.filter((t) => t.losBlocked);

    // IN LoS threats grouped per enemy: "<ref>: <Spell> <DR>, <Spell> <DR>; <ref>: …".
    // Duration implication ("full/half duration") is defined once in the system-prompt DR legend —
    // repeating it on all ~9k corpus lines cost ~40 tok/match (2026-07-09 week-eval, tokens.md #2).
    const losOrder: string[] = [];
    const losSpells = new Map<string, string[]>();
    for (const t of exposed) {
      const ref = refOf(t);
      let spells = losSpells.get(ref);
      if (!spells) {
        spells = [];
        losSpells.set(ref, spells);
        losOrder.push(ref);
      }
      spells.push(
        `${t.ccSpellName} ${t.healerDRLevel === "Full" ? "Full DR" : "50% DR"}`,
      );
    }
    const losStr = losOrder
      .map((ref) => `${ref}: ${(losSpells.get(ref) ?? []).join(", ")}`)
      .join("; ");

    const blockedRefs = [...new Set(blocked.map(refOf))].join(", ");

    // labelBias fix (2026-07-15): judges across three independent batches
    // docked the old verdict phrasings ("trinket is the only answer",
    // "healer cannot answer CC") as pre-drawn conclusions. State the same
    // facts neutrally and let the coach draw the verdict.
    let verdict = "";
    if (e.exposureLabel === "Critical") {
      verdict = "healer has no trinket available while Full-DR CC is in LoS";
    } else if (
      e.exposureLabel === "Exposed" &&
      exposed.some((t) => t.healerDRLevel === "Full")
    ) {
      verdict = "Full-DR CC in LoS; healer trinket up (sole CC counter)";
    }

    let body = `${e.burstDangerLabel} burst — ${trinketStr} — ${labelStr}${pillarStr}`;
    if (losStr) body += ` | IN LoS: ${losStr}`;
    if (blockedRefs) body += ` | Pillar-blocked: ${blockedRefs}`;
    if (verdict) body += ` | → ${verdict}`;

    return { atSeconds: e.atSeconds, line: `${EXPOSURE_ENTRY_TAG}${body}` };
  });
}

/** Block form used by the critical-moments path: kit stated once, one line per window. */
export function formatHealerExposureForContext(
  exposures: IHealerBurstExposure[],
): string[] {
  if (exposures.length === 0) return [];

  const lines: string[] = ["HEALER EXPOSURE DURING ENEMY BURST WINDOWS:"];
  formatEnemyCCKitHeader(exposures).forEach((l) => lines.push(`  ${l}`));
  lines.push("");

  for (const entry of formatHealerExposureEntries(exposures)) {
    const body = entry.line.startsWith(EXPOSURE_ENTRY_TAG)
      ? entry.line.slice(EXPOSURE_ENTRY_TAG.length)
      : entry.line;
    lines.push(`  [${fmtTime(entry.atSeconds)}] ${body}`);
  }

  return lines;
}

// ─── Healer CC avoidance (#7) ──────────────────────────────────────────────

interface IAvoidanceSpell {
  spellId: string;
  name: string;
  cooldownSeconds: number;
}

/**
 * 每个奶专精一条,**必须全覆盖**(`test/healerAvoidance.test.ts` 断言,漏一个 CI 红)。
 *
 * 语义分两种,不能混:
 *  - 数组  = 已勘查,这些是它的规避手段(空数组 = 已勘查、确实没有)
 *  - `null` = **还没勘查**,不许被渲染成「没有规避手段」这种肯定句
 *
 * 2026-08-17(docs/coaching-grounding-audit.md §D2):此前这张表是
 * `Partial<Record<...>>`,恢复德根本不在里面,查不到走 `?? []`,于是恢复德每次
 * 吃控都被渲染成一句肯定的事实 `no avoidance tools available` ——
 * **一个关于本表覆盖率的事实,被说成了关于游戏的事实**。修法刻意不是替恢复德
 * 编一个技能填进去(那正是审计在批评的「发明」),而是把「没有」和「不知道」
 * 分开;恢复德留 `null` 待裁定人按 `data/mitigationVerdicts.ts` 的签字方式补。
 *
 * 这张表本身仍无出处、且语义偏松(黑曜鳞片是 30% 减伤不是规避手段),
 * 属于审计 §A 记录的未接地项,补齐 `null` 之外的接地是另一件事。
 */
/** @internal exported for data/curatedIdRegistry (corpus rot scan) */
// 2026-08-21 S2 corpus scan (10,682 matches): removed Diffuse Magic 122783 — 0 occurrences, ability gone in 12.x (eval-private/reports/s2-health-2026-08-21); 8177 → 204336 (live Grounding Totem)
export const HEALER_AVOIDANCE_SPELLS: Record<
  CombatUnitSpec,
  IAvoidanceSpell[] | null
> = {
  [CombatUnitSpec.Shaman_Restoration]: [
    { spellId: "204336", name: "Grounding Totem", cooldownSeconds: 25 }, // 2026-08-21: was 8177 (no DB2 name)
  ],
  [CombatUnitSpec.Priest_Holy]: [
    { spellId: "586", name: "Fade", cooldownSeconds: 30 },
  ],
  [CombatUnitSpec.Priest_Discipline]: [
    { spellId: "586", name: "Fade", cooldownSeconds: 30 },
  ],
  [CombatUnitSpec.Paladin_Holy]: [
    { spellId: "642", name: "Divine Shield", cooldownSeconds: 300 },
  ],
  // Empty since 2026-08-21: Diffuse Magic 122783 (the only entry) is gone in 12.x.
  [CombatUnitSpec.Monk_Mistweaver]: [] as IAvoidanceSpell[],
  [CombatUnitSpec.Evoker_Preservation]: [
    { spellId: "363916", name: "Obsidian Scales", cooldownSeconds: 60 },
  ],
  // 还没勘查 —— 不是「恢复德没有规避手段」,是没人裁定过它有哪些。
  // 补的时候照签字纪律走,别凭印象填。
  [CombatUnitSpec.Druid_Restoration]: null,
} as Record<CombatUnitSpec, IAvoidanceSpell[] | null>;

/** 已勘查返回数组(可能为空);**未勘查返回 null,调用方必须据此闭嘴**。 */
export function healerAvoidanceSpells(
  spec: CombatUnitSpec,
): IAvoidanceSpell[] | null {
  return HEALER_AVOIDANCE_SPELLS[spec] ?? null;
}

export interface IHealerAvoidanceTool {
  spellId: string;
  spellName: string;
  idleForSeconds: number;
}

export interface IHealerCCReceived {
  atSeconds: number;
  ccSpellName: string;
  ccCategory: string;
  durationSeconds: number;
  teammateLowHp: boolean;
  avoidanceToolsAvailable: IHealerAvoidanceTool[];
  /**
   * 这个专精的规避手段**有没有被勘查过**。false 时 `avoidanceToolsAvailable`
   * 为空只代表「不知道」,渲染层必须据此不说「没有规避手段」。
   */
  avoidanceSurveyed: boolean;
}

function lastAvoidanceCastSeconds(
  unit: ICombatUnit,
  spellId: string,
  matchStartMs: number,
): number | null {
  const casts = unit.spellCastEvents.filter(
    (e) =>
      e.spellId === spellId && e.logLine.event === LogEvent.SPELL_CAST_SUCCESS,
  );
  if (casts.length === 0) return null;
  return (
    (Math.max(...casts.map((e) => e.logLine.timestamp)) - matchStartMs) / 1000
  );
}

function anyTeammateLowHp(
  friends: ICombatUnit[],
  atSeconds: number,
  matchStartMs: number,
): boolean {
  const windowMs = 2_000;
  const targetMs = atSeconds * 1000;
  const startMs = targetMs - windowMs;
  const endMs = targetMs + windowMs;

  for (const unit of friends) {
    const actions = unit.advancedActions;
    if (actions.length === 0) continue;

    let low = 0;
    let high = actions.length - 1;
    let firstIdx = actions.length;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const t = actions[mid].logLine.timestamp - matchStartMs;
      if (t >= startMs) {
        firstIdx = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    for (let i = firstIdx; i < actions.length; i++) {
      const action = actions[i];
      const t = action.logLine.timestamp - matchStartMs;
      if (t > endMs) break;

      if (action.advancedActorMaxHp > 0) {
        const hpPct = action.advancedActorCurrentHp / action.advancedActorMaxHp;
        if (hpPct < 0.75) return true;
      }
    }
  }
  return false;
}

export function buildHealerCCReceivedEvents(
  combat: Pick<AtomicArenaCombat, "startTime">,
  healer: ICombatUnit,
  friends: ICombatUnit[],
  ccSummary: Pick<IPlayerCCTrinketSummary, "ccInstances">,
): IHealerCCReceived[] {
  const matchStartMs = combat.startTime;
  const surveyed = healerAvoidanceSpells(healer.spec);
  const avoidanceSpells = surveyed ?? [];
  const result: IHealerCCReceived[] = [];

  for (const cc of ccSummary.ccInstances) {
    const teammateLowHp = anyTeammateLowHp(friends, cc.atSeconds, matchStartMs);
    if (!teammateLowHp) continue;

    const avoidanceToolsAvailable: IHealerAvoidanceTool[] = [];
    for (const spell of avoidanceSpells) {
      const lastCast = lastAvoidanceCastSeconds(
        healer,
        spell.spellId,
        matchStartMs,
      );
      let availableSince: number;
      if (lastCast === null) {
        availableSince = 0;
      } else {
        const cdReadyAt = lastCast + spell.cooldownSeconds;
        if (cdReadyAt > cc.atSeconds) continue;
        availableSince = cdReadyAt;
      }
      const idleDuration = cc.atSeconds - availableSince;
      if (idleDuration < 1.5) continue;
      avoidanceToolsAvailable.push({
        spellId: spell.spellId,
        spellName: spell.name,
        idleForSeconds: idleDuration,
      });
    }

    result.push({
      atSeconds: cc.atSeconds,
      ccSpellName: cc.spellName,
      ccCategory: cc.drInfo?.category ?? "Unknown",
      durationSeconds: cc.durationSeconds,
      teammateLowHp,
      avoidanceToolsAvailable,
      avoidanceSurveyed: surveyed !== null,
    });
  }

  return result;
}

export function formatHealerCCReceivedForContext(
  events: IHealerCCReceived[],
): string {
  if (events.length === 0) return "";
  const lines: string[] = ["HEALER CC RECEIVED"];
  for (const ev of events) {
    const t = fmtTime(ev.atSeconds);
    if (ev.avoidanceToolsAvailable.length > 0) {
      const tools = ev.avoidanceToolsAvailable
        .map(
          (a) =>
            `${a.spellName} available ${Math.round(a.idleForSeconds)}s prior`,
        )
        .join(", ");
      lines.push(
        `  [${t}] ${ev.ccSpellName} (${ev.durationSeconds}s) — ${tools}`,
      );
    } else if (ev.avoidanceSurveyed) {
      lines.push(
        `  [${t}] ${ev.ccSpellName} (${ev.durationSeconds}s) — no avoidance tools available`,
      );
    } else {
      // 这个专精还没被勘查过 —— 说「没有规避手段」会把本表的覆盖缺口
      // 说成游戏事实(§D2)。只陈述吃到的控制,不对手段下断言。
      lines.push(`  [${t}] ${ev.ccSpellName} (${ev.durationSeconds}s)`);
    }
  }
  return lines.join("\n");
}

// ─── Orchestrator (#4: pressure / exposure lanes) ─────────────────────────

export interface IHealerExposurePre {
  alignedBurstWindows: readonly IAlignedBurstWindow[];
  ccTrinketSummaries: IPlayerCCTrinketSummary[];
  healerUnit: ICombatUnit | undefined;
  /** The team sets the caller already resolved (#4 final review, Important #2):
   *  the pre branch uses exactly these two and no longer the friends/enemies
   *  this function derives itself — the self-derived sets only serve the no-pre
   *  path. In the old code the caller's `enemies` reached
   *  analyzeHealerExposureAtBurst literally, and that equivalence must hold. */
  friends: ICombatUnit[];
  enemies: ICombatUnit[];
}

/** Single source for orchestrating healer exposure (#4): buildMatchContext
 * passes precomputed pieces (zero duplicate computation); when the renderer
 * passes none, they are derived here (all derivation goes through the shared
 * predicates analyzePlayerCCAndTrinket / reconstructEnemyCDTimeline). Both paths
 * converge on the same analyzeHealerExposureAtBurst call — the lanes and the
 * prompt must never fork. */
export function computeHealerExposureEvents(
  combat: AtomicArenaCombat,
  pre?: IHealerExposurePre,
): IHealerBurstExposure[] {
  const units = Object.values(combat.units ?? {}) as ICombatUnit[];
  const players = units.filter((u) => (u as { info?: unknown }).info);
  // The pre branch uses the caller's pieces exclusively, not the friends/enemies
  // derived here — the self-derived sets only serve the no-pre path (see the
  // comment on IHealerExposurePre).
  const friends = pre
    ? pre.friends
    : players.filter((u) => u.reaction === CombatUnitReaction.Friendly);
  const enemies = pre
    ? pre.enemies
    : players.filter((u) => u.reaction !== CombatUnitReaction.Friendly);
  if (friends.length === 0 || enemies.length === 0) return [];

  const healerUnit =
    pre !== undefined
      ? pre.healerUnit
      : friends.find((p) => isHealerSpec(p.spec));
  if (!healerUnit) return [];

  let alignedBurstWindows: readonly IAlignedBurstWindow[];
  let ccTrinketSummaries: IPlayerCCTrinketSummary[];
  if (pre) {
    ({ alignedBurstWindows, ccTrinketSummaries } = pre);
  } else {
    // Owner resolution mirrors renderer/buildAnalysisInput: playerId first,
    // falling back to the healer
    const owner =
      friends.find(
        (u) => u.id === (combat as { playerId?: string }).playerId,
      ) ?? healerUnit;
    const enemyIds = new Set(enemies.map((u) => u.id));
    const enemyPets = units.filter(
      (u) =>
        (u as { ownerId?: string }).ownerId &&
        enemyIds.has((u as { ownerId?: string }).ownerId!),
    );
    ccTrinketSummaries = friends.map((p) =>
      analyzePlayerCCAndTrinket(p, enemies, combat, enemyPets),
    );
    alignedBurstWindows = reconstructEnemyCDTimeline(
      enemies,
      combat,
      owner,
      friends,
    ).alignedBurstWindows;
  }

  const healerCCSummary = ccTrinketSummaries.find(
    (s) => s.playerName === healerUnit.name,
  );
  if (!healerCCSummary) return [];

  // Graceful absence of coordinates comes from getUnitPositionAtTime returning
  // null → continue, NOT from swallowing exceptions here (#4 final review,
  // Important #1): a try/catch would only catch real bugs and turn failures on
  // the prompt path from loud into silent. The renderer side already has a
  // backstop catch around pressureLanes.ts — graceful degradation belongs there
  // and must not be reimplemented, worse, inside this single-source
  // orchestrator.
  return analyzeHealerExposureAtBurst(
    alignedBurstWindows,
    enemies,
    healerUnit,
    healerCCSummary,
    ccTrinketSummaries,
    combat.startInfo?.zoneId ?? "",
    combat.startTime,
  );
}

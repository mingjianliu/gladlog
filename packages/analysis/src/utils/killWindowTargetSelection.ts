import {
  AtomicArenaCombat,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
// GH #31 ② (2026-09-02): shared official-face predicate replaces the hand set.
import { isKillWindowMajorDefensive } from "../data/abilityProfile";
import { MITIGATION_TABLE } from "../data/mitigationData";
import { spellEffectData } from "../data/spellEffectData";
import {
  applyCdTalentModifiers,
  cdAvailableAt,
  chargesAvailableAt,
  getUnitHpAtTimestamp,
  HP_SAMPLE_RADIUS_MS,
  isHealerSpec,
  playerTalentIdSets,
  specToString,
} from "./cooldowns";
import { IOffensiveWindow } from "./offensiveWindows";
import { fmtTime } from "./renderGrid";
import { DPS_TRINKET_CD_S, HEALER_TRINKET_CD_S } from "./trinketCooldown";

/** PvP trinket spell IDs that break CC / grant freedom. Exported 2026-08-18:
 * killAttempts.ts detects "target trinketed OUT of the stun" from the same id
 * set that getTrinketStateAtTime derives trinket state from. */
// 2026-08-21 S2 corpus scan (10,682 matches): removed 195710 Primal Gladiator's Badge, 208683 Might of the Alliance/Horde — 0 occurrences, ability gone in 12.x (eval-private/reports/s2-health-2026-08-21)
export const PVP_TRINKET_SPELL_IDS = new Set<string>([
  "336126", // Gladiator's Medallion (active break-CC)
]);

/** Minimum window duration to bother comparing (mirrors MIN_VULN_SECONDS in offensiveWindows).
 * Shared with burstLedger's targeting audit — same "window long enough to judge" fact. */
export const MIN_WINDOW_SECONDS = 5;

/**
 * "Wall in hand": a 20–99 % damage-reduction cooldown the target has NOT yet
 * spent (official mitigation table). Immunities (pct 100 — Divine Shield /
 * Ice Block) are deliberately excluded: user ruling 2026-08-18, "冰箱圣盾不管,
 * 交了也算我们赚" — baiting one out is a win, not a reason to avoid the target.
 *
 * This is the "gated" axis of the kill-opportunity tier.
 *
 * History of the door: the 2026-08-18 model keyed it on "usable WHILE
 * stunned" (mitigation ∩ the usable-while-stunned table), reasoning that a
 * stunned target cannot press the other walls. On 2026-09-04 the
 * usable-while-stunned table was corrected (named SpellMisc bits, BACKLOG #41
 * (8)) and the intersection shrank 17 → 6 ids; the re-validation on 18,447
 * stun landings (packages/eval/scripts/killTierValidationScan.ts) showed the
 * 523 landings that thereby moved from gated to prime converted ONCE (0.2 %):
 * Die by the Sword 0/115, Aura Mastery 0/109, Survival of the Fittest 0/102,
 * Darkness 0/84, Icebound Fortitude 0/64, Fortifying Brew 1/54, Anti-Magic
 * Zone 0/35, Obsidian Scales 0/25. A wall the stun blocks still comes the
 * moment the stun ends, so what predicts non-conversion is the wall IN HAND,
 * not its stun-usability. User ruling 2026-09-04 ("改吧"): the door is now
 * every 20–99 % wall in hand. Tier conversion with this door is recorded in
 * IEnemySnapshot.tier below.
 */
export const WALL_IN_HAND_MIT_IDS: ReadonlySet<string> = new Set(
  Object.entries(MITIGATION_TABLE)
    .filter(([, e]) => e.pct >= 20 && e.pct < 100)
    .map(([id]) => id),
);

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface IEnemySnapshot {
  unitId: string;
  playerName: string;
  playerSpec: string;
  /** HP% at window start, 0–100. null when advanced logging is absent. */
  hpPercent: number | null;
  /** Major defensive CDs that are available (not on cooldown, not active). */
  defensivesAvailable: string[];
  /** Major defensive CDs that are on cooldown or whose buff is currently active. */
  defensivesUnavailable: string[];
  /** true = trinket off cooldown (including never observed being used — the
   * start-of-match reset means it is ready), false = on cooldown. */
  trinketAvailable: boolean;
  /**
   * Kill-opportunity tier (user-ruled model, 2026-08-18; door re-ruled
   * 2026-09-04 to "any 20–99 % wall in hand" — 10s kill conversion per tier,
   * killTierValidationScan on the S2 archive every-30, 18,447 stun landings;
   * the 08-18 numbers on 8,791 landings were prime 4.8 / locked 1.9 / gated 0.8):
   *   prime   no trinket, no 20–99 % wall in hand
   *   locked  trinket still available
   *   gated   no trinket, but a 20–99 % wall (WALL_IN_HAND_MIT_IDS) in hand
   * Conversion with the re-ruled door: see the WALL_IN_HAND_MIT_IDS comment /
   * BACKLOG #41 (8) for the measured numbers.
   * Replaces the former continuous softnessScore
   * (50·(1−hp) + 50·defensivesFraction + trinket 15), whose defensives
   * denominator only counted spells the enemy had already cast this match —
   * 26.1% of snapshots had a denominator of 1, making scores incomparable
   * across enemies (a 100%-HP warrior outscored a 33%-HP DH). Absolute-state
   * tiers need no shared denominator.
   */
  tier: KillOpportunityTier;
  /**
   * Display names of the 20–99 % walls currently IN HAND (kit evidence: cast
   * at least once this match — same gate as ccAvoidanceOptionsAt — and off
   * cooldown). Non-empty exactly when the gated tier applies; rendered so the
   * coach can say WHICH card to bait.
   */
  wallsInHand: string[];
}

/** See IEnemySnapshot.tier. Ordering claims are only made prime-vs-rest —
 * the gated/locked conversion gap is confounded in both directions. */
export type KillOpportunityTier = "prime" | "gated" | "locked";

export interface IKillWindowTargetEval {
  windowFromSeconds: number;
  windowToSeconds: number;
  /** The enemy whose defensives triggered this window. */
  focusedTarget: IEnemySnapshot;
  /** All other enemies at this window start. */
  otherTargets: IEnemySnapshot[];
  /** true when the focused target is NOT prime while another enemy IS —
   * the only tier comparison the corpus validation supports (prime converts
   * 2.5–6x above the other tiers; gated-vs-locked is confounded). */
  betterTargetExists: boolean;
  /** Name of the better target, if any. */
  betterTargetName?: string;
  betterTargetSpec?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns the unit's HP% (0–100) at `atSeconds`, using the nearest advancedAction
 * entry at or before that time. Returns null when advanced logging is unavailable.
 */
export function getHpPercentAtTime(
  enemy: ICombatUnit,
  atSeconds: number,
  matchStartMs: number,
  maxDtMs: number = HP_SAMPLE_RADIUS_MS,
): number | null {
  // B4 residual fix (2026-07-14 audit): the old implementation returned the nearest
  // sample AT OR BEFORE the instant with NO time bound — a unit idle/CC'd for 20s got a
  // 20s-stale HP printed as "HP at T-15s", contradicting the [STATE]/[DMG SPIKE] lines
  // sampled near the same instant and demonstrably feeding coach errors. All prompt HP
  // claims now share one bounded nearest-sample primitive (getUnitHpAtTimestamp,
  // HP_SAMPLE_RADIUS_MS); instants without a near-enough reading render nothing.
  const pct = getUnitHpAtTimestamp(
    enemy,
    matchStartMs + atSeconds * 1000,
    maxDtMs,
  );
  return pct === null ? null : Math.min(100, Math.max(0, pct));
}

/**
 * Returns the lowest HP% (0–100) observed for `unit` within [fromSeconds, toSeconds].
 * Scans all advancedActions in that window; returns null if none exist (advanced logging off).
 */
export function getLowestHpPercentInWindow(
  unit: ICombatUnit,
  fromSeconds: number,
  toSeconds: number,
  matchStartMs: number,
): number | null {
  const actions = unit.advancedActions;
  if (actions.length === 0) return null;

  const fromMs = matchStartMs + fromSeconds * 1000;
  const toMs = matchStartMs + toSeconds * 1000;

  let lowest: number | null = null;
  for (const a of actions) {
    if (a.logLine.timestamp < fromMs) continue;
    if (a.logLine.timestamp > toMs) break;
    if (a.advancedActorMaxHp <= 0) continue;
    const pct = Math.min(
      100,
      Math.max(0, (a.advancedActorCurrentHp / a.advancedActorMaxHp) * 100),
    );
    if (lowest === null || pct < lowest) lowest = pct;
  }
  return lowest;
}

/** Lowest HP% of the whole match (delegates to the windowed predicate, single
 * source). Consumed by "was this match actually dangerous" decisions such as
 * the cd-waste pressure gate; no advanced samples → null. */
export function matchMinHpPct(unit: ICombatUnit): number | null {
  return getLowestHpPercentInWindow(unit, -Infinity, Infinity, 0);
}

/**
 * Reconstructs whether each major defensive is available, on cooldown, or has
 * active buff at `windowStartSeconds`, by replaying the enemy's cast history.
 */
function getDefensiveStateAtTime(
  enemy: ICombatUnit,
  windowStartSeconds: number,
  matchStartMs: number,
): { available: string[]; unavailable: string[] } {
  const available: string[] = [];
  const unavailable: string[] = [];

  // Collect all major defensive casts by this enemy before the window
  type DefCast = { spellId: string; spellName: string; castSeconds: number };
  const castsBySpell = new Map<string, DefCast[]>();

  for (const cast of enemy.spellCastEvents) {
    if (cast.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
    const { spellId } = cast;
    if (!spellId || !isKillWindowMajorDefensive(spellId)) continue;

    const castSeconds = (cast.logLine.timestamp - matchStartMs) / 1000;
    if (castSeconds >= windowStartSeconds) continue; // after our snapshot time

    const effectData = spellEffectData[spellId];
    if (!effectData) continue;
    const cdSeconds =
      effectData.cooldownSeconds ??
      effectData.charges?.chargeCooldownSeconds ??
      0;
    if (cdSeconds < 30) continue;

    const spellName = effectData.name;
    const existing = castsBySpell.get(spellId) ?? [];
    existing.push({ spellId, spellName, castSeconds });
    castsBySpell.set(spellId, existing);
  }

  // This enemy's talents, for the cooldown numbers below (2026-08-18, user
  // ruling 「这些数值要做成活的,根据玩家的天赋适应」). Unconditional: the
  // predicate already degrades safely — no COMBATANT_INFO yields
  // `talentedSpellIds: null` ("unknown", never "took none") and an empty PvP
  // set, which `applyCdTalentModifiers` renders as the base numbers, i.e.
  // exactly the old behaviour.
  const { talentedSpellIds, pvpTalentIds } = playerTalentIdSets(enemy);

  // For each tracked defensive, determine state at window start
  for (const [spellId, casts] of castsBySpell) {
    const effectData = spellEffectData[spellId];
    if (!effectData) continue;

    // Talent-adapted, not raw. Reading the base numbers here was the third
    // instance of the same defect (after `ccAvoidanceOptionsAt`): the enemy's
    // real cooldown is the base number run through `applyCdTalentModifiers`,
    // and the error is accusation-shaped — a defensive judged spent when it is
    // actually back inflates `defensivesFraction`, inflates `softnessScore`,
    // and manufactures "there was a softer target you should have gone for".
    // Corpus scale before this fix: 2,971 casts across 1,178 rounds landed
    // while the model believed the enemy held zero charges, concentrated
    // exactly on the abilities whose talents change these two numbers — Pain
    // Suppression 678 (Protector of the Frail, +1 charge), Time Dilation 695
    // (Just in Time, +1 charge / −10s), Blessing of Sacrifice 490 (Sacrifice
    // of the Just, −60s), Obsidian Scales 385 (Obsidian Bulwark, +1 charge).
    const { cooldownSeconds: cdSeconds, charges: maxCharges } =
      applyCdTalentModifiers(
        spellId,
        effectData.cooldownSeconds ??
          effectData.charges?.chargeCooldownSeconds ??
          0,
        effectData.charges?.charges ?? 1,
        talentedSpellIds,
        pvpTalentIds,
      );
    const buffSeconds =
      effectData.durationSeconds && effectData.durationSeconds > 0
        ? effectData.durationSeconds
        : 8;

    // Charge state comes from the shared predicate (2026-08-18). This used to
    // be a hand-rolled sequential-regen loop — the same algorithm
    // `cooldowns.ts` → `chargesAvailableAt` implements, written independently,
    // and the two did NOT agree: when the log shows a cast with no charges in
    // hand by the model's reckoning, `chargesAvailableAt` re-anchors the
    // recharge timer to that cast ("the log is ground truth — a charge
    // demonstrably existed"), while this loop left an already-running timer
    // alone and drifted further out of sync. One fact, one predicate
    // (docs/predicate-index.md).
    casts.sort((a, b) => a.castSeconds - b.castSeconds);
    const currentCharges = chargesAvailableAt(
      casts.map((c) => c.castSeconds),
      cdSeconds,
      maxCharges,
      windowStartSeconds,
    );

    const buffActive =
      casts[casts.length - 1].castSeconds + buffSeconds > windowStartSeconds;
    const cdOnCooldown = currentCharges === 0;

    if (buffActive || cdOnCooldown) {
      unavailable.push(effectData.name);
    } else {
      available.push(effectData.name);
    }
  }

  return { available, unavailable };
}

/**
 * Returns whether this enemy's PvP trinket is available at `windowStartSeconds`.
 *
 * Never-observed = available (it no longer returns null). Game fact: cooldowns
 * reset at the arena gates, so the trinket is necessarily ready; the friendly
 * path has always reasoned "never used = available", and treating the enemy as
 * "unknown" was an asymmetry about the same fact (2026-07-21 evidence-gap
 * survey §6.5, decided by the user 2026-07-22). Previously 95.5% of
 * [OPPORTUNITY] lines (1424/1491) rested on "state unknown" — hinting at an
 * opportunity that may not exist at all, which is worse than missing evidence.
 */
export function getTrinketStateAtTime(
  enemy: ICombatUnit,
  windowStartSeconds: number,
  matchStartMs: number,
  isHealer: boolean,
): boolean {
  const trinketCD = isHealer ? HEALER_TRINKET_CD_S : DPS_TRINKET_CD_S;
  let lastUseSeconds: number | null = null;

  for (const cast of enemy.spellCastEvents) {
    if (cast.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
    if (!cast.spellId || !PVP_TRINKET_SPELL_IDS.has(cast.spellId)) continue;

    const castSeconds = (cast.logLine.timestamp - matchStartMs) / 1000;
    if (castSeconds >= windowStartSeconds) break;

    lastUseSeconds = castSeconds;
  }

  if (lastUseSeconds === null) return true; // never observed → arena-start reset ⇒ available
  return lastUseSeconds + trinketCD <= windowStartSeconds;
}

/**
 * Builds a full snapshot for one enemy at the given window start.
 */
function snapshotEnemy(
  enemy: ICombatUnit,
  windowStartSeconds: number,
  matchStartMs: number,
): IEnemySnapshot {
  const hpPercent = getHpPercentAtTime(enemy, windowStartSeconds, matchStartMs);
  const { available, unavailable } = getDefensiveStateAtTime(
    enemy,
    windowStartSeconds,
    matchStartMs,
  );
  // 2026-08-17(审计 §D2 同族):此处原本写死 false,注释称「做基于专精的治疗
  // 判断需要 import cooldowns」—— 而本文件第一行就在 import cooldowns,
  // isHealerSpec 也从同一模块导出。后果是每个敌方治疗都按 DPS 的 120s 饰品
  // 冷却计,饰品被判为「仍在冷却」的时间凭空多出 30s,defensivesFraction 偏高,
  // 该目标显得比实际更软 —— 正好偏向产出「本来有更好的目标(去打他们的奶)」。
  const isHealerUnit = isHealerSpec(enemy.spec);
  const trinketAvailable = getTrinketStateAtTime(
    enemy,
    windowStartSeconds,
    matchStartMs,
    isHealerUnit,
  );

  const { tier, wallsInHand } = killOpportunityAt(
    enemy,
    windowStartSeconds,
    matchStartMs,
  );

  return {
    unitId: enemy.id,
    playerName: enemy.name,
    playerSpec: specToString(enemy.spec),
    hpPercent,
    defensivesAvailable: available,
    defensivesUnavailable: unavailable,
    trinketAvailable,
    tier,
    wallsInHand,
  };
}

export interface IKillOpportunity {
  tier: KillOpportunityTier;
  trinketAvailable: boolean;
  wallsInHand: string[];
}

/**
 * The kill-opportunity tier of one enemy at one instant — THE single source
 * for the 2026-08-18 tier model (see IEnemySnapshot.tier for the model and
 * its corpus validation). snapshotEnemy (target-selection) and
 * killAttempts.ts (attempt extraction) both consume this; neither re-derives
 * the tier.
 */
export function killOpportunityAt(
  enemy: ICombatUnit,
  atSeconds: number,
  matchStartMs: number,
): IKillOpportunity {
  const trinketAvailable = getTrinketStateAtTime(
    enemy,
    atSeconds,
    matchStartMs,
    isHealerSpec(enemy.spec),
  );
  const wallsInHand = wallsInHandAt(enemy, atSeconds, matchStartMs);
  const tier: KillOpportunityTier = trinketAvailable
    ? "locked"
    : wallsInHand.length > 0
      ? "gated"
      : "prime";
  return { tier, trinketAvailable, wallsInHand };
}

/**
 * Which WALL_IN_HAND_MIT_IDS the enemy has IN HAND at `atSeconds`: kit-evidence
 * gate (a spell never cast this match is invisible — same reasoning as
 * ccAvoidanceOptionsAt: no cast, no proof they run it) + cdAvailableAt over
 * the observed casts. This asks a different question from
 * getDefensiveStateAtTime above ("is any major defensive up") — the id set is
 * the 20–99 % wall subset and the answer feeds the tier, so it gets its own
 * pass rather than filtering that function's name-keyed output.
 */
function wallsInHandAt(
  enemy: ICombatUnit,
  atSeconds: number,
  matchStartMs: number,
): string[] {
  const castsBySpell = new Map<string, { timeSeconds: number }[]>();
  for (const cast of enemy.spellCastEvents) {
    if (cast.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
    const { spellId } = cast;
    if (!spellId || !WALL_IN_HAND_MIT_IDS.has(spellId)) continue;
    const arr = castsBySpell.get(spellId) ?? [];
    arr.push({
      timeSeconds: (cast.logLine.timestamp - matchStartMs) / 1000,
    });
    castsBySpell.set(spellId, arr);
  }
  const ready: string[] = [];
  for (const [spellId, casts] of castsBySpell) {
    const effectData = spellEffectData[spellId];
    const cdSeconds =
      effectData?.cooldownSeconds ??
      effectData?.charges?.chargeCooldownSeconds ??
      0;
    if (cdSeconds < 30) continue;
    if (
      cdAvailableAt(
        { casts, cooldownSeconds: cdSeconds, neverUsed: false },
        atSeconds,
      )
    ) {
      ready.push(effectData?.name ?? spellId);
    }
  }
  return ready;
}

// ---------------------------------------------------------------------------
// Main analysis
// ---------------------------------------------------------------------------

/**
 * For each offensive window (from computeOffensiveWindows), snapshots ALL enemies
 * at the window start and flags whether a better target was available than the
 * enemy whose defensives triggered the window.
 *
 * Only surfaces windows where at least two enemies are present (otherwise there's
 * no target selection decision to make).
 *
 * `windows` is narrowed to a `Pick` (not the full `IOffensiveWindow`) because
 * that is the entire surface this function reads — OFFENSIVE-002
 * (burst-into-mitigation, candidateFindings.ts) feeds it a synthetic window
 * built straight from a burst-ledger entry's own span/target, reusing this
 * exact softness-comparison predicate instead of re-deriving betterTarget
 * logic a second time (CLAUDE.md shared-predicate rule) or fabricating the
 * unused `IOffensiveWindow` fields (friendlyDamageInWindow, bursts, …).
 */
export function analyzeKillWindowTargetSelection(
  windows: Pick<
    IOffensiveWindow,
    "targetUnitId" | "fromSeconds" | "toSeconds" | "durationSeconds"
  >[],
  enemies: ICombatUnit[],
  combat: AtomicArenaCombat,
): IKillWindowTargetEval[] {
  if (enemies.length < 2) return [];

  const matchStartMs = combat.startTime;
  const results: IKillWindowTargetEval[] = [];

  for (const window of windows) {
    if (window.durationSeconds < MIN_WINDOW_SECONDS) continue;

    const focusedEnemy = enemies.find((e) => e.id === window.targetUnitId);
    if (!focusedEnemy) continue;

    const otherEnemies = enemies.filter((e) => e.id !== window.targetUnitId);
    if (otherEnemies.length === 0) continue;

    const focusedSnapshot = snapshotEnemy(
      focusedEnemy,
      window.fromSeconds,
      matchStartMs,
    );
    const otherSnapshots = otherEnemies.map((e) =>
      snapshotEnemy(e, window.fromSeconds, matchStartMs),
    );

    // The only claim the 2026-08-18 corpus validation supports: focusing a
    // non-prime enemy while a prime one exists (prime converts 2.5–6x above
    // the rest). No margin constant, no score arithmetic — a strict tier
    // difference or nothing. Among multiple prime alternatives, name the
    // lowest-HP one (HP was the strongest same-tier ranking signal measured:
    // top-vs-bottom quartile 27.7x). Unknown HP sorts last, never invented.
    const primeAlternatives = otherSnapshots.filter((s) => s.tier === "prime");
    const bestAlternative = primeAlternatives.reduce<IEnemySnapshot | null>(
      (best, s) => {
        if (!best) return s;
        return (s.hpPercent ?? Infinity) < (best.hpPercent ?? Infinity)
          ? s
          : best;
      },
      null,
    );
    const betterTargetExists =
      focusedSnapshot.tier !== "prime" && bestAlternative !== null;

    results.push({
      windowFromSeconds: window.fromSeconds,
      windowToSeconds: window.toSeconds,
      focusedTarget: focusedSnapshot,
      otherTargets: otherSnapshots,
      betterTargetExists,
      betterTargetName: betterTargetExists
        ? bestAlternative?.playerName
        : undefined,
      betterTargetSpec: betterTargetExists
        ? bestAlternative?.playerSpec
        : undefined,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

function fmtHp(hp: number | null): string {
  if (hp === null) return "HP unknown";
  return `${Math.round(hp)}% HP`;
}

function fmtDefensives(snap: IEnemySnapshot): string {
  if (
    snap.defensivesAvailable.length === 0 &&
    snap.defensivesUnavailable.length === 0
  ) {
    return "no defensives tracked";
  }
  const parts: string[] = [];
  if (snap.defensivesUnavailable.length > 0) {
    parts.push(
      `no defensives (${snap.defensivesUnavailable.join(", ")} spent)`,
    );
  } else if (snap.defensivesAvailable.length > 0) {
    parts.push(`defensives up: ${snap.defensivesAvailable.join(", ")}`);
  }
  parts.push(snap.trinketAvailable ? "trinket available" : "trinket on CD");
  return parts.join(", ");
}

export function formatKillWindowTargetSelectionForContext(
  evals: IKillWindowTargetEval[],
): string[] {
  if (evals.length === 0) return [];

  const lines: string[] = [];
  lines.push(
    "KILL WINDOW TARGET SELECTION — per-window enemy state comparison:",
  );

  for (const ev of evals) {
    lines.push("");
    lines.push(
      `  Window ${fmtTime(ev.windowFromSeconds)}–${fmtTime(ev.windowToSeconds)}:`,
    );

    // Focused target
    const f = ev.focusedTarget;
    lines.push(
      `    Focused: ${f.playerSpec} (${f.playerName}) — ${fmtHp(f.hpPercent)}, ${fmtDefensives(f)} ${fmtTier(f)}`,
    );

    // Alternatives
    for (const o of ev.otherTargets) {
      lines.push(
        `    Other:   ${o.playerSpec} (${o.playerName}) — ${fmtHp(o.hpPercent)}, ${fmtDefensives(o)} ${fmtTier(o)}`,
      );
    }

    if (ev.betterTargetExists && ev.betterTargetSpec && ev.betterTargetName) {
      lines.push(
        `    ⚠ Better target available: ${ev.betterTargetSpec} (${ev.betterTargetName}) had no trinket and no stun-usable defensive, while the focused target did`,
      );
    }
    // No line otherwise — the old "✓ Focused target was the correct or
    // equivalent choice" certificate was backed by the same unvalidated score
    // as the accusation and printed on 61.9% of windows; absent a validated
    // claim, print facts only (2026-08-18 redesign).
  }

  return lines;
}

/** Tier annotation for the prompt: the state itself plus what makes it so —
 * for gated the coach needs to know WHICH card to bait. */
function fmtTier(snap: IEnemySnapshot): string {
  switch (snap.tier) {
    case "prime":
      return "[kill-opportunity: PRIME — no trinket, no 20-99% wall in hand]";
    case "gated":
      return `[kill-opportunity: gated — ${snap.wallsInHand.join("/")} in hand]`;
    case "locked":
      return "[kill-opportunity: locked — trinket up]";
  }
}

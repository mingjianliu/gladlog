import {
  AtomicArenaCombat,
  CombatUnitSpec,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";

import { IPlayerCCTrinketSummary } from "./ccTrinketAnalysis";
import {
  auraOnlyActivationSeconds,
  CD_INSTANT_SLACK_S,
  isCooldownAvailableFromLastUse,
  REACTION_WINDOW_S,
  specToString,
} from "./cooldowns";
import { isStunCcInstance } from "./drAnalysis";
import {
  distanceBetween,
  getUnitPositionAtTime,
  hasLineOfSight,
} from "./losAnalysis";
import { fmtTime } from "./renderGrid";
import { spellReachForCaster } from "./spellRange";
import { talentOwnershipOf } from "./talentOwnership";

interface IImmunitySpell {
  name: string;
  cooldownSeconds: number;
  lockoutSpellId?: string;
  specs: CombatUnitSpec[];
  /** Spell IDs that reset this immunity's cooldown when cast (CDR/reset mechanics). */
  resetSpellIds?: string[];
}

// Exported (only) for the talent-ownership whitelist classification test and
// the corpus audit script (auditTalentOwnership.ts) — production consumers stay
// inside this module.
// 2026-08-21 S2 corpus scan (10,682 matches): removed Netherwalk 196555 — 0 occurrences, ability gone in 12.x (eval-private/reports/s2-health-2026-08-21)
export const IMMUNITY_SPELLS: Record<string, IImmunitySpell> = {
  "642": {
    name: "Divine Shield",
    cooldownSeconds: 300,
    lockoutSpellId: "25771",
    specs: [
      CombatUnitSpec.Paladin_Holy,
      CombatUnitSpec.Paladin_Retribution,
      CombatUnitSpec.Paladin_Protection,
    ],
  },
  "45438": {
    name: "Ice Block",
    cooldownSeconds: 240,
    lockoutSpellId: "41425",
    specs: [
      CombatUnitSpec.Mage_Arcane,
      CombatUnitSpec.Mage_Fire,
      CombatUnitSpec.Mage_Frost,
    ],
    // B30: Cold Snap (235219) resets Ice Block's cooldown
    resetSpellIds: ["235219"],
  },
  // 47585 Dispersion 移除(2026-08-21,GH #17/D1 对齐):D1 裁定分散 = 75%
  // 减伤非免疫(mitigationVerdicts),留在本表会重演「同一技能两个量级」
  // 的 D1 缺陷 —— 死亡语境把它说成免疫。事实不丢:它是 Defensive 大招,
  // death-unused-defensive(walls 路径)照常覆盖且标签正确。本表自此 =
  // MITIGATION_TABLE pct=100 ∧ schoolMask=0x7f 的全学派免疫(共识测试
  // immunityTables.test.ts 钉死);学派限定免疫(BoP/斗篷/护佑)刻意不进
  // 本表 —— 无击杀学派判定就断言「BoP 可救」会对魔法死亡撒谎。
  "186265": {
    name: "Aspect of the Turtle",
    cooldownSeconds: 180,
    specs: [
      CombatUnitSpec.Hunter_BeastMastery,
      CombatUnitSpec.Hunter_Marksmanship,
      CombatUnitSpec.Hunter_Survival,
    ],
  },
};

// The key set must be identical to spellIdLists.externalDefensiveSpellIds
// (14 entries; drift prevention lives in deathOutcome.whitelist.test.ts) —
// this table once held only 7 (one link in the chained rot of the external
// defensive whitelist: when the main whitelist grew to 14, this table did not
// follow, so the LoS/distance/cooldown judgements spun with no effect on the
// 8 missing spells). Cooldown seconds come from spellEffectGenerated.json
// (the official DB2 cooldownSeconds / chargeCooldownSeconds, which are
// equivalent when charges=1); specs are sourced in priority order:
// (1) SPEC_EXCLUSIVE_SPELLS in cooldowns.ts (whatever is registered there);
// (2) talentIdMap.json (the DB2 talent trees; look each spellId up in
//     classNodes/specNodes/heroNodes/subTreeNodes — whichever specs' trees it
//     appears in are the specs that can use it; 204018 alone corrected the old
//     belief that it was "shared by all three specs" — it is in fact a
//     Paladin_Protection spec talent).
const EXTERNAL_DEFENSIVE_SPELLS: Record<
  string,
  { name: string; cooldownSeconds: number; specs: CombatUnitSpec[] }
> = {
  // 2026-08-22 用户裁定「光掌是大技能,20% 全团」→ 减伤值进 MITIGATION_OVERRIDES,
  // 同批补登记进 externalDefensiveSpellIds;本表与那张表键集恒等(串联腐烂测试
  // deathOutcome.whitelist.test.ts 钉着),所以这里必须同步。CD 180s 取官方
  // spellEffectData(31821: cooldownSeconds 180 / duration 8)。
  // 专精只收神圣,两条独立证据一致:①官方天赋树 —— 31821 在**神圣的专精树**里
  // (分类复算 → "spec"),惩戒/防护两系树里都没有它,而这两系会落到 "baseline"
  // 分类,其语义是「该专精每个人必有」,那显然不对;②语料实证 250 场:施放 86 次、
  // 15 个施法者,**全部是神圣骑士**,惩戒/防护 0 次。写成三系就是 TALENT_BEHAVIORS
  // 那条教训的重演(把只有一系拿得到的技能算给全职业,凭空指控没有这技能的人)。
  "31821": {
    name: "Aura Mastery",
    cooldownSeconds: 180,
    specs: [CombatUnitSpec.Paladin_Holy],
  },
  "102342": {
    name: "Ironbark",
    cooldownSeconds: 45,
    specs: [CombatUnitSpec.Druid_Restoration],
  },
  "33206": {
    name: "Pain Suppression",
    cooldownSeconds: 180,
    specs: [CombatUnitSpec.Priest_Discipline],
  },
  "47788": {
    name: "Guardian Spirit",
    cooldownSeconds: 180,
    specs: [CombatUnitSpec.Priest_Holy],
  },
  "1022": {
    name: "Blessing of Protection",
    cooldownSeconds: 300,
    specs: [
      CombatUnitSpec.Paladin_Holy,
      CombatUnitSpec.Paladin_Retribution,
      CombatUnitSpec.Paladin_Protection,
    ],
  },
  "6940": {
    name: "Blessing of Sacrifice",
    cooldownSeconds: 120,
    specs: [
      CombatUnitSpec.Paladin_Holy,
      CombatUnitSpec.Paladin_Retribution,
      CombatUnitSpec.Paladin_Protection,
    ],
  },
  "116849": {
    name: "Life Cocoon",
    cooldownSeconds: 120,
    specs: [CombatUnitSpec.Monk_Mistweaver],
  },
  // The 8 entries below were added by this convergence pass (cooldownSeconds
  // looked up in spellEffectGenerated.json, using chargeCooldownSeconds for
  // charge-based spells; specs follow the cooldowns.ts registrations / class
  // ownership).
  "204018": {
    name: "Blessing of Spellwarding",
    cooldownSeconds: 300, // spellEffectGenerated: charges.chargeCooldownSeconds=300
    // talentIdMap.json: only Paladin Protection specNodes match (a merged node
    // with "Improved Ardent Defender") — it is not a class-wide blessing
    // shared by all three specs (correcting a common old belief).
    specs: [CombatUnitSpec.Paladin_Protection],
  },
  "62618": {
    name: "Power Word: Barrier",
    cooldownSeconds: 180, // spellEffectGenerated: cooldownSeconds=180
    specs: [CombatUnitSpec.Priest_Discipline], // cooldowns.ts SPEC_EXCLUSIVE_SPELLS
  },
  "98008": {
    name: "Spirit Link Totem",
    cooldownSeconds: 180, // spellEffectGenerated: charges.chargeCooldownSeconds=180
    specs: [CombatUnitSpec.Shaman_Restoration], // cooldowns.ts SPEC_EXCLUSIVE_SPELLS
  },
  "97462": {
    name: "Rallying Cry",
    cooldownSeconds: 180, // spellEffectGenerated: cooldownSeconds=180
    specs: [
      CombatUnitSpec.Warrior_Arms,
      CombatUnitSpec.Warrior_Fury,
      CombatUnitSpec.Warrior_Protection,
    ], // Warrior class-wide ability (classSpells.ts does not split it by spec; all three can use it)
  },
  "196718": {
    name: "Darkness",
    cooldownSeconds: 300, // spellEffectGenerated: cooldownSeconds=300
    // talentIdMap.json: all three specs' classNodes match (Havoc/Vengeance/
    // Devourer) — a Demon Hunter class-wide talent, not exclusive to one spec.
    specs: [
      CombatUnitSpec.DemonHunter_Havoc,
      CombatUnitSpec.DemonHunter_Vengeance,
      CombatUnitSpec.DemonHunter_Devourer,
    ],
  },
  "51052": {
    name: "Anti-Magic Zone",
    cooldownSeconds: 240, // spellEffectGenerated: cooldownSeconds=240
    specs: [
      CombatUnitSpec.DeathKnight_Blood,
      CombatUnitSpec.DeathKnight_Frost,
      CombatUnitSpec.DeathKnight_Unholy,
    ], // Death Knight class-wide ability (classSpells.ts does not split it by spec; all three can use it)
  },
  "357170": {
    name: "Time Dilation",
    cooldownSeconds: 60, // spellEffectGenerated: charges.chargeCooldownSeconds=60
    specs: [CombatUnitSpec.Evoker_Preservation], // Preservation Evoker spec talent
  },
  "374227": {
    name: "Zephyr",
    cooldownSeconds: 120, // spellEffectGenerated: cooldownSeconds=120
    // talentIdMap.json: all three specs' classNodes match (Devastation/
    // Preservation/Augmentation) — an Evoker class-wide talent, not exclusive
    // to Preservation.
    specs: [
      CombatUnitSpec.Evoker_Devastation,
      CombatUnitSpec.Evoker_Preservation,
      CombatUnitSpec.Evoker_Augmentation,
    ],
  },
};

export { EXTERNAL_DEFENSIVE_SPELLS };

export interface IDeathImmuneAvailable {
  spellId: string;
  spellName: string;
  wasInCC: boolean;
}

export interface IMissedExternal {
  casterName: string;
  casterSpec: string;
  spellId: string;
  spellName: string;
  casterWasInCC: boolean;
}

export interface IDeathOutcomeEvent {
  deadPlayer: string;
  deadPlayerSpec: string;
  atSeconds: number;
  availableImmunities: IDeathImmuneAvailable[];
  missedExternals: IMissedExternal[];
}

export interface IDeathOutcomeSummary {
  events: IDeathOutcomeEvent[];
}

/**
 * Seconds of the most recent cast at or before atSeconds; casts after
 * atSeconds are excluded — semantically aligned with cdAvailableAt's adapter
 * logic (`casts.filter(c => c.timeSeconds <= tSeconds).pop()`): an
 * availability judgement at a death / query instant may only look at what had
 * already happened by then, and a future re-cast cannot make that past moment
 * "unavailable".
 *
 * Follow-up round fix (2026-07-31): this previously used `Math.max` over all
 * casts of that spellId in the match without truncating at atSeconds — so if
 * the unit cast the same immunity again after the query instant, that future
 * cast was mistaken for the "last use", and deaths earlier than that cast were
 * falsely reported as "unavailable".
 *
 * Task-7 follow-up (2026-08-14): also unions in `auraOnlyActivationSeconds`
 * (cooldowns.ts) — the same aura-only-activation evidence `cdAvailableAt`'s
 * ledger consumes via `extractMajorCooldowns`. Dormant today (no id in
 * IMMUNITY_SPELLS/EXTERNAL_DEFENSIVE_SPELLS is currently registered in
 * AURA_ONLY_ACTIVATION_IDS), but without this a future table entry would fix
 * the cd ledger while this death-outcome path kept calling the same spell
 * "available" at a death where it had actually just fired — see
 * `auraOnlyActivationSeconds`'s doc comment for the full story.
 */
function lastCastSeconds(
  unit: ICombatUnit,
  spellId: string,
  matchStartMs: number,
  atSeconds: number,
): number | null {
  const castSeconds = unit.spellCastEvents
    .filter(
      (e) =>
        e.spellId === spellId &&
        e.logLine.event === LogEvent.SPELL_CAST_SUCCESS,
    )
    .map((e) => (e.logLine.timestamp - matchStartMs) / 1000);
  const auraSeconds = auraOnlyActivationSeconds(unit, spellId, matchStartMs);
  const casts = [...castSeconds, ...auraSeconds].filter((t) => t <= atSeconds);
  if (casts.length === 0) return null;
  return Math.max(...casts);
}

// BACKLOG #21 item2: exported (only) so the drift-prevention unit test can call this predicate
// directly alongside cdAvailableAt — not otherwise used outside this module.
export function isAvailableAt(
  unit: ICombatUnit,
  spellId: string,
  cooldownSeconds: number,
  atSeconds: number,
  matchStartMs: number,
  resetSpellIds?: string[],
): boolean {
  // Rendered-second slack (CD_INSTANT_SLACK_S, GH #61): the same instant the
  // [RES] ledger renders — a cast up to 0.5 s after the death counts as
  // "pressed" (too late is not "never pressed"), exactly as the ledger shows
  // it on cd: for the same rendered second.
  const at = atSeconds + CD_INSTANT_SLACK_S;
  const lastCast = lastCastSeconds(unit, spellId, matchStartMs, at);
  // The core predicate is shared with cdAvailableAt in cooldowns.ts
  // (isCooldownAvailableFromLastUse) — each side keeps its own data source
  // (raw spellCastEvents vs the resolved casts ledger) and this side keeps the
  // resetSpellIds extension below; see the comment above that function.
  if (isCooldownAvailableFromLastUse(lastCast, cooldownSeconds, at))
    return true;

  // B30: if a reset spell was cast between the last use and atSeconds, the cooldown was reset.
  // Treat the reset cast as the new "last cast" and check availability from there.
  if (lastCast !== null && resetSpellIds && resetSpellIds.length > 0) {
    for (const resetId of resetSpellIds) {
      const resetCast = lastCastSeconds(unit, resetId, matchStartMs, at);
      if (resetCast !== null && resetCast > lastCast && resetCast <= at) {
        // Reset happened after the last use — it is now available
        return true;
      }
    }
  }
  return false;
}

/** `isAvailableAt` under the reaction window — the same rule as cooldowns.ts
 * `cdReadyInTimeAt` (REACTION_WINDOW_S, user ruling 2026-09-23): ready by
 * t − 1 s and not pressed through t's rendered instant. Every "had X
 * available" claim this module renders goes through here. */
export function isReadyInTimeAt(
  unit: ICombatUnit,
  spellId: string,
  cooldownSeconds: number,
  atSeconds: number,
  matchStartMs: number,
  resetSpellIds?: string[],
): boolean {
  return (
    isAvailableAt(
      unit,
      spellId,
      cooldownSeconds,
      atSeconds,
      matchStartMs,
      resetSpellIds,
    ) &&
    isAvailableAt(
      unit,
      spellId,
      cooldownSeconds,
      atSeconds - REACTION_WINDOW_S - CD_INSTANT_SLACK_S,
      matchStartMs,
      resetSpellIds,
    )
  );
}

/** Pre-computed lockout intervals: [fromSeconds, toSeconds] pairs sorted by fromSeconds. */
type LockoutIntervals = [number, number][];

/** Build lockout intervals for one (unit, spellId) pair once per match. */
function buildLockoutIntervals(
  unit: ICombatUnit,
  lockoutSpellId: string,
  matchStartMs: number,
): LockoutIntervals {
  const relevant = unit.auraEvents
    .filter((e) => e.spellId === lockoutSpellId)
    .sort((a, b) => {
      if (a.logLine.timestamp !== b.logLine.timestamp)
        return a.logLine.timestamp - b.logLine.timestamp;
      if (a.logLine.event === LogEvent.SPELL_AURA_APPLIED) return -1;
      if (b.logLine.event === LogEvent.SPELL_AURA_APPLIED) return 1;
      return 0;
    });

  const intervals: LockoutIntervals = [];
  let openAt: number | null = null;
  for (const e of relevant) {
    const t = (e.logLine.timestamp - matchStartMs) / 1000;
    if (e.logLine.event === LogEvent.SPELL_AURA_APPLIED) openAt = t;
    else if (
      e.logLine.event === LogEvent.SPELL_AURA_REMOVED &&
      openAt !== null
    ) {
      intervals.push([openAt, t]);
      openAt = null;
    }
  }
  return intervals;
}

/** B29: O(log N) lockout check using pre-built intervals. */
function isLockedOutAt(
  intervals: LockoutIntervals,
  atSeconds: number,
): boolean {
  let lo = 0;
  let hi = intervals.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const [from, to] = intervals[mid];
    if (atSeconds < from) {
      hi = mid - 1;
    } else if (atSeconds > to) {
      lo = mid + 1;
    } else {
      return true; // atSeconds is within [from, to]
    }
  }
  return false;
}

/** Lethal-window length used to judge whether a player could have pressed a defensive before dying. */
export const LETHAL_WINDOW_SECONDS = 5;
/** Minimum contiguous CC-free gap (seconds) that counts as "they had a moment to press something". */
export const MIN_FREE_GAP_SECONDS = 1;

interface LockoutWindowResult {
  maxFreeGapSeconds: number;
  /** True iff every CC instance that overlaps the window (post trinket-used
   * filter) is Stun-category (per its `drInfo.category`, the same DR
   * categorization DR_CATEGORIES_GENERATED/DR_CATEGORY_MAP feeds — shared-
   * predicate rule). Conservative: an unknown/null category (drInfo absent)
   * counts as non-stun, same direction as everything else in this window
   * that would rather under-accuse than over-accuse. */
  allContributingAreStun: boolean;
}

/**
 * Shared window-scan core for `wasLockedOutThroughWindow` /
 * `wasLockedOutByStunOnly` (single source — CLAUDE.md shared-predicate
 * rule): both read the same [death - windowSeconds, death] interval math,
 * one asking "was there any CC-free gap" and the other additionally asking
 * "was every contributing CC a stun". Returns null when the window is empty
 * (deathSeconds <= windowStart), matching the original early-return.
 */
function computeLockoutWindow(
  ccSummary: Pick<IPlayerCCTrinketSummary, "playerName" | "ccInstances">,
  deathSeconds: number,
  windowSeconds: number,
): LockoutWindowResult | null {
  const windowStart = Math.max(0, deathSeconds - windowSeconds);
  const windowEnd = deathSeconds;
  if (windowEnd <= windowStart) return null;

  const intervals = ccSummary.ccInstances
    .filter((cc) => cc.trinketState !== "used")
    .map((cc) => ({
      start: Math.max(windowStart, cc.atSeconds),
      end: Math.min(windowEnd, cc.atSeconds + cc.durationSeconds),
      isStun: isStunCcInstance(cc),
    }))
    .filter((iv) => iv.end > iv.start)
    .sort((a, b) => a.start - b.start);

  let cursor = windowStart;
  let maxFreeGap = 0;
  let allContributingAreStun = true;
  for (const iv of intervals) {
    if (iv.start > cursor) maxFreeGap = Math.max(maxFreeGap, iv.start - cursor);
    if (!iv.isStun) allContributingAreStun = false;
    cursor = Math.max(cursor, iv.end);
  }
  if (windowEnd > cursor) maxFreeGap = Math.max(maxFreeGap, windowEnd - cursor);

  return { maxFreeGapSeconds: maxFreeGap, allContributingAreStun };
}

/**
 * True only if the player had NO contiguous CC-free gap >= MIN_FREE_GAP_SECONDS in the
 * [death - windowSeconds, death] window — i.e. they were effectively locked out for the
 * whole lethal window. CC the player trinketed out of (`trinketState === 'used'`) does not
 * count as lockout. Uniform CC model: every CC type is treated the same for THIS boolean
 * (it only answers "were they locked out at all", used for informational "was in CC" tags
 * and combined by callers with `wasLockedOutByStunOnly` where the CC type matters — see
 * that function's doc comment).
 */
export function wasLockedOutThroughWindow(
  ccSummary: Pick<IPlayerCCTrinketSummary, "playerName" | "ccInstances">,
  deathSeconds: number,
  windowSeconds = LETHAL_WINDOW_SECONDS,
): boolean {
  const result = computeLockoutWindow(ccSummary, deathSeconds, windowSeconds);
  if (!result) return false;
  return result.maxFreeGapSeconds < MIN_FREE_GAP_SECONDS;
}

/**
 * True only when the player was locked out through the window (per
 * `wasLockedOutThroughWindow` above) AND every CC instance that contributed
 * to that lockout was Stun-category.
 *
 * Why this matters (finding #1, 2026-08-14 final review): `USABLE_WHILE_CC_SPELL_IDS`
 * (cooldowns.ts) is a **stunned**-semantics table — its source is DB2's "usable
 * while stunned" SpellMisc attribute bits (usableWhileCcGenerated.ts) plus a
 * small unconditional gap layer researched the same way. It says nothing about
 * whether an ability is usable while feared, disoriented, or incapacitated.
 * Two consumers (`matchTimelineSections.ts`'s [DEATH] Unused list and
 * `candidateFindings.ts`'s `deathUnusedDefensiveEvents`) used to gate their
 * "was this wall exempt from blame" check on `wasLockedOutThroughWindow` +
 * `USABLE_WHILE_CC_SPELL_IDS.has(...)` alone — which meant a player locked out
 * by Fear for the whole lethal window (not a stun) could still be blamed for
 * not pressing e.g. 1022 Blessing of Protection, because 1022 happens to sit in
 * the *stunned* table (confirmed usable-while-stunned by user sign-off — but
 * that sign-off explicitly recorded 1022's feared dimension as `false`, see
 * task-2-report.md anchors). A lockout window that contains ANY non-stun hard
 * CC must therefore be exempted unconditionally, not checked against the
 * stunned table at all — only a lockout window built entirely from stun CC may
 * consult it.
 */
export function wasLockedOutByStunOnly(
  ccSummary: Pick<IPlayerCCTrinketSummary, "playerName" | "ccInstances">,
  deathSeconds: number,
  windowSeconds = LETHAL_WINDOW_SECONDS,
): boolean {
  const result = computeLockoutWindow(ccSummary, deathSeconds, windowSeconds);
  if (!result) return false;
  return (
    result.maxFreeGapSeconds < MIN_FREE_GAP_SECONDS &&
    result.allContributingAreStun
  );
}

// Per-spell reach for "could this teammate have thrown it": official DB2 via
// data/spellReachGenerated.json (GH #34 batch 4 ②, user ruling 2026-08-29) —
// cast range for targeted spells, range + radius for placed areas, radius for
// caster-centred auras. The old single constant (40 yd, "all are 40-yard
// targeted spells") was false for 6 of 15: Time Dilation and Anti-Magic Zone
// are 30 yd, Rallying Cry / Aura Mastery / Darkness / Zephyr are auras.
// Darkness 196718 has no radius anywhere in DB2 (the 8 yd zone lives on the
// area-trigger object), so it is the one hand value here, with provenance.
// Anything missing from the table falls back to the old 40 — never lower,
// so an unlisted spell cannot start acquitting teammates silently.
const EXTERNAL_REACH_FALLBACK_YARDS = 40;
const EXTERNAL_REACH_HAND_OVERRIDES: Record<string, number> = {
  "196718": 8, // Darkness — zone radius; not derivable from SpellEffect/SpellRadius
};
// GH #83 (user ruling 2026-09-23, "戒律牧46码必须修 看天赋修"): the reach is
// the CASTER's — the caster's range / radius talents applied through
// `spellReachForCaster` (Phantom Reach: Pain Suppression / Guardian Spirit
// 46 yd; Astral Influence: Ironbark 45). Without a caster the official
// number stands, exactly as before.
export function externalReachYards(
  spellId: string,
  caster?: Parameters<typeof spellReachForCaster>[0],
): number {
  const hand = EXTERNAL_REACH_HAND_OVERRIDES[spellId];
  if (hand !== undefined) return hand;
  return spellReachForCaster(caster, spellId) ?? EXTERNAL_REACH_FALLBACK_YARDS;
}

export function buildDeathOutcomeSummary(
  combat: Pick<AtomicArenaCombat, "startTime"> & { zoneId?: string },
  friends: ICombatUnit[],
  ccSummaries: Pick<IPlayerCCTrinketSummary, "playerName" | "ccInstances">[],
  /**
   * Returns the **resolved** cooldown seconds for a unit's spell (i.e. the
   * exact value the `[RES]` ledger renders, talent modifiers included). When
   * provided it takes precedence over the constants in the
   * EXTERNAL_DEFENSIVE_SPELLS table below.
   *
   * Why it must be provided: this table used to carry its own
   * cooldownSeconds, maintained separately from the main path
   * (extractMajorCooldowns → spellEffectData + talent modifiers), so one spell
   * had two values. Evidence (2026-07-20, ord 041): this table said Ironbark
   * was 45s while the ledger resolved 65s, so after a cast at 0:52 this block
   * judged it "available" at 1:53 while the ledger wrote
   * `cd:Ironbark(7s)` for the same second — the same prompt drawing opposite
   * conclusions about the same cooldown. Single-source predicate: an
   * availability judgement must consume the same cooldown value.
   */
  resolvedCooldownSeconds?: (
    unit: ICombatUnit,
    spellId: string,
  ) => number | undefined,
): IDeathOutcomeSummary {
  const matchStartMs = combat.startTime;
  const events: IDeathOutcomeEvent[] = [];

  // B29: pre-build lockout intervals once per (unit, spell) pair to avoid O(N) filter+sort per death
  const lockoutCache = new Map<string, LockoutIntervals>();
  const getLockoutIntervals = (
    unit: ICombatUnit,
    spellId: string,
  ): LockoutIntervals => {
    const key = `${unit.id}:${spellId}`;
    if (!lockoutCache.has(key))
      lockoutCache.set(key, buildLockoutIntervals(unit, spellId, matchStartMs));
    return lockoutCache.get(key) ?? [];
  };

  for (const unit of friends) {
    for (const deathRecord of unit.deathRecords) {
      const atSeconds = (deathRecord.timestamp - matchStartMs) / 1000;
      const ccSummary = ccSummaries.find((s) => s.playerName === unit.name);

      const availableImmunities: IDeathImmuneAvailable[] = [];
      for (const [spellId, spell] of Object.entries(IMMUNITY_SPELLS)) {
        if (!spell.specs.includes(unit.spec)) continue;
        // Talent-ownership gate (issue #8 / BACKLOG #23-1): the spec table
        // only says the spec COULD take the spell. A confirmed "didn't talent
        // it" verdict must not produce a "had X available" claim; "unknown"
        // (old archives, baseline spells) passes through — never filter on
        // missing data. Per-round unit (Solo Shuffle talents change between
        // rounds), see talentOwnershipOf's granularity contract.
        if (talentOwnershipOf(unit, spellId) === "no") continue;
        if (
          !isReadyInTimeAt(
            unit,
            spellId,
            spell.cooldownSeconds,
            atSeconds,
            matchStartMs,
            spell.resetSpellIds,
          )
        )
          continue;
        if (
          spell.lockoutSpellId &&
          isLockedOutAt(
            getLockoutIntervals(unit, spell.lockoutSpellId),
            atSeconds,
          )
        )
          continue;
        availableImmunities.push({
          spellId,
          spellName: spell.name,
          wasInCC: ccSummary
            ? wasLockedOutThroughWindow(ccSummary, atSeconds)
            : false,
        });
      }

      const deathMs = deathRecord.timestamp;
      const dyingPos = getUnitPositionAtTime(unit, deathMs);

      const missedExternals: IMissedExternal[] = [];
      for (const teammate of friends) {
        if (teammate.id === unit.id) continue;
        // A teammate who is already dead at this death cannot cast an external — don't list their
        // tools as "available" (would blame a dead player for not saving a later death).
        if (
          teammate.deathRecords.some((d) => d.timestamp < deathRecord.timestamp)
        )
          continue;
        const teammateCCSummary = ccSummaries.find(
          (s) => s.playerName === teammate.name,
        );

        // B27: skip if teammate was LoS-blocked at death time; the per-spell
        // reach check happens inside the spell loop (GH #34 ②).
        const casterPos = getUnitPositionAtTime(teammate, deathMs);
        const casterDistance =
          dyingPos && casterPos ? distanceBetween(dyingPos, casterPos) : null;
        if (dyingPos && casterPos && combat.zoneId) {
          const los = hasLineOfSight(combat.zoneId, casterPos, dyingPos);
          if (los === false) continue; // confirmed LoS blocked (null = unmapped, pass through)
        }

        for (const [spellId, spell] of Object.entries(
          EXTERNAL_DEFENSIVE_SPELLS,
        )) {
          const everCast = teammate.spellCastEvents.some(
            (e) =>
              e.spellId === spellId &&
              e.logLine.event === LogEvent.SPELL_CAST_SUCCESS,
          );
          if (!everCast && !spell.specs.includes(teammate.spec)) continue;
          if (
            casterDistance !== null &&
            casterDistance > externalReachYards(spellId, teammate)
          )
            continue;
          // Talent-ownership gate (issue #8 / BACKLOG #23-1): PW:Barrier &co
          // are choice-node talents most players skip — a Disc priest without
          // the talent must not be told "you had Power Word: Barrier
          // available". Confirmed "no" filters; "unknown" passes (never
          // filter on missing data). Cast evidence returns "yes" inside the
          // predicate, so the everCast case above stays covered. Per-round
          // unit (Solo Shuffle talents change between rounds).
          if (talentOwnershipOf(teammate, spellId) === "no") continue;
          // Prefer the **resolved** cooldown (same source as the [RES] ledger,
          // talent modifiers included); only fall back to this table's
          // constant when it is unavailable. See the root-cause note at this
          // function's signature.
          if (
            !isReadyInTimeAt(
              teammate,
              spellId,
              resolvedCooldownSeconds?.(teammate, spellId) ??
                spell.cooldownSeconds,
              atSeconds,
              matchStartMs,
            )
          )
            continue;
          missedExternals.push({
            casterName: teammate.name,
            casterSpec: specToString(teammate.spec),
            spellId,
            spellName: spell.name,
            casterWasInCC: teammateCCSummary
              ? wasLockedOutThroughWindow(teammateCCSummary, atSeconds)
              : false,
          });
        }
      }

      if (availableImmunities.length > 0 || missedExternals.length > 0) {
        events.push({
          deadPlayer: unit.name,
          deadPlayerSpec: specToString(unit.spec),
          atSeconds,
          availableImmunities,
          missedExternals,
        });
      }
    }
  }

  return { events };
}

export function formatDeathOutcomeForContext(
  summary: IDeathOutcomeSummary,
): string {
  if (summary.events.length === 0) return "";
  const lines: string[] = ["DEATHS WITH MISSED OPTIONS"];
  for (const ev of summary.events) {
    const t = fmtTime(ev.atSeconds);
    for (const imm of ev.availableImmunities) {
      const ccNote = imm.wasInCC ? ", was in CC" : ", was not CC'd";
      lines.push(
        `  [${t}] ${ev.deadPlayerSpec} (${ev.deadPlayer}) — had ${imm.spellName} available${ccNote}`,
      );
    }
    for (const ext of ev.missedExternals) {
      const ccNote = ext.casterWasInCC ? ", caster in CC" : ", caster was free";
      lines.push(
        `  [${t}] ${ev.deadPlayer} died — ${ext.casterName} had ${ext.spellName} available${ccNote}`,
      );
    }
  }
  return lines.join("\n");
}

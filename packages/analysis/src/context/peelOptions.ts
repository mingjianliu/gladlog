/**
 * PEEL OPTIONS — `[PEEL OPTION]` lines (GH #77 first version).
 *
 * User rulings:
 *  - 2026-09-19: a death picks the review window; offer a CC on the main
 *    attacker as an ADDITIONAL way to take pressure off. Never say it would
 *    have saved the teammate, never call not using it a mistake, say nothing
 *    when the evidence is thin.
 *  - 2026-09-24 ("77只做顺发"): instant CCs only. A cast-time CC completes
 *    only 59 % of the time it is started (eval-private
 *    reports/gh77-peel-examples-2026-09-24, peelTruthProbe), while an instant
 *    CC that this predicate calls feasible lands 94–98 % of the time.
 *  - 2026-09-24: usable for at least PEEL_MIN_USABLE_S seconds; the victim's
 *    own CC counts, but never a second in which the victim could not act;
 *    enemy dispels are NOT counted (a free, ready enemy healer still leaves
 *    ~80 % of dispellable instant CCs alone); the TARGET's own tools are —
 *    "战士自己可以解恐 … dps自己的技能要算进去" (Berserker Rage on a fear).
 *
 * A second counts only when all of these hold (whole render seconds):
 *  - the CC is reaction-ready (`cdReadyInTimeAt`) and was not cast anywhere in
 *    the window;
 *  - its owner is not CC'd (`buildCannotCastIntervals`) and not inside an
 *    aura that locks their own casting (Bladestorm, Ice Block — DB2 aura
 *    60 / 263, `auraLocksCasting`);
 *  - the attacker is within the owner's talent-applied reach
 *    (`spellReachForCaster`; unknown reach → no line) with line of sight not
 *    falsified, not already in a CC, not carrying an aura that blocks that
 *    mechanic (`auraBlocksMechanic`; an unresolved mask → no line), and not
 *    at Immune DR for that category;
 *  - the attacker has no ready ability of their own that breaks that
 *    mechanic: kit-evidenced and ready (`kitSpellReadyAt`), and either a
 *    designed breaker (the mechanic is on its own DB2 aura 77 —
 *    `explicitlyBreaksMechanic`, corpus-confirmed) or a full-school immunity
 *    the official usable-while attribute allows in that state.
 * The attacker's PvP trinket is reported, not gated: forcing it is a
 * consequence the prompt may state (GH #70).
 */
import type { AtomicArenaCombat, ICombatUnit } from "@gladlog/parser-compat";

import { ccSpellIds } from "../data/spellTags";
import { buildAuraIntervals } from "../utils/auraIntervals";
import { buildCannotCastIntervals } from "../utils/cannotCastIntervals";
import type { IPlayerCCTrinketSummary } from "../utils/ccTrinketAnalysis";
import {
  cdReadyInTimeAt,
  extractMajorCooldowns,
  kitSpellReadyAt,
  playerTalentIdSets,
  USABLE_WHILE_CC_SPELL_IDS,
  USABLE_WHILE_CONFUSED_SPELL_IDS,
  USABLE_WHILE_FEARED_SPELL_IDS,
} from "../utils/cooldowns";
import { getDRCategory, getDRLevel } from "../utils/drAnalysis";
import {
  distanceBetween,
  getUnitPositionAtTime,
  hasLineOfSight,
} from "../utils/losAnalysis";
import { INTERP_MAX_GAP_MS } from "../utils/positionSampling";
import { fmtTime } from "../utils/renderGrid";
import {
  auraBlocksMechanic,
  auraLocksCasting,
  ccMechanicOf,
  explicitlyBreaksMechanic,
  isInstantCast,
  mechanicStateOf,
} from "../utils/spellMechanics";
import { spellReachForCaster } from "../utils/spellRange";

/** How far back from a death the window reaches (seconds). */
export const PEEL_LOOKBACK_S = 10;
/** User ruling 2026-09-24: the CC must have been usable at least this many
 * whole seconds inside the window. */
export const PEEL_MIN_USABLE_S = 3;
/** At most this many lines per death, longest-usable first. */
export const PEEL_MAX_PER_DEATH = 2;

export const PEEL_SECTION_HEADER =
  "PEEL OPTIONS — before a friendly death: an INSTANT crowd control a teammate (or the victim) had ready on the enemy who did most of the victim's damage in the 10 s before the death, and did not use. Every counted second had: the CC reaction-ready, its owner free to act, the target in range and line of sight, not already CC'd, not immune, not at Immune DR, and no ready ability of the target's own that breaks that kind of CC. Enemy dispels are not considered. Use it only as an extra way the player could have taken pressure off, in your own words; never say using it would have saved the teammate, and never call not using it a mistake.";

export interface IPeelOption {
  victimName: string;
  deathAtSeconds: number;
  attackerName: string;
  attackerShare: number;
  ownerName: string;
  ownerIsVictim: boolean;
  spellId: string;
  spellName: string;
  usableSeconds: number[];
  distanceYards: number;
  drLevel: string;
  attackerTrinketReady: boolean | null;
}

type Interval = { from: number; to: number };
const inAny = (ivs: Interval[], ms: number) =>
  ivs.some((w) => w.from <= ms && ms < w.to);

function breakToolsFor(attacker: ICombatUnit, mech: number): string[] {
  const state = mechanicStateOf(mech);
  const usableIn =
    state === "stunned"
      ? USABLE_WHILE_CC_SPELL_IDS
      : state === "feared"
        ? USABLE_WHILE_FEARED_SPELL_IDS
        : state === "confused"
          ? USABLE_WHILE_CONFUSED_SPELL_IDS
          : null;
  const ids = new Set<string>();
  for (const e of attacker.spellCastEvents ?? [])
    if (e.spellId) ids.add(e.spellId);
  // A designed breaker (mechanic listed on its own aura 77) counts outright;
  // a full-school immunity (Ice Block, Divine Shield) only where the official
  // usable-while attribute says it can be pressed in that state (user ruling
  // 2026-09-04: neither is usable while stunned).
  return [...ids].filter(
    (id) =>
      explicitlyBreaksMechanic(id, mech) ||
      (auraBlocksMechanic(id, mech) === true &&
        (usableIn === null || usableIn.has(id))),
  );
}

export function peelOptionsForDeaths(params: {
  combat: AtomicArenaCombat;
  friends: ICombatUnit[];
  enemies: ICombatUnit[];
  friendlyDeaths: ReadonlyArray<{ name: string; atSeconds: number }>;
  enemyCC: ReadonlyArray<IPlayerCCTrinketSummary>;
  /** Every unit in the match, so enemy pets' damage folds into their owner. */
  allUnits?: ReadonlyArray<Pick<ICombatUnit, "id" | "ownerId">>;
}): IPeelOption[] {
  const { combat, friends, enemies, friendlyDeaths, enemyCC } = params;
  const allUnits = params.allUnits ?? Object.values(combat.units);
  const start = combat.startTime;
  const zone = String(combat.startInfo?.zoneId ?? "");
  const enemyIds = new Set(enemies.map((u) => u.id));
  const enemyPetOwner = new Map<string, string>();
  for (const u of allUnits)
    if (u.ownerId && enemyIds.has(u.ownerId))
      enemyPetOwner.set(u.id, u.ownerId);
  const out: IPeelOption[] = [];

  for (const death of friendlyDeaths) {
    const tD = death.atSeconds;
    if (tD < PEEL_LOOKBACK_S) continue;
    const victim = friends.find((u) => u.name === death.name);
    if (!victim) continue;

    // Main attacker: the enemy player (pets folded into their owner) with the
    // most damage on the victim in the window.
    const dmg = new Map<string, number>();
    let total = 0;
    for (const e of victim.damageIn ?? []) {
      const t = (e.timestamp - start) / 1000;
      if (t < tD - PEEL_LOOKBACK_S || t > tD) continue;
      const src = enemyIds.has(e.srcUnitId)
        ? e.srcUnitId
        : enemyPetOwner.get(e.srcUnitId);
      if (!src || !enemyIds.has(src)) continue;
      const a = Math.abs(e.effectiveAmount ?? e.amount ?? 0);
      dmg.set(src, (dmg.get(src) ?? 0) + a);
      total += a;
    }
    const top = [...dmg.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!top || total === 0) continue;
    const attacker = enemies.find((u) => u.id === top[0])!;
    const attackerCc = buildAuraIntervals(attacker, combat).filter((iv) =>
      ccSpellIds.has(iv.spellId),
    );
    const attackerAuras = buildAuraIntervals(attacker, combat);
    const trinket = enemyCC.find((s) => s.playerName === attacker.name);

    const perDeath: IPeelOption[] = [];
    for (const o of friends) {
      if (o.deathRecords.some((r) => (r.timestamp - start) / 1000 < tD))
        continue;
      let cds: ReturnType<typeof extractMajorCooldowns> = [];
      try {
        cds = extractMajorCooldowns(o, combat).filter(
          (cd) => ccSpellIds.has(cd.spellId) && isInstantCast(cd.spellId),
        );
      } catch {
        continue;
      }
      if (cds.length === 0) continue;
      const cannot = buildCannotCastIntervals(o, enemyIds);
      const locks: Interval[] = buildAuraIntervals(o, combat)
        .filter((iv) => auraLocksCasting(iv.spellId))
        .map((iv) => ({
          from: start + iv.fromS * 1000,
          to: start + iv.toS * 1000,
        }));
      for (const cd of cds) {
        if (
          cd.casts.some(
            (c) => c.timeSeconds >= tD - PEEL_LOOKBACK_S && c.timeSeconds <= tD,
          )
        )
          continue;
        const mech = ccMechanicOf(cd.spellId);
        const reach = spellReachForCaster(o, cd.spellId);
        if (mech === undefined || reach === null) continue;
        const cat = getDRCategory(cd.spellId);
        const drHistory = attackerCc
          .filter((iv) => getDRCategory(iv.spellId) === cat)
          .map((iv) => ({
            applyMs: start + iv.fromS * 1000,
            removeMs: start + iv.toS * 1000,
            spellId: iv.spellId,
          }));
        const blockers = attackerAuras.filter(
          (iv) => auraBlocksMechanic(iv.spellId, mech) !== false,
        );
        const tools = breakToolsFor(attacker, mech);
        const attackerTalents = playerTalentIdSets(attacker);

        const secs: number[] = [];
        let firstDist = 0;
        let firstDr = "Full";
        for (let s = Math.ceil(tD - PEEL_LOOKBACK_S); s < tD; s++) {
          const ms = start + s * 1000;
          if (!cdReadyInTimeAt(cd, s)) continue;
          if (inAny(cannot, ms) || inAny(locks, ms)) continue;
          if (attackerCc.some((iv) => iv.fromS <= s && s < iv.toS)) continue;
          if (blockers.some((iv) => iv.fromS <= s && s < iv.toS)) continue;
          const po = getUnitPositionAtTime(o, ms, INTERP_MAX_GAP_MS);
          const pa = getUnitPositionAtTime(attacker, ms, INTERP_MAX_GAP_MS);
          if (!po || !pa) continue;
          const dist = distanceBetween(po, pa);
          if (dist > reach) continue;
          if (hasLineOfSight(zone, po, pa) === false) continue;
          const dr = cat
            ? getDRLevel(
                drHistory.filter((h) => h.applyMs < ms),
                ms,
              ).level
            : "Full";
          if (dr === "Immune") continue;
          if (
            tools.some((id) =>
              kitSpellReadyAt(attacker, id, s, start, attackerTalents),
            )
          )
            continue;
          if (secs.length === 0) {
            firstDist = dist;
            firstDr = dr;
          }
          secs.push(s);
        }
        if (secs.length < PEEL_MIN_USABLE_S) continue;
        const from = secs[0]!;
        const trinketReady = !trinket
          ? null
          : !trinket.trinketUseTimes.some(
              (u) => u <= from && from - u < trinket.trinketCooldownSeconds,
            );
        perDeath.push({
          victimName: victim.name,
          deathAtSeconds: tD,
          attackerName: attacker.name,
          attackerShare: top[1] / total,
          ownerName: o.name,
          ownerIsVictim: o.id === victim.id,
          spellId: cd.spellId,
          spellName: cd.spellName,
          usableSeconds: secs,
          distanceYards: firstDist,
          drLevel: firstDr,
          attackerTrinketReady: trinketReady,
        });
      }
    }
    perDeath
      .sort((a, b) => b.usableSeconds.length - a.usableSeconds.length)
      .slice(0, PEEL_MAX_PER_DEATH)
      .forEach((p) => out.push(p));
  }
  return out.sort(
    (a, b) =>
      a.usableSeconds[0]! - b.usableSeconds[0]! ||
      a.deathAtSeconds - b.deathAtSeconds,
  );
}

export function formatPeelOptions(
  options: IPeelOption[],
  labels: {
    friendly: (name: string) => string;
    enemy: (name: string) => string;
  },
): string[] {
  if (options.length === 0) return [];
  const lines = [PEEL_SECTION_HEADER];
  for (const p of options) {
    const from = p.usableSeconds[0]!;
    const to = p.usableSeconds[p.usableSeconds.length - 1]!;
    const owner = labels.friendly(p.ownerName);
    const victim = labels.friendly(p.victimName);
    const target = labels.enemy(p.attackerName);
    const whose = p.ownerIsVictim ? " (the victim's own CC)" : "";
    const trinket =
      p.attackerTrinketReady === null
        ? ""
        : p.attackerTrinketReady
          ? ` | ${target} PvP trinket ready`
          : ` | ${target} PvP trinket on cooldown`;
    lines.push(
      `${fmtTime(from)}–${fmtTime(to)}  [PEEL OPTION]  ${owner} ${p.spellName} → ${target}${whose}: usable ${p.usableSeconds.length} s, not used | ${p.distanceYards.toFixed(1)}yd, DR ${p.drLevel} | ${target} did ${Math.round(p.attackerShare * 100)}% of ${victim}'s damage taken in the 10 s before dying at ${fmtTime(p.deathAtSeconds)}${trinket}`,
    );
  }
  return lines;
}

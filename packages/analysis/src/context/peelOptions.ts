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
 *  - the attacker is within the owner's talent-applied reach on a single
 *    target (`ccThreatReachYards`: cast range, else a caster-centred radius;
 *    unknown reach → no line) with line of sight not
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
import { ccSamplerFor, pvpTrinketReadyAtSecond } from "../utils/ccTargetState";
import type { IPlayerCCTrinketSummary } from "../utils/ccTrinketAnalysis";
import { extractMajorCooldowns } from "../utils/cooldowns";
import { fmtTime } from "../utils/renderGrid";
import { isInstantCast } from "../utils/spellMechanics";

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
    // most damage on the victim in the window. The share's denominator is ALL
    // damage the victim took in the window — the rendered line says "% of
    // X's damage taken" — not just the damage we could map to an enemy player
    // (codex astra review, 2026-09-24: 60 of 100 mapped plus 100 unmapped
    // would otherwise read 60 %).
    const dmg = new Map<string, number>();
    let total = 0;
    for (const e of victim.damageIn ?? []) {
      const t = (e.timestamp - start) / 1000;
      if (t < tD - PEEL_LOOKBACK_S || t > tD) continue;
      const a = Math.abs(e.effectiveAmount ?? e.amount ?? 0);
      total += a;
      const src = enemyIds.has(e.srcUnitId)
        ? e.srcUnitId
        : enemyPetOwner.get(e.srcUnitId);
      if (!src || !enemyIds.has(src)) continue;
      dmg.set(src, (dmg.get(src) ?? 0) + a);
    }
    const top = [...dmg.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!top || total === 0) continue;
    const attacker = enemies.find((u) => u.id === top[0])!;
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
      for (const cd of cds) {
        if (
          cd.casts.some(
            (c) => c.timeSeconds >= tD - PEEL_LOOKBACK_S && c.timeSeconds <= tD,
          )
        )
          continue;
        // Reach, LoS, immunity, DR and the attacker's own breakers: the shared
        // evaluator (utils/ccTargetState.ts). Peel policy: any DR below Immune.
        const sampler = ccSamplerFor({
          combat,
          owner: o,
          cd,
          enemyIds,
          renderedCcOf: (name) =>
            enemyCC.find((x) => x.playerName === name)?.ccInstances ?? [],
        });
        if (!sampler) continue;
        const secs: number[] = [];
        let firstDist = 0;
        let firstDr = "n/a";
        for (let s = Math.ceil(tD - PEEL_LOOKBACK_S); s < tD; s++) {
          const st = sampler.stateAt(attacker, s);
          if (!st.ok) continue;
          if (secs.length === 0) {
            firstDist = st.distanceYards;
            firstDr = st.dr;
          }
          secs.push(s);
        }
        if (secs.length < PEEL_MIN_USABLE_S) continue;
        const from = secs[0]!;
        const trinketReady = pvpTrinketReadyAtSecond(trinket, from);
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

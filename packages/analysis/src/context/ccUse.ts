/**
 * CC USE — the log owner's control cooldowns over the round (GH #77 part 2).
 *
 * User rulings: 2026-09-19 (whole-match statistics may show actual casts and
 * reviewable windows; a theoretical-count difference is never waste or a
 * missed chance; without a specific evidenced opportunity, never advise "use
 * it more"); 2026-09-24 ("先留下来吧 … 我觉得是有一定价值的") after three
 * codex astra rounds narrowed it to:
 *  - counts for every CC major (SPELL_CAST_SUCCESS — completed casts);
 *  - DPS owners only: at most CC_USE_CAP review bookmarks, instant CCs only,
 *    each naming ONE target and the consequential moment that makes it worth a
 *    look, every condition holding on each counted second (no bridging):
 *      · offense — during the owner's own burst-ledger burst on a known,
 *        non-healer target, an enemy HEALER was CC-able;
 *      · defense — during a [DMG SPIKE] on a TEAMMATE, the enemy who did
 *        >= CC_USE_MIN_SHARE of all the damage that teammate took in it was
 *        CC-able;
 *  - healer owners: counts only (their slack predicate and the defense branch
 *    exclude each other, and "not CC'd" is not spare capacity).
 * "CC-able" = `ccSamplerFor(...).stateAt` (shared with PEEL OPTIONS) at Full DR
 * only — an unresolved DR category is not admitted. The two doors
 * (>= CC_USE_MIN_S passing seconds, >= CC_USE_MIN_SHARE) are editorial,
 * chosen to keep volume low — codex r3:
 * they are not to be tuned on outcome data. The removed "room" number
 * (extra casts that would have fit) is not coming back: it was not a lower
 * bound (codex r1 counterexamples).
 */
import type { AtomicArenaCombat, ICombatUnit } from "@gladlog/parser-compat";

import { ccSpellIds } from "../data/spellTags";
import type { IBurstLedgerEntry } from "../utils/burstLedger";
import { ccSamplerFor, pvpTrinketReadyAtSecond } from "../utils/ccTargetState";
import type { IPlayerCCTrinketSummary } from "../utils/ccTrinketAnalysis";
import {
  extractMajorCooldowns,
  type IDamageBucket,
  isHealerSpec,
  isMeleeSpec,
} from "../utils/cooldowns";
import { fmtTime } from "../utils/renderGrid";
import { ccMechanicOf, isInstantCast } from "../utils/spellMechanics";
import { DMG_SPIKE_THRESHOLD } from "./timelineHelpers";

/** A bookmark needs at least this many consecutive passing whole seconds. */
export const CC_USE_MIN_S = 5;
/** Defense bookmarks: the target did at least this share of ALL the damage
 * the teammate took in the [DMG SPIKE]. */
export const CC_USE_MIN_SHARE = 0.6;
/** At most this many bookmarks per round (the longest, shown in time order). */
export const CC_USE_CAP = 2;
/** DB2 SpellMechanic id "disarmed". */
export const DISARM_MECHANIC = 3;

export const CC_USE_SECTION_HEADER =
  "CC USE — your control cooldowns this round. `cast N×` counts completed casts. A [CC BOOKMARK] marks a moment worth a look, not a missed cast: on every second of its span the CC was ready and not cast, you were not CC'd or in a casting lockout, and the named enemy was in range, with no detected LoS obstruction, not CC'd, not immune, at Full DR, and with no known ready self-breaker of their own. The distance, DR and trinket state after `at m:ss` are as of the span's first second. Enemy dispels are not considered, and nothing here says whether casting was the better play — or whether you had a free global then: say \"you weren't CC'd\", never \"you were free\". Use a bookmark only to point the player at that moment, in your own words; never say they should have cast it, never count it as a mistake, and never judge the player as passive or aggressive from the counts.";

export interface ICcUseCount {
  spellId: string;
  spellName: string;
  casts: number;
  firstCastS: number | null;
}

export interface ICcUseBookmark {
  kind: "offense" | "defense";
  spellId: string;
  spellName: string;
  targetName: string;
  seconds: number[];
  distanceYards: number;
  dr: string;
  targetTrinketReady: boolean | null;
  burstIndex?: number;
  burstFromS?: number;
  burstToS?: number;
  burstTargetName?: string;
  pressuredName?: string;
  spikeFromS?: number;
  spikeToS?: number;
  share?: number;
}

export interface ICcUseSummary {
  counts: ICcUseCount[];
  bookmarks: ICcUseBookmark[];
}

/** Maximal runs of consecutive seconds, kept when at least CC_USE_MIN_S long. */
function runsOf(seconds: number[]): number[][] {
  const out: number[][] = [];
  for (const s of seconds) {
    const last = out[out.length - 1];
    if (last && s === last[last.length - 1]! + 1) last.push(s);
    else out.push([s]);
  }
  return out.filter((r) => r.length >= CC_USE_MIN_S);
}

export function ccUseSummary(params: {
  combat: AtomicArenaCombat;
  owner: ICombatUnit;
  friends: ICombatUnit[];
  enemies: ICombatUnit[];
  enemyCC: ReadonlyArray<IPlayerCCTrinketSummary>;
  /** The SAME array the <burst_ledger> block numbers (`Burst #i+1`). */
  burstLedger: ReadonlyArray<IBurstLedgerEntry>;
  /** The SAME array the [DMG SPIKE] lines render from. */
  pressureWindows: ReadonlyArray<IDamageBucket>;
}): ICcUseSummary {
  const { combat, owner, friends, enemies, enemyCC } = params;
  const start = combat.startTime;
  let cds: ReturnType<typeof extractMajorCooldowns> = [];
  try {
    // W1g (reliability round 2, user ruling 2026-09-25): every control
    // cooldown in the owner's kit — the roster's Control tag (disarms, grips,
    // traps, totems included) as well as the hard-CC set.
    cds = extractMajorCooldowns(owner, combat).filter(
      (cd) => cd.tag === "Control" || ccSpellIds.has(cd.spellId),
    );
  } catch {
    return { counts: [], bookmarks: [] };
  }
  const counts: ICcUseCount[] = cds.map((cd) => ({
    spellId: cd.spellId,
    spellName: cd.spellName,
    casts: cd.casts.length,
    firstCastS: cd.casts.length
      ? Math.min(...cd.casts.map((c) => c.timeSeconds))
      : null,
  }));
  if (isHealerSpec(owner.spec)) return { counts, bookmarks: [] };

  const enemyIds = new Set(enemies.map((u) => u.id));
  const petOwner = new Map<string, string>();
  for (const u of Object.values(combat.units))
    if (u.ownerId && enemyIds.has(u.ownerId)) petOwner.set(u.id, u.ownerId);
  const trinketReadyAt = (name: string, s: number) =>
    pvpTrinketReadyAtSecond(
      enemyCC.find((x) => x.playerName === name),
      s,
    );

  const all: ICcUseBookmark[] = [];
  for (const cd of cds) {
    if (!isInstantCast(cd.spellId)) continue;
    const sampler = ccSamplerFor({
      combat,
      owner,
      cd,
      enemyIds,
      renderedCcOf: (name) =>
        enemyCC.find((x) => x.playerName === name)?.ccInstances ?? [],
    });
    if (!sampler) continue;
    // User ruling 2026-09-25: a disarm is only worth a look against a melee
    // target (official mechanic 3 = disarmed).
    const isDisarm = ccMechanicOf(cd.spellId) === DISARM_MECHANIC;
    const scan = (target: ICombatUnit, fromS: number, toS: number) => {
      if (isDisarm && !isMeleeSpec(target.spec)) return [];
      const secs: number[] = [];
      const facts = new Map<number, { dist: number; dr: string }>();
      for (let s = Math.ceil(fromS); s <= Math.floor(toS); s++) {
        const st = sampler.stateAt(target, s);
        // Full DR only: "n/a" (no category) is unresolved, not "no DR".
        if (!st.ok || st.dr !== "Full") continue;
        secs.push(s);
        facts.set(s, { dist: st.distanceYards, dr: st.dr });
      }
      return runsOf(secs).map((run) => ({ run, first: facts.get(run[0]!)! }));
    };

    // Offense: the owner's own bursts on a known, non-healer target.
    params.burstLedger.forEach((b, i) => {
      const bt = b.dominantTarget
        ? enemies.find((u) => u.id === b.dominantTarget!.unitId)
        : undefined;
      if (!bt || isHealerSpec(bt.spec)) return;
      for (const h of enemies.filter((u) => isHealerSpec(u.spec))) {
        for (const { run, first } of scan(h, b.fromSeconds, b.toSeconds))
          all.push({
            kind: "offense",
            spellId: cd.spellId,
            spellName: cd.spellName,
            targetName: h.name,
            seconds: run,
            distanceYards: first.dist,
            dr: first.dr,
            targetTrinketReady: trinketReadyAt(h.name, run[0]!),
            burstIndex: i + 1,
            burstFromS: b.fromSeconds,
            burstToS: b.toSeconds,
            burstTargetName: bt.name,
          });
      }
    });

    // Defense: a [DMG SPIKE] on a teammate and its dominant attacker.
    for (const w of params.pressureWindows) {
      if (w.totalDamage < DMG_SPIKE_THRESHOLD) continue;
      const mate = friends.find((u) => u.name === w.targetName);
      if (!mate || mate.id === owner.id) continue;
      const dmg = new Map<string, number>();
      let total = 0;
      for (const e of mate.damageIn ?? []) {
        const t = (e.timestamp - start) / 1000;
        if (t < w.fromSeconds || t > w.toSeconds) continue;
        const a = Math.abs(e.effectiveAmount ?? e.amount ?? 0);
        total += a;
        const src = enemyIds.has(e.srcUnitId)
          ? e.srcUnitId
          : petOwner.get(e.srcUnitId);
        if (src) dmg.set(src, (dmg.get(src) ?? 0) + a);
      }
      const top = [...dmg.entries()].sort((x, y) => y[1] - x[1])[0];
      if (!top || total === 0 || top[1] / total < CC_USE_MIN_SHARE) continue;
      const attacker = enemies.find((u) => u.id === top[0]);
      if (!attacker) continue;
      for (const { run, first } of scan(attacker, w.fromSeconds, w.toSeconds))
        all.push({
          kind: "defense",
          spellId: cd.spellId,
          spellName: cd.spellName,
          targetName: attacker.name,
          seconds: run,
          distanceYards: first.dist,
          dr: first.dr,
          targetTrinketReady: trinketReadyAt(attacker.name, run[0]!),
          pressuredName: mate.name,
          spikeFromS: w.fromSeconds,
          spikeToS: w.toSeconds,
          share: top[1] / total,
        });
    }
  }
  const bookmarks = all
    .sort((x, y) => y.seconds.length - x.seconds.length)
    .slice(0, CC_USE_CAP)
    .sort((x, y) => x.seconds[0]! - y.seconds[0]!);
  return { counts, bookmarks };
}

export function formatCcUse(
  summary: ICcUseSummary,
  labels: { friendly: (n: string) => string; enemy: (n: string) => string },
): string[] {
  if (summary.counts.length === 0) return [];
  const countStr = summary.counts
    .map((c) =>
      c.casts === 0
        ? `${c.spellName} not cast`
        : `${c.spellName} cast ${c.casts}× (first ${fmtTime(c.firstCastS!)})`,
    )
    .join(" · ");
  const lines = [CC_USE_SECTION_HEADER, `  Counts: ${countStr}`];
  for (const b of summary.bookmarks) {
    const from = b.seconds[0]!;
    const to = b.seconds[b.seconds.length - 1]!;
    const target = labels.enemy(b.targetName);
    const why =
      b.kind === "offense"
        ? `during your Burst #${b.burstIndex} (${fmtTime(b.burstFromS!)}–${fmtTime(b.burstToS!)}) on ${labels.enemy(b.burstTargetName!)}, their healer was not CC'd`
        : `${target} did ${Math.round(b.share! * 100)}% of ${labels.friendly(b.pressuredName!)}'s damage taken in the [DMG SPIKE] ${fmtTime(b.spikeFromS!)}–${fmtTime(b.spikeToS!)}`;
    const trinket =
      b.targetTrinketReady === null
        ? ""
        : `, ${target} PvP trinket ${b.targetTrinketReady ? "ready" : "on cooldown"}`;
    lines.push(
      `${fmtTime(from)}–${fmtTime(to)}  [CC BOOKMARK]  ${b.spellName} → ${target}: ${why} | at ${fmtTime(from)}: ${b.distanceYards.toFixed(1)}yd, DR ${b.dr}${trinket}`,
    );
  }
  return lines;
}

/**
 * momentSnapshot.ts — moment-level deep-dive snapshot collector (SDD
 * 2026-08-05, "moment deep dive" Task 1).
 *
 * Turns an arbitrary [fromS, toS] window into `PackItem`-shaped snapshots
 * (cooldown ledger / auras / positions / DR state / healing gaps / activity
 * gaps / HP) that a later round ("ask about this moment", Task 2/4) consumes.
 *
 * Shared-predicate rule (CLAUDE.md "门规谓词即规范"): this file is a pure
 * collector. It must not hand-write a second HP / distance / LoS / cooldown /
 * DR judgement — every fact below is read off an existing exported
 * predicate. No sampling radius, distance threshold, or DR constant may
 * appear here as a numeric literal.
 */

import { CombatUnitReaction, LogEvent } from "@gladlog/parser-compat";

import {
  cdAvailableAt,
  extractMajorCooldowns,
  isHealerSpec,
  MAJOR_DEFENSIVE_IDS,
  selfCastNoopAnnotatedName,
  specToString,
  type IMajorCooldownInfo,
} from "../utils/cooldowns";
import { fmtTime } from "../utils/renderGrid";
import { analyzeOutgoingCCChains, DR_CATEGORY_MAP } from "../utils/drAnalysis";
import { detectHealingGaps, type IHealingGap } from "../utils/healingGaps";
import {
  getHpPercentAtTime,
  getLowestHpPercentInWindow,
} from "../utils/killWindowTargetSelection";
import { buildAuraIntervals } from "../utils/auraIntervals";
import {
  distanceBetween,
  getUnitPositionAtTime,
  getUnitRawPositionAtTime,
  hasLineOfSight,
} from "../utils/losAnalysis";
import { INTERP_MAX_GAP_MS, LOS_SWEEP_GAP_MS } from "../utils/positionSampling";
import type { PackItem } from "./deepDive";

/** Short name (realm stripped): same style as deepDive's `sn()`, copied here
 * per the brief (a one-line cosmetic name-shortener, not a judgement, so it
 * doesn't count as a second predicate). */
const sn = (name: string) => name.split("-")[0] ?? name;

/** Below this, a cast gap isn't worth flagging as an "activity gap". */
export const ACTIVITY_GAP_MIN_S = 4;

/** Item cap for a moment snapshot pack. NOT enforced in this file:
 * buildMomentSnapshotItems returns the full, untruncated candidate list —
 * quota/priority triage (cd-ledger/hp-snap/activity-gap capped per unit,
 * pos-snap <=5, the remainder by closeness to focusT) is buildDeepDivePack's
 * job (Task 2), which needs to see every candidate before deciding what to
 * drop. Exported here only so that consumer can reference the same number. */
export const MOMENT_PACK_MAX = 32;

type Role = "owner" | "teammate" | "enemy";

/** Role tag, same rule as deepDive.ts's friendlyRole: owner is the coached
 * player, teammate is friendly background, enemy is everyone else. */
function roleOf(u: any, ownerName?: string): Role {
  if (u.reaction !== CombatUnitReaction.Friendly) return "enemy";
  return ownerName && u.name === ownerName ? "owner" : "teammate";
}

/**
 * Priority tier for the slice(0,10) cap in `aurasActiveAt`: hard CC ranks
 * above majors/immunities, which ranks above everything else — both
 * classifiers are existing single-source tables, not a new whitelist:
 *  0. Hard CC — `spellId` is a key of `DR_CATEGORY_MAP` (drAnalysis.ts; the
 *     spellId→DR-category map generated from DB2 SpellCategories.DiminishType
 *     plus its documented hand supplement for known DB2 gaps — disarm,
 *     knockback, silences missing the flag, etc).
 *  1. Majors/immunities — `spellId` ∈ `MAJOR_DEFENSIVE_IDS` (cooldowns.ts).
 *     Checked: every `IMMUNITY_SPELLS` id (deathOutcomeAnalysis.ts — Divine
 *     Shield 642, Ice Block 45438, Dispersion 47585, Aspect of the Turtle
 *     186265, …) is already inside `externalOrBigDefensiveSpellIds`, so
 *     `MAJOR_DEFENSIVE_IDS` alone covers both without a second set.
 *  2. Everything else, original `buildAuraIntervals` order.
 *
 * Historical damage (BACKLOG #27): match 76ea5f90, owner frozen in Freezing
 * Trap (spellId 3355, a DR_CATEGORY_MAP stun entry) 2:48-2:53 — the trap aura
 * was pushed out of the raw top-10 by cosmetic buffs, and two deep-dive
 * rounds concluded "he could act" from the truncated aura list.
 */
function auraPriority(spellId: string): 0 | 1 | 2 {
  if (spellId in DR_CATEGORY_MAP) return 0;
  if (MAJOR_DEFENSIVE_IDS.has(spellId)) return 1;
  return 2;
}

/**
 * Auras active on `unit` at instant `t` (match-relative seconds) — a
 * point-in-time filter over the single-source interval builder, capped at 10
 * names so a long buff list can't blow out a facts field. Sorted by
 * `auraPriority` (stable — ties keep `buildAuraIntervals`' original order)
 * before the cap so a hard-CC or major/immunity aura is never displaced by
 * cosmetic buffs.
 */
export function aurasActiveAt(
  unit: any,
  combat: any,
  t: number,
  /** 可选:按 unitId 找光环的施法者,用于天赋加长的时长封顶(见 auraIntervals)。 */
  castersById?: ReadonlyMap<string, any>,
): string[] {
  return buildAuraIntervals(unit, combat, castersById)
    .filter((iv) => iv.fromS <= t && t <= iv.toS)
    .sort((a, b) => auraPriority(a.spellId) - auraPriority(b.spellId))
    .map((iv) => iv.spellName)
    .slice(0, 10);
}

/**
 * Largest gap between consecutive SPELL_CAST_SUCCESS casts inside
 * [fromS, toS] — the window bounds themselves count as endpoints (a unit
 * that never casts in-window has one gap spanning the whole window). Returns
 * null when even the largest gap doesn't clear ACTIVITY_GAP_MIN_S.
 */
export function largestCastGap(
  unit: any,
  fromS: number,
  toS: number,
  matchStartMs: number,
): { fromT: number; toT: number; gapS: number } | null {
  const events = (unit.spellCastEvents ?? []) as any[];
  const times = events
    .filter((e) => e.logLine?.event === LogEvent.SPELL_CAST_SUCCESS)
    .map((e) => (e.logLine.timestamp - matchStartMs) / 1000)
    .filter((s) => s >= fromS && s <= toS)
    .sort((a, b) => a - b);
  const points = [fromS, ...times, toS];

  let best: { fromT: number; toT: number; gapS: number } | null = null;
  for (let i = 0; i < points.length - 1; i++) {
    const gapS = points[i + 1] - points[i];
    if (!best || gapS > best.gapS) {
      best = { fromT: points[i], toT: points[i + 1], gapS };
    }
  }
  if (!best || best.gapS < ACTIVITY_GAP_MIN_S) return null;
  return best;
}

/**
 * Cast-flow lines across the window: every player's successful casts,
 * "M:SS Name(Spec) → SpellName", ascending by time, capped at 90 lines (the
 * last line becomes a "…(+N more)" marker when the true count exceeds that).
 */
export function buildCastFlowLines(
  combat: any,
  fromS: number,
  toS: number,
): string[] {
  const matchStartMs = combat?.startTime ?? 0;
  const units = Object.values(combat?.units ?? {}) as any[];
  const players = units.filter((u) => u.info);

  const rows: { relS: number; text: string }[] = [];
  for (const u of players) {
    const events = (u.spellCastEvents ?? []) as any[];
    for (const e of events) {
      if (e.logLine?.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      const relS = (e.logLine.timestamp - matchStartMs) / 1000;
      if (relS < fromS || relS > toS) continue;
      rows.push({
        relS,
        text: `${fmtTime(Math.floor(relS))} ${sn(u.name)}(${specToString(u.spec)}) → ${e.spellName ?? e.spellId}`,
      });
    }
  }
  rows.sort((a, b) => a.relS - b.relS);

  if (rows.length <= 90) return rows.map((r) => r.text);
  const kept = rows.slice(0, 89).map((r) => r.text);
  kept.push(`…(+${rows.length - 89} more)`);
  return kept;
}

/**
 * Builds the moment-snapshot evidence items for [fromS, toS] — one entry per
 * applicable (kind, unit) pair per the brief's item-construction table.
 * Every numeric fact is floored/rounded to an integer string before it's
 * written (facts carry no decimals); every timestamp fact is the
 * already-floored render-grid second (shared-predicate discipline: nothing
 * downstream needs to re-round).
 */
export function buildMomentSnapshotItems(
  combat: any,
  fromS: number,
  toS: number,
  ownerName?: string,
): Omit<PackItem, "key">[] {
  const matchStartMs = combat?.startTime ?? 0;
  const units = Object.values(combat?.units ?? {}) as any[];
  const players = units.filter((u) => u.info);
  const friends = players.filter(
    (u) => u.reaction === CombatUnitReaction.Friendly,
  );
  const enemies = players.filter(
    (u) => u.reaction !== CombatUnitReaction.Friendly,
  );
  const ownerUnit = ownerName
    ? friends.find((u) => u.name === ownerName)
    : undefined;

  const midT = Math.floor((fromS + toS) / 2);
  const midMs = matchStartMs + midT * 1000;
  const t0 = Math.floor(fromS);
  const t1 = Math.floor(toS);

  const raw: Omit<PackItem, "key">[] = [];

  // cd-ledger: every player, one item (ready/onCd default to "无" when empty).
  for (const u of players) {
    const cds: IMajorCooldownInfo[] = extractMajorCooldowns(u, combat);
    const ready: string[] = [];
    const onCd: string[] = [];
    for (const cd of cds) {
      // #25-1: damage-redirect externals carry the guard annotation — a bare
      // name in the victim's own "ready" reads as self-rescue advice.
      (cdAvailableAt(cd, midT) ? ready : onCd).push(
        selfCastNoopAnnotatedName(cd),
      );
    }
    raw.push({
      kind: "cd-ledger",
      t: midT,
      label: `${sn(u.name)} 冷却台账`,
      unitNames: [u.name],
      facts: {
        t: String(midT),
        unit: sn(u.name),
        role: roleOf(u, ownerName),
        ready: ready.length ? ready.join("、") : "无",
        onCd: onCd.length ? onCd.join("、") : "无",
      },
    });
  }

  // aura-snap: every player, skipped when nothing is up at the midpoint.
  // 传入全场名册:光环封顶要按**施法者**的天赋算(auraIntervals 里 11% 的上身
  // 等不到 REMOVED,全靠封顶收口)。
  const castersById = new Map(players.map((u: any) => [u.id, u]));
  for (const u of players) {
    const auras = aurasActiveAt(u, combat, midT, castersById);
    if (auras.length === 0) continue;
    raw.push({
      kind: "aura-snap",
      t: midT,
      label: `${sn(u.name)} 光环`,
      unitNames: [u.name],
      facts: {
        t: String(midT),
        unit: sn(u.name),
        role: roleOf(u, ownerName),
        auras: auras.join("、"),
      },
    });
  }

  // pos-snap: owner vs every other player, skipped when either side's
  // (interpolated) position can't be sampled.
  if (ownerUnit) {
    const ownerPos = getUnitPositionAtTime(ownerUnit, midMs, INTERP_MAX_GAP_MS);
    if (ownerPos) {
      const ownerRaw = getUnitRawPositionAtTime(
        ownerUnit,
        midMs,
        LOS_SWEEP_GAP_MS,
      );
      for (const u of players) {
        if (u === ownerUnit) continue;
        const pos = getUnitPositionAtTime(u, midMs, INTERP_MAX_GAP_MS);
        if (!pos) continue;
        const facts: Record<string, string> = {
          t: String(midT),
          unit: sn(u.name),
          role: roleOf(u, ownerName),
          dist: String(Math.round(distanceBetween(ownerPos, pos))),
        };
        if (ownerRaw) {
          const otherRaw = getUnitRawPositionAtTime(u, midMs, LOS_SWEEP_GAP_MS);
          if (otherRaw) {
            const los = hasLineOfSight(combat?.zoneId, ownerRaw, otherRaw);
            if (los !== null) facts.los = los ? "有" : "被挡";
          }
        }
        raw.push({
          kind: "pos-snap",
          t: midT,
          label: `与 ${sn(u.name)} 距离`,
          unitNames: [ownerUnit.name, u.name],
          facts,
        });
      }
    }
  }

  // dr-state: every friendly CC that landed on an enemy inside the window.
  try {
    const chains = analyzeOutgoingCCChains(friends, enemies, combat);
    for (const chain of chains) {
      for (const ap of chain.applications) {
        if (ap.atSeconds < fromS || ap.atSeconds > toS) continue;
        raw.push({
          kind: "dr-state",
          t: Math.floor(ap.atSeconds),
          label: `${ap.spellName} DR`,
          unitNames: [ap.casterName, chain.targetName],
          facts: {
            t: String(Math.floor(ap.atSeconds)),
            caster: sn(ap.casterName),
            target: sn(chain.targetName),
            spell: ap.spellName,
            drLevel: String(ap.drInfo?.level ?? ""),
            durationS: String(Math.round(ap.durationSeconds)),
          },
        });
      }
    }
  } catch {
    /* CC data absent */
  }

  // healing-gap: every friendly healer's gaps that intersect the window.
  const healerGapUnitIds = new Set<string>();
  for (const healer of friends.filter((u) => isHealerSpec(u.spec))) {
    try {
      const gaps: IHealingGap[] = detectHealingGaps(
        healer,
        friends,
        enemies,
        combat,
      );
      for (const gap of gaps) {
        if (gap.toSeconds < fromS || gap.fromSeconds > toS) continue;
        healerGapUnitIds.add(healer.id);
        raw.push({
          kind: "healing-gap",
          t: Math.floor(gap.fromSeconds),
          label: `${sn(healer.name)} 治疗空窗`,
          unitNames: [healer.name],
          facts: {
            unit: sn(healer.name),
            fromT: String(Math.floor(gap.fromSeconds)),
            toT: String(Math.floor(gap.toSeconds)),
            gapS: String(Math.round(gap.durationSeconds)),
            pressured: sn(gap.mostDamagedName),
          },
        });
      }
    } catch {
      /* healing gap data absent */
    }
  }

  // activity-gap: every player with a real cast gap, skipping a healer
  // already covered by a healing-gap item in this window (same signal twice).
  for (const u of players) {
    if (healerGapUnitIds.has(u.id)) continue;
    const gap = largestCastGap(u, fromS, toS, matchStartMs);
    if (!gap) continue;
    raw.push({
      kind: "activity-gap",
      t: Math.floor(gap.fromT),
      label: `${sn(u.name)} 施法空窗`,
      unitNames: [u.name],
      facts: {
        unit: sn(u.name),
        role: roleOf(u, ownerName),
        fromT: String(Math.floor(gap.fromT)),
        toT: String(Math.floor(gap.toT)),
        gapS: String(Math.round(gap.gapS)),
      },
    });
  }

  // hp-snap: every player, skipped when start/end/min are all unreachable.
  // Sampled at t0/t1 (the same floored render-grid seconds written into
  // facts below), not the raw fromS/toS — otherwise the label says "t0" but
  // the value was read at a different, un-floored instant (2026-07-20 class
  // of bug: query time must sit on the render grid the gate re-parses).
  for (const u of players) {
    const hpStart = getHpPercentAtTime(u, t0, matchStartMs);
    const hpEnd = getHpPercentAtTime(u, t1, matchStartMs);
    const hpMin = getLowestHpPercentInWindow(u, t0, t1, matchStartMs);
    if (hpStart === null && hpEnd === null && hpMin === null) continue;
    const facts: Record<string, string> = {
      t0: String(t0),
      t1: String(t1),
      unit: sn(u.name),
      role: roleOf(u, ownerName),
    };
    if (hpStart !== null) facts.hpStart = String(Math.round(hpStart));
    if (hpEnd !== null) facts.hpEnd = String(Math.round(hpEnd));
    if (hpMin !== null) facts.hpMin = String(Math.round(hpMin));
    raw.push({
      kind: "hp-snap",
      t: t0,
      label: `${sn(u.name)} HP`,
      unitNames: [u.name],
      facts,
    });
  }

  // No cap here: quota/priority triage (cd-ledger/hp-snap/activity-gap one
  // per unit, pos-snap <=5, the rest by closeness to focusT) happens in
  // buildDeepDivePack (Task 2), which needs the full candidate set before it
  // decides what to keep — truncating in time order here would pre-empt that
  // and could silently drop e.g. cd-ledger items before the real priority
  // pass ever sees them. MOMENT_PACK_MAX stays exported for that consumer.
  return raw.sort((a, b) => a.t - b.t);
}

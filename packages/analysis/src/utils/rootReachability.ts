/**
 * Root reachability (GH #24, user ruling 2026-08-30).
 *
 * A root has no DR tier in this product (2026-08-18 ruling stands) and does
 * not count as hard CC (a rooted player can still cast). Its value is
 * positional: it matters exactly when the rooted player's abilities cannot
 * reach their targets from where they stand —
 *   melee   : nearest living enemy beyond melee reach (`CLOSE_RANGE_YARDS`)
 *   healer  : an ally who is TAKING DAMAGE during the root is out of cast
 *             range or out of line of sight ("can only heal some of them")
 *   ranged  : no living enemy within cast range and in line of sight
 * counted per whole second on the render grid; an instance is "significant"
 * once `ROOT_UNREACHABLE_MIN_S` such seconds accumulate.
 *
 * Output form is CONTEXT FACTS ONLY (timeline `[ROOT]` inserts, no candidate,
 * no accusation) per the value-gate rule — the real-match example that
 * justified this shape is on GH #24 (Lordaeron 572: the same Mass
 * Entanglement at 0:12 affected nobody, at 1:26 it left the healer unable to
 * reach the melee being trained for 6 s).
 *
 * Predicates are all shared with the product (docs/predicate-index.md):
 * positions/distance/LoS from losAnalysis, `LOS_SWEEP_GAP_MS` and
 * `CC_MAX_CAST_RANGE_YARDS` from positionSampling, melee reach
 * `CLOSE_RANGE_YARDS` from positionAnalysis. The root universe is the
 * OFFICIAL DB2 DiminishType 1 class (`DR_CATEGORIES_GENERATED.root`, 139
 * ids) — not a hand list, so nothing to register in curatedIdRegistry.
 */
import type { ICombatUnit } from "@gladlog/parser-compat";
import { CombatUnitReaction } from "@gladlog/parser-compat";

import { DR_CATEGORIES_GENERATED } from "../data/drCategoriesGenerated";
import { getEnglishSpellName } from "../data/spellEffectData";
import { buildAuraIntervals } from "./auraIntervals";
import { isHealerSpec, isMeleeSpec } from "./cooldowns";
import {
  distanceBetween,
  getUnitPositionAtTime,
  hasLineOfSight,
  type IPosition,
} from "./losAnalysis";
import { CLOSE_RANGE_YARDS, isDeadAt } from "./positionAnalysis";
import { CC_MAX_CAST_RANGE_YARDS, LOS_SWEEP_GAP_MS } from "./positionSampling";

/** Official root class (DB2 DiminishType 1), string ids. */
export const ROOT_SPELL_IDS: ReadonlySet<string> = new Set(
  DR_CATEGORIES_GENERATED["root"] ?? [],
);

/**
 * Whole seconds of "cannot reach" before a root instance is worth a line.
 * User band 3–5 s (2026-08-30); 3 chosen from the 40-log distribution: the
 * 1–2 s mass (108 of 134 melee hits) is one-second-grid rounding on ~1–2 s
 * roots, ≥3 s is the first clean cut (melee 26/521, healer 7/184, ranged
 * 3/249 instances). On a whole-second grid "3" already means three full
 * seconds.
 */
export const ROOT_UNREACHABLE_MIN_S = 3;

/** Roots shorter than this are not evaluated (aura-refresh noise). */
export const ROOT_MIN_DURATION_S = 0.5;

export type RootedRole = "melee" | "healer" | "ranged";

export interface IRootInstance {
  atSeconds: number;
  durationSeconds: number;
  rootedId: string;
  rootedName: string;
  rootedIsFriendly: boolean;
  rootedRole: RootedRole;
  /** raw logged name of the caster unit (kept for consumers keyed on it) */
  sourceName: string;
  /** what the prompt prints for the caster — see `rootSourceLabel` */
  sourceLabel: string;
  spellId: string;
  spellName: string;
  /** whole seconds (render grid) in which the rooted player's targets were unreachable */
  unreachableSeconds: number;
  /** seconds with at least one position sample for the rooted player */
  sampledSeconds: number;
  /** healer only: the damaged ally who was unreachable longest, and for how long */
  worstAlly?: { name: string; seconds: number };
  /** `unreachableSeconds >= ROOT_UNREACHABLE_MIN_S` */
  significant: boolean;
}

function roleOf(unit: ICombatUnit): RootedRole {
  if (isHealerSpec(unit.spec)) return "healer";
  if (isMeleeSpec(unit.spec)) return "melee";
  return "ranged";
}

/**
 * Whether `target` was reachable from position `from` at instant `tMs` with a
 * tool of range `rangeYards` — THE per-second position predicate of the root
 * work, extracted (verbatim semantics) on 2026-09-02 so the burst-window
 * feasibility gate (GH #60 tail: "could the teammate actually deliver it")
 * consumes the same range + LoS decision instead of a copy.
 *
 * Returns `null` = UNKNOWN — the target was dead at `tMs`, or has no position
 * sample within `LOS_SWEEP_GAP_MS` of it. Callers must never turn unknown
 * into a claim: the [ROOT] sweep skips the second, the burst gate treats it
 * as reachable (missing data must not manufacture infeasibility).
 *
 * `checkLoS=false` is melee reach — the rooted-melee branch has no LoS test
 * (a melee swing at `CLOSE_RANGE_YARDS` is not blocked by pillar geometry at
 * that scale). With `checkLoS=true`, LoS **not disproven** counts as
 * reachable (`hasLineOfSight` returns null on an unknown map / no zoneId).
 */
export function canReachTargetAt(
  from: IPosition,
  target: ICombatUnit,
  tMs: number,
  zoneId: string | undefined,
  rangeYards: number,
  checkLoS: boolean,
): boolean | null {
  if (isDeadAt(target, tMs)) return null;
  const q = getUnitPositionAtTime(target, tMs, LOS_SWEEP_GAP_MS);
  if (!q) return null;
  const d = distanceBetween(from, q);
  if (d > rangeYards) return false;
  if (!checkLoS) return true;
  const los = zoneId ? hasLineOfSight(zoneId, from, q) : null;
  return los !== false; // LoS not disproven counts as reachable
}

/**
 * The `(from …)` label of a `[ROOT]` line. A player casts under their own
 * name; a totem / pet casts under a **client-locale** unit name (Earthgrab
 * Totem logs as "陷地图腾" on a zh client — 53 `[ROOT]` lines across 42 of
 * the 309 prompts in the 2026-09-15 Opus baseline), so a summon is labelled
 * through its owner instead: `<owner>'s pet`, or `[pet]` when no owner can
 * be resolved and the name is not ASCII. Same rule as `actorLabel` on the
 * `[CC]` lines (2026-07-17 fuzz, Intimidation ×72).
 */
export function rootSourceLabel(
  srcUnitName: string,
  players: ICombatUnit[],
  allUnits: ICombatUnit[],
): string {
  if (players.some((p) => p.name === srcUnitName)) return srcUnitName;
  const summon = allUnits.find(
    (u) => u.name === srcUnitName && u.ownerId.length > 0,
  );
  const owner = summon
    ? players.find((p) => p.id === summon.ownerId)
    : undefined;
  if (owner) return `${owner.name.split("-")[0]}'s pet`;
  const short = srcUnitName.split("-")[0];
  return [...short].some((c) => c.charCodeAt(0) > 127) ? "[pet]" : short;
}

export function computeRootReachability(
  combat: {
    startTime: number;
    endTime: number;
    startInfo?: { zoneId?: string };
  },
  players: ICombatUnit[],
  /** every unit of the match (summons included) — for `rootSourceLabel`;
   * defaults to `players`, which labels an unowned summon `[pet]`. */
  allUnits: ICombatUnit[] = players,
): IRootInstance[] {
  const zoneId = combat.startInfo?.zoneId;
  const out: IRootInstance[] = [];
  for (const X of players) {
    const allies = players.filter(
      (u) => u.reaction === X.reaction && u.id !== X.id,
    );
    const enemies = players.filter((u) => u.reaction !== X.reaction);
    const role = roleOf(X);
    const intervals = buildAuraIntervals(X, combat).filter((iv) =>
      ROOT_SPELL_IDS.has(iv.spellId),
    );
    for (const iv of intervals) {
      const dur = iv.toS - iv.fromS;
      if (dur < ROOT_MIN_DURATION_S) continue;
      const fromMs = combat.startTime + iv.fromS * 1000;
      const toMs = combat.startTime + iv.toS * 1000;
      // healer: only allies taking damage inside the root window need reaching
      const hitAllies =
        role === "healer"
          ? allies.filter((a) =>
              a.damageIn.some(
                (e) => e.timestamp >= fromMs && e.timestamp <= toMs,
              ),
            )
          : [];
      const allyBad = new Map<string, number>();
      let sampled = 0;
      let unreachable = 0;
      // Render grid: whole seconds [s, s+1) that overlap the root by at least
      // half a second, so the count can never exceed the rendered duration
      // (a 6.0 s root sweeps 6 seconds, not 7).
      for (let s = Math.floor(iv.fromS); s < iv.toS; s++) {
        if (Math.min(s + 1, iv.toS) - Math.max(s, iv.fromS) < 0.5) continue;
        const t = combat.startTime + s * 1000;
        const p = getUnitPositionAtTime(X, t, LOS_SWEEP_GAP_MS);
        if (!p) continue;
        sampled++;
        const inReach = (T: ICombatUnit): boolean | null =>
          role === "melee"
            ? canReachTargetAt(p, T, t, zoneId, CLOSE_RANGE_YARDS, false)
            : canReachTargetAt(p, T, t, zoneId, CC_MAX_CAST_RANGE_YARDS, true);
        if (role === "healer") {
          let bad = false;
          for (const a of hitAllies) {
            if (inReach(a) === false) {
              bad = true;
              allyBad.set(a.name, (allyBad.get(a.name) ?? 0) + 1);
            }
          }
          if (bad) unreachable++;
        } else {
          const results = enemies.map(inReach).filter((r) => r !== null);
          if (results.length > 0 && !results.some(Boolean)) unreachable++;
        }
      }
      const worst = [...allyBad.entries()].sort((a, b) => b[1] - a[1])[0];
      out.push({
        atSeconds: Math.floor(iv.fromS),
        durationSeconds: dur,
        rootedId: X.id,
        rootedName: X.name,
        rootedIsFriendly: X.reaction === CombatUnitReaction.Friendly,
        rootedRole: role,
        sourceName: iv.srcUnitName,
        sourceLabel: rootSourceLabel(iv.srcUnitName, players, allUnits),
        spellId: iv.spellId,
        spellName: getEnglishSpellName(iv.spellId, iv.spellName),
        unreachableSeconds: unreachable,
        sampledSeconds: sampled,
        worstAlly: worst ? { name: worst[0], seconds: worst[1] } : undefined,
        significant: unreachable >= ROOT_UNREACHABLE_MIN_S,
      });
    }
  }
  return out.sort((a, b) => a.atSeconds - b.atSeconds);
}

export const ROOT_ENTRY_TAG = "[ROOT]   ";

/** Timeline inserts — significant instances only, one line each. */
export function formatRootReachabilityEntries(
  instances: IRootInstance[],
  ownerId: string,
): Array<{ atSeconds: number; line: string }> {
  return instances
    .filter((r) => r.significant)
    .map((r) => {
      const who =
        r.rootedId === ownerId ? `[YOU] ${r.rootedName}` : r.rootedName;
      const side = r.rootedIsFriendly ? "friendly" : "enemy";
      const head = `${r.spellName} (from ${r.sourceLabel}) rooted ${side} ${who} (${r.rootedRole}) for ${r.durationSeconds.toFixed(1)}s`;
      let why: string;
      if (r.rootedRole === "melee")
        why = `nearest enemy beyond ${CLOSE_RANGE_YARDS}yd for ${r.unreachableSeconds}s — could not attack; this stretch worked like hard CC`;
      else if (r.rootedRole === "healer")
        why = `${r.worstAlly?.name ?? "a damaged ally"} (taking damage) out of range/LoS for ${r.worstAlly?.seconds ?? r.unreachableSeconds}s — could not be healed; this stretch worked like hard CC on the healer`;
      else
        why = `no enemy in range/LoS for ${r.unreachableSeconds}s — could not attack`;
      return {
        atSeconds: r.atSeconds,
        line: `${ROOT_ENTRY_TAG}${head} — ${why}`,
      };
    });
}

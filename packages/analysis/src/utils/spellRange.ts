/**
 * The range and reach a SPECIFIC caster gets out of a spell — official DB2
 * range / radius (`spellReachGenerated.json`) plus the passive range / radius
 * talents that caster actually holds. The one predicate for "could this
 * player reach that unit with that spell" (GH #83; user ruling 2026-09-23:
 * "戒律牧46码必须修 看天赋修 不管用不用 不能我们理解是错的 其他射程距离的也修").
 *
 * Why caster-aware: Phantom Reach 459559 is +15 % range on every priest heal
 * and 98 % of Discipline / 93 % of Holy priests hold it, so their heals and
 * externals reach 46 yd, not 40 — successful Discipline casts on a teammate
 * land out to p99 47.0 yd (`packages/eval/scripts/healReachGroundTruth.ts`,
 * 420 archive files). Astral Influence gives druids 45; Evoker heals and
 * dispels are officially 25 / 30 yd.
 *
 * Game order: flat modifiers first, then percentages —
 * `(base + Σflat) × (1 + Σpct / 100)`. A talent counts only when
 * `talentModifierOwnershipOf` says "yes": an unreadable loadout gets the base
 * number, never a longer one (the same "unknown never lengthens" rule as
 * `talentRankOf`).
 *
 * The distances callers compare against are model centres; the game measures
 * to the hitbox, so casts land ~2 yd past these numbers — callers that
 * ACCUSE on "out of range" should allow for it (`RANGE_HITBOX_SLACK_YD`).
 */
import type { ICombatUnit } from "@gladlog/parser-compat";

import raw from "../data/spellReachGenerated.json";
import { talentModifierOwnershipOf } from "./talentOwnership";

interface RangeMod {
  talent: string;
  flat?: number;
  pct?: number;
}
interface ReachEntry {
  rangeYards: number;
  radiusYards: number;
  reachYards: number;
  rangeMods?: RangeMod[];
  radiusMods?: RangeMod[];
}

const SPELLS = (
  raw as unknown as { spells: Record<string, ReachEntry | undefined> }
).spells;

/** Successful friendly casts land this far past the nominal range as a
 * matter of course — the log's positions are model centres, the game
 * measures to the hitbox: 40 yd specs cast out to p99 41.6–42.2 yd on 57,444
 * successful casts (`healReachGroundTruth.ts`, 2026-09-23). */
export const RANGE_HITBOX_SLACK_YD = 2;

type Caster = Pick<ICombatUnit, "spec" | "info" | "spellCastEvents">;

const held = new WeakMap<object, Map<string, boolean>>();
function holds(caster: Caster, talent: string): boolean {
  let m = held.get(caster);
  if (!m) {
    m = new Map();
    held.set(caster, m);
  }
  let v = m.get(talent);
  if (v === undefined) {
    v = talentModifierOwnershipOf(caster, talent) === "yes";
    m.set(talent, v);
  }
  return v;
}

function modified(
  base: number,
  mods: RangeMod[] | undefined,
  caster: Caster | null | undefined,
): number {
  if (!caster || !mods || base <= 0) return base;
  let flat = 0;
  let pct = 0;
  for (const m of mods) {
    if (!holds(caster, m.talent)) continue;
    flat += m.flat ?? 0;
    pct += m.pct ?? 0;
  }
  return (base + flat) * (1 + pct / 100);
}

/** Cast range of `spellId` for this caster, yards; null when the table has no
 * positive range for it (unknown → callers degrade, never assume). */
export function spellRangeForCaster(
  caster: Caster | null | undefined,
  spellId: string,
): number | null {
  const e = SPELLS[spellId];
  if (!e || !(e.rangeYards > 0)) return null;
  return modified(e.rangeYards, e.rangeMods, caster);
}

/**
 * Each healer spec's core single-target heals — "can this healer heal that
 * teammate" is the longest of their talent-applied ranges. Official ranges:
 * every listed heal is 40 yd except Preservation (Echo / Reversion 30,
 * Living Flame / Verdant Embrace 25). Every id observed in the corpus
 * (2026-09-23); registered in `data/curatedIdRegistry.ts`.
 */
export const HEALER_REACH_SPELLS: Readonly<Record<string, readonly string[]>> =
  {
    "256": ["2061", "17"], // Discipline: Flash Heal, Power Word: Shield
    "257": ["2061", "17"], // Holy Priest
    "105": ["8936", "774"], // Restoration Druid: Regrowth, Rejuvenation
    "264": ["8004", "61295"], // Restoration Shaman: Healing Surge, Riptide
    "65": ["19750", "20473"], // Holy Paladin: Flash of Light, Holy Shock
    "270": ["116670", "115151"], // Mistweaver: Vivify, Renewing Mist
    // Preservation: Echo, Reversion, Living Flame, Verdant Embrace
    "1468": ["364343", "366155", "361469", "360995"],
  };

/** How far this healer can land a heal, yards — the longest of their spec's
 * core heals with the range talents they hold (Phantom Reach: 46; Astral
 * Influence: 45; Preservation: 30). `fallback` when the spec is not a healer
 * spec listed here. */
export function healerReachYards(
  healer: Caster | null | undefined,
  fallback: number,
): number {
  const ids = healer ? HEALER_REACH_SPELLS[String(healer.spec)] : undefined;
  let best: number | null = null;
  for (const id of ids ?? []) {
    const r = spellRangeForCaster(healer, id);
    if (r !== null && (best === null || r > best)) best = r;
  }
  return best ?? fallback;
}

/** How far from the caster the spell can take effect: range for a targeted
 * spell, range + radius for a placed area, radius for a caster-centred one —
 * the `reachYards` semantics of the generated table, with the caster's range
 * and radius talents applied. null when the table knows neither. */
export function spellReachForCaster(
  caster: Caster | null | undefined,
  spellId: string,
): number | null {
  const e = SPELLS[spellId];
  if (!e) return null;
  const range = modified(e.rangeYards, e.rangeMods, caster);
  const radius = modified(e.radiusYards, e.radiusMods, caster);
  const reach = radius > 0 ? (range > 0 ? range + radius : radius) : range;
  return reach > 0 ? reach : null;
}

/**
 * Per-spell reach for ally-castable defensives, from official data (GH #34
 * batch 4 ②, 2026-08-29): DB2 SpellMisc.RangeIndex → SpellRange.RangeMax for
 * the cast range, SpellEffect.EffectRadiusIndex → SpellRadius.RadiusMax
 * (max over the spell's effects) for area effects. `reachYards` is what
 * deathOutcomeAnalysis compares a teammate's distance against:
 *   targeted spell (radius 0)          → range            (Pain Suppression 40)
 *   placed area (range > 0, radius > 0) → range + radius  (Anti-Magic Zone 30 + 8)
 *   caster-centred aura (range 0)      → radius           (Rallying Cry 40)
 * Two auras carry their radius on a LINKED spell, resolved via
 * LINKED_REACH_SPELL: Aura Mastery 31821 → Devotion Aura 465 (radius 40).
 * Darkness 196718 has no radius in these tables at all (the 8 yd zone lives
 * on the area-trigger object); it stays on the hand fallback in
 * deathOutcomeAnalysis with that provenance. Id universe = the
 * externalDefensiveSpellIds list (the same list deathOutcomeAnalysis walks),
 * so the table cannot be incomplete relative to its consumer.
 *
 * Verified at 12.1.0.69382: 9 targeted externals are 40 yd, Time Dilation
 * 357170 and Anti-Magic Zone 51052 are 30 yd, Rallying Cry radius 40,
 * Zephyr 374227 radius 20 — the hand assumption "all are 40-yard targeted
 * spells" was false for 6 of 15.
 *
 * GH #83 (user ruling 2026-09-23: "戒律牧46码必须修 看天赋修 … 其他射程距离的
 * 也修"): the universe now also takes every spell observed in the corpus
 * (`observedSpellIdsGenerated.json`), and each entry carries the PASSIVE
 * talents that change its range (SpellModOp 5) or radius (op 6), read off the
 * M6 talent inventory — both the class-mask and the SpellLabel encodings,
 * value × PvpMultiplier. Discipline reaches 46 yd because Phantom Reach
 * 459559 is +15 % range on every priest heal; the game agrees (successful
 * Discipline casts on a teammate: p99 47.0 yd, `healReachGroundTruth.ts`).
 * Whether a given caster holds the talent is decided at runtime
 * (`utils/spellRange.ts`). Buff-gated modifiers (activation ≠ passive, e.g.
 * Spatial Paradox +100 %) are not attached; their count is printed.
 *
 * ORDER: reads `talentEffectInventoryGenerated.json`, so run it after
 * genTalentModifiers.ts (docs/commands/update-wow-data.md).
 */
import observedSpellIds from "../../src/data/observedSpellIdsGenerated.json";
import spellIdLists from "../../src/data/spellIdLists";
import inventory from "../../src/data/talentEffectInventoryGenerated.json";
import { INTERRUPT_SPELL_IDS } from "../../src/utils/enemyInterrupts";
import { PLACEHOLDER_RANGE_YD } from "../../src/utils/spellRange";
import { writeArtifact } from "./lib/emit";
import {
  AURA_ADD_FLAT_MODIFIER,
  AURA_ADD_FLAT_MODIFIER_BY_LABEL,
  AURA_ADD_PCT_MODIFIER,
  AURA_ADD_PCT_MODIFIER_BY_LABEL,
  SPELLMOD_RADIUS,
  SPELLMOD_RANGE,
} from "./lib/talentInventory";
import {
  assertColumns,
  fetchTable,
  parseCsv,
  resolveBuild,
} from "./lib/wagoCsv";

const LINKED_REACH_SPELL: Record<string, string> = {
  "31821": "465", // Aura Mastery → Devotion Aura's 40 yd radius
};

/** SpellEffect.Effect 6 = APPLY_AURA. */
const APPLY_AURA = "6";
/** Aura types whose radius does not extend the spell's initial reach: 2
 * MOD_POSSESS — Mind Control 605 carries 100 yd on its single-target
 * possession row (reliability round 3, 1bad: range + that = 130 yd). Only
 * evidenced types are listed; other ambiguous radii (chain jumps, delayed
 * areas, BIND_SIGHT) stay as they were (codex astra). */
const NON_REACH_RADIUS_AURA_TYPES = new Set(["2"]);

/**
 * The cast among `parents` (the ids whose EffectTriggerSpell points at a
 * spell) whose reach the triggered id inherits. Tiers, best first: a real
 * cast range beats DB2's placeholder (100 / 50000, `PLACEHOLDER_RANGE_YD`);
 * then a parent the corpus has seen cast (`observed`) beats one it never
 * has — Solar Beam 97547 is triggered by the player's 78675 (45 yd) and by
 * an NPC-side 311930 (50 yd), and "farthest" alone picked the NPC (codex
 * astra, GH #120); within a tier the farthest reach wins. `observed` is any
 * corpus event carrying the id (auras, damage, pets included), so this tier
 * is a heuristic for player-cast provenance, not proof of it. With
 * `realOnly` the placeholder parents are no evidence at all. null when
 * nothing qualifies.
 */
export function farthestTriggeringCast(
  parents: readonly string[],
  rangeBySpell: ReadonlyMap<string, number>,
  radiusBySpell: ReadonlyMap<string, number>,
  observed: ReadonlySet<string>,
  realOnly = false,
): { id: string; range: number; radius: number } | null {
  let best: { id: string; range: number; radius: number } | null = null;
  let bestRank: readonly number[] = [];
  const reachOf = (range: number, radius: number) =>
    radius > 0 ? (range > 0 ? range + radius : radius) : range;
  const beats = (a: readonly number[], b: readonly number[]) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
    return false;
  };
  for (const pid of parents) {
    const range = rangeBySpell.get(pid) ?? 0;
    const placeholder = range >= PLACEHOLDER_RANGE_YD;
    if (realOnly && placeholder) continue;
    const radius = radiusBySpell.get(pid) ?? 0;
    const reach = reachOf(range, radius);
    if (reach <= 0) continue;
    const rank = [placeholder ? 0 : 1, observed.has(pid) ? 1 : 0, reach];
    if (!best || beats(rank, bestRank)) {
      best = { id: pid, range, radius };
      bestRank = rank;
    }
  }
  return best;
}

/**
 * Per spell: the largest radius among its effect rows (a row of a
 * NON_REACH_RADIUS_AURA_TYPES aura contributes none, other rows of the same
 * spell keep theirs), and which casts trigger it (EffectTriggerSpell — GH
 * #83: aura ids the log records for a CC, Fear 118699 / Storm Bolt 132169,
 * carry no range of their own; the cast that triggers them does).
 */
export function effectRadiiAndParents(
  rows: ReadonlyArray<Record<string, unknown>>,
  radiusCols: readonly string[],
  radiusById: ReadonlyMap<string, number>,
  triggerCol: string | undefined,
): {
  radiusBySpell: Map<string, number>;
  parentsOf: Map<string, string[]>;
} {
  const radiusBySpell = new Map<string, number>();
  const parentsOf = new Map<string, string[]>();
  for (const r of rows) {
    const id = String(r.SpellID);
    const nonReach =
      String(r.Effect) === APPLY_AURA &&
      NON_REACH_RADIUS_AURA_TYPES.has(String(r.EffectAura));
    if (!nonReach)
      for (const c of radiusCols) {
        const rad = radiusById.get(String(r[c])) ?? 0;
        if (rad > (radiusBySpell.get(id) ?? 0)) radiusBySpell.set(id, rad);
      }
    const trig = triggerCol ? String(r[triggerCol] ?? "0") : "0";
    if (trig !== "0" && trig !== "" && trig !== id) {
      const list = parentsOf.get(trig) ?? [];
      if (!list.includes(id)) list.push(id);
      parentsOf.set(trig, list);
    }
  }
  return { radiusBySpell, parentsOf };
}

/** One passive range / radius modifier as the table stores it. `specIds`
 * marks a spec passive (DB2 SpecializationSpells, e.g. the Preservation aura
 * 356810): every player of those specs owns it — it sits in no talent tree,
 * so the runtime must not ask the loadout reader (`utils/spellRange.ts`
 * `holds`). Same contract as `ICDModifier.specIds` (GH #106). */
export type ReachMod = {
  talent: string;
  flat?: number;
  pct?: number;
  specIds?: string[];
};

export type ReachInventory = {
  rows: {
    spellId: string;
    aura: number;
    misc0: number;
    basePoints: number;
    pvpMultiplier: number;
    activation: string;
    targets: { spellId: string }[];
  }[];
  edges: {
    talentSpellId: string;
    spellId: string;
    hop: number;
    path: string;
    specIds?: number[];
  }[];
};

/**
 * Passive range (SpellModOp 5) / radius (op 6) modifiers by TARGET spell,
 * read off the talent inventory — class-mask and SpellLabel encodings alike,
 * value × PvpMultiplier. Buff-gated rows (activation ≠ passive) are skipped
 * and counted.
 *
 * `talent` is the id the RUNTIME can own (`talentModifierOwnershipOf` reads
 * the spec's talent trees and PvP pool) — GH #120, found by the range ground
 * truth: a spec passive (357715dd put SpecializationSpells rows in the
 * inventory) sits in no tree, so the loadout reader said "no" to everyone and
 * the row was dead on arrival; it carries the owning `specIds` instead. A
 * SpellMod on a spell that only a trigger reaches (Sniper's Advantage: PvP
 * talent 1217102 → 1217104, +30 % range, up only during Trueshot / Volley) is
 * an aura's, not a passive, and is skipped — see `triggerApplied` below.
 */
export function passiveReachMods(inventory: ReachInventory): {
  rangeMods: Map<string, ReachMod[]>;
  radiusMods: Map<string, ReachMod[]>;
  buffGated: number;
  triggerApplied: number;
} {
  // effect-row spell → how the runtime owns it: a talent / spec passive at
  // hop 0 is owned directly (spec passives by `specIds`); a spell only
  // reached through a trigger hop is APPLIED by that trigger — an aura, not
  // a passive — and is skipped below
  const ownerOf = new Map<string, { talent: string; specIds?: string[] }>();
  for (const e of inventory.edges)
    if (e.hop === 0)
      ownerOf.set(e.spellId, {
        talent: e.talentSpellId,
        ...(e.path === "spec" && e.specIds
          ? { specIds: e.specIds.map(String) }
          : {}),
      });
  const triggered = new Set<string>();
  for (const e of inventory.edges)
    if (e.hop > 0 && !ownerOf.has(e.spellId)) triggered.add(e.spellId);
  const rangeMods = new Map<string, ReachMod[]>();
  const radiusMods = new Map<string, ReachMod[]>();
  let buffGated = 0;
  let triggerApplied = 0;
  for (const r of inventory.rows) {
    const flat =
      r.aura === AURA_ADD_FLAT_MODIFIER ||
      r.aura === AURA_ADD_FLAT_MODIFIER_BY_LABEL;
    const pct =
      r.aura === AURA_ADD_PCT_MODIFIER ||
      r.aura === AURA_ADD_PCT_MODIFIER_BY_LABEL;
    if (!flat && !pct) continue;
    const table =
      r.misc0 === SPELLMOD_RANGE
        ? rangeMods
        : r.misc0 === SPELLMOD_RADIUS
          ? radiusMods
          : null;
    if (!table || r.basePoints === 0) continue;
    if (r.activation !== "passive") {
      buffGated++;
      continue;
    }
    // A SpellMod on a spell that only a trigger reaches is granted by an
    // AURA the trigger applies, whatever DB2's duration row says: Sniper's
    // Advantage (PvP talent 1217102 → 1217104, +30 % range) is up only
    // during Trueshot / Volley — the log shows it applied and removed —
    // yet its duration reads indefinite and the inventory calls it passive.
    // Keying it on the talent made a holder's Aimed Shot 52 yd for the whole
    // match (codex astra caught the 605-file sample's one such line landing
    // while the buff was down). Buff-gated modifiers are not modelled here.
    if (triggered.has(r.spellId)) {
      triggerApplied++;
      continue;
    }
    const value = r.basePoints * (r.pvpMultiplier || 1);
    // a row no edge reaches (not in the inventory's talent universe) keeps
    // its own id — the runtime will say "no", which is the pre-#120 state
    const owner = ownerOf.get(r.spellId) ?? { talent: r.spellId };
    const mod: ReachMod = {
      talent: owner.talent,
      ...(flat ? { flat: value } : { pct: value }),
      ...(owner.specIds ? { specIds: owner.specIds } : {}),
    };
    for (const t of r.targets) {
      const list = table.get(t.spellId) ?? [];
      // the same talent reaching a spell through both encodings counts once
      if (
        !list.some(
          (m) =>
            m.talent === mod.talent && m.flat === mod.flat && m.pct === mod.pct,
        )
      )
        list.push(mod);
      table.set(t.spellId, list);
    }
  }
  return { rangeMods, radiusMods, buffGated, triggerApplied };
}

async function main() {
  const build = await resolveBuild(process.argv[2]);
  const cacheDir = process.env.DATAGEN_CACHE ?? undefined;
  const misc = parseCsv(await fetchTable("SpellMisc", build, cacheDir));
  const range = parseCsv(await fetchTable("SpellRange", build, cacheDir));
  const eff = parseCsv(await fetchTable("SpellEffect", build, cacheDir));
  const rad = parseCsv(await fetchTable("SpellRadius", build, cacheDir));
  assertColumns(misc.header, ["SpellID", "RangeIndex"], "SpellMisc");
  assertColumns(range.header, ["ID"], "SpellRange");
  assertColumns(eff.header, ["SpellID", "Effect", "EffectAura"], "SpellEffect");
  assertColumns(rad.header, ["ID", "RadiusMax"], "SpellRadius");
  const rangeMaxCol = range.header.find((h) => /^RangeMax[_[]0/.test(h));
  const radiusCols = eff.header.filter((h) => /^EffectRadiusIndex[_[]/.test(h));
  if (!rangeMaxCol || radiusCols.length === 0)
    throw new Error(
      "SpellRange.RangeMax_0 / SpellEffect.EffectRadiusIndex_* not found",
    );

  const rangeById = new Map(
    range.rows.map((r) => [String(r.ID), Number(r[rangeMaxCol]) || 0]),
  );
  const radiusById = new Map(
    rad.rows.map((r) => [String(r.ID), Number(r.RadiusMax) || 0]),
  );
  const rangeBySpell = new Map<string, number>();
  for (const r of misc.rows)
    if (r.SpellID)
      rangeBySpell.set(
        String(r.SpellID),
        rangeById.get(String(r.RangeIndex)) ?? 0,
      );
  const { radiusBySpell, parentsOf } = effectRadiiAndParents(
    eff.rows,
    radiusCols,
    radiusById,
    eff.header.find((h) => /^EffectTriggerSpell$/.test(h)),
  );

  // Universe = the ally-castable externals deathOutcomeAnalysis walks ∪ every
  // interrupt the kit table can assign (GH #78 / #88, 2026-09-12: kick range
  // is the feasibility gate of the kick-priority decision point, and it has
  // to come from SpellRange, not from memory — Skull Bash is 13 yd, Quell 25,
  // Wind Shear 30, the melee kicks share the 5 yd combat range).
  const curated = [
    ...(spellIdLists as { externalDefensiveSpellIds: string[] })
      .externalDefensiveSpellIds,
    ...INTERRUPT_SPELL_IDS,
  ];
  const ids = [
    ...new Set([...curated, ...(observedSpellIds as number[]).map(String)]),
  ];

  // Passive range / radius SpellMods by target spell (GH #83).
  const { rangeMods, radiusMods, buffGated, triggerApplied } = passiveReachMods(
    inventory as ReachInventory,
  );
  const observedSet = new Set((observedSpellIds as number[]).map(String));

  const out: Record<
    string,
    {
      rangeYards: number;
      radiusYards: number;
      reachYards: number;
      source?: string;
      rangeMods?: ReachMod[];
      radiusMods?: ReachMod[];
    }
  > = {};
  const curatedSet = new Set(curated);
  let triggeredFromParent = 0;
  let placeholderFromParent = 0;
  for (const id of ids) {
    let rangeYards = rangeBySpell.get(id) ?? 0;
    let radiusYards = radiusBySpell.get(id) ?? 0;
    let source: string | undefined;
    let modsFrom = id;
    if (radiusYards === 0 && LINKED_REACH_SPELL[id]) {
      radiusYards = radiusBySpell.get(LINKED_REACH_SPELL[id]!) ?? 0;
      source = `radius from linked spell ${LINKED_REACH_SPELL[id]}`;
    }
    // no reach of its own → the farthest-reaching cast that triggers it (one
    // EffectTriggerSpell hop, like genSpellTargeting). GH #120: a PLACEHOLDER
    // range (DB2's 100 yd vision row / 50000 "anywhere") on a triggered id is
    // not a cast range either — Throw Glaive 393035 (100) is thrown by 337819
    // (30), Charge 126664 (50000) by 100 (25), Skull Bash 93985 (100) by
    // 106839 (13); the ground truth puts every one of them inside the parent's
    // range. A placeholder with no triggering cast stays as it is (Tricks of
    // the Trade 57934 really is 100 yd; pet commands are cast from anywhere).
    const placeholder = rangeYards >= PLACEHOLDER_RANGE_YD;
    if ((rangeYards === 0 && radiusYards === 0) || placeholder) {
      // a placeholder of its own is only replaced by a REAL parent range;
      // a spell with no reach at all takes what it can get, as before
      const best = farthestTriggeringCast(
        parentsOf.get(id) ?? [],
        rangeBySpell,
        radiusBySpell,
        observedSet,
        placeholder,
      );
      if (best) {
        rangeYards = best.range;
        radiusYards = best.radius;
        modsFrom = best.id;
        source = `triggered by ${best.id}`;
        if (placeholder) placeholderFromParent++;
        else triggeredFromParent++;
      }
    }
    // an observed id with neither a range nor a radius carries no reach
    // fact; curated ones are kept so their consumers can see the 0
    if (rangeYards === 0 && radiusYards === 0 && !curatedSet.has(id)) continue;
    const reachYards =
      radiusYards > 0
        ? rangeYards > 0
          ? rangeYards + radiusYards
          : radiusYards
        : rangeYards;
    out[id] = {
      rangeYards,
      radiusYards,
      reachYards,
      ...(source ? { source } : {}),
      ...(rangeMods.has(modsFrom) && rangeYards > 0
        ? { rangeMods: rangeMods.get(modsFrom) }
        : {}),
      ...(radiusMods.has(modsFrom) && radiusYards > 0
        ? { radiusMods: radiusMods.get(modsFrom) }
        : {}),
    };
  }
  const outPath = new URL(
    "../../src/data/spellReachGenerated.json",
    import.meta.url,
  ).pathname;
  // One spell per line: ~4k entries, and a review diff should still read
  // spell by spell.
  const body = Object.entries(out)
    .map(([id, v]) => `    ${JSON.stringify(id)}: ${JSON.stringify(v)}`)
    .join(",\n");
  writeArtifact(
    outPath,
    `{\n  "generatedAt": ${JSON.stringify(new Date().toISOString())},\n  "build": ${JSON.stringify(build)},\n  "spells": {\n${body}\n  }\n}\n`,
  );
  const zero = curated.filter((id) => out[id]!.reachYards === 0);
  const withRangeMods = Object.values(out).filter((v) => v.rangeMods).length;
  const withRadiusMods = Object.values(out).filter((v) => v.radiusMods).length;
  console.log(
    `spellReachGenerated.json: ${Object.keys(out).length} spells (${curated.length} curated, ${ids.length} candidates); ` +
      `${withRangeMods} with range talents, ${withRadiusMods} with radius talents; ${buffGated} buff-gated modifier rows skipped, ${triggerApplied} trigger-applied rows skipped; ` +
      `${triggeredFromParent + placeholderFromParent} take their reach from the cast that triggers them (${placeholderFromParent} of them off a placeholder range); ` +
      `curated reach 0: ${zero.join(",")}`,
  );
}

if (process.argv[1]?.endsWith("genSpellReach.ts"))
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });

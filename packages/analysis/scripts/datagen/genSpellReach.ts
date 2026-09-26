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
  type Mod = { talent: string; flat?: number; pct?: number };
  const rangeMods = new Map<string, Mod[]>();
  const radiusMods = new Map<string, Mod[]>();
  let buffGated = 0;
  for (const r of (
    inventory as {
      rows: {
        spellId: string;
        aura: number;
        misc0: number;
        basePoints: number;
        pvpMultiplier: number;
        activation: string;
        targets: { spellId: string }[];
      }[];
    }
  ).rows) {
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
    const value = r.basePoints * (r.pvpMultiplier || 1);
    const mod: Mod = flat
      ? { talent: r.spellId, flat: value }
      : { talent: r.spellId, pct: value };
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

  const out: Record<
    string,
    {
      rangeYards: number;
      radiusYards: number;
      reachYards: number;
      source?: string;
      rangeMods?: Mod[];
      radiusMods?: Mod[];
    }
  > = {};
  const curatedSet = new Set(curated);
  let triggeredFromParent = 0;
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
    // EffectTriggerSpell hop, like genSpellTargeting)
    if (rangeYards === 0 && radiusYards === 0) {
      let best: { id: string; range: number; radius: number } | null = null;
      for (const pid of parentsOf.get(id) ?? []) {
        const range = rangeBySpell.get(pid) ?? 0;
        const radius = radiusBySpell.get(pid) ?? 0;
        const reach =
          radius > 0 ? (range > 0 ? range + radius : radius) : range;
        const bestReach = best
          ? best.radius > 0
            ? best.range > 0
              ? best.range + best.radius
              : best.radius
            : best.range
          : -1;
        if (reach > 0 && reach > bestReach) best = { id: pid, range, radius };
      }
      if (best) {
        rangeYards = best.range;
        radiusYards = best.radius;
        modsFrom = best.id;
        source = `triggered by ${best.id}`;
        triggeredFromParent++;
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
      `${withRangeMods} with range talents, ${withRadiusMods} with radius talents; ${buffGated} buff-gated modifier rows skipped; ` +
      `${triggeredFromParent} take their reach from the cast that triggers them; ` +
      `curated reach 0: ${zero.join(",")}`,
  );
}

if (process.argv[1]?.endsWith("genSpellReach.ts"))
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });

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
 */
import spellIdLists from "../../src/data/spellIdLists";
import { INTERRUPT_SPELL_IDS } from "../../src/utils/enemyInterrupts";
import { writeArtifact } from "./lib/emit";
import {
  assertColumns,
  fetchTable,
  parseCsv,
  resolveBuild,
} from "./lib/wagoCsv";

const LINKED_REACH_SPELL: Record<string, string> = {
  "31821": "465", // Aura Mastery → Devotion Aura's 40 yd radius
};

async function main() {
  const build = await resolveBuild(process.argv[2]);
  const cacheDir = process.env.DATAGEN_CACHE ?? undefined;
  const misc = parseCsv(await fetchTable("SpellMisc", build, cacheDir));
  const range = parseCsv(await fetchTable("SpellRange", build, cacheDir));
  const eff = parseCsv(await fetchTable("SpellEffect", build, cacheDir));
  const rad = parseCsv(await fetchTable("SpellRadius", build, cacheDir));
  assertColumns(misc.header, ["SpellID", "RangeIndex"], "SpellMisc");
  assertColumns(range.header, ["ID"], "SpellRange");
  assertColumns(eff.header, ["SpellID"], "SpellEffect");
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
  const radiusBySpell = new Map<string, number>();
  for (const r of eff.rows) {
    const id = String(r.SpellID);
    for (const c of radiusCols) {
      const rad = radiusById.get(String(r[c])) ?? 0;
      if (rad > (radiusBySpell.get(id) ?? 0)) radiusBySpell.set(id, rad);
    }
  }

  // Universe = the ally-castable externals deathOutcomeAnalysis walks ∪ every
  // interrupt the kit table can assign (GH #78 / #88, 2026-09-12: kick range
  // is the feasibility gate of the kick-priority decision point, and it has
  // to come from SpellRange, not from memory — Skull Bash is 13 yd, Quell 25,
  // Wind Shear 30, the melee kicks share the 5 yd combat range).
  const ids = [
    ...(spellIdLists as { externalDefensiveSpellIds: string[] })
      .externalDefensiveSpellIds,
    ...INTERRUPT_SPELL_IDS.filter(
      (id) =>
        !(spellIdLists as { externalDefensiveSpellIds: string[] })
          .externalDefensiveSpellIds.includes(id),
    ),
  ];
  const out: Record<
    string,
    {
      rangeYards: number;
      radiusYards: number;
      reachYards: number;
      source: string;
    }
  > = {};
  for (const id of ids) {
    const rangeYards = rangeBySpell.get(id) ?? 0;
    let radiusYards = radiusBySpell.get(id) ?? 0;
    let source = "SpellMisc/SpellRange + SpellEffect/SpellRadius";
    if (radiusYards === 0 && LINKED_REACH_SPELL[id]) {
      radiusYards = radiusBySpell.get(LINKED_REACH_SPELL[id]!) ?? 0;
      source = `radius from linked spell ${LINKED_REACH_SPELL[id]}`;
    }
    const reachYards =
      radiusYards > 0
        ? rangeYards > 0
          ? rangeYards + radiusYards
          : radiusYards
        : rangeYards;
    out[id] = { rangeYards, radiusYards, reachYards, source };
  }
  const outPath = new URL(
    "../../src/data/spellReachGenerated.json",
    import.meta.url,
  ).pathname;
  writeArtifact(
    outPath,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), build, spells: out },
      null,
      2,
    ) + "\n",
  );
  const zero = ids.filter((id) => out[id]!.reachYards === 0);
  console.log(
    `spellReachGenerated.json: ${ids.length} ids, reach 0 for ${zero.length}: ${zero.join(",")}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

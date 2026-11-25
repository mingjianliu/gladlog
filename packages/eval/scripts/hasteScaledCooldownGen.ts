/**
 * CLI: emit `hasteScaledCooldownsGenerated.json` — the spells whose cooldown a
 * spec's passive scales by haste (DB2 aura 416, "cooldown scaled by haste"),
 * per spec (pipeline T111, user ruling R47 2026-11-15).
 *
 * Pipeline T267: and the spells whose CHARGES a spec's passive recovers by
 * haste (DB2 aura 457, misc0 = the charge category). Discipline's Penance
 * (category 1230): 9 s modelled, the longest recharge a priest's presses fit
 * has a median of 7.0 s and follows 9 × (Smite cast time / 1.5) (82 priests,
 * 605 + 12.1.5 files). The row's basePoints say nothing here: the corpus
 * shows short recasts under rows carrying 0 (Penance, Prayer of Mending,
 * Throw Glaive, Verdant Embrace, Keg Smash) as under rows carrying 100
 * (Judgment, Raging Blow, Blade of Justice).
 *
 * Read off `talentEffectInventoryGenerated.json` only — legs (a)+(b) of the
 * Game-Behaviour Rule: the DB2 SpellEffect row (aura 416, basePoints > 0: a 0
 * rate scales nothing — 137041 / 356810 carry 0) and the targets its class
 * mask or SpellLabel resolves to, restricted to the specs the row's source
 * reaches through the inventory's `spec` edges (a spec passive). No hand
 * list: re-run after every inventory refresh (update-wow-data §7b).
 *
 * Usage: tsx packages/eval/scripts/hasteScaledCooldownGen.ts [--check]
 *   --check exits 1 when the committed table differs from the inventory.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DATA = path.join(import.meta.dirname, "../../analysis/src/data");
const OUT = path.join(DATA, "hasteScaledCooldownsGenerated.json");
/** SPELL_AURA_MOD_COOLDOWN_BY_HASTE */
const AURA_COOLDOWN_BY_HASTE = 416;
/** SPELL_AURA_MOD_CHARGE_RECOVERY_BY_HASTE: misc0 is the DB2 charge
 * category, whatever the row's basePoints (pipeline T267) */
const AURA_CHARGE_RECOVERY_BY_HASTE = 457;

interface IInventory {
  _meta: { build: string };
  rows: Array<{
    rowId: string;
    spellId: string;
    aura: number;
    misc0: number;
    basePoints: number;
    targets: Array<{ spellId: string; via: string }>;
  }>;
  edges: Array<{
    talentSpellId: string;
    spellId: string;
    path: string;
    specIds?: number[];
  }>;
}

const inv = JSON.parse(
  readFileSync(path.join(DATA, "talentEffectInventoryGenerated.json"), "utf8"),
) as IInventory;

const specsOf = new Map<string, Set<number>>();
for (const e of inv.edges) {
  if (e.path !== "spec" || !e.specIds) continue;
  const s = specsOf.get(e.spellId) ?? new Set<number>();
  for (const id of e.specIds) s.add(id);
  specsOf.set(e.spellId, s);
}

// A charge category's spells, as the inventory resolved them for the rows
// that change its charges or recharge (`via: "chargeCategory"`). The
// inventory resolves no targets for aura 457 itself, and this script reads
// nothing else, so a category no other row reaches stays unresolved and is
// listed in `meta.unresolvedChargeCategories`.
const categorySpells = new Map<number, Set<string>>();
for (const r of inv.rows)
  for (const t of r.targets) {
    if (t.via !== "chargeCategory") continue;
    const s = categorySpells.get(r.misc0) ?? new Set<string>();
    s.add(t.spellId);
    categorySpells.set(r.misc0, s);
  }

const bySpec = new Map<number, Set<string>>();
const rows: string[] = [];
const unresolved = new Set<string>();
for (const r of inv.rows) {
  let targets: string[];
  if (r.aura === AURA_COOLDOWN_BY_HASTE) {
    if (r.basePoints <= 0) continue;
    targets = r.targets.map((t) => t.spellId);
  } else if (r.aura === AURA_CHARGE_RECOVERY_BY_HASTE) {
    targets = [...(categorySpells.get(r.misc0) ?? [])];
    if (targets.length === 0 && specsOf.has(r.spellId))
      unresolved.add(`${r.misc0}(${r.spellId})`);
  } else continue;
  if (targets.length === 0) continue;
  const specs = specsOf.get(r.spellId);
  if (!specs) continue;
  rows.push(`${r.rowId}(${r.spellId})`);
  for (const spec of specs) {
    const set = bySpec.get(spec) ?? new Set<string>();
    for (const t of targets) set.add(t);
    bySpec.set(spec, set);
  }
}

const table = {
  meta: {
    producer: "packages/eval/scripts/hasteScaledCooldownGen.ts",
    build: inv._meta.build,
    rule: "talentEffectInventory rows with aura 416 and basePoints > 0 (targets by class mask / SpellLabel), and rows with aura 457 (the spells of the charge category in misc0, as other rows of the inventory resolve it), keyed by the specs of the row's spec-passive source",
    rows: rows.sort(),
    unresolvedChargeCategories: [...unresolved].sort(),
  },
  bySpec: Object.fromEntries(
    [...bySpec]
      .sort((a, b) => a[0] - b[0])
      .map(([spec, ids]) => [
        String(spec),
        [...ids].sort((a, b) => Number(a) - Number(b)),
      ]),
  ),
};
const text = `${JSON.stringify(table, null, 2)}\n`;

if (process.argv.includes("--check")) {
  // compared as data: the committed file is prettier-formatted
  const committed = JSON.stringify(JSON.parse(readFileSync(OUT, "utf8")));
  if (committed !== JSON.stringify(table)) {
    console.error(
      "hasteScaledCooldownsGenerated.json is stale: re-run without --check",
    );
    process.exit(1);
  }
  console.log("hasteScaledCooldownsGenerated.json matches the inventory");
} else {
  writeFileSync(OUT, text);
  console.log(
    `wrote ${OUT}: ${bySpec.size} specs, ${rows.length} rows, ${new Set([...bySpec.values()].flatMap((s) => [...s])).size} spells`,
  );
}

/**
 * CLI: emit `hasteScaledCooldownsGenerated.json` — the spells whose cooldown a
 * spec's passive scales by haste (DB2 aura 416, "cooldown scaled by haste"),
 * per spec (pipeline T111, user ruling R47 2026-11-15).
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

interface IInventory {
  _meta: { build: string };
  rows: Array<{
    rowId: string;
    spellId: string;
    aura: number;
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

const bySpec = new Map<number, Set<string>>();
const rows: string[] = [];
for (const r of inv.rows) {
  if (r.aura !== AURA_COOLDOWN_BY_HASTE || r.basePoints <= 0) continue;
  if (r.targets.length === 0) continue;
  const specs = specsOf.get(r.spellId);
  if (!specs) continue;
  rows.push(`${r.rowId}(${r.spellId})`);
  for (const spec of specs) {
    const set = bySpec.get(spec) ?? new Set<string>();
    for (const t of r.targets) set.add(t.spellId);
    bySpec.set(spec, set);
  }
}

const table = {
  meta: {
    producer: "packages/eval/scripts/hasteScaledCooldownGen.ts",
    build: inv._meta.build,
    rule: "talentEffectInventory rows with aura 416 and basePoints > 0, targets by class mask / SpellLabel, keyed by the specs of the row's spec-passive source",
    rows: rows.sort(),
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

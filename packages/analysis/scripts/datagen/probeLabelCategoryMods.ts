/**
 * probeLabelCategoryMods.ts — GH #96 M6 finding (2026-09-14): talent SpellMods
 * encoded by SpellLabel (aura 218 pct / 219 flat) or by SpellCategory cooldown
 * (aura 341) are invisible to genTalentModifiers, which only reads aura 107/108
 * (class mask) and 411/453/454 (charge category). Found through the scripted
 * talent queue: Angel's Mercy (Desperate Prayer −20 s, aura 341 category 671),
 * Quick Witted (Counterspell −5 s, aura 341 category 88), Frequent Donor (Dark
 * Pact −15 s, aura 219 op 11), Time Twist (Alter Time −10 s, aura 219 op 11).
 *
 * Read-only probe: resolves every such talent effect row to its target spells
 * (SpellLabel.LabelID → SpellID; SpellCategories.Category / ChargeCategory →
 * SpellID) and reports which targets the product tracks (classMetadata
 * abilities), split by SpellModOp. No generated file is written.
 *
 * Usage: npx tsx packages/analysis/scripts/datagen/probeLabelCategoryMods.ts
 * Output: stdout + $GLADLOG_EVAL_HOME/reports/talent-integration-2026-09-13/labelCategoryMods.json
 */
import { mkdirSync, writeFileSync } from "fs";
import os from "os";
import path from "path";

import { classMetadata } from "../../src/data/classSpells";
import inventory from "../../src/data/talentEffectInventoryGenerated.json";
import { fetchTable, parseCsv } from "./lib/wagoCsv";

const BUILD = "12.1.0.69587";
const cacheDir = path.join(os.homedir(), ".cache/gladlog-datagen");

const [labelCsv, catCsv, nameCsv] = await Promise.all([
  fetchTable("SpellLabel", BUILD, cacheDir),
  fetchTable("SpellCategories", BUILD, cacheDir),
  fetchTable("SpellName", BUILD, cacheDir),
]);
const labels = parseCsv(labelCsv).rows;
const cats = parseCsv(catCsv).rows;
const names = new Map(
  parseCsv(nameCsv).rows.map((r) => [r.ID!, r.Name_lang ?? ""]),
);

const byLabel = new Map<string, Set<string>>();
for (const r of labels) {
  const s = byLabel.get(r.LabelID!) ?? new Set<string>();
  s.add(r.SpellID!);
  byLabel.set(r.LabelID!, s);
}
const byCategory = new Map<string, Set<string>>();
for (const r of cats) {
  if (r.DifficultyID && r.DifficultyID !== "0") continue;
  for (const col of ["Category", "ChargeCategory"]) {
    const c = r[col];
    if (!c || c === "0") continue;
    const s = byCategory.get(c) ?? new Set<string>();
    s.add(r.SpellID!);
    byCategory.set(c, s);
  }
}

const tracked = new Map<string, string>();
for (const c of classMetadata as any[])
  for (const a of c.abilities ?? [])
    tracked.set(String(a.spellId), `${(a.tags ?? []).join("/") || "untagged"}`);

type Row = {
  rowId: string;
  spellId: string;
  aura: number;
  misc0: number;
  basePoints: number;
  activation: string;
};
type Edge = { talentSpellId: string; spellId: string; hop: number };
const inv = inventory as unknown as { rows: Row[]; edges: Edge[] };
const talentsOf = new Map<string, Set<string>>();
for (const e of inv.edges) {
  const s = talentsOf.get(e.spellId) ?? new Set<string>();
  s.add(e.talentSpellId);
  talentsOf.set(e.spellId, s);
}

const out: Array<Record<string, unknown>> = [];
const summary: Record<string, { rows: number; trackedTargets: number }> = {};
for (const r of inv.rows) {
  if (![218, 219, 341].includes(r.aura)) continue;
  // aura 218/219: misc0 = SpellModOp, misc1 = label (not in the inventory row)
  // → the inventory keeps misc0 only, so label rows are resolved below by
  // re-reading SpellEffect for misc1.
  out.push({ ...r });
}

// SpellEffect again for EffectMiscValue_1 (the label id)
const effCsv = await fetchTable("SpellEffect", BUILD, cacheDir);
const effRows = parseCsv(effCsv).rows;
const effById = new Map(effRows.map((e) => [e.ID!, e]));

const results = out.map((r: any) => {
  const eff = effById.get(r.rowId);
  const misc1 = eff?.EffectMiscValue_1 ?? "0";
  let targets: string[] = [];
  let op: string;
  if (r.aura === 341) {
    op = "cooldown(category)";
    targets = [...(byCategory.get(String(r.misc0)) ?? [])];
  } else {
    op = `op${r.misc0}`;
    targets = [...(byLabel.get(misc1) ?? [])];
  }
  const trackedTargets = targets.filter((t) => tracked.has(t));
  const key = `aura${r.aura}:${op}`;
  const s = (summary[key] ??= { rows: 0, trackedTargets: 0 });
  s.rows++;
  s.trackedTargets += trackedTargets.length ? 1 : 0;
  return {
    talentSpells: [...(talentsOf.get(r.spellId) ?? [])],
    effectSpell: r.spellId,
    effectSpellName: names.get(r.spellId),
    aura: r.aura,
    op,
    label: r.aura === 341 ? null : misc1,
    category: r.aura === 341 ? r.misc0 : null,
    basePoints: r.basePoints,
    activation: r.activation,
    trackedTargets: trackedTargets.map(
      (t) => `${names.get(t)} ${t} [${tracked.get(t)}]`,
    ),
    targetCount: targets.length,
  };
});

const home =
  process.env.GLADLOG_EVAL_HOME ??
  path.join(os.homedir(), "code/gladlog-eval-private");
const dir = path.join(home, "reports/talent-integration-2026-09-13");
mkdirSync(dir, { recursive: true });
writeFileSync(
  path.join(dir, "labelCategoryMods.json"),
  JSON.stringify(results, null, 1),
);
console.log(JSON.stringify(summary, null, 1));
for (const r of results.filter(
  (x) =>
    (x.trackedTargets as string[]).length &&
    (x.op === "op11" || x.op === "cooldown(category)"),
))
  console.log(
    `${r.effectSpellName} ${r.effectSpell} (${r.activation}) ${r.op} ${r.basePoints} → ${(r.trackedTargets as string[]).join("; ")}`,
  );

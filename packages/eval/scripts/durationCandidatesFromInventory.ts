/**
 * durationCandidatesFromInventory.ts — build a `durationTalentScan --candidates`
 * file from the M6 talent inventory (GH #65 / #96, 2026-09-22).
 *
 * Why: `talentEffectInventoryGenerated.json` (GH #96 M6) resolves every DB2
 * SpellMod row to its targets by CLASS MASK (aura 107 flat / 108 pct) AND by
 * SPELL LABEL (aura 219 flat / 218 pct → SpellLabel), but the talent catalog's
 * `modsRaw` — the list the 09-13 gap audit and M5 durationTalentScan read —
 * only carries the mask half. Result, measured 2026-09-22: 54 label-based
 * DURATION modifiers (47 with resolved targets) had never been offered to the
 * duration hand table, and 7 of the 09-07 "no talent explains" corpus patches
 * were exactly such modifiers (Earthliving 6 + 3 Imbuement Mastery, Thing from
 * Beyond 20 × 1.2 Subservient Shadows, Executioner 12 + 6 Deadly Focus, …).
 * The user's question that found it: "did you read the talent text?".
 *
 * Rule: every inventory row with misc0 = SpellModOp 1 (duration) and aura in
 * {107, 108, 218, 219} with ≥ 1 resolved target becomes a (talent → target)
 * pair; 219 is reported as scan aura "107" (flat ms), 218 as "108" (pct);
 * value = basePoints × pvpMultiplier (the PvP number is the official one, user
 * ruling 2026-09-04). Pairs whose (target, talent) is already registered in
 * BUFF_DURATION_TALENT_MODIFIERS or CC_DURATION_TALENT_MODIFIERS are dropped.
 * Corpus split + promotion rule stay in durationTalentScan (predeclared).
 *
 * Usage:
 *   npx tsx packages/eval/scripts/durationCandidatesFromInventory.ts <out.json>
 *   npx tsx packages/eval/scripts/durationTalentScan.ts --manifest … --candidates <out.json> --tag inventory-<date>
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const DATA = resolve("packages/analysis/src/data");
const out = process.argv[2];
if (!out) {
  console.error("usage: durationCandidatesFromInventory.ts <out.json>");
  process.exit(1);
}

interface InvRow {
  spellId: string;
  aura: number;
  misc0: number;
  basePoints: number;
  pvpMultiplier?: number;
  effectIndex?: number;
  targets?: Array<{ spellId: string; via: string }>;
}
const inv = JSON.parse(
  readFileSync(`${DATA}/talentEffectInventoryGenerated.json`, "utf8"),
) as { rows: InvRow[] };
const names = JSON.parse(
  readFileSync(`${DATA}/spellNames.json`, "utf8"),
) as Record<string, string | { en?: string }>;
const nm = (id: string): string => {
  const v = names[id];
  return typeof v === "string" ? v : (v?.en ?? "");
};

// (target aura, talent) pairs already priced by either duration hand table.
const src = readFileSync(`${DATA}/spellEffectData.ts`, "utf8");
const registered = new Set<string>();
for (const block of src.matchAll(/^\s*"(\d+)": \[([\s\S]*?)^\s*\],/gm)) {
  for (const t of block[2]!.matchAll(/talentSpellId: "(\d+)"/g))
    registered.add(`${block[1]}|${t[1]}`);
}

const stats = { mask: 0, label: 0, droppedRegistered: 0, noTarget: 0 };
const seen = new Set<string>();
const candidates: Array<Record<string, unknown>> = [];
for (const r of inv.rows) {
  if (r.misc0 !== 1 || ![107, 108, 218, 219].includes(r.aura)) continue;
  if (!r.targets?.length) {
    stats.noTarget++;
    continue;
  }
  const kind = r.aura === 218 || r.aura === 219 ? "label" : "mask";
  const scanAura = r.aura === 107 || r.aura === 219 ? "107" : "108";
  const value = r.basePoints * (r.pvpMultiplier ?? 1);
  for (const tg of r.targets) {
    const target = String(tg.spellId);
    const talent = String(r.spellId);
    if (registered.has(`${target}|${talent}`)) {
      stats.droppedRegistered++;
      continue;
    }
    const key = `${talent}|${target}|${scanAura}|${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    stats[kind]++;
    candidates.push({
      talent,
      talentZh: nm(talent),
      target,
      targetZh: nm(target),
      aura: scanAura,
      value,
      via: kind,
      dbAura: r.aura,
      effectIndex: r.effectIndex,
    });
  }
}
writeFileSync(
  out,
  JSON.stringify(
    {
      source: `talentEffectInventoryGenerated.json op 1 rows, mask + label (${new Date().toISOString().slice(0, 10)})`,
      stats,
      candidates,
    },
    null,
    1,
  ),
);
console.log(
  `${JSON.stringify(stats)} candidates ${candidates.length} distinct targets ${new Set(candidates.map((c) => c.target)).size} → ${out}`,
);

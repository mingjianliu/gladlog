/**
 * probeSpellCooldown.ts — print every official DB2 cooldown fact for the given
 * spell ids: SpellCooldowns (RecoveryTime / CategoryRecoveryTime), the
 * SpellCategories row and its SpellCategory entry (charges, charge recovery),
 * and every talent / PvP-talent effect row whose target resolution reaches the
 * spell through SpellCategory (aura 341) or a spell label (aura 218 / 219).
 * GH #96 BACKLOG #45 (2026-09-15): The Hunt is 90 s in the hand override,
 * 75 s after Eternal Hunt, and holders recast it in ~60 s.
 *
 * Usage: npx tsx packages/analysis/scripts/datagen/probeSpellCooldown.ts 370965 [more ids]
 */
import os from "os";
import path from "path";

import { fetchTable, parseCsv } from "./lib/wagoCsv";

const BUILD = "12.1.0.69587";
const cacheDir = path.join(os.homedir(), ".cache/gladlog-datagen");
const ids = new Set(process.argv.slice(2));

const [cdCsv, catsCsv, catCsv, labelCsv, effCsv] = await Promise.all([
  fetchTable("SpellCooldowns", BUILD, cacheDir),
  fetchTable("SpellCategories", BUILD, cacheDir),
  fetchTable("SpellCategory", BUILD, cacheDir),
  fetchTable("SpellLabel", BUILD, cacheDir),
  fetchTable("SpellEffect", BUILD, cacheDir),
]);
const cds = parseCsv(cdCsv).rows;
const cats = parseCsv(catsCsv).rows;
const cat = parseCsv(catCsv).rows;
const labels = parseCsv(labelCsv).rows;
const effs = parseCsv(effCsv).rows;

for (const id of ids) {
  console.log(`\n=== ${id}`);
  for (const r of cds.filter((x) => x.SpellID === id))
    console.log("SpellCooldowns", r);
  const myCats = cats.filter((x) => x.SpellID === id);
  for (const r of myCats) console.log("SpellCategories", r);
  const catIds = new Set(
    myCats
      .flatMap((r) => [r.Category, r.ChargeCategory])
      .filter((c) => c && c !== "0"),
  );
  for (const r of cat.filter((x) => catIds.has(x.ID!)))
    console.log("SpellCategory", r);
  const myLabels = new Set(
    labels.filter((x) => x.SpellID === id).map((x) => x.LabelID),
  );
  console.log("labels", [...myLabels].join(","));
  for (const e of effs) {
    const aura = e.EffectAura;
    const byCat = aura === "341" && catIds.has(e.EffectMiscValue_0!);
    const byLabel =
      (aura === "218" || aura === "219") && myLabels.has(e.EffectMiscValue_1!);
    const byChargeCat =
      (aura === "411" ||
        aura === "453" ||
        aura === "454" ||
        e.Effect === "121" ||
        e.Effect === "148") &&
      catIds.has(e.EffectMiscValue_0!);
    if (byCat || byLabel || byChargeCat)
      console.log(
        `effect row ${e.ID} spell ${e.SpellID} effect ${e.Effect} aura ${aura} op/misc0 ${e.EffectMiscValue_0} misc1 ${e.EffectMiscValue_1} points ${e.EffectBasePointsF}`,
      );
  }
}

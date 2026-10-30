/**
 * Override variants (official data): a spell X that an aura swaps onto the
 * button of spell Y — DB2 SpellEffect.EffectAura 332
 * (OVERRIDE_ACTIONBAR_SPELLS: EffectMiscValue_0 = Y, EffectBasePointsF = X)
 * — when X and Y draw on ONE cooldown: the same non-zero
 * SpellCategories.Category with a category cooldown on both
 * (SpellCooldowns.CategoryRecoveryTime > 0), or the same ChargeCategory whose
 * SpellCategory row carries charges. Same button, same cooldown ⇒ a press of
 * X is a press of Y. Restricted to the observed universe (both ids logged).
 * Left out: a pair whose granting aura carries Y's own name — the spell's
 * own effect swaps the button to its second stage or its cancel (Time Stop
 * 383332 under 378441's 383340, Spatial Rift 257040's teleport): that press
 * ends a use, it does not start one.
 *
 * F20 D23 (fact6, 2026-10-28): Predator's Wake 1259431 is the The Hunt
 * 1246167 button under Demonsurge 1245496 (aura 332, Category 2427, both
 * 90 s) — the talent-replace tables (TraitDefinition / PvpTalent
 * OverridesSpellID, talentModifiers' talent-spell aura-332 rows) never see a
 * form/hidden-aura override, so 1263fff6's two Predator's Wake presses were
 * missing from [ENEMY CD] and the [OFFENSIVE WINDOW] CDs: list.
 */
import fs from "fs-extra";

import { writeArtifact } from "./lib/emit";
import {
  assertColumns,
  fetchTable,
  parseCsv,
  resolveBuild,
} from "./lib/wagoCsv";

async function main() {
  const build = await resolveBuild(process.argv[2]);
  const cacheDir = process.env.DATAGEN_CACHE ?? undefined;
  const observed = new Set(
    (
      JSON.parse(
        fs.readFileSync(
          new URL(
            "../../src/data/observedSpellIdsGenerated.json",
            import.meta.url,
          ).pathname,
          "utf8",
        ),
      ) as number[]
    ).map(String),
  );
  const eff = parseCsv(await fetchTable("SpellEffect", build, cacheDir));
  assertColumns(
    eff.header,
    ["SpellID", "EffectAura", "EffectMiscValue_0", "EffectBasePointsF"],
    "SpellEffect",
  );
  const cats = parseCsv(await fetchTable("SpellCategories", build, cacheDir));
  assertColumns(
    cats.header,
    ["SpellID", "DifficultyID", "Category", "ChargeCategory"],
    "SpellCategories",
  );
  const cds = parseCsv(await fetchTable("SpellCooldowns", build, cacheDir));
  assertColumns(
    cds.header,
    ["SpellID", "DifficultyID", "CategoryRecoveryTime"],
    "SpellCooldowns",
  );
  const nameRows = parseCsv(await fetchTable("SpellName", build, cacheDir));
  assertColumns(nameRows.header, ["ID", "Name_lang"], "SpellName");
  const nameOf = new Map(nameRows.rows.map((r) => [r.ID!, r.Name_lang ?? ""]));
  const cat = parseCsv(await fetchTable("SpellCategory", build, cacheDir));
  assertColumns(
    cat.header,
    ["ID", "MaxCharges", "ChargeRecoveryTime"],
    "SpellCategory",
  );
  const charged = new Set(
    cat.rows
      .filter(
        (r) =>
          Number(r.MaxCharges ?? 0) >= 1 &&
          Number(r.ChargeRecoveryTime ?? 0) > 0,
      )
      .map((r) => r.ID!),
  );
  const catOf = new Map<string, { c: string; ch: string }>();
  for (const r of cats.rows)
    if (r.DifficultyID === "0" && r.SpellID && !catOf.has(r.SpellID))
      catOf.set(r.SpellID, {
        c: r.Category ?? "0",
        ch: r.ChargeCategory ?? "0",
      });
  const catCd = new Map<string, number>();
  for (const r of cds.rows)
    if (r.DifficultyID === "0" && r.SpellID && !catCd.has(r.SpellID))
      catCd.set(r.SpellID, Number(r.CategoryRecoveryTime ?? 0));

  const out: Record<string, { overrides: string; via: string; by: string }> =
    {};
  for (const r of eff.rows) {
    if (r.EffectAura !== "332") continue;
    const y = r.EffectMiscValue_0 ?? "0";
    const x = String(Math.round(Number(r.EffectBasePointsF ?? 0)));
    if (y === "0" || x === "0" || x === y) continue;
    if (!observed.has(x) || !observed.has(y)) continue;
    const a = catOf.get(y);
    const b = catOf.get(x);
    if (!a || !b) continue;
    const sameCategory =
      a.c !== "0" &&
      a.c === b.c &&
      (catCd.get(x) ?? 0) > 0 &&
      (catCd.get(y) ?? 0) > 0;
    const sameCharges = a.ch !== "0" && a.ch === b.ch && charged.has(a.ch);
    if (!sameCategory && !sameCharges) continue;
    const yName = nameOf.get(y) ?? "";
    if (yName !== "" && nameOf.get(r.SpellID!) === yName) continue;
    const via = sameCategory ? `Category ${a.c}` : `ChargeCategory ${a.ch}`;
    const prev = out[x];
    // one overridden spell per variant; a second, different one is ambiguous
    if (prev && prev.overrides !== y) {
      prev.overrides = "";
      continue;
    }
    out[x] = { overrides: y, via, by: r.SpellID! };
  }
  const table: Record<string, string> = {};
  const notes: string[] = [];
  for (const x of Object.keys(out).sort((p, q) => Number(p) - Number(q))) {
    const e = out[x]!;
    if (!e.overrides) continue;
    table[x] = e.overrides;
    notes.push(
      `  ${x} ${nameOf.get(x) ?? "?"} → ${e.overrides} ${nameOf.get(e.overrides) ?? "?"} (aura 332 of ${e.by}, ${e.via})`,
    );
  }
  const outPath = new URL(
    "../../src/data/overrideVariantsGenerated.ts",
    import.meta.url,
  ).pathname;
  const header = `/**\n * Generated at: ${new Date().toISOString()}\n * Build: ${build}\n * Source: SpellEffect.EffectAura 332 (OVERRIDE_ACTIONBAR_SPELLS) pairs\n *   variant (EffectBasePointsF) → overridden (EffectMiscValue_0) that draw on\n *   one cooldown (same Category with CategoryRecoveryTime > 0 on both, or the\n *   same charged ChargeCategory); both ids observed; not a stage / cancel of
 *   the spell's own aura. Generator:\n *   scripts/datagen/genOverrideVariants.ts\n * pairs: ${Object.keys(table).length}\n${notes.map((n) => ` *${n}`).join("\n")}\n */\n\n`;
  writeArtifact(
    outPath,
    header +
      `/** variant spell id → the spell id whose button (and cooldown) it takes */\nexport const OVERRIDE_VARIANTS_GENERATED: Readonly<Record<string, string>> = ${JSON.stringify(table, null, 2)};\n`,
  );
  console.log(
    `overrideVariantsGenerated.ts: ${Object.keys(table).length} pairs (build ${build})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

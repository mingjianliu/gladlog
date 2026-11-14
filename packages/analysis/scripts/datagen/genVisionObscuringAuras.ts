/**
 * Auras that obscure their carrier from enemy targeting (official data): DB2
 * SpellEffect aura 322 (MOD_INTERFERE_TARGETTING) on the spell itself,
 * restricted to the observed universe. A unit standing in a Smoke Bomb
 * (212183) and a burrowed Earthen Shaman (Burrow 409293, effect #0) both
 * carry one; the client then refuses a cast at them with
 * SPELL_FAILED_VISION_OBSCURED ("Your vision of the target is obscured").
 *
 * The Smoke Bomb aura itself is never logged (212183: zero corpus
 * occurrences); what the log shows is the cast that drops the area (Smoke
 * Bomb 212182 / 359053: SpellEffect 179 CREATE_AREATRIGGER, area 6951). So a
 * second set: observed spells with a CREATE_AREATRIGGER effect whose
 * SpellName is the name of an aura-322 spell (the same-name link
 * `castEffectNominations` uses). The area lasts the cast's own duration.
 *
 * Pipeline T108 (fact13 D24, ec49887a r0 1:12): every vision-obscured refusal
 * was blamed on a Smoke Bomb from a fixed wording, while the match had no
 * Rogue and the refusals sat inside an enemy's Burrow. `[REJECTED]` and the
 * other refusal readers name the aura of this set that was up instead.
 */
import fs from "fs-extra";

import { writeArtifact } from "./lib/emit";
import {
  assertColumns,
  fetchTable,
  parseCsv,
  resolveBuild,
} from "./lib/wagoCsv";

/** SpellAuraDefines: SPELL_AURA_MOD_INTERFERE_TARGETTING. */
export const INTERFERE_TARGETING_AURA = "322";
/** SpellEffect.Effect 179: SPELL_EFFECT_CREATE_AREATRIGGER. */
export const CREATE_AREATRIGGER_EFFECT = "179";

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
    ["SpellID", "DifficultyID", "EffectAura", "Effect"],
    "SpellEffect",
  );
  const names = parseCsv(await fetchTable("SpellName", build, cacheDir));
  assertColumns(names.header, ["ID", "Name_lang"], "SpellName");
  const nameOf = new Map(names.rows.map((r) => [r.ID, r.Name_lang]));
  const ids = new Set<string>();
  const auraNames = new Set<string>();
  const areaCasters = new Set<string>();
  for (const r of eff.rows) {
    if (r.DifficultyID !== "0" || !r.SpellID) continue;
    if (r.EffectAura === INTERFERE_TARGETING_AURA) {
      const n = nameOf.get(r.SpellID);
      if (n) auraNames.add(n);
      if (observed.has(r.SpellID)) ids.add(r.SpellID);
    }
    if (r.Effect === CREATE_AREATRIGGER_EFFECT && observed.has(r.SpellID))
      areaCasters.add(r.SpellID);
  }
  const byNumber = (a: string, b: string) => Number(a) - Number(b);
  const sorted = [...ids].sort(byNumber);
  const areaCasts = [...areaCasters]
    .filter((id) => auraNames.has(nameOf.get(id) ?? ""))
    .sort(byNumber);
  const outPath = new URL(
    "../../src/data/visionObscuringAuraGenerated.ts",
    import.meta.url,
  ).pathname;
  const header = `/**\n * Generated at: ${new Date().toISOString()}\n * Build: ${build}\n * Source: SpellEffect aura 322 (MOD_INTERFERE_TARGETTING) on the spell itself; restricted to the\n *   observed universe; area casts: SpellEffect 179 (CREATE_AREATRIGGER) on an observed spell named like\n *   an aura-322 spell\n * ids: ${sorted.length}; area casts: ${areaCasts.length}\n */\n\n`;
  // the English name rides along: the refusal wordings are module-level
  // word lists the gates read, built before the spell-name table loads
  const named = (ids: string[]) =>
    `{\n${ids.map((id) => `  ${JSON.stringify(id)}: ${JSON.stringify(nameOf.get(id) ?? "")},\n`).join("")}}`;
  writeArtifact(
    outPath,
    header +
      `/** aura id → English name */\nexport const VISION_OBSCURING_AURAS: Readonly<Record<string, string>> = ${named(sorted)};\n\n` +
      `/** area cast id → English name */\nexport const VISION_OBSCURING_AREA_CASTS: Readonly<Record<string, string>> = ${named(areaCasts)};\n`,
  );
  console.log(
    `visionObscuringAuraGenerated.ts: ${sorted.length} auras, ${areaCasts.length} area casts (build ${build})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

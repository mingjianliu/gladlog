/**
 * PvP talent replacement table (official data): DB2
 * PvpTalent.OverridesSpellID — when talent X is picked, spell Y no longer
 * exists. The consumer cooldowns.ts uses it to keep replaced spells out of the
 * "never used all match" ledger (user-verified 2026-07-25: Searing Glare vs
 * Blinding Light).
 *
 * Same-name id bridging: the static table (classSpells) historically used aura
 * ids (e.g. 105421) while the official override gives the cast id (115750) —
 * so ids sharing a name in spellEffectGenerated are merged into the replacement
 * set, blocking both accounting paths (static table and dynamic talent
 * discovery).
 */
import { classMetadata } from "../../src/data/classSpells";
import { spellEffectData } from "../../src/data/spellEffectData";
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
  const parsed = parseCsv(await fetchTable("PvpTalent", build, cacheDir));
  assertColumns(parsed.header, ["SpellID", "OverridesSpellID"], "PvpTalent");

  // Name → the set of ids in our static table (bridges aura-id aliases)
  const staticIdsByName = new Map<string, Set<string>>();
  for (const cls of classMetadata) {
    for (const a of cls.abilities ?? []) {
      const s = staticIdsByName.get(a.name) ?? new Set<string>();
      s.add(a.spellId);
      staticIdsByName.set(a.name, s);
    }
  }

  const out: Record<string, string[]> = {};
  for (const row of parsed.rows) {
    const talent = row.SpellID;
    const overridden = row.OverridesSpellID;
    if (!talent || !overridden || overridden === "0") continue;
    const set = new Set(out[talent] ?? []);
    set.add(overridden);
    const name = spellEffectData[overridden]?.name;
    if (name)
      for (const alias of staticIdsByName.get(name) ?? []) set.add(alias);
    out[talent] = [...set].sort((a, b) => Number(a) - Number(b));
  }

  const outPath = new URL(
    "../../src/data/pvpTalentReplacesGenerated.ts",
    import.meta.url,
  ).pathname;
  const header = `/**\n * Generated at: ${new Date().toISOString()}\n * Build: ${build}\n * Source: DB2 PvpTalent.OverridesSpellID (the official replacement relation)\n *   plus a same-name id bridge through classSpells\n * Pairs: ${Object.keys(out).length}\n */\n\n`;
  writeArtifact(
    outPath,
    header +
      `export const PVP_TALENT_REPLACES_GENERATED: Record<string, string[]> = ${JSON.stringify(
        out,
        Object.keys(out).sort((a, b) => Number(a) - Number(b)),
        2,
      )};\n`,
  );
  console.log(
    `pvpTalentReplacesGenerated.ts: ${Object.keys(out).length} talents with overrides (build ${build})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

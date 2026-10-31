/**
 * Auras that deal periodic damage (official data): DB2 SpellEffect aura 3
 * (PERIODIC_DAMAGE), 53 (PERIODIC_LEECH) or 89 (PERIODIC_DAMAGE_PERCENT) on
 * the spell itself. What `[ROT PRESSURE]` calls a DoT.
 *
 * fact7 D32 (F21, 2026-10-30): a hand list of ids and name substrings stood
 * here. Forward check on the 91 fact7 files: 102 debuff ids with
 * SPELL_PERIODIC_DAMAGE rows, 76 of them unknown to the list (Black Arrow,
 * Rend, Rune of Lingering, Expurgation, …), and 102 of 102 in this table. The
 * substrings matched Crippling Poison ("rip"), Grip of the Dead and the Rake
 * stun, none of which ticks.
 *
 * Not restricted to the observed universe, unlike the other aura tables: an
 * id the archive has not seen yet (Venomfang 1306635, 12.1.5) is exactly the
 * miss this table exists to stop, and nothing but an aura on a unit asks it.
 */
import { writeArtifact } from "./lib/emit";
import {
  assertColumns,
  fetchTable,
  parseCsv,
  resolveBuild,
} from "./lib/wagoCsv";

export const PERIODIC_DAMAGE_AURAS = new Set(["3", "53", "89"]);

async function main() {
  const build = await resolveBuild(process.argv[2]);
  const cacheDir = process.env.DATAGEN_CACHE ?? undefined;
  const eff = parseCsv(await fetchTable("SpellEffect", build, cacheDir));
  assertColumns(
    eff.header,
    ["SpellID", "DifficultyID", "EffectAura"],
    "SpellEffect",
  );
  const ids = new Set<string>();
  for (const r of eff.rows) {
    if (r.DifficultyID !== "0" || !r.SpellID) continue;
    if (PERIODIC_DAMAGE_AURAS.has(r.EffectAura ?? "")) ids.add(r.SpellID);
  }
  const sorted = [...ids].sort((a, b) => Number(a) - Number(b));
  const outPath = new URL(
    "../../src/data/periodicAuraGenerated.ts",
    import.meta.url,
  ).pathname;
  const header = `/**\n * Generated at: ${new Date().toISOString()}\n * Build: ${build}\n * Source: SpellEffect aura 3 / 53 / 89 (PERIODIC_DAMAGE / PERIODIC_LEECH /\n *   PERIODIC_DAMAGE_PERCENT) on the spell itself; every id, not only observed ones\n * ids: ${sorted.length}\n */\n\n`;
  writeArtifact(
    outPath,
    header +
      `export const PERIODIC_DAMAGE_AURA_IDS: ReadonlySet<string> = new Set(\n  ${JSON.stringify(sorted)},\n);\n`,
  );
  console.log(
    `periodicAuraGenerated.ts: ${sorted.length} periodic damage auras (build ${build})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

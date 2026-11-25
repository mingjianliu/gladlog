/**
 * Auras the game removes when their charges are spent (official data): DB2
 * SpellAuraOptions.ProcCharges > 0. Restricted to the observed universe
 * (observedSpellIdsGenerated), like excludeCasterGenerated.
 *
 * Pipeline T192 (user ruling R121, 2026-11-25): a charge aura with no dose
 * row — one charge, so no SPELL_AURA_REMOVED_DOSE ever names its spender —
 * that came off right after its holder's own cast was ended by that cast:
 * Vanish's 11327 (ProcCharges 1) goes with the opener (Cheap Shot, Garrote)
 * and read `ended after 0.4 of 1.5s — no dispel logged`. `cdExpiry`
 * (context/timelineHelpers.ts) reads this set; the field decides which
 * auras a holder's cast can spend, never a hand list.
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
  const parsed = parseCsv(
    await fetchTable("SpellAuraOptions", build, cacheDir),
  );
  assertColumns(
    parsed.header,
    ["SpellID", "DifficultyID", "ProcCharges"],
    "SpellAuraOptions",
  );
  const ids: number[] = [];
  const seen = new Set<string>();
  for (const row of parsed.rows) {
    if (row.DifficultyID !== "0" || !row.SpellID || seen.has(row.SpellID))
      continue;
    seen.add(row.SpellID);
    if (!observed.has(row.SpellID)) continue;
    if (Number(row.ProcCharges ?? "0") > 0) ids.push(Number(row.SpellID));
  }
  ids.sort((a, b) => a - b);
  const outPath = new URL(
    "../../src/data/procChargeAurasGenerated.ts",
    import.meta.url,
  ).pathname;
  const header = `/**\n * Generated at: ${new Date().toISOString()}\n * Build: ${build}\n * Source: SpellAuraOptions ProcCharges > 0 (DifficultyID 0), restricted to the\n *   observed universe\n * ids: ${ids.length}\n */\n\n`;
  writeArtifact(
    outPath,
    header +
      `export const PROC_CHARGE_AURA_IDS: ReadonlySet<string> = new Set(\n  ${JSON.stringify(ids.map(String))},\n);\n`,
  );
  console.log(
    `procChargeAurasGenerated.ts: ${ids.length} proc-charge aura ids (build ${build})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

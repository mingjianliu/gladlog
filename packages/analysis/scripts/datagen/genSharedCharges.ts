/**
 * Spells that draw on ONE charge pool (official data): DB2
 * SpellCategories.ChargeCategory shared by two or more observed spells, whose
 * SpellCategory row carries charges (MaxCharges ≥ 1, ChargeRecoveryTime > 0).
 * Restricted to the observed universe, like channeledGenerated.
 *
 * Reliability round 2 W1e (2026-09-26): Blessing of Protection (1022) and
 * Blessing of Spellwarding (204018) are both ChargeCategory 1392 ("Hand of
 * Protection", 1 charge / 300 s) — pressing one spends the other — yet the
 * ledger timed each on its own, so a Protection Paladin who had just pressed
 * Spellwarding was told BoP was still ready (06bb, a5a8).
 */
import fs from "fs-extra";

import { writeArtifact } from "./lib/emit";
import {
  assertColumns,
  resolveBuild,
  fetchTable,
  parseCsv,
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
  const cats = parseCsv(await fetchTable("SpellCategories", build, cacheDir));
  assertColumns(
    cats.header,
    ["SpellID", "DifficultyID", "ChargeCategory"],
    "SpellCategories",
  );
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
  const byCategory = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const r of cats.rows) {
    if (r.DifficultyID !== "0" || !r.SpellID || seen.has(r.SpellID)) continue;
    seen.add(r.SpellID);
    if (!observed.has(r.SpellID)) continue;
    const c = r.ChargeCategory;
    if (!c || c === "0" || !charged.has(c)) continue;
    if (!byCategory.has(c)) byCategory.set(c, []);
    byCategory.get(c)!.push(r.SpellID);
  }
  const out: Record<string, string> = {};
  for (const [c, ids] of [...byCategory.entries()].sort(
    (a, b) => Number(a[0]) - Number(b[0]),
  )) {
    if (ids.length < 2) continue;
    for (const id of ids.sort((a, b) => Number(a) - Number(b))) out[id] = c;
  }
  const groups = new Set(Object.values(out)).size;
  const outPath = new URL(
    "../../src/data/sharedChargeGenerated.ts",
    import.meta.url,
  ).pathname;
  const header = `/**\n * Generated at: ${new Date().toISOString()}\n * Build: ${build}\n * Source: SpellCategories.ChargeCategory shared by ≥ 2 observed spells whose\n *   SpellCategory row has charges; restricted to the observed universe\n * spells: ${Object.keys(out).length} in ${groups} charge pools\n */\n\n`;
  writeArtifact(
    outPath,
    header +
      `/** spell id → the DB2 charge category (pool) it spends from */\nexport const SHARED_CHARGE_CATEGORY: Readonly<Record<string, string>> = ${JSON.stringify(out, null, 2)};\n`,
  );
  console.log(
    `sharedChargeGenerated.ts: ${Object.keys(out).length} spells in ${groups} pools (build ${build})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

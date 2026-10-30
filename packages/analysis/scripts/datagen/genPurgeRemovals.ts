/**
 * How many Magic buffs one press of a dispel removes from one target
 * (official data): DB2 SpellEffect Effect 38 (SPELL_EFFECT_DISPEL) with
 * EffectMiscValue_0 = 1 (Magic) — EffectBasePointsF is the count. Restricted
 * to the observed universe.
 *
 * F20 D31 (fact6, 2026-10-28): the purge legend and `[PURGE]` said "a purge
 * removes ONE", but Greater Purge 378773 carries 2 and Fire Breath 357209
 * (its Scouring Flame dispel effect) 2 — 15 fact6 logs: Greater Purge
 * presses removed {1: 13, 2: 41}, Fire Breath {1: 48, 2: 129}, never more.
 *
 * F20 wide residual (2026-10-29): Effect 126 (SPELL_EFFECT_STEAL_BENEFICIAL_BUFF)
 * with the same Magic misc value is a purge too — Spellsteal 30449 and
 * Kleptomania's tick 1231112, base points 1. The count is the cap `[PURGE]`'s
 * `k` reads: Improved Spellsteal 1270827's delayed repeat (1270828, 4 s) of
 * the previous press can land 10–14 ms after the next press's own steal (3
 * wide matches), and the per-press grouping read the two as one press.
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
    [
      "SpellID",
      "DifficultyID",
      "Effect",
      "EffectMiscValue_0",
      "EffectBasePointsF",
    ],
    "SpellEffect",
  );
  const out: Record<string, number> = {};
  for (const r of eff.rows) {
    if (
      (r.Effect !== "38" && r.Effect !== "126") ||
      r.EffectMiscValue_0 !== "1"
    )
      continue;
    if (r.DifficultyID !== "0" || !r.SpellID || !observed.has(r.SpellID))
      continue;
    const n = Math.round(Number(r.EffectBasePointsF ?? 0));
    if (!(n >= 1)) continue;
    out[r.SpellID] = Math.max(out[r.SpellID] ?? 0, n);
  }
  const table = Object.fromEntries(
    Object.keys(out)
      .sort((a, b) => Number(a) - Number(b))
      .map((id) => [id, out[id]!]),
  );
  // official English names, so the per-tool wording needs no runtime name
  // lookup (the spell-name table loads in the background: at module load
  // `getEnglishSpellName` can only fall back to the id)
  const nameRows = parseCsv(await fetchTable("SpellName", build, cacheDir));
  assertColumns(nameRows.header, ["ID", "Name_lang"], "SpellName");
  const names: Record<string, string> = {};
  for (const r of nameRows.rows)
    if (r.ID && r.ID in table && r.Name_lang) names[r.ID] = r.Name_lang;
  const nameTable = Object.fromEntries(
    Object.keys(table)
      .filter((id) => names[id])
      .map((id) => [id, names[id]!]),
  );
  const outPath = new URL(
    "../../src/data/purgeRemovalsGenerated.ts",
    import.meta.url,
  ).pathname;
  const header = `/**\n * Generated at: ${new Date().toISOString()}\n * Build: ${build}\n * Source: SpellEffect Effect 38 (DISPEL) / 126 (STEAL), EffectMiscValue_0 = 1 (Magic):\n *   EffectBasePointsF = Magic buffs one press removes per target; observed\n *   spells only. Generator: scripts/datagen/genPurgeRemovals.ts\n * spells: ${Object.keys(table).length}\n */\n\n`;
  writeArtifact(
    outPath,
    header +
      `/** dispel spell id → Magic buffs one press removes from one target */\nexport const PURGE_REMOVALS_PER_TARGET: Readonly<Record<string, number>> = ${JSON.stringify(table, null, 2)};\n\n/** dispel spell id → its official English name (DB2 SpellName) */\nexport const PURGE_TOOL_NAMES: Readonly<Record<string, string>> = ${JSON.stringify(nameTable, null, 2)};\n`,
  );
  console.log(
    `purgeRemovalsGenerated.ts: ${Object.keys(table).length} spells (build ${build})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

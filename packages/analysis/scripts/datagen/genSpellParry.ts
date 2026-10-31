/**
 * What a parry can stop (official data, DB2 SpellCategories + SpellMisc),
 * restricted to the observed universe (observedSpellIdsGenerated), like
 * spellStateAttrsGenerated. Bit name from TrinityCore SharedDefines.h.
 *
 * Parryable (`PARRYABLE_SPELL_IDS`): SpellCategories.DefenseType 2 (Melee), and
 * SpellMisc Attributes_0 bit 21 clear (SPELL_ATTR0_NO_ACTIVE_DEFENSE, "Spell
 * cannot be dodged, parried or blocked"), and SpellMisc.Speed 0 (no missile).
 * Not parryable (`UNPARRYABLE_SPELL_IDS`): DefenseType 1 (Magic) or 3 (Ranged),
 * or type 2 with the bit set or a missile speed. DefenseType 0 (None) or no
 * SpellCategories row is in neither set: it says nothing about the attack
 * (Kill Command's press 34026 is type 0, its pet's row 83381 is type 2), and
 * the reader falls through (`parryStopsAttack`).
 *
 * Measured into Die by the Sword (118038) on two samples of the 605 archives,
 * no facing filter, so a hit does not mean the spell could not be parried:
 *
 *   rows into the wall            every 12th (50)   every 13th (46)
 *                                 hits   PARRY      hits   PARRY
 *   type 2, bit clear, Speed 0      63      80       117     154
 *   type 2, bit clear, Speed > 0     3       0         4       0
 *   type 2, bit 21 set               7       0        25       0
 *   type 1 Magic                   351       0       439       0
 *   type 3 Ranged                   28       0        20       0
 *   swings (the baseline)           72      98       135     169
 *
 * Over every target, all 154 + 260 PARRY rows of a spell were on the first
 * line, none on any other. Reach cannot say this: Final Verdict (12 yd) was
 * parried and Touch of Death (5 yd) was not. Speed's clause is Hammer of Wrath
 * (type 2, 30 yd, Speed 40): 3 hits here and 12 on 45 logs, none parried.
 */
import fs from "fs-extra";

import { writeArtifact } from "./lib/emit";
import {
  assertColumns,
  fetchTable,
  parseCsv,
  resolveBuild,
} from "./lib/wagoCsv";

export const DEFENSE_TYPE_MAGIC = "1";
export const DEFENSE_TYPE_MELEE = "2";
export const DEFENSE_TYPE_RANGED = "3";
export const NO_ACTIVE_DEFENSE_BIT = 21; // Attributes_0

const hasBit = (raw: string | undefined, bit: number): boolean => {
  const n = Number(raw ?? "0");
  return Number.isFinite(n) && ((n >>> bit) & 1) === 1;
};

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
  const misc = parseCsv(await fetchTable("SpellMisc", build, cacheDir));
  assertColumns(
    cats.header,
    ["SpellID", "DifficultyID", "DefenseType"],
    "SpellCategories",
  );
  assertColumns(
    misc.header,
    ["SpellID", "DifficultyID", "Attributes_0", "Speed"],
    "SpellMisc",
  );
  const miscOf = new Map<string, Record<string, string>>();
  for (const row of misc.rows)
    if (row.DifficultyID === "0" && row.SpellID && !miscOf.has(row.SpellID))
      miscOf.set(row.SpellID, row);

  const parryable: number[] = [];
  const unparryable: number[] = [];
  const seen = new Set<string>();
  for (const row of cats.rows) {
    if (row.DifficultyID !== "0" || !row.SpellID || seen.has(row.SpellID))
      continue;
    seen.add(row.SpellID);
    if (!observed.has(row.SpellID)) continue;
    const id = Number(row.SpellID);
    if (
      row.DefenseType === DEFENSE_TYPE_MAGIC ||
      row.DefenseType === DEFENSE_TYPE_RANGED
    ) {
      unparryable.push(id);
      continue;
    }
    if (row.DefenseType !== DEFENSE_TYPE_MELEE) continue;
    const m = miscOf.get(row.SpellID);
    if (!m) continue;
    if (hasBit(m.Attributes_0, NO_ACTIVE_DEFENSE_BIT) || Number(m.Speed) > 0)
      unparryable.push(id);
    else parryable.push(id);
  }
  parryable.sort((a, b) => a - b);
  unparryable.sort((a, b) => a - b);
  const outPath = new URL(
    "../../src/data/spellParryGenerated.ts",
    import.meta.url,
  ).pathname;
  const header = `/**\n * Generated at: ${new Date().toISOString()}\n * Build: ${build}\n * Source: SpellCategories.DefenseType, SpellMisc Attributes_0 bit 21 (No Active\n *   Defense) and SpellMisc.Speed, restricted to the observed universe\n * ids: ${parryable.length + unparryable.length}\n */\n\n`;
  writeArtifact(
    outPath,
    header +
      `export const PARRYABLE_SPELL_IDS: ReadonlySet<string> = new Set(\n  ${JSON.stringify(parryable.map(String))},\n);\n\n` +
      `export const UNPARRYABLE_SPELL_IDS: ReadonlySet<string> = new Set(\n  ${JSON.stringify(unparryable.map(String))},\n);\n`,
  );
  console.log(
    `spellParryGenerated.ts: ${parryable.length} parryable, ${unparryable.length} not parryable (build ${build})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

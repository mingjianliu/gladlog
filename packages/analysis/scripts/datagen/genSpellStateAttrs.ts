/**
 * Two caster-state attributes of a spell (official data, DB2 SpellMisc),
 * restricted to the observed universe (observedSpellIdsGenerated), like
 * channeledGenerated. Names from TrinityCore SharedDefines.h.
 *
 * Attributes_9 bit 20, SPELL_ATTR9_ALLOW_CAST_WHILE_CHANNELING
 * (`CAST_WHILE_CHANNELING_SPELL_IDS`): pressing it leaves a running channel
 * alone. Off the global cooldown is not enough. 24 archives of the 605 sample
 * (fact7 `channelOutlived`), off-GCD presses inside a channel whose same-id
 * aura on the caster measures it: without the bit 39 ended the channel within
 * 100 ms and 0 left it running (Pain Suppression's cousins Power Infusion,
 * Guardian Spirit, Roll, Fortifying Brew, Dark Pact …); with it 13 ran on and
 * 3 sat at the channel's end. The tooltip's "Castable while casting" (Shimmer,
 * Fire Blast, Ice Floes, Hover, Combustion) is the same bit.
 *
 * Attributes_1 bit 5, SPELL_ATTR1_ALLOW_WHILE_STEALTHED
 * (`ALLOWED_WHILE_STEALTHED_SPELL_IDS`): using it does not break stealth. Same
 * 24 archives, presses by a holder of a logged Vanish / Stealth run: with the
 * bit 34 left the run going and 1 sat at its end (Sap, Blind, Sprint,
 * Shadowstep); the openers without it ended the run in their own instant, 29
 * of 29 (Cheap Shot, Garrote, Gouge, Kidney Shot).
 */
import fs from "fs-extra";

import { writeArtifact } from "./lib/emit";
import {
  assertColumns,
  fetchTable,
  parseCsv,
  resolveBuild,
} from "./lib/wagoCsv";

export const CAST_WHILE_CHANNELING_BIT = 20; // Attributes_9
export const ALLOWED_WHILE_STEALTHED_BIT = 5; // Attributes_1

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
  const parsed = parseCsv(await fetchTable("SpellMisc", build, cacheDir));
  assertColumns(
    parsed.header,
    ["SpellID", "DifficultyID", "Attributes_1", "Attributes_9"],
    "SpellMisc",
  );
  const whileChanneling: number[] = [];
  const whileStealthed: number[] = [];
  const seen = new Set<string>();
  for (const row of parsed.rows) {
    if (row.DifficultyID !== "0" || !row.SpellID || seen.has(row.SpellID))
      continue;
    seen.add(row.SpellID);
    if (!observed.has(row.SpellID)) continue;
    if (hasBit(row.Attributes_9, CAST_WHILE_CHANNELING_BIT))
      whileChanneling.push(Number(row.SpellID));
    if (hasBit(row.Attributes_1, ALLOWED_WHILE_STEALTHED_BIT))
      whileStealthed.push(Number(row.SpellID));
  }
  whileChanneling.sort((a, b) => a - b);
  whileStealthed.sort((a, b) => a - b);
  const outPath = new URL(
    "../../src/data/spellStateAttrsGenerated.ts",
    import.meta.url,
  ).pathname;
  const header = `/**\n * Generated at: ${new Date().toISOString()}\n * Build: ${build}\n * Source: SpellMisc Attributes_9 bit 20 (Allow Cast While Channeling) and\n *   Attributes_1 bit 5 (Allow While Stealthed), restricted to the observed\n *   universe\n * ids: ${whileChanneling.length + whileStealthed.length}\n */\n\n`;
  writeArtifact(
    outPath,
    header +
      `export const CAST_WHILE_CHANNELING_SPELL_IDS: ReadonlySet<string> = new Set(\n  ${JSON.stringify(whileChanneling.map(String))},\n);\n\n` +
      `export const ALLOWED_WHILE_STEALTHED_SPELL_IDS: ReadonlySet<string> = new Set(\n  ${JSON.stringify(whileStealthed.map(String))},\n);\n`,
  );
  console.log(
    `spellStateAttrsGenerated.ts: ${whileChanneling.length} cast-while-channeling, ${whileStealthed.length} allowed-while-stealthed ids (build ${build})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

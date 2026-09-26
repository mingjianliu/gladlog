/**
 * Spells that summon a unit (official data): DB2 SpellEffect.Effect 28
 * (SPELL_EFFECT_SUMMON) on the spell itself or on a spell it triggers
 * (EffectTriggerSpell, one hop — Army of the Dead raises its ghouls that way).
 * Restricted to the observed universe, like channeledGenerated.
 *
 * Reliability round 2 W1f (2026-09-26): the owner's distance at the press is
 * not the owner's mistake when the cooldown's payoff is a pet that walks or
 * casts from range — Grimoire: Imp Lord pressed at 21 yd was accused as "out
 * of range" while the Imp Lord's Felbolts hit the named enemy 2.3 s later
 * (ba44). positionAnalysis abstains on these.
 */
import fs from "fs-extra";

import { writeArtifact } from "./lib/emit";
import {
  assertColumns,
  resolveBuild,
  fetchTable,
  parseCsv,
} from "./lib/wagoCsv";

export const SPELL_EFFECT_SUMMON = "28";

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
    ["SpellID", "DifficultyID", "Effect", "EffectTriggerSpell"],
    "SpellEffect",
  );
  const summons = new Set<string>();
  const triggers = new Map<string, string[]>();
  for (const r of eff.rows) {
    if (r.DifficultyID !== "0" || !r.SpellID) continue;
    if (r.Effect === SPELL_EFFECT_SUMMON) summons.add(r.SpellID);
    const t = r.EffectTriggerSpell;
    if (t && t !== "0") {
      if (!triggers.has(r.SpellID)) triggers.set(r.SpellID, []);
      triggers.get(r.SpellID)!.push(t);
    }
  }
  const ids = [...observed]
    .filter(
      (id) =>
        summons.has(id) || (triggers.get(id) ?? []).some((t) => summons.has(t)),
    )
    .sort((a, b) => Number(a) - Number(b));
  const outPath = new URL("../../src/data/summonGenerated.ts", import.meta.url)
    .pathname;
  const header = `/**\n * Generated at: ${new Date().toISOString()}\n * Build: ${build}\n * Source: SpellEffect.Effect ${SPELL_EFFECT_SUMMON} (SUMMON) on the spell or one EffectTriggerSpell hop;\n *   restricted to the observed universe\n * ids: ${ids.length}\n */\n\n`;
  writeArtifact(
    outPath,
    header +
      `export const SUMMON_SPELL_IDS: ReadonlySet<string> = new Set(\n  ${JSON.stringify(ids)},\n);\n`,
  );
  console.log(`summonGenerated.ts: ${ids.length} summon ids (build ${build})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

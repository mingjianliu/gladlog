/**
 * Class / hero talent replacement table (official data): DB2
 * TraitDefinition.OverridesSpellID — when talent X is taken, spell Y's button
 * is replaced (the sibling of PvpTalent.OverridesSpellID that
 * genPvpTalentReplaces reads). Consumer: `replacedSpellIds` in
 * src/data/talentReplaces.ts → the cooldown ledger never lists Y for a holder
 * of X ("never pressed Berserker Rage" while pressing Berserker Shout), and
 * talent ownership answers "no" for Y.
 *
 * Reliability audit C1 (2026-09-26) found the relation unread: the datagen's
 * `replace_spell` modifiers only see the aura-332 override rows, and the
 * conditional overrides ("if you know X, it is replaced by Y") are in neither
 * — those stay in the hand table `TALENT_REPLACES`, tooltip-quoted.
 *
 * Kept rows — a pair enters only when it can change the ledger and the
 * replacement is a button:
 *   · the overridden spell Y has an official cooldown ≥ 30 s (MIN_CD_SECONDS;
 *     anything shorter never enters the major-cooldown ledger), and
 *   · the replacing talent spell X itself has a cooldown > 0 (a pressable
 *     button). A PASSIVE override (Radiant Glory-shaped: the button becomes a
 *     proc) is deliberately NOT a drop — `talentReplacementsOf().procOnly`
 *     keeps that entry alive as activations (GH #106 step 2: dropping it
 *     turned 78 of 96 missed-sync-window accusations into "your team entered
 *     nothing" while the proc was up).
 * Same-name id bridging as the PvP generator: the static table historically
 * keys some spells by aura id, so ids sharing Y's name in classSpells join
 * the set.
 *
 * Runtime guard on top (cooldowns.ts): a SPELL_CAST_SUCCESS of Y by the
 * holder this round beats the table — the button evidently exists.
 * Reverse check each season: `packages/eval/scripts/talentReplaceScan.ts`
 * re-measures every pair on raw casts (CONTRADICTED = holders press Y).
 *
 *   DATAGEN_CACHE=~/.cache/gladlog-datagen npx tsx packages/analysis/scripts/datagen/genTalentReplaces.ts [build]
 */
import { classMetadata } from "../../src/data/classSpells";
import {
  effectiveCooldownSeconds,
  spellEffectData,
} from "../../src/data/spellEffectData";
import { writeArtifact } from "./lib/emit";
import {
  assertColumns,
  fetchTable,
  parseCsv,
  resolveBuild,
} from "./lib/wagoCsv";

const MIN_CD_SECONDS = 30; // cooldowns.ts MIN_CD_SECONDS — the ledger's own floor

/**
 * Official rows the corpus contradicts (talentReplaceScan reverse check):
 * holders press the "replaced" spell, so the relation means something other
 * than "the button is gone" for that pair. Kept out of the artifact with the
 * measurement; re-measure each season.
 */
const CORPUS_REJECTED: Record<string, string[]> = {
  // Mistweaver: 122 of 147 statue holders cast Paralysis (605 files,
  // 2026-09-26) — the row does not describe the button.
  "115313": ["115078"],
};

async function main() {
  const build = await resolveBuild(process.argv[2]);
  const cacheDir = process.env.DATAGEN_CACHE ?? undefined;
  const parsed = parseCsv(await fetchTable("TraitDefinition", build, cacheDir));
  assertColumns(
    parsed.header,
    ["SpellID", "OverridesSpellID"],
    "TraitDefinition",
  );

  const staticIdsByName = new Map<string, Set<string>>();
  for (const cls of classMetadata) {
    for (const a of cls.abilities ?? []) {
      const s = staticIdsByName.get(a.name) ?? new Set<string>();
      s.add(a.spellId);
      staticIdsByName.set(a.name, s);
    }
  }

  const out: Record<string, string[]> = {};
  const skipped = { shortCd: 0, passiveTalent: 0, corpusRejected: 0 };
  for (const row of parsed.rows) {
    const talent = row.SpellID;
    const overridden = row.OverridesSpellID;
    if (!talent || !overridden || overridden === "0" || talent === overridden)
      continue;
    if ((effectiveCooldownSeconds(overridden) ?? 0) < MIN_CD_SECONDS) {
      skipped.shortCd++;
      continue;
    }
    if (!((effectiveCooldownSeconds(talent) ?? 0) > 0)) {
      skipped.passiveTalent++;
      continue;
    }
    if (CORPUS_REJECTED[talent]?.includes(overridden)) {
      skipped.corpusRejected++;
      continue;
    }
    const set = new Set(out[talent] ?? []);
    set.add(overridden);
    const name = spellEffectData[overridden]?.name;
    if (name)
      for (const alias of staticIdsByName.get(name) ?? []) set.add(alias);
    out[talent] = [...set].sort((a, b) => Number(a) - Number(b));
  }

  const outPath = new URL(
    "../../src/data/talentReplacesGenerated.ts",
    import.meta.url,
  ).pathname;
  const header = `/**\n * Generated at: ${new Date().toISOString()}\n * Build: ${build}\n * Source: DB2 TraitDefinition.OverridesSpellID (the official replacement relation)\n *   kept when the overridden spell's cooldown ≥ ${MIN_CD_SECONDS} s and the talent is a button\n *   (cooldown > 0); plus a same-name id bridge through classSpells\n * Pairs: ${Object.keys(out).length} (skipped: ${skipped.shortCd} short-cooldown targets, ${skipped.passiveTalent} passive talents, ${skipped.corpusRejected} corpus-rejected)\n */\n\n`;
  writeArtifact(
    outPath,
    header +
      `export const TALENT_REPLACES_GENERATED: Record<string, string[]> = ${JSON.stringify(
        out,
        Object.keys(out).sort((a, b) => Number(a) - Number(b)),
        2,
      )};\n`,
  );
  console.log(
    `talentReplacesGenerated.ts: ${Object.keys(out).length} talents with overrides (build ${build}; skipped ${skipped.shortCd} short-cd, ${skipped.passiveTalent} passive, ${skipped.corpusRejected} corpus-rejected)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

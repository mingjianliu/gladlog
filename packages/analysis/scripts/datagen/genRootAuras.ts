/**
 * Auras that root their carrier (official data): DB2 SpellEffect aura 26
 * (MOD_ROOT) or 455 (MOD_ROOT_2) — 455 is the encoding every 12.x root uses
 * (Frost Nova 122, Entangling Roots 339, Ice Nova 157997, The Hunt's root
 * 370970, Charge's root 105771; aura 26 alone matched 6 observed ids) — on the
 * spell itself, restricted to the observed universe.
 *
 * Reliability round 3 W1a (6954, 2026-09-26): the root DR class (DiminishType
 * 1) misses roots with no DR (Ice Nova 157997 — a Retribution Paladin under it
 * was granted a kick run he could not make). The spell-level mechanic 7 was
 * tried first and rejected: its same-name fallback tagged The Hunt's 7.8 s
 * damage aura as a root. The aura effect is the fact itself.
 */
import fs from "fs-extra";

import { writeArtifact } from "./lib/emit";
import {
  assertColumns,
  resolveBuild,
  fetchTable,
  parseCsv,
} from "./lib/wagoCsv";

// 440 is MOD_MULTISTRIKE_DAMAGE, not a root (codex astra review, TrinityCore
// SpellAuraDefines.h) — excluded.
export const ROOT_AURAS = new Set(["26", "455"]);
/** ImplicitTarget 1 = TARGET_UNIT_CASTER. */
export const CASTER_TARGET = "1";

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
    ["SpellID", "DifficultyID", "EffectAura", "ImplicitTarget_0"],
    "SpellEffect",
  );
  const ids = new Set<string>();
  for (const r of eff.rows) {
    if (r.DifficultyID !== "0" || !r.SpellID) continue;
    // A root effect aimed at the caster (ImplicitTarget 1) roots the caster
    // itself while the same spell id rides on its target as something else —
    // Mind Sear 1280457 is aura 23 on the enemy and aura 26 on the channelling
    // pet: 11 false "[ROOT] Mind Sear rooted <enemy> for 10 s" lines.
    if (
      ROOT_AURAS.has(r.EffectAura ?? "") &&
      r.ImplicitTarget_0 !== CASTER_TARGET &&
      observed.has(r.SpellID)
    )
      ids.add(r.SpellID);
  }
  const sorted = [...ids].sort((a, b) => Number(a) - Number(b));
  const outPath = new URL(
    "../../src/data/rootAuraGenerated.ts",
    import.meta.url,
  ).pathname;
  const header = `/**\n * Generated at: ${new Date().toISOString()}\n * Build: ${build}\n * Source: SpellEffect aura 26 / 455 (MOD_ROOT / MOD_ROOT_2) on the spell itself; restricted to the\n *   observed universe\n * ids: ${sorted.length}\n */\n\n`;
  writeArtifact(
    outPath,
    header +
      `export const ROOT_AURA_SPELL_IDS: ReadonlySet<string> = new Set(\n  ${JSON.stringify(sorted)},\n);\n`,
  );
  console.log(
    `rootAuraGenerated.ts: ${sorted.length} root auras (build ${build})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

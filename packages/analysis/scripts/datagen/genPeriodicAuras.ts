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
 *
 * fact10 D29 (F25, 2026-11-04): also `PERIODIC_TRIGGER_SPELLS` — an aura
 * whose effect is 23 / 227 (PERIODIC_TRIGGER_SPELL / _WITH_VALUE) → the
 * EffectTriggerSpell ids it fires each period, observed auras only. The
 * aura's last trigger can be logged a few ms after its REMOVED (Boomstick
 * 1261193 → its volley 1261215, 1–12 ms on 1cbbdcb3).
 */
import fs from "fs-extra";

import { writeArtifact } from "./lib/emit";
import {
  assertColumns,
  fetchTable,
  parseCsv,
  resolveBuild,
} from "./lib/wagoCsv";

export const PERIODIC_DAMAGE_AURAS = new Set(["3", "53", "89"]);
const PERIODIC_TRIGGER_AURAS = new Set(["23", "227"]);

async function main() {
  const build = await resolveBuild(process.argv[2]);
  const cacheDir = process.env.DATAGEN_CACHE ?? undefined;
  const eff = parseCsv(await fetchTable("SpellEffect", build, cacheDir));
  assertColumns(
    eff.header,
    ["SpellID", "DifficultyID", "EffectAura", "EffectTriggerSpell"],
    "SpellEffect",
  );
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
  const ids = new Set<string>();
  const triggers = new Map<string, Set<string>>();
  for (const r of eff.rows) {
    if (r.DifficultyID !== "0" || !r.SpellID) continue;
    if (PERIODIC_DAMAGE_AURAS.has(r.EffectAura ?? "")) ids.add(r.SpellID);
    const t = r.EffectTriggerSpell ?? "0";
    if (
      PERIODIC_TRIGGER_AURAS.has(r.EffectAura ?? "") &&
      t !== "0" &&
      observed.has(r.SpellID)
    ) {
      if (!triggers.has(r.SpellID)) triggers.set(r.SpellID, new Set());
      triggers.get(r.SpellID)!.add(t);
    }
  }
  // an observed 23 / 227 aura with no trigger id on any of its rows: the
  // game scripts what it fires (Void Ray 473728 → 1213649 / 1214595) —
  // its ticks are read by the aura's own name (fact10 D29 residual)
  const scripted = new Set<string>();
  for (const r of eff.rows) {
    if (r.DifficultyID !== "0" || !r.SpellID) continue;
    if (
      PERIODIC_TRIGGER_AURAS.has(r.EffectAura ?? "") &&
      (r.EffectTriggerSpell ?? "0") === "0" &&
      observed.has(r.SpellID) &&
      !triggers.has(r.SpellID)
    )
      scripted.add(r.SpellID);
  }
  const scriptedIds = [...scripted].sort((a, b) => Number(a) - Number(b));
  const triggerRows = [...triggers.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([a, ts]) => [a, [...ts].sort((x, y) => Number(x) - Number(y))]);
  const sorted = [...ids].sort((a, b) => Number(a) - Number(b));
  const outPath = new URL(
    "../../src/data/periodicAuraGenerated.ts",
    import.meta.url,
  ).pathname;
  const header = `/**\n * Generated at: ${new Date().toISOString()}\n * Build: ${build}\n * Source: SpellEffect aura 3 / 53 / 89 (PERIODIC_DAMAGE / PERIODIC_LEECH /\n *   PERIODIC_DAMAGE_PERCENT) on the spell itself; every id, not only observed ones\n * ids: ${sorted.length}; periodic-trigger auras (23 / 227, observed): ${triggerRows.length}; scripted: ${scriptedIds.length}\n */\n\n`;
  writeArtifact(
    outPath,
    header +
      `export const PERIODIC_DAMAGE_AURA_IDS: ReadonlySet<string> = new Set(\n  ${JSON.stringify(sorted)},\n);\n\n` +
      `/** aura (effect 23 / 227, observed) → the spells it triggers each period */\n` +
      `export const PERIODIC_TRIGGER_SPELLS: ReadonlyMap<string, readonly string[]> = new Map(\n  ${JSON.stringify(triggerRows)} as [string, string[]][],\n);\n\n` +
      `/** aura (effect 23 / 227, observed) with no trigger id on any row: the game scripts what it fires */\n` +
      `export const SCRIPTED_PERIODIC_TRIGGER_AURA_IDS: ReadonlySet<string> = new Set(\n  ${JSON.stringify(scriptedIds)},\n);\n`,
  );
  console.log(
    `periodicAuraGenerated.ts: ${sorted.length} periodic damage auras (build ${build})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

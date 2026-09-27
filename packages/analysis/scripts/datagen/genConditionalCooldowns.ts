/**
 * Cooldown modifiers that only hold while a BUFF is up — the rows
 * compileCooldownModifiers drops on purpose (activation "whileAura"). User
 * ruling 2026-09-26 (talent impact audit): model them.
 *
 * Two kinds, per agy review of the design (2026-09-26):
 *   - "rate": charge / category recovery-rate auras (454 charge recovery
 *     multiplier, 148 category recovery rate). While the carrier aura is up
 *     the cooldown clock runs `mult` × faster (mult = 1 + v/100 for 148,
 *     1 / (1 − p) for 454, a −100 % capped at ×20). Applied to single-charge
 *     and charge spells alike (the charge simulation runs on the warped clock).
 *   - "snapshot": SpellMod cooldown rows (aura 107/108/218/219 op 11, 453/341)
 *     — WoW snapshots them at the cast, so a press made while the carrier is
 *     up gets its own cooldown. Single-charge spells ONLY: a charge spell's
 *     press consumes a charge, and a class-mask SpellMod that overlaps it
 *     (Berserk −100 % hitting Frenzied Regeneration) does not make the press
 *     free.
 *
 * Source: talentEffectInventoryGenerated.json (targets already resolved by
 * class mask / label / category) + SpellCategories for aura 148, whose
 * misc0 is a ChargeCategory the inventory does not resolve. Carrier = the
 * row's spell (the buff's aura id). Only targets the inventory tracks.
 *
 * Output: src/data/conditionalCooldownsGenerated.json
 *   { [targetSpellId]: [{ carrier, kind: "rate", mult } | { carrier, kind:
 *     "snapshot", flatS?, pct? }] }
 */
import fs from "fs-extra";

import { writeArtifact } from "./lib/emit";
import {
  assertColumns,
  fetchTable,
  parseCsv,
  resolveBuild,
} from "./lib/wagoCsv";

interface Row {
  spellId: string;
  effect: number;
  aura: number;
  misc0: number;
  basePoints: number;
  pvpMultiplier: number;
  targets: Array<{ spellId: string }>;
  activation: string;
}
type Mod =
  | { carrier: string; kind: "rate"; mult: number }
  | { carrier: string; kind: "snapshot"; flatS?: number; pct?: number };

const RATE_CAP = 20;

async function main() {
  const dataDir = new URL("../../src/data/", import.meta.url).pathname;
  const inv = JSON.parse(
    fs.readFileSync(`${dataDir}talentEffectInventoryGenerated.json`, "utf8"),
  ) as { _meta: { build: string }; rows: Row[] };
  const build = await resolveBuild(process.argv[2] ?? inv._meta.build);
  const cacheDir = process.env.DATAGEN_CACHE ?? undefined;
  const cats = parseCsv(await fetchTable("SpellCategories", build, cacheDir));
  assertColumns(
    cats.header,
    ["SpellID", "DifficultyID", "ChargeCategory", "Category"],
    "SpellCategories",
  );
  const chargeCat = new Map<number, string[]>();
  const chargedSpells = new Set<string>();
  for (const r of cats.rows) {
    if (r.DifficultyID !== "0" || !r.SpellID) continue;
    const c = Number(r.ChargeCategory ?? 0);
    if (!c) continue;
    chargedSpells.add(r.SpellID);
    const l = chargeCat.get(c) ?? [];
    if (!l.includes(r.SpellID)) l.push(r.SpellID);
    chargeCat.set(c, l);
  }
  const tracked = new Set(
    inv.rows.flatMap((r) => r.targets.map((t) => t.spellId)),
  );

  const out: Record<string, Mod[]> = {};
  const add = (target: string, m: Mod) => {
    const l = (out[target] ??= []);
    if (!l.some((x) => JSON.stringify(x) === JSON.stringify(m))) l.push(m);
  };
  for (const r of inv.rows) {
    if (r.activation !== "whileAura" || r.effect !== 6) continue;
    const v = Math.round(r.basePoints * r.pvpMultiplier * 1000) / 1000;
    if (v === 0) continue;
    if (r.aura === 148) {
      const mult = Math.min(RATE_CAP, 1 + v / 100);
      if (mult <= 1) continue;
      for (const t of chargeCat.get(r.misc0) ?? [])
        if (tracked.has(t)) add(t, { carrier: r.spellId, kind: "rate", mult });
    } else if (r.aura === 454) {
      const p = -v / 100; // −100 → 1
      const mult = p >= 1 ? RATE_CAP : Math.min(RATE_CAP, 1 / (1 - p));
      if (mult <= 1) continue;
      for (const t of r.targets)
        add(t.spellId, { carrier: r.spellId, kind: "rate", mult });
    } else if (
      ([107, 108, 218, 219].includes(r.aura) && r.misc0 === 11) ||
      r.aura === 453 ||
      r.aura === 341
    ) {
      const pct = r.aura === 108 || r.aura === 218;
      for (const t of r.targets) {
        if (chargedSpells.has(t.spellId)) continue; // snapshot: single-charge only
        add(
          t.spellId,
          pct
            ? { carrier: r.spellId, kind: "snapshot", pct: -v }
            : {
                carrier: r.spellId,
                kind: "snapshot",
                flatS: Math.abs(v) > 500 ? -v / 1000 : -v,
              },
        );
      }
    }
  }
  const sorted = Object.fromEntries(
    Object.entries(out).sort((a, b) => Number(a[0]) - Number(b[0])),
  );
  writeArtifact(
    `${dataDir}conditionalCooldownsGenerated.json`,
    `${JSON.stringify({ _meta: { build, generator: "scripts/datagen/genConditionalCooldowns.ts" }, byTarget: sorted }, null, 1)}\n`,
  );
  console.log(
    `conditional cooldowns: ${Object.keys(sorted).length} targets, ${Object.values(sorted).flat().length} modifiers`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

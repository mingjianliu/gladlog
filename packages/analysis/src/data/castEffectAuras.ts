/**
 * castEffectAuras.ts — the ONE cast → effect-aura table (triage 2026-09-29,
 * CROSS-THEME G3; ruling A10 = both, 2026-09-30: "DB2 datagen nominates, the
 * corpus verifies").
 *
 * A logged cast id is often not the id of the aura the cast leaves: Storm Bolt
 * 107570 stuns with 132169 (and its IMMUNE miss is logged under 132169),
 * Freezing Trap 187650 traps with 3355 — or 203337 under Diamond Ice — Solar
 * Beam 78675 silences with 81261, Maim 22570 stuns with 203123. Readers keyed
 * on the cast id saw "no effect", "landed", "Full DR" or "no CC" where the log
 * says otherwise.
 *
 * Source: `castEffectAuraGenerated.json`, written by
 * `packages/eval/scripts/castEffectAuraScan.ts --emit` from the DB2
 * nominations of `scripts/datagen/genCastEffectNominations.ts` (same
 * SpellName or EffectTriggerSpell chain → an aura-bearing spell). A pair is in
 * the table only when the corpus shows the cast's caster (or its summon)
 * applying that aura after the cast — the rule and counts are in the file's
 * `meta` and per row. Multi-valued on purpose (Freezing Trap → 3355 and
 * 203337; Binding Shot → its stun and its tether).
 *
 * This replaced the hand list `CC_CAST_EFFECT_AURA` (drAnalysis.ts, 14 rows,
 * single-valued); every one of those rows is in the generated table
 * (`test/castEffectAuras.test.ts` pins them), and the single-valued readers go
 * through `drEffectAuraOfCast` (utils/drAnalysis.ts: the most-applied effect
 * aura with an official DR category). Registered in `curatedIdRegistry.ts`; re-run
 * both stages at a season refresh (docs/commands/update-wow-data.md).
 */
import generated from "./castEffectAuraGenerated.json";

interface Row {
  aura: string;
  casts: number;
  hits: number;
}

const byCast = new Map<string, readonly string[]>();
const byAura = new Map<string, string[]>();
for (const [cast, rows] of Object.entries(
  (generated as unknown as { casts: Record<string, Row[]> }).casts,
)) {
  // most-applied first: the single-valued readers take the head
  const auras = [...rows].sort((a, b) => b.hits - a.hits).map((r) => r.aura);
  byCast.set(cast, auras);
  for (const a of auras) {
    if (!byAura.has(a)) byAura.set(a, []);
    byAura.get(a)!.push(cast);
  }
}

const NONE: readonly string[] = [];

/** The aura ids the log shows this cast applying, most-applied first; empty
 * for a cast whose aura carries its own id (or no aura). */
export function effectAurasOfCast(castSpellId: string): readonly string[] {
  return byCast.get(castSpellId) ?? NONE;
}

/** The casts whose effect this aura is (the inverse view). */
export function castsOfEffectAura(auraSpellId: string): readonly string[] {
  return byAura.get(auraSpellId) ?? NONE;
}

/** The cast's own id and every effect aura it applies — "is this aura / miss
 * this cast's?" in one set. */
export function castAndEffectIds(castSpellId: string): ReadonlySet<string> {
  return new Set([castSpellId, ...effectAurasOfCast(castSpellId)]);
}

/** Does `auraOrMissSpellId` belong to a cast of `castSpellId` — the same id,
 * or one of its effect auras. */
export function isCastOrEffect(
  castSpellId: string,
  auraOrMissSpellId: string,
): boolean {
  return (
    auraOrMissSpellId === castSpellId ||
    effectAurasOfCast(castSpellId).includes(auraOrMissSpellId)
  );
}

/** Every [cast, effect aura] pair of the table — for the readers that build
 * a set of cast ids from a set of effect auras. */
export function castEffectPairs(): ReadonlyArray<readonly [string, string]> {
  const out: Array<readonly [string, string]> = [];
  for (const [cast, auras] of byCast)
    for (const a of auras) out.push([cast, a]);
  return out;
}

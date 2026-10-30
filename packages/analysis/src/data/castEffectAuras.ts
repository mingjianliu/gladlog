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
import nominations from "./castEffectNominationsGenerated.json";

interface Row {
  aura: string;
  casts: number;
  hits: number;
  via?: string;
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

/** WO3 Part 2 (r1008-151): the effect auras of a cast that DB2 chains to it
 * through `EffectTriggerSpell` (`via` holds "trigger") and the corpus shows on
 * ≥ 90 % of its casts — the aura the cast's effect actually lives on
 * (Summon Infernal 1122 → 111685, 560 / 562). */
export function triggeredEffectAurasOfCast(
  castSpellId: string,
): readonly string[] {
  const rows = (generated as unknown as { casts: Record<string, Row[]> }).casts[
    castSpellId
  ];
  return (rows ?? [])
    .filter((r) => r.via?.includes("trigger") && r.hits >= 0.9 * r.casts)
    .map((r) => r.aura);
}

/** The aura ids the log shows this cast applying, most-applied first; empty
 * for a cast whose aura carries its own id (or no aura). */
export function effectAurasOfCast(castSpellId: string): readonly string[] {
  return byCast.get(castSpellId) ?? NONE;
}

/** The casts whose effect this aura is (the inverse view). */
export function castsOfEffectAura(auraSpellId: string): readonly string[] {
  return byAura.get(auraSpellId) ?? NONE;
}

/** fact2 C10 (2026-10-20): an effect aura is the cast's OWN effect under
 * another id — the buff the cooldown runs as, not a side effect — when DB2
 * nominates it by the cast's own name (`via` holds "name") and the corpus
 * shows it after at least this share of the cast's casts. 1,814 files: Blur
 * 1,663 / 1,665, Fortifying Brew 562 / 563, Rallying Cry 969 / 969, Spirit
 * Link Totem 476 / 478, Alter Time 2,337 / 2,337, Colossus Smash 4,223 /
 * 4,254, Kingsbane 2,156 / 2,224. It leaves out what is not the cooldown
 * itself: Aura Mastery's immunity variant 317929 (63 / 1,164 — the
 * concentration-aura branch, no mitigation), Unending Resolve's Aura of
 * Enfeeblement 449587 (by trigger, 154 / 795), Infernal Awakening's stun
 * 22703 (by trigger), a Force of Nature treant buff 205644 (69 / 1,185). */
export const OWN_EFFECT_MIN_HIT_SHARE = 0.9;

const ownByAura = new Map<string, string[]>();
for (const [cast, rows] of Object.entries(
  (generated as unknown as { casts: Record<string, Row[]> }).casts,
)) {
  for (const r of rows) {
    if (!r.via?.includes("name")) continue;
    if (r.casts <= 0 || r.hits < OWN_EFFECT_MIN_HIT_SHARE * r.casts) continue;
    if (!ownByAura.has(r.aura)) ownByAura.set(r.aura, []);
    ownByAura.get(r.aura)!.push(cast);
  }
}

/** The auras that are this cast's OWN effect under another id
 * (`OWN_EFFECT_MIN_HIT_SHARE`), most-applied first — the forward view of
 * `castsOwningEffectAura`. */
export function ownEffectAurasOfCast(castSpellId: string): readonly string[] {
  return effectAurasOfCast(castSpellId).filter((a) =>
    castsOwningEffectAura(a).includes(castSpellId),
  );
}

/** The casts whose OWN effect this aura is (`OWN_EFFECT_MIN_HIT_SHARE`). */
export function castsOwningEffectAura(auraSpellId: string): readonly string[] {
  return ownByAura.get(auraSpellId) ?? NONE;
}

/** fact2 C10: the key a CAST-keyed table knows this AURA by — the aura's own
 * id when the table has it, else the cast whose own effect it is
 * (`castsOwningEffectAura`) when the table has that. The one resolution for
 * every reader that holds an aura id and asks a table keyed by casts
 * (`MITIGATION_TABLE`, the defensive lists, the offensive-cooldown table):
 * Alter Time is pressed as 342245 and runs as 342246, Rallying Cry 97462 as
 * 97463, Colossus Smash 167105 as 208086. Undefined = the table knows
 * neither. */
export function castKeyOfAura(
  auraSpellId: string,
  isKey: (id: string) => boolean,
): string | undefined {
  if (isKey(auraSpellId)) return auraSpellId;
  return castsOwningEffectAura(auraSpellId).find(isKey);
}

/** Every [own-effect aura, cast] pair whose cast `isKey` admits and whose aura
 * it does not — the derived form of the hand map a cast-keyed table used to
 * carry beside it (`SELF_WALL_AURA_TO_CAST_ID`). */
export function ownEffectAurasKeyedBy(
  isKey: (id: string) => boolean,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [aura, casts] of ownByAura) {
    if (isKey(aura)) continue;
    const cast = casts.find(isKey);
    if (cast !== undefined) out[aura] = cast;
  }
  return out;
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

/** Is this CAST in an aura-keyed id set — by its own id or one of its effect
 * auras? For a set built from aura ids (`ccSpellIds` lists Song of Chi-Ji by
 * its disorient 198909, Lightning Lasso by its stun 305485) read with a cast
 * id (res-readiness F-C23). */
export function castInAuraSet(
  castSpellId: string,
  auraIds: ReadonlySet<string>,
): boolean {
  return (
    auraIds.has(castSpellId) ||
    effectAurasOfCast(castSpellId).some((a) => auraIds.has(a))
  );
}

/** The share of this cast's logged casts after which its caster applied the
 * aura (the generated row's `hits / casts`); undefined when the pair is not in
 * the table. */
export function effectAuraHitShare(
  castSpellId: string,
  auraSpellId: string,
): number | undefined {
  const row = (
    generated as unknown as { casts: Record<string, Row[]> }
  ).casts[castSpellId]?.find((r) => r.aura === auraSpellId);
  return row && row.casts > 0 ? row.hits / row.casts : undefined;
}

/** Did DB2 nominate this pair by the cast's own name (`via` holds "name")
 * — the aura is that spell's own effect, not a triggered spell of another
 * name. False when the pair is not in the table. */
export function effectAuraViaName(
  castSpellId: string,
  auraSpellId: string,
): boolean {
  return !!(
    generated as unknown as { casts: Record<string, Row[]> }
  ).casts[castSpellId]
    ?.find((r) => r.aura === auraSpellId)
    ?.via?.includes("name");
}

/** The aura ids DB2 nominates as a cast's effect (same SpellName or an
 * EffectTriggerSpell chain — `genCastEffectNominations.ts`), whether or not
 * the corpus ever logged them: the official reading for an effect the log
 * writes no aura for (Solar Beam 78675 → its silence 81261, never logged).
 * `classOwned` keeps only effects DB2 gives a class (`SpellClassOptions`): a
 * reader with no logged aura to confirm the effect drops the legacy and
 * creature namesakes (Arcane Torrent 28730 → the TBC silence 33390 — codex
 * 20-F15-36). A nomination only by "talent" (every cast of a class one of
 * whose talents triggers a control — a candidate for the corpus scan, F20)
 * is no reading of what this cast does and is left out. */
export function nominatedEffectAurasOfCast(
  castSpellId: string,
  opts: { classOwned?: boolean } = {},
): readonly string[] {
  return (
    (
      nominations as unknown as {
        nominations: Record<
          string,
          { aura: string; via: string; cls?: number }[]
        >;
      }
    ).nominations[castSpellId] ?? []
  )
    .filter((r) => r.via !== "talent")
    .filter((r) => !opts.classOwned || r.cls !== undefined)
    .map((r) => r.aura);
}

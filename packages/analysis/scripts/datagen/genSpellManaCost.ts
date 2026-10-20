/**
 * Per-spell mana cost table (BACKLOG #26 Task 4, raw-streams plan): mines
 * DB2 `SpellPower` for the observed universe's mana-type (`PowerType`=0)
 * spells — consumed by `mana-efficiency`'s per-spell "mana spent vs
 * effective healing bought" aggregate (candidateFindings.ts's
 * `manaEfficiencyEvents`, feature-flagged off by default).
 *
 * Column semantics (verified 2026-08-15 against build 12.1.0.69273's live
 * `SpellPower` CSV — see task-4-report.md for the full derivation):
 * `PowerCostPct` is "% of the caster's base max mana per cast" (the
 * near-universal encoding for current-era abilities); `ManaCost` is a flat
 * absolute cost, mutually exclusive with `PowerCostPct` in every observed
 * row (only 4 of 295 observed mana-type spells use it, none healing-
 * relevant). Anchor cross-check (`spellManaCost.test.ts`): Holy Shock
 * (20473, unconditional row) reads `PowerCostPct=2`; the healer's own raw.txt
 * mana samples around a real Holy Shock cast in match 60ab1e8f show a
 * 5591/273000 = 2.05% drop across the 0.017s gap to the next logged
 * event for that unit — empirically confirms "% of manaMax", not literal
 * mana points or some other unit.
 *
 * **Spec-conditional cost** (the non-obvious part): some spells are shared
 * across a class's specs with a DIFFERENT `PowerCostPct` per spec (e.g.
 * Flash Heal costs 2.61% for a Holy Priest but 10% for a Shadow Priest) —
 * `SpellPower` encodes this as multiple rows for the same `SpellID`, each
 * gated behind a `RequiredAuraSpellID` that is one of a small, stable family
 * of "always-on spec-passive" auras (137007-137050, 212612, 356809/356810,
 * 396186 — one per class/spec combination in the current SpellPower table).
 * Naively picking "the first row" or "the unconditional default row" for a
 * spell like Flash Heal would silently misjudge a Holy Priest's efficiency
 * by ~4x (10% vs the true 2.61%) — confirmed by fetching wowhead's generic
 * Flash Heal page, which shows the class-default 10% with no spec
 * disambiguation, i.e. the exact wrong number this table exists to avoid.
 *
 * **Aura→spec resolution is DERIVED, not hand-typed** (2026-08-15 review
 * fix — a hand-authored aura↔spec table would be an unregistered curated
 * game-fact, per CLAUDE.md's curatedAbilityFacts institution). Each of these
 * spec-passive auras' own official DB2 `Spell.Name_lang` field literally IS
 * the spec's display label — spell 137031 is itself named "Holy Priest",
 * 212612 "Havoc Demon Hunter", 356809 "Devastation Evoker" (verified against
 * the review's 3 wowhead spot-checks). `specKeyToDb2Name`/
 * `buildSpecNameIndex` below mechanically compute that SAME label text from
 * the officially-generated `CombatUnitSpec` enum (packages/parser-compat/src/
 * enumsGenerated.ts) — the enum key `"Paladin_Holy"` PascalCase-splits to
 * `"Holy Paladin"` (spec label first, then class label, spaces inserted at
 * lowercase→uppercase boundaries) — and `main()` joins that index against
 * `spellNames.json` (already-mined `SpellName` table, `genSpellNames.ts`,
 * reused rather than re-fetched) keyed by each row's own
 * `RequiredAuraSpellID`. No table of aura-id↔spec-id pairs is typed by hand
 * anywhere in this file. An aura id whose DB2 name does not match any
 * derived spec label (e.g. "Initial Priest" — the no-spec-chosen placeholder
 * state, never true for an actual played character) resolves to no match and
 * that ROW is skipped with a console warning — `transformSpellManaCostRows`
 * never guesses a spec for an unmatched aura.
 *
 * Scope: restricted to `observedSpellIdsGenerated.json` (spells this
 * library's corpus has actually seen cast), the same "keep it to the
 * observed universe" convention `genOffGcd.ts` uses — 295 of SpellPower's
 * ~5700 rows, no separate healing-spell whitelist needed (a spell nobody in
 * the corpus has cast cannot feed a real candidate anyway).
 */
import { CombatUnitSpec } from "@gladlog/parser-compat";
import fs from "fs-extra";

import { writeArtifact } from "./lib/emit";
import {
  assertColumns,
  assertMinRows,
  fetchTable,
  parseCsv,
  resolveBuild,
} from "./lib/wagoCsv";

export interface ISpellManaCostRaw {
  /** % of the caster's base max mana per cast (SpellPower.PowerCostPct). */
  pct?: number;
  /** Flat absolute mana cost (SpellPower.ManaCost) — mutually exclusive with
   * `pct` in every row observed so far; present only when `pct` is absent. */
  flat?: number;
}

export interface ISpellManaCostRow extends ISpellManaCostRaw {
  /** Present when this spell's SpellPower rows are gated behind a
   * spec-passive `RequiredAuraSpellID` (cost differs by casting spec) —
   * keyed by `CombatUnitSpec` id, resolved via `buildSpecNameIndex` above.
   * When both this and the base `pct`/`flat` are present, the base fields
   * are the spell's one spec-agnostic (RequiredAuraSpellID=0) row; when only
   * `bySpec` is present (e.g. Flash Heal), the spell has no unconditional
   * row at all and an unknown/unmapped spec cannot resolve a cost. */
  bySpec?: Record<string, ISpellManaCostRaw>;
}

/**
 * PascalCase word-split: inserts a space at every lowercase→uppercase
 * boundary (`"DeathKnight"` → `"Death Knight"`, `"BeastMastery"` →
 * `"Beast Mastery"`, `"Paladin"` → `"Paladin"` unchanged — no internal
 * boundary). Purely mechanical string transform, no game knowledge.
 */
function spaceCamel(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/**
 * A `CombatUnitSpec` enum KEY (e.g. `"DemonHunter_Havoc"`, always
 * `<Class>_<Spec>`) → the DB2 `Spell.Name_lang` text its class/spec-passive
 * scaling aura uses (`"Havoc Demon Hunter"` — spec label first, class label
 * second, both PascalCase word-split). `null` for a key with no underscore
 * (the enum's `None = "0"` sentinel, not a real class/spec pair).
 */
export function specKeyToDb2Name(key: string): string | null {
  const us = key.indexOf("_");
  if (us === -1) return null;
  const classPart = key.slice(0, us);
  const specPart = key.slice(us + 1);
  return `${spaceCamel(specPart)} ${spaceCamel(classPart)}`;
}

/**
 * DB2 `Spell.Name_lang` text (e.g. `"Holy Priest"`) → `CombatUnitSpec` id
 * (e.g. `"257"`), built once, mechanically, from every entry of the
 * officially-generated `CombatUnitSpec` enum — no hand-typed name↔spec pair
 * anywhere. Exported so `spellManaCost.test.ts` can assert the derivation
 * itself against the review's 3 spot-checked pairs, independent of the live
 * `spellNames.json` data.
 */
export function buildSpecNameIndex(): Map<string, string> {
  const idx = new Map<string, string>();
  for (const [key, value] of Object.entries(CombatUnitSpec)) {
    const name = specKeyToDb2Name(key);
    if (name) idx.set(name, value);
  }
  return idx;
}

export const SPEC_NAME_TO_ID = buildSpecNameIndex();

function costEntry(row: Record<string, string>): ISpellManaCostRaw {
  const pct = Number(row.PowerCostPct);
  const flat = Number(row.ManaCost);
  const entry: ISpellManaCostRaw = {};
  if (Number.isFinite(pct) && pct > 0) entry.pct = pct;
  if (Number.isFinite(flat) && flat > 0) entry.flat = flat;
  return entry;
}

/**
 * The core transform, taking already-parsed rows (same reuse-the-parse
 * shape as `genMitigation.ts`'s `transformMitigationRows`).
 *
 * `auraNameById` is `spellNames.json` (already-mined `SpellName` table,
 * `genSpellNames.ts` — reused, not re-fetched): each conditional row's
 * `RequiredAuraSpellID` is looked up here to get that aura's own official
 * name, which is then resolved to a spec id via `SPEC_NAME_TO_ID`. A row
 * whose aura id has no name in `auraNameById`, or whose name matches no
 * derived spec label (e.g. `"Initial Priest"`), is skipped with a console
 * warning and returned in `skippedAuras` — never guessed.
 */
export function transformSpellManaCostRows(
  rows: Record<string, string>[],
  observedIds: ReadonlySet<string>,
  auraNameById: Record<string, string>,
): { table: Record<string, ISpellManaCostRow>; skippedAuras: string[] } {
  const bySpell = new Map<string, Record<string, string>[]>();
  for (const row of rows) {
    if (row.PowerType !== "0") continue; // mana only
    const sid = row.SpellID;
    if (!sid || !observedIds.has(sid)) continue;
    const arr = bySpell.get(sid) ?? [];
    arr.push(row);
    bySpell.set(sid, arr);
  }

  const table: Record<string, ISpellManaCostRow> = {};
  const skippedAuras = new Set<string>();
  for (const [sid, spellRows] of bySpell) {
    const unconditional = spellRows.filter(
      (r) => r.RequiredAuraSpellID === "0",
    );
    const conditional = spellRows.filter((r) => r.RequiredAuraSpellID !== "0");
    const entry: ISpellManaCostRow = {};
    if (unconditional.length > 0) {
      Object.assign(entry, costEntry(unconditional[0]!));
    }
    if (conditional.length > 0) {
      const bySpec: Record<string, ISpellManaCostRaw> = {};
      for (const row of conditional) {
        const auraId = row.RequiredAuraSpellID;
        const auraName = auraNameById[auraId];
        const specId = auraName ? SPEC_NAME_TO_ID.get(auraName) : undefined;
        if (!specId) {
          // Unmapped aura (e.g. "Initial <Class>", the no-spec-chosen
          // placeholder, or any name that doesn't match a derived spec
          // label) — skip this ROW only, never guess a spec for it.
          skippedAuras.add(auraId);
          continue;
        }
        bySpec[specId] = costEntry(row);
      }
      if (Object.keys(bySpec).length > 0) entry.bySpec = bySpec;
    }
    const hasAnything =
      entry.pct !== undefined || entry.flat !== undefined || entry.bySpec;
    if (!hasAnything) continue;
    table[sid] = entry;
  }
  return { table, skippedAuras: [...skippedAuras].sort() };
}

export async function main(): Promise<void> {
  const build = await resolveBuild(process.argv[2]);
  const cacheDir = process.env.DATAGEN_CACHE ?? undefined;
  const dataDir = new URL("../../src/data/", import.meta.url).pathname;
  const observed = new Set(
    (
      JSON.parse(
        fs.readFileSync(dataDir + "observedSpellIdsGenerated.json", "utf8"),
      ) as number[]
    ).map(String),
  );
  const auraNameById = JSON.parse(
    fs.readFileSync(dataDir + "spellNames.json", "utf8"),
  ) as Record<string, string>;
  const parsed = parseCsv(await fetchTable("SpellPower", build, cacheDir));
  assertMinRows(parsed.rows, 1000, "SpellPower");
  assertColumns(
    parsed.header,
    ["SpellID", "PowerType", "PowerCostPct", "ManaCost", "RequiredAuraSpellID"],
    "SpellPower",
  );
  const { table, skippedAuras } = transformSpellManaCostRows(
    parsed.rows,
    observed,
    auraNameById,
  );
  for (const auraId of skippedAuras) {
    console.warn(
      `spellManaCost: RequiredAuraSpellID ${auraId} ("${auraNameById[auraId] ?? "<no name>"}")` +
        ` did not resolve to a known spec — every row gated behind it was skipped`,
    );
  }
  const outPath = new URL(
    "../../src/data/spellManaCostGenerated.json",
    import.meta.url,
  ).pathname;
  // small table; pretty-printing keeps the diff human-reviewable
  writeArtifact(outPath, `${JSON.stringify({ entries: table }, null, 2)}\n`);
  console.log(
    `spellManaCostGenerated.json: ${Object.keys(table).length} spells,` +
      ` ${skippedAuras.length} distinct unmapped auras (build ${build})`,
  );
}

if (
  typeof process !== "undefined" &&
  process.argv &&
  process.argv[1]?.endsWith("genSpellManaCost.ts")
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

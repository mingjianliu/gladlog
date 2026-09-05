/**
 * SimulationCraft hotfix overlay — the live Blizzard hotfixes that wago's
 * client-build CSVs cannot carry (BACKLOG #41 (3), 2026-09-04).
 *
 * Why: PvP tuning ships as hotfixes between client builds, weekly. wago.tools
 * exports the client files, so its `SpellEffect` at 12.1.0.69587 still says
 * Power Word: Shield PvpMultiplier = 1.0 while the live value is 1.15 (the
 * `hotfixes=` query parameter is ignored — verified 2026-09-04). SimC's
 * `dbc_extract3` merges the client's hotfix cache into its generated data and
 * lists every hotfix with its old and new value in three arrays inside
 * `engine/dbc/generated/sc_spell_data.inc`:
 *
 *   static constexpr std::array<hotfix::client_hotfix_entry_t, N> __spell_hotfix_data  {{ { spellId, fieldId, flags, flags }, … }}
 *   static constexpr std::array<hotfix::client_hotfix_entry_t, N> __effect_hotfix_data {{ { effectId, fieldId, old, new }, … }}
 *   static constexpr std::array<hotfix::client_hotfix_entry_t, N> __power_hotfix_data  {{ { powerId, fieldId, old, new }, … }}
 *
 * plus `client_data_version.inc` with the client build and the hotfix
 * date/hash the arrays were generated from. Effect ids map to spell ids
 * through the `__spelleffect_data` rows (`{ effectId, spellId, … }`).
 *
 * The field ids are positions in SimC's `spelleffect_data_t`, not DB2 column
 * names. The mapping below was derived EMPIRICALLY on 2026-09-04 by matching
 * each hotfix's OLD value against the 69404 CSV row of the same effect id
 * (scratchpad simc_field_map.js): 27 → PvpMultiplier (20/22 rows equal, the
 * other 2 are build deltas), 14 → EffectBasePointsF (61/73), 24 →
 * ImplicitTarget_0 (4/4), 29 → EffectAttributes (4/4), 5 → EffectAura (1/1),
 * 10 → BonusCoefficientFromAP (10/16 — SimC's `_m_coeff`; the rest are
 * spell-power rows this column does not hold). Fields with one ambiguous
 * sample (15, 16) stay unmapped and are kept verbatim in `unmapped` so nothing
 * is silently dropped. `fetchSimcHotfixes.ts` re-verifies the mapping on every
 * run (old-value match rate per field) and fails if the two fields the product
 * consumes — PvpMultiplier and EffectBasePointsF — drift below 50 %.
 *
 * Reading the overlay is generation-time only: `applyHotfixOverlay` patches
 * the parsed SpellEffect rows before a generator derives anything, so the
 * artifacts in src/data carry live numbers and the product never sees SimC.
 */
import fs from "fs-extra";
import path from "path";

/** SimC spelleffect_data_t field id → DB2 SpellEffect CSV column. */
export const SIMC_EFFECT_FIELD_COLUMNS: Readonly<Record<number, string>> = {
  5: "EffectAura",
  10: "BonusCoefficientFromAP",
  14: "EffectBasePointsF",
  24: "ImplicitTarget_0",
  27: "PvpMultiplier",
  29: "EffectAttributes",
};

/** The two columns the product's generators actually turn into numbers. */
export const HOTFIX_GUARDED_COLUMNS = ["PvpMultiplier", "EffectBasePointsF"];

export interface ISimcHotfixEntry {
  id: number;
  field: number;
  old: number;
  new: number;
}

export interface ISimcSpellData {
  /** Client build the generated data was extracted from ("12.1.0.69587"). */
  build: string;
  /** effect id → spell id, from __spelleffect_data. */
  effectSpell: Map<number, number>;
  effectHotfixes: ISimcHotfixEntry[];
  /** Spell-table hotfixes are flag fields in SimC (no numeric old/new). */
  spellHotfixIds: number[];
  powerHotfixes: ISimcHotfixEntry[];
}

export interface ISimcClientVersion {
  build: string;
  hotfixDate: string;
  hotfixBuild: string;
  hotfixHash: string;
}

export interface IHotfixOverlayEffect {
  spellId: number;
  /** DB2 column → live value. */
  columns: Record<string, number>;
  /** Fields with no verified column mapping, kept verbatim. */
  unmapped: Array<{ field: number; old: number; new: number }>;
}

export interface IHotfixOverlay {
  meta: {
    source: "simulationcraft";
    branch: string;
    commit: string;
    clientBuild: string;
    hotfixDate: string;
    hotfixBuild: string;
    hotfixHash: string;
    fetchedAt: string;
    fieldColumns: Record<string, string>;
  };
  effects: Record<string, IHotfixOverlayEffect>;
  spellHotfixIds: number[];
  powerHotfixes: ISimcHotfixEntry[];
}

const NUM = String.raw`(-?\d+(?:\.\d+)?)`;

function section(src: string, arrayName: string): string {
  const at = src.indexOf(arrayName);
  if (at < 0) throw new Error(`sc_spell_data.inc: ${arrayName} not found`);
  const open = src.indexOf("{", at);
  // the array body ends at the first "};" after the opening brace
  const close = src.indexOf("};", open);
  if (open < 0 || close < 0)
    throw new Error(`sc_spell_data.inc: ${arrayName} body not delimited`);
  return src.slice(open, close);
}

export function parseSimcSpellData(src: string): ISimcSpellData {
  const buildMatch = src.match(/wow build level (\d+\.\d+\.\d+\.\d+)/);
  if (!buildMatch) throw new Error("sc_spell_data.inc: build level not found");

  const effectSpell = new Map<number, number>();
  const effSec = section(src, "__spelleffect_data[");
  for (const m of effSec.matchAll(/\{\s*(\d+),\s*(\d+),/g))
    effectSpell.set(Number(m[1]), Number(m[2]));
  if (effectSpell.size < 10000)
    throw new Error(
      `sc_spell_data.inc: only ${effectSpell.size} effect rows parsed`,
    );

  const numeric = (name: string): ISimcHotfixEntry[] =>
    [
      ...section(src, name).matchAll(
        new RegExp(
          String.raw`\{\s*(\d+),\s*(\d+),\s*${NUM},\s*${NUM}\s*\}`,
          "g",
        ),
      ),
    ].map((m) => ({
      id: Number(m[1]),
      field: Number(m[2]),
      old: Number(m[3]),
      new: Number(m[4]),
    }));

  const spellHotfixIds = [
    ...section(src, "__spell_hotfix_data").matchAll(/\{\s*(\d+),\s*(\d+),/g),
  ].map((m) => Number(m[1]));

  return {
    build: buildMatch[1]!,
    effectSpell,
    effectHotfixes: numeric("__effect_hotfix_data"),
    spellHotfixIds: [...new Set(spellHotfixIds)].sort((a, b) => a - b),
    powerHotfixes: numeric("__power_hotfix_data"),
  };
}

export function parseClientDataVersion(src: string): ISimcClientVersion {
  const pick = (re: RegExp, what: string): string => {
    const m = src.match(re);
    if (!m) throw new Error(`client_data_version.inc: ${what} not found`);
    return m[1]!;
  };
  return {
    build: pick(
      /CLIENT_DATA_WOW_VERSION\s+"([^"]+)"/,
      "CLIENT_DATA_WOW_VERSION",
    ),
    hotfixDate: pick(
      /CLIENT_DATA_HOTFIX_DATE\s+"([^"]+)"/,
      "CLIENT_DATA_HOTFIX_DATE",
    ),
    hotfixBuild: pick(
      /CLIENT_DATA_HOTFIX_BUILD\s+\((\d+)\)/,
      "CLIENT_DATA_HOTFIX_BUILD",
    ),
    hotfixHash: pick(
      /CLIENT_DATA_HOTFIX_HASH\s+"([^"]+)"/,
      "CLIENT_DATA_HOTFIX_HASH",
    ),
  };
}

export function buildHotfixOverlay(
  data: ISimcSpellData,
  version: ISimcClientVersion,
  origin: { branch: string; commit: string; fetchedAt: string },
): IHotfixOverlay {
  const effects: Record<string, IHotfixOverlayEffect> = {};
  for (const h of data.effectHotfixes) {
    const spellId = data.effectSpell.get(h.id);
    if (spellId === undefined) continue; // an effect SimC's own table does not carry
    const e = (effects[String(h.id)] ??= {
      spellId,
      columns: {},
      unmapped: [],
    });
    const col = SIMC_EFFECT_FIELD_COLUMNS[h.field];
    if (col) e.columns[col] = h.new;
    else e.unmapped.push({ field: h.field, old: h.old, new: h.new });
  }
  return {
    meta: {
      source: "simulationcraft",
      branch: origin.branch,
      commit: origin.commit,
      clientBuild: version.build,
      hotfixDate: version.hotfixDate,
      hotfixBuild: version.hotfixBuild,
      hotfixHash: version.hotfixHash,
      fetchedAt: origin.fetchedAt,
      fieldColumns: Object.fromEntries(
        Object.entries(SIMC_EFFECT_FIELD_COLUMNS).map(([k, v]) => [k, v]),
      ),
    },
    effects,
    spellHotfixIds: data.spellHotfixIds,
    powerHotfixes: data.powerHotfixes,
  };
}

export interface IHotfixApplyStats {
  /** Column writes performed. */
  applied: number;
  /** Overlay effects whose id has no row in the CSV (build mismatch). */
  missingRows: number;
  /** Rows touched. */
  rowsTouched: number;
}

/**
 * Patch parsed SpellEffect rows in place with the overlay's live values.
 * `rows` are keyed by their `ID` column (the effect id). Idempotent.
 */
export function applyHotfixOverlay(
  rows: Record<string, string>[],
  overlay: IHotfixOverlay | null | undefined,
): IHotfixApplyStats {
  const stats: IHotfixApplyStats = {
    applied: 0,
    missingRows: 0,
    rowsTouched: 0,
  };
  if (!overlay) return stats;
  const byId = new Map<string, Record<string, string>>();
  for (const r of rows) if (r.ID !== undefined) byId.set(r.ID, r);
  for (const [effectId, e] of Object.entries(overlay.effects)) {
    const row = byId.get(effectId);
    if (!row) {
      stats.missingRows++;
      continue;
    }
    let touched = false;
    for (const [col, value] of Object.entries(e.columns)) {
      if (!(col in row)) continue;
      row[col] = String(value);
      stats.applied++;
      touched = true;
    }
    if (touched) stats.rowsTouched++;
  }
  return stats;
}

export const HOTFIX_OVERLAY_FILE = "hotfixOverlayGenerated.json";

/**
 * The overlay every SpellEffect-reading generator applies. Absent file → no
 * overlay (a fresh checkout before `fetchSimcHotfixes.ts` ran still works);
 * `DATAGEN_NO_HOTFIX=1` → skipped on purpose (to regenerate client-build-only
 * numbers for a diff).
 */
export function loadHotfixOverlay(dataDir: string): IHotfixOverlay | null {
  if (process.env.DATAGEN_NO_HOTFIX === "1") return null;
  const file = path.join(dataDir, HOTFIX_OVERLAY_FILE);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as IHotfixOverlay;
}

/** Repo-standard data dir for a script under scripts/datagen/. */
export function dataDirOf(importMetaUrl: string): string {
  return path.resolve(new URL("../../src/data/", importMetaUrl).pathname);
}

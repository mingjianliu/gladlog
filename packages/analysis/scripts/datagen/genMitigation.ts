import spellIdLists from "../../src/data/spellIdLists";
import { writeArtifact } from "./lib/emit";
import { PVP_MULTIPLIER_COLUMN, pvpBasePoints } from "./lib/pvpMultiplier";
import {
  applyHotfixOverlay,
  dataDirOf,
  loadHotfixOverlay,
} from "./lib/simcHotfix";
import {
  assertColumns,
  assertMinRows,
  fetchLatestBuild,
  fetchTable,
  parseCsv,
} from "./lib/wagoCsv";

/** AURA_MOD_DAMAGE_PERCENT_TAKEN: EffectBasePointsF is a negative percentage,
 * EffectMiscValue_0 is the school mask (same bit meaning as the log's
 * spellSchoolId). The percentage is scaled by `PvpMultiplier` (lib/pvpMultiplier.ts,
 * user ruling 2026-09-04: the PvP value is the official value — Divine
 * Protection −20 × 1.75 = 35 %). */
const MITIGATION_AURA = "87";

export interface IMitigationRaw {
  pct: number;
  schoolMask: number;
}

/**
 * The core transform, taking already-parsed rows — main() has to parse once
 * anyway for the row-count and column assertions, so it reuses those rows
 * instead of letting transformMitigation parse the same csv a second time
 * (main() in genMitigation used to call parseCsv twice, see fix round 3).
 */
function transformMitigationRows(
  rows: Record<string, string>[],
  whitelistIds: ReadonlySet<string>,
): {
  entries: Record<string, IMitigationRaw>;
  unresolved: Array<{ id: string; reason: string }>;
} {
  const seen = new Map<string, IMitigationRaw[]>();
  for (const row of rows) {
    if (row.DifficultyID !== "0") continue;
    if (row.EffectAura !== MITIGATION_AURA) continue;
    const id = row.SpellID;
    if (!whitelistIds.has(id)) continue;
    const points = pvpBasePoints(row);
    const mask = Number(row.EffectMiscValue_0);
    const arr = seen.get(id) ?? [];
    // keep the raw sign for now; it is judged during convergence
    arr.push({ pct: points, schoolMask: mask });
    seen.set(id, arr);
  }
  const entries: Record<string, IMitigationRaw> = {};
  const unresolved: Array<{ id: string; reason: string }> = [];
  for (const [id, hits] of seen) {
    const uniq = [...new Set(hits.map((h) => `${h.pct}:${h.schoolMask}`))];
    if (uniq.length > 1) {
      unresolved.push({ id, reason: "multiple-conflicting-87-rows" });
      continue;
    }
    const h = hits[0]!;
    if (h.pct >= 0) {
      unresolved.push({ id, reason: "non-negative-points" });
      continue;
    }
    entries[id] = {
      pct: Math.abs(Math.round(h.pct)),
      schoolMask: h.schoolMask,
    };
  }
  return { entries, unresolved };
}

/** The public export contract is unchanged (tests pass csvText); internally it
 * delegates to transformMitigationRows. */
export function transformMitigation(
  csvText: string,
  whitelistIds: ReadonlySet<string>,
): {
  entries: Record<string, IMitigationRaw>;
  unresolved: Array<{ id: string; reason: string }>;
} {
  const { rows } = parseCsv(csvText);
  return transformMitigationRows(rows, whitelistIds);
}

export async function main(): Promise<void> {
  const build = process.env.DATAGEN_BUILD ?? (await fetchLatestBuild());
  const csv = await fetchTable("SpellEffect", build, process.env.DATAGEN_CACHE);
  const parsed = parseCsv(csv);
  // Live hotfixes on top of the client build (BACKLOG #41 (3)): the arena
  // number is base points × PvpMultiplier AFTER Blizzard's weekly tuning.
  const hf = applyHotfixOverlay(
    parsed.rows,
    loadHotfixOverlay(dataDirOf(import.meta.url)),
  );
  console.log(`hotfix overlay: ${hf.applied} writes on ${hf.rowsTouched} rows`);
  // Truncation guard: Task 1 of this plan actually hit a read that happened
  // before the background download finished (113999/628107 rows, an 18% stub)
  // — a hard lower bound on row count makes a truncated table blow up instead
  // of silently producing a wrong table.
  assertMinRows(parsed.rows, 500000, "SpellEffect");
  assertColumns(
    parsed.header,
    [
      "ID",
      "DifficultyID",
      "EffectAura",
      "EffectBasePointsF",
      "EffectMiscValue_0",
      "SpellID",
      PVP_MULTIPLIER_COLUMN,
    ],
    "SpellEffect",
  );
  const wl = new Set([
    ...spellIdLists.bigDefensiveSpellIds,
    ...spellIdLists.externalDefensiveSpellIds,
    ...spellIdLists.attributedMitigationSpellIds,
  ]);
  // Reuse the rows parsed above; do not parseCsv the same csv twice
  const r = transformMitigationRows(parsed.rows, wl);
  const outPath = new URL(
    "../../src/data/mitigationGenerated.json",
    import.meta.url,
  ).pathname;
  // small table; pretty-printing keeps the diff human-reviewable
  writeArtifact(outPath, `${JSON.stringify(r, null, 2)}\n`);
  console.log(
    `entries=${Object.keys(r.entries).length} unresolved=${r.unresolved.length}`,
    build,
  );
}

if (
  typeof process !== "undefined" &&
  process.argv &&
  process.argv[1]?.endsWith("genMitigation.ts")
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

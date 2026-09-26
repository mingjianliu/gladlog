/**
 * externalDamageExampleGen.ts — GH #91 (rule 171, split from #85) value-gate
 * example generator and measurement report. Since 2026-09-22 (value gate
 * passed, product wiring landed) the predicate lives in
 * `packages/analysis/src/utils/externalDamage.ts` and this script only
 * IMPORTS it — the `[ENEMY DEF] | during it:` annotation, the
 * burst-into-mitigation `facts.duringExternal` and the eval gate all rest on
 * the same arithmetic this report prints. Baseline (local library, 400
 * rounds, 2026-09-12): 752 observations, continues 272 / empty 210 /
 * periodic-only 74 / stops 196, X p25 0 · p50 20 · p75 65. Round 2
 * (2026-09-22): 999 observations (Life Cocoon 143, Spellwarding 56,
 * Protection 48 added), but the LIBRARY store carries no `missesOut` /
 * `absorbsIn` (40 rounds / 226 units: 0 / 0), so on this data the immune
 * and absorbed fields are always empty and `empty` is inflated (414); the
 * archive acceptance (fresh log parse) is where round 2 is measured.
 *
 * Contract (pre-registered on GH #91; change the issue before changing this):
 *   eligible aura   = observed (no inferred endpoint), ally-applied (source ≠
 *                     target), non-positional, all-school (0x7f), percentage
 *                     (pct < 100) entry of MITIGATION_TABLE; NO_MITIGATION_IDS,
 *                     shields, immunities excluded
 *   qualifying ally = landed a same-target DIRECT hit in the 3 s before apply
 *   window W        = [ceil(apply), floor(remove)) on the render grid,
 *                     truncated at either death / round end
 *   N = damage on target in W · D = damage on all enemy players in W ·
 *   X = 100·N/D (undefined when D = 0) · direct / periodic separate ·
 *   K/M = 1 s bins with damage / |W| · G = longest empty gap
 *   sign filter     = legacy damage is NEGATIVE; SPELL_ABSORBED rows POSITIVE
 *                     and skipped; pets already merged into the owner
 *
 * Usage:
 *   npx tsx packages/eval/scripts/externalDamageExampleGen.ts [--n 400] [--examples 3] [--json]
 */
import {
  ensureAnalysisData,
  externalDamageObservations,
  getUnitHpAtTimestamp,
  HP_SAMPLE_RADIUS_MS,
  type IExternalDamageObservation,
  specToString,
} from "@gladlog/analysis";
import { fmtTime } from "@gladlog/analysis/src/utils/renderGrid";
import type { ICombatUnit } from "@gladlog/parser-compat";

import {
  DEFAULT_MATCH_DIR,
  loadIndex,
  loadLegacyRound,
  pickRows,
  splitTeams,
} from "../src/explore/storeAccess";
import { argOf } from "./lib/cli";

const k = (x: number): string => `${Math.round(x / 1000)}k`;

type Obs = IExternalDamageObservation & {
  matchId: string;
  allySpec: string;
  targetHpFrom: number | null;
  targetHpTo: number | null;
};

function observe(
  matchId: string,
  legacy: any,
  friends: ICombatUnit[],
  enemies: ICombatUnit[],
): Obs[] {
  const startMs: number = legacy.startTime;
  const combat = { startTime: startMs, endTime: legacy.endTime };
  const out: Obs[] = [];
  for (const target of enemies) {
    if (!target.info) continue;
    for (const o of externalDamageObservations(target, friends, enemies, combat)) {
      const ally = friends.find((f) => f.id === o.allyId);
      out.push({
        ...o,
        matchId,
        allySpec: ally?.spec ? specToString(ally.spec) : "?",
        targetHpFrom: getUnitHpAtTimestamp(target, startMs + o.wFrom * 1000, HP_SAMPLE_RADIUS_MS),
        targetHpTo: getUnitHpAtTimestamp(target, startMs + o.wTo * 1000, HP_SAMPLE_RADIUS_MS),
      });
    }
  }
  return out;
}

function render(o: Obs): string {
  const hp = (v: number | null) => (v == null ? "?" : `${Math.round(v)}%`);
  const x = o.X == null ? "n/a" : `${o.X.toFixed(0)} %`;
  const abs = o.absorbed >= 500 ? ` (+${k(o.absorbed)} absorbed)` : "";
  return [
    `# ${o.matchId}  ${o.allyName} (${o.allySpec}) → ${o.targetName}  [${o.kind}]`,
    `${fmtTime(o.applyS)}  [EXTERNAL]     ${o.mitName} (${o.mitPct} %) by ${o.srcName} on ${o.targetName}; ${o.allyName} had hit them ${k(o.preDirect)} in the 3 s before`,
    `${fmtTime(o.wFrom)}  [STATE]        ${o.targetName} ${hp(o.targetHpFrom)}`,
    `${fmtTime(o.wFrom)}–${fmtTime(o.wTo)}  [DURING EXTERNAL] ${o.allyName}: ${k(o.nDirect + o.nPeriodic)} on ${o.targetName}${abs} (${x} of their damage on enemy players; direct ${k(o.nDirect)} / periodic ${k(o.nPeriodic)}); damage in ${o.K} of ${o.M} s, longest gap ${o.G} s`,
    `${fmtTime(o.wTo)}  [STATE]        ${o.targetName} ${hp(o.targetHpTo)}`,
  ].join("\n");
}

async function main(): Promise<void> {
  await ensureAnalysisData();
  const limit = argOf("--n", 400);
  const nEx = argOf("--examples", 3);
  const rows = pickRows(loadIndex(DEFAULT_MATCH_DIR), {
    minDurationS: 60,
  }).slice(0, limit);
  const all: Obs[] = [];
  let rounds = 0;
  for (const meta of rows) {
    let legacy;
    try {
      ({ legacy } = loadLegacyRound(DEFAULT_MATCH_DIR, meta.id));
    } catch {
      continue;
    }
    const { friends, enemies } = splitTeams(legacy);
    rounds++;
    all.push(...observe(meta.id, legacy, friends, enemies));
  }
  const byKind = new Map<string, number>();
  for (const o of all) byKind.set(o.kind, (byKind.get(o.kind) ?? 0) + 1);
  const withX = all.filter((o) => o.X != null).map((o) => o.X!);
  withX.sort((a, b) => a - b);
  const q = (p: number) =>
    withX.length
      ? withX[Math.floor(p * (withX.length - 1))]!.toFixed(0)
      : "n/a";
  const byMit = new Map<string, number>();
  for (const o of all) byMit.set(o.mitName, (byMit.get(o.mitName) ?? 0) + 1);
  if (process.argv.includes("--json")) {
    console.log(
      JSON.stringify(
        {
          rounds,
          n: all.length,
          byKind: Object.fromEntries(byKind),
          byMit: Object.fromEntries(byMit),
          obs: all,
        },
        null,
        1,
      ),
    );
    return;
  }
  console.log(
    `rounds ${rounds} · qualifying (ally, external-on-target) observations ${all.length}`,
  );
  console.log(`by kind:`, Object.fromEntries(byKind));
  console.log(
    `X (share of the ally's enemy-player damage that went on the protected target): p25 ${q(0.25)} · p50 ${q(0.5)} · p75 ${q(0.75)} (n=${withX.length})`,
  );
  console.log(
    `by mitigation:`,
    Object.fromEntries(
      [...byMit.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
    ),
  );
  console.log("\n=== examples (deterministic renderings, no model) ===\n");
  const pick = (kind: Obs["kind"]) =>
    all
      .filter((o) => o.kind === kind && o.M >= 4)
      .sort((a, b) => b.M - a.M || (b.X ?? 0) - (a.X ?? 0))
      .slice(0, nEx);
  for (const kind of ["continues", "stops", "periodic-only"] as const) {
    for (const o of pick(kind)) console.log(render(o), "\n");
  }
}

if (
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")
) {
  void main();
}

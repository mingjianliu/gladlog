/**
 * externalDamageExampleGen.ts — GH #91 (rule 171, split from #85) value-gate
 * example generator. THROWAWAY in the offcdExampleGen.ts sense: it exists to
 * put three real, deterministically rendered examples in front of the user
 * before any product wiring, and to print the pre-registered measurement so
 * the numbers on the issue are reproducible.
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
  getUnitHpAtTimestamp,
  HP_SAMPLE_RADIUS_MS,
  MITIGATION_TABLE,
  NO_MITIGATION_IDS,
} from "@gladlog/analysis";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import { buildAuraIntervals } from "@gladlog/analysis/src/utils/auraIntervals";
import type { ICombatUnit } from "@gladlog/parser-compat";

import {
  DEFAULT_MATCH_DIR,
  loadIndex,
  loadLegacyRound,
  pickRows,
  splitTeams,
} from "../src/explore/storeAccess";

const PRE_HIT_S = 3;
const DIRECT = new Set(["SPELL_DAMAGE", "SWING_DAMAGE", "RANGE_DAMAGE"]);
const PERIODIC = "SPELL_PERIODIC_DAMAGE";

function argOf(flag: string, dflt: number): number {
  const i = process.argv.indexOf(flag);
  if (i < 0) return dflt;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}
const fmtTime = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const k = (x: number): string => `${Math.round(x / 1000)}k`;

function eligibleMitigation(spellId: string): { pct: number } | null {
  if (NO_MITIGATION_IDS.has(spellId)) return null;
  const e = (MITIGATION_TABLE as Record<string, any>)[spellId];
  if (!e) return null;
  if (e.positional) return null;
  if (e.pct >= 100) return null; // immunity
  if ((e.schoolMask & 0x7f) !== 0x7f) return null; // school-limited
  return { pct: e.pct };
}

interface Obs {
  matchId: string;
  ally: string;
  allySpec: string;
  target: string;
  mit: string;
  mitPct: number;
  src: string;
  applyS: number;
  removeS: number;
  wFrom: number;
  wTo: number;
  M: number;
  K: number;
  G: number;
  nDirect: number;
  nPeriodic: number;
  dAll: number;
  X: number | null;
  preDirect: number;
  targetHpFrom: number | null;
  targetHpTo: number | null;
  kind: "continues" | "stops" | "periodic-only" | "empty";
}

function classify(o: Omit<Obs, "kind">): Obs["kind"] {
  if (o.nDirect === 0 && o.nPeriodic === 0) return "empty";
  if (o.nDirect === 0) return "periodic-only";
  return o.K / Math.max(o.M, 1) >= 0.5 ? "continues" : "stops";
}

function observe(
  matchId: string,
  legacy: any,
  friends: ICombatUnit[],
  enemies: ICombatUnit[],
): Obs[] {
  const out: Obs[] = [];
  const startMs: number = legacy.startTime;
  const endS = (legacy.endTime - startMs) / 1000;
  const enemyIds = new Set(enemies.map((e) => e.id));
  const deathS = (u: ICombatUnit): number | null => {
    const d = u.deathRecords?.[0]?.timestamp;
    return d ? (d - startMs) / 1000 : null;
  };
  for (const target of enemies) {
    if (!target.info) continue;
    for (const iv of buildAuraIntervals(target, legacy)) {
      const mit = eligibleMitigation(iv.spellId);
      if (!mit) continue;
      if (iv.inferredStart || iv.inferredEnd) continue;
      if (iv.srcUnitName === target.name) continue; // self-applied → not an external
      const applyS = iv.fromS;
      const removeS = iv.toS;
      const tDeath = deathS(target);
      const wToTarget = Math.floor(Math.min(removeS, endS, tDeath ?? Infinity));
      const wFrom = Math.ceil(applyS);
      if (wToTarget <= wFrom) continue;
      for (const ally of friends) {
        if (!ally.info) continue;
        const aDeath = deathS(ally);
        // Per-ally truncation (the ally's own death), never carried over to the
        // next ally — `wToTarget` stays the target-side bound.
        const wTo = Math.min(wToTarget, Math.floor(aDeath ?? Infinity));
        if (wTo <= wFrom) continue;
        let preDirect = 0;
        let nDirect = 0;
        let nPeriodic = 0;
        let dAll = 0;
        const bins = new Set<number>();
        for (const d of ally.damageOut) {
          const ev = d.logLine.event as string;
          if (ev === "SPELL_ABSORBED" || d.effectiveAmount >= 0) continue;
          if (!enemyIds.has(d.destUnitId)) continue;
          const tS = (d.logLine.timestamp - startMs) / 1000;
          const amt = -d.effectiveAmount;
          const onTarget = d.destUnitId === target.id;
          if (
            onTarget &&
            DIRECT.has(ev) &&
            tS >= applyS - PRE_HIT_S &&
            tS < applyS
          ) {
            preDirect += amt;
          }
          if (tS < wFrom || tS >= wTo) continue;
          dAll += amt;
          if (!onTarget) continue;
          if (DIRECT.has(ev)) nDirect += amt;
          else if (ev === PERIODIC) nPeriodic += amt;
          else continue;
          bins.add(Math.floor(tS));
        }
        if (preDirect <= 0) continue; // not a qualifying ally
        const M = wTo - wFrom;
        const K = bins.size;
        let G = 0;
        let run = 0;
        for (let s = wFrom; s < wTo; s++) {
          if (bins.has(s)) run = 0;
          else G = Math.max(G, ++run);
        }
        const base = {
          matchId,
          ally: ally.name,
          allySpec: String(ally.spec ?? "?"),
          target: target.name,
          mit: getEnglishSpellName(iv.spellId, iv.spellName),
          mitPct: mit.pct,
          src: iv.srcUnitName,
          applyS,
          removeS,
          wFrom,
          wTo,
          M,
          K,
          G,
          nDirect,
          nPeriodic,
          dAll,
          X: dAll > 0 ? (100 * (nDirect + nPeriodic)) / dAll : null,
          preDirect,
          targetHpFrom: getUnitHpAtTimestamp(
            target,
            startMs + wFrom * 1000,
            HP_SAMPLE_RADIUS_MS,
          ),
          targetHpTo: getUnitHpAtTimestamp(
            target,
            startMs + wTo * 1000,
            HP_SAMPLE_RADIUS_MS,
          ),
        };
        out.push({ ...base, kind: classify(base) });
      }
    }
  }
  return out;
}

function render(o: Obs): string {
  const hp = (v: number | null) => (v == null ? "?" : `${Math.round(v)}%`);
  const x = o.X == null ? "n/a" : `${o.X.toFixed(0)} %`;
  return [
    `# ${o.matchId}  ${o.ally} (${o.allySpec}) → ${o.target}  [${o.kind}]`,
    `${fmtTime(o.wFrom)}  [STATE]        ${o.target} ${hp(o.targetHpFrom)}`,
    `${fmtTime(o.applyS)}  [EXTERNAL]     ${o.mit} (${o.mitPct} %) by ${o.src} on ${o.target}; ${o.ally} had hit them ${k(o.preDirect)} in the 3 s before`,
    `${fmtTime(o.wFrom)}–${fmtTime(o.wTo)}  [DURING EXTERNAL] ${o.ally}: ${k(o.nDirect + o.nPeriodic)} on ${o.target} (${x} of their damage on enemy players; direct ${k(o.nDirect)} / periodic ${k(o.nPeriodic)}); damage in ${o.K} of ${o.M} s, longest gap ${o.G} s`,
    `${fmtTime(o.wTo)}  [STATE]        ${o.target} ${hp(o.targetHpTo)}`,
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
  for (const o of all) byMit.set(o.mit, (byMit.get(o.mit) ?? 0) + 1);
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

/**
 * GH #78 value gate step 1 — deterministic rendering of kick-priority
 * decision points on the local library (no model call): the enemy healer's
 * heal on our low kill target inside a kill window, and whether the owner /
 * teammates could have kicked it (cooldown, lockout, official range + LoS).
 *
 *   npx tsx packages/eval/scripts/kickPriorityExampleGen.ts [--n 10] [--hp 50]
 */
import { ensureAnalysisData, specToString } from "@gladlog/analysis";
import {
  isOwnerMissedKick,
  kickPriorityDecisionPoints,
} from "@gladlog/analysis/src/analysis/candidates/kickPriority";
import { fmtTime } from "@gladlog/analysis/src/utils/renderGrid";

import {
  DEFAULT_MATCH_DIR,
  loadIndex,
  loadLegacyRound,
  pickRows,
  splitTeams,
} from "../src/explore/storeAccess";

const argv = process.argv.slice(2);
const flag = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const want = Number(flag("--n") ?? 10);
const hp = flag("--hp") ? Number(flag("--hp")) : undefined;

async function main(): Promise<void> {
  await ensureAnalysisData();
  const rows = pickRows(loadIndex(DEFAULT_MATCH_DIR), { minDurationS: 60 });
  let rounds = 0, points = 0, completed = 0, interrupted = 0, ownerMissed = 0, ownerHasKick = 0, anyFeasible = 0, shown = 0;
  const inRangeNull = { yes: 0, no: 0, null: 0 };
  for (const meta of rows) {
    let legacy: any; try { ({ legacy } = loadLegacyRound(DEFAULT_MATCH_DIR, meta.id)); } catch { continue; }
    const { friends, enemies, owner } = splitTeams(legacy); if (!owner || enemies.length === 0) continue;
    rounds++;
    let pts; try { pts = kickPriorityDecisionPoints(friends, enemies, legacy, hp ? { targetHpPct: hp } : undefined); } catch { continue; }
    for (const p of pts) {
      points++;
      if (p.outcome === "completed") completed++; else interrupted++;
      if (p.friends.some((f) => f.feasible)) anyFeasible++;
      const me = p.friends.find((f) => f.id === owner.id);
      if (me) { ownerHasKick++; inRangeNull[me.inRange === null ? "null" : me.inRange ? "yes" : "no"]++; }
      if (!isOwnerMissedKick(p, owner.id)) continue;
      ownerMissed++;
      if (shown >= want) continue;
      shown++;
      const others = p.friends.filter((f) => f.id !== owner.id && f.feasible).map((f) => f.name);
      console.log(`\n=== ${meta.id} ${meta.bracket} | owner ${specToString(owner.spec)} ===`);
      console.log(`${fmtTime(p.castStartS)} ${p.healerName} 读了 ${p.durationS.toFixed(1)}s 的 ${p.spellName} 给 ${p.targetHpPct}% 血的 ${p.targetName}(你的击杀目标,窗口 ${fmtTime(p.windowFromS)}–${fmtTime(p.windowToS)}),奶了 ${Math.round(p.healAmount / 1000)}k;你的 ${me!.kickSpellName} 空着${me!.neverObserved ? "(整场没按过)" : ""}、距离 ${me!.distanceYd == null ? "?" : Math.round(me!.distanceYd)} 码,没踢${others.length ? `;${others.join("、")} 也能踢` : ""}`);
      console.log(`  friends: ${p.friends.map((f) => `${f.name}[${f.kickSpellName} cd${f.cdRemainingS.toFixed(0)} ${f.locked ? "locked" : "free"} ${f.distanceYd == null ? "?" : Math.round(f.distanceYd)}yd ${f.inRange === null ? "range?" : f.inRange ? "inRange" : "outOfRange"}]`).join(" ")}`);
    }
  }
  console.log(`\nrounds ${rounds} | points ${points} (completed ${completed}, interrupted ${interrupted}) | any teammate feasible ${anyFeasible} | owner has a kick at ${ownerHasKick} points: inRange yes ${inRangeNull.yes} / no ${inRangeNull.no} / unknown ${inRangeNull.null} | OWNER MISSED (accusable) ${ownerMissed}`);
}
main().catch((e) => { console.error(e); process.exit(1); });

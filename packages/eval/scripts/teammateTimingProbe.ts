/**
 * GH #95 value-gate probe — teammate crises, TIMING shapes (user ruling
 * 2026-09-13: 时机掌控特别有效; plus 给重了 / 都没给 / 爆发前没提前给).
 *
 * The earlier shape ("the healer did nothing", teammateCrisisProbe.ts) found 0
 * clean cases in 7 hand-read rows. This probe asks about timing instead, on the
 * SAME bounded enemy burst windows the product's slow-defensive-response uses
 * (`burstWindowDecisionPoints`), restricted to windows whose pressured
 * friendly is a teammate of the logging healer:
 *
 *   late       the teammate crossed the crisis line (grid HP ≤ 40 %) and the
 *              first defensive for them (their own wall, the healer's external
 *              on them, the healer's major heal CD) came AFTER that second.
 *              Burst lead → crossing → defensive gives "you could have given it
 *              at the burst" and "after it happened, what you used".
 *   double     the teammate's own wall and the healer's external on them landed
 *              within DOUBLE_GAP_S of each other. NOTE the 2026-09-01
 *              over-react probe (BACKLOG, O1: ≥ 2 majors while the pressured
 *              friendly stayed ≥ 60 %) found no later-round cost; this
 *              collects examples for the user, it does not re-litigate that.
 *   none       triaged + feasible window with no defensive for the teammate
 *              from either of them (the product's slow-defensive-response
 *              family; kept for the example set).
 *
 * Nothing ships. Usage:
 *   npx tsx packages/eval/scripts/teammateTimingProbe.ts [--limit N]
 * Output: $GLADLOG_EVAL_HOME/reports/teammate-crisis-2026-09-13/timing.json
 */
import {
  ensureAnalysisData,
  isHealerSpec,
  specToString,
} from "@gladlog/analysis";
import {
  BURST_HEAL_CD_IDS,
  burstWindowDecisionPoints,
} from "@gladlog/analysis/src/analysis/burstWindowDecisionPoints";
import { CRISIS_HP_PCT_RENDERED } from "@gladlog/analysis/src/analysis/crisisDecisionPoints";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import spellIdLists from "@gladlog/analysis/src/data/spellIdLists";
import {
  gridHpPct,
  isDeadAtRenderSecond,
} from "@gladlog/analysis/src/utils/cooldowns";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

import {
  DEFAULT_MATCH_DIR,
  loadIndex,
  loadLegacyRound,
  pickRows,
  splitTeams,
} from "../src/explore/storeAccess";

const DOUBLE_GAP_S = 3;
const PRE_S = 1.5;
const WALL_IDS = new Set(spellIdLists.bigDefensiveSpellIds.map(String));
const EXTERNAL_IDS = new Set(
  spellIdLists.externalDefensiveSpellIds.map(String),
);

const argNum = (name: string, dflt: number): number => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : dflt;
};

async function main(): Promise<void> {
  await ensureAnalysisData();
  const limit = argNum("--limit", 400);
  const outDir = join(
    process.env.GLADLOG_EVAL_HOME ??
      join(process.env.HOME ?? "", "code/gladlog-eval-private"),
    "reports/teammate-crisis-2026-09-13",
  );
  mkdirSync(outDir, { recursive: true });
  const metas = pickRows(loadIndex(DEFAULT_MATCH_DIR), {
    minDurationS: 60,
  }).slice(0, limit);

  let healerRounds = 0;
  const rows: any[] = [];
  for (const meta of metas) {
    let legacy: any;
    try {
      ({ legacy } = loadLegacyRound(DEFAULT_MATCH_DIR, meta.id));
    } catch {
      continue;
    }
    const { owner, friends } = splitTeams(legacy);
    if (!owner || owner.id !== legacy.playerId || !isHealerSpec(owner.spec))
      continue;
    healerRounds++;
    const start: number = legacy.startTime;
    let windows;
    try {
      windows = burstWindowDecisionPoints(legacy, {
        friendlyReaction: (owner as any).reaction,
      });
    } catch {
      continue;
    }
    for (const w of windows) {
      const pid = w.pressured?.unitId;
      if (!pid || pid === owner.id || !w.feasible) continue;
      const mate: any = friends.find((f) => f.id === pid);
      if (!mate) continue;
      const lo = w.tMs - PRE_S * 1000;
      const hi = start + (w.endSec + 1) * 1000;
      const sec = (ms: number) => Math.floor((ms - start) / 1000);
      const name = (id: string, fallback: string) =>
        getEnglishSpellName(id) ?? fallback;

      // grid HP per whole second across the window, and the first crossing
      const hp: Array<[number, number | null]> = [];
      let crossSec: number | null = null;
      for (let s = w.tSec - 2; s <= w.endSec + 2; s++) {
        const ms = start + s * 1000;
        const v = isDeadAtRenderSecond(mate, start, s)
          ? 0
          : gridHpPct(mate, ms);
        hp.push([s, v]);
        if (
          crossSec === null &&
          s >= w.tSec &&
          s <= w.endSec &&
          v !== null &&
          v <= CRISIS_HP_PCT_RENDERED
        )
          crossSec = s;
      }

      const defs: Array<{
        who: "mate" | "healer";
        kind: "wall" | "external" | "healCd";
        spell: string;
        tSec: number;
        t: number;
      }> = [];
      for (const c of mate.spellCastEvents ?? []) {
        if (c.timestamp < lo || c.timestamp > hi) continue;
        if (c.logLine?.event !== "SPELL_CAST_SUCCESS") continue;
        const id = String(c.spellId);
        if (WALL_IDS.has(id))
          defs.push({
            who: "mate",
            kind: "wall",
            spell: name(id, c.spellName),
            tSec: sec(c.timestamp),
            t: (c.timestamp - start) / 1000,
          });
      }
      for (const c of (owner as any).spellCastEvents ?? []) {
        if (c.timestamp < lo || c.timestamp > hi) continue;
        if (c.logLine?.event !== "SPELL_CAST_SUCCESS") continue;
        const id = String(c.spellId);
        if (EXTERNAL_IDS.has(id) && c.destUnitId === mate.id)
          defs.push({
            who: "healer",
            kind: "external",
            spell: name(id, c.spellName),
            tSec: sec(c.timestamp),
            t: (c.timestamp - start) / 1000,
          });
        else if (BURST_HEAL_CD_IDS.has(id))
          defs.push({
            who: "healer",
            kind: "healCd",
            spell: name(id, c.spellName),
            tSec: sec(c.timestamp),
            t: (c.timestamp - start) / 1000,
          });
      }
      defs.sort((a, b) => a.t - b.t);
      const first = defs[0] ?? null;
      const mateWalls = defs.filter((d) => d.who === "mate");
      const healerExt = defs.filter((d) => d.kind === "external");
      const double = mateWalls.some((m) =>
        healerExt.some((e) => Math.abs(m.t - e.t) <= DOUBLE_GAP_S),
      );
      const shape =
        crossSec !== null && first && first.tSec > crossSec
          ? "late"
          : double
            ? "double"
            : !first && w.triaged
              ? "none"
              : "other";

      rows.push({
        matchId: meta.id,
        bracket: legacy.startInfo?.bracket ?? "?",
        ownerName: owner.name,
        ownerSpec: specToString(owner.spec),
        mateName: mate.name,
        mateSpec: specToString(mate.spec),
        shape,
        burstStartSec: w.tSec,
        burstEndSec: w.endSec,
        lead: `${w.leadCd.spellName} (${w.leadCd.casterName}, ${w.leadCd.casterSpec})`,
        extras: w.extraCds.map((c) => `${c.spellName}@${c.castSec}`),
        crossSec,
        defs,
        lateBySec: crossSec !== null && first ? first.tSec - crossSec : null,
        startHp: w.pressured?.startHpPct ?? null,
        minHp: w.pressured?.minHpPct ?? null,
        minHpSec: w.pressured?.minHpSec ?? null,
        died: w.pressured?.died ?? false,
        triaged: w.triaged,
        feasibleUnits: w.feasibleUnits,
        hp,
      });
    }
  }

  const count = (s: string) => rows.filter((r) => r.shape === s);
  const died = (xs: any[]) => `${xs.filter((r) => r.died).length}/${xs.length}`;
  const summary = {
    healerRounds,
    teammatePressuredFeasibleWindows: rows.length,
    late: count("late").length,
    lateDied: died(count("late")),
    lateBySecDist: count("late")
      .map((r) => r.lateBySec)
      .sort((a, b) => a - b),
    double: count("double").length,
    doubleMinHpDist: count("double")
      .map((r) => r.minHp)
      .sort((a, b) => a - b),
    none: count("none").length,
    noneDied: died(count("none")),
    other: count("other").length,
  };
  writeFileSync(
    join(outDir, "timing.json"),
    JSON.stringify({ summary, rows }, null, 1),
  );
  console.log(JSON.stringify(summary, null, 1));
}

void main();

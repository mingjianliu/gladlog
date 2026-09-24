/* eslint-disable no-console */
/**
 * losGroundTruthScan.ts — measures the arena line-of-sight model against the
 * game's own verdicts, BOTH directions, per map and per obstacle (GH #83,
 * user 2026-09-23 "地图能不能也修一下").
 *
 *  - NEGATIVES (the game says "not blocked"): a healer's SPELL_CAST_SUCCESS of
 *    a core heal on a teammate. The model saying "blocked" there is a false
 *    positive.
 *  - POSITIVES (the game says "blocked"): in 2v2 a healer has exactly one
 *    teammate, so a SPELL_CAST_FAILED of a friendly-only heal with a
 *    "target not in line of sight" reason can only have been aimed at that
 *    teammate (SPELL_CAST_FAILED carries no destination). The model saying
 *    "not blocked" there is a miss. Holy Shock / Living Flame are excluded
 *    (they can target enemies); "your vision of the target is obscured"
 *    (Smoke Bomb) is not a geometry verdict and is excluded.
 *
 * Why both: removing an obstacle trivially zeroes the false positives; only
 * the positives show whether a geometry change keeps the pillars that are
 * really there. A change is an improvement when FP falls and recall holds.
 *
 * Every blocked verdict is attributed to the obstacle(s) whose outline the
 * segment crosses, with whether an endpoint stood INSIDE an obstacle (a
 * player "inside" a solid footprint is standing on top of it — Ruins' tomb).
 *
 * Usage:
 *   npx tsx packages/eval/scripts/losGroundTruthScan.ts --manifest <txt> [--every 20] [--offset 0] [--limit 3000] [--zones 572,617] [--out rows.jsonl]
 * --out writes one JSON row per sample (zone, verdict, positions) so a
 * geometry candidate can be re-scored without re-parsing the archive
 * (`--rescore <rows.jsonl>` does exactly that against the CURRENT geometry).
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { arenaObstacles } from "@gladlog/analysis/src/data/arenaGeometry";
import { getSortedAdvancedActions } from "@gladlog/analysis/src/utils/advancedActions";
import { binarySearchClosest } from "@gladlog/analysis/src/utils/binarySearch";
import { isHealerSpec } from "@gladlog/analysis/src/utils/cooldowns";
import {
  hasLineOfSight,
  obstacleBlocksSegment,
  pointInPolygon,
} from "@gladlog/analysis/src/utils/losAnalysis";
import { HEALER_REACH_SPELLS } from "@gladlog/analysis/src/utils/spellRange";
import { GladLogParser } from "@gladlog/parser";
import {
  LogEvent,
  toLegacyMatch,
  toLegacyShuffle,
} from "@gladlog/parser-compat";
import { appendFileSync, readFileSync } from "fs";
import { gunzipSync } from "zlib";

const argv = process.argv.slice(2);
const flag = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const POS_TOL_MS = 500;
/** client languages seen in the archive (every one checked against a sample) */
const LOS_REASONS = new Set([
  "Target not in line of sight",
  "Cible hors du champ de vision",
  "目标不在视野中",
  "目標不在視野中",
  "대상이 시야에 없습니다.",
  "Ziel ist nicht im Sichtfeld.",
  "Alvo fora do campo de visão.",
]);
/** can be cast on an enemy, so a failure says nothing about the teammate */
const NOT_FRIENDLY_ONLY = new Set(["20473", "361469"]);

type Row = {
  zone: string;
  truth: "clear" | "blocked";
  a: [number, number];
  b: [number, number];
};

function pos(u: any, ms: number): [number, number] | null {
  const s: any = binarySearchClosest(
    getSortedAdvancedActions(u),
    ms,
    (x: any) => x.logLine.timestamp,
  );
  if (!s || s.advancedActorId !== u.id) return null;
  if (Math.abs(s.logLine.timestamp - ms) > POS_TOL_MS) return null;
  return [s.advancedActorPositionX, s.advancedActorPositionY];
}

type Agg = {
  clear: number;
  fp: number;
  blocked: number;
  tp: number;
  unknown: number;
  fpBy: Map<string, number>;
  tpBy: Map<string, number>;
  fpInside: number;
};
const blank = (): Agg => ({
  clear: 0,
  fp: 0,
  blocked: 0,
  tp: 0,
  unknown: 0,
  fpBy: new Map(),
  tpBy: new Map(),
  fpInside: 0,
});

function score(rows: Row[]): Map<string, Agg> {
  const by = new Map<string, Agg>();
  for (const r of rows) {
    const g = by.get(r.zone) ?? blank();
    by.set(r.zone, g);
    const los = hasLineOfSight(
      r.zone,
      { x: r.a[0], y: r.a[1] },
      { x: r.b[0], y: r.b[1] },
    );
    if (los === null) {
      g.unknown++;
      continue;
    }
    const obstacles = arenaObstacles[r.zone] ?? [];
    const hits = obstacles
      .map((o, i) =>
        obstacleBlocksSegment(o, r.a[0], r.a[1], r.b[0], r.b[1]) ? `#${i}` : "",
      )
      .filter(Boolean)
      .join("+");
    if (r.truth === "clear") {
      g.clear++;
      if (los === false) {
        g.fp++;
        g.fpBy.set(hits, (g.fpBy.get(hits) ?? 0) + 1);
        const inside = obstacles.some(
          (o) =>
            o.type === "polygon" &&
            (pointInPolygon(r.a[0], r.a[1], o.vertices) ||
              pointInPolygon(r.b[0], r.b[1], o.vertices)),
        );
        if (inside) g.fpInside++;
      }
    } else {
      g.blocked++;
      if (los === false) {
        g.tp++;
        g.tpBy.set(hits, (g.tpBy.get(hits) ?? 0) + 1);
      }
    }
  }
  return by;
}

function report(by: Map<string, Agg>): void {
  const pct = (a: number, b: number) =>
    b ? `${((100 * a) / b).toFixed(2)}%` : "–";
  console.log(
    "zone | game-clear n | model FP | FP with an endpoint inside an obstacle | game-blocked n (2v2) | model recall | unknown | FP by obstacle | TP by obstacle",
  );
  for (const [z, g] of [...by].sort((x, y) => y[1].clear - x[1].clear)) {
    const fmt = (m: Map<string, number>) =>
      [...m]
        .sort((x, y) => y[1] - x[1])
        .map(([k, n]) => `${k}:${n}`)
        .join(" ");
    console.log(
      `${z} | ${g.clear} | ${g.fp} (${pct(g.fp, g.clear)}) | ${g.fpInside} | ${g.blocked} | ${g.tp} (${pct(g.tp, g.blocked)}) | ${g.unknown} | ${fmt(g.fpBy)} | ${fmt(g.tpBy)}`,
    );
  }
}

async function main(): Promise<void> {
  const rescore = flag("--rescore");
  if (rescore) {
    const rows = readFileSync(rescore, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Row);
    const zones = flag("--zones")?.split(",");
    report(score(zones ? rows.filter((r) => zones.includes(r.zone)) : rows));
    return;
  }
  await ensureAnalysisData();
  const every = Number(flag("--every") ?? 20);
  const zones = flag("--zones")?.split(",");
  const out = flag("--out");
  const files = readFileSync(flag("--manifest")!, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((_, i) => i % every === Number(flag("--offset") ?? 0))
    .slice(0, Number(flag("--limit") ?? 3000));
  const rows: Row[] = [];
  let n = 0;
  for (const path of files) {
    n++;
    let text: string;
    try {
      const raw = readFileSync(path);
      text = (path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
    } catch {
      continue;
    }
    const combats: any[] = [];
    try {
      const parser = new GladLogParser();
      parser.on("match", (m: any) => combats.push(toLegacyMatch(m)));
      parser.on("shuffle", (sh: any) => {
        for (const r of toLegacyShuffle(sh).rounds ?? []) combats.push(r);
      });
      for (const line of text.split(/\r?\n/)) parser.push(line);
      parser.end();
    } catch {
      continue;
    }
    const fileRows: Row[] = [];
    for (const combat of combats) {
      const zone = String(combat.startInfo?.zoneId ?? "");
      if (zones && !zones.includes(zone)) continue;
      const is2v2 = combat.startInfo?.bracket === "2v2";
      const players: any[] = Object.values(combat.units ?? {}).filter(
        (u: any) => u.info,
      );
      const byId = new Map(players.map((u) => [u.id, u]));
      for (const healer of players) {
        if (!isHealerSpec(healer.spec)) continue;
        const heals = new Set(HEALER_REACH_SPELLS[String(healer.spec)] ?? []);
        if (heals.size === 0) continue;
        for (const c of (healer.spellCastEvents ?? []) as any[]) {
          if (c.logLine?.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
          if (!heals.has(String(c.spellId))) continue;
          const mate = byId.get(c.destUnitId);
          if (
            !mate ||
            mate.id === healer.id ||
            mate.reaction !== healer.reaction
          )
            continue;
          const a = pos(healer, c.timestamp);
          const b = pos(mate, c.timestamp);
          if (a && b) fileRows.push({ zone, truth: "clear", a, b });
        }
        if (!is2v2) continue;
        const mates = players.filter(
          (u) => u.reaction === healer.reaction && u.id !== healer.id,
        );
        if (mates.length !== 1) continue;
        const mate = mates[0];
        for (const e of (healer.actionOut ?? []) as any[]) {
          if (e.logLine?.event !== "SPELL_CAST_FAILED") continue;
          const sid = String(e.spellId);
          if (!heals.has(sid) || NOT_FRIENDLY_ONLY.has(sid)) continue;
          const reason = String(e.logLine?.parameters?.[11] ?? "");
          if (!LOS_REASONS.has(reason)) continue;
          if (
            (mate.deathRecords ?? []).some(
              (d: any) => d.timestamp <= e.timestamp,
            )
          )
            continue;
          const a = pos(healer, e.timestamp);
          const b = pos(mate, e.timestamp);
          if (a && b) fileRows.push({ zone, truth: "blocked", a, b });
        }
      }
    }
    rows.push(...fileRows);
    if (out && fileRows.length)
      appendFileSync(
        out,
        fileRows.map((r) => JSON.stringify(r)).join("\n") + "\n",
      );
    if (n % 200 === 0)
      console.error(`${n}/${files.length} files, ${rows.length} samples`);
  }
  console.log(`files ${files.length} · samples ${rows.length}`);
  report(score(rows));
}
void main();

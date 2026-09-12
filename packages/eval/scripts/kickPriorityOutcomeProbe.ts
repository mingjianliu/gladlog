/**
 * GH #78 — kick-priority decision points over the PvP log archive: outcome
 * contrast (kill target dead within 10 s: heal completed vs heal kicked),
 * feasibility strata, HP-gate sensitivity, and the corpus verification of the
 * melee kick range slack (distance kicker→healer at LANDED melee kicks).
 * Generates `data/kickPriorityPriorGenerated.json` (emit-table).
 *
 * Thin consumer of `kickPriorityDecisionPoints` (analysis/candidates/
 * kickPriority.ts): the scan runs the product predicate with the HP gate
 * widened to KICK_SCAN_HP_GATE so the report can stratify by the target's HP
 * (the product gate is a hypothesis — sensitivity is measured here), and
 * stores each point plus outcome-only extras. No predicate lives here.
 *
 *   npx tsx packages/eval/scripts/kickPriorityOutcomeProbe.ts scan \
 *       --manifest <file> --out <file.jsonl> [--every N] [--offset N] [--limit N]
 *   npx tsx packages/eval/scripts/kickPriorityOutcomeProbe.ts report --in <file.jsonl>
 *   npx tsx packages/eval/scripts/kickPriorityOutcomeProbe.ts emit-table --in <file.jsonl> \
 *       --corpus "<label>" > /tmp/table.json && cp /tmp/table.json packages/analysis/src/data/kickPriorityPriorGenerated.json
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import {
  type IKickPriorityPoint,
  KICK_PRIORITY_TARGET_HP_PCT,
  kickPriorityDecisionPoints,
} from "@gladlog/analysis/src/analysis/candidates/kickPriority";
import { BEHAVIOR_PRIOR_N_FLOOR } from "@gladlog/analysis/src/data/behaviorPrior";
import {
  MELEE_RANGE_YD,
  spellRangeYards,
} from "@gladlog/analysis/src/data/spellReach";
import { bracketKey } from "@gladlog/analysis/src/utils/bracketKey";
import { GladLogParser } from "@gladlog/parser";
import type { ICombatUnit } from "@gladlog/parser-compat";
import { toLegacyMatch, toLegacyShuffle } from "@gladlog/parser-compat";
import { appendFileSync, createReadStream, existsSync, readFileSync } from "fs";
import { basename } from "path";
import { createInterface } from "readline";
import { gunzipSync } from "zlib";

/** The scan's HP gate — wide, so the report can test the product's 50. */
const KICK_SCAN_HP_GATE = 70;
const OUTCOME_S = 10;
const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const num = (f: string, d: number): number => Number(flag(f) ?? d);
const pct = (a: number, b: number) =>
  b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`;
const median = (xs: number[]) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const q = (xs: number[], f: number) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * f))];
};

interface Rec {
  matchId: string;
  seq: number | null;
  bracket: string;
  p: Omit<
    IKickPriorityPoint,
    "healerName" | "targetName" | "interruptedByName" | "friends"
  > & {
    friends: Array<Omit<IKickPriorityPoint["friends"][number], "name">>;
  };
  targetDeath10: boolean;
  anyEnemyDeath10: boolean;
  /** interrupted: the kicker's distance to the healer at the kick (from the
   * matching friend entry), and whether their kick is melee-ranged */
  kickerDistanceYd: number | null;
  kickerMelee: boolean | null;
  kickerKickSpellId: string | null;
}

function scanRound(
  legacy: any,
  matchId: string,
  seq: number | null,
  bracket: string,
): Rec[] {
  const out: Rec[] = [];
  const units: ICombatUnit[] = Object.values(legacy.units ?? {});
  const players = units.filter((u) => u.info);
  const byTeam = new Map<string, ICombatUnit[]>();
  for (const p of players) {
    const tid = String(p.info?.teamId ?? "?");
    byTeam.set(tid, [...(byTeam.get(tid) ?? []), p]);
  }
  if (byTeam.size !== 2) return out;
  const startMs: number = legacy.startTime;
  for (const [tid, friends] of byTeam) {
    const enemies = [...byTeam.entries()].find(([kk]) => kk !== tid)![1];
    let points: IKickPriorityPoint[];
    try {
      points = kickPriorityDecisionPoints(friends, enemies, legacy, {
        targetHpPct: KICK_SCAN_HP_GATE,
      });
    } catch {
      continue;
    }
    for (const p of points) {
      const endMs = startMs + p.castEndS * 1000;
      const target = enemies.find((e) => e.id === p.targetId);
      const deadIn = (u: ICombatUnit | undefined) =>
        Boolean(
          u &&
          (u.deathRecords ?? []).some(
            (d) =>
              d.timestamp >= endMs && d.timestamp <= endMs + OUTCOME_S * 1000,
          ),
        );
      const kicker = p.interruptedById
        ? p.friends.find((f) => f.id === p.interruptedById)
        : undefined;
      const kickRange = kicker ? spellRangeYards(kicker.kickSpellId) : null;
      const {
        healerName: _h,
        targetName: _t,
        interruptedByName: _i,
        friends: fr,
        ...rest
      } = p;
      out.push({
        matchId,
        seq,
        bracket,
        p: { ...rest, friends: fr.map(({ name: _n, ...f }) => f) },
        targetDeath10: deadIn(target),
        anyEnemyDeath10: enemies.some((e) => deadIn(e)),
        kickerDistanceYd: kicker?.distanceYd ?? null,
        kickerMelee: kickRange == null ? null : kickRange <= MELEE_RANGE_YD,
        kickerKickSpellId: kicker?.kickSpellId ?? null,
      });
    }
  }
  return out;
}

async function scan(): Promise<void> {
  const manifestPath = flag("--manifest"),
    out = flag("--out");
  if (!manifestPath || !out) {
    console.error(
      "usage: scan --manifest <file> --out <file.jsonl> [--every N] [--offset N] [--limit N]",
    );
    process.exit(1);
  }
  await ensureAnalysisData();
  const done = new Set<string>();
  if (existsSync(out))
    for (const l of readFileSync(out, "utf8").split("\n")) {
      if (!l.trim()) continue;
      try {
        done.add(JSON.parse(l).matchId);
      } catch {
        /* torn */
      }
    }
  let files = readFileSync(manifestPath, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const every = num("--every", 1);
  if (every > 1) files = files.filter((_, i) => i % every === 0);
  const offset = num("--offset", 0);
  if (offset) files = files.slice(offset);
  const limit = num("--limit", 0);
  if (limit) files = files.slice(0, limit);
  let scanned = 0,
    rounds = 0,
    pts = 0;
  const t0 = Date.now();
  for (const path of files) {
    const matchId = basename(path).replace(/\.txt\.gz$|\.gz$|\.txt$/, "");
    if (done.has(matchId)) continue;
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
      for (const line of text.split("\n")) parser.push(line);
      parser.end();
    } catch {
      continue;
    }
    scanned++;
    let seq = 0;
    const lines: string[] = [];
    for (const legacy of combats) {
      const mySeq = combats.length > 1 ? seq++ : null;
      rounds++;
      for (const r of scanRound(
        legacy,
        matchId,
        mySeq,
        bracketKey(legacy.startInfo?.bracket ?? "") ?? "?",
      )) {
        pts++;
        lines.push(JSON.stringify(r));
      }
    }
    if (lines.length === 0)
      lines.push(JSON.stringify({ matchId, seq: null, marker: true }));
    appendFileSync(out, lines.join("\n") + "\n");
    if (scanned % 200 === 0)
      console.log(
        `scanned ${scanned}/${files.length} rounds ${rounds} points ${pts} | ${((Date.now() - t0) / 1000).toFixed(0)}s`,
      );
  }
  console.log(`done: scanned ${scanned} rounds ${rounds} points ${pts}`);
}

async function load(inPath: string): Promise<{ recs: Rec[]; files: number }> {
  const recs: Rec[] = [];
  const files = new Set<string>();
  const rl = createInterface({
    input: createReadStream(inPath),
    crlfDelay: Infinity,
  });
  for await (const l of rl) {
    if (!l.trim()) continue;
    let o: any;
    try {
      o = JSON.parse(l);
    } catch {
      continue;
    }
    files.add(o.matchId);
    if (!o.marker) recs.push(o as Rec);
  }
  return { recs, files: files.size };
}

const anyFeasible = (r: Rec) => r.p.friends.some((f) => f.feasible);
/** The reference cell: casts at the product gate where ≥ 1 friendly could
 * have kicked — the interrupted arm is then "someone did", the completed arm
 * "someone could have and nobody did". */
function cell(recs: Rec[], hpGate: number) {
  const pop = recs.filter((r) => r.p.targetHpPct <= hpGate && anyFeasible(r));
  const C = pop.filter((r) => r.p.outcome === "completed"),
    I = pop.filter((r) => r.p.outcome === "interrupted");
  return {
    nCompleted: C.length,
    nInterrupted: I.length,
    deathCompletedPct: Math.round(
      (100 * C.filter((r) => r.targetDeath10).length) / Math.max(C.length, 1),
    ),
    deathInterruptedPct: Math.round(
      (100 * I.filter((r) => r.targetDeath10).length) / Math.max(I.length, 1),
    ),
  };
}

async function report(): Promise<void> {
  const inPath = flag("--in");
  if (!inPath) {
    console.error("usage: report --in <file.jsonl>");
    process.exit(1);
  }
  const { recs, files } = await load(inPath);
  const C = recs.filter((r) => r.p.outcome === "completed"),
    I = recs.filter((r) => r.p.outcome === "interrupted");
  console.log(
    `files ${files} | points (target ≤ ${KICK_SCAN_HP_GATE}% HP, inside a kill window, healer hardcast that heals the target) ${recs.length} | completed ${C.length} | interrupted ${I.length} (${pct(I.length, recs.length)}) | rounds ${new Set(recs.map((r) => `${r.matchId}:${r.seq ?? 0}`)).size}`,
  );
  const line = (label: string, rs: Rec[]) => {
    const c = rs.filter((r) => r.p.outcome === "completed"),
      i = rs.filter((r) => r.p.outcome === "interrupted");
    console.log(
      `  ${label.padEnd(36)} completed ${String(c.length).padStart(6)} → target dead 10s ${pct(c.filter((r) => r.targetDeath10).length, c.length).padStart(6)} | kicked ${String(i.length).padStart(5)} → dead ${pct(i.filter((r) => r.targetDeath10).length, i.length).padStart(6)} | kicked share ${pct(i.length, rs.length)}`,
    );
  };
  console.log("\n=== OUTCOME by target HP at cast start (all points) ===");
  for (const [lo, hi] of [
    [0, 20],
    [20, 30],
    [30, 40],
    [40, 50],
    [50, 60],
    [60, 70],
  ] as const)
    line(
      `HP ${lo}–${hi}%`,
      recs.filter(
        (r) =>
          r.p.targetHpPct > lo - (lo === 0 ? 1 : 0) &&
          r.p.targetHpPct <= hi &&
          (lo === 0 || r.p.targetHpPct > lo),
      ),
    );
  console.log(
    "\n=== OUTCOME, points where ≥ 1 friendly was feasible (the reference population) ===",
  );
  for (const g of [30, 40, 50, 60, 70]) {
    const c = cell(recs, g);
    console.log(
      `  gate ≤${g}%: completed ${c.nCompleted} → dead ${c.deathCompletedPct}% | kicked ${c.nInterrupted} → dead ${c.deathInterruptedPct}% | contrast ${c.deathInterruptedPct - c.deathCompletedPct}pp`,
    );
  }
  console.log("\n=== by cast duration (completed, ≤ product gate) ===");
  const atGate = recs.filter(
    (r) => r.p.targetHpPct <= KICK_PRIORITY_TARGET_HP_PCT,
  );
  for (const [lo, hi] of [
    [1, 1.5],
    [1.5, 2],
    [2, 3],
    [3, 10],
  ] as const)
    line(
      `cast ${lo}–${hi}s`,
      atGate.filter((r) => r.p.durationS >= lo && r.p.durationS < hi),
    );
  console.log("\n=== feasibility at the product gate (≤50%) ===");
  const fe = atGate.filter(anyFeasible);
  console.log(
    `  points ${atGate.length} | ≥1 friendly feasible ${fe.length} (${pct(fe.length, atGate.length)}) | completed & feasible (accusable for someone) ${fe.filter((r) => r.p.outcome === "completed").length}`,
  );
  const why = { noKit: 0, cd: 0, locked: 0, outOfRange: 0, rangeUnknown: 0 };
  for (const r of atGate)
    for (const f of r.p.friends) {
      if (f.feasible) continue;
      if (f.cdRemainingS > 0) why.cd++;
      else if (f.locked) why.locked++;
      else if (f.inRange === false) why.outOfRange++;
      else why.rangeUnknown++;
    }
  console.log(
    `  infeasible friend-entries by reason: on cooldown ${why.cd} | locked ${why.locked} | out of range ${why.outOfRange} | range unknown ${why.rangeUnknown}`,
  );
  console.log(
    "\n=== melee kick range verification: kicker→healer distance at LANDED kicks ===",
  );
  const byKick = new Map<string, number[]>();
  for (const r of I)
    if (r.kickerDistanceYd != null && r.kickerKickSpellId)
      byKick.set(r.kickerKickSpellId, [
        ...(byKick.get(r.kickerKickSpellId) ?? []),
        r.kickerDistanceYd,
      ]);
  for (const [id, xs] of [...byKick].sort((a, b) => b[1].length - a[1].length))
    console.log(
      `  ${id.padEnd(8)} official ${String(spellRangeYards(id) ?? "?").padStart(3)} yd  n ${String(xs.length).padStart(5)}  p50 ${median(xs).toFixed(1)}  p90 ${q(xs, 0.9).toFixed(1)}  p95 ${q(xs, 0.95).toFixed(1)}  max ${Math.max(...xs).toFixed(1)}`,
    );
  const melee = I.filter(
    (r) => r.kickerMelee && r.kickerDistanceYd != null,
  ).map((r) => r.kickerDistanceYd!);
  console.log(
    `  melee kicks pooled n ${melee.length}: p50 ${median(melee).toFixed(1)} p90 ${q(melee, 0.9).toFixed(1)} p95 ${q(melee, 0.95).toFixed(1)} → official 5 + slack 3 = 8 yd covers ${pct(melee.filter((d) => d <= 8).length, melee.length)}`,
  );
  console.log("\n=== by bracket (≤50%, feasible) ===");
  for (const br of ["3v3", "solo", "2v2"])
    line(
      br,
      fe.filter((r) => r.bracket === br),
    );
}

async function emitTable(): Promise<void> {
  const inPath = flag("--in");
  if (!inPath) {
    console.error("usage: emit-table --in <file.jsonl> --corpus <label>");
    process.exit(1);
  }
  const { recs, files } = await load(inPath);
  const c = cell(recs, KICK_PRIORITY_TARGET_HP_PCT);
  const cells: Record<string, unknown> = {};
  if (
    c.nCompleted >= BEHAVIOR_PRIOR_N_FLOOR &&
    c.nInterrupted >= BEHAVIOR_PRIOR_N_FLOOR
  )
    cells.all = c;
  process.stdout.write(
    JSON.stringify(
      {
        meta: {
          corpus: flag("--corpus") ?? inPath,
          generatedAt: new Date().toISOString(),
          files,
          points: recs.length,
          hpGate: KICK_PRIORITY_TARGET_HP_PCT,
          generator: "kickPriorityOutcomeProbe.ts emit-table",
          nFloor: BEHAVIOR_PRIOR_N_FLOOR,
        },
        cells,
      },
      null,
      1,
    ) + "\n",
  );
}

if (cmd === "scan")
  scan().catch((e) => {
    console.error(e);
    process.exit(1);
  });
else if (cmd === "report")
  report().catch((e) => {
    console.error(e);
    process.exit(1);
  });
else if (cmd === "emit-table")
  emitTable().catch((e) => {
    console.error(e);
    process.exit(1);
  });
else {
  console.error("usage: scan | report | emit-table");
  process.exit(1);
}

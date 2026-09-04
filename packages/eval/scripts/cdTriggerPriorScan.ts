/**
 * cdTriggerPriorScan.ts — corpus scan behind the `[CD PRIOR]` context fact
 * (GH #54 (f) / BACKLOG #38 (a)(h); user ruling 2026-09-04: option 1, a
 * context fact, not a hard threshold).
 *
 * Same plumbing as `behaviorPriorScan.ts`: one row per save-cooldown press
 * of a healer owner, produced by the SHARED predicate
 * `packages/analysis/src/analysis/cdTriggerPrior.ts::cdTriggerObservations`
 * (roster = `isSpendableDefensiveCd`, HP = the [STATE] tick's `gridHpPct` of
 * the lowest alive friendly at the press's rendered second). The scan
 * computes no HP, no roster and no dedupe of its own, so the medians it
 * emits and the dips the product later quotes are readings of one
 * instrument (CLAUDE.md shared-predicate rule).
 *
 *   scan        tsx cdTriggerPriorScan.ts scan --manifest <file> --ledger <dir>
 *                 --out <file.jsonl> [--offset N] [--limit N]
 *   report      tsx cdTriggerPriorScan.ts report --in <file.jsonl> [--min-n 50]
 *                 # per spec|tree|spell: n, median (all), median (pct>=60),
 *                 # and the tree-vs-spec-wide gap — the numbers the cohort
 *                 # ruling is made on
 *   emit-table  tsx cdTriggerPriorScan.ts emit-table --in <file.jsonl>
 *                 --out <file.json> [--cohort all|hi] [--corpus <label>]
 *   roster      tsx cdTriggerPriorScan.ts roster
 *                 # the spells the CURRENT generated table can quote, with the
 *                 # official ability profile (who it reaches, what it does) —
 *                 # the list a roster ruling is made on
 * `emit-table` writes through a temp file and copies it into place: never
 * redirect `>` straight into the imported json.
 *
 * Cohort key: `${spec}|${heroTree}|${spellId}` plus a `${spec}|*|${spellId}`
 * spec-wide roll-up (every row counts once in each). `spec` is
 * `specToString`, `heroTree` is `heroBuildGroupOf` — the two functions the
 * product resolves the owner through. `pct` is the percentile within
 * (bracket, ISO week) from the archive ledger (`rankLedger`), never an
 * absolute rating (user ruling 2026-08-29); `--cohort hi` = pct >= 60.
 *
 * Baseline (2026-09-04, first run): see the GH #54 comment of that date.
 */
import {
  ensureAnalysisData,
  heroBuildGroupOf,
  isHealerSpec,
  specToString,
} from "@gladlog/analysis";
import {
  type CdTriggerObservation,
  cdTriggerObservations,
} from "@gladlog/analysis/src/analysis/cdTriggerPrior";
import { abilityProfile } from "@gladlog/analysis/src/data/abilityProfile";
import { CD_TRIGGER_PRIOR_N_FLOOR } from "@gladlog/analysis/src/data/cdTriggerPrior";
import GENERATED from "@gladlog/analysis/src/data/cdTriggerPriorGenerated.json";
import { TEAM_HEAL_CD_IDS } from "@gladlog/analysis/src/utils/cooldowns";
import { PATCH_121_GOLIVE_EPOCH_MS } from "@gladlog/analysis/src/utils/drAnalysis";
import { GladLogParser } from "@gladlog/parser";
import {
  CombatUnitReaction,
  toLegacyMatch,
  toLegacyShuffle,
} from "@gladlog/parser-compat";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { basename, dirname, join } from "path";
import { gunzipSync } from "zlib";

import { isoWeek, rankLedger } from "../src/explore/ratingPercentile";

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const num = (f: string, d: number): number => Number(flag(f) ?? d);

/** Cohort door for `--cohort hi`: percentile within (bracket, week). */
export const HI_COHORT_MIN_PCT = 60;

interface Row {
  matchId: string;
  seq: number | null;
  bracket: string;
  week: string;
  pct: number | null;
  spec: string;
  heroTree: string;
  obs: CdTriggerObservation;
}

function loadLedger(dir: string): Map<string, any> {
  const out = new Map<string, any>();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".jsonl")) continue;
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        if (r.id) out.set(String(r.id), r);
      } catch {
        /* torn */
      }
    }
  }
  return out;
}

async function scan(): Promise<void> {
  const manifestPath = flag("--manifest");
  const ledgerDir = flag("--ledger");
  const out = flag("--out");
  if (!manifestPath || !ledgerDir || !out) {
    console.error(
      "usage: scan --manifest <file> --ledger <dir> --out <file.jsonl> [--offset N] [--limit N]",
    );
    process.exit(1);
  }
  await ensureAnalysisData();
  const ledger = loadLedger(ledgerDir);
  const pctOf = rankLedger(ledger);
  const done = new Set<string>();
  if (existsSync(out)) {
    for (const l of readFileSync(out, "utf8").split("\n")) {
      if (!l.trim()) continue;
      try {
        done.add(JSON.parse(l).matchId);
      } catch {
        /* torn */
      }
    }
  }
  let files = readFileSync(manifestPath, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const offset = num("--offset", 0);
  const limit = num("--limit", 0);
  if (offset) files = files.slice(offset);
  if (limit) files = files.slice(0, limit);
  let scanned = 0;
  let oldSeason = 0;
  let rows = 0;
  for (const path of files) {
    const matchId = basename(path).replace(/\.txt\.gz$|\.gz$|\.txt$/, "");
    if (done.has(matchId)) continue;
    const meta = ledger.get(matchId);
    if (
      !meta ||
      !meta.startTime ||
      meta.startTime < PATCH_121_GOLIVE_EPOCH_MS
    ) {
      oldSeason++;
      continue;
    }
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
      const units: any[] = Object.values(legacy.units ?? {});
      const mySeq = combats.length > 1 ? seq++ : null;
      // Every healer on either side is a cohort member — the table describes
      // "how healers of this spec × tree spend", not the log recorder's team.
      const healers = units.filter(
        (u) =>
          u.info &&
          isHealerSpec(u.spec) &&
          (u.reaction === CombatUnitReaction.Friendly ||
            u.reaction === CombatUnitReaction.Hostile),
      );
      for (const owner of healers) {
        let obs: CdTriggerObservation[] = [];
        try {
          obs = cdTriggerObservations(owner, legacy);
        } catch {
          continue;
        }
        for (const o of obs) {
          const row: Row = {
            matchId,
            seq: mySeq,
            bracket: meta?.bracket ?? legacy.startInfo?.bracket ?? "?",
            week: isoWeek(meta?.startTime ?? legacy.startTime),
            pct: pctOf.get(matchId) ?? null,
            spec: specToString(owner.spec),
            heroTree: heroBuildGroupOf(owner.info?.talents),
            obs: o,
          };
          lines.push(JSON.stringify(row));
          rows++;
        }
      }
    }
    if (!lines.length) lines.push(JSON.stringify({ matchId, empty: true }));
    appendFileSync(out, lines.join("\n") + "\n");
    if (scanned % 100 === 0)
      console.error(`scanned ${scanned} (${rows} rows, ${oldSeason} pre-12.1 skipped)`);
  }
  console.error(`done: scanned ${scanned}, rows ${rows}, pre-12.1 skipped ${oldSeason}`);
}

function readRows(inPath: string): Row[] {
  const rows: Row[] = [];
  for (const l of readFileSync(inPath, "utf8").split("\n")) {
    if (!l.trim()) continue;
    try {
      const r = JSON.parse(l);
      if (!r.empty && r.obs) rows.push(r);
    } catch {
      /* torn */
    }
  }
  return rows;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

interface Agg {
  spec: string;
  heroTree: string;
  spellId: string;
  spellName: string;
  all: number[];
  hi: number[];
}

/** Group rows into `spec|tree|spell` cells plus the `spec|*|spell` roll-up. */
function aggregate(rows: Row[]): Map<string, Agg> {
  const cells = new Map<string, Agg>();
  const add = (key: string, tree: string, r: Row) => {
    let a = cells.get(key);
    if (!a) {
      a = {
        spec: r.spec,
        heroTree: tree,
        spellId: r.obs.spellId,
        spellName: r.obs.spellName,
        all: [],
        hi: [],
      };
      cells.set(key, a);
    }
    a.all.push(r.obs.lowestFriendlyHpPct);
    if (r.pct !== null && r.pct >= HI_COHORT_MIN_PCT)
      a.hi.push(r.obs.lowestFriendlyHpPct);
  };
  for (const r of rows) {
    if (r.heroTree !== "*") add(`${r.spec}|${r.heroTree}|${r.obs.spellId}`, r.heroTree, r);
    add(`${r.spec}|*|${r.obs.spellId}`, "*", r);
  }
  return cells;
}

function report(): void {
  const inPath = flag("--in");
  if (!inPath) {
    console.error("usage: report --in <file.jsonl> [--min-n N]");
    process.exit(1);
  }
  const minN = num("--min-n", CD_TRIGGER_PRIOR_N_FLOOR);
  const rows = readRows(inPath);
  const cells = aggregate(rows);
  const matches = new Set(rows.map((r) => r.matchId)).size;
  const unresolvedTree = rows.filter((r) => r.heroTree === "*").length;
  console.log(
    `rows ${rows.length} from ${matches} matches; hero tree unresolved on ${unresolvedTree} rows (${((100 * unresolvedTree) / Math.max(1, rows.length)).toFixed(1)}%)`,
  );
  console.log("");
  console.log(
    "| spec | tree | spell | n | p50 all | n hi | p50 hi | Δ hi−all | Δ tree−spec |",
  );
  console.log("|---|---|---|---|---|---|---|---|---|");
  const keys = [...cells.keys()].sort();
  let treeCells = 0;
  let treeCellsDiverge = 0;
  let hiDiverge = 0;
  let hiCells = 0;
  for (const k of keys) {
    const a = cells.get(k)!;
    if (a.all.length < minN) continue;
    const specWide = cells.get(`${a.spec}|*|${a.spellId}`);
    const p50 = Math.round(median(a.all));
    const p50hi = a.hi.length >= minN ? Math.round(median(a.hi)) : null;
    const dHi = p50hi === null ? "" : String(p50hi - p50);
    const dTree =
      a.heroTree === "*" || !specWide
        ? ""
        : String(p50 - Math.round(median(specWide.all)));
    if (a.heroTree !== "*") {
      treeCells++;
      if (dTree !== "" && Math.abs(Number(dTree)) >= 3) treeCellsDiverge++;
    }
    if (p50hi !== null) {
      hiCells++;
      if (Math.abs(p50hi - p50) >= 3) hiDiverge++;
    }
    console.log(
      `| ${a.spec} | ${a.heroTree} | ${a.spellName} (${a.spellId}) | ${a.all.length} | ${p50} | ${a.hi.length} | ${p50hi ?? "—"} | ${dHi} | ${dTree} |`,
    );
  }
  console.log("");
  console.log(
    `tree cells ≥ n${minN}: ${treeCells}, of which |tree − spec-wide| ≥ 3pp: ${treeCellsDiverge}`,
  );
  console.log(
    `cells with a hi cohort ≥ n${minN}: ${hiCells}, of which |hi − all| ≥ 3pp: ${hiDiverge}`,
  );
}

function emitTable(): void {
  const inPath = flag("--in");
  const outPath = flag("--out");
  if (!inPath || !outPath) {
    console.error(
      "usage: emit-table --in <file.jsonl> --out <file.json> [--cohort all|hi] [--corpus <label>]",
    );
    process.exit(1);
  }
  const cohort = flag("--cohort") === "hi" ? "hi" : "all";
  const rows = readRows(inPath);
  const cells = aggregate(rows);
  const out: Record<string, { n: number; medianHpPct: number; spellName: string }> =
    {};
  for (const [k, a] of [...cells.entries()].sort()) {
    const xs = cohort === "hi" ? a.hi : a.all;
    if (xs.length === 0) continue;
    out[k] = {
      n: xs.length,
      medianHpPct: Math.round(median(xs)),
      spellName: a.spellName,
    };
  }
  const table = {
    meta: {
      generatedAt: new Date().toISOString().slice(0, 10),
      corpus:
        flag("--corpus") ??
        `${new Set(rows.map((r) => r.matchId)).size} archived matches, 12.1+`,
      command:
        "npx tsx packages/eval/scripts/cdTriggerPriorScan.ts emit-table --in <scan.jsonl> --out <file.json>",
      cohort,
      cohortRule:
        cohort === "hi"
          ? `percentile within (bracket, ISO week) >= ${HI_COHORT_MIN_PCT}`
          : "all 12.1+ healer rounds in the archive",
      rows: rows.length,
      nFloor: CD_TRIGGER_PRIOR_N_FLOOR,
      predicateVersion: 1,
    },
    cells: out,
  };
  const tmp = join(dirname(outPath), `.${basename(outPath)}.tmp`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(tmp, JSON.stringify(table, null, 2) + "\n");
  copyFileSync(tmp, outPath);
  // The datagen-manifest test treats any `*Generated*` file under data/ as an
  // artefact — a leftover temp file next to the imported json is red.
  rmSync(tmp, { force: true });
  console.error(`wrote ${Object.keys(out).length} cells (cohort=${cohort}) → ${outPath}`);
}

function roster(): void {
  const cells = (GENERATED as any).cells as Record<
    string,
    { n: number; medianHpPct: number; spellName: string }
  >;
  console.log(
    "| spec | spell | id | n | p50 | reaches ally | mitigation % | absorb | heals self | heals others | healing recv % | immune | throughput role | team heal |",
  );
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const [k, c] of Object.entries(cells).sort()) {
    const [spec, tree, id] = k.split("|") as [string, string, string];
    if (tree !== "*") continue;
    const p = abilityProfile(id);
    const immune =
      (p.immuneSchools ? `schools ${p.immuneSchools}` : "") +
      (p.immuneMechanics?.length ? ` mech ${p.immuneMechanics.join("/")}` : "");
    console.log(
      `| ${spec} | ${c.spellName} | ${id} | ${c.n}${c.n < CD_TRIGGER_PRIOR_N_FLOOR ? " (under floor)" : ""} | ${c.medianHpPct} | ${p.reachesAlly ? "yes" : "no"} | ${p.mitigationPct ?? ""} | ${p.absorbs ? "yes" : ""} | ${p.healsSelf ? "yes" : ""} | ${p.healsOthers ? "yes" : ""} | ${p.healingReceivedPct ?? ""} | ${immune.trim()} | ${p.throughputRole ? "yes" : ""} | ${TEAM_HEAL_CD_IDS.has(id) ? "yes" : ""} |`,
    );
  }
}

async function main(): Promise<void> {
  if (cmd === "scan") await scan();
  else if (cmd === "roster") {
    await ensureAnalysisData();
    roster();
  }
  else if (cmd === "report") report();
  else if (cmd === "emit-table") emitTable();
  else {
    console.error("usage: scan | report | emit-table | roster (see header)");
    process.exit(1);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

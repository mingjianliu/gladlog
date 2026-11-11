/**
 * verify/run.ts — every corpus scan over one walk of a capture.
 *
 *   npx tsx packages/eval/scripts/verify/run.ts <captureDir> --out <dir>
 *     [--scans corpusFactScan3,fact2Scan] [--workers N] [--archive-dir <dir>]
 *     [--files N] [--freeze] [--coverage] [--flush-mb N]
 *
 * Each worker reads one contiguous run of the contexts (never cutting an
 * archive) and writes its accumulators; this process joins them in run order
 * and prints every report, to the file names the serial chains wrote. So the
 * reports compare with a serial run line for line, in the order of the walk.
 *
 * Reports are written to a staging directory and published only once the whole
 * run checked out: a dead worker, a truncated state file, a missing context or a
 * scan that failed its own report leaves no report, and the previous run's are
 * gone before this one starts, so nothing partial or stale can be mistaken for
 * a clean run. `--files N` keeps the first N
 * contexts (a quick pass); `--freeze` deep-freezes the rows, which proves no
 * check writes to what the owners and scans share; `--coverage` writes
 * `coverage.json` for `verify/coverSet.ts`.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { deserialize, serialize } from "node:v8";

import { ensureAnalysisData } from "@gladlog/analysis";

import { countsOf } from "./compare";
import {
  coverageGapsOf,
  CoverageTracker,
  type ICoverageRow,
  type IReported,
} from "./coverage";
import { type MergeRule, mergeState } from "./merge";
import { forEachContext, listContextFiles, splitContexts } from "./rounds";
import { argOf, type IScan, type IScanOpts } from "./scan";
import { timed, timing } from "./timing";

interface ISpec {
  name: string;
  /** the serial chains' file name */
  stem: string;
  examples: number;
  json: boolean;
  /** beside the scans, not in scripts/ */
  file?: string;
}

/** report order and the flags the chains ran each scan with */
const SPECS: ISpec[] = [
  { name: "corpusFactScan", stem: "corpusFactScan", examples: 5, json: true },
  { name: "corpusFactScan2", stem: "corpusFactScan2", examples: 5, json: true },
  { name: "corpusFactScan3", stem: "corpusFactScan3", examples: 5, json: true },
  { name: "corpusFactScan4", stem: "corpusFactScan4", examples: 5, json: true },
  { name: "corpusFactScan5", stem: "corpusFactScan5", examples: 5, json: true },
  { name: "fact2Scan", stem: "net-fact2Scan", examples: 20, json: false },
  {
    name: "pressFactScan",
    stem: "net-pressFactScan",
    examples: 20,
    json: false,
  },
  {
    name: "breakFactScan",
    stem: "net-breakFactScan",
    examples: 20,
    json: false,
  },
  {
    name: "gates",
    stem: "gates",
    examples: 0,
    json: true,
    file: "verify/gates",
  },
];

const FREE_STOP_PCT = 20;
const WORKER_HEAP_MB = 4096;
const FLUSH_MB = Number(argOf("--flush-mb") ?? 1000);
const DIR = process.argv[2];
const OUT = argOf("--out");
const WORKER = argOf("--worker");
const ARCHIVE_DIR = argOf("--archive-dir") ?? "";
const FREEZE = process.argv.includes("--freeze");
const COVERAGE = process.argv.includes("--coverage");
/** Three, not six: the desktop stays usable and a run costs minutes more.
 * Reports do not depend on the count. */
const WORKERS = Number(argOf("--workers") ?? 3);
const FILES = argOf("--files");
const STATE = argOf("--state");
const only = argOf("--scans")?.split(",");
const specs = SPECS.filter((s) => !only || only.includes(s.name));
if (!DIR || !OUT) {
  console.error("usage: verify/run.ts <captureDir> --out <dir> [--scans a,b]");
  process.exit(2);
}

const contextFiles = () => {
  const all = listContextFiles(DIR);
  return FILES ? all.slice(0, Number(FILES)) : all;
};

/** where the reports go until the run has checked out */
let reportDir: string = OUT;

const optsOf = (s: ISpec): IScanOpts => ({
  dir: DIR,
  examples: s.examples,
  ...(s.json ? { json: join(reportDir, `${s.stem}.json`) } : {}),
});

async function loadScans(): Promise<Array<{ spec: ISpec; scan: IScan }>> {
  await ensureAnalysisData();
  const out: Array<{ spec: ISpec; scan: IScan }> = [];
  for (const spec of specs) {
    const path = join(
      import.meta.dirname,
      "..",
      `${spec.file ?? spec.name}.ts`,
    );
    const scan = ((await import(path)) as { scan: IScan }).scan;
    scan.configure(optsOf(spec));
    out.push({ spec, scan });
  }
  return out;
}

async function worker(k: number, n: number, statePath: string): Promise<void> {
  const scans = await loadScans();
  const run = splitContexts(DIR!, contextFiles(), n, ARCHIVE_DIR)[k]!;
  const unmapped: string[] = [];
  const tracker = COVERAGE ? new CoverageTracker() : undefined;
  const named = scans.map((x) => ({ name: x.spec.name, scan: x.scan }));
  const empty = scans.map((x) => serialize(x.scan.state()));
  let parts = 0;
  /** what the scans hold goes to disk and they start over: serializing copies
   * the strings, and a kept fragment of a raw line otherwise keeps its whole
   * archive's text alive (15 % free memory on the wide capture without this) */
  const flush = (): void => {
    for (const { spec, scan } of scans)
      writeFileSync(
        `${statePath}.${spec.name}.${parts}`,
        serialize(scan.state()),
      );
    parts++;
    scans.forEach((x, i) => x.scan.load(deserialize(empty[i]!)));
    tracker?.restart();
  };
  let visited = 0;
  let archive = "";
  forEachContext(
    DIR!,
    run,
    (ctx) => {
      if (ctx.archive !== archive) {
        tracker?.step(archive, named);
        if (archive && process.memoryUsage().heapUsed > FLUSH_MB * 1e6) flush();
        archive = ctx.archive;
      }
      visited++;
      for (const { spec, scan } of scans) timed(spec.name, () => scan.run(ctx));
    },
    unmapped,
    {
      archiveDir: ARCHIVE_DIR,
      freeze: FREEZE,
      textOnly: scans.every((x) => x.scan.textOnly),
    },
  );
  tracker?.step(archive, named);
  flush();
  writeFileSync(
    statePath,
    serialize({
      unmapped,
      contexts: visited,
      parts,
      timing,
      coverage: tracker?.rows ?? [],
    }),
  );
}

/** % of memory free as macOS counts it, undefined elsewhere */
function freeMemoryPct(): number | undefined {
  const out = spawnSync("memory_pressure", { encoding: "utf8" }).stdout ?? "";
  const m = /free percentage: (\d+)%/.exec(out);
  return m ? Number(m[1]) : undefined;
}

/** stop the whole run below `FREE_STOP_PCT` free: three machine freezes came
 * from corpus jobs, and a rerun with fewer workers costs minutes */
function watchMemory(children: ChildProcess[]): () => number {
  let lowest = 100;
  const timer = setInterval(() => {
    const free = freeMemoryPct();
    if (free === undefined) return;
    lowest = Math.min(lowest, free);
    if (free >= FREE_STOP_PCT) return;
    console.error(`low memory: ${free}% free, stopping the workers`);
    for (const c of children) c.kill();
  }, 10_000);
  return () => {
    clearInterval(timer);
    return lowest;
  };
}

function runWorker(
  k: number,
  n: number,
  statePath: string,
  children: ChildProcess[],
): Promise<void> {
  return new Promise((done, fail) => {
    const args = [
      ...process.execArgv,
      import.meta.filename,
      DIR!,
      "--out",
      OUT!,
      "--worker",
      `${k}/${n}`,
      "--state",
      statePath,
      ...process.argv.slice(3).filter((a) => a !== "--out" && a !== OUT),
    ];
    const p = spawn(process.execPath, args, {
      stdio: ["ignore", "inherit", "inherit"],
      // V8 grows lazily up to its limit: a worker holds one archive and a
      // share of the findings, and dies loudly rather than swap the machine
      env: {
        ...process.env,
        NODE_OPTIONS: `--max-old-space-size=${WORKER_HEAP_MB}`,
      },
    });
    children.push(p);
    p.on("exit", (code, signal) => {
      if (code === 0) done();
      else fail(new Error(`worker ${k}: exit ${code ?? signal}`));
    });
  });
}

function writeReport(spec: ISpec, scan: IScan, unmapped: string[]): void {
  const fd = openSync(join(reportDir, `${spec.stem}.txt`), "w");
  const log = console.log;
  console.log = (...a: unknown[]) => {
    writeSync(fd, `${a.join(" ").replaceAll(reportDir, OUT!)}\n`);
  };
  try {
    scan.report({ unmapped });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the scans' common accumulator shape, as verify/coverage.ts reads it
    const filed = (scan.state() as any).violations as
      Array<{ check: string; kind: string }> | undefined;
    for (const v of filed ?? [])
      reportedKinds.add(`${spec.name}:${v.check}|${v.kind}`);
    if (unmapped.length > 0) {
      console.log(`UNMAPPED contexts: ${unmapped.length}`);
      for (const u of unmapped.slice(0, 10)) console.log(`    ${u}`);
    }
  } finally {
    console.log = log;
    closeSync(fd);
  }
}

/** every `<scan>:<check>|<kind>` the merged reports hold, read as each
 * report is written (its `report()` has filed its own by then) */
const reportedKinds = new Set<string>();

/** a check — or a kind of it — a report states that no archive's row
 * carries (`coverageGapsOf`) */
function coverageGaps(rows: ICoverageRow[]): string[] {
  const reported: IReported[] = [];
  for (const spec of specs)
    for (const [check, n] of countsOf(join(reportDir, `${spec.stem}.txt`)))
      reported.push({ id: `${spec.name}:${check}`, ...n });
  return coverageGapsOf(rows, reported, reportedKinds);
}

/** the last step: everything in `reportDir` has passed. All of it or none. */
function publish(): void {
  const done: string[] = [];
  try {
    for (const f of readdirSync(reportDir)) {
      renameSync(join(reportDir, f), join(OUT!, f));
      done.push(f);
    }
  } catch (e) {
    for (const f of done) rmSync(join(OUT!, f), { force: true });
    throw e;
  }
}

async function main(): Promise<void> {
  if (WORKER) {
    const [k, n] = WORKER.split("/").map(Number);
    await worker(k!, n!, STATE!);
    return;
  }
  const t0 = Date.now();
  let lowestFree = 100;
  // a failed run must not leave the last good one looking like its result,
  // whatever it fails on
  mkdirSync(OUT!, { recursive: true });
  for (const name of [
    ...specs.flatMap((s) => [`${s.stem}.txt`, `${s.stem}.json`]),
    "timing.txt",
    "coverage.json",
    "coverage-gaps.json",
  ])
    rmSync(join(OUT!, name), { force: true });
  const expected = contextFiles().length;
  if (expected === 0) {
    console.error(`verify: no contexts under ${DIR}`);
    process.exit(1);
  }
  const tmp = mkdtempSync(join(dirname(resolve(OUT!)), ".verify-"));
  const children: ChildProcess[] = [];
  let stopped: Promise<void> | undefined;
  /** every worker gone, by SIGKILL after 5 s: the one shutdown, whichever of
   * a dead worker or a signal started it */
  const stopWorkers = (): Promise<void> =>
    (stopped ??= (async () => {
      const live = children.filter(
        (c) => c.exitCode === null && c.signalCode === null,
      );
      if (live.length === 0) return;
      const gone = Promise.all(
        live.map((c) => new Promise((done) => c.once("exit", done))),
      );
      for (const c of live) c.kill();
      const force = setTimeout(() => {
        for (const c of live) c.kill("SIGKILL");
      }, 5000);
      await gone;
      clearTimeout(force);
    })());
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
    process.on(signal, () => {
      void stopWorkers().then(() => {
        rmSync(tmp, { recursive: true, force: true });
        process.exit(1);
      });
    });
  try {
    reportDir = join(tmp, "out");
    mkdirSync(reportDir);
    const paths = Array.from({ length: WORKERS }, (_, k) =>
      join(tmp, `w${k}.bin`),
    );
    const stopWatch = watchMemory(children);
    try {
      await Promise.all(
        paths.map((p, k) => runWorker(k, WORKERS, p, children)),
      );
    } finally {
      lowestFree = stopWatch();
      // one dead worker ends the run: the others must not go on unattended
      await stopWorkers();
    }
    const walked = Date.now();
    const scans = await loadScans();
    const unmapped: string[] = [];
    const totals = new Map<string, number>();
    const coverage: ICoverageRow[] = [];
    const partsOf = new Map<string, number>();
    let contexts = 0;
    for (const p of paths) {
      const part = deserialize(readFileSync(p)) as {
        unmapped: string[];
        contexts: number;
        parts: number;
        timing: Map<string, number>;
        coverage: ICoverageRow[];
      };
      partsOf.set(p, part.parts);
      for (const row of part.coverage) coverage.push(row);
      for (const [k, ms] of part.timing)
        totals.set(k, (totals.get(k) ?? 0) + ms);
      unmapped.push(...part.unmapped);
      contexts += part.contexts;
      rmSync(p);
    }
    for (const { spec, scan } of scans) {
      const rules = (scan.merge ?? {}) as Record<string, MergeRule>;
      const empty = serialize(scan.state());
      let merged: Record<string, unknown> | undefined;
      for (const p of paths)
        for (let i = 0; i < partsOf.get(p)!; i++) {
          const file = `${p}.${spec.name}.${i}`;
          const part = deserialize(readFileSync(file)) as Record<
            string,
            unknown
          >;
          merged = merged ? mergeState(merged, part, rules) : part;
          rmSync(file);
        }
      scan.load(merged);
      writeReport(spec, scan, unmapped);
      scan.load(deserialize(empty));
    }
    writeFileSync(
      join(reportDir, "timing.txt"),
      [...totals]
        .sort((a, b) => b[1] - a[1])
        .map(([k, ms]) => `${(ms / 1000).toFixed(1).padStart(9)} s  ${k}`)
        .join("\n") + "\n",
    );
    if (COVERAGE) {
      writeFileSync(join(reportDir, "coverage.json"), JSON.stringify(coverage));
      writeFileSync(
        join(reportDir, "coverage-gaps.json"),
        JSON.stringify(coverageGaps(coverage)),
      );
    }
    console.log(
      `verify: ${contexts}/${expected} contexts, ${specs.length} scans, walk ${((walked - t0) / 60000).toFixed(1)} min, total ${((Date.now() - t0) / 60000).toFixed(1)} min, unmapped ${unmapped.length}, lowest free memory ${lowestFree}%`,
    );
    // a scan's own failure (a module that did not load) sets the exit code
    if (contexts !== expected || unmapped.length > 0 || process.exitCode) {
      console.error("verify: run failed, no report published");
      process.exitCode = 1;
    } else publish();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

await main();

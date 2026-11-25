/**
 * verify/run.ts — every corpus scan over one walk of a capture.
 *
 *   npx tsx packages/eval/scripts/verify/run.ts <captureDir> --out <dir>
 *     [--scans corpusFactScan3,fact2Scan] [--only <check,…>] [--workers N]
 *     [--archive-dir <dir>] [--files N] [--freeze] [--coverage] [--flush-mb N]
 *     [--chunks N] [--join-from <dir>]
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
 * a clean run. `--chunks N` cuts the walk into N runs instead of one per
 * worker, `--workers` of them at a time (the wide corpus: a chunk that dies of
 * SIGILL is walked again alone, and no process holds a third of the corpus).
 * A walk that finished keeps its accumulators when the join after it throws,
 * and `--join-from <that directory>` joins them without walking again (same
 * capture, split and scan list — the code may differ: a fixed report writer is
 * what a join is rerun for); the reports do not depend on any of the three.
 * The parent cuts the walk once and records it (`split.json`) for every worker
 * and retry; a verdict takes the walk's own files out of its directory and
 * removes the directory only if that leaves it empty. `--files N` keeps the first N
 * contexts (a quick pass); `--freeze` deep-freezes the rows, which proves no
 * check writes to what the owners and scans share; `--coverage` writes
 * `coverage.json` for `verify/coverSet.ts`.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { deserialize, serialize } from "node:v8";

import { ensureAnalysisData } from "@gladlog/analysis";

import { operandsOf, workerArgv } from "./argv";
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
import {
  chunkStatePath,
  isInsideDir,
  makeStageDir,
  readSplitRun,
  removeWalk,
  WALK_FILE,
  writeSplit,
} from "./stage";
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
/** contiguous runs the walk is cut into; one per worker unless told */
const CHUNKS = Number(argOf("--chunks") ?? WORKERS);
/** the directory a finished walk kept: join it, walk nothing */
const JOIN_FROM = argOf("--join-from");
/** a chunk whose node died of SIGILL is walked this many times at most */
const SIGILL_ATTEMPTS = 3;
const FILES = argOf("--files");
const STATE = argOf("--state");
const only = argOf("--scans")?.split(",");
/** `--only <check,…>`: the checks a scan that takes the option keeps
 * (`corpusFactScan5` runs only the modules that own one — T208 / GH #218
 * 10.10: the flag was read by the scan's own CLI and dropped here, so a
 * one-check pass still walked every module). Handed to the workers with the
 * rest of the command line. */
const ONLY_CHECKS = argOf("--only")?.split(",").filter(Boolean);
const specs = SPECS.filter((s) => !only || only.includes(s.name));
if (!DIR || !OUT) {
  console.error("usage: verify/run.ts <captureDir> --out <dir> [--scans a,b]");
  process.exit(2);
}
// a flag that is there with nothing after it is a mistake, not the default: an
// empty `--join-from "$kept"` would clear the reports and walk the corpus again.
// Every place the flag stands, not the first: a wrapper's default followed by
// the caller's own `--chunks` with nothing after it is the same mistake. And
// one value only — `argOf` reads the first, so two that differ would run on
// the one the caller did not mean (the same value twice is let through).
for (const flag of ["--out", "--join-from", "--chunks"]) {
  const operands = operandsOf(process.argv.slice(3), flag);
  for (const operand of operands)
    if (!operand || operand.startsWith("--")) {
      console.error(
        `usage: verify: ${flag} takes a value, got ${operand === undefined ? "nothing" : JSON.stringify(operand)}`,
      );
      process.exit(2);
    }
  if (new Set(operands).size > 1) {
    console.error(
      `usage: verify: ${flag} given more than once with different values: ${operands.join(", ")}`,
    );
    process.exit(2);
  }
}
for (const [flag, n] of [
  ["--workers", WORKERS],
  ["--chunks", CHUNKS],
] as const)
  if (!Number.isInteger(n) || n < 1) {
    console.error(`verify: ${flag} takes a whole number, 1 or more`);
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
  ...(ONLY_CHECKS?.length ? { only: ONLY_CHECKS } : {}),
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
  // the parent's cut, never this process's own: see `writeSplit`
  const run = readSplitRun(dirname(statePath), k, n);
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
function watchMemory(
  children: ChildProcess[],
  onLow: () => void,
): () => number {
  let lowest = 100;
  const timer = setInterval(() => {
    const free = freeMemoryPct();
    if (free === undefined) return;
    lowest = Math.min(lowest, free);
    if (free >= FREE_STOP_PCT) return;
    console.error(`low memory: ${free}% free, stopping the workers`);
    onLow();
    for (const c of children) c.kill();
  }, 10_000);
  return () => {
    clearInterval(timer);
    return lowest;
  };
}

class WorkerDeath extends Error {
  constructor(
    k: number,
    code: number | null,
    readonly signal: NodeJS.Signals | null,
  ) {
    super(`worker ${k}: exit ${code ?? signal}`);
  }
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
      ...workerArgv(process.argv.slice(3), OUT!, `${k}/${n}`, statePath),
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
      else fail(new WorkerDeath(k, code, signal));
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
  const selected = contextFiles();
  const expected = selected.length;
  if (expected === 0) {
    console.error(`verify: no contexts under ${DIR}`);
    process.exit(1);
  }
  /** the capture's own hash, when it has one: the same path can hold another
   * capture by the time a kept walk is joined */
  let captureHash: string | null = null;
  try {
    captureHash = readFileSync(join(DIR!, "capture.sha256"), "utf8").trim();
  } catch {
    // a capture that did not pass, or a hand-made one
  }
  // which contexts, in walk order, and the archive each names on its first
  // line: `--files N` of the same capture laid out in other shards is another
  // selection under the same capture hash
  const order = createHash("sha256");
  const head = Buffer.alloc(4096);
  for (const f of selected) {
    const fd = openSync(join(DIR!, f.shard, "context", f.name), "r");
    const n = readSync(fd, head, 0, head.length, 0);
    closeSync(fd);
    const line = head.subarray(0, n).toString("utf8").split("\n", 1)[0];
    order.update(`${f.shard}/${f.name}\t${line}\n`);
  }
  const walk = JSON.stringify({
    capture: resolve(DIR!),
    captureHash,
    // the directory a relative archive path is read against: the working
    // directory when the flag is absent
    archiveDir: resolve(ARCHIVE_DIR),
    contexts: expected,
    selection: order.digest("hex"),
    files: FILES ?? null,
    chunks: CHUNKS,
    scans: specs.map((s) => s.name),
    only: ONLY_CHECKS ?? null,
    freeze: FREEZE,
    coverage: COVERAGE,
  });
  if (JOIN_FROM) {
    // states of another capture, split or scan list would join into a report
    // that looks like this run's
    let kept: string | undefined;
    try {
      kept = readFileSync(join(JOIN_FROM, WALK_FILE), "utf8");
    } catch {
      // no finished walk there
    }
    if (kept !== walk) {
      console.error(
        `verify: ${JOIN_FROM} does not hold a finished walk of this run\n  kept: ${kept ?? "nothing"}\n  this: ${walk}`,
      );
      process.exit(1);
    }
  }
  const tmp = JOIN_FROM
    ? resolve(JOIN_FROM)
    : mkdtempSync(join(dirname(resolve(OUT!)), ".verify-"));
  // a kept walk and the reports joined from it stay apart (the directories
  // themselves, whatever the two paths spell). The verdict takes the walk's
  // own files out of the kept directory and nothing else (`removeWalk`).
  if (JOIN_FROM && isInsideDir(realpathSync(tmp), realpathSync(OUT!))) {
    console.error(`verify: --out is inside --join-from ${tmp}`);
    process.exit(2);
  }
  /** this process's staging directory, made for the join inside the directory
   * `--out` resolves to (one file system even through a symlink or a mount
   * point, so publishing is a rename) and so never inside a kept walk; gone
   * when the process ends, however it ends */
  let stage: string | undefined;
  /** the walk is on disk, whole: from here only a verdict removes it */
  let walked = Boolean(JOIN_FROM);
  /** the run reached its verdict, published or refused */
  let judged = false;
  /** a walk costs hours on the wide corpus and a join minutes: what a throw
   * in the join (or a signal during it) leaves is the walk, for
   * `--join-from`. Everything else leaves nothing of the walk: its own files
   * go, and the directory with them when nothing else is in it — never
   * recursively, a directory the caller named can be the capture itself. */
  const dropTmp = (): void => {
    if (stage) rmSync(stage, { recursive: true, force: true });
    if (walked && !judged)
      console.error(
        `verify: the walk finished and the join did not; kept its states, join them with --join-from ${tmp}`,
      );
    else if (
      !removeWalk(
        tmp,
        SPECS.map((s) => s.name),
      ) &&
      !JOIN_FROM
    )
      console.error(`verify: ${tmp} holds files that are not the walk's, kept`);
  };
  const children: ChildProcess[] = [];
  let stopped: Promise<void> | undefined;
  /** a signal or the memory watch ended the walk: no lane takes another
   * chunk, and a walk that ends this way did not finish */
  let stopping = false;
  /** every worker gone, by SIGKILL after 5 s: the one shutdown, whichever of
   * a dead worker or a signal started it */
  const stopWorkers = (): Promise<void> =>
    (stopped ??= (async () => {
      stopping = true;
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
        dropTmp();
        process.exit(1);
      });
    });
  try {
    const paths = Array.from({ length: CHUNKS }, (_, k) =>
      chunkStatePath(tmp, k),
    );
    // cut once, here: no worker and no retry reads an archive's size again
    if (!JOIN_FROM)
      writeSplit(tmp, splitContexts(DIR!, selected, CHUNKS, ARCHIVE_DIR));
    // the one shutdown: it also kills, after 5 s, a worker SIGTERM left
    const stopWatch = watchMemory(children, () => void stopWorkers());
    try {
      let next = 0;
      let dead = false;
      /** one of `WORKERS` lanes: the next chunk not yet taken, until none is
       * left or a chunk died */
      const lane = async (): Promise<void> => {
        while (next < CHUNKS && !dead && !stopping) {
          const k = next++;
          for (let attempt = 1; ; attempt++)
            try {
              await runWorker(k, CHUNKS, paths[k]!, children);
              break;
            } catch (e) {
              // node on the WSL host dies of SIGILL at a fixed V8 address now
              // and then (2026-11-18, -20, -22). The chunk starts over and
              // writes every state file again; any other death ends the run.
              if (
                dead ||
                stopping ||
                attempt >= SIGILL_ATTEMPTS ||
                !(e instanceof WorkerDeath && e.signal === "SIGILL")
              ) {
                dead = true;
                throw e;
              }
              console.error(`chunk ${k}/${CHUNKS}: SIGILL, walking it again`);
            }
        }
      };
      if (!JOIN_FROM) {
        await Promise.all(
          Array.from({ length: Math.min(WORKERS, CHUNKS) }, lane),
        );
        // a worker that exited 0 as the stop began fails no lane
        if (stopping) throw new Error("verify: the walk was stopped");
        writeFileSync(join(tmp, WALK_FILE), walk);
        walked = true;
      }
    } finally {
      lowestFree = stopWatch();
      // one dead worker ends the run: the others must not go on unattended
      await stopWorkers();
    }
    const walkEnd = Date.now();
    stage = makeStageDir(OUT!);
    reportDir = stage;
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
      `verify: ${contexts}/${expected} contexts, ${specs.length} scans, walk ${((walkEnd - t0) / 60000).toFixed(1)} min, total ${((Date.now() - t0) / 60000).toFixed(1)} min, unmapped ${unmapped.length}, lowest free memory ${lowestFree}%`,
    );
    // a scan's own failure (a module that did not load) sets the exit code
    if (contexts !== expected || unmapped.length > 0 || process.exitCode) {
      console.error("verify: run failed, no report published");
      process.exitCode = 1;
    } else publish();
    judged = true;
  } finally {
    dropTmp();
  }
}

await main();

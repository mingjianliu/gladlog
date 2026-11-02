/**
 * verify/cycle.ts — one verification pass, cheapest evidence first.
 *
 *   npx tsx packages/eval/scripts/verify/cycle.ts --out <dir>
 *     (--manifest <file> | --from <existing capture>)
 *     [--base <dir of an earlier pass>] [--ledger <file>]
 *     [--shards 3] [--workers 3] [--archive-dir <dir>]
 *
 * capture → gates → family diff against the base → every scan → the check by
 * check comparison with its rise ledger. Writes `<out>/cap` and `<out>/scan`,
 * stops at the first step that fails, and a report that exists means its step
 * finished: see `capture.ts` and `run.ts`. `--out` must be new or empty: a pass
 * refused halfway must not leave the last pass's reports to be read as its own. `--from` keeps a capture and re-reads
 * it (a base through the current checks).
 *
 * The three sizes of a pass differ only in the manifest: the cover set
 * (`coverSet.ts`, a few minutes, every small change), the 605 (each batch), the
 * wide corpus (before pushing).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { argOf } from "./scan";

const OUT = argOf("--out");
const MANIFEST = argOf("--manifest");
const FROM = argOf("--from");
const BASE = argOf("--base");
const LEDGER = argOf("--ledger");
const ARCHIVE_DIR = argOf("--archive-dir");
if (!OUT || (!MANIFEST && !FROM)) {
  console.error(
    "usage: verify/cycle.ts --out <dir> (--manifest <file> | --from <capture>) [--base <dir>] [--ledger <file>]",
  );
  process.exit(2);
}
if (existsSync(OUT) && readdirSync(OUT).length > 0) {
  console.error(`cycle refused: ${OUT} already holds something`);
  process.exit(2);
}
const archiveArgs = ARCHIVE_DIR ? ["--archive-dir", ARCHIVE_DIR] : [];
const cap = FROM ?? join(OUT, "cap");
const scan = join(OUT, "scan");

function step(
  label: string,
  script: string,
  args: string[],
  opts: { heap?: string; output?: string } = {},
): void {
  const t0 = Date.now();
  const r = spawnSync(
    process.execPath,
    [...process.execArgv, join(import.meta.dirname, script), ...args],
    {
      stdio: [
        "ignore",
        opts.output ? openSync(opts.output, "w") : "inherit",
        "inherit",
      ],
      env: {
        ...process.env,
        NODE_OPTIONS: `--max-old-space-size=${opts.heap ?? "4096"}`,
      },
    },
  );
  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(`${label}: ${r.status === 0 ? "ok" : "FAILED"}, ${mins} min`);
  if (r.status !== 0) process.exit(r.status ?? 1);
}

mkdirSync(scan, { recursive: true });
if (MANIFEST)
  step("capture", "capture.ts", [
    "--manifest",
    MANIFEST,
    "--out",
    cap,
    "--shards",
    argOf("--shards") ?? "3",
    ...archiveArgs,
  ]);
const workers = ["--workers", argOf("--workers") ?? "3"];
step("gates", "run.ts", [cap, "--out", scan, "--scans", "gates", ...workers]);
if (BASE)
  step(
    "family diff",
    "../captureFamilyDiff.ts",
    [join(BASE, "cap"), cap, "--top", "80"],
    { output: join(scan, "familyDiff.txt") },
  );
step("scans", "run.ts", [cap, "--out", scan, ...workers, ...archiveArgs], {
  heap: "12288",
});
if (BASE)
  step("compare", "compare.ts", [
    join(BASE, "scan"),
    scan,
    ...(LEDGER ? ["--ledger", LEDGER] : []),
  ]);

/**
 * `npm test` entry for analysis and eval (see testIsolation.ts for the why).
 *
 * all-isolated (CI, GLADLOG_TEST_ISOLATE=all): one plain `vitest run` — exactly
 * the pre-2026-09-12 behaviour.
 * hybrid (local default): two sequential invocations —
 *   1. `--project <pkg>:shared --no-isolate` — allowlisted files share workers;
 *   2. `--project <pkg>:isolated`             — everything else, one fresh
 *      worker per file, as before.
 * Two invocations rather than one because vitest 2.1's forks pool decides
 * "fresh worker per file" from the ROOT isolate option only; a per-project
 * `isolate: false` inside a single run still spawns a worker per file and saves
 * nothing (measured: 73 s hybrid vs 70 s isolated), while a root-level
 * `isolate: false` would weaken the isolated group to in-process module resets.
 *
 * Both invocations always run; the exit code is non-zero if either failed.
 * Extra CLI args are forwarded to every invocation. Invoking vitest directly
 * (`npx vitest run …`) bypasses this and runs everything isolated — slower,
 * never less safe.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";

import { isolationMode, partitionTestFiles } from "./testIsolation";

const pkgRoot = process.cwd();
const label = basename(pkgRoot);
const forwarded = process.argv.slice(2);
const vitestBin = join(
  dirname(
    createRequire(join(pkgRoot, "package.json")).resolve("vitest/package.json"),
  ),
  "vitest.mjs",
);

function vitest(args: string[]): number {
  const r = spawnSync(
    process.execPath,
    [vitestBin, "run", ...args, ...forwarded],
    {
      cwd: pkgRoot,
      stdio: "inherit",
    },
  );
  return r.status ?? 1;
}

const mode = isolationMode();
if (mode === "all-isolated") {
  process.exit(vitest([]));
}

const p = partitionTestFiles(pkgRoot);
const vetoed = Object.keys(p.vetoed);
process.stdout.write(
  `[test-isolation] ${label}: shared ${p.shared.length} · isolated ${p.isolated.length}` +
    ` (${p.unlisted.length} not in vitest.shared.json, ${vetoed.length} vetoed by the detector)` +
    ` · full isolation: GLADLOG_TEST_ISOLATE=all\n`,
);
if (vetoed.length)
  process.stdout.write(
    `[test-isolation] vetoed (listed but touching module/global state): ${vetoed.map((f) => `${f} ← ${p.vetoed[f]}`).join("; ")}\n`,
  );
if (p.stale.length)
  process.stdout.write(
    `[test-isolation] STALE vitest.shared.json entries (no such file): ${p.stale.join(", ")}\n`,
  );

let failed = 0;
if (p.shared.length)
  failed |= vitest(["--project", `${label}:shared`, "--no-isolate"]);
if (p.isolated.length) failed |= vitest(["--project", `${label}:isolated`]);
process.exit(failed ? 1 : 0);

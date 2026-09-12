/**
 * Hybrid vitest isolation for `analysis` and `eval` — a LOCAL presubmit speed-up
 * (user ruling 2026-09-12: fail-closed admission; CI stays fully isolated).
 *
 * Why: almost all of these suites' time is per-file setup, not tests — every file
 * re-imports @gladlog/analysis and awaits ensureAnalysisData(). Sharing the module
 * cache (`isolate: false`) loads the tables once per worker. Measured 2026-09-12
 * on the implemented runner, 3 interleaved rounds under load 35–66: `npm test`
 * for analysis + eval 146 s → 52 s (median), peak tree RSS 12.5–12.9 GB → 8.7–9.4 GB. Full `--no-isolate` is NOT safe: files that `vi.mock` a
 * module the setup already cached fail deterministically (3–4 analysis files), and
 * desktop fails 54–56 files — desktop is out of scope.
 *
 * Admission is fail-closed: a test file shares the module cache only if it is
 * (a) listed in the package's `vitest.shared.json` AND (b) not vetoed by
 * STATE_MUTATION_PATTERNS. Everything else — including every new file — runs
 * isolated, exactly as before. A missed admission costs speed, never semantics.
 * The detector is a veto, not the gate: it catches a listed file that later
 * starts mocking, it does not admit anything by itself.
 *
 * CI (`CI` set) and `GLADLOG_TEST_ISOLATE=all` run everything isolated.
 * Order-dependent leaks that the detector cannot see are covered at runtime by
 * `flagGuard.ts` for the three mutable flag singletons.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Source forms that touch module-registry, global or process state. A match
 * vetoes sharing. Deliberately broad: a false positive only costs speed. */
export const STATE_MUTATION_PATTERNS: readonly RegExp[] = [
  /\bvi\s*\.\s*(mock|doMock|unmock|doUnmock|hoisted|spyOn|stubGlobal|stubEnv|unstubAllGlobals|unstubAllEnvs|useFakeTimers|setSystemTime|resetModules|importMock)\s*\(/,
  /\bprocess\s*\.\s*env\s*(\.\s*[A-Za-z_$][\w$]*|\[[^\]]+\])\s*(=(?!=)|\+=|\?\?=|\|\|=)/,
  /\bdelete\s+process\s*\.\s*env\b/,
  /\bObject\s*\.\s*(assign|defineProperty)\s*\(\s*(process\s*\.\s*env|globalThis|window|console)\b/,
  /\bObject\s*\.\s*defineProperty\s*\(/,
  /\b(globalThis|global|window)\s*\.\s*[A-Za-z_$][\w$]*\s*=(?!=)/,
  /\b(Date\s*\.\s*now|Math\s*\.\s*random|console\s*\.\s*[a-z]+)\s*=(?!=)/,
  /\bprocess\s*\.\s*(chdir|exitCode)\b/,
];

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "coverage",
  ".git",
  ".cache",
]);

/** All test files under `pkgRoot`, as sorted posix paths relative to it —
 * the same default include vitest uses (these packages do not override it). */
export function listTestFiles(pkgRoot: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (TEST_FILE.test(name))
        out.push(relative(pkgRoot, full).split(sep).join("/"));
    }
  };
  walk(pkgRoot);
  return out.sort();
}

export function vetoReason(source: string): string | null {
  for (const re of STATE_MUTATION_PATTERNS) {
    const m = source.match(re);
    if (m) return m[0];
  }
  return null;
}

export interface TestPartition {
  shared: string[];
  isolated: string[];
  /** listed in vitest.shared.json but vetoed by the detector (file → matched text) */
  vetoed: Record<string, string>;
  /** test files not in the allowlist (run isolated; admit them to speed up) */
  unlisted: string[];
  /** allowlist entries with no such test file (stale — must be removed) */
  stale: string[];
}

export const SHARED_ALLOWLIST_FILE = "vitest.shared.json";

export function readSharedAllowlist(pkgRoot: string): string[] {
  const p = join(pkgRoot, SHARED_ALLOWLIST_FILE);
  if (!existsSync(p)) return [];
  const parsed = JSON.parse(readFileSync(p, "utf-8")) as { files?: unknown };
  return Array.isArray(parsed.files) ? (parsed.files as string[]) : [];
}

export function partitionTestFiles(pkgRoot: string): TestPartition {
  const files = listTestFiles(pkgRoot);
  const present = new Set(files);
  const allow = new Set(readSharedAllowlist(pkgRoot));
  const shared: string[] = [];
  const isolated: string[] = [];
  const vetoed: Record<string, string> = {};
  const unlisted: string[] = [];
  for (const f of files) {
    if (!allow.has(f)) {
      unlisted.push(f);
      isolated.push(f);
      continue;
    }
    const why = vetoReason(readFileSync(join(pkgRoot, f), "utf-8"));
    if (why) {
      vetoed[f] = why;
      isolated.push(f);
    } else shared.push(f);
  }
  const stale = [...allow].filter((f) => !present.has(f)).sort();
  return { shared, isolated, vetoed, unlisted, stale };
}

export type IsolationMode = "hybrid" | "all-isolated";

export function isolationMode(
  env: Record<string, string | undefined> = process.env,
): IsolationMode {
  if (env["CI"]) return "all-isolated";
  if (env["GLADLOG_TEST_ISOLATE"] === "all") return "all-isolated";
  return "hybrid";
}

/**
 * The vitest workspace for one package. all-isolated → the package config as a
 * single project (identical to having no workspace file). hybrid → a `shared`
 * project (isolate: false) and an `isolated` project, both extending the config.
 * The speed-up needs runVitest.ts (`npm test`), which runs the shared project with
 * the root-level `--no-isolate`; a plain `vitest run` over this workspace still
 * gives every file a fresh worker (vitest 2.1 reads worker isolation from the root
 * option only) — correct, just not faster.
 */
export function vitestProjects(
  pkgRoot: string,
  label: string,
  env: Record<string, string | undefined> = process.env,
): Array<string | Record<string, unknown>> {
  const config = join(pkgRoot, "vitest.config.ts");
  if (isolationMode(env) === "all-isolated") return [config];
  const p = partitionTestFiles(pkgRoot);
  const projects: Array<Record<string, unknown>> = [];
  if (p.shared.length)
    projects.push({
      extends: config,
      root: pkgRoot,
      test: {
        name: `${label}:shared`,
        root: pkgRoot,
        include: p.shared,
        isolate: false,
        poolOptions: { forks: { isolate: false }, threads: { isolate: false } },
      },
    });
  if (p.isolated.length)
    projects.push({
      extends: config,
      root: pkgRoot,
      test: { name: `${label}:isolated`, root: pkgRoot, include: p.isolated },
    });
  return projects;
}

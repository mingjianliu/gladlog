/**
 * Every script that can reach a prompt builder must `await ensureAnalysisData()`.
 *
 * `packages/analysis/src/data/ensure.ts` loads the talent and spell-name tables
 * in the background and states the contract "every entry point that builds a
 * prompt must await this function first". Nothing enforced it: on 2026-09-24,
 * 25 scripts (headlessAnalyze among them, which writes caches into the app
 * library) built prompts without it, so the first combat in each process got
 * degraded data — Divine Shield at 300 s instead of 210 s, phantom charges, six
 * abilities missing from the roster. The reliability audit was misled by it.
 *
 * The check walks relative imports: a module "reaches" a builder when it
 * value-imports one from @gladlog/analysis (or desktop's createAnalysisService)
 * or imports a module that reaches one. A module that itself awaits
 * ensureAnalysisData is a barrier (e.g. src/corpus/buildCorpus.ts). Every
 * reaching file under a `scripts/` directory must mention ensureAnalysisData.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "../../..");
const SCAN_DIRS = [
  "packages/eval/src",
  "packages/eval/scripts",
  "packages/desktop/scripts",
  "packages/corpus-tools/src",
  "packages/corpus-tools/scripts",
];
const BUILDERS =
  /\b(buildMatchContext|extractCandidateFindings|buildFindingsPrompt|createAnalysisService)\b/;
const IMPORT_RE = /^\s*import\s+(type\s+)?([\s\S]*?)\s+from\s+"([^"]+)"/gm;

function listSources(rel: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(join(REPO_ROOT, rel), { withFileTypes: true });
  } catch {
    return; // package without that directory
  }
  for (const ent of entries) {
    const child = join(rel, ent.name);
    if (ent.isDirectory()) {
      if (ent.name !== "node_modules") listSources(child, out);
    } else if (
      /\.(m?ts)$/.test(ent.name) &&
      !ent.name.endsWith(".test.ts") &&
      !ent.name.endsWith(".d.ts")
    ) {
      out.push(normalize(child));
    }
  }
}

function reachingScripts(): { reaching: string[]; missing: string[] } {
  const paths: string[] = [];
  for (const d of SCAN_DIRS) listSources(d, paths);
  const src = new Map(
    paths.map((p) => [p, readFileSync(join(REPO_ROOT, p), "utf8")]),
  );
  const resolve = (from: string, spec: string): string | undefined => {
    if (!spec.startsWith(".")) return undefined;
    const base = normalize(join(dirname(from), spec)).replace(/\.js$/, "");
    for (const c of [base, `${base}.ts`, `${base}.mts`, join(base, "index.ts")])
      if (src.has(c)) return c;
    return undefined;
  };
  const isBarrier = (p: string) =>
    /await\s+ensureAnalysisData\(\)/.test(src.get(p)!);
  const edges = new Map<string, string[]>();
  const reach = new Set<string>();
  for (const [p, text] of src) {
    const out: string[] = [];
    for (const m of text.matchAll(IMPORT_RE)) {
      if (m[1]) continue; // `import type` carries no runtime path
      const names = m[2]!;
      const spec = m[3]!;
      const builderModule =
        spec.startsWith("@gladlog/analysis") || spec.endsWith("/main/analysis");
      if (builderModule && BUILDERS.test(names)) reach.add(p);
      const r = resolve(p, spec);
      if (r) out.push(r);
    }
    edges.set(p, out);
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const [p, out] of edges) {
      if (reach.has(p)) continue;
      // A barrier module still reaches a builder itself, but its importers
      // inherit nothing from it: it awaits the data before building.
      if (out.some((e) => reach.has(e) && !isBarrier(e))) {
        reach.add(p);
        changed = true;
      }
    }
  }
  const scripts = [...reach]
    .filter((p) => p.split("/").includes("scripts"))
    .sort();
  return {
    reaching: scripts,
    missing: scripts.filter((p) => !src.get(p)!.includes("ensureAnalysisData")),
  };
}

describe("ensureAnalysisData entry-point contract", () => {
  it("every script that reaches a prompt builder awaits ensureAnalysisData", () => {
    const { reaching, missing } = reachingScripts();
    // Negative control: the walk must actually find the builder scripts, or
    // an empty result would pass vacuously.
    expect(reaching).toContain("packages/desktop/scripts/headlessAnalyze.ts");
    expect(reaching).toContain("packages/eval/scripts/acceptanceHash.ts");
    expect(
      reaching.length,
      `walk found only ${reaching.length} scripts`,
    ).toBeGreaterThan(30);
    expect(
      missing,
      "these scripts build prompts without `await ensureAnalysisData()` (see packages/analysis/src/data/ensure.ts)",
    ).toEqual([]);
  });

  it("follows transitive imports (answersAlignmentScan reaches a builder through two library modules)", () => {
    expect(reachingScripts().reaching).toContain(
      relative(
        REPO_ROOT,
        join(REPO_ROOT, "packages/eval/scripts/answersAlignmentScan.ts"),
      ),
    );
  });
});

/**
 * codex 30-RV-01 #4 — the probe scores against a whole suite that passes
 * unmutated, or not at all. Runs the real script on a throwaway package: one
 * comparison (`a < b`), a direct test too weak to kill its `<=` mutant, and
 * — in the second case — an unrelated test that already fails. Pass 2 used to
 * read that failure as a kill: "mutation score 100.0 %" for a survivor.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const SCRIPT = resolve(__dirname, "../scripts/mutationProbe.ts");
const REPO = resolve(__dirname, "../../..");

function fixturePackage(unrelatedFails: boolean): string {
  const d = mkdtempSync(join(tmpdir(), "gl-mutprobe-"));
  symlinkSync(join(REPO, "node_modules"), join(d, "node_modules"));
  writeFileSync(join(d, "package.json"), '{ "name": "probe-fixture" }\n');
  writeFileSync(
    join(d, "lt.ts"),
    "export const lt = (a: number, b: number): boolean => a < b;\n",
  );
  writeFileSync(
    join(d, "lt.test.ts"),
    'import { expect, it } from "vitest";\nimport { lt } from "./lt";\nit("lt", () => expect(lt(1, 2)).toBe(true));\n',
  );
  writeFileSync(
    join(d, "other.test.ts"),
    `import { expect, it } from "vitest";\nit("unrelated", () => expect(1).toBe(${unrelatedFails ? 2 : 1}));\n`,
  );
  return d;
}

function probe(dir: string): { code: number; out: string } {
  try {
    const out = execFileSync("npx", ["tsx", SCRIPT, join(dir, "lt.ts")], {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { code: err.status, out: `${err.stdout}${err.stderr}` };
  }
}

describe("mutationProbe — a whole-suite baseline before scoring", () => {
  it("a passing suite: the weak test's mutant survives (score 0.0 %)", () => {
    const r = probe(fixturePackage(false));
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/1 of 1 mutants survive every test \(mutation score 0\.0 %\)/);
  }, 180_000);

  it("an unrelated failing test: abort, never a score", () => {
    const r = probe(fixturePackage(true));
    expect(r.out).not.toMatch(/mutation score \d/);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/whole suite fails on the unmutated file/);
  }, 180_000);
});

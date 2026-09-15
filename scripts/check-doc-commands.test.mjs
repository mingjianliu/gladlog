import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

const CLI_PATH = path.resolve(import.meta.dirname, "check-doc-commands.mjs");

/**
 * Creates an isolated fixture directory with the given files and schedules cleanup.
 * @param {import("node:test").TestContext} t
 * @param {Record<string, string>} files
 * @returns {string} Absolute path to the fixture root
 */
function setupFixture(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-doc-commands-test-"));
  if (t && typeof t.after === "function") {
    t.after(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });
  }
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf8");
  }
  return dir;
}

/**
 * Invokes the future CLI as a subprocess with `--root <fixtureRoot>`.
 * @param {string} fixtureRoot
 * @param {string[]} [extraArgs=[]]
 * @returns {{ status: number | null, stdout: string, stderr: string, output: string }}
 */
function runChecker(fixtureRoot, extraArgs = []) {
  const result = spawnSync(process.execPath, [CLI_PATH, "--root", fixtureRoot, ...extraArgs], {
    encoding: "utf8",
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return {
    status: result.status,
    stdout,
    stderr,
    output: `${stdout}\n${stderr}`.trim(),
  };
}

describe("check-doc-commands CLI", () => {
  describe("Contract (1): Valid doc commands pass", () => {
    it("passes when valid root npm run, workspace npm run, and direct node/tsx scripts are documented in bash/sh/shell fences", (t) => {
      const dir = setupFixture(t, {
        "package.json": JSON.stringify(
          {
            name: "root-pkg",
            private: true,
            workspaces: ["packages/*"],
            scripts: {
              build: "echo build",
              test: "echo test",
              lint: "echo lint",
              presubmit: "npm run lint && npm test",
            },
          },
          null,
          2,
        ),
        "packages/desktop/package.json": JSON.stringify(
          {
            name: "@gladlog/desktop",
            version: "0.1.0",
            scripts: {
              "build:ui": "vite build",
              "verify:vision": "tsx scripts/verifyVision.ts",
              test: "vitest",
            },
          },
          null,
          2,
        ),
        "scripts/verify-oracle.mjs": "// empty script file\n",
        "packages/desktop/scripts/verifyVision.ts": "// empty ts file\n",
        "docs/guide.md": [
          "# Developer Guide",
          "",
          "## Root commands (bash)",
          "```bash",
          "npm run build",
          "npm run presubmit",
          "```",
          "",
          "## Workspace commands (sh)",
          "```sh",
          "npm -w @gladlog/desktop run build:ui",
          "npm --workspace @gladlog/desktop run test",
          "npm --workspace=@gladlog/desktop run build:ui",
          "```",
          "",
          "## Direct scripts (shell)",
          "```shell",
          "node scripts/verify-oracle.mjs",
          "tsx packages/desktop/scripts/verifyVision.ts",
          "```",
          "",
          "## Command with arguments and flags",
          "```bash",
          "npm run test -- --watch",
          "node scripts/verify-oracle.mjs --fixture fast",
          "```",
        ].join("\n"),
      });

      const res = runChecker(dir);
      assert.strictEqual(
        res.status,
        0,
        `Expected CLI to exit with code 0 for valid doc commands, got ${res.status}.\nOutput:\n${res.output}`,
      );
      assert.strictEqual(
        res.stderr,
        "",
        `Expected empty stderr for clean run, got:\n${res.stderr}`,
      );
    });
  });

  describe("Contract (2): Diagnostics and stable failure categories", () => {
    it("fails with file:line and MISSING_ROOT_SCRIPT when root script does not exist", (t) => {
      const dir = setupFixture(t, {
        "package.json": JSON.stringify(
          {
            name: "root-pkg",
            scripts: {
              build: "echo build",
            },
          },
          null,
          2,
        ),
        "docs/missing-root.md": [
          "# Getting Started",
          "",
          "```bash",
          "npm run nonexistent-root-task",
          "```",
        ].join("\n"),
      });

      const res = runChecker(dir);
      assert.strictEqual(
        res.status,
        1,
        `Expected exit code 1 for missing root script, got ${res.status}.\nOutput:\n${res.output}`,
      );
      assert.match(
        res.output,
        /\bMISSING_ROOT_SCRIPT\b/,
        `Expected output to report MISSING_ROOT_SCRIPT category.\nOutput:\n${res.output}`,
      );
      assert.match(
        res.output,
        /(?:^|\b|\/)missing-root\.md:4(?:\b|:)/,
        `Expected output to pinpoint markdown file:line docs/missing-root.md:4.\nOutput:\n${res.output}`,
      );
    });

    it("fails with file:line and UNKNOWN_WORKSPACE when workspace package is unrecognized", (t) => {
      const dir = setupFixture(t, {
        "package.json": JSON.stringify(
          {
            name: "root-pkg",
            workspaces: ["packages/*"],
            scripts: {},
          },
          null,
          2,
        ),
        "packages/desktop/package.json": JSON.stringify(
          {
            name: "@gladlog/desktop",
            scripts: { build: "echo desktop" },
          },
          null,
          2,
        ),
        "docs/unknown-workspace.md": [
          "# Workspace Guide",
          "",
          "```bash",
          "npm -w @gladlog/nonexistent-workspace run build",
          "```",
        ].join("\n"),
      });

      const res = runChecker(dir);
      assert.strictEqual(
        res.status,
        1,
        `Expected exit code 1 for unknown workspace, got ${res.status}.\nOutput:\n${res.output}`,
      );
      assert.match(
        res.output,
        /\bUNKNOWN_WORKSPACE\b/,
        `Expected output to report UNKNOWN_WORKSPACE category.\nOutput:\n${res.output}`,
      );
      assert.match(
        res.output,
        /(?:^|\b|\/)unknown-workspace\.md:4(?:\b|:)/,
        `Expected output to pinpoint markdown file:line docs/unknown-workspace.md:4.\nOutput:\n${res.output}`,
      );
    });

    it("fails with file:line and MISSING_WORKSPACE_SCRIPT when workspace exists but script is missing", (t) => {
      const dir = setupFixture(t, {
        "package.json": JSON.stringify(
          {
            name: "root-pkg",
            workspaces: ["packages/*"],
            scripts: {},
          },
          null,
          2,
        ),
        "packages/desktop/package.json": JSON.stringify(
          {
            name: "@gladlog/desktop",
            scripts: { build: "echo desktop" },
          },
          null,
          2,
        ),
        "docs/missing-workspace-script.md": [
          "# Workspace Script Guide",
          "",
          "```sh",
          "npm -w @gladlog/desktop run non-existent-action",
          "```",
        ].join("\n"),
      });

      const res = runChecker(dir);
      assert.strictEqual(
        res.status,
        1,
        `Expected exit code 1 for missing workspace script, got ${res.status}.\nOutput:\n${res.output}`,
      );
      assert.match(
        res.output,
        /\bMISSING_WORKSPACE_SCRIPT\b/,
        `Expected output to report MISSING_WORKSPACE_SCRIPT category.\nOutput:\n${res.output}`,
      );
      assert.match(
        res.output,
        /(?:^|\b|\/)missing-workspace-script\.md:4(?:\b|:)/,
        `Expected output to pinpoint markdown file:line docs/missing-workspace-script.md:4.\nOutput:\n${res.output}`,
      );
    });

    it("fails with file:line and MISSING_SCRIPT_PATH when direct node or tsx script target is missing", (t) => {
      const dir = setupFixture(t, {
        "package.json": JSON.stringify({ name: "root-pkg" }, null, 2),
        "docs/missing-direct-script.md": [
          "# Direct Scripts",
          "",
          "```shell",
          "node scripts/absent-file.mjs",
          "tsx packages/tools/absent-tool.ts",
          "```",
        ].join("\n"),
      });

      const res = runChecker(dir);
      assert.strictEqual(
        res.status,
        1,
        `Expected exit code 1 for missing direct script path, got ${res.status}.\nOutput:\n${res.output}`,
      );
      assert.match(
        res.output,
        /\b(?:MISSING_SCRIPT_PATH|MISSING_DIRECT_SCRIPT(?:_PATH)?)\b/,
        `Expected output to report MISSING_SCRIPT_PATH category.\nOutput:\n${res.output}`,
      );
      assert.match(
        res.output,
        /(?:^|\b|\/)missing-direct-script\.md:4(?:\b|:)/,
        `Expected output to pinpoint markdown file:line for missing node script at line 4.\nOutput:\n${res.output}`,
      );
      assert.match(
        res.output,
        /(?:^|\b|\/)missing-direct-script\.md:5(?:\b|:)/,
        `Expected output to pinpoint markdown file:line for missing tsx script at line 5.\nOutput:\n${res.output}`,
      );
    });
  });

  describe("Contract (3): Non-shell fences and placeholders are ignored", () => {
    it("ignores commands inside non-shell fenced code blocks", (t) => {
      const dir = setupFixture(t, {
        "package.json": JSON.stringify({ name: "root-pkg" }, null, 2),
        "docs/non-shell.md": [
          "# Non-shell Fences",
          "",
          "```json",
          "npm run nonexistent-root-script",
          "```",
          "",
          "```yaml",
          "npm -w @unknown/pkg run test",
          "```",
          "",
          "```typescript",
          "node scripts/missing.mjs",
          "```",
          "",
          "```python",
          "tsx scripts/missing.ts",
          "```",
          "",
          "```text",
          "npm run invalid-task",
          "```",
          "",
          "```",
          "npm run untagged-invalid-task",
          "```",
        ].join("\n"),
      });

      const res = runChecker(dir);
      assert.strictEqual(
        res.status,
        0,
        `Expected CLI to exit 0 because commands in non-shell fences must be ignored, got ${res.status}.\nOutput:\n${res.output}`,
      );
    });

    it("ignores commands containing obvious placeholders in shell fences", (t) => {
      const dir = setupFixture(t, {
        "package.json": JSON.stringify(
          {
            name: "root-pkg",
            scripts: { build: "echo build" },
          },
          null,
          2,
        ),
        "docs/placeholders.md": [
          "# Placeholder Examples",
          "",
          "```bash",
          "npm run <script>",
          "npm -w <package-name> run <script>",
          "node path/to/<script>.js",
          "node path/to/script.js",
          "node path/to/...",
          "tsx <repo-relative-script>",
          "npm run build --token <TOKEN>",
          "npm run build --api-key <API_KEY>",
          "```",
        ].join("\n"),
      });

      const res = runChecker(dir);
      assert.strictEqual(
        res.status,
        0,
        `Expected CLI to exit 0 because commands with placeholders must be ignored, got ${res.status}.\nOutput:\n${res.output}`,
      );
    });

    it("still catches invalid commands in the same fence when alongside placeholders", (t) => {
      const dir = setupFixture(t, {
        "package.json": JSON.stringify(
          {
            name: "root-pkg",
            scripts: { build: "echo build" },
          },
          null,
          2,
        ),
        "docs/mixed-placeholders.md": [
          "# Mixed Placeholders",
          "",
          "```bash",
          "npm run <script>",
          "npm run genuinely-missing-script",
          "node path/to/example.js",
          "```",
        ].join("\n"),
      });

      const res = runChecker(dir);
      assert.strictEqual(
        res.status,
        1,
        `Expected exit code 1 when genuine invalid command is mixed with placeholders, got ${res.status}.\nOutput:\n${res.output}`,
      );
      assert.match(
        res.output,
        /\bMISSING_ROOT_SCRIPT\b/,
        `Expected category MISSING_ROOT_SCRIPT for genuine missing script.\nOutput:\n${res.output}`,
      );
      assert.match(
        res.output,
        /(?:^|\b|\/)mixed-placeholders\.md:5(?:\b|:)/,
        `Expected output to pinpoint line 5 for genuinely-missing-script.\nOutput:\n${res.output}`,
      );
    });
  });

  describe("Contract (4): Multiline commands with backslash continuations", () => {
    it("handles multiline shell commands with backslash continuations as single valid commands", (t) => {
      const dir = setupFixture(t, {
        "package.json": JSON.stringify(
          {
            name: "root-pkg",
            workspaces: ["packages/*"],
            scripts: {
              build: "echo build",
            },
          },
          null,
          2,
        ),
        "packages/desktop/package.json": JSON.stringify(
          {
            name: "@gladlog/desktop",
            scripts: { "build:ui": "vite build" },
          },
          null,
          2,
        ),
        "scripts/verify.mjs": "// empty\n",
        "docs/multiline-valid.md": [
          "# Multiline Commands",
          "",
          "```bash",
          "npm run \\",
          "  build",
          "",
          "npm -w \\",
          "  @gladlog/desktop \\",
          "  run \\",
          "  build:ui",
          "",
          "node \\",
          "  scripts/verify.mjs \\",
          "  --flag",
          "```",
        ].join("\n"),
      });

      const res = runChecker(dir);
      assert.strictEqual(
        res.status,
        0,
        `Expected multiline continuations of valid commands to exit with 0, got ${res.status}.\nOutput:\n${res.output}`,
      );
    });

    it("handles multiline shell command with backslash continuation as single failed command with correct line number", (t) => {
      const dir = setupFixture(t, {
        "package.json": JSON.stringify(
          {
            name: "root-pkg",
            scripts: { build: "echo build" },
          },
          null,
          2,
        ),
        "docs/multiline-invalid.md": [
          "# Multiline Invalid",
          "",
          "```bash",
          "npm run \\",
          "  missing-multiline-script \\",
          "  --flag",
          "```",
        ].join("\n"),
      });

      const res = runChecker(dir);
      assert.strictEqual(
        res.status,
        1,
        `Expected multiline invalid command to exit with 1, got ${res.status}.\nOutput:\n${res.output}`,
      );
      assert.match(
        res.output,
        /\bMISSING_ROOT_SCRIPT\b/,
        `Expected output to report MISSING_ROOT_SCRIPT category.\nOutput:\n${res.output}`,
      );
      assert.match(
        res.output,
        /(?:^|\b|\/)multiline-invalid\.md:4(?:\b|:)/,
        `Expected output to point to command start line 4.\nOutput:\n${res.output}`,
      );
    });
  });

  describe("Contract (5): Recursive scanning and excluded directories", () => {
    it("recursively scans nested markdown files while skipping node_modules, .git, and generated output directories", (t) => {
      const dir = setupFixture(t, {
        "package.json": JSON.stringify(
          {
            name: "root-pkg",
            scripts: { "build:core": "echo build" },
          },
          null,
          2,
        ),
        "docs/deep/nested/subfolder/guide.md": [
          "# Nested Valid Guide",
          "",
          "```bash",
          "npm run build:core",
          "```",
        ].join("\n"),
        // Excluded: node_modules
        "node_modules/dep/README.md": [
          "# Dep Readme",
          "```bash",
          "npm run missing-dep-script",
          "```",
        ].join("\n"),
        // Excluded: .git
        ".git/README.md": [
          "# Git Readme",
          "```bash",
          "npm run missing-git-script",
          "```",
        ].join("\n"),
        // Excluded: dist
        "dist/README.md": [
          "# Dist Readme",
          "```bash",
          "npm run missing-dist-script",
          "```",
        ].join("\n"),
        // Excluded: build
        "build/README.md": [
          "# Build Readme",
          "```bash",
          "npm run missing-build-script",
          "```",
        ].join("\n"),
        // Excluded: coverage
        "coverage/README.md": [
          "# Coverage Readme",
          "```bash",
          "npm run missing-coverage-script",
          "```",
        ].join("\n"),
        // Excluded: out
        "out/README.md": [
          "# Out Readme",
          "```bash",
          "npm run missing-out-script",
          "```",
        ].join("\n"),
      });

      const res = runChecker(dir);
      assert.strictEqual(
        res.status,
        0,
        `Expected recursive scan to skip ignored directories and pass on nested valid guide, got ${res.status}.\nOutput:\n${res.output}`,
      );
    });

    it("catches errors inside deeply nested markdown files", (t) => {
      const dir = setupFixture(t, {
        "package.json": JSON.stringify(
          {
            name: "root-pkg",
            scripts: { build: "echo build" },
          },
          null,
          2,
        ),
        "docs/deep/nested/subfolder/invalid.md": [
          "# Deep Invalid",
          "",
          "```bash",
          "npm run nonexistent-deep-script",
          "```",
        ].join("\n"),
      });

      const res = runChecker(dir);
      assert.strictEqual(
        res.status,
        1,
        `Expected error in deeply nested markdown to fail with exit code 1, got ${res.status}.\nOutput:\n${res.output}`,
      );
      assert.match(
        res.output,
        /\bMISSING_ROOT_SCRIPT\b/,
        `Expected MISSING_ROOT_SCRIPT category for deep nested script failure.\nOutput:\n${res.output}`,
      );
      assert.match(
        res.output,
        /(?:^|\b|\/)invalid\.md:4(?:\b|:)/,
        `Expected output to pinpoint nested file line 4.\nOutput:\n${res.output}`,
      );
    });
  });

  describe("Contract (6): Historical and ephemeral tree exclusions", () => {
    it("skips historical and ephemeral trees (.claude/worktrees, .superpowers, docs/plans, docs/superpowers/plans) while scanning active .claude/skills and ordinary docs", (t) => {
      const dir = setupFixture(t, {
        "package.json": JSON.stringify(
          {
            name: "root-pkg",
            scripts: {
              build: "echo build",
              test: "echo test",
            },
          },
          null,
          2,
        ),
        // Ephemeral tree: .claude/worktrees
        ".claude/worktrees/wt-1/docs/legacy.md": [
          "# Worktree Doc",
          "```bash",
          "npm run nonexistent-worktree-script",
          "```",
        ].join("\n"),
        // Ephemeral tree: .superpowers
        ".superpowers/specs/draft.md": [
          "# Superpowers Doc",
          "```bash",
          "npm run nonexistent-superpowers-script",
          "```",
        ].join("\n"),
        // Ephemeral tree: docs/plans
        "docs/plans/2026-03-plan.md": [
          "# Plan Doc",
          "```bash",
          "npm run nonexistent-docs-plan-script",
          "```",
        ].join("\n"),
        // Ephemeral tree: docs/superpowers/plans
        "docs/superpowers/plans/archived.md": [
          "# Superpowers Plan Doc",
          "```bash",
          "npm run nonexistent-superpowers-plan-script",
          "```",
        ].join("\n"),
        // Active skill doc: .claude/skills (must be scanned and valid)
        ".claude/skills/deploy/SKILL.md": [
          "# Deploy Skill",
          "```bash",
          "npm run build",
          "```",
        ].join("\n"),
        // Ordinary doc: docs (must be scanned and valid)
        "docs/guide.md": [
          "# Developer Guide",
          "```bash",
          "npm run test",
          "```",
        ].join("\n"),
      });

      const res = runChecker(dir);
      assert.strictEqual(
        res.status,
        0,
        `Expected CLI to exit 0 because historical/ephemeral trees must be skipped, got ${res.status}.\nOutput:\n${res.output}`,
      );
      assert.strictEqual(
        res.stderr,
        "",
        `Expected clean stderr for skipped ephemeral trees, got:\n${res.stderr}`,
      );
    });
  });

  describe("Contract (7): Workspace directory path selectors", () => {
    it("accepts workspace directory path as npm workspace selector in addition to package name", (t) => {
      const dir = setupFixture(t, {
        "package.json": JSON.stringify(
          {
            name: "root-pkg",
            workspaces: ["packages/*"],
            scripts: {},
          },
          null,
          2,
        ),
        "packages/desktop/package.json": JSON.stringify(
          {
            name: "@gladlog/desktop",
            scripts: {
              "build:ui": "vite build",
              test: "vitest",
            },
          },
          null,
          2,
        ),
        "docs/workspace-paths.md": [
          "# Workspace Paths Guide",
          "",
          "```bash",
          "npm -w packages/desktop run build:ui",
          "npm --workspace packages/desktop run test",
          "npm --workspace=packages/desktop run build:ui",
          "npm -w @gladlog/desktop run test",
          "```",
        ].join("\n"),
      });

      const res = runChecker(dir);
      assert.strictEqual(
        res.status,
        0,
        `Expected CLI to exit 0 when npm workspace is specified by directory path, got ${res.status}.\nOutput:\n${res.output}`,
      );
      assert.strictEqual(
        res.stderr,
        "",
        `Expected clean stderr, got:\n${res.stderr}`,
      );
    });
  });

  describe("Contract (8): Directory changes (cd) within shell fences", () => {
    it("updates effective cwd on cd within shell fence for subsequent npm run and node/tsx scripts", (t) => {
      const dir = setupFixture(t, {
        "package.json": JSON.stringify(
          {
            name: "root-pkg",
            workspaces: ["packages/*"],
            scripts: {
              "root:build": "echo root",
            },
          },
          null,
          2,
        ),
        "packages/desktop/package.json": JSON.stringify(
          {
            name: "@gladlog/desktop",
            scripts: {
              "build:ui": "vite build",
              test: "vitest",
            },
          },
          null,
          2,
        ),
        "packages/desktop/scripts/verify-local.mjs": "// empty\n",
        "packages/desktop/scripts/helper.ts": "// empty\n",
        "docs/cd-valid.md": [
          "# CD Guide",
          "",
          "## Multiline sequence",
          "```bash",
          "cd packages/desktop",
          "npm run build:ui",
          "node scripts/verify-local.mjs",
          "tsx scripts/helper.ts",
          "```",
          "",
          "## Chained command",
          "```sh",
          "cd packages/desktop && npm run test",
          "```",
        ].join("\n"),
      });

      const res = runChecker(dir);
      assert.strictEqual(
        res.status,
        0,
        `Expected CLI to exit 0 when cd sets effective cwd for following commands, got ${res.status}.\nOutput:\n${res.output}`,
      );
      assert.strictEqual(
        res.stderr,
        "",
        `Expected clean stderr, got:\n${res.stderr}`,
      );
    });

    it("still reports invalid commands after cd in chained and multiline commands", (t) => {
      const dir = setupFixture(t, {
        "package.json": JSON.stringify(
          {
            name: "root-pkg",
            workspaces: ["packages/*"],
            scripts: {
              build: "echo root build",
            },
          },
          null,
          2,
        ),
        "packages/desktop/package.json": JSON.stringify(
          {
            name: "@gladlog/desktop",
            scripts: {
              "build:ui": "vite build",
            },
          },
          null,
          2,
        ),
        "docs/cd-invalid.md": [
          "# Invalid Commands After CD",
          "",
          "```bash",
          "cd packages/desktop && npm run missing-chained-script",
          "```",
          "",
          "```bash",
          "cd packages/desktop",
          "node scripts/missing-local-tool.mjs",
          "```",
        ].join("\n"),
      });

      const res = runChecker(dir);
      assert.strictEqual(
        res.status,
        1,
        `Expected CLI to exit 1 for invalid commands following cd, got ${res.status}.\nOutput:\n${res.output}`,
      );
      assert.match(
        res.output,
        /(?:^|\b|\/)cd-invalid\.md:4(?:\b|:)/,
        `Expected line 4 to report invalid chained command after cd.\nOutput:\n${res.output}`,
      );
      assert.match(
        res.output,
        /(?:^|\b|\/)cd-invalid\.md:9(?:\b|:)/,
        `Expected line 9 to report missing script path after cd.\nOutput:\n${res.output}`,
      );
      assert.match(
        res.output,
        /\bMISSING_SCRIPT_PATH\b/,
        `Expected MISSING_SCRIPT_PATH diagnostic for missing script path after cd.\nOutput:\n${res.output}`,
      );
    });
  });

  describe("Contract (9): Workspace-nested README command resolution", () => {
    it("starts command resolution at workspace package directory for README nested directly under package", (t) => {
      const dir = setupFixture(t, {
        "package.json": JSON.stringify(
          {
            name: "root-pkg",
            workspaces: ["packages/*"],
            scripts: {
              build: "echo root build",
            },
          },
          null,
          2,
        ),
        "packages/desktop/package.json": JSON.stringify(
          {
            name: "@gladlog/desktop",
            scripts: {
              "build:ui": "vite build",
              test: "vitest",
            },
          },
          null,
          2,
        ),
        "packages/desktop/scripts/verifyVision.ts": "// empty\n",
        "packages/desktop/scripts/run-server.mjs": "// empty\n",
        "packages/desktop/README.md": [
          "# Desktop README",
          "",
          "## Package-local scripts",
          "```bash",
          "npm run build:ui",
          "npm run test",
          "```",
          "",
          "## Direct scripts relative to package",
          "```shell",
          "node scripts/run-server.mjs",
          "tsx scripts/verifyVision.ts",
          "```",
        ].join("\n"),
      });

      const res = runChecker(dir);
      assert.strictEqual(
        res.status,
        0,
        `Expected CLI to exit 0 when workspace package README uses package-local scripts, got ${res.status}.\nOutput:\n${res.output}`,
      );
      assert.strictEqual(
        res.stderr,
        "",
        `Expected clean stderr for workspace package README, got:\n${res.stderr}`,
      );
    });
  });
});

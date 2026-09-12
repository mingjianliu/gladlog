import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CANDIDATE_TYPE_FLAGS } from "../src/data/candidateTypeFlags";
import {
  flagDrift,
  loadFlagGuardState,
  MUTABLE_FLAG_NAMES,
  resetFlagsToBaseline,
} from "./support/flagGuard";
import {
  isolationMode,
  listTestFiles,
  partitionTestFiles,
  readSharedAllowlist,
  vetoReason,
  vitestProjects,
} from "./support/testIsolation";

const PACKAGES = join(__dirname, "..", "..");
const ROOTS = {
  analysis: join(PACKAGES, "analysis"),
  eval: join(PACKAGES, "eval"),
};

describe("hybrid test isolation — partition integrity", () => {
  for (const [label, root] of Object.entries(ROOTS)) {
    it(`${label}: shared ∪ isolated is exactly every test file, with no overlap`, () => {
      const all = listTestFiles(root);
      const p = partitionTestFiles(root);
      expect(p.shared.length + p.isolated.length).toBe(all.length);
      expect([...p.shared, ...p.isolated].sort()).toEqual(all);
      const shared = new Set(p.shared);
      expect(p.isolated.filter((f) => shared.has(f))).toEqual([]);
    });

    it(`${label}: every allowlist entry is a real test file (no stale entries)`, () => {
      expect(partitionTestFiles(root).stale).toEqual([]);
    });

    it(`${label}: unlisted and vetoed files always run isolated`, () => {
      const p = partitionTestFiles(root);
      const isolated = new Set(p.isolated);
      for (const f of p.unlisted) expect(isolated.has(f)).toBe(true);
      for (const f of Object.keys(p.vetoed)) expect(isolated.has(f)).toBe(true);
    });

    it(`${label}: no shared file matches the state-mutation detector`, () => {
      for (const f of partitionTestFiles(root).shared)
        expect([f, vetoReason(readFileSync(join(root, f), "utf-8"))]).toEqual([
          f,
          null,
        ]);
    });

    it(`${label}: allowlist is sorted and duplicate-free (reviewable diffs)`, () => {
      const list = readSharedAllowlist(root);
      expect(list).toEqual([...new Set(list)].sort());
    });
  }
});

describe("hybrid test isolation — detector", () => {
  it.each([
    ["vi.mock", 'vi.mock("../src/data/spellEffectData", () => ({}));'],
    ["spaced spyOn", "vi.spyOn (console, 'warn');"],
    ["bracket env write", "process.env['TZ'] = 'UTC';"],
    ["dotted env write", "process.env.GLADLOG_X = '1';"],
    ["env delete", "delete process.env.TZ;"],
    ["global assignment", "globalThis.fetch = fakeFetch;"],
    ["clock patch", "Date.now = () => 0;"],
    ["fake timers", "vi.useFakeTimers();"],
    ["defineProperty", "Object.defineProperty(window, 'x', { value: 1 });"],
  ])("vetoes %s", (_name, src) => {
    expect(vetoReason(src)).not.toBeNull();
  });

  it.each([
    ["env read", 'if (process.env.CI === "true") skip();'],
    ["vi.fn", "const onDone = vi.fn();"],
    ["local object write", "state.count = 1;"],
  ])("does not veto %s", (_name, src) => {
    expect(vetoReason(src)).toBeNull();
  });
});

describe("hybrid test isolation — mode and projects", () => {
  it("CI and GLADLOG_TEST_ISOLATE=all run fully isolated; otherwise hybrid", () => {
    expect(isolationMode({ CI: "true" })).toBe("all-isolated");
    expect(isolationMode({ GLADLOG_TEST_ISOLATE: "all" })).toBe("all-isolated");
    expect(isolationMode({})).toBe("hybrid");
  });

  it("all-isolated mode is the package config as the single project (today's behaviour)", () => {
    expect(vitestProjects(ROOTS.analysis, "analysis", { CI: "true" })).toEqual([
      join(ROOTS.analysis, "vitest.config.ts"),
    ]);
  });

  it("hybrid mode: a shared project with isolate:false over exactly the partition's shared files", () => {
    const p = partitionTestFiles(ROOTS.analysis);
    const projects = vitestProjects(ROOTS.analysis, "analysis", {}) as Array<{
      test: { name: string; include: string[]; isolate?: boolean };
    }>;
    const shared = projects.find((x) => x.test.name === "analysis:shared")!;
    const isolated = projects.find((x) => x.test.name === "analysis:isolated")!;
    expect(shared.test.isolate).toBe(false);
    expect(shared.test.include).toEqual(p.shared);
    expect(isolated.test.isolate).toBeUndefined();
    expect(isolated.test.include).toEqual(p.isolated);
  });
});

describe("flag guard", () => {
  it("reports a flipped flag by name and resets it", async () => {
    const state = await loadFlagGuardState();
    const saved = { ...CANDIDATE_TYPE_FLAGS };
    try {
      expect(flagDrift(state)).toEqual([]);
      const key = Object.keys(
        CANDIDATE_TYPE_FLAGS,
      )[0] as keyof typeof CANDIDATE_TYPE_FLAGS;
      CANDIDATE_TYPE_FLAGS[key] = !CANDIDATE_TYPE_FLAGS[key];
      expect(flagDrift(state)).toEqual([
        `CANDIDATE_TYPE_FLAGS.${key}: expected ${String(saved[key])}, got ${String(!saved[key])}`,
      ]);
      resetFlagsToBaseline(state);
      expect(flagDrift(state)).toEqual([]);
    } finally {
      Object.assign(CANDIDATE_TYPE_FLAGS, saved);
    }
  });

  it("covers every exported *_FLAGS object in analysis and eval src (completeness)", async () => {
    const found = new Set<string>();
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
          for (const m of readFileSync(full, "utf-8").matchAll(
            /^export (?:const|let) ([A-Z][A-Z0-9_]*_FLAGS)\b/gm,
          ))
            found.add(m[1]);
      }
    };
    walk(join(ROOTS.analysis, "src"));
    walk(join(ROOTS.eval, "src"));
    expect([...found].sort()).toEqual([...MUTABLE_FLAG_NAMES].sort());
    expect(Object.keys((await loadFlagGuardState()).objects).sort()).toEqual(
      [...MUTABLE_FLAG_NAMES].sort(),
    );
  });
});

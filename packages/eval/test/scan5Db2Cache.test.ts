/**
 * Pipeline T249 — the scan5 checks read DB2 at one build, the product data's,
 * and a table the cache has not got is a recorded miss (the run fails on it).
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import manifest from "@gladlog/analysis/src/data/datagen-manifest.json";
import { afterEach, describe, expect, it } from "vitest";

import {
  DB2_BUILD,
  db2Lines,
  db2Misses,
  db2TablePath,
  db2TablePaths,
} from "../scripts/scan5/db2Cache";

const saved = process.env.DATAGEN_CACHE;
afterEach(() => {
  if (saved === undefined) delete process.env.DATAGEN_CACHE;
  else process.env.DATAGEN_CACHE = saved;
});

describe("scan5 DB2 cache (T249)", () => {
  it("reads the build the product's generated data came from", () => {
    expect(DB2_BUILD).toBe(manifest.build);
  });

  it("takes the pinned build's file, never a newer one beside it", () => {
    const dir = mkdtempSync(join(tmpdir(), "db2-cache-"));
    writeFileSync(join(dir, `SpellEffect-${DB2_BUILD}.csv`), "SpellID\n1\n");
    writeFileSync(join(dir, "SpellEffect-99.9.9.99999.csv"), "SpellID\n2\n");
    process.env.DATAGEN_CACHE = dir;
    expect(db2TablePath("SpellEffect")).toBe(
      join(dir, `SpellEffect-${DB2_BUILD}.csv`),
    );
    expect(db2Lines("SpellEffect")).toEqual(["SpellID", "1", ""]);
  });

  it("records a table the cache has not got, another build's file or none", () => {
    const dir = mkdtempSync(join(tmpdir(), "db2-cache-"));
    writeFileSync(join(dir, "SpellMisc-99.9.9.99999.csv"), "SpellID\n2\n");
    writeFileSync(join(dir, `SpellEffect-${DB2_BUILD}.csv`), "SpellID\n1\n");
    process.env.DATAGEN_CACHE = dir;
    expect(db2TablePath("SpellMisc")).toBeUndefined();
    expect(db2TablePaths(["SpellEffect", "SpellCategories"])).toBeUndefined();
    expect(db2Misses()).toEqual([
      `SpellCategories-${DB2_BUILD}.csv`,
      `SpellMisc-${DB2_BUILD}.csv`,
    ]);
  });

  it("records a missing cache directory the same way", () => {
    process.env.DATAGEN_CACHE = join(tmpdir(), "db2-cache-not-there");
    expect(db2Lines("SpellCooldowns")).toBeUndefined();
    expect(db2Misses()).toContain(`SpellCooldowns-${DB2_BUILD}.csv`);
  });
});

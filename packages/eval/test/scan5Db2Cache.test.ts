/**
 * Pipeline T249 — the scan5 checks read DB2 at one build, the product data's,
 * and a run that selects a check whose table the cache has not got is
 * refused before it reads a context.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import manifest from "@gladlog/analysis/src/data/datagen-manifest.json";
import { afterEach, describe, expect, it } from "vitest";

import { scan } from "../scripts/corpusFactScan5";
import {
  DB2_BUILD,
  db2Lines,
  db2Missing,
  db2TablePath,
} from "../scripts/scan5/db2Cache";

const saved = process.env.DATAGEN_CACHE;
afterEach(() => {
  if (saved === undefined) delete process.env.DATAGEN_CACHE;
  else process.env.DATAGEN_CACHE = saved;
});

/** a cache directory holding `tables` at `build` */
function cacheWith(tables: string[], build = DB2_BUILD): string {
  const dir = mkdtempSync(join(tmpdir(), "db2-cache-"));
  for (const t of tables)
    writeFileSync(join(dir, `${t}-${build}.csv`), "SpellID\n1\n");
  return dir;
}
const configure = (only?: string[]): void =>
  scan.configure({ dir: "/nowhere", examples: 0, ...(only ? { only } : {}) });

describe("scan5 DB2 cache (T249)", () => {
  it("reads the build the product's generated data came from", () => {
    expect(DB2_BUILD).toBe(manifest.build);
  });

  it("takes the pinned build's file, never a newer one beside it", () => {
    const dir = cacheWith(["SpellEffect"]);
    writeFileSync(join(dir, "SpellEffect-99.9.9.99999.csv"), "SpellID\n2\n");
    process.env.DATAGEN_CACHE = dir;
    expect(db2TablePath("SpellEffect")).toBe(
      join(dir, `SpellEffect-${DB2_BUILD}.csv`),
    );
    expect(db2Lines("SpellEffect")).toEqual(["SpellID", "1", ""]);
  });

  it("names a table the cache holds at another build only, or not at all", () => {
    process.env.DATAGEN_CACHE = cacheWith(["SpellMisc"], "99.9.9.99999");
    expect(db2Lines("SpellMisc")).toBeUndefined();
    expect(db2Missing(["SpellMisc", "SpellEffect"])).toEqual([
      `SpellMisc-${DB2_BUILD}.csv`,
      `SpellEffect-${DB2_BUILD}.csv`,
    ]);
    process.env.DATAGEN_CACHE = join(tmpdir(), "db2-cache-not-there");
    expect(db2Missing(["SpellMisc"])).toEqual([`SpellMisc-${DB2_BUILD}.csv`]);
  });
});

describe("corpusFactScan5 refuses a run without its DB2 tables (T249)", () => {
  it("stops a full run on a machine with no cache, naming every table", () => {
    process.env.DATAGEN_CACHE = join(tmpdir(), "db2-cache-not-there");
    expect(() => configure()).toThrow(
      new RegExp(
        ["SpellEffect", "SpellMisc", "SpellCategories", "ItemEffect"]
          .map((t) => `(?=.*${t}-${DB2_BUILD}\\.csv)`)
          .join(""),
      ),
    );
  });

  it("stops a selected check whatever its rounds would have reached", () => {
    process.env.DATAGEN_CACHE = cacheWith(["SpellMisc", "SpellCategories"]);
    for (const check of [
      "silenceFiledAsKick",
      "deathBreakableCc",
      "pressMultiBreak",
      "overrideVariantPressMissing",
    ])
      expect(() => configure([check])).toThrow(
        `SpellEffect-${DB2_BUILD}.csv (${check})`,
      );
    process.env.DATAGEN_CACHE = cacheWith(["SpellEffect"]);
    expect(() => configure(["allyOnlySelfSave"])).toThrow(
      `SpellMisc-${DB2_BUILD}.csv (allyOnlySelfSave)`,
    );
    // pipeline T329: castLineNoButton reads an item's spell off ItemEffect
    expect(() => configure(["castLineNoButton"])).toThrow(
      `ItemEffect-${DB2_BUILD}.csv (castLineNoButton)`,
    );
  });

  it("runs a check that reads no table, and any check with them all", () => {
    process.env.DATAGEN_CACHE = join(tmpdir(), "db2-cache-not-there");
    expect(() => configure(["purgeRemovalCount"])).not.toThrow();
    expect(() => configure(["reflectDotRun"])).not.toThrow();
    process.env.DATAGEN_CACHE = cacheWith([
      "SpellEffect",
      "SpellMisc",
      "SpellCategories",
      "ItemEffect",
    ]);
    expect(() => configure()).not.toThrow();
  });
});

/**
 * scan5/db2Cache.ts — the one DB2 read of the scan5 checks (pipeline T249).
 *
 * A check whose truth is a raw DB2 table reads it from the datagen cache
 * (`$DATAGEN_CACHE`, default `~/.cache/gladlog-datagen`) at the build the
 * product's own generated data came from (`datagen-manifest.json`) — never
 * "the newest file in the directory": the three readers used to pick three
 * builds (the newest 12.1.5 SpellEffect; the newest build holding two
 * tables; the newest SpellMisc / SpellEffect of ANY build by string sort,
 * on one machine a 12.1.7 test build later than the product's data).
 *
 * A table the cache has not got is a MISS, kept here: the check that asked
 * checks nothing, and `corpusFactScan5` fails the run on it (exit 1) — a
 * machine without the cache used to report those checks as clean passes.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import manifest from "@gladlog/analysis/src/data/datagen-manifest.json";

/** the build of the product's generated data */
export const DB2_BUILD: string = manifest.build;

const misses = new Set<string>();
/** the tables a check asked for and the cache has not got, as file names */
export const db2Misses = (): string[] => [...misses].sort();

export const db2CacheDir = (): string =>
  process.env.DATAGEN_CACHE ?? join(homedir(), ".cache", "gladlog-datagen");

/** the path of `table` at the product's build, or undefined (a miss) */
export function db2TablePath(table: string): string | undefined {
  const file = `${table}-${DB2_BUILD}.csv`;
  const path = join(db2CacheDir(), file);
  if (existsSync(path)) return path;
  misses.add(file);
  return undefined;
}

/** every table of `tables`, or undefined when one is missing (each miss is
 * kept, so the failure names them all) */
export function db2TablePaths(tables: string[]): string[] | undefined {
  const paths = tables.map(db2TablePath);
  return paths.every((p): p is string => p !== undefined) ? paths : undefined;
}

/** the table's lines, header first — for the tables whose cells hold no
 * comma (SpellEffect, SpellCategories, SpellMisc) */
export function db2Lines(table: string): string[] | undefined {
  const path = db2TablePath(table);
  return path === undefined
    ? undefined
    : readFileSync(path, "utf8").split("\n");
}

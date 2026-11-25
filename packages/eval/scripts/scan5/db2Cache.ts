/**
 * scan5/db2Cache.ts — the one DB2 read of the scan5 checks (pipeline T249).
 *
 * A check whose truth is a raw DB2 table reads it from the datagen cache
 * (`$DATAGEN_CACHE`, default `~/.cache/gladlog-datagen`) at the build the
 * product's own generated data came from (`datagen-manifest.json`) — never
 * "the newest file in the directory": the readers used to pick three builds
 * (the newest 12.1.5 SpellEffect; the newest build holding two tables; the
 * newest SpellMisc / SpellEffect of ANY build by string sort, on one machine
 * a 12.1.7 test build later than the product's data).
 *
 * A module names the tables each of its checks reads (`DB2_TABLES`), and
 * `corpusFactScan5` refuses to run a selected check whose table the cache
 * has not got. Inside a check a missing table reads as undefined (a unit
 * test without a cache).
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import manifest from "@gladlog/analysis/src/data/datagen-manifest.json";

/** the build of the product's generated data */
export const DB2_BUILD: string = manifest.build;

export const db2CacheDir = (): string =>
  process.env.DATAGEN_CACHE ?? join(homedir(), ".cache", "gladlog-datagen");

const fileOf = (table: string): string => `${table}-${DB2_BUILD}.csv`;

/** the path of `table` at the product's build, or undefined */
export function db2TablePath(table: string): string | undefined {
  const path = join(db2CacheDir(), fileOf(table));
  return existsSync(path) ? path : undefined;
}

/** the file names of the `tables` the cache has not got */
export const db2Missing = (tables: readonly string[]): string[] =>
  tables.filter((t) => db2TablePath(t) === undefined).map(fileOf);

/** every table of `tables`, or undefined when one is missing */
export function db2TablePaths(tables: readonly string[]): string[] | undefined {
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

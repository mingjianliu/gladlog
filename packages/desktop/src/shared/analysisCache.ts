import { join } from "path";

/**
 * The renderer must NOT import this file — the `import { join } from "path"` at
 * the top is a Node builtin, and electron-vite's renderer build targets the
 * browser, so Rollup drags the whole module (together with `path`) into the
 * browser bundle, and the built artifact fails with
 * `"join" is not exported by "__vite-browser-external"` (neither local vitest
 * nor tsc catches this; only `electron-vite build` blows up — presubmit caught
 * it once, caused by slotLabel.ts importing `splitSlotKey` from here).
 *
 * The pure slot logic (which touches no fs/path and is safe to import from both
 * main and renderer) has been split out into `./analysisSlots.ts` — the
 * `export *` below only preserves backward compatibility for existing import
 * paths on the main side. New renderer code must import directly from
 * `./analysisSlots` and must import nothing at all from this file (even things
 * that look like pure functions).
 */
export * from "./analysisSlots";

/**
 * Path of the analysis cache file. A single-source predicate — if the filename
 * were spread across the write side, the read side and the seeding side, missing
 * one of them during a rename would show up as a "silent cache miss": no error,
 * the panel just sits in the idle state.
 */
export function analysisCachePath(
  matchesDir: string,
  matchId: string,
  lang: string,
): string {
  return join(matchesDir, matchId, `analysis-v2.${lang}.json`);
}

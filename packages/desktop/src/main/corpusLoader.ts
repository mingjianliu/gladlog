import { existsSync, readFileSync } from "fs";
import type { ReferenceCorpus } from "@gladlog/analysis";

/** Coarse shape validation: only JSON with a `cells` array and a
 *  `wowPatchVersion` string is accepted as a usable corpus. */
function isValidCorpusShape(x: unknown): x is ReferenceCorpus {
  if (!x || typeof x !== "object") return false;
  const c = x as Partial<ReferenceCorpus>;
  return Array.isArray(c.cells) && typeof c.wowPatchVersion === "string";
}

interface CorpusLoadedInfo {
  path: string;
  wowPatchVersion: string;
  builtAt: string;
}

interface CorpusSkippedInfo {
  path: string;
  reason: string;
}

/**
 * Tries to load the corpus in the priority order given by resolvePaths(): file
 * exists + JSON parses + coarse shape validation passes → take it and stop; a
 * failing candidate (missing file / bad JSON / wrong shape) moves on to the
 * next; all failing → null. The first successful parse is cached, and
 * resolvePaths is called only once.
 *
 * corpusLoader itself stays pure (no dependency on electron/electron-log);
 * "which path was loaded" is exposed through the optional onLoaded callback, and
 * the caller (main/index.ts) decides how to log it. Likewise, "a candidate file
 * existed but was skipped (JSON parse failure / failed shape validation)" is
 * exposed through the optional onSkipped callback — when the user drops a broken
 * userData override in place (e.g. a hand-edited corpus JSON with a typo), we
 * must not silently degrade to the bundled corpus. A candidate simply not
 * existing (the normal default, e.g. no override placed) does not count as
 * skipped and does not fire onSkipped.
 */
export function loadBundledCorpus(
  resolvePaths: () => string[],
  onLoaded?: (info: CorpusLoadedInfo) => void,
  onSkipped?: (info: CorpusSkippedInfo) => void,
): () => ReferenceCorpus | null {
  let cached: ReferenceCorpus | null | undefined;
  return () => {
    if (cached !== undefined) return cached;
    cached = null;
    // resolvePaths() itself throwing (path resolution failure, e.g. app.getPath
    // erroring) = null — preserving the old implementation's "resolution failure
    // = null" contract and not letting the exception escape to the caller
    // (compare.ts has no try/catch around loadCorpus(), so an escape would
    // become an unhandled rejection instead of a graceful NO_CORPUS).
    let paths: string[];
    try {
      paths = resolvePaths();
    } catch {
      return cached;
    }
    let loaded: CorpusLoadedInfo | null = null;
    const skipped: CorpusSkippedInfo[] = [];
    for (const p of paths) {
      try {
        if (!existsSync(p)) continue;
        const parsed = JSON.parse(readFileSync(p, "utf-8")) as unknown;
        if (!isValidCorpusShape(parsed)) {
          skipped.push({
            path: p,
            reason: "形状粗验失败(缺 cells 数组或 wowPatchVersion 字符串)",
          });
          continue;
        }
        cached = parsed;
        loaded = {
          path: p,
          wowPatchVersion: parsed.wowPatchVersion,
          builtAt: parsed.builtAt,
        };
        break;
      } catch (err) {
        skipped.push({
          path: p,
          reason: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
    }
    // onLoaded/onSkipped are both moved outside the loop: if a callback throws,
    // it must not be mistaken for "this candidate failed", swallowed, and
    // fall through to the next path (in the onLoaded case that would discard a
    // successfully parsed corpus; in the onSkipped case it would fire repeatedly
    // for the same candidate).
    for (const s of skipped) onSkipped?.(s);
    if (loaded) onLoaded?.(loaded);
    return cached;
  };
}

export function gameBuildFromManifest(manifest: { build?: string }): string {
  return manifest.build ?? "0.0.0.0";
}

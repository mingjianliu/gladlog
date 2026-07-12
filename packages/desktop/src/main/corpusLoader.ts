import { existsSync, readFileSync } from "fs";
import type { ReferenceCorpus } from "@gladlog/analysis";

export function loadBundledCorpus(
  resolvePath: () => string,
): () => ReferenceCorpus | null {
  let cached: ReferenceCorpus | null | undefined;
  return () => {
    if (cached !== undefined) return cached;
    try {
      const p = resolvePath();
      cached = existsSync(p)
        ? (JSON.parse(readFileSync(p, "utf-8")) as ReferenceCorpus)
        : null;
    } catch {
      cached = null;
    }
    return cached;
  };
}

export function gameBuildFromManifest(manifest: { build?: string }): string {
  return manifest.build ?? "0.0.0.0";
}

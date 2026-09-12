/**
 * Merge per-bracket reference corpora into one.
 *
 * Why this exists: `buildCorpus` holds every per-match record of the whole run
 * in memory before aggregating, and a full three-bracket pass at the 2100 floor
 * was killed twice by the OS on a 64GB laptop (Solo Shuffle logs are ~30MB
 * each). Cells are keyed BY bracket and never interact across brackets, so
 * `BRACKETS=<one> buildCorpus` three times + this merge is equivalent to one
 * big run, with peak memory bounded by the largest single bracket.
 *
 * It refuses rather than papers over the two ways a merge can silently corrupt
 * the result:
 *   - inputs built at different rating floors or game builds — the merged file
 *     would claim one provenance for cells that do not share it;
 *   - inputs whose brackets overlap — the same cohort would appear twice.
 *
 * Usage:
 *   npx tsx scripts/mergeCorpora.ts --out data/reference_vectors.json \
 *     /tmp/rv_3v3.json /tmp/rv_2v2.json /tmp/rv_ss.json
 */
import type { ReferenceCorpus } from "@gladlog/analysis";
import fs from "fs-extra";
import path from "path";

import { REFERENCE_CELL_N_FLOOR } from "@gladlog/analysis";

import { validateCorpus } from "../src/validateCorpus";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const out = arg("--out");
  const inputs = process.argv
    .slice(2)
    .filter((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--out");
  if (!out || inputs.length === 0) {
    console.error(
      "usage: mergeCorpora.ts --out <file> <corpus.json> [<corpus.json> …]",
    );
    process.exit(2);
  }

  const parts: ReferenceCorpus[] = [];
  for (const p of inputs) parts.push(await fs.readJson(p));

  const builds = new Set(parts.map((p) => p.wowPatchVersion));
  const floors = new Set(parts.map((p) => p.sourceFloor));
  if (builds.size > 1) {
    console.error(
      `refusing: inputs disagree on build (${[...builds].join(", ")})`,
    );
    process.exit(1);
  }
  if (floors.size > 1) {
    console.error(
      `refusing: inputs disagree on rating floor (${[...floors].join(", ")})`,
    );
    process.exit(1);
  }

  const seen = new Map<string, string>();
  for (const [i, part] of parts.entries()) {
    for (const b of new Set(part.cells.map((c) => c.bracket))) {
      const prev = seen.get(b);
      if (prev !== undefined && prev !== inputs[i]) {
        console.error(
          `refusing: bracket "${b}" appears in both ${prev} and ${inputs[i]} — merging would double-count it`,
        );
        process.exit(1);
      }
      seen.set(b, inputs[i]!);
    }
  }

  const merged: ReferenceCorpus = {
    wowPatchVersion: [...builds][0]!,
    builtAt: new Date().toISOString(),
    sourceFloor: [...floors][0]!,
    buildGroups: Object.assign({}, ...parts.map((p) => p.buildGroups)),
    cells: parts.flatMap((p) => p.cells),
  };

  const violations = validateCorpus(merged, REFERENCE_CELL_N_FLOOR);
  if (violations.length > 0) {
    console.error(`VALIDATION FAILED (${violations.length}):`);
    violations.slice(0, 40).forEach((v) => console.error("  " + v));
    process.exit(1);
  }

  await fs.ensureDir(path.dirname(out));
  await fs.writeJson(out, merged, { spaces: 0 });
  const usable = merged.cells.filter((c) => !c.insufficient).length;
  console.log(
    `merged ${parts.length} corpora → ${merged.cells.length} cells (${usable} usable), ` +
      `brackets: ${[...seen.keys()].join(", ")}, floor ${merged.sourceFloor}, build ${merged.wowPatchVersion} → ${out}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import {
  rankKeystoneCandidates,
  type StudyRow,
} from "../src/keystoneDiscovery";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROWS =
  process.env.STUDY_ROWS ??
  path.join(__dirname, "../../../.study-build-rows.json");

async function main() {
  const rows = (await fs.readJson(ROWS)) as StudyRow[];
  const specs = [...new Set(rows.map((r) => r.spec))];
  for (const spec of specs) {
    for (const metric of ["offensiveIndex", "ccDensity"] as const) {
      // NOTE: this is a global-diff HEURISTIC for surfacing candidates, not a
      // rigorous test. It does not stratify by archetype, so a node correlated
      // with an aggressive archetype can show an inflated diff (Simpson's
      // paradox). Always cross-check a candidate against the within-archetype
      // variance study (collectBuildStudy.ts) before adding it to
      // keystoneGates.json. The maintainer is the gate.
      const threshold = metric === "offensiveIndex" ? 0.1 : 0.3;
      const cands = rankKeystoneCandidates(rows, spec, metric)
        .filter((c) => Math.abs(c.diff) >= threshold) // per-candidate, not just cands[0]
        .slice(0, 4);
      if (cands.length === 0) continue;
      console.log(`\n${spec} — ${metric} candidates:`);
      for (const c of cands)
        console.log(
          `  node ${c.nodeId}  prev=${(c.prevalence * 100).toFixed(0)}%  medWith=${c.medWith.toFixed(2)} medWithout=${c.medWithout.toFixed(2)} diff=${c.diff.toFixed(2)}`,
        );
    }
  }
  console.log(
    "\nReview candidates; hand-edit data/keystoneGates.json. Tool never auto-writes it.",
  );
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

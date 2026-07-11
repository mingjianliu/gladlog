import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import { fetchMatchStubs, downloadLogText } from "../src/feedClient";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { buildPerMatchRecords } from "../src/perMatchRecord";
import { aggregateCells } from "../src/cellAggregator";
import { validateCorpus } from "../src/validateCorpus";

const BRACKETS = ["Rated Solo Shuffle", "2v2", "3v3"];
const MIN_RATING = Number(process.env.MIN_RATING ?? 2300);
const PER_BRACKET = Number(process.env.PER_BRACKET ?? 1200); // 足以让主流 archetype 清 N_floor
const N_FLOOR = 30;
const PATCH = process.env.WOW_PATCH ?? "unknown";
const OUT = path.join(__dirname, "../data/reference_vectors.json");

async function main() {
  const recs = [];
  for (const bracket of BRACKETS) {
    const stubs = await fetchMatchStubs({
      bracket,
      minRating: MIN_RATING,
      limit: PER_BRACKET,
    });
    console.log(`${bracket}: ${stubs.length} stubs`);
    let i = 0;
    for (const stub of stubs) {
      try {
        const text = await downloadLogText(stub);
        recs.push(...buildPerMatchRecords(text));
      } catch (e) {
        console.warn(`skip ${stub.id}: ${e}`);
      }
      if (++i % 100 === 0)
        console.log(
          `  ${bracket}: ${i}/${stubs.length} logs, ${recs.length} records`,
        );
    }
  }
  const corpus = aggregateCells(recs, N_FLOOR, {
    wowPatchVersion: PATCH,
    sourceFloor: MIN_RATING,
  });
  const violations = validateCorpus(corpus, N_FLOOR);
  if (violations.length > 0) {
    console.error(`VALIDATION FAILED (${violations.length}):`);
    violations.slice(0, 40).forEach((v) => console.error("  " + v));
    process.exit(1);
  }
  await fs.ensureDir(path.dirname(OUT));
  await fs.writeJson(OUT, corpus, { spaces: 0 });
  const sizeMB = (fs.statSync(OUT).size / 1e6).toFixed(2);
  console.log(`wrote ${corpus.cells.length} cells (${sizeMB}MB) → ${OUT}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

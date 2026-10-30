import { parseArgs } from "node:util";

import fs from "fs-extra";
import path from "path";

import { abDir, resolveEvalHome } from "../src/evalHome.js";
import { computeHaloStats, renderHaloMarkdown } from "../src/halo/haloStats.js";

const { values } = parseArgs({ options: { ab: { type: "string" } } });
if (!values.ab) {
  console.error("--ab required");
  process.exit(1);
}
const haloDir = abDir(resolveEvalHome(), values.ab);
const report = await computeHaloStats(haloDir);
const outPath = path.join(haloDir, "halo-stats.json");
await fs.writeJson(outPath, report, { spaces: 2 });
console.log(renderHaloMarkdown(report));
console.log(`\nStats written to ${outPath}`);

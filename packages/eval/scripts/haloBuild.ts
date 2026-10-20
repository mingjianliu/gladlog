import { parseArgs } from "node:util";

import path from "path";

import { abDir, resolveEvalHome } from "../src/evalHome.js";
import { buildHaloArms } from "../src/halo/buildHaloArms.js";

const { values } = parseArgs({
  options: {
    "source-run": { type: "string" },
    ab: { type: "string" },
    seed: { type: "string" },
    "n-per-stratum": { type: "string" },
  },
});
if (!values["source-run"] || !values.ab) {
  console.error(
    "--source-run <runs/ 下目录名> and --ab <ab/ 下目录名> required",
  );
  process.exit(1);
}
const home = resolveEvalHome();
const result = await buildHaloArms({
  sourceDir: path.join(home, "runs", values["source-run"]),
  outDir: abDir(home, values.ab),
  nPerStratum: Number(values["n-per-stratum"] ?? 50),
  seed: Number(values.seed ?? 20260805),
});
console.log(
  `halo arms: ${result.pairs} pairs (${result.wins} Win + ${result.losses} Loss) under ${abDir(home, values.ab)}`,
);

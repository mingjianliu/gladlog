import { parseArgs } from "node:util";

import path from "path";

import { buildPlantedAb } from "../src/ab/plantTimestampError.js";
import { abDir, resolveEvalHome } from "../src/evalHome.js";

const { values } = parseArgs({
  options: {
    "source-ab": { type: "string" },
    arm: { type: "string" },
    ab: { type: "string" },
    "n-pairs": { type: "string" },
    "plant-fraction": { type: "string" },
    seed: { type: "string" },
  },
});
if (!values["source-ab"] || !values.ab) {
  console.error("--source-ab and --ab required");
  process.exit(1);
}
const home = resolveEvalHome();
const res = await buildPlantedAb({
  sourceArmDir: path.join(
    abDir(home, values["source-ab"]),
    values.arm ?? "control",
  ),
  outDir: abDir(home, values.ab),
  nPairs: Number(values["n-pairs"] ?? 50),
  plantFraction: Number(values["plant-fraction"] ?? 0.2),
  seed: Number(values.seed ?? 20260806),
});
console.log(
  `planted AB: ${res.pairs} pairs, ${res.planted} planted, under ${abDir(home, values.ab)}`,
);

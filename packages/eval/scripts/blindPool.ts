import { parseArgs } from "node:util";
import { buildBlindPool } from "../src/ab/blindAbPool.js";
import { abDir, resolveEvalHome } from "../src/evalHome.js";

const { values } = parseArgs({
  options: {
    ab: {
      type: "string",
    },
  },
});

const abId = values.ab ?? process.env.AB_ID;
const abDirPath =
  process.env.AB_DIR ?? (abId ? abDir(resolveEvalHome(), abId) : undefined);

if (!abDirPath) {
  console.error("AB_DIR not set and --ab not provided");
  process.exit(1);
}

await buildBlindPool(abDirPath);

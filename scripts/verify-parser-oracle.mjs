// Bridges to the PRIVATE parser-differential oracle (A1). Skips (exit 0) when the
// private repo is absent — the oracle needs the old fork and stays private, so it
// is a local/maintainer + agent-invokable check, never wired into public CI.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const ORACLE = process.env.HOME + "/code/gladlog-eval-private";
if (!existsSync(ORACLE + "/oracle/gate.mjs")) {
  console.log(
    "verify:parser-oracle SKIPPED — private oracle not present (expected outside the maintainer's machine).",
  );
  process.exit(0);
}
const args = process.argv.slice(2);
const res = spawnSync("npx", ["tsx", "oracle/gate.mjs", ...args], {
  cwd: ORACLE,
  stdio: "inherit",
});
process.exit(res.status ?? 1);

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execSync } from "child_process";

function init() {
  const home = process.env.GLADLOG_EVAL_HOME || path.join(os.homedir(), "code", "gladlog-eval-private");

  fs.mkdirSync(home, { recursive: true });

  if (!fs.existsSync(path.join(home, ".git"))) {
    execSync("git init", { cwd: home, stdio: "inherit" });
  }

  fs.mkdirSync(path.join(home, "corpus"), { recursive: true });
  fs.mkdirSync(path.join(home, "runs"), { recursive: true });
  fs.mkdirSync(path.join(home, "ab"), { recursive: true });

  const ledgerPath = path.join(home, "ledger.md");
  if (!fs.existsSync(ledgerPath)) {
    const content = `# gladlog eval ledger

This ledger is append-only (never edit or delete rows; corrections get a new row). Corpus fingerprint convention: '<count>: <first8>..<last8>'. Means are reported as mean±SD.

## Baseline evals
| Date | Commit | Corpus | suff | noise | bias | scaf | acc | outcome | focus | Hard failures | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

## A/B cycles
| Date | Commit | Change tested | Target dim | Pairs | Target Δ (95% CI) | Verdict | Decision | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

## Judge calibrations
| Date | Commit | Cases | Failing dimensions | Verdict | Notes |
| --- | --- | --- | --- | --- | --- |
`;
    fs.writeFileSync(ledgerPath, content, "utf-8");
  }
}

init();

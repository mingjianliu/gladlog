import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export function resolveEvalHome(opts?: { env?: NodeJS.ProcessEnv }): string {
  const env = opts?.env || process.env;
  const home = env.GLADLOG_EVAL_HOME || path.join(os.homedir(), "code", "gladlog-eval-private");

  if (!fs.existsSync(home) || !fs.existsSync(path.join(home, ".git"))) {
    throw new Error(
      `gladlog-eval init required: git repository at '${home}' does not exist.`
    );
  }

  return home;
}

export function runDir(home: string, runId: string): string {
  return path.join(home, "runs", runId);
}

export function abDir(home: string, abId: string): string {
  return path.join(home, "ab", abId);
}

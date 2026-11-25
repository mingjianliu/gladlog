/**
 * verify/stage.ts — where `verify/run.ts` may put things relative to `--out`
 * and to a kept walk. Apart from the runner so the two rules can be tested
 * without starting it.
 */
import { mkdtempSync, realpathSync } from "node:fs";
import nodePath from "node:path";

/** `target` is `dir` itself or lies under it. Both are real paths of one
 * platform (`p`). `path.relative` across two Windows drives returns the
 * target's own absolute path: that is outside, not a path under `dir`. */
export function isInsideDir(
  dir: string,
  target: string,
  p: Pick<typeof nodePath, "relative" | "isAbsolute" | "sep"> = nodePath,
): boolean {
  const rel = p.relative(dir, target);
  if (rel === "") return true;
  return !(rel === ".." || rel.startsWith(`..${p.sep}`)) && !p.isAbsolute(rel);
}

/** A new staging directory inside the directory `--out` resolves to: the same
 * file system as the reports' destination whether `--out` is a symlink or a
 * mount point, so publishing is a rename that cannot cross devices. */
export function makeStageDir(out: string): string {
  return mkdtempSync(nodePath.join(realpathSync(out), ".verify-out-"));
}

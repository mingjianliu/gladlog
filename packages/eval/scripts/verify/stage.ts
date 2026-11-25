/**
 * verify/stage.ts — where `verify/run.ts` may put things relative to `--out`
 * and to a kept walk, and what in a walk's directory is the runner's own.
 * Apart from the runner so the rules can be tested without starting it.
 */
import {
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import nodePath from "node:path";

import type { IContextFile } from "./rounds";

/** what a kept walk says about itself; a join reads nothing else's states */
export const WALK_FILE = "walk.json";
/** the contexts of every chunk, cut once by the parent before any worker */
export const SPLIT_FILE = "split.json";
const STAGE_PREFIX = ".verify-out-";
/** the file the runner puts in every stage it makes (its pid inside): what
 * tells a stage from a directory that only carries the prefix. Never
 * published. */
export const STAGE_MARKER = ".verify-stage";

function isMarkedStage(dir: string): boolean {
  try {
    return lstatSync(nodePath.join(dir, STAGE_MARKER)).isFile();
  } catch {
    return false;
  }
}

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
 * mount point, so publishing is a rename that cannot cross devices. A stage a
 * hard-killed join left there goes first: one runner writes to an `--out` at a
 * time (the runner clears and publishes there on the same assumption), so any
 * other stage is a dead one, and its partial reports must not sit beside the
 * published ones. A stage is a directory with the prefix AND the runner's
 * marker in it; one without the marker is somebody else's and stays (a kept
 * walk restored as `.verify-out-recovery`). `keep` — the walk this run is
 * about to join — stays whatever it holds, and so does a directory it lies
 * in. */
export function makeStageDir(out: string, keep?: string): string {
  const real = realpathSync(out);
  let kept: string | undefined;
  try {
    if (keep !== undefined) kept = realpathSync(keep);
  } catch {
    // not there: nothing of it to delete
  }
  for (const e of readdirSync(real, { withFileTypes: true })) {
    if (!e.isDirectory() || !e.name.startsWith(STAGE_PREFIX)) continue;
    const dir = nodePath.join(real, e.name);
    if (kept !== undefined && isInsideDir(dir, kept)) continue;
    if (!isMarkedStage(dir)) continue;
    rmSync(dir, { recursive: true, force: true });
  }
  const stage = mkdtempSync(nodePath.join(real, STAGE_PREFIX));
  try {
    writeFileSync(nodePath.join(stage, STAGE_MARKER), `${process.pid}\n`);
  } catch (e) {
    // unmarked it would never be cleared
    rmSync(stage, { recursive: true, force: true });
    throw e;
  }
  return stage;
}

/** the state file of chunk `k` in a walk's directory; a worker writes its
 * flushed parts beside it as `<this>.<scan>.<part>` */
export const chunkStatePath = (walkDir: string, k: number): string =>
  nodePath.join(walkDir, `w${k}.bin`);

/** a name a walk of `chunks` chunks over `scans` writes into its directory:
 * the two manifests, the state file of each of its chunks and that chunk's
 * parts of one of its scans. Another walk's chunk (`w27.bin` beside a walk of
 * one) and a part of a scan this walk did not run are not its own. */
export function isWalkFile(
  name: string,
  chunks: number,
  scans: readonly string[],
): boolean {
  if (name === WALK_FILE || name === SPLIT_FILE) return true;
  const m = /^w(0|[1-9]\d*)\.bin(?:\.([^.]+)\.\d+)?$/.exec(name);
  if (m === null || Number(m[1]) >= chunks) return false;
  return m[2] === undefined || scans.includes(m[2]);
}

/** Take a walk out of `dir`: the files that walk wrote (`chunks` and `scans`
 * are the walk's own, as its `walk.json` records them) and nothing else, then
 * the directory itself when that leaves it empty. `--join-from` may name a
 * directory that holds more than the walk (the capture itself, restored
 * states beside its contexts, another walk's states): whatever else is there
 * stays, and so does the directory. True when the directory is gone. */
export function removeWalk(
  dir: string,
  chunks: number,
  scans: readonly string[],
): boolean {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return true;
  }
  for (const e of entries)
    if (e.isFile() && isWalkFile(e.name, chunks, scans))
      rmSync(nodePath.join(dir, e.name), { force: true });
  try {
    rmdirSync(dir);
    return true;
  } catch {
    // something that is not the walk's lives there
    return false;
  }
}

/** The walk's partition, written by the parent before the first worker: the
 * cut reads archive sizes, and a size that changed under a running walk gave
 * two chunks different cuts (one context skipped, one counted twice, the
 * total still right). Every worker, and every retry of one, reads this. */
export function writeSplit(walkDir: string, runs: IContextFile[][]): void {
  writeFileSync(nodePath.join(walkDir, SPLIT_FILE), JSON.stringify(runs));
}

/** chunk `k` of the `n` the parent recorded in `walkDir` */
export function readSplitRun(
  walkDir: string,
  k: number,
  n: number,
): IContextFile[] {
  const runs = JSON.parse(
    readFileSync(nodePath.join(walkDir, SPLIT_FILE), "utf8"),
  ) as IContextFile[][];
  if (!Array.isArray(runs) || runs.length !== n || !Array.isArray(runs[k]))
    throw new Error(
      `verify: ${nodePath.join(walkDir, SPLIT_FILE)} does not record chunk ${k} of ${n}`,
    );
  return runs[k];
}

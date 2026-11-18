/**
 * verify/captureHash.ts — the hash of a capture: every owner's context and
 * menu, keyed by archive, round and owner, so it depends neither on the shard
 * count nor on where the corpus sits on the machine that captured it.
 *
 * Each context / findings file opens with the archive's path as the manifest
 * gave it — absolute, so the same capture on two machines (or two checkouts
 * of the corpus) hashed differently although no rendered line differed
 * (GH #221; 2026-11-17: with the prefix rewritten by hand, 0 of 7,038 files
 * differed between the Mac and WSL). The hash reads that path relative to
 * the capture's archive root — the deepest directory that holds every
 * absolute archive path the capture names — in the key and in the first line
 * of both files. The files themselves are not rewritten: `verify/rounds.ts`
 * opens the archive by that line.
 */
import { createHash, type Hash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** the deepest directory holding every path of `archives` (with a trailing
 * `/`); "" when any of them is relative: a manifest read with
 * `--archive-dir` has no machine prefix to take off, and in a mixed one
 * `/a/x.gz` and a relative `x.gz` are two archives that must not read alike
 * (codex 85-tk-EVAL-T203-1 #1). */
export function archiveRootOf(archives: Iterable<string>): string {
  let root: string[] | undefined;
  for (const a of archives) {
    if (!a.startsWith("/")) return "";
    const dirs = a.split("/").slice(0, -1);
    if (!root) {
      root = dirs;
      continue;
    }
    let n = 0;
    while (n < root.length && n < dirs.length && root[n] === dirs[n]) n++;
    root.length = n;
  }
  return root ? `${root.join("/")}/` : "";
}

/** `archive` as the hash reads it: relative to `root` when it sits under it */
export function archiveKeyOf(archive: string, root: string): string {
  return root && archive.startsWith(root)
    ? archive.slice(root.length)
    : archive;
}

/** a context / findings file's bytes into `h`, its first line (the archive)
 * read as `key` — on the bytes, so nothing else of the file is re-encoded */
function updateRelative(
  h: Hash,
  bytes: Buffer,
  archive: string,
  key: string,
): void {
  const head = Buffer.from(`${archive}\n`, "utf8");
  if (key !== archive && bytes.subarray(0, head.length).equals(head)) {
    h.update(key);
    h.update(bytes.subarray(head.length - 1));
  } else h.update(bytes);
}

export interface ICaptureHash {
  sha: string;
  owners: number;
  /** owners per shard directory `s<k>`, by k */
  perShard: number[];
  /** context files with no findings file beside them */
  noMenu: string[];
  /** the archive root the paths were read against */
  root: string;
}

/** archive + round + owner → its text, whatever shard it landed in.
 * `archiveRoot` states the root instead of inferring it — for captures whose
 * archives share no directory of the corpus (two corpora on two mounts), or
 * a single-archive capture that must keep its dated directories. */
export function captureHashOf(out: string, archiveRoot?: string): ICaptureHash {
  const rows: Array<{
    archive: string;
    round: string;
    owner: string;
    dir: string;
    name: string;
  }> = [];
  const perShard: number[] = [];
  const noMenu: string[] = [];
  for (const shard of readdirSync(out)) {
    const sm = /^s(\d+)$/.exec(shard);
    if (!sm) continue;
    const dir = join(out, shard);
    const k = Number(sm[1]);
    perShard[k] = 0;
    for (const name of readdirSync(join(dir, "context"))) {
      const m = /^\d+-(\d+)-\d+\.txt$/.exec(name);
      if (!m) continue;
      perShard[k]!++;
      const text = readFileSync(join(dir, "context", name), "utf8");
      const [archive, owner] = text.split("\n", 2);
      rows.push({
        archive: archive ?? "",
        round: m[1]!,
        owner: owner ?? "",
        dir,
        name,
      });
    }
  }
  for (let k = 0; k < perShard.length; k++) perShard[k] ??= 0;
  const root =
    archiveRoot === undefined
      ? archiveRootOf(rows.map((r) => r.archive))
      : archiveRoot.endsWith("/")
        ? archiveRoot
        : `${archiveRoot}/`;
  const keyed = rows.map((r) => {
    const archiveKey = archiveKeyOf(r.archive, root);
    return { ...r, archiveKey, key: `${archiveKey}#${r.round}#${r.owner}` };
  });
  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  // two owners that read alike have no order of their own: the hash would
  // hang on the walk (a stated root that folds `/root/a.gz` onto a relative
  // `a.gz` — codex 85-tk-EVAL-T203-1b #2)
  for (let i = 1; i < keyed.length; i++)
    if (keyed[i]!.key === keyed[i - 1]!.key)
      throw new Error(
        `capture hash: two contexts read as ${keyed[i]!.key} (${keyed[i - 1]!.dir}/${keyed[i - 1]!.name}, ${keyed[i]!.dir}/${keyed[i]!.name})`,
      );
  const h = createHash("sha256");
  for (const { key, archive, archiveKey, dir, name } of keyed) {
    h.update(key);
    updateRelative(
      h,
      readFileSync(join(dir, "context", name)),
      archive,
      archiveKey,
    );
    const menu = join(dir, "findings", name);
    if (existsSync(menu))
      updateRelative(h, readFileSync(menu), archive, archiveKey);
    else noMenu.push(name);
  }
  return { sha: h.digest("hex"), owners: keyed.length, perShard, noMenu, root };
}

/** the one line `capture.sha256` holds. `archive-relative` marks the reading:
 * a file without it was hashed over absolute paths (before T203) and only
 * compares with a capture of the same machine and corpus path. */
export const captureHashLine = (h: ICaptureHash): string =>
  `${h.sha}  ${h.owners} owners  archive-relative\n`;

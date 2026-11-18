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
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** the deepest directory holding every absolute path of `archives` (with a
 * trailing `/`); "" when none is absolute. A path that is already relative
 * (a manifest read with `--archive-dir`) has no machine prefix to take off. */
export function archiveRootOf(archives: Iterable<string>): string {
  let root: string[] | undefined;
  for (const a of archives) {
    if (!a.startsWith("/")) continue;
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

/** a context / findings file with its first line (the archive) made relative */
function relativeText(text: string, archive: string, key: string): string {
  return text.startsWith(`${archive}\n`)
    ? `${key}${text.slice(archive.length)}`
    : text;
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

/** archive + round + owner → its text, whatever shard it landed in */
export function captureHashOf(out: string): ICaptureHash {
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
  const root = archiveRootOf(rows.map((r) => r.archive));
  const keyed = rows.map((r) => {
    const archiveKey = archiveKeyOf(r.archive, root);
    return { ...r, archiveKey, key: `${archiveKey}#${r.round}#${r.owner}` };
  });
  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const h = createHash("sha256");
  for (const { key, archive, archiveKey, dir, name } of keyed) {
    h.update(key);
    h.update(
      relativeText(
        readFileSync(join(dir, "context", name), "utf8"),
        archive,
        archiveKey,
      ),
    );
    const menu = join(dir, "findings", name);
    if (existsSync(menu))
      h.update(relativeText(readFileSync(menu, "utf8"), archive, archiveKey));
    else noMenu.push(name);
  }
  return { sha: h.digest("hex"), owners: keyed.length, perShard, noMenu, root };
}

/** the one line `capture.sha256` holds. `archive-relative` marks the reading:
 * a file without it was hashed over absolute paths (before T203) and only
 * compares with a capture of the same machine and corpus path. */
export const captureHashLine = (h: ICaptureHash): string =>
  `${h.sha}  ${h.owners} owners  archive-relative\n`;

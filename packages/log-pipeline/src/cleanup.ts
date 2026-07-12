import { promises as fs } from "node:fs";
import path from "node:path";

import { outputNameFor } from "./collectLogs";
import { parseSegmentKey } from "./protocol/segments";

export function gzipUncompressedSize(tail4: Buffer): number {
  return tail4.readUInt32LE(0);
}

export interface CleanupResult {
  deleted: string[];
  kept: number;
}

/**
 * Drive-folder hygiene: reconstructed logs are the durable copy, so segments
 * whose bytes are fully applied AND older than cleanupAfterDays are safe to
 * delete. Fail-closed: only a well-formed gzip whose own uncompressed size
 * matches the key's claimed length may authorize a deletion — sync layers
 * (Drive) can leave truncated/corrupt files under final names.
 */
export async function cleanupAppliedSegments(opts: {
  syncFolderRoot: string;
  logsDir: string;
  cleanupAfterDays: number;
  nowMs?: number;
}): Promise<CleanupResult> {
  const result: CleanupResult = { deleted: [], kept: 0 };
  if (opts.cleanupAfterDays <= 0) return result;
  const now = opts.nowMs ?? Date.now();
  const cutoff = now - opts.cleanupAfterDays * 86_400_000;
  const rawRoot = path.join(opts.syncFolderRoot, "raw");

  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else files.push(p);
    }
  };
  await walk(rawRoot);

  const outputSizes = new Map<string, number>();
  const sizeOf = async (outName: string): Promise<number> => {
    if (!outputSizes.has(outName)) {
      try {
        outputSizes.set(
          outName,
          (await fs.stat(path.join(opts.logsDir, outName))).size,
        );
      } catch {
        outputSizes.set(outName, -1); // missing output → nothing from it counts as applied
      }
    }
    return outputSizes.get(outName) as number;
  };

  for (const filePath of files) {
    const key = path
      .relative(opts.syncFolderRoot, filePath)
      .split(path.sep)
      .join("/");
    const ref = parseSegmentKey(key);
    if (!ref) {
      result.kept += 1;
      continue;
    }
    try {
      const stat = await fs.stat(filePath);
      const MIN_GZIP_SIZE = 18; // 10-byte header + 8-byte trailer
      let applied = false;
      if (stat.size >= MIN_GZIP_SIZE) {
        const fh = await fs.open(filePath, "r");
        try {
          const head = Buffer.alloc(2);
          const headRead = (await fh.read(head, 0, 2, 0)).bytesRead;
          const tail = Buffer.alloc(4);
          const tailRead = (await fh.read(tail, 0, 4, stat.size - 4)).bytesRead;
          if (
            headRead === 2 &&
            head[0] === 0x1f &&
            head[1] === 0x8b &&
            tailRead === 4
          ) {
            const isize = gzipUncompressedSize(tail);
            // Length cross-check: the gzip's own uncompressed size must equal
            // the key's claimed length before it may authorize a deletion.
            applied =
              isize === ref.length &&
              ref.startOffset + isize <= (await sizeOf(outputNameFor(ref)));
          }
        } finally {
          await fh.close();
        }
      }
      if (applied && stat.mtimeMs < cutoff) {
        await fs.unlink(filePath);
        result.deleted.push(key);
      } else {
        result.kept += 1;
      }
    } catch {
      // Vanished/locked/unreadable file: keep it and continue the run.
      result.kept += 1;
    }
  }
  return result;
}

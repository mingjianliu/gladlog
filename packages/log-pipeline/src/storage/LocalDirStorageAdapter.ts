import { promises as fs } from "fs";
import { dirname, join, relative, sep } from "path";

import { StorageAdapter } from "./StorageAdapter";

// Per-call unique ID for temp files to prevent race conditions in concurrent puts
let nextTmpId = 0;

/**
 * Filesystem-backed adapter: keys map to files under rootDir. The Google Drive
 * transport is just this adapter pointed at a Drive-for-Desktop folder (the
 * streamer and collector each see their local mirror of the same folder).
 */
export class LocalDirStorageAdapter implements StorageAdapter {
  constructor(private rootDir: string) {}

  private pathOf(key: string): string {
    return join(this.rootDir, ...key.split("/"));
  }

  async put(key: string, body: Buffer): Promise<void> {
    const filePath = this.pathOf(key);
    await fs.mkdir(dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp-${process.pid}-${nextTmpId++}`;
    await fs.writeFile(tmp, body);
    await fs.rename(tmp, filePath); // atomic publish, mirrors object-store semantics
  }

  async list(prefix: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return; // root or subdir doesn't exist yet → no keys
      }
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (!e.name.includes(".tmp-"))
          out.push(relative(this.rootDir, p).split(sep).join("/"));
      }
    };
    await walk(this.rootDir);
    return out.filter((k) => k.startsWith(prefix)).sort();
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.pathOf(key));
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.pathOf(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
}

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import type { GladMatch, GladShuffle } from "@gladlog/parser";

export interface StoredMatchMeta {
  id: string;
  kind: "match" | "shuffle";
  bracket: string;
  zoneId: string;
  startTime: number;
  endTime: number;
  result: string;
  storedAt: number;
}

const safeName = (id: string): string => id.replace(/[^A-Za-z0-9._-]/g, "_");

export class MatchStore {
  private index = new Map<string, StoredMatchMeta>();
  private now: () => number;

  constructor(
    private rootDir: string,
    opts?: { now?: () => number },
  ) {
    this.now = opts?.now ?? Date.now;
    mkdirSync(rootDir, { recursive: true });
  }

  private indexPath = () => join(this.rootDir, "_index.ndjson");

  private appendIndexLine(meta: StoredMatchMeta): void {
    appendFileSync(this.indexPath(), JSON.stringify(meta) + "\n");
  }

  private rewriteIndex(): void {
    const tmp = this.indexPath() + ".tmp";
    writeFileSync(
      tmp,
      [...this.index.values()].map((m) => JSON.stringify(m)).join("\n") +
        (this.index.size ? "\n" : ""),
    );
    renameSync(tmp, this.indexPath());
  }

  init(): StoredMatchMeta[] {
    this.index.clear();
    // 1) Fast path: one read of the append-only index (dedup by id, last wins).
    try {
      const raw = readFileSync(this.indexPath(), "utf-8");
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          const meta = JSON.parse(line) as StoredMatchMeta;
          if (typeof meta.id === "string") this.index.set(meta.id, meta);
        } catch {
          /* 跳过损坏行 */
        }
      }
    } catch {
      /* 无索引文件 → 下面迁移 */
    }
    // 2) Reconcile with the per-dir source of truth (cheap: dir NAMES only).
    //    Use Sets so reconciliation is O(N), not O(N^2).
    let names: string[] = [];
    try {
      names = readdirSync(this.rootDir);
    } catch {
      /* 空 */
    }
    const nameSet = new Set(
      names.filter((n) => !n.startsWith(".") && !n.startsWith("_")),
    );
    const indexedDirs = new Set(
      [...this.index.values()].map((m) => safeName(m.id)),
    );
    let repaired = false;
    // Recover dirs present on disk but missing from the index (crash between
    // dir write and index append).
    for (const name of nameSet) {
      if (indexedDirs.has(name)) continue;
      try {
        const meta = JSON.parse(
          readFileSync(join(this.rootDir, name, "meta.json"), "utf-8"),
        ) as StoredMatchMeta;
        if (typeof meta.id === "string") {
          this.index.set(meta.id, meta);
          this.appendIndexLine(meta);
          repaired = true;
        }
      } catch {
        /* 损坏目录 → 跳过 */
      }
    }
    // Drop index entries whose dir is gone.
    for (const [id] of [...this.index]) {
      if (!nameSet.has(safeName(id))) {
        this.index.delete(id);
        repaired = true;
      }
    }
    // No index file at all → write one (migration); or repair.
    if (!existsSync(this.indexPath()) || repaired) this.rewriteIndex();
    return this.list();
  }

  store(item: GladMatch | GladShuffle): {
    stored: boolean;
    meta: StoredMatchMeta | null;
  } {
    let id: string;
    let meta: StoredMatchMeta;
    let data: unknown;
    if (item.kind === "shuffle") {
      const first = item.rounds[0];
      if (!first) return { stored: false, meta: null };
      id = first.id;
      meta = {
        id,
        kind: "shuffle",
        bracket: first.bracket,
        zoneId: first.zoneId,
        startTime: item.startTime,
        endTime: item.endTime,
        result: String(item.result),
        storedAt: this.now(),
      };
      data = {
        ...item,
        rawLines: undefined,
        rounds: item.rounds.map((r) => ({ ...r, rawLines: undefined })),
      };
    } else {
      id = item.id;
      meta = {
        id,
        kind: "match",
        bracket: item.bracket,
        zoneId: item.zoneId,
        startTime: item.startTime,
        endTime: item.endTime,
        result: String(item.result),
        storedAt: this.now(),
      };
      data = { ...item, rawLines: undefined };
    }
    if (this.index.has(id)) {
      // Already indexed — dedup, UNLESS the on-disk meta.json is missing or
      // corrupt: then fall through and re-write to self-heal the files.
      let intact = false;
      try {
        JSON.parse(
          readFileSync(join(this.rootDir, safeName(id), "meta.json"), "utf-8"),
        );
        intact = true;
      } catch {
        /* missing or corrupt → recover */
      }
      if (intact) return { stored: false, meta: this.index.get(id)! };
    }

    const dirName = safeName(id);
    const finalDir = join(this.rootDir, dirName);
    const tmpDir = join(this.rootDir, `.tmp-${dirName}`);
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "meta.json"), JSON.stringify(meta, null, 2));
    writeFileSync(
      join(tmpDir, "match.json"),
      JSON.stringify({
        schemaVersion: 1,
        storedAt: meta.storedAt,
        kind: meta.kind,
        data,
      }),
    );
    writeFileSync(join(tmpDir, "raw.txt"), item.rawLines.join("\n") + "\n");
    rmSync(finalDir, { recursive: true, force: true });
    renameSync(tmpDir, finalDir);
    this.index.set(id, meta);
    this.appendIndexLine(meta);
    return { stored: true, meta };
  }

  list(): StoredMatchMeta[] {
    return [...this.index.values()].sort((a, b) => b.startTime - a.startTime);
  }

  page(opts: { before?: number; limit: number }): StoredMatchMeta[] {
    const limit = Math.max(1, Math.min(500, Math.floor(opts.limit || 0)));
    const before = Number.isFinite(opts.before as number)
      ? (opts.before as number)
      : Infinity;
    return this.list()
      .filter((m) => m.startTime < before)
      .slice(0, limit);
  }

  get(id: string): unknown | null {
    if (!this.index.has(id)) return null;
    try {
      return JSON.parse(
        readFileSync(join(this.rootDir, safeName(id), "match.json"), "utf-8"),
      ) as unknown;
    } catch {
      return null;
    }
  }
}

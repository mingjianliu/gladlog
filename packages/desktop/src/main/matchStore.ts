import {
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

  init(): StoredMatchMeta[] {
    this.index.clear();
    let names: string[] = [];
    try {
      names = readdirSync(this.rootDir);
    } catch {
      /* 保持空索引 */
    }
    for (const name of names) {
      if (name.startsWith(".")) continue;
      try {
        const meta = JSON.parse(
          readFileSync(join(this.rootDir, name, "meta.json"), "utf-8"),
        ) as StoredMatchMeta;
        if (typeof meta.id === "string") this.index.set(meta.id, meta);
      } catch {
        /* 损坏条目跳过 */
      }
    }
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
    if (this.index.has(id)) return { stored: false, meta: this.index.get(id)! };

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
    return { stored: true, meta };
  }

  list(): StoredMatchMeta[] {
    return [...this.index.values()].sort((a, b) => b.startTime - a.startTime);
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

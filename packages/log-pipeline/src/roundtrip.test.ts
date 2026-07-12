import {
  appendFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCollection } from "./collectLogs";
import { flushFile } from "./flusher";
import type { FileCheckpoint } from "./state";
import { MemoryStorageAdapter } from "./storage/MemoryStorageAdapter";

function collectCfg(outDir: string) {
  return {
    storage: { provider: "localDir" as const, directory: "x" },
    outputDir: outDir,
    pollIntervalMs: 0,
    cleanup: false,
  };
}

describe("streamer→collector round-trip", () => {
  it("reconstructs the log byte-exactly across multiple flushes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rt-"));
    const filePath = join(dir, "WoWCombatLog.txt");
    const a = new MemoryStorageAdapter();
    const outDir = mkdtempSync(join(tmpdir(), "rt-out-"));

    writeFileSync(filePath, "1/1 alpha\n");
    let cp: FileCheckpoint | undefined = (
      await flushFile({
        filePath,
        logFileName: "WoWCombatLog.txt",
        hostname: "pc",
        checkpoint: undefined,
        adapter: a,
      })
    ).checkpoint;
    appendFileSync(filePath, "2/2 beta\n3/3 gamma\n");
    cp = (
      await flushFile({
        filePath,
        logFileName: "WoWCombatLog.txt",
        hostname: "pc",
        checkpoint: cp,
        adapter: a,
      })
    ).checkpoint;
    expect(cp?.offset).toBe(readFileSync(filePath).length);

    await runCollection(collectCfg(outDir), a);
    const out = readdirSync(outDir).find((f) => f.endsWith(".txt"))!;
    expect(readFileSync(join(outDir, out)).toString()).toBe(
      readFileSync(filePath).toString(),
    );
  });

  it("survives a crash-window re-flush (same offset, longer delta) with no loss/stall", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rt2-"));
    const filePath = join(dir, "WoWCombatLog.txt");
    const a = new MemoryStorageAdapter();
    const outDir = mkdtempSync(join(tmpdir(), "rt2-out-"));

    writeFileSync(filePath, "1/1 short\n");
    // Flush A: checkpoint NOT persisted (simulated crash) — offset stays 0.
    await flushFile({
      filePath,
      logFileName: "WoWCombatLog.txt",
      hostname: "pc",
      checkpoint: undefined,
      adapter: a,
    });
    // Collector consumes the short segment.
    await runCollection(collectCfg(outDir), a);
    // File grew; re-flush from offset 0 (stale checkpoint) writes a longer segment.
    appendFileSync(filePath, "2/2 more bytes here\n");
    await flushFile({
      filePath,
      logFileName: "WoWCombatLog.txt",
      hostname: "pc",
      checkpoint: undefined,
      adapter: a,
    });
    // Collector must recover the extra bytes, not stall.
    await runCollection(collectCfg(outDir), a);

    const out = readdirSync(outDir).find((f) => f.endsWith(".txt"))!;
    expect(readFileSync(join(outDir, out)).toString()).toBe(
      readFileSync(filePath).toString(),
    );
  });
});

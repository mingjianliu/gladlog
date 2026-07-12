import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { runCollection } from "./collectLogs";
import { buildSegmentKey } from "./protocol/segments";
import { MemoryStorageAdapter } from "./storage/MemoryStorageAdapter";

function cfg(dir: string) {
  return {
    storage: { provider: "localDir" as const, directory: "unused" },
    outputDir: dir,
    pollIntervalMs: 0,
    cleanup: false,
  };
}

describe("runCollection (overlap-aware, advance-by-actual)", () => {
  it("recovers dropped bytes when a longer re-flush overwrites a shorter segment's range", async () => {
    // Craft length-encoded keys directly to simulate a crash-window re-flush.
    const a = new MemoryStorageAdapter();
    const g = "abcd1234";
    // First flush wrote bytes [0,50); crash before checkpoint; re-flush wrote [0,120).
    await a.put(
      buildSegmentKey("pc", "L.txt", g, 0, 50),
      gzipSync(Buffer.alloc(50, 65)),
    ); // 'A'*50
    await a.put(
      buildSegmentKey("pc", "L.txt", g, 0, 120),
      gzipSync(Buffer.concat([Buffer.alloc(50, 65), Buffer.alloc(70, 66)])),
    ); // 'A'*50 + 'B'*70
    const dir = mkdtempSync(join(tmpdir(), "collect-"));
    const stats = await runCollection(cfg(dir), a);
    const outName = stats.filesUpdated[0];
    const out = readFileSync(join(dir, outName));
    expect(out.length).toBe(120); // no bytes lost, no stall
    expect(out.subarray(50).every((b) => b === 66)).toBe(true);
  });

  it("defers a partially-synced (truncated gzip) segment instead of appending garbage", async () => {
    const a = new MemoryStorageAdapter();
    const g = "abcd1234";
    const full = gzipSync(Buffer.alloc(40, 67)); // 'C'*40
    await a.put(
      buildSegmentKey("pc", "L.txt", g, 0, 40),
      full.subarray(0, full.length - 3),
    ); // truncated
    const dir = mkdtempSync(join(tmpdir(), "collect-"));
    const stats = await runCollection(cfg(dir), a);
    expect(stats.bytesAppended).toBe(0); // deferred, nothing applied
  });
});

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { gzipSync } from "node:zlib";

import { describe, expect,it } from "vitest";

import { cleanupAppliedSegments } from "./cleanup";
import { outputNameFor } from "./collectLogs";
import { buildSegmentKey, parseSegmentKey } from "./protocol/segments";

describe("cleanupAppliedSegments", () => {
  it("deletes an applied, aged segment", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gladlog-test-"));
    try {
      const syncFolderRoot = path.join(tempDir, "sync");
      const logsDir = path.join(tempDir, "logs");
      fs.mkdirSync(syncFolderRoot, { recursive: true });
      fs.mkdirSync(logsDir, { recursive: true });

      const N = 100;
      const data = Buffer.alloc(N, 65);
      const gzip = gzipSync(data);

      const key = buildSegmentKey("host1", "app.log", "gen12345", 0, N);
      const segmentPath = path.join(syncFolderRoot, key);
      fs.mkdirSync(path.dirname(segmentPath), { recursive: true });
      fs.writeFileSync(segmentPath, gzip);

      const ref = parseSegmentKey(key)!;
      const outName = outputNameFor(ref);
      const outPath = path.join(logsDir, outName);
      fs.writeFileSync(outPath, Buffer.alloc(N, 66));

      const nowMs = Date.now();
      const mtime = new Date(nowMs - 8 * 24 * 60 * 60 * 1000);
      fs.utimesSync(segmentPath, mtime, mtime);

      const result = await cleanupAppliedSegments({
        syncFolderRoot,
        logsDir,
        cleanupAfterDays: 7,
        nowMs,
      });

      expect(result.deleted).toContain(key);
      expect(result.kept).toBe(0);
      expect(fs.existsSync(segmentPath)).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps a not-yet-applied segment", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gladlog-test-"));
    try {
      const syncFolderRoot = path.join(tempDir, "sync");
      const logsDir = path.join(tempDir, "logs");
      fs.mkdirSync(syncFolderRoot, { recursive: true });
      fs.mkdirSync(logsDir, { recursive: true });

      const N = 100;
      const data = Buffer.alloc(N, 65);
      const gzip = gzipSync(data);

      const key = buildSegmentKey("host1", "app.log", "gen12345", 0, N);
      const segmentPath = path.join(syncFolderRoot, key);
      fs.mkdirSync(path.dirname(segmentPath), { recursive: true });
      fs.writeFileSync(segmentPath, gzip);

      const nowMs = Date.now();
      const mtime = new Date(nowMs - 8 * 24 * 60 * 60 * 1000);
      fs.utimesSync(segmentPath, mtime, mtime);

      const result = await cleanupAppliedSegments({
        syncFolderRoot,
        logsDir,
        cleanupAfterDays: 7,
        nowMs,
      });

      expect(result.deleted).toHaveLength(0);
      expect(result.kept).toBe(1);
      expect(fs.existsSync(segmentPath)).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps a length-mismatch segment", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gladlog-test-"));
    try {
      const syncFolderRoot = path.join(tempDir, "sync");
      const logsDir = path.join(tempDir, "logs");
      fs.mkdirSync(syncFolderRoot, { recursive: true });
      fs.mkdirSync(logsDir, { recursive: true });

      // gzip of 40 bytes stored under a key claiming length 50
      const data = Buffer.alloc(40, 65);
      const gzip = gzipSync(data);

      const key = buildSegmentKey("host1", "app.log", "gen12345", 0, 50);
      const segmentPath = path.join(syncFolderRoot, key);
      fs.mkdirSync(path.dirname(segmentPath), { recursive: true });
      fs.writeFileSync(segmentPath, gzip);

      const ref = parseSegmentKey(key)!;
      const outName = outputNameFor(ref);
      const outPath = path.join(logsDir, outName);
      fs.writeFileSync(outPath, Buffer.alloc(100, 66)); // output file of size >= 50

      const nowMs = Date.now();
      const mtime = new Date(nowMs - 8 * 24 * 60 * 60 * 1000);
      fs.utimesSync(segmentPath, mtime, mtime);

      const result = await cleanupAppliedSegments({
        syncFolderRoot,
        logsDir,
        cleanupAfterDays: 7,
        nowMs,
      });

      expect(result.deleted).toHaveLength(0);
      expect(result.kept).toBe(1);
      expect(fs.existsSync(segmentPath)).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

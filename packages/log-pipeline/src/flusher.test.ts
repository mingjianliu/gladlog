import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { flushFile } from "./flusher";
import { parseSegmentKey } from "./protocol/segments";
import { MemoryStorageAdapter } from "./storage/MemoryStorageAdapter";

describe("flushFile", () => {
  it("writes one length-encoded, gzipped segment for the delta", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flush-"));
    const filePath = join(dir, "WoWCombatLog.txt");
    const body = "1/1 line one\n2/2 line two\n";
    writeFileSync(filePath, body);
    const adapter = new MemoryStorageAdapter();
    const out = await flushFile({
      filePath,
      logFileName: "WoWCombatLog.txt",
      hostname: "pc",
      checkpoint: undefined,
      adapter,
    });
    expect(out.flushedBytes).toBe(Buffer.byteLength(body));
    const keys = await adapter.list("raw/");
    expect(keys).toHaveLength(1);
    const ref = parseSegmentKey(keys[0])!;
    expect(ref.startOffset).toBe(0);
    expect(ref.length).toBe(Buffer.byteLength(body));
    expect(gunzipSync(await adapter.get(keys[0])).toString()).toBe(body);
  });
});

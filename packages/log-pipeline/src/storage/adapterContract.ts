import { beforeEach, describe, expect, it } from "vitest";

import { StorageAdapter } from "./StorageAdapter";

/**
 * Contract every StorageAdapter implementation must pass. New adapters get
 * correctness-checked by calling this with a factory. Keys here are opaque to
 * the adapter (it stores bytes at flat keys), so they need not match the
 * segment-key grammar.
 */
export function describeStorageAdapterContract(
  name: string,
  factory: () => Promise<StorageAdapter>,
): void {
  describe(`StorageAdapter contract: ${name}`, () => {
    let adapter: StorageAdapter;
    beforeEach(async () => {
      adapter = await factory();
    });

    it("round-trips put → get", async () => {
      const body = Buffer.from("hello 🌍 bytes\x00\x01");
      await adapter.put("raw/h/f.txt/gen/000000000000.seg", body);
      expect(await adapter.get("raw/h/f.txt/gen/000000000000.seg")).toEqual(
        body,
      );
    });

    it("lists keys under a prefix in lexicographic order", async () => {
      await adapter.put("raw/h/f/g/000000000010.seg", Buffer.from("b"));
      await adapter.put("raw/h/f/g/000000000002.seg", Buffer.from("a"));
      await adapter.put("status/h.json", Buffer.from("{}"));
      const keys = await adapter.list("raw/");
      expect(keys).toEqual([
        "raw/h/f/g/000000000002.seg",
        "raw/h/f/g/000000000010.seg",
      ]);
    });

    it("put is an idempotent overwrite", async () => {
      await adapter.put("k/a", Buffer.from("v1"));
      await adapter.put("k/a", Buffer.from("v2"));
      expect((await adapter.get("k/a")).toString()).toBe("v2");
      expect(await adapter.list("k/")).toEqual(["k/a"]);
    });

    it("list of an unknown prefix returns empty", async () => {
      expect(await adapter.list("nope/")).toEqual([]);
    });

    it("get of a missing key rejects", async () => {
      await expect(adapter.get("missing")).rejects.toBeTruthy();
    });

    it("delete removes a key and is idempotent for missing keys", async () => {
      await adapter.put("k/gone", Buffer.from("x"));
      await adapter.delete("k/gone");
      expect(await adapter.list("k/")).toEqual([]);
      await expect(adapter.delete("k/gone")).resolves.toBeUndefined();
      await expect(adapter.delete("never/existed")).resolves.toBeUndefined();
    });
  });
}

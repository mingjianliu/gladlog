/**
 * verify/captureFileKey — a capture file is known by its archive, round and
 * owner, so two captures of one manifest pair up whatever their shard counts
 * (T208: `captureFamilyDiff` paired by shard path and reported phantom
 * duplicate lines).
 */
import { describe, expect, it } from "vitest";

import { captureFileKey } from "../scripts/verify/captureFileKey";

const file = (archive: string, owner: string) =>
  `${archive}\n${owner}\nARENA MATCH — ANALYSIS REQUEST\n`;

describe("captureFileKey", () => {
  it("is the same for one owner's file in two shard layouts and under two archive roots", () => {
    const a = captureFileKey(
      "context",
      "12-3-80.txt",
      file("/home/a/archive-gz/2026/08/13/abc.txt.gz", "Me-Realm"),
    );
    const b = captureFileKey(
      "context",
      "4-3-27.txt",
      file("/Users/b/corpus/archive-gz/2026/08/13/abc.txt.gz", "Me-Realm"),
    );
    expect(a).toBe("context/abc.txt.gz#3#Me-Realm");
    expect(b).toBe(a);
  });

  it("tells apart another round, another owner, another archive and the findings file", () => {
    const at = (sub: string, name: string, archive: string, owner: string) =>
      captureFileKey(sub, name, file(archive, owner));
    const keys = [
      at("context", "1-1-1.txt", "/x/abc.txt.gz", "Me-Realm"),
      at("context", "1-2-2.txt", "/x/abc.txt.gz", "Me-Realm"),
      at("context", "1-1-3.txt", "/x/abc.txt.gz", "Mate-Realm"),
      at("context", "2-1-4.txt", "/x/def.txt.gz", "Me-Realm"),
      at("findings", "1-1-1.txt", "/x/abc.txt.gz", "Me-Realm"),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives no key to a file that is not a capture file", () => {
    expect(captureFileKey("context", "summary.txt", file("/x/a", "Me"))).toBe(
      undefined,
    );
    expect(captureFileKey("context", "1-1-1.txt", "one line only")).toBe(
      undefined,
    );
    expect(captureFileKey("context", "1-1-1.txt", "\n\n")).toBe(undefined);
  });
});

/**
 * verify/captureHash.ts — the capture hash depends neither on the shard a
 * context landed in nor on where the corpus sits on the capturing machine
 * (T203, GH #221), and still moves with any rendered line.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  archiveKeyOf,
  archiveRootOf,
  captureHashLine,
  captureHashOf,
} from "../scripts/verify/captureHash";

const tmp = mkdtempSync(join(tmpdir(), "capture-hash-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

interface IOwner {
  /** archive path under the corpus root */
  rel: string;
  round: number;
  owner: string;
  context: string;
  menu?: string;
}

const OWNERS: IOwner[] = [
  { rel: "2026/08/13/aa.txt.gz", round: 1, owner: "A-Realm", context: "ctx a" },
  { rel: "2026/08/13/aa.txt.gz", round: 2, owner: "A-Realm", context: "ctx b" },
  { rel: "2026/08/14/bb.txt.gz", round: 1, owner: "B-Realm", context: "ctx c" },
  { rel: "2026/09/01/cc.txt.gz", round: 1, owner: "C-Realm", context: "ctx d" },
];

/** a capture of `owners` as `corpusRoot` would write it, round-robin over
 * `shards` shards (file and owner numbers are per shard, as in a real one) */
function writeCapture(
  name: string,
  corpusRoot: string,
  shards: number,
  owners: IOwner[] = OWNERS,
): string {
  const out = join(tmp, name);
  for (let k = 0; k < shards; k++) {
    mkdirSync(join(out, `s${k}`, "context"), { recursive: true });
    mkdirSync(join(out, `s${k}`, "findings"), { recursive: true });
  }
  const archives = [...new Set(owners.map((o) => o.rel))];
  const ownerNo = Array.from({ length: shards }, () => 0);
  for (const o of owners) {
    const i = archives.indexOf(o.rel);
    const k = i % shards;
    const file = `${Math.floor(i / shards) + 1}-${o.round}-${++ownerNo[k]!}.txt`;
    const head = `${corpusRoot}${o.rel}\n${o.owner}\n`;
    writeFileSync(join(out, `s${k}`, "context", file), head + o.context);
    if (o.menu !== "")
      writeFileSync(
        join(out, `s${k}`, "findings", file),
        `${head}${o.menu ?? "menu"}`,
      );
  }
  return out;
}

describe("capture hash (verify/captureHash.ts)", () => {
  it("archive root: the deepest directory holding every absolute path", () => {
    expect(archiveRootOf(["/a/b/2026/08/x.gz", "/a/b/2026/09/y.gz"])).toBe(
      "/a/b/2026/",
    );
    expect(archiveRootOf(["/a/b/x.gz"])).toBe("/a/b/");
    // a directory name that only shares a prefix is not a common directory
    expect(archiveRootOf(["/a/bc/x.gz", "/a/bd/y.gz"])).toBe("/a/");
    expect(archiveRootOf(["2026/08/x.gz"])).toBe("");
    expect(archiveKeyOf("/a/b/2026/08/x.gz", "/a/b/")).toBe("2026/08/x.gz");
    expect(archiveKeyOf("2026/08/x.gz", "")).toBe("2026/08/x.gz");
  });

  it("two machines: another corpus path and shard count, the same hash", () => {
    const mac = captureHashOf(writeCapture("mac", "/Users/u/corpus/gz/", 3));
    const wsl = captureHashOf(
      writeCapture("wsl", "/home/v/eval/corpus/gz/", 2),
    );
    expect(mac.owners).toBe(4);
    expect(mac.root).toBe("/Users/u/corpus/gz/2026/");
    expect(wsl.root).toBe("/home/v/eval/corpus/gz/2026/");
    expect(wsl.sha).toBe(mac.sha);
    expect(captureHashLine(mac)).toBe(
      `${mac.sha}  4 owners  archive-relative\n`,
    );
  });

  it("a changed context line, menu line or archive moves it", () => {
    const base = captureHashOf(writeCapture("base", "/r/", 2)).sha;
    const variants: IOwner[][] = [
      OWNERS.map((o, i) => (i === 2 ? { ...o, context: "ctx C" } : o)),
      OWNERS.map((o, i) => (i === 1 ? { ...o, menu: "menu 2" } : o)),
      OWNERS.map((o, i) =>
        i === 3 ? { ...o, rel: "2026/09/02/cc.txt.gz" } : o,
      ),
      OWNERS.map((o, i) => (i === 0 ? { ...o, owner: "Z-Realm" } : o)),
    ];
    variants.forEach((v, n) =>
      expect(captureHashOf(writeCapture(`v${n}`, "/r/", 2, v)).sha).not.toBe(
        base,
      ),
    );
  });

  it("a context with no findings file is named, and counted per shard", () => {
    const h = captureHashOf(
      writeCapture(
        "nomenu",
        "/r/",
        2,
        OWNERS.map((o, i) => (i === 3 ? { ...o, menu: "" } : o)),
      ),
    );
    expect(h.noMenu).toHaveLength(1);
    expect(h.perShard).toEqual([3, 1]);
  });
});

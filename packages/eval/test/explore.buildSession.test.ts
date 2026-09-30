import type { RawStreams } from "@gladlog/analysis";
import { describe, expect, it } from "vitest";

import {
  makeRoundQuery,
  prescreen,
  seededShuffle,
} from "../src/explore/buildSession";

describe("prescreen", () => {
  const query = (argv: string[]) => {
    if (argv[0] !== "cd") throw new Error("usage");
    return ["## cd @ 1:33", "1:33 Foo ready: 圣盾术 | onCd: 圣光术"];
  };
  it("verifies a line that the query reproduces", () => {
    const [r] = prescreen(
      [{ cmd: "cd --t 93", line: "1:33 Foo ready: 圣盾术 | onCd: 圣光术" }],
      query,
    );
    expect(r.verdict).toBe("verified");
  });
  it("flags a line the query does not reproduce as mismatch", () => {
    const [r] = prescreen(
      [{ cmd: "cd --t 93", line: "1:33 Foo ready: 圣光术" }],
      query,
    );
    expect(r.verdict).toBe("mismatch");
  });
  it("flags an invalid cmd as unverifiable", () => {
    const [r] = prescreen([{ cmd: "nope --t 1", line: "x" }], query);
    expect(r.verdict).toBe("unverifiable");
  });
});

describe("seededShuffle", () => {
  it("is deterministic per seed and permutes", () => {
    const a = seededShuffle([1, 2, 3, 4, 5, 6, 7, 8], "s1");
    expect(seededShuffle([1, 2, 3, 4, 5, 6, 7, 8], "s1")).toEqual(a);
    expect(a.slice().sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe("makeRoundQuery", () => {
  const legacy = {} as Parameters<typeof makeRoundQuery>[0];
  const raw = { available: true } as unknown as RawStreams;
  it("hands mana/drink the round's raw streams, loaded once", () => {
    let loads = 0;
    const seen: Array<RawStreams | undefined> = [];
    const q = makeRoundQuery(
      legacy,
      () => (loads++, raw),
      (_l, _argv, r) => (seen.push(r), []),
    );
    q(["mana", "--unit", "X"]);
    q(["drink"]);
    expect(seen).toEqual([raw, raw]);
    expect(loads).toBe(1);
  });
  it("never loads raw streams for the other subcommands", () => {
    let loads = 0;
    const seen: Array<RawStreams | undefined> = [];
    const q = makeRoundQuery(
      legacy,
      () => (loads++, raw),
      (_l, _argv, r) => (seen.push(r), []),
    );
    q(["cd", "--t", "93"]);
    expect(seen).toEqual([undefined]);
    expect(loads).toBe(0);
  });
});

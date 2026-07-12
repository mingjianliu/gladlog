import { describe, expect, it } from "vitest";
import { writeFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadBundledCorpus, gameBuildFromManifest } from "./corpusLoader";

describe("corpusLoader", () => {
  it("reads + memoizes the corpus, returns null on missing file", () => {
    const dir = mkdtempSync(join(tmpdir(), "corpus-"));
    const p = join(dir, "reference_vectors.json");
    writeFileSync(
      p,
      JSON.stringify({
        wowPatchVersion: "12.1.0",
        builtAt: "now",
        sourceFloor: 2300,
        buildGroups: {},
        cells: [],
      }),
    );
    let calls = 0;
    const load = loadBundledCorpus(() => {
      calls++;
      return p;
    });
    expect(load()!.wowPatchVersion).toBe("12.1.0");
    expect(load()!.cells).toEqual([]);
    expect(calls).toBe(1); // memoized: resolver called once
    const missing = loadBundledCorpus(() => join(dir, "nope.json"));
    expect(missing()).toBeNull();
  });
  it("reads the build from a game-data manifest", () => {
    expect(gameBuildFromManifest({ build: "12.1.0.68629" })).toBe(
      "12.1.0.68629",
    );
    expect(gameBuildFromManifest({})).toBe("0.0.0.0");
  });
});

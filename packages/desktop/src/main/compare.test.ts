import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createCompareService } from "./compare";
import { PROMPT_VERSION } from "./ai";
import type { ReferenceCorpus } from "@gladlog/analysis";

const corpus: ReferenceCorpus = {
  wowPatchVersion: "12.1.0.68629",
  builtAt: "now",
  sourceFloor: 2300,
  buildGroups: {
    "Discipline Priest": {
      keystoneNodeIds: [82585],
      match: "any",
      groupPresent: "offensive",
      groupAbsent: "standard",
    },
  },
  cells: [
    {
      spec: "Discipline Priest",
      bracket: "3v3",
      archetype: "hybrid",
      buildGroup: "offensive",
      sampleN: 40,
      insufficient: false,
      metrics: { offensiveIndex: { p10: 0.2, p50: 0.49, p90: 0.7, n: 40 } },
      exemplarCrises: [],
    },
    {
      // build-agnostic bracket parent — the fallback target when fail-open
      // forces buildGroup="*".
      spec: "Discipline Priest",
      bracket: "3v3",
      archetype: "*",
      buildGroup: "*",
      sampleN: 200,
      insufficient: false,
      metrics: { offensiveIndex: { p10: 0.2, p50: 0.4, p90: 0.6, n: 200 } },
      exemplarCrises: [],
    },
  ],
};

function svc(
  streamText: string,
  opts?: { apiKey?: string | null; build?: string },
) {
  const emitted: Array<{ ch: string; p: any }> = [];
  const s = createCompareService({
    getSettings: () => ({
      // respect an explicit null (nullish `??` would coerce it back to "k")
      anthropicApiKey: opts && "apiKey" in opts ? (opts.apiKey ?? null) : "k",
      anthropicModel: "claude-sonnet-5",
      wowDirectory: null,
    }),
    clientFactory: () => ({
      async *stream() {
        yield { delta: streamText };
      },
    }),
    loadCorpus: () => corpus,
    gameBuild: () => opts?.build ?? "12.1.0.68629",
    matchesDir: "/tmp/nonexistent-" + Math.random(),
    emit: (ch, p) => emitted.push({ ch, p }),
  });
  return { s, emitted };
}
const input = {
  matchId: "m1",
  healerMetrics: { offensiveIndex: 0.31 },
  spec: "Discipline Priest",
  talents: [82585],
  bracket: "3v3",
  archetype: "hybrid",
  wowBuild: "12.1.0.68629",
};

describe("createCompareService", () => {
  it("getCached returns null when the stored corpusVersion or promptVersion is stale", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cmp-"));
    const mk = (corpusVer: string) =>
      createCompareService({
        getSettings: () => ({
          anthropicApiKey: "k",
          anthropicModel: "m",
          wowDirectory: null,
        }),
        clientFactory: () => ({
          async *stream() {
            yield { delta: "" };
          },
        }),
        loadCorpus: () => ({ ...corpus, wowPatchVersion: corpusVer }),
        gameBuild: () => corpusVer,
        matchesDir: dir,
        emit: () => {},
      });
    mkdirSync(join(dir, "m1"), { recursive: true });
    writeFileSync(
      join(dir, "m1", "compare.json"),
      JSON.stringify({
        corpusVersion: "12.1.0.68629",
        promptVersion: PROMPT_VERSION,
        result: {
          verifiedComparison: { dims: [], facts: {} },
          report: "cached",
          droppedReason: null,
          cellMeta: null,
        },
      }),
    );
    expect((await mk("12.1.0.68629").getCached("m1"))?.report).toBe("cached"); // versions match
    expect(await mk("99.9.9.9").getCached("m1")).toBeNull(); // corpus version changed → stale
  });
  it("interpolates placeholders and returns a verified report for the offensive build", async () => {
    const { s, emitted } = svc(
      "You hit {{offensiveIndex}} vs {{offensiveIndex.cohortMedian}}.",
    );
    await s.run(input);
    const done = emitted.find((e) => e.ch === "gladlog:compare:done")!;
    expect(done.p.result.report).toBe("You hit 0.31 vs 0.49.");
    expect(done.p.result.droppedReason).toBeNull();
    expect(done.p.result.cellMeta.buildGroup).toBe("offensive");
  });
  it("drops prose and returns numbers-only on a claimChecker violation", async () => {
    const { s, emitted } = svc("Your index of 0.85 is great.");
    await s.run(input);
    const done = emitted.find((e) => e.ch === "gladlog:compare:done")!;
    expect(done.p.result.report).toBeNull();
    expect(done.p.result.droppedReason).toMatch(/claim/i);
    expect(done.p.result.verifiedComparison.dims.length).toBeGreaterThan(0);
  });
  it("fail-open: a stale corpus major version forces buildGroup='*'", async () => {
    const { s, emitted } = svc("ok {{offensiveIndex}}", {
      build: "13.0.0.99999",
    });
    await s.run(input);
    const done = emitted.find((e) => e.ch === "gladlog:compare:done")!;
    expect(done.p.result.cellMeta.buildGroup).toBe("*");
  });
  it("no API key: returns numbers-only without error", async () => {
    const { s, emitted } = svc("unused", { apiKey: null });
    await s.run(input);
    const done = emitted.find((e) => e.ch === "gladlog:compare:done")!;
    expect(done.p.result.report).toBeNull();
    expect(
      emitted.find((e) => e.ch === "gladlog:compare:error"),
    ).toBeUndefined();
  });
});

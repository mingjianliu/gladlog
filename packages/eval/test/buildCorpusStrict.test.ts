/**
 * codex 30-RV-01 #3 — a prompt-generation error must not shrink a gate run's
 * corpus. Fault injection as in the review: context generation throws on the
 * second round of a real two-match log. Without `strict` buildCorpus warns
 * and keeps 1 entry (what `realLogGates` used to accept); with `strict` the
 * build fails, and `expectedCorpusRoundIds` sees the missing round either
 * way. Needs `GLADLOG_FIXTURES` (as buildCorpus.test.ts); vi.mock — never
 * list this file in vitest.shared.json.
 */
import { existsSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildCorpus } from "../src/corpus/buildCorpus";
import { expectedCorpusRoundIds } from "./helpers/corpusRounds";

const fault = vi.hoisted(() => ({ calls: 0, throwOn: 2 }));
vi.mock("@gladlog/analysis", async (orig) => {
  const real = await orig<typeof import("@gladlog/analysis")>();
  return {
    ...real,
    buildMatchContext: (...args: Parameters<typeof real.buildMatchContext>) => {
      if (++fault.calls === fault.throwOn)
        throw new Error("injected: context generation failed");
      return real.buildMatchContext(...args);
    },
  };
});

const FIX = process.env.GLADLOG_FIXTURES ?? "";
const log = join(FIX, "two_matches.txt");
const d = FIX !== "" && existsSync(log) ? describe : describe.skip;

d("buildCorpus — a generation error cannot silently drop rounds", () => {
  beforeEach(() => {
    fault.calls = 0;
  });

  it("the log has two recorder rounds to lose", () => {
    expect(expectedCorpusRoundIds(log, "recorder")).toHaveLength(2);
  });

  it("strict: an error on round 2 fails the build", async () => {
    await expect(
      buildCorpus({
        logPaths: [log],
        outDir: mkdtempSync(join(tmpdir(), "gl-strict-")),
        ownerFilter: "recorder",
        strict: true,
      }),
    ).rejects.toThrow(/two_matches\.txt.*injected/);
  });

  it("not strict: the shrunk set no longer matches the parser's rounds", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { entries } = await buildCorpus({
      logPaths: [log],
      outDir: mkdtempSync(join(tmpdir(), "gl-lenient-")),
      ownerFilter: "recorder",
    });
    warn.mockRestore();
    expect(entries.map((e) => e.matchId)).not.toEqual(
      expectedCorpusRoundIds(log, "recorder"),
    );
  });
});

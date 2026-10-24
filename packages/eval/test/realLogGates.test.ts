/**
 * Every real arena log in `GLADLOG_FIXTURES`, every round, three owner views
 * (healer / dps / recorder) → the prompt the app builds → every hardFailure
 * gate (`checkMatch`). Zero allowed.
 *
 * Why (weekly review 2026-10-24): 299 fixes in three weeks, none caught by a
 * unit test — the unit tests met only the logs their authors imagined. The
 * first run of this pipeline over the public wowarenalogs testlogs found two
 * product bugs no test had: COMBATANT_INFO decoding dropped players whose
 * interesting-auras list was three pairs (21 of 165 lines; rounds ran 3v2),
 * and a zhTW client's spell name leaked onto [KICK] lines (44 hardFailures).
 *
 * The logs are third-party data and never committed (DATA-COMPLIANCE §4):
 * CI's `real-logs` job sparse-checks-out a pinned commit of the public
 * repository at runtime and points `GLADLOG_FIXTURES` at it. Locally:
 *   GLADLOG_FIXTURES=<dir of .txt logs> npx vitest run --root packages/eval realLogGates
 * Without the variable the suite is skipped, as the parser's real-log
 * suites are.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";

import { buildCorpus, type IndexEntry } from "../src/corpus/buildCorpus";
import type { CoverageManifest } from "../src/quality/coverageManifest";
import { checkMatch } from "../src/quality/promptQualityCheck";

const FIX = process.env.GLADLOG_FIXTURES ?? "";
const logs =
  FIX && existsSync(FIX)
    ? readdirSync(FIX)
        .filter((f) => f.endsWith(".txt"))
        // a battleground is not an arena match: no owner view of it is built
        .filter((f) => !f.startsWith("bg_"))
        .map((f) => join(FIX, f))
    : [];
const d = logs.length > 0 ? describe : describe.skip;

d("real logs → prompts → every hardFailure gate", () => {
  for (const ownerFilter of ["healer", "dps", "recorder"] as const)
    it(`${ownerFilter} view: no hardFailure on any round`, async () => {
      const out = mkdtempSync(join(tmpdir(), `gl-real-${ownerFilter}-`));
      const { entries } = await buildCorpus({
        logPaths: logs,
        outDir: out,
        ownerFilter,
      });
      expect(entries.length).toBeGreaterThan(0);
      const failures: string[] = [];
      for (const e of entries as IndexEntry[]) {
        const nnn = String(e.ordinal).padStart(3, "0");
        const manifest = JSON.parse(
          readFileSync(join(out, "manifests", `${nnn}.json`), "utf-8"),
        ) as CoverageManifest;
        const prompt = readFileSync(join(out, e.file), "utf-8");
        for (const f of checkMatch(e, prompt, manifest).hardFailures)
          failures.push(`${nnn} ${e.matchId.slice(0, 8)}: ${f}`);
      }
      expect(failures).toEqual([]);
    }, 600_000);
});

import { existsSync, mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildCorpus } from "../src/corpus/buildCorpus";

const FIX = process.env.GLADLOG_FIXTURES ?? "";
const fixtureLogPath = join(FIX, "3v3_tww_1120_reduced.txt");
const d = FIX !== "" && existsSync(fixtureLogPath) ? describe : describe.skip;

d("buildCorpus", () => {
  it("真实 3v3 日志 → 语料落盘齐全、指纹格式正确", async () => {
    const out = mkdtempSync(join(tmpdir(), "gl-corpus-"));
    const { entries, fingerprint } = await buildCorpus({
      logPaths: [fixtureLogPath],
      outDir: out,
      ownerFilter: "healer",
    });
    expect(entries.length).toBeGreaterThan(0);
    expect(fingerprint).toMatch(/^\d+: [^.]{1,8}\.\.[^.]{1,8}$/);
    for (const e of entries) {
      expect(typeof e.ordinal).toBe("number");
      expect(typeof e.matchId).toBe("string");
      expect(typeof e.spec).toBe("string");
      expect(typeof e.result).toBe("string");
      const prompt = readFileSync(join(out, e.file), "utf-8");
      expect(prompt.length).toBeGreaterThan(500);
      expect(
        existsSync(
          join(out, "manifests", `${String(e.ordinal).padStart(3, "0")}.json`),
        ),
      ).toBe(true);
    }
    const idx = JSON.parse(readFileSync(join(out, "index.json"), "utf-8"));
    expect(idx).toEqual(entries);
    expect(readFileSync(join(out, "fingerprint.txt"), "utf-8").trim()).toBe(
      fingerprint,
    );
  });
});

import { createHash } from "crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { checkScoreProvenance } from "../src/provenance/checkScoreProvenance";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const PROMPT = "prompt body for ordinal 1";
const RESPONSE = "response body for ordinal 1";

function makeRun(): string {
  const dir = mkdtempSync(join(tmpdir(), "gl-prov-"));
  mkdirSync(join(dir, "prompts"), { recursive: true });
  mkdirSync(join(dir, "responses"), { recursive: true });
  mkdirSync(join(dir, "scores"), { recursive: true });
  writeFileSync(join(dir, "prompts", "001-abc.txt"), PROMPT);
  writeFileSync(join(dir, "responses", "001.txt"), RESPONSE);
  return dir;
}

function validScore(): Record<string, unknown> {
  return {
    prompt: { sufficiency: 3, noise: 4, labelBias: 5 },
    response: {
      inferenceScaffolding: 4,
      accuracy: 3,
      outcomeAlignment: 5,
      focusCalibration: 4,
    },
    factAudit: [
      { claim: "death at 0:24", verdict: "verified", evidence: "line 12" },
      { claim: "kick at 0:31", verdict: "verified", evidence: "line 19" },
      { claim: "trinket at 0:40", verdict: "unsupported", evidence: "absent" },
    ],
    provenance: {
      judgeModel: "test-judge",
      judgedAt: "2026-07-11T00:00:00Z",
      promptSha256: sha256(PROMPT),
      responseSha256: sha256(RESPONSE),
    },
  };
}

function writeScore(dir: string, score: Record<string, unknown>) {
  writeFileSync(join(dir, "scores", "001.json"), JSON.stringify(score));
}

describe("checkScoreProvenance(严格,无 legacy 宽容)", () => {
  it("合法 score → ok=1 fail=0", () => {
    const dir = makeRun();
    writeScore(dir, validScore());
    const r = checkScoreProvenance(dir);
    expect(r.ok).toBe(1);
    expect(r.fail).toBe(0);
    expect(r.failures).toEqual([]);
  });

  it("缺 provenance → FAIL,reason 含 provenance", () => {
    const dir = makeRun();
    const s = validScore();
    delete s.provenance;
    writeScore(dir, s);
    const r = checkScoreProvenance(dir);
    expect(r.fail).toBe(1);
    expect(r.failures[0].reason).toMatch(/provenance/i);
  });

  it("sha256 不匹配 → FAIL", () => {
    const dir = makeRun();
    const s = validScore();
    (s.provenance as Record<string, string>).promptSha256 = sha256("tampered");
    writeScore(dir, s);
    const r = checkScoreProvenance(dir);
    expect(r.fail).toBe(1);
    expect(r.failures[0].reason).toMatch(/sha256|hash|mismatch/i);
  });

  it("缺一维(focusCalibration)→ FAIL,reason 点名维度", () => {
    const dir = makeRun();
    const s = validScore();
    delete (s.response as Record<string, unknown>).focusCalibration;
    writeScore(dir, s);
    const r = checkScoreProvenance(dir);
    expect(r.fail).toBe(1);
    expect(r.failures[0].reason).toMatch(/focusCalibration/);
  });

  it("维度值越界(6)或非整数 → FAIL", () => {
    const dir = makeRun();
    const s = validScore();
    (s.prompt as Record<string, unknown>).noise = 6;
    writeScore(dir, s);
    expect(checkScoreProvenance(dir).fail).toBe(1);

    const dir2 = makeRun();
    const s2 = validScore();
    (s2.prompt as Record<string, unknown>).noise = 3.5;
    writeScore(dir2, s2);
    expect(checkScoreProvenance(dir2).fail).toBe(1);
  });

  it("factAudit 少于 3 条或缺 claim/verdict → FAIL", () => {
    const dir = makeRun();
    const s = validScore();
    (s.factAudit as unknown[]).pop();
    writeScore(dir, s);
    expect(checkScoreProvenance(dir).fail).toBe(1);

    const dir2 = makeRun();
    const s2 = validScore();
    delete (s2.factAudit as Record<string, unknown>[])[0].verdict;
    writeScore(dir2, s2);
    expect(checkScoreProvenance(dir2).fail).toBe(1);
  });

  it("judgeModel 空 → FAIL", () => {
    const dir = makeRun();
    const s = validScore();
    (s.provenance as Record<string, string>).judgeModel = "";
    writeScore(dir, s);
    expect(checkScoreProvenance(dir).fail).toBe(1);
  });

  it("scores 目录不存在 → ok=0 fail=0(无事可查)", () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-prov-"));
    const r = checkScoreProvenance(dir);
    expect(r.ok).toBe(0);
    expect(r.fail).toBe(0);
  });
});

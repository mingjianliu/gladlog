import { createHash } from "crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  FACT_AUDIT_MAX,
  FACT_AUDIT_MIN,
  checkScoreProvenance,
} from "../src/provenance/checkScoreProvenance";

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
    ordinal: 1,
    matchId: "abc12345",
    spec: "Holy Priest",
    result: "Loss",
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

  /** 2026-07-20:PASS 1 审计集改为规则确定(全部含 M:SS 的断言句,有上限,不足下限
   *  时补齐),合法长度因此是 [FACT_AUDIT_MIN, FACT_AUDIT_MAX] —— 第 4 条不再是错误。
   *  两个用例都从常量推出条数,不写死数字:2026-07-20 与 07-21 两次改上限都因为
   *  这里写死而漏改(见 CLAUDE.md「门规谓词即规范」)。 */
  const padTo = (s: Record<string, unknown>, n: number) => {
    const fa = s.factAudit as unknown[];
    while (fa.length < n)
      fa.push({
        claim: `extra ${fa.length}`,
        verdict: "verified",
        evidence: "x",
      });
    return s;
  };

  it("factAudit 恰好到上限 → OK(规则集大小随回复而变)", () => {
    const dir = makeRun();
    const s = padTo(validScore(), FACT_AUDIT_MAX);
    expect((s.factAudit as unknown[]).length).toBe(FACT_AUDIT_MAX);
    writeScore(dir, s);
    expect(checkScoreProvenance(dir).fail).toBe(0);
  });

  it("factAudit 超过上限 → FAIL", () => {
    const dir = makeRun();
    writeScore(dir, padTo(validScore(), FACT_AUDIT_MAX + 1));
    const r = checkScoreProvenance(dir);
    expect(r.fail).toBe(1);
    expect(r.failures[0].reason).toMatch(
      new RegExp(`${FACT_AUDIT_MIN} to ${FACT_AUDIT_MAX}`),
    );
  });

  it("factAudit 缺 evidence 或 verdict 非枚举 → FAIL", () => {
    const dir = makeRun();
    const s = validScore();
    delete (s.factAudit as Record<string, unknown>[])[1].evidence;
    writeScore(dir, s);
    expect(checkScoreProvenance(dir).fail).toBe(1);

    const dir2 = makeRun();
    const s2 = validScore();
    (s2.factAudit as Record<string, unknown>[])[0].verdict = "maybe";
    writeScore(dir2, s2);
    const r2 = checkScoreProvenance(dir2);
    expect(r2.fail).toBe(1);
    expect(r2.failures[0].reason).toMatch(/verified\/refuted\/unsupported/);
  });

  it("缺根字段(spec)→ FAIL,reason 点名", () => {
    const dir = makeRun();
    const s = validScore();
    delete s.spec;
    writeScore(dir, s);
    const r = checkScoreProvenance(dir);
    expect(r.fail).toBe(1);
    expect(r.failures[0].reason).toMatch(/spec/);
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

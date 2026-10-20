import { createHash } from "crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import fs from "fs-extra";
import { tmpdir } from "os";
import os from "os";
import { join } from "path";
import path from "path";

import {
  checkScoreProvenance,
  computeAccuracyFromFactAudit,
  FACT_AUDIT_MAX,
  FACT_AUDIT_MIN,
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
      accuracy: 4,
      outcomeAlignment: 5,
      focusCalibration: 4,
    },
    factAudit: [
      { claim: "death at 0:24", verdict: "verified", evidence: "line 12" },
      { claim: "kick at 0:31", verdict: "verified", evidence: "line 19" },
      {
        claim: "trinket at 0:40",
        verdict: "unsupported",
        evidence: "absent",
        severity: "minor",
      },
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

  /** 2026-07-20: the PASS 1 audit set became rule-determined (every assertive
   *  sentence containing an M:SS timestamp, capped at a maximum and padded when
   *  below the minimum), so the legal length is
   *  [FACT_AUDIT_MIN, FACT_AUDIT_MAX] — a 4th entry is no longer an error.
   *  Both cases derive their counts from the constants and never hard-code a
   *  number: the two changes to the cap on 2026-07-20 and 07-21 were both
   *  missed here precisely because it was hard-coded (see "the gate predicate
   *  IS the spec" in CLAUDE.md). */
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

describe("computeAccuracyFromFactAudit(子项目 A 设计一)", () => {
  const v = (verdict: string, severity?: string) => ({
    claim: "c",
    evidence: "e",
    verdict,
    ...(severity ? { severity } : {}),
  });

  it("零错 → 5;1/2 小错 → 4/3;≥3 小错 → 2", () => {
    expect(computeAccuracyFromFactAudit([v("verified")])).toBe(5);
    expect(
      computeAccuracyFromFactAudit([v("verified"), v("refuted", "minor")]),
    ).toBe(4);
    expect(
      computeAccuracyFromFactAudit([
        v("refuted", "minor"),
        v("unsupported", "minor"),
      ]),
    ).toBe(3);
    expect(
      computeAccuracyFromFactAudit([
        v("refuted", "minor"),
        v("refuted", "minor"),
        v("unsupported", "minor"),
      ]),
    ).toBe(2);
  });

  it("任一 fabricated → 1,与小错条数无关", () => {
    expect(
      computeAccuracyFromFactAudit([v("verified"), v("refuted", "fabricated")]),
    ).toBe(1);
    expect(
      computeAccuracyFromFactAudit([
        v("refuted", "minor"),
        v("refuted", "minor"),
        v("refuted", "minor"),
        v("unsupported", "fabricated"),
      ]),
    ).toBe(1);
  });

  it("unsupported 与 refuted 同为 1 错(causal-hardening 先例)", () => {
    expect(
      computeAccuracyFromFactAudit([v("verified"), v("unsupported", "minor")]),
    ).toBe(4);
  });
});

describe("checkScoreProvenance:severity 与 accuracy 一致性(子项目 A)", () => {
  // 自包含的 tmpdir run 构造器:除被测点外全合格。
  // (import 需要:crypto 的 createHash、fs-extra、os、path —— 若文件顶部已有则复用。)
  async function makeRun(
    factAudit: Record<string, unknown>[],
    accuracy: number,
  ): Promise<string> {
    const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "prov-a-"));
    await fs.ensureDir(path.join(runDir, "prompts"));
    await fs.ensureDir(path.join(runDir, "responses"));
    await fs.ensureDir(path.join(runDir, "scores"));
    const promptText = "PROMPT body";
    const responseText = "RESPONSE body";
    await fs.writeFile(
      path.join(runDir, "prompts", "001-mid.txt"),
      promptText,
      "utf8",
    );
    await fs.writeFile(
      path.join(runDir, "responses", "001.txt"),
      responseText,
      "utf8",
    );
    const sha = (s: string) => createHash("sha256").update(s).digest("hex");
    await fs.writeJson(path.join(runDir, "scores", "001.json"), {
      ordinal: 1,
      matchId: "mid",
      spec: "Holy Paladin",
      result: "Loss",
      factAudit,
      prompt: {
        sufficiency: 4,
        noise: 3,
        labelBias: 4,
        inferenceScaffolding: 4,
      },
      response: { accuracy, outcomeAlignment: 4, focusCalibration: 4 },
      provenance: {
        judgeModel: "test-judge",
        judgedAt: "2026-08-05T00:00:00Z",
        promptSha256: sha(promptText),
        responseSha256: sha(responseText),
      },
    });
    return runDir;
  }
  const fa = (verdict: string, severity?: string) => ({
    claim: "claim text",
    evidence: "evidence line",
    verdict,
    ...(severity ? { severity } : {}),
  });

  it("非 verified 条目缺 severity ⇒ FAIL(理由含 severity)", async () => {
    const runDir = await makeRun(
      [fa("verified"), fa("verified"), fa("refuted")],
      4,
    );
    const res = checkScoreProvenance(runDir);
    expect(res.fail).toBe(1);
    expect(res.failures[0].reason).toMatch(/severity/);
  });

  it("accuracy 与计算值不符 ⇒ FAIL(理由含 factAudit-derived)", async () => {
    const runDir = await makeRun(
      [fa("verified"), fa("verified"), fa("verified")],
      4, // 计算值应为 5
    );
    const res = checkScoreProvenance(runDir);
    expect(res.fail).toBe(1);
    expect(res.failures[0].reason).toMatch(/factAudit-derived/);
  });

  it("accuracy 等于计算值且 severity 齐全 ⇒ OK", async () => {
    const runDir = await makeRun(
      [fa("verified"), fa("verified"), fa("refuted", "minor")],
      4,
    );
    const res = checkScoreProvenance(runDir);
    expect(res.ok).toBe(1);
    expect(res.fail).toBe(0);
  });
});

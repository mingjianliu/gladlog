import fs from "fs-extra";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";

import {
  buildHaloArms,
  copyResponsesAcrossArms,
} from "../src/halo/buildHaloArms.js";
import { computeHaloStats } from "../src/halo/haloStats.js";
import { redactOutcomeLabels } from "../src/halo/redactOutcome.js";

// 头行格式锚定 buildMatchContext.ts:802 的渲染模板(共享谓词:eval 重新解析
// analysis 渲染文本;模板改了这里必须跟着红)。
const header = (result: string) =>
  [
    "ARENA MATCH — DECISION ANALYSIS REQUEST",
    "",
    "MATCH SUMMARY",
    `  Spec: Holy Paladin (Healer)  |  Bracket: 3v3  |  Result: ${result}  |  Duration: 2:19  |  Map: Ruins of Lordaeron`,
    "  My team: Holy Paladin, Assassination Rogue, Arms Warrior",
    "  Deaths: Holy Paladin (my team, 1:55)",
    "",
  ].join("\n");

describe("redactOutcomeLabels", () => {
  it("Win → Unknown,仅该 token 变化,其余字节不变", () => {
    const input = header("Win") + "SUPPORTING DATA\n  0:12 something\n";
    const out = redactOutcomeLabels(input);
    expect(out.result).toBe("Win");
    expect(out.text).toBe(
      header("Unknown") + "SUPPORTING DATA\n  0:12 something\n",
    );
  });

  it("Loss → Unknown", () => {
    const out = redactOutcomeLabels(header("Loss"));
    expect(out.result).toBe("Loss");
    expect(out.text).toBe(header("Unknown"));
  });

  it("零个 Result: 标签 → throw", () => {
    expect(() => redactOutcomeLabels("no label here\n")).toThrow(/exactly 1/);
  });

  it("多个 Result: 标签 → throw", () => {
    expect(() => redactOutcomeLabels(header("Win") + header("Loss"))).toThrow(
      /exactly 1/,
    );
  });

  it("Result: Unknown(已无果,无从涂抹)→ throw", () => {
    expect(() => redactOutcomeLabels(header("Unknown"))).toThrow(/unusable/);
  });

  it("正文含其他显式赛果措辞 → throw(最小干预失效守卫)", () => {
    expect(() =>
      redactOutcomeLabels(header("Win") + "a well-earned victory\n"),
    ).toThrow(/outcome wording/);
  });
});

describe("buildHaloArms", () => {
  async function makeSourceDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "halo-src-"));
    const entries = [
      {
        ordinal: 1,
        file: "prompts/001-aaaa.txt",
        matchId: "aaaa",
        spec: "Holy Paladin",
        result: "Win",
      },
      {
        ordinal: 2,
        file: "prompts/002-bbbb.txt",
        matchId: "bbbb",
        spec: "Discipline Priest",
        result: "Loss",
      },
      {
        ordinal: 3,
        file: "prompts/003-cccc.txt",
        matchId: "cccc",
        spec: "Restoration Druid",
        result: "Win",
      },
      {
        ordinal: 4,
        file: "prompts/004-dddd.txt",
        matchId: "dddd",
        spec: "Mistweaver Monk",
        result: "Loss",
      },
    ];
    await fs.ensureDir(path.join(dir, "prompts"));
    for (const e of entries)
      await fs.writeFile(
        path.join(dir, e.file),
        header(e.result) + `BODY of ${e.matchId}\n`,
        "utf8",
      );
    await fs.writeJson(path.join(dir, "index.json"), entries);
    return dir;
  }

  it("定种子分层抽样;treatment 仅 Result token 与 control 不同;两臂 index 一致", async () => {
    const src = await makeSourceDir();
    const out = path.join(src, "halo");
    const res = await buildHaloArms({
      sourceDir: src,
      outDir: out,
      nPerStratum: 1,
      seed: 42,
    });
    expect(res).toEqual({ pairs: 2, wins: 1, losses: 1 });

    const controlIndex = await fs.readJson(
      path.join(out, "control", "index.json"),
    );
    const treatmentIndex = await fs.readJson(
      path.join(out, "treatment", "index.json"),
    );
    expect(treatmentIndex).toEqual(controlIndex);
    expect(controlIndex).toHaveLength(2);
    const results = controlIndex
      .map((e: { result: string }) => e.result)
      .sort();
    expect(results).toEqual(["Loss", "Win"]);

    for (const e of controlIndex) {
      const c = await fs.readFile(path.join(out, "control", e.file), "utf8");
      const t = await fs.readFile(path.join(out, "treatment", e.file), "utf8");
      expect(c).toContain(`Result: ${e.result}`);
      expect(t).toBe(c.replace(`Result: ${e.result}`, "Result: Unknown"));
    }

    // 可复现:同种子再建一次选中同一批 ordinal
    const out2 = path.join(src, "halo2");
    await buildHaloArms({
      sourceDir: src,
      outDir: out2,
      nPerStratum: 1,
      seed: 42,
    });
    const index2 = await fs.readJson(path.join(out2, "control", "index.json"));
    expect(index2.map((e: { ordinal: number }) => e.ordinal)).toEqual(
      controlIndex.map((e: { ordinal: number }) => e.ordinal),
    );

    // sample-meta 记录种子与选中 ordinal
    const meta = await fs.readJson(path.join(out, "sample-meta.json"));
    expect(meta.seed).toBe(42);
    expect(meta.ordinals).toEqual(
      controlIndex.map((e: { ordinal: number }) => e.ordinal),
    );
  });

  it("index result 与 prompt 内标签矛盾 → throw(语料完整性交叉核对)", async () => {
    const src = await makeSourceDir();
    await fs.writeFile(
      path.join(src, "prompts/001-aaaa.txt"),
      header("Loss") + "BODY\n", // index 说 Win,文件是 Loss
      "utf8",
    );
    await expect(
      buildHaloArms({
        sourceDir: src,
        outDir: path.join(src, "halo"),
        nPerStratum: 1,
        seed: 42,
      }),
    ).rejects.toThrow(/mismatch/);
  });

  it("层内样本不足 → throw", async () => {
    const src = await makeSourceDir();
    await expect(
      buildHaloArms({
        sourceDir: src,
        outDir: path.join(src, "halo"),
        nPerStratum: 3,
        seed: 42,
      }),
    ).rejects.toThrow(/stratum/);
  });

  it("copyResponsesAcrossArms 复制 control 回复到 treatment;空目录 throw", async () => {
    const src = await makeSourceDir();
    const out = path.join(src, "halo");
    await buildHaloArms({
      sourceDir: src,
      outDir: out,
      nPerStratum: 1,
      seed: 42,
    });
    await expect(copyResponsesAcrossArms(out)).rejects.toThrow(/no responses/);
    await fs.writeFile(
      path.join(out, "control", "responses", "001.txt"),
      "MATCHID: aaaa\n\nadvice",
      "utf8",
    );
    const n = await copyResponsesAcrossArms(out);
    expect(n).toBe(1);
    expect(
      await fs.readFile(
        path.join(out, "treatment", "responses", "001.txt"),
        "utf8",
      ),
    ).toBe("MATCHID: aaaa\n\nadvice");
  });
});

describe("computeHaloStats", () => {
  async function makeHaloDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "halo-stats-"));
    const index = [
      {
        ordinal: 1,
        file: "prompts/001-aaaa.txt",
        matchId: "aaaa",
        spec: "s",
        result: "Win",
      },
      {
        ordinal: 2,
        file: "prompts/002-bbbb.txt",
        matchId: "bbbb",
        spec: "s",
        result: "Win",
      },
      {
        ordinal: 3,
        file: "prompts/003-cccc.txt",
        matchId: "cccc",
        spec: "s",
        result: "Loss",
      },
      {
        ordinal: 4,
        file: "prompts/004-dddd.txt",
        matchId: "dddd",
        spec: "s",
        result: "Loss",
      },
    ];
    await fs.ensureDir(path.join(dir, "control"));
    await fs.writeJson(path.join(dir, "control", "index.json"), index);
    await fs.ensureDir(path.join(dir, "blind", "scores"));
    const mapping: unknown[] = [];
    let blindN = 0;
    for (const e of index) {
      for (const arm of ["control", "treatment"] as const) {
        const blindId = `item-${String(++blindN).padStart(2, "0")}`;
        mapping.push({ blindId, arm, ordinal: e.ordinal, matchId: e.matchId });
        // 构造:accuracy 有纯光环(Win 场标签抬 1 分,Loss 场标签压 1 分);
        // noise 无效应;outcomeAlignment 涂抹后一律 −2(rubric 切换)。
        const isTreatment = arm === "treatment";
        const halo =
          e.result === "Win" ? (isTreatment ? -1 : 0) : isTreatment ? 1 : 0;
        await fs.writeJson(
          path.join(dir, "blind", "scores", `${blindId}.json`),
          {
            matchId: blindId,
            prompt: {
              sufficiency: 4,
              noise: 3,
              labelBias: 4,
              inferenceScaffolding: 4,
            },
            response: {
              accuracy: 3 + halo,
              outcomeAlignment: isTreatment ? 2 : 4,
              focusCalibration: 4,
            },
          },
        );
      }
    }
    await fs.writeJson(path.join(dir, "blind", "mapping.json"), { mapping });
    return dir;
  }

  it("对齐差:纯光环维 contaminated,无效应维 inconclusive,outcomeAlignment 恒 expected-change", async () => {
    const report = await computeHaloStats(await makeHaloDir());
    expect(report.pairs).toBe(4);
    expect(report.missingScores).toBe(0);
    const by = new Map(report.stats.map((s) => [s.dimension, s]));

    const acc = by.get("accuracy")!;
    // Win 场 raw Δ = R−O = −1(对齐 +1);Loss 场 raw Δ = +1(对齐 +1)⇒ 全体 +1
    expect(acc.alignedMean).toBe(1);
    expect(acc.winRawMean).toBe(-1);
    expect(acc.lossRawMean).toBe(1);
    expect(acc.verdict).toBe("contaminated");

    const noise = by.get("noise")!;
    expect(noise.alignedMean).toBe(0);
    expect(noise.verdict).toBe("inconclusive");

    const oa = by.get("outcomeAlignment")!;
    expect(oa.verdict).toBe("expected-change");
    expect(oa.winRawMean).toBe(-2);
    expect(oa.lossRawMean).toBe(-2);
  });

  it("缺分数的 ordinal 整对丢弃并计数", async () => {
    const dir = await makeHaloDir();
    await fs.remove(path.join(dir, "blind", "scores", "item-01.json"));
    const report = await computeHaloStats(dir);
    expect(report.missingScores).toBe(1);
    const acc = report.stats.find((s) => s.dimension === "accuracy")!;
    expect(acc.n).toBe(3);
  });
});

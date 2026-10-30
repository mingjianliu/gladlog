import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import fs from "fs-extra";
import { tmpdir } from "os";
import os from "os";
import { join } from "path";
import path from "path";

import {
  aggregateReplicates,
  bootstrapCI,
  collectReplicateFiles,
  DIMENSIONS,
  dimensionScore,
  makeRng,
  medianOf,
  signTestP,
} from "../src/ab/abCompareStats";
import { buildBlindPool } from "../src/ab/blindAbPool";
import {
  buildPlantedAb,
  plantTimestampError,
} from "../src/ab/plantTimestampError";

describe("abCompareStats 数学 golden", () => {
  it("signTestP 精确二项:全正 3 → p=0.25;对称 → p=1;tie 剔除;空 → p=1", () => {
    expect(signTestP([1, 1, 1]).p).toBeCloseTo(0.25, 10);
    const s = signTestP([1, -1]);
    expect(s.p).toBeCloseTo(1, 10);
    expect(signTestP([1, 0, -1]).ties).toBe(1);
    expect(signTestP([]).p).toBe(1);
    expect(signTestP([1, 1, 1, 1]).p).toBeCloseTo(0.125, 10);
  });

  it("bootstrapCI 确定性:同种子同输入两次同值;常数样本退化为该常数;lo≤hi", () => {
    const a = bootstrapCI([0.5, 0.5, 0.5], makeRng(1337));
    expect(a.lo).toBe(0.5);
    expect(a.hi).toBe(0.5);
    const b1 = bootstrapCI([1, -1, 2, 0], makeRng(42));
    const b2 = bootstrapCI([1, -1, 2, 0], makeRng(42));
    expect(b1).toEqual(b2);
    expect(b1.lo).toBeLessThanOrEqual(b1.hi);
  });

  it("makeRng 输出严格 ∈ [0,1):任何种子高频抽样不返回 1", () => {
    for (const seed of [1, 42, 1337, 0xffffffff]) {
      const rng = makeRng(seed);
      for (let i = 0; i < 20000; i++) {
        const v = rng();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  it("dimensionScore:数字化字符串强转(与校准侧一致),真非数值 null", () => {
    expect(
      dimensionScore({ prompt: { noise: "4" }, response: {} }, "noise"),
    ).toBe(4);
    expect(
      dimensionScore({ prompt: {}, response: { accuracy: "3" } }, "accuracy"),
    ).toBe(3);
  });

  it("dimensionScore:prompt 侧优先,response 侧回落,非数值 null", () => {
    expect(
      dimensionScore({ prompt: { noise: 4 }, response: {} }, "noise"),
    ).toBe(4);
    expect(
      dimensionScore({ prompt: {}, response: { accuracy: 3 } }, "accuracy"),
    ).toBe(3);
    expect(
      dimensionScore({ prompt: { noise: "x" }, response: {} }, "noise"),
    ).toBeNull();
  });

  it("DIMENSIONS 为 7 维且顺序固定", () => {
    expect(DIMENSIONS).toEqual([
      "sufficiency",
      "noise",
      "labelBias",
      "inferenceScaffolding",
      "accuracy",
      "outcomeAlignment",
      "focusCalibration",
    ]);
  });
});

function makeArm(
  abDir: string,
  arm: "control" | "treatment",
  entries: { ordinal: number; matchId: string; badHeader?: boolean }[],
) {
  const armDir = join(abDir, arm);
  mkdirSync(join(armDir, "prompts"), { recursive: true });
  mkdirSync(join(armDir, "responses"), { recursive: true });
  const index = entries.map((e) => {
    const nnn = String(e.ordinal).padStart(3, "0");
    const file = `prompts/${nnn}.txt`;
    writeFileSync(join(armDir, file), `prompt ${arm} ${e.ordinal}`);
    const headerId = e.badHeader ? "WRONG-ID" : e.matchId;
    writeFileSync(
      join(armDir, "responses", `${nnn}.txt`),
      `MATCHID: ${headerId}\n\nresponse ${arm} ${e.ordinal}`,
    );
    return {
      ordinal: e.ordinal,
      file,
      matchId: e.matchId,
      spec: "Holy Priest",
      result: "loss",
    };
  });
  writeFileSync(join(armDir, "index.json"), JSON.stringify(index, null, 2));
}

describe("buildBlindPool", () => {
  it("双臂 2 ordinal → 4 items、响应剥头、mapping 全覆盖且 blindId 互异", async () => {
    const abDir = mkdtempSync(join(tmpdir(), "gl-ab-"));
    makeArm(abDir, "control", [
      { ordinal: 1, matchId: "aaaa1111" },
      { ordinal: 2, matchId: "bbbb2222" },
    ]);
    makeArm(abDir, "treatment", [
      { ordinal: 1, matchId: "aaaa1111" },
      { ordinal: 2, matchId: "bbbb2222" },
    ]);
    const r = await buildBlindPool(abDir);
    expect(r.items).toBe(4);
    expect(r.pairs).toBe(2);
    const itemDirs = readdirSync(join(abDir, "blind", "items")).sort();
    expect(itemDirs).toHaveLength(4);
    for (const id of itemDirs) {
      const resp = readFileSync(
        join(abDir, "blind", "items", id, "response.txt"),
        "utf-8",
      );
      expect(resp).not.toMatch(/^MATCHID:/);
      expect(existsSync(join(abDir, "blind", "items", id, "prompt.txt"))).toBe(
        true,
      );
    }
    const { mapping } = JSON.parse(
      readFileSync(join(abDir, "blind", "mapping.json"), "utf-8"),
    );
    expect(mapping).toHaveLength(4);
    expect(
      new Set(mapping.map((m: { blindId: string }) => m.blindId)).size,
    ).toBe(4);
    expect(existsSync(join(abDir, "blind", "scores"))).toBe(true);
  });

  it("MATCHID 头与 index 不符 → 该 ordinal 被剔除", async () => {
    const abDir = mkdtempSync(join(tmpdir(), "gl-ab-"));
    makeArm(abDir, "control", [
      { ordinal: 1, matchId: "aaaa1111", badHeader: true },
      { ordinal: 2, matchId: "bbbb2222" },
    ]);
    makeArm(abDir, "treatment", [
      { ordinal: 1, matchId: "aaaa1111" },
      { ordinal: 2, matchId: "bbbb2222" },
    ]);
    const r = await buildBlindPool(abDir);
    expect(r.pairs).toBe(1);
    expect(r.items).toBe(2);
  });
});

describe("K 重副本聚合(子项目 A 设计二)", () => {
  const rep = (accuracy: number, extra?: Record<string, number>) => ({
    factAudit:
      accuracy === 5
        ? [{ claim: "c", evidence: "e", verdict: "verified" }]
        : [
            { claim: "c", evidence: "e", verdict: "verified" },
            ...Array.from({ length: 5 - accuracy }, () => ({
              claim: "c",
              evidence: "e",
              verdict: "refuted",
              severity: "minor",
            })),
          ],
    prompt: {
      sufficiency: 4,
      noise: 3,
      labelBias: 4,
      inferenceScaffolding: 4,
      ...extra,
    },
    response: { accuracy, outcomeAlignment: 4, focusCalibration: 4 },
  });

  it("medianOf:奇数取中、偶数取均值", () => {
    expect(medianOf([3, 5, 4])).toBe(4);
    expect(medianOf([3, 4])).toBe(3.5);
    expect(medianOf([2])).toBe(2);
  });

  it("collectReplicateFiles:legacy 单文件与 .rN 副本都能收齐,N 升序", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "krep-"));
    await fs.writeJson(path.join(dir, "item-01.r2.json"), {});
    await fs.writeJson(path.join(dir, "item-01.r1.json"), {});
    await fs.writeJson(path.join(dir, "item-02.json"), {});
    expect(
      collectReplicateFiles(dir, "item-01").map((p) => path.basename(p)),
    ).toEqual(["item-01.r1.json", "item-01.r2.json"]);
    expect(
      collectReplicateFiles(dir, "item-02").map((p) => path.basename(p)),
    ).toEqual(["item-02.json"]);
    expect(collectReplicateFiles(dir, "item-03")).toEqual([]);
  });

  it("aggregateReplicates:逐维中位数;accuracy 以 factAudit 计算值为准并计 mismatch", () => {
    const bad = rep(4);
    (bad.response as { accuracy: number }).accuracy = 5; // 谎报:factAudit 只支持 4
    const out = aggregateReplicates([
      rep(3) as never,
      rep(5) as never,
      bad as never,
    ]);
    expect(out).not.toBeNull();
    // accuracy 参与值 = [3, 5, 4(计算值)] → 中位数 4
    expect(out!.score.response!.accuracy).toBe(4);
    expect(out!.accuracyMismatches).toBe(1);
    // 无 factAudit 影响的维度照常中位数
    expect(out!.score.prompt!.noise).toBe(3);
  });

  it("aggregateReplicates:0 份 → null;无 factAudit 的份按记录值参与(legacy 分数文件)", () => {
    expect(aggregateReplicates([])).toBeNull();
    const legacy = { prompt: { noise: 2 }, response: { accuracy: 5 } };
    const out = aggregateReplicates([legacy as never]);
    expect(out!.score.response!.accuracy).toBe(5);
    expect(out!.accuracyMismatches).toBe(0);
  });
});

describe("plantTimestampError(子项目 A 验收工具)", () => {
  it("首个 M:SS 秒数 +3,其余字节不变", () => {
    const out = plantTimestampError(
      "at 0:42 the kick landed; later 1:10 again",
    );
    expect(out.text).toBe("at 0:45 the kick landed; later 1:10 again");
    expect(out.planted).toBe("0:42 -> 0:45");
  });

  it("秒数进位:0:58 -> 1:01", () => {
    const out = plantTimestampError("spike at 0:58 was decisive");
    expect(out.text).toBe("spike at 1:01 was decisive");
  });

  it("无时间戳 → throw", () => {
    expect(() => plantTimestampError("no timestamps here")).toThrow(
      /timestamp/,
    );
  });

  it("buildPlantedAb:两臂 index 一致;恰 plantFraction 比例被种植且记录于 plant-meta", async () => {
    const src = await fs.mkdtemp(path.join(os.tmpdir(), "plant-src-"));
    const entries = [1, 2, 3, 4].map((n) => ({
      ordinal: n,
      file: `prompts/00${n}-m${n}.txt`,
      matchId: `m${n}`,
      spec: "s",
      result: n % 2 ? "Win" : "Loss",
    }));
    await fs.ensureDir(path.join(src, "prompts"));
    await fs.ensureDir(path.join(src, "responses"));
    for (const e of entries) {
      await fs.writeFile(path.join(src, e.file), `PROMPT ${e.matchId}`, "utf8");
      await fs.writeFile(
        path.join(src, "responses", `00${e.ordinal}.txt`),
        `MATCHID: ${e.matchId}\n\nthe spike at 0:42 decided it`,
        "utf8",
      );
    }
    await fs.writeJson(path.join(src, "index.json"), entries);

    const out = path.join(src, "planted");
    const res = await buildPlantedAb({
      sourceArmDir: src,
      outDir: out,
      nPairs: 4,
      plantFraction: 0.5,
      seed: 7,
    });
    expect(res).toEqual({ pairs: 4, planted: 2 });
    const meta = await fs.readJson(path.join(out, "plant-meta.json"));
    expect(meta.plantedOrdinals).toHaveLength(2);
    const controlIdx = await fs.readJson(
      path.join(out, "control", "index.json"),
    );
    const treatIdx = await fs.readJson(
      path.join(out, "treatment", "index.json"),
    );
    expect(treatIdx).toEqual(controlIdx);
    // 被种植件 treatment 回复含 0:45,未种植件与 control 一字不差
    for (const e of controlIdx) {
      const o = String(e.ordinal).padStart(3, "0");
      const c = await fs.readFile(
        path.join(out, "control", "responses", `${o}.txt`),
        "utf8",
      );
      const t = await fs.readFile(
        path.join(out, "treatment", "responses", `${o}.txt`),
        "utf8",
      );
      if (meta.plantedOrdinals.includes(e.ordinal)) expect(t).toContain("0:45");
      else expect(t).toBe(c);
    }
  });

describe("abCompareStats main", () => {
  it("processes mapping and scores, and writes output", async () => {
    const abDir = mkdtempSync(join(tmpdir(), "gl-ab-main-"));
    const blindDir = join(abDir, "blind");
    mkdirSync(blindDir, { recursive: true });
    mkdirSync(join(blindDir, "scores"), { recursive: true });
    
    fs.writeJsonSync(join(blindDir, "mapping.json"), {
      mapping: [
        { blindId: "b1", arm: "control", ordinal: 1, matchId: "m1" },
        { blindId: "b2", arm: "treatment", ordinal: 1, matchId: "m1" },
      ]
    });
    
    fs.writeJsonSync(join(blindDir, "scores", "b1.json"), {
      prompt: { noise: 3 },
      response: { accuracy: 4 },
      matchId: "b1"
    });
    fs.writeJsonSync(join(blindDir, "scores", "b2.json"), {
      prompt: { noise: 2 },
      response: { accuracy: 5 },
      matchId: "b2"
    });
    
    process.env.AB_DIR = abDir;
    
    const ab = await import("../src/ab/abCompareStats");
    // Ensure we don't exit process if there is a problem
    const exitMock = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
    await ab.main();
    exitMock.mockRestore();
    
    const stats = fs.readJsonSync(join(abDir, "comparison-stats.json"));
    expect(stats.pairs).toBe(1);
    
    const accStats = stats.stats.find((s: any) => s.dimension === "accuracy");
    expect(accStats.meanDelta).toBe(1); // treatment 5 - control 4
    
    const noiseStats = stats.stats.find((s: any) => s.dimension === "noise");
    expect(noiseStats.meanDelta).toBe(-1); // treatment 2 - control 3
  });
});
});

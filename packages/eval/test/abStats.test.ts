import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  readdirSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  signTestP,
  bootstrapCI,
  makeRng,
  dimensionScore,
  DIMENSIONS,
} from "../src/ab/abCompareStats";
import { buildBlindPool } from "../src/ab/blindAbPool";

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

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { buildCalibrationSuite } from "../src/judge/buildCalibrationSuite";
import { checkCalibration } from "../src/judge/checkCalibration";

function makeTmpRunWithTwoPairs(): string {
  const base = mkdtempSync(join(tmpdir(), "gl-cal-"));
  mkdirSync(join(base, "prompts"), { recursive: true });
  mkdirSync(join(base, "responses"), { recursive: true });
  const eventLines = Array.from(
    { length: 30 },
    (_, i) =>
      `[0:${String(i + 10).padStart(2, "0")}] Kidney Shot lands on Holy Priest for ${100 + i}`,
  ).join("\n");
  const prompt = `MATCH SUMMARY\n  Spec: Holy Priest\nTIMELINE\n${eventLines}\n`;
  const response =
    "Your positioning was solid in the opener, and the early cooldown trades went your way.\n\n" +
    "The death at 0:24 traces directly to the trinket timing: holding it through the first stun " +
    "meant the follow-up Kidney Shot connected at full duration while your defensive was still queued.\n\n" +
    "Keep pre-casting before the stun window closes, and track the enemy interrupt so your clutch " +
    "cast is not thrown into a guaranteed lockout.";
  const index = [1, 2].map((ordinal) => {
    const nnn = String(ordinal).padStart(3, "0");
    writeFileSync(join(base, "prompts", `${nnn}-m${ordinal}.txt`), prompt);
    writeFileSync(join(base, "responses", `${nnn}.txt`), response);
    return {
      ordinal,
      file: `prompts/${nnn}-m${ordinal}.txt`,
      matchId: `m${ordinal}`,
      spec: "Holy Priest",
      result: ordinal === 1 ? "Win" : "Loss",
    };
  });
  writeFileSync(join(base, "index.json"), JSON.stringify(index, null, 2));
  return base;
}

function readCase(
  base: string,
  caseId: string,
): { prompt: string; response: string } {
  const dir = join(base, "judge-calibration", "cases", caseId);
  return {
    prompt: readFileSync(join(dir, "prompt.txt"), "utf-8"),
    response: readFileSync(join(dir, "response.txt"), "utf-8"),
  };
}

describe("buildCalibrationSuite", () => {
  it("固定种子:每源含 none 对照;扰动件与原文不同且有目标维度;manifest 全覆盖;可复现", async () => {
    const base = makeTmpRunWithTwoPairs();
    const cases = await buildCalibrationSuite(base, {
      sourceCount: 2,
      seed: 42,
    });
    expect(cases.length).toBeGreaterThanOrEqual(4);
    const byOrdinal = new Map<number, typeof cases>();
    for (const c of cases) {
      byOrdinal.set(c.sourceOrdinal, [
        ...(byOrdinal.get(c.sourceOrdinal) ?? []),
        c,
      ]);
    }
    for (const group of byOrdinal.values()) {
      const none = group.find((c) => c.perturbation === "none");
      expect(none).toBeDefined();
      const original = readCase(base, none!.caseId);
      for (const c of group.filter((g) => g.perturbation !== "none")) {
        expect(c.targetDimension).toBeTruthy();
        const perturbed = readCase(base, c.caseId);
        expect(perturbed.prompt + perturbed.response).not.toBe(
          original.prompt + original.response,
        );
      }
    }
    const manifest = JSON.parse(
      readFileSync(
        join(base, "judge-calibration", "calibration-manifest.json"),
        "utf-8",
      ),
    );
    expect(manifest.cases).toHaveLength(cases.length);
    expect(existsSync(join(base, "judge-calibration", "scores"))).toBe(true);

    const again = await buildCalibrationSuite(makeTmpRunWithTwoPairs(), {
      sourceCount: 2,
      seed: 42,
    });
    expect(again.map((c) => c.perturbation).sort()).toEqual(
      cases.map((c) => c.perturbation).sort(),
    );
  });
});

describe("checkCalibration", () => {
  it("目标维度未降分的扰动件 → 计为未检出;全维汇报", async () => {
    const base = makeTmpRunWithTwoPairs();
    const cases = await buildCalibrationSuite(base, {
      sourceCount: 2,
      seed: 42,
    });
    const scoresDir = join(base, "judge-calibration", "scores");
    const allDims = {
      sufficiency: 4,
      noise: 4,
      labelBias: 4,
      inferenceScaffolding: 4,
      accuracy: 4,
      outcomeAlignment: 4,
      focusCalibration: 4,
    };
    for (const c of cases) {
      // 所有件打同分 → 任何扰动件都未被检出(目标维度未低于 none 对照)
      writeFileSync(
        join(scoresDir, `${c.caseId}.json`),
        JSON.stringify({ prompt: allDims, response: {} }),
      );
    }
    const r = await checkCalibration(base);
    expect(r.pass).toBe(false);
    expect(r.failures.length).toBeGreaterThan(0);
  });
});

const DIMS = [
  "sufficiency",
  "noise",
  "labelBias",
  "inferenceScaffolding",
  "accuracy",
  "outcomeAlignment",
  "focusCalibration",
] as const;

/** Ground-truth coverage manifest matching makeTmpRun's prompt: one friendly
 * Holy Priest death at 0:24. The sufficiency det-gate reads these — a run
 * without manifests/ cannot adjudicate sufficiency at all. */
function writeCoverageManifest(base: string, ordinal: number): void {
  const nnn = String(ordinal).padStart(3, "0");
  mkdirSync(join(base, "manifests"), { recursive: true });
  writeFileSync(
    join(base, "manifests", `${nnn}.json`),
    JSON.stringify({
      matchId: `m${ordinal}`,
      durationSec: 60,
      players: [
        { name: "Priesty-Realm-US", spec: "Holy Priest", reaction: "friendly" },
      ],
      deaths: [
        { tRelSec: 24, unitName: "Priesty-Realm-US", reaction: "friendly" },
      ],
      ccApplied: [],
      interrupts: [],
      dispels: [],
      trinketCasts: [],
      counts: {
        deaths: 1,
        friendlyDeaths: 1,
        ccApplied: 0,
        interrupts: 0,
        dispels: 0,
        trinketCasts: 0,
      },
    }),
  );
}

/** Build a run whose PROMPT contains a death line (so removed-deaths fires) and
 * enough event lines for every perturbation to trigger — one perturbation per
 * dimension per source, i.e. `sourceCount` pairs per dimension. */
function makeTmpRun(sourceCount: number): string {
  const base = mkdtempSync(join(tmpdir(), "gl-cal2-"));
  mkdirSync(join(base, "prompts"), { recursive: true });
  mkdirSync(join(base, "responses"), { recursive: true });
  const eventLines = Array.from(
    { length: 30 },
    (_, i) =>
      `[0:${String(i + 10).padStart(2, "0")}] Kidney Shot lands on Holy Priest for ${100 + i}`,
  );
  eventLines.push("[0:24] Holy Priest died to a Kidney Shot follow-up");
  const prompt = `MATCH SUMMARY\n  Spec: Holy Priest\nTIMELINE\n${eventLines.join("\n")}\n`;
  const response =
    "Your positioning was solid in the opener, and the early cooldown trades went your way.\n\n" +
    "The death at 0:24 traces directly to the trinket timing: holding it through the first stun " +
    "meant the follow-up Kidney Shot connected at full duration while your defensive was still queued.\n\n" +
    "Keep pre-casting before the stun window closes, and track the enemy interrupt so your clutch " +
    "cast is not thrown into a guaranteed lockout.";
  const index = Array.from({ length: sourceCount }, (_, k) => {
    const ordinal = k + 1;
    const nnn = String(ordinal).padStart(3, "0");
    writeFileSync(join(base, "prompts", `${nnn}-m${ordinal}.txt`), prompt);
    writeFileSync(join(base, "responses", `${nnn}.txt`), response);
    writeCoverageManifest(base, ordinal);
    return {
      ordinal,
      file: `prompts/${nnn}-m${ordinal}.txt`,
      matchId: `m${ordinal}`,
      spec: "Holy Priest",
      result: ordinal % 2 === 1 ? "Win" : "Loss",
    };
  });
  writeFileSync(join(base, "index.json"), JSON.stringify(index, null, 2));
  return base;
}

interface ManifestCase {
  caseId: string;
  perturbation: string;
  targetDimension: string | null;
}

/** Write per-case scores. `score(dim, isPerturbed, targetDim)` returns the value
 * the judge assigns to `dim` for a case (none-control when !isPerturbed).
 * Returning `null` OMITS the dimension entirely; returning a string writes it
 * verbatim (to exercise string-numeric handling). */
function writeScores(
  base: string,
  score: (
    dim: string,
    isPerturbed: boolean,
    targetDim: string | null,
    perturbation?: string,
  ) => number | string | null,
): void {
  const scoresDir = join(base, "judge-calibration", "scores");
  const manifest = JSON.parse(
    readFileSync(
      join(base, "judge-calibration", "calibration-manifest.json"),
      "utf-8",
    ),
  ) as { cases: ManifestCase[] };
  for (const c of manifest.cases) {
    const isPerturbed = c.perturbation !== "none";
    const prompt: Record<string, number | string> = {};
    for (const d of DIMS) {
      const v = score(d, isPerturbed, c.targetDimension, c.perturbation);
      if (v !== null) prompt[d] = v;
    }
    writeFileSync(
      join(scoresDir, `${c.caseId}.json`),
      JSON.stringify({ prompt, response: {} }),
    );
  }
}

describe("checkCalibration — discriminant validity (specificity)", () => {
  it("扣分只落在目标维度的判官 → PASS;对所有维度一律扣分的‘无脑差评’判官 → FAIL", async () => {
    // Discriminating judge: perturbed drops ONLY the targeted dim by 2.
    const discBase = makeTmpRun(2);
    await buildCalibrationSuite(discBase, { sourceCount: 2, seed: 42 });
    writeScores(discBase, (dim, isPerturbed, targetDim) =>
      isPerturbed && dim === targetDim ? 3 : 5,
    );
    const disc = await checkCalibration(discBase, {
      minPairs: 2,
      deltaFloor: 1,
      specificityTol: 0,
    });
    expect(disc.pass).toBe(true);

    // "Hater" judge: perturbed drops EVERY dimension by 2. Under a targeted-only
    // check this passes trivially; discriminant validity must reject it.
    const haterBase = makeTmpRun(2);
    await buildCalibrationSuite(haterBase, { sourceCount: 2, seed: 42 });
    writeScores(haterBase, (_dim, isPerturbed) => (isPerturbed ? 3 : 5));
    const hater = await checkCalibration(haterBase, {
      minPairs: 2,
      deltaFloor: 1,
      specificityTol: 0,
    });
    expect(hater.pass).toBe(false);
    expect(hater.failures.length).toBeGreaterThan(0);
  });
});

describe("checkCalibration — 构造性耦合维度豁免特异性", () => {
  /**
   * removed-deaths 删的是 **prompt** 里的死亡行,而 response 保持不动 —— 回复里
   * 关于那次死亡的主张于是真的不再被 prompt 支持,accuracy 本就该掉。这不是
   * 「凡文本变了就全维扣分」的无脑差评,是判官在正确地做事,却被特异性规则罚。
   *
   * 2026-07-20 全语料校准实测:11 个未检出里 9 个是特异性,逐条查渗漏维,
   * 10 条里 8 条是同一个 `accuracy 5→3`。sufficiency 被这条压到 20%,而其真实
   * 敏感性是 60%。
   *
   * 豁免必须**窄**:只有内容被删除的扰动才构造性耦合 accuracy。乱序
   * (shuffled-events)内容完整保留,每条主张仍可查证,accuracy 掉分是判官偷懒
   * 而不是构造使然 —— 那条必须继续严格。
   */
  it("removed-deaths:accuracy 同掉 → 仍算检出(构造性耦合)", async () => {
    const base = makeTmpRun(2);
    await buildCalibrationSuite(base, { sourceCount: 2, seed: 42 });
    writeScores(base, (dim, isPerturbed, targetDim, perturbation) => {
      if (!isPerturbed) return 5;
      if (dim === targetDim) return 3;
      if (perturbation === "removed-deaths" && dim === "accuracy") return 3;
      return 5;
    });
    const r = await checkCalibration(base, {
      minPairs: 2,
      deltaFloor: 1,
      specificityTol: 0,
    });
    // sufficiency 的对不再因 accuracy 同掉而被判特异性违规
    expect(
      r.failures.filter((f) => f.dimension === "sufficiency"),
    ).toHaveLength(0);
  });

  it("shuffled-events:accuracy 同掉 → 不算检出(内容未删,不构造性耦合)", async () => {
    const base = makeTmpRun(2);
    await buildCalibrationSuite(base, { sourceCount: 2, seed: 42 });
    writeScores(base, (dim, isPerturbed, targetDim, perturbation) => {
      if (!isPerturbed) return 5;
      if (dim === targetDim) return 3;
      if (perturbation === "shuffled-events" && dim === "accuracy") return 3;
      return 5;
    });
    const r = await checkCalibration(base, {
      minPairs: 2,
      deltaFloor: 1,
      specificityTol: 0,
    });
    // 乱序不豁免:accuracy 同掉仍判特异性违规
    expect(
      r.failures.filter((f) => f.dimension === "inferenceScaffolding").length,
    ).toBeGreaterThan(0);
  });
});

describe("checkCalibration — minimum pairs guard", () => {
  it("每维可评对数 < minPairs → 该维 INSUFFICIENT,整体不判 PASS", async () => {
    const base = makeTmpRun(2); // 2 pairs per dimension
    await buildCalibrationSuite(base, { sourceCount: 2, seed: 42 });
    writeScores(base, (dim, isPerturbed, targetDim) =>
      isPerturbed && dim === targetDim ? 3 : 5,
    );
    // Same perfect discriminator scores: passes at minPairs=2, insufficient at 3.
    const enough = await checkCalibration(base, {
      minPairs: 2,
      deltaFloor: 1,
      specificityTol: 0,
    });
    expect(enough.pass).toBe(true);
    const tooFew = await checkCalibration(base, {
      minPairs: 3,
      deltaFloor: 1,
      specificityTol: 0,
    });
    expect(tooFew.pass).toBe(false);
  });
});

describe("checkCalibration — targeted delta floor", () => {
  it("目标维度降幅低于 deltaFloor → 不计为检出", async () => {
    const base = makeTmpRun(2);
    await buildCalibrationSuite(base, { sourceCount: 2, seed: 42 });
    // Perturbed targeted dim drops by only 0.5; untargeted dims unchanged.
    writeScores(base, (dim, isPerturbed, targetDim) =>
      isPerturbed && dim === targetDim ? 7.5 : 8,
    );
    const strict = await checkCalibration(base, {
      minPairs: 2,
      deltaFloor: 1,
      specificityTol: 0,
    });
    expect(strict.pass).toBe(false); // 0.5 drop < 1.0 floor → undetected
    const lenient = await checkCalibration(base, {
      minPairs: 2,
      deltaFloor: 0.4,
      specificityTol: 0,
    });
    expect(lenient.pass).toBe(true); // 0.5 drop >= 0.4 floor → detected
  });
});

describe("checkCalibration — specificity completeness", () => {
  it("扰动件省略未目标维度(判官漏打分)→ 视为特异性违规,不给免费通过", async () => {
    const base = makeTmpRun(2);
    await buildCalibrationSuite(base, { sourceCount: 2, seed: 42 });
    // Control scores every dimension; perturbed case scores ONLY the targeted
    // dim (drops it) and OMITS all others — we cannot confirm they stayed put.
    writeScores(base, (dim, isPerturbed, targetDim) => {
      if (!isPerturbed) return 5;
      return dim === targetDim ? 3 : null; // null = omit from JSON
    });
    const r = await checkCalibration(base, {
      minPairs: 2,
      deltaFloor: 1,
      specificityTol: 0,
    });
    expect(r.pass).toBe(false);
    expect(r.failures.length).toBeGreaterThan(0);
  });
});

describe("checkCalibration — sufficiency 由确定性覆盖门裁决", () => {
  /**
   * BACKLOG 14.2 终稿(五次独立测量):removed-deaths 删光死亡行,判官 10 对里
   * 8 对零反应(5→5),三轮 rubric 改动零作用 —— 判官看不见构建器没放进来什么。
   * 裁决权移交确定性覆盖门:original 干净 + perturbed 报缺 → 检出,与判官盲分
   * 完全无关。下面第一个用例就是那个盲区场景本身:判官给 5→5,门照样检出。
   */
  it("判官 sufficiency 给 5→5(盲区场景)→ 门仍检出,该维无 failure", async () => {
    const base = makeTmpRun(2);
    await buildCalibrationSuite(base, { sourceCount: 2, seed: 42 });
    // 判官对所有件所有维一律 5 分 —— 对 removed-deaths 完全零反应。
    writeScores(base, () => 5);
    const r = await checkCalibration(base, {
      minPairs: 2,
      deltaFloor: 1,
      specificityTol: 0,
    });
    expect(
      r.failures.filter((f) => f.dimension === "sufficiency"),
    ).toHaveLength(0);
  });

  it("manifests/ 缺失 → sufficiency 不可裁决(NO DATA),整体不判 PASS", async () => {
    const base = makeTmpRun(2);
    await buildCalibrationSuite(base, { sourceCount: 2, seed: 42 });
    rmSync(join(base, "manifests"), { recursive: true, force: true });
    // 判官是完美判别器 —— 若 sufficiency 仍走判官,整体会 PASS;
    // 门守不住时必须显式失败,不许静默降级回判官。
    writeScores(base, (dim, isPerturbed, targetDim) =>
      isPerturbed && dim === targetDim ? 3 : 5,
    );
    const r = await checkCalibration(base, {
      minPairs: 2,
      deltaFloor: 1,
      specificityTol: 0,
    });
    expect(r.pass).toBe(false);
    expect(
      r.failures.filter((f) => f.dimension === "sufficiency").length,
    ).toBeGreaterThan(0);
  });

  it("扰动件没删成功(门在两侧都干净)→ 判未检出而非误报检出", async () => {
    const base = makeTmpRun(2);
    await buildCalibrationSuite(base, { sourceCount: 2, seed: 42 });
    // 人为把 perturbed 件的 prompt 换回原文 —— 模拟「扰动没生效」:
    // 门在两侧都看不到缺失,必须判 NO 而不是 yes。
    const manifest = JSON.parse(
      readFileSync(
        join(base, "judge-calibration", "calibration-manifest.json"),
        "utf-8",
      ),
    ) as { cases: (ManifestCase & { sourceOrdinal: number })[] };
    const byOrdinal = new Map<number, string>();
    for (const c of manifest.cases)
      if (c.perturbation === "none") byOrdinal.set(c.sourceOrdinal, c.caseId);
    for (const c of manifest.cases) {
      if (c.perturbation !== "removed-deaths") continue;
      const originalPrompt = readFileSync(
        join(
          base,
          "judge-calibration",
          "cases",
          byOrdinal.get(c.sourceOrdinal)!,
          "prompt.txt",
        ),
        "utf-8",
      );
      writeFileSync(
        join(base, "judge-calibration", "cases", c.caseId, "prompt.txt"),
        originalPrompt,
      );
    }
    writeScores(base, () => 5);
    const r = await checkCalibration(base, {
      minPairs: 2,
      deltaFloor: 1,
      specificityTol: 0,
    });
    expect(
      r.failures.filter((f) => f.dimension === "sufficiency").length,
    ).toBeGreaterThan(0);
  });
});

describe("checkCalibration — string-numeric handling", () => {
  it("空字符串分数 → 不可评(null),不当作 0", async () => {
    const base = makeTmpRun(2);
    await buildCalibrationSuite(base, { sourceCount: 2, seed: 42 });
    // Control scores 5 everywhere; perturbed targeted dim is an EMPTY STRING.
    // Number("") === 0 would fake a 5→0 drop; it must instead be unscoreable.
    writeScores(base, (dim, isPerturbed, targetDim) => {
      if (!isPerturbed) return 5;
      return dim === targetDim ? "" : 5;
    });
    const r = await checkCalibration(base, {
      minPairs: 2,
      deltaFloor: 1,
      specificityTol: 0,
    });
    // Empty targeted scores are unscoreable → dimensions have 0 scoreable pairs
    // → NO DATA / not a PASS. A buggy Number("")===0 would report detections.
    expect(r.pass).toBe(false);
  });
});

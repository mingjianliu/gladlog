import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
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

import { DMG_SPIKE_THRESHOLD, ensureAnalysisData } from "@gladlog/analysis";
import { beforeAll, describe, expect, it } from "vitest";

import { buildAnalysisInput } from "../src/renderer/src/report/derive/analysisInput";
import { derivePressureLanes } from "../src/renderer/src/report/derive/pressureLanes";
import type { ReportSource } from "../src/renderer/src/report/derive/types";
import realMatch from "./fixtures/real-match-sample.json";

const src = realMatch as unknown as ReportSource;

beforeAll(async () => {
  // Prerequisite contract for spell names in the prompt (same as the existing
  // analysisInput.test.ts) — buildAnalysisInput's internal rendering needs the
  // tables loaded, otherwise spell names degrade.
  await ensureAnalysisData();
});

describe("derivePressureLanes", () => {
  it("spike 全部过阈值门,时刻为相对秒且在场内", () => {
    const { spikes } = derivePressureLanes(src);
    const durS = (src.endTime - src.startTime) / 1000;
    for (const s of spikes) {
      expect(s.totalDamage).toBeGreaterThanOrEqual(DMG_SPIKE_THRESHOLD);
      expect(s.fromS).toBeGreaterThanOrEqual(0);
      // window's right edge = start + 10s, so touching the edge is allowed
      expect(s.toS).toBeLessThanOrEqual(durS + 10);
      expect(s.dpsK).toBeGreaterThan(0);
    }
  });

  it("dpsK 与 [DMG SPIKE] 行同口径(Math.round(total/max(1,round(to-from))/1000))", () => {
    const { spikes } = derivePressureLanes(src);
    for (const s of spikes) {
      const windowSec = Math.round(s.toS - s.fromS);
      expect(s.dpsK).toBe(
        Math.round(s.totalDamage / Math.max(1, windowSec) / 1000),
      );
    }
  });

  it("裁剪 fixture(无 advancedActions 剥留与否皆可)不抛;exposures 是数组", () => {
    const { exposures } = derivePressureLanes(src);
    expect(Array.isArray(exposures)).toBe(true);
    for (const e of exposures) {
      expect(["Critical", "Exposed", "Pressured"]).toContain(e.label);
      expect(e.title.length).toBeGreaterThan(0);
    }
  });

  it("空 source(units 空)→ 双空数组不抛", () => {
    const empty = { ...src, units: {} } as unknown as ReportSource;
    expect(derivePressureLanes(empty)).toEqual({ spikes: [], exposures: [] });
  });

  it("泳道与 prompt 同谓词:spike 数 = [DMG SPIKE] 行数;exposure 数 = 非 Safe [HEALER EXPOSURE] 行数", async () => {
    // prerequisite contract for prompt spell names (same as in analysisInput)
    await ensureAnalysisData();
    const input = buildAnalysisInput(src, "parity-test");
    expect(input).not.toBeNull();
    // Observed richContext line prefixes: `0:29–0:39  [DMG SPIKE]   …` /
    // `0:13  [HEALER EXPOSURE]   … — ⚠ Exposed — …`
    // (the legend line "  [DMG SPIKE] `START–END` = …" has no timestamp
    // prefix, so after trim it does not match \d+:\d{2} and is filtered out
    // naturally).
    const spikeLines = input!.richContext
      .split("\n")
      .filter((l) => /^\d+:\d{2}/.test(l.trim()) && l.includes("[DMG SPIKE]"));
    const exposureLines = input!.richContext
      .split("\n")
      .filter(
        (l) =>
          /^\d+:\d{2}/.test(l.trim()) &&
          l.includes("[HEALER EXPOSURE]") &&
          !l.includes("Safe"),
      );
    const { spikes, exposures } = derivePressureLanes(src);
    expect(spikes.length).toBe(spikeLines.length); // measured 2=2 on this fixture
    expect(exposures.length).toBe(exposureLines.length); // measured 2=2 here too
    expect(spikes.length).toBeGreaterThan(0); // guard against a vacuous pass
  });
});

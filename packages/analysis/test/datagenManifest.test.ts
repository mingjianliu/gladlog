import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

/**
 * Anti-rot test: every "generated artifact" under
 * packages/analysis/src/data/ must be registered in datagen-manifest.json's
 * artifacts, otherwise the update-wow-data workflow does not know to
 * regenerate it — a missing registration raises no error, it just silently
 * keeps serving stale data after a new expansion ships (before this fix:
 * offGcdGenerated.ts / drCategoriesGenerated.ts /
 * pvpTalentReplacesGenerated.ts / specIconsGenerated.ts, plus two observation
 * sets, were all unregistered).
 *
 * Criteria for "generated artifact" (three marker conventions are in use, all
 * of them needed):
 *   1. the file name contains "Generated" (most .ts/.json artifacts follow this
 *      naming convention)
 *   2. a generation marker comment in the file header ("Generated at: ..." or
 *      the Chinese "生成文件 —— 勿手改/勿手编")
 *   3. a top-level "generatedAt" field in the JSON (some .json artifacts have
 *      no .ts naming shell)
 *
 * Matching any one of them counts as a generated artifact, which must then
 * either appear in manifest.artifacts or be listed with a stated reason in the
 * explicit EXEMPT_GENERATED_ARTIFACTS list below — an exemption must be a
 * WRITTEN decision, never a silent omission that slipped through.
 */

const DATA_DIR = path.resolve(__dirname, "../src/data");
const MANIFEST_PATH = path.join(DATA_DIR, "datagen-manifest.json");

// The manifest itself is not an artifact; skip it.
const MANIFEST_FILENAME = "datagen-manifest.json";

/**
 * Artifacts that match the criteria but are **deliberately** not registered in
 * datagen-manifest.json.
 * Both are corpus/statistics driven rather than WoW-version driven: their
 * producers live neither in scripts/datagen/ nor in packages/eval/scripts/, so
 * the update-wow-data workflow does not cover them and each is refreshed by its
 * own separate manual pipeline.
 */
const EXEMPT_GENERATED_ARTIFACTS: Record<string, string> = {
  "benchmarks.json":
    "对局语料实证的玩家表现百分位基准,由 packages/analysis/scripts/collectBenchmarks.ts" +
    " 从本地对局日志聚合生成,与 WoW build/DB2 数据无关(不会因资料片更新而过期," +
    " 只会因版本平衡改动而过期,需要新版本已有对局样本后才能重新采集),不属于" +
    " update-wow-data 覆盖范围。",
  "archetypes/archetype_model_3v3.json":
    "对局原型聚类模型,由仓外聚类流水线产出(archetypeInjection.ts 顶部注释指向" +
    " cluster-eval-report.md,生成器未入本仓)。语料驱动,非 WoW 版本驱动,不属于" +
    " update-wow-data 覆盖范围。",
  "archetypes/archetype_model_solo_shuffle.json":
    "同 archetype_model_3v3.json。",
  // 同目录的 archetype_prompts_{3v3,solo_shuffle}.json(各簇的标签与叙述)不命中
  // 本测试的生成物判据,所以不在此豁免表里,出处记在这里:上游 wowarenalogs
  // packages/tools/archetypes/finalize_prompts.py + src/buildArchetypePrompts.ts,
  // 对某一次聚类的簇手工命名。它与模型文件只靠 cluster_<i> 的下标拼接,必须出自
  // 同一次聚类 —— 现在不是(prompts 2026-05-20、model 2026-05-27,分诊 other F-O1),
  // 由 test/archetypeLabelAlignment.test.ts 钉住,[MATCH PATTERN] 因此停印。
};

function listDataFiles(dir: string, base = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = path.join(dir, entry);
    const rel = base ? `${base}/${entry}` : entry;
    if (statSync(abs).isDirectory()) {
      out.push(...listDataFiles(abs, rel));
    } else {
      out.push(rel);
    }
  }
  return out;
}

const HEADER_MARKER_RE = /Generated at:|生成文件.{0,6}(勿手改|勿手编)/;

/** Returns a description of the matching criterion, or null if none match. */
function detectGenerated(relPath: string): string | null {
  if (relPath === MANIFEST_FILENAME) return null;

  const base = path.basename(relPath);
  if (base.includes("Generated")) return "文件名含 Generated";

  const text = readFileSync(path.join(DATA_DIR, relPath), "utf-8");
  if (HEADER_MARKER_RE.test(text.slice(0, 2000))) {
    return "文件头有生成标记注释";
  }

  if (base.endsWith(".json")) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        "generatedAt" in (parsed as Record<string, unknown>)
      ) {
        return "JSON 顶层含 generatedAt 字段";
      }
    } catch {
      /* Not JSON, or failed to parse — not a match */
    }
  }
  return null;
}

/**
 * Whether some manifest key covers this generated artifact. Most artifact keys
 * equal the file name; a few .json data files have no key of their own and are
 * covered by the entry for the .ts shell of the same name (e.g.
 * spellEffectGenerated.json's size is recorded under "spellEffectGenerated.ts",
 * see the writeManifest.ts comment) — so the same stem with the extension
 * swapped (.json <-> .ts) also counts as covered.
 */
function isCoveredByManifest(
  relPath: string,
  artifactKeys: Set<string>,
): boolean {
  const base = path.basename(relPath);
  if (artifactKeys.has(base) || artifactKeys.has(relPath)) return true;

  const swapped = base.endsWith(".json")
    ? base.replace(/\.json$/, ".ts")
    : base.endsWith(".ts")
      ? base.replace(/\.ts$/, ".json")
      : undefined;
  return swapped ? artifactKeys.has(swapped) : false;
}

describe("datagen-manifest.json 生成物覆盖", () => {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8")) as {
    artifacts: Record<string, unknown>;
  };
  const artifactKeys = new Set(Object.keys(manifest.artifacts));
  const files = listDataFiles(DATA_DIR);

  it("每个被判据命中的生成物,要么登记进 manifest.artifacts,要么在显式豁免清单里", () => {
    const unregistered: string[] = [];
    for (const relPath of files) {
      const reason = detectGenerated(relPath);
      if (!reason) continue;
      if (relPath in EXEMPT_GENERATED_ARTIFACTS) continue;
      if (isCoveredByManifest(relPath, artifactKeys)) continue;
      unregistered.push(`${relPath}(判据: ${reason})`);
    }
    expect(unregistered).toEqual([]);
  });

  it("豁免清单条目本身存在、且确实会被判据命中(防止豁免清单腐烂成沉默遗漏)", () => {
    for (const relPath of Object.keys(EXEMPT_GENERATED_ARTIFACTS)) {
      expect(() => statSync(path.join(DATA_DIR, relPath))).not.toThrow();
      expect(detectGenerated(relPath)).not.toBeNull();
    }
  });

  it("豁免清单条目理由非空,且不该被 manifest 直接命中(否则该转正登记而非豁免)", () => {
    for (const [relPath, reason] of Object.entries(
      EXEMPT_GENERATED_ARTIFACTS,
    )) {
      expect(reason.length).toBeGreaterThan(0);
      expect(isCoveredByManifest(relPath, artifactKeys)).toBe(false);
    }
  });

  // I6: the manifest said "entries": 12 while the shipped table had 9 cells
  // — a stale hand-typed count nobody would notice again without this pin.
  it("behaviorPriorGenerated.json 的 entries 计数与真实 cell 数一致", () => {
    const behaviorPrior = JSON.parse(
      readFileSync(path.join(DATA_DIR, "behaviorPriorGenerated.json"), "utf-8"),
    ) as { cells: Record<string, unknown> };
    const declared = (
      manifest.artifacts as Record<string, { entries: number }>
    )["behaviorPriorGenerated.json"]!.entries;
    expect(declared).toBe(Object.keys(behaviorPrior.cells).length);
  });
});

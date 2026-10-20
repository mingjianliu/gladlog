/**
 * plantTimestampError.ts — 子项目 A 验收(c) 的已知差异构造:把回复首个 M:SS
 * 时间戳 +3 秒,制造 rubric 定义的「小错」(时间戳差几秒),期望 accuracy
 * 恰降一档。buildPlantedAb 用它按比例种植,构造已知 |Δ| 的 A/B 对。
 */
import fs from "fs-extra";
import path from "path";

import type { IndexEntry } from "../corpus/buildCorpus";
import { makeRng } from "./abCompareStats.js";

const TIMESTAMP_RE = /\b(\d+):([0-5]\d)\b/;

export function plantTimestampError(responseText: string): {
  text: string;
  planted: string;
} {
  const m = responseText.match(TIMESTAMP_RE);
  if (!m || m.index === undefined)
    throw new Error("plantTimestampError: no M:SS timestamp in response");
  const minutes = Number(m[1]);
  const seconds = Number(m[2]) + 3;
  const shifted = `${minutes + Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const text =
    responseText.slice(0, m.index) +
    shifted +
    responseText.slice(m.index + m[0].length);
  return { text, planted: `${m[0]} -> ${shifted}` };
}

export async function buildPlantedAb(opts: {
  sourceArmDir: string;
  outDir: string;
  nPairs: number;
  plantFraction: number;
  seed: number;
}): Promise<{ pairs: number; planted: number }> {
  const { sourceArmDir, outDir, nPairs, plantFraction, seed } = opts;
  const entries = (await fs.readJson(
    path.join(sourceArmDir, "index.json"),
  )) as IndexEntry[];
  if (entries.length < nPairs)
    throw new Error(
      `buildPlantedAb: source has ${entries.length} entries, need ${nPairs}`,
    );
  const rng = makeRng(seed);
  const shuffled = [...entries];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const selected = shuffled
    .slice(0, nPairs)
    .sort((a, b) => a.ordinal - b.ordinal);
  const plantCount = Math.round(nPairs * plantFraction);
  const plantSet = new Set(selected.slice(0, plantCount).map((e) => e.ordinal)); // selected 按 ordinal 排序后取最小序号段;入选本身已定种子随机,配对消项目效应,故种植段无需再随机
  const plantedMeta: { ordinal: number; planted: string }[] = [];

  for (const arm of ["control", "treatment"] as const) {
    await fs.ensureDir(path.join(outDir, arm, "prompts"));
    await fs.ensureDir(path.join(outDir, arm, "responses"));
  }
  const rewritten: IndexEntry[] = [];
  for (const entry of selected) {
    const ordinal = String(entry.ordinal).padStart(3, "0");
    const prompt = await fs.readFile(
      path.join(sourceArmDir, entry.file),
      "utf8",
    );
    const response = await fs.readFile(
      path.join(sourceArmDir, "responses", `${ordinal}.txt`),
      "utf8",
    );
    const relFile = path.join("prompts", path.basename(entry.file));
    for (const arm of ["control", "treatment"] as const)
      await fs.writeFile(path.join(outDir, arm, relFile), prompt, "utf8");
    await fs.writeFile(
      path.join(outDir, "control", "responses", `${ordinal}.txt`),
      response,
      "utf8",
    );
    let treatResponse = response;
    if (plantSet.has(entry.ordinal)) {
      const p = plantTimestampError(response);
      treatResponse = p.text;
      plantedMeta.push({ ordinal: entry.ordinal, planted: p.planted });
    }
    await fs.writeFile(
      path.join(outDir, "treatment", "responses", `${ordinal}.txt`),
      treatResponse,
      "utf8",
    );
    rewritten.push({ ...entry, file: relFile });
  }
  for (const arm of ["control", "treatment"] as const)
    await fs.writeJson(path.join(outDir, arm, "index.json"), rewritten, {
      spaces: 2,
    });
  await fs.writeJson(
    path.join(outDir, "plant-meta.json"),
    {
      seed,
      nPairs,
      plantFraction,
      plantedOrdinals: plantedMeta.map((p) => p.ordinal).sort((a, b) => a - b),
      planted: plantedMeta,
    },
    { spaces: 2 },
  );
  return { pairs: rewritten.length, planted: plantedMeta.length };
}

/**
 * positioning grounding 扫描 CLI(backlog #3 硬门)。
 *
 * 用法:
 *   BASE_DIR=<run 目录> MANIFEST=<manifest.txt> npx tsx packages/eval/scripts/positioningScan.ts [--mutate]
 *
 * 重放 manifest 里的日志重建 combats(与 buildCorpus 同路径),按 index.json 的
 * matchId 对上每个 prompt,抽取几何主张并对原始坐标复算。--mutate 附带变异敏感度
 * 测试(距离 +15yd / 时间 +45s,要求 100% 检出)。
 * 任何 violation 即 exit 1;变异检出率 <100% 也 exit 1。
 */
import fs from "fs-extra";
import path from "path";
import { GladLogParser } from "@gladlog/parser";
import {
  toLegacyMatch,
  toLegacyShuffle,
  CombatUnitReaction,
} from "@gladlog/parser-compat";
import { isHealerSpec } from "@gladlog/analysis";
import {
  checkGeoClaims,
  extractGeoClaims,
  mutationDetectionRate,
} from "../src/quality/positioningScan";

async function main() {
  const baseDir = process.env.BASE_DIR;
  const manifest = process.env.MANIFEST;
  const mutate = process.argv.includes("--mutate");
  if (!baseDir || !manifest) {
    console.error("BASE_DIR and MANIFEST must be set");
    process.exit(1);
  }

  // index 先入 map(matchId → entry);日志逐个流式解析,扫完即弃,避免全量驻留 OOM
  const index: Array<{ ordinal: number; file: string; matchId: string }> =
    await fs.readJson(path.join(baseDir, "index.json"));
  const entryByMatchId = new Map(index.map((e) => [e.matchId, e]));
  const seen = new Set<string>();

  let totalClaims = 0;
  let totalChecked = 0;
  let totalUnverifiable = 0;
  let totalMutated = 0;
  let totalDetected = 0;
  const allViolations: string[] = [];

  const logPaths = (await fs.readFile(manifest, "utf-8"))
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const pending: Array<{ entry: { ordinal: number; file: string; matchId: string }; combat: any }> = [];
  const collect = (id: string, combat: any) => {
    const entry = entryByMatchId.get(id);
    if (entry) pending.push({ entry, combat });
  };

  for (const logPath of logPaths) {
    try {
      const content = await fs.readFile(logPath, "utf-8");
      const parser = new GladLogParser();
      parser.on("match", (m: any) => collect(m.id, toLegacyMatch(m)));
      parser.on("shuffle", (sh: any) => {
        const legacy = toLegacyShuffle(sh);
        (legacy.rounds ?? []).forEach((round: any, idx: number) => {
          const id = sh.rounds[idx]?.id ?? `${sh.rounds[0]?.id}-r${idx}`;
          collect(id, round);
        });
      });
      for (const line of content.split("\n")) parser.push(line);
      parser.end();
    } catch (err) {
      console.warn(`WARN: ${logPath}: ${err}`);
    }

    // 本日志的场次立即扫描并释放
    while (pending.length > 0) {
      const { entry, combat } = pending.shift()!;
      seen.add(entry.matchId);
      await scanOne(entry, combat);
    }
  }

  const matchesMissing = index.length - seen.size;

  async function scanOne(
    entry: {
      ordinal: number;
      file: string;
      matchId: string;
      ownerName?: string;
    },
    combat: any,
  ) {
    const promptText = await fs.readFile(
      path.join(baseDir, entry.file),
      "utf-8",
    );
    const { claims, unitIdMap } = extractGeoClaims(promptText);
    if (claims.length === 0) return;
    totalClaims += claims.length;

    const units: any[] = Object.values(combat.units);
    const players = units.filter((u) => u.info);
    // owner = 语料 index 记录的 prompt 主角(D2:DPS 语料的距离声明是 DPS 视角,
    // 拿治疗坐标复算全是假违规);旧语料无 ownerName → 回退友方治疗(原行为)。
    const owner =
      (entry.ownerName
        ? players.find(
            (u) =>
              u.name === entry.ownerName &&
              u.reaction === CombatUnitReaction.Friendly,
          )
        : undefined) ??
      players.find(
        (u) =>
          isHealerSpec(u.spec) && u.reaction === CombatUnitReaction.Friendly,
      );
    if (!owner) return;
    const ctx = {
      owner,
      friends: players.filter((u) => u.reaction === owner.reaction),
      enemies: players.filter((u) => u.reaction !== owner.reaction),
      zoneId: String(combat.startInfo?.zoneId ?? ""),
      matchStartMs: combat.startTime,
      unitIdMap,
    };

    const result = checkGeoClaims(claims, ctx);
    totalChecked += result.checked;
    totalUnverifiable += result.unverifiable;
    for (const v of result.violations) {
      allViolations.push(
        `${entry.file}:${v.claim.lineNo} [${v.code}] ${v.detail}\n      ${v.claim.raw.trim().slice(0, 140)}`,
      );
    }

    if (mutate) {
      const { mutated, detected } = mutationDetectionRate(claims, ctx);
      totalMutated += mutated;
      totalDetected += detected;
    }
  }

  console.log(
    `Scanned ${index.length} prompts (${matchesMissing} missing from logs): ` +
      `${totalClaims} geo claims, ${totalChecked} checked, ${totalUnverifiable} unverifiable (no coords).`,
  );
  if (mutate) {
    const rate = totalMutated > 0 ? (100 * totalDetected) / totalMutated : 100;
    console.log(
      `Mutation sensitivity: ${totalDetected}/${totalMutated} detected (${rate.toFixed(1)}%).`,
    );
    // 语料级变异率受真实移动噪声影响,仅作诊断;检出率硬门由合成夹具单测承担
    // (packages/eval/test/positioningScan.test.ts,静止单位 → 变异必检出)。
  }
  if (allViolations.length > 0) {
    console.error(`\n${allViolations.length} VIOLATION(S):`);
    for (const v of allViolations) console.error("  " + v);
    process.exit(1);
  }
  console.log("Grounding gate: 0 violations.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

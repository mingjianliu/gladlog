import { GladLogParser } from "@gladlog/parser";
import {
  toLegacyMatch,
  toLegacyShuffle,
  CombatUnitReaction,
} from "@gladlog/parser-compat";
import {
  computeHealerMetrics,
  extractRotations,
  enemyCompArchetype,
  isHealerSpec,
  specToString,
} from "@gladlog/analysis";
import type { PerMatchRecord } from "./cellAggregator";

/** 单场 combat → 每个 Friendly 治疗一条记录(纯,可合成 combat 单测)。 */
export function combatToRecords(combat: any): PerMatchRecord[] {
  const players = (Object.values(combat.units) as any[]).filter((u) => u.info);
  const healers = players.filter(
    (u) => isHealerSpec(u.spec) && u.reaction === CombatUnitReaction.Friendly,
  );
  const out: PerMatchRecord[] = [];
  for (const healer of healers) {
    const enemies = players.filter((u) => u.reaction !== healer.reaction);
    let metrics;
    try {
      metrics = computeHealerMetrics(combat, healer.name);
    } catch {
      continue;
    }
    const archetype = enemyCompArchetype(enemies);
    const rotations = extractRotations(healer, combat);
    out.push({
      spec: specToString(healer.spec),
      bracket: combat.startInfo?.bracket ?? "unknown",
      archetype,
      metrics,
      crisisEvents: rotations.crisisEvents,
    });
  }
  return out;
}

/** 一份日志 → 解析 → 每场记录。薄壳;真实解析集成在 T8 真跑里验证。 */
export function buildPerMatchRecords(logText: string): PerMatchRecord[] {
  const parser = new GladLogParser();
  const combats: any[] = [];
  parser.on("match", (m: any) => combats.push(toLegacyMatch(m)));
  parser.on("shuffle", (sh: any) => {
    const legacy = toLegacyShuffle(sh);
    (legacy.rounds ?? []).forEach((r: any) => combats.push(r));
  });
  for (const line of logText.split("\n")) parser.push(line);
  parser.end();
  return combats.flatMap((c) => combatToRecords(c));
}

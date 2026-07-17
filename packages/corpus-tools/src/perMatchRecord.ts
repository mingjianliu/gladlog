import {
  computeHealerMetrics,
  enemyCompArchetype,
  extractRotations,
  isHealerSpec,
  specToString,
} from "@gladlog/analysis";
import { GladLogParser } from "@gladlog/parser";
import {
  CombatUnitReaction,
  toLegacyMatch,
  toLegacyShuffle,
} from "@gladlog/parser-compat";

import type { PerMatchRecord } from "./cellAggregator";
import { assignBuildGroup, type KeystoneGate } from "./keystoneGates";

/** 单场 combat → 每个 Friendly 治疗一条记录(纯,可合成 combat 单测)。 */
export function combatToRecords(
  combat: any,
  gates: KeystoneGate[],
): PerMatchRecord[] {
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
    const spec = specToString(healer.spec);
    const gate = gates.find((g) => g.spec === spec);
    const talents = (healer.info?.talents ?? [])
      .map((t: any) => t.id1)
      .filter(Boolean);
    const buildGroup = gate ? assignBuildGroup(talents, gate) : "*";
    out.push({
      spec,
      bracket: combat.startInfo?.bracket ?? "unknown",
      archetype,
      buildGroup,
      metrics,
      crisisEvents: rotations.crisisEvents,
    });
  }
  return out;
}

/** 一份日志 → 解析 → 每场记录。薄壳;真实解析集成在 T8 真跑里验证。 */
export function buildPerMatchRecords(
  logText: string,
  gates: KeystoneGate[],
): PerMatchRecord[] {
  const parser = new GladLogParser();
  const combats: any[] = [];
  parser.on("match", (m: any) => combats.push(toLegacyMatch(m)));
  parser.on("shuffle", (sh: any) => {
    const legacy = toLegacyShuffle(sh);
    (legacy.rounds ?? []).forEach((r: any) => combats.push(r));
  });
  for (const line of logText.split("\n")) parser.push(line);
  parser.end();
  return combats.flatMap((c) => combatToRecords(c, gates));
}

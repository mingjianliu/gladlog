import {
  analyzeKickAudit,
  annotateMissedPurgesWithKillWindows,
  computeOffensiveWindows,
  extractCandidateFindings,
  reconstructDispelSummary,
  type CandidateEvent,
} from "@gladlog/analysis";
import { CombatUnitReaction } from "@gladlog/parser-compat";

import { toLegacySafe } from "./legacySource";
import { tInRange, type TimeRange } from "./timeRange";
import type { ReportSource } from "./types";

/**
 * 确定性 mistake 引擎(第四阶段③ / backlog #8,WoWAnalyzer suggestions 模式):
 * 规则 = 可枚举的数据对象(三档严重度),全部消费 analysis 既有确定性谓词
 * (candidateFindings / kickAudit / dispelSummary),不经 LLM 直接进 UI。
 * 防腐:上游 candidateFindings 新增类型时,必须在 MISTAKE_RULES 或
 * IGNORED_CANDIDATE_TYPES 里表态 —— 见 report.mistakes.test 的清单测试。
 */

export type MistakeSeverity = "minor" | "average" | "major";

export interface MistakeRule {
  type: string;
  label: string;
  severity: MistakeSeverity;
  source: "candidate" | "kick" | "dispel";
}

export const MISTAKE_RULES: readonly MistakeRule[] = [
  // candidateFindings 的 DPS owner 五类里,juked-kick 改由 kickAudit 直供
  // (candidate 版只覆盖 DPS owner,治疗的 kick 会漏)——这里刻意不收,防双计。
  {
    type: "burst-into-immunity",
    label: "爆发打进免疫",
    severity: "major",
    source: "candidate",
  },
  {
    type: "off-target-in-window",
    label: "击杀窗口内伤害脱靶",
    severity: "average",
    source: "candidate",
  },
  {
    type: "dr-clipped-cc",
    label: "CC 打在递减上",
    severity: "average",
    source: "candidate",
  },
  {
    type: "unconverted-burst",
    label: "爆发未转化",
    severity: "minor",
    source: "candidate",
  },
  {
    type: "cd-waste",
    label: "保命 CD 整场未用",
    severity: "minor",
    source: "candidate",
  },
  {
    type: "juked-kick",
    label: "被假读条骗掉打断",
    severity: "average",
    source: "kick",
  },
  {
    type: "missed-kick",
    label: "打断空放",
    severity: "minor",
    source: "kick",
  },
  {
    type: "missed-purge-kill-window",
    label: "击杀窗口内漏 purge",
    severity: "major",
    source: "dispel",
  },
] as const;

/** candidateFindings 会产、但刻意不算 mistake 的类型(死亡是结果不是失误;
 * death-setup 是叙事链证据,进 AI 管线不进失误清单;juked-kick 走 kickAudit)。 */
export const IGNORED_CANDIDATE_TYPES: ReadonlySet<string> = new Set([
  "death",
  "death-setup",
  "juked-kick",
]);

export interface Mistake {
  tS: number;
  unitName: string;
  type: string;
  label: string;
  severity: MistakeSeverity;
  detail: string;
  /** ▶ 跳回放的镜头单位。 */
  seekNames: string[];
}

const RULE_BY_TYPE = new Map(MISTAKE_RULES.map((r) => [r.type, r]));

function candidateDetail(c: CandidateEvent): string {
  const f = c.facts as Record<string, string | undefined>;
  switch (c.type) {
    case "burst-into-immunity":
      return `${f.spell ?? ""} 打进 ${f.target ?? ""} 的 ${f.immunity ?? ""}(重叠 ${f.overlap ?? "?"}s)`;
    case "off-target-in-window":
      return `窗口目标 ${f.target ?? ""},命中仅 ${f.onTargetPct ?? "?"}%${f.offTarget ? `(最大分流 ${f.offTarget})` : ""}`;
    case "dr-clipped-cc":
      return `${f.spell ?? ""} 打在 ${f.target ?? ""} 的 ${f.dr ?? ""} 递减上(仅 ${f.duration ?? "?"}s)`;
    case "unconverted-burst":
      return `${f.spell ?? ""} 对 ${f.target ?? ""} 打出 ${f.damageM ?? "?"}M 未转化(${f.hpStart ?? "?"}%→${f.hpEnd ?? "?"}%)`;
    case "cd-waste":
      return `${f.spell ?? ""} 整场未按`;
    default:
      return "";
  }
}

export function deriveMistakes(
  source: ReportSource,
  range?: TimeRange | null,
): Mistake[] {
  try {
    const legacy = toLegacySafe(source);
    const players = Object.values(legacy.units).filter((u) => u.info);
    const friends = players.filter(
      (u) => u.reaction === CombatUnitReaction.Friendly,
    );
    const enemies = players.filter(
      (u) => u.reaction === CombatUnitReaction.Hostile,
    );
    if (friends.length === 0 || enemies.length === 0) return [];
    const out: Mistake[] = [];
    const seen = new Set<string>();

    // candidate 源:每个友方作为 owner 各跑一次;按 candidate id 去重
    for (const p of friends) {
      for (const c of extractCandidateFindings(legacy, p.id)) {
        const rule = RULE_BY_TYPE.get(c.type);
        if (!rule || rule.source !== "candidate") continue;
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        out.push({
          tS: c.t,
          unitName: c.unitNames[0] ?? p.name,
          type: c.type,
          label: rule.label,
          severity: rule.severity,
          detail: candidateDetail(c),
          seekNames: c.unitNames.slice(0, 1),
        });
      }
    }

    // kick 源:全友方(candidate 版只覆盖 DPS owner)
    for (const p of friends) {
      for (const k of analyzeKickAudit(p, enemies, legacy)) {
        if (k.result !== "juked" && k.result !== "missed") continue;
        const rule = RULE_BY_TYPE.get(
          k.result === "juked" ? "juked-kick" : "missed-kick",
        )!;
        out.push({
          tS: k.atSeconds,
          unitName: p.name,
          type: rule.type,
          label: rule.label,
          severity: rule.severity,
          detail:
            k.result === "juked"
              ? `${k.kickSpellName} 被 ${k.jukedBySpellName ?? "假读条"} 骗掉`
              : `${k.kickSpellName} 空放`,
          seekNames: [p.name],
        });
      }
    }

    // dispel 源:击杀窗口内漏 purge(与 prompt 侧同一标注谓词)
    const dispels = reconstructDispelSummary(friends, enemies, {
      startTime: legacy.startTime,
      endTime: legacy.endTime,
    });
    annotateMissedPurgesWithKillWindows(
      dispels.missedPurgeWindows,
      computeOffensiveWindows(enemies, friends, legacy),
    );
    for (const w of dispels.missedPurgeWindows) {
      if (!w.duringKillWindow) continue;
      const rule = RULE_BY_TYPE.get("missed-purge-kill-window")!;
      out.push({
        tS: w.timeSeconds,
        unitName: w.enemyName,
        type: rule.type,
        label: rule.label,
        severity: rule.severity,
        detail: `${w.spellName} 挂在 ${w.enemyName} 身上 ${Math.round(w.durationSeconds)}s 未被驱散`,
        seekNames: [w.enemyName],
      });
    }

    return out
      .filter((mk) => tInRange(mk.tS, range))
      .sort((a, b) => a.tS - b.tS);
  } catch {
    return [];
  }
}

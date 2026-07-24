import type { Finding } from "@gladlog/analysis";

import { deriveKickDash } from "./kickDash";
import { deriveMistakes } from "./mistakes";
import { deriveStatsTable } from "./statsTable";
import { deriveSummary } from "./summary";
import { rangeDurationS, type TimeRange } from "./timeRange";
import type { ReportSource } from "./types";

/**
 * C3 导出保真(可验证性路线图):导出的 Markdown 由**与 UI 完全相同的
 * derive** 组装 —— 数字同源是构造保证;report.export.test 再做 round-trip
 * (从导出文本把数字解析回来与 derive 对账),防格式层(取整/错列/错标)
 * 引入第二事实。图片导出仍缺(见 roadmap C3 注)。
 */

const fmtT = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function buildReportMarkdown(
  source: ReportSource,
  range?: TimeRange | null,
): string {
  const lines: string[] = [];
  const durS = Math.round(rangeDurationS(source, range));
  lines.push(
    `# gladlog 战报 — ${source.bracket} · ${source.result}` +
      (range
        ? ` · 窗口 ${fmtT(range.fromS)}–${fmtT(range.toS)}(${durS}s)`
        : ""),
  );

  lines.push(
    "",
    "## 输出/治疗",
    "",
    "| 玩家 | 伤害 | 治疗 | 承伤 | 死亡 |",
    "| --- | ---: | ---: | ---: | ---: |",
  );
  for (const r of deriveSummary(source, range)) {
    lines.push(
      `| ${r.name.split("-")[0]} | ${r.damageDone} | ${r.healingDone} | ${r.damageTaken} | ${r.deaths} |`,
    );
  }

  const stats = deriveStatsTable(source, range);
  if (stats.length > 0) {
    lines.push(
      "",
      "## 统计",
      "",
      "| 玩家 | 打断施放 | 被打断 | 被控秒 | 驱散 | purge |",
      "| --- | ---: | ---: | ---: | ---: | ---: |",
    );
    for (const r of stats) {
      lines.push(
        `| ${r.name.split("-")[0]} | ${r.kicksCast} | ${r.kicksTaken} | ${r.ccTakenS} | ${r.cleanses} | ${r.purges} |`,
      );
    }
  }

  const kicks = deriveKickDash(source, range);
  if (kicks.length > 0) {
    lines.push(
      "",
      "## 打断",
      "",
      "| 玩家 | 施放 | 打断 | 被骗 | 落空 |",
      "| --- | ---: | ---: | ---: | ---: |",
    );
    for (const r of kicks) {
      lines.push(
        `| ${r.name.split("-")[0]} | ${r.total} | ${r.landed} | ${r.juked} | ${r.missed} |`,
      );
    }
  }

  const mistakes = deriveMistakes(source, range);
  if (mistakes.length > 0) {
    lines.push("", `## 失误清单(${mistakes.length} 条,确定性规则直出)`, "");
    for (const mk of mistakes) {
      lines.push(
        `- ${mk.tS > 0 ? fmtT(mk.tS) : "全场"} [${mk.severity}] ${mk.unitName.split("-")[0]} · ${mk.label}${mk.detail ? ` — ${mk.detail}` : ""}`,
      );
    }
  }

  return lines.join("\n") + "\n";
}

/** AI findings 导出(ExportButtons 消费;从组件内联字符串迁来,纳入保真测试)。 */
export function buildFindingsMarkdown(
  findings: Finding[],
  heroText: string,
): string {
  const lines = [heroText];
  if (findings.length > 0) lines.push("");
  for (const f of findings) {
    lines.push(`- [${f.severity.toUpperCase()}] ${f.title} — ${f.explanation}`);
  }
  return lines.join("\n");
}

// @vitest-environment jsdom
import {
  buildFindingsMarkdown,
  buildReportMarkdown,
} from "../src/renderer/src/report/derive/exportReport";
import { deriveMistakes } from "../src/renderer/src/report/derive/mistakes";
import { deriveStatsTable } from "../src/renderer/src/report/derive/statsTable";
import { deriveSummary } from "../src/renderer/src/report/derive/summary";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const m = loadRealMatchFixture();

/** 从导出的 markdown 表里把某节的数字行解析回来(round-trip 的「回」)。 */
function parseTable(md: string, heading: string): string[][] {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l.startsWith(heading));
  if (start < 0) return [];
  const rows: string[][] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.startsWith("## ")) break;
    if (!l.startsWith("| ") || l.startsWith("| ---") || l.includes("玩家"))
      continue;
    rows.push(
      l
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean),
    );
  }
  return rows;
}

describe("C3 导出保真 — round-trip(导出数字 == derive 计算值)", () => {
  it("输出/治疗表:每行数字与 deriveSummary 完全一致", () => {
    const md = buildReportMarkdown(m);
    const rows = parseTable(md, "## 输出/治疗");
    const summary = deriveSummary(m);
    expect(rows.length).toBe(summary.length);
    for (let i = 0; i < rows.length; i++) {
      const [name, dmg, heal, taken, deaths] = rows[i]!;
      const s = summary[i]!;
      expect(name).toBe(s.name.split("-")[0]);
      expect(Number(dmg)).toBe(s.damageDone);
      expect(Number(heal)).toBe(s.healingDone);
      expect(Number(taken)).toBe(s.damageTaken);
      expect(Number(deaths)).toBe(s.deaths);
    }
  });

  it("统计表与失误清单:计数与 derive 一致(含窗口口径)", () => {
    const range = { fromS: 10, toS: 60 };
    const md = buildReportMarkdown(m, range);
    expect(md).toContain("窗口 0:10–1:00(50s)");

    const statRows = parseTable(md, "## 统计");
    const stats = deriveStatsTable(m, range);
    expect(statRows.length).toBe(stats.length);
    for (let i = 0; i < statRows.length; i++) {
      expect(Number(statRows[i]![1])).toBe(stats[i]!.kicksCast);
      expect(Number(statRows[i]![3])).toBe(stats[i]!.ccTakenS);
    }

    const mistakes = deriveMistakes(m, range);
    if (mistakes.length > 0) {
      expect(md).toContain(`## 失误清单(${mistakes.length} 条`);
      const bullets = md
        .split("\n")
        .filter((l) => l.startsWith("- ") && l.includes("["));
      expect(bullets.length).toBe(mistakes.length);
    }
  });

  it("全场导出与窗口导出的数字不同(窗口真的生效,不是同一份文本换标题)", () => {
    const full = buildReportMarkdown(m);
    const windowed = buildReportMarkdown(m, { fromS: 10, toS: 40 });
    const fullDmg = parseTable(full, "## 输出/治疗").map((r) => r[1]);
    const winDmg = parseTable(windowed, "## 输出/治疗").map((r) => r[1]);
    expect(winDmg).not.toEqual(fullDmg);
  });

  it("findings 导出:每条 finding 一行,severity 大写入括号", () => {
    const findings = [
      { severity: "high", title: "T1", explanation: "E1" },
      { severity: "low", title: "T2", explanation: "E2" },
    ] as never[];
    const md = buildFindingsMarkdown(findings, "2 findings");
    expect(md.split("\n")[0]).toBe("2 findings");
    expect(md).toContain("- [HIGH] T1 — E1");
    expect(md).toContain("- [LOW] T2 — E2");
  });
});

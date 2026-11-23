import type { Finding } from "@gladlog/analysis";
import { fmtTime } from "@gladlog/analysis";

import { type Language, translate } from "../../../../shared/i18n";
import { deriveKickDash } from "./kickDash";
import { meterValue } from "./meterRows";
import { deriveMistakes } from "./mistakes";
import { deriveStatsTable } from "./statsTable";
import { deriveSummary } from "./summary";
import { shortUnitName } from "./teamSide";
import { rangeDurationS, type TimeRange } from "./timeRange";
import type { ReportSource } from "./types";

/**
 * C3 export fidelity (verifiability roadmap): the exported Markdown is assembled
 * from **exactly the same derive functions as the UI** -- shared numbers are
 * guaranteed by construction; report.export.test then does a round-trip
 * (parsing the numbers back out of the exported text and reconciling them with
 * derive) so the formatting layer (rounding / wrong column / wrong label)
 * cannot introduce a second truth. Image export is still missing (see the C3
 * note in the roadmap).
 *
 * Calling the same derive function is **not** enough: a column must also pick
 * the same *composition* the UI shows. 2026-08-17 the 治疗 column read
 * `r.healingDone` while the leaderboard shows `healingDone + absorbsDone`, so a
 * Discipline priest's shields vanished from the export (measured on b6057f93
 * round 3: 6,846,504 → 3,908,949, rank 1 → 2). Columns that mirror a
 * leaderboard mode now go through `meterValue`, the leaderboard's own
 * predicate — see docs/predicate-index.md.
 */

export function buildReportMarkdown(
  source: ReportSource,
  range?: TimeRange | null,
  lang: Language = "zh",
): string {
  const lines: string[] = [];
  const durS = Math.round(rangeDurationS(source, range));
  lines.push(
    translate(lang, "report.export.title", {
      bracket: source.bracket,
      result: source.result,
    }) +
      (range
        ? translate(lang, "report.export.window", {
            from: fmtTime(range.fromS),
            to: fmtTime(range.toS),
            s: durS,
          })
        : ""),
  );

  lines.push(
    "",
    translate(lang, "report.export.outputHeading"),
    "",
    translate(lang, "report.export.outputHeader"),
    "| --- | ---: | ---: | ---: | ---: |",
  );
  for (const r of deriveSummary(source, range)) {
    // 治疗列走 meterValue 而不是 r.healingDone:治疗榜的口径是「治疗 + 吸收」,
    // 手抄 healingDone 会让戒律牧/铭文法这类护盾职业在导出里凭空少掉整块盾
    // (实测 b6057f93 第 3 轮:戒律牧 6,846,504 → 3,908,949,名次由第 1 掉到第 2)。
    lines.push(
      `| ${shortUnitName(r.name)} | ${r.damageDone} | ${meterValue(r, "healing")} | ${r.damageTaken} | ${r.deaths} |`,
    );
  }

  const stats = deriveStatsTable(source, range, lang);
  if (stats.length > 0) {
    lines.push(
      "",
      translate(lang, "report.export.statsHeading"),
      "",
      translate(lang, "report.export.statsHeader"),
      "| --- | ---: | ---: | ---: | ---: | ---: |",
    );
    for (const r of stats) {
      lines.push(
        `| ${shortUnitName(r.name)} | ${r.kicksCast} | ${r.kicksTaken} | ${r.ccTakenS} | ${r.cleanses} | ${r.purges} |`,
      );
    }
  }

  const kicks = deriveKickDash(source, range);
  if (kicks.length > 0) {
    lines.push(
      "",
      translate(lang, "report.export.kicksHeading"),
      "",
      translate(lang, "report.export.kicksHeader"),
      "| --- | ---: | ---: | ---: | ---: | ---: |",
    );
    for (const r of kicks) {
      lines.push(
        `| ${shortUnitName(r.name)} | ${r.total} | ${r.landed} | ${r.silenced} | ${r.juked} | ${r.missed}${r.refused > 0 ? translate(lang, "report.export.refused", { n: r.refused }) : ""} |`,
      );
    }
  }

  const mistakes = deriveMistakes(source, range, lang);
  if (mistakes.length > 0) {
    lines.push(
      "",
      translate(lang, "report.export.mistakesHeading", { n: mistakes.length }),
      "",
    );
    const wholeRound = translate(lang, "report.export.wholeRound");
    for (const mk of mistakes) {
      lines.push(
        `- ${mk.tS > 0 ? fmtTime(mk.tS) : wholeRound} [${mk.severity}] ${shortUnitName(mk.unitName)} · ${mk.label}${mk.detail ? ` — ${mk.detail}` : ""}`,
      );
    }
  }

  return lines.join("\n") + "\n";
}

/** AI findings export (consumed by ExportButtons; migrated out of an inline
 * string in the component so it is covered by the fidelity tests). */
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

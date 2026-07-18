import { SPELL_ICONS_GENERATED } from "@gladlog/analysis";

import type { BreakdownRow } from "../derive/detailBreakdown";
import { SpellIcon } from "./SpellIcon";

const TOP_N = 8;
const fmt = (n: number): string => Math.round(n).toLocaleString("en-US");

/** meters 行内的按技能/来源分解表(spec 2026-07-18-report-detail-breakdown)。 */
export function BreakdownTable({
  rows,
  critAvailable,
  mode,
}: {
  rows: BreakdownRow[];
  critAvailable: boolean;
  mode: "damage" | "healing" | "taken";
}) {
  if (rows.length === 0)
    return <div className="rpt-breakdown rpt-breakdown-empty">无数据</div>;
  const top = rows.slice(0, TOP_N);
  const rest = rows.slice(TOP_N);
  const restTotal = rest.reduce((a, r) => a + r.total, 0);
  const restShare = rest.reduce((a, r) => a + r.sharePct, 0);
  const showOverheal = mode === "healing";
  return (
    <table className="rpt-breakdown">
      <thead>
        <tr>
          <th>技能</th>
          <th>总量</th>
          <th>占比</th>
          <th>次数</th>
          {critAvailable && <th>暴击</th>}
          {showOverheal && <th>过量</th>}
          <th>最大一击</th>
        </tr>
      </thead>
      <tbody>
        {top.map((r) => (
          <tr key={r.key}>
            <td className="rpt-breakdown-spell">
              <SpellIcon
                icon={SPELL_ICONS_GENERATED[r.spellId]}
                label={r.label}
              />{" "}
              {r.label}
              {r.isAbsorb && <span className="rpt-breakdown-tag">吸收</span>}
            </td>
            <td>{fmt(r.total)}</td>
            <td>{r.sharePct.toFixed(0)}%</td>
            <td>{r.hits}</td>
            {critAvailable && (
              <td>{r.critPct !== null ? `${r.critPct}%` : "—"}</td>
            )}
            {showOverheal && (
              <td>{r.overhealPct !== undefined ? `${r.overhealPct}%` : "—"}</td>
            )}
            <td>{fmt(r.maxHit)}</td>
          </tr>
        ))}
        {rest.length > 0 && (
          <tr className="rpt-breakdown-rest">
            <td>其余 {rest.length} 个(合计)</td>
            <td>{fmt(restTotal)}</td>
            <td>{restShare.toFixed(0)}%</td>
            <td
              colSpan={2 + (critAvailable ? 1 : 0) + (showOverheal ? 1 : 0)}
            />
          </tr>
        )}
      </tbody>
    </table>
  );
}

import { SPELL_ICONS_GENERATED } from "@gladlog/analysis";

import type { Language } from "../../../../shared/i18n";
import { formatNumber } from "../../i18n/format";
import { useT } from "../../i18n/LangProvider";
import type { BreakdownRow } from "../derive/detailBreakdown";
import { abbrevAmount } from "../derive/meterRows";
import { SpellIcon } from "./SpellIcon";

const TOP_N = 8;
const fmt = (n: number, lang: Language): string =>
  formatNumber(Math.round(n), lang);

/** Per-spell / per-source breakdown table inside a meters row (spec
 * 2026-07-18-report-detail-breakdown). */
export function BreakdownTable({
  rows,
  critAvailable,
  mode,
}: {
  rows: BreakdownRow[];
  critAvailable: boolean;
  mode: "damage" | "healing" | "taken";
}) {
  const { lang } = useT();
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
            <td title={fmt(r.total, lang)}>{abbrevAmount(r.total, lang)}</td>
            <td>{r.sharePct.toFixed(0)}%</td>
            <td>{r.hits}</td>
            {critAvailable && (
              <td>{r.critPct !== null ? `${r.critPct}%` : "—"}</td>
            )}
            {showOverheal && (
              <td>{r.overhealPct !== undefined ? `${r.overhealPct}%` : "—"}</td>
            )}
            <td title={fmt(r.maxHit, lang)}>{abbrevAmount(r.maxHit, lang)}</td>
          </tr>
        ))}
        {rest.length > 0 && (
          <tr className="rpt-breakdown-rest">
            <td>其余 {rest.length} 个(合计)</td>
            <td title={fmt(restTotal, lang)}>
              {abbrevAmount(restTotal, lang)}
            </td>
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

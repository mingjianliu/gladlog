import { classColor } from "../data/gameConstants";
import type { StatsRow } from "../derive/statsTable";

/**
 * 统计表(backlog #10):打断做/挨、被控秒数与占比、驱散/偷。列结构照抄
 * 旧仓 CombatCC 的信息密度;数据来自 deriveStatsTable(analysis 谓词)。
 */
export function StatsTable({
  rows,
  durationS,
}: {
  rows: StatsRow[];
  durationS: number;
}) {
  const perMin = (n: number): string =>
    ((n * 60) / Math.max(1, durationS)).toFixed(1);
  return (
    <table className="rpt-stats" data-testid="stats-table">
      <thead>
        <tr>
          <th>玩家</th>
          <th colSpan={2}>打断施放</th>
          <th>被打断</th>
          <th colSpan={2}>被控</th>
          <th>驱散</th>
          <th>偷/purge</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.unitId}
            className={r.reaction === "Hostile" ? "rpt-stats-enemy" : ""}
          >
            <td>
              <span
                className="rpt-meter-dot"
                style={{
                  background: classColor(r.classId),
                  borderColor: classColor(r.classId),
                }}
              />
              {r.name}
            </td>
            <td>{r.kicksCast}</td>
            <td className="rpt-stats-dim">{perMin(r.kicksCast)}/min</td>
            <td>{r.kicksTaken}</td>
            <td>{r.ccTakenS.toFixed(1)}s</td>
            <td className="rpt-stats-dim">{r.ccTakenPct}%</td>
            <td>{r.cleanses}</td>
            <td>{r.purges}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

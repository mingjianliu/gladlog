import type { ReportSource } from "../derive/types";
import { deriveAuraEvents, deriveCasts } from "../derive/casts";
import { specName } from "../data/gameConstants";
import { getTalentNames } from "@gladlog/analysis";
import { SpellIcon } from "./SpellIcon";

const relTime = (t: number, start: number): string => {
  const s = (t - start) / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};

export function UnitPanel({
  source,
  unitId,
}: {
  source: ReportSource;
  unitId: string;
}) {
  const u = source.units[unitId];
  if (!u) return <div className="rpt-unitpanel">未选中单位</div>;
  const casts = deriveCasts(source, unitId);
  const auras = deriveAuraEvents(source, unitId);
  return (
    <div className="rpt-unitpanel">
      <h3>
        {u.name}{" "}
        <span className="rpt-player-sub">
          {specName(u.specId)}
          {u.info ? ` · ${u.info.personalRating}` : ""}
        </span>
      </h3>
      {u.info && (() => {
        const named = u.info ? getTalentNames(Number(u.info.specId), u.info.talents as { id1: number; id2: number; count: number }[]) : [];
        if (named.length > 0) {
          return (
            <div className="rpt-talents">
              {named.map((t, idx) => (
                <div key={idx}>
                  <SpellIcon icon={t.icon} label={t.name} /> {t.name}
                  {t.rank > 1 ? ` (${t.rank})` : ""}
                </div>
              ))}
            </div>
          );
        }
        return (
          <>
            {/* game-data pipeline in sub-project 5 will replace this with named rendering */}
            <p className='rpt-build'>天赋 {u.info.talents.length} 项 · 装备 {u.info.equipment.length} 件</p>
            <details className='rpt-build-raw'>
              <summary>原始构建数据</summary>
              <pre>{JSON.stringify({ talents: u.info.talents, pvpTalents: u.info.pvpTalents, equipment: u.info.equipment }, null, 1)}</pre>
            </details>
          </>
        );
      })()}
      <h4>施法({casts.length})</h4>
      <div className="rpt-scroll">
        <table>
          <tbody>
            {casts.map((c, i) => (
              <tr key={i}>
                <td className="rpt-t">{relTime(c.t, source.startTime)}</td>
                <td>
                  {c.byPet ? "🐾 " : ""}
                  {c.spellName}
                </td>
                <td className="rpt-dim">{c.targetName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4>光环事件({auras.length})</h4>
      <div className="rpt-scroll">
        <table>
          <tbody>
            {auras.map((a, i) => (
              <tr key={i}>
                <td className="rpt-t">{relTime(a.t, source.startTime)}</td>
                <td>
                  {a.applied ? "+" : "−"} {a.spellName}
                </td>
                <td className="rpt-dim">{a.auraType}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

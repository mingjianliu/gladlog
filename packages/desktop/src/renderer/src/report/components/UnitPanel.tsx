import { getTalentNames } from "@gladlog/analysis";

import { specName } from "../data/gameConstants";
import { deriveUnitTimeline } from "../derive/casts";
import type { ReportSource } from "../derive/types";
import { SpellIcon } from "./SpellIcon";

const relTime = (t: number, start: number): string => {
  const s = (t - start) / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};

/** curated 分类 → 中文简标(未覆盖的分类回退英文 slug)。 */
const CATEGORY_LABEL: Record<string, string> = {
  cc: "控制",
  roots: "定身",
  immunities: "免疫",
  interrupts: "打断",
  disarms: "缴械",
  buffs_defensive: "防御",
  buffs_offensive: "进攻",
  buffs_speed_boost: "加速",
  buffs_other: "增益",
  debuffs_defensive: "防御(减)",
  debuffs_offensive: "进攻(减)",
  debuffs_other: "减益",
};

export function UnitPanel({
  source,
  unitId,
  onSelectUnit,
}: {
  source: ReportSource;
  unitId: string;
  onSelectUnit: (id: string) => void;
}) {
  const u = source.units[unitId];
  const players = Object.values(source.units)
    .filter((p) => p.kind === "Player")
    .sort(
      (a, b) =>
        (a.info?.teamId ?? 99) - (b.info?.teamId ?? 99) ||
        a.name.localeCompare(b.name),
    );
  const events = u ? deriveUnitTimeline(source, unitId) : [];
  return (
    <div className="rpt-unitpanel">
      <label className="rpt-unit-filter">
        <span>单位</span>
        <select value={unitId} onChange={(e) => onSelectUnit(e.target.value)}>
          {players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {specName(p.specId)}
            </option>
          ))}
        </select>
      </label>
      {!u ? (
        <p className="rpt-dim">未选中单位</p>
      ) : (
        <>
          <h3>
            {u.name}{" "}
            <span className="rpt-player-sub">
              {specName(u.specId)}
              {u.info ? ` · ${u.info.personalRating}` : ""}
            </span>
          </h3>
          {u.info &&
            (() => {
              const named = u.info
                ? getTalentNames(
                    Number(u.info.specId),
                    u.info.talents as {
                      id1: number;
                      id2: number;
                      count: number;
                    }[],
                  )
                : [];
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
                  <p className="rpt-build">
                    天赋 {u.info.talents.length} 项 · 装备{" "}
                    {u.info.equipment.length} 件
                  </p>
                  <details className="rpt-build-raw">
                    <summary>原始构建数据</summary>
                    <pre>
                      {JSON.stringify(
                        {
                          talents: u.info.talents,
                          pvpTalents: u.info.pvpTalents,
                          equipment: u.info.equipment,
                        },
                        null,
                        1,
                      )}
                    </pre>
                  </details>
                </>
              );
            })()}
          <h4>施法 + 重要光环({events.length})</h4>
          <div className="rpt-scroll rpt-scroll-tall">
            <table>
              <tbody>
                {events.map((e, i) => (
                  <tr
                    key={i}
                    className={
                      e.kind === "aura" ? "rpt-ev-aura" : "rpt-ev-cast"
                    }
                  >
                    <td className="rpt-t">{relTime(e.t, source.startTime)}</td>
                    <td>
                      {e.kind === "cast" ? (
                        <>
                          {e.byPet ? "🐾 " : ""}
                          {e.spellName}
                        </>
                      ) : (
                        <>
                          <span
                            className={
                              e.applied ? "rpt-aura-on" : "rpt-aura-off"
                            }
                          >
                            {e.applied ? "+" : "−"}
                          </span>{" "}
                          {e.spellName}
                        </>
                      )}
                    </td>
                    <td className="rpt-dim">
                      {e.kind === "cast" ? (
                        e.targetName
                      ) : (
                        <span className="rpt-cat">
                          {CATEGORY_LABEL[e.category] ?? e.category}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

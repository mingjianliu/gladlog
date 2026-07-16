import { useMemo } from "react";

import type { StoredMatchMeta } from "../../../main/matchStore";
import { specIconUrl, specName } from "../report/data/gameConstants";

export interface ListFilter {
  result: "all" | "win" | "loss";
  bracket: string; // "all" 或具体值
  specId: number | null; // 任一方阵容含该专精
}

export const EMPTY_FILTER: ListFilter = {
  result: "all",
  bracket: "all",
  specId: null,
};

export function applyFilter(
  metas: StoredMatchMeta[],
  f: ListFilter,
): StoredMatchMeta[] {
  return metas.filter((m) => {
    if (f.result !== "all") {
      const r = m.result.toLowerCase();
      if (f.result === "win" ? r !== "win" : r === "win") return false;
    }
    if (f.bracket !== "all" && m.bracket !== f.bracket) return false;
    if (f.specId != null) {
      // 旧行无 teams:选了专精筛选时视为不匹配(回退行不可判定)
      if (!m.teams) return false;
      if (!m.teams.some((team) => team.some((p) => p.specId === f.specId)))
        return false;
    }
    return true;
  });
}

/**
 * 列表筛选条(对齐旧仓 MatchSearch 的 bracket/spec 维度,纯客户端):
 * 胜负、赛制下拉、专精下拉(选项来自已加载 meta 的实际阵容)。
 * 注意:筛选作用于**已加载**的分页数据 —— 滚动加载更早后选项/结果会增多。
 */
export function MatchListFilter({
  metas,
  filter,
  onChange,
}: {
  metas: StoredMatchMeta[];
  filter: ListFilter;
  onChange: (f: ListFilter) => void;
}) {
  const brackets = useMemo(
    () => [...new Set(metas.map((m) => m.bracket))].sort(),
    [metas],
  );
  const specIds = useMemo(() => {
    const s = new Set<number>();
    for (const m of metas)
      for (const team of m.teams ?? []) for (const p of team) s.add(p.specId);
    return [...s].sort((a, b) => specName(a).localeCompare(specName(b)));
  }, [metas]);

  const active =
    filter.result !== "all" ||
    filter.bracket !== "all" ||
    filter.specId != null;

  return (
    <div className="mlf" data-testid="list-filter">
      <div className="mlf-seg">
        {(["all", "win", "loss"] as const).map((r) => (
          <button
            key={r}
            className={filter.result === r ? "active" : ""}
            onClick={() => onChange({ ...filter, result: r })}
          >
            {r === "all" ? "全部" : r === "win" ? "胜" : "负"}
          </button>
        ))}
      </div>
      <select
        value={filter.bracket}
        onChange={(e) => onChange({ ...filter, bracket: e.target.value })}
        title="赛制"
      >
        <option value="all">全部赛制</option>
        {brackets.map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
      </select>
      <select
        value={filter.specId ?? ""}
        onChange={(e) =>
          onChange({
            ...filter,
            specId: e.target.value === "" ? null : Number(e.target.value),
          })
        }
        title="含该专精(任一方)"
      >
        <option value="">全部专精</option>
        {specIds.map((id) => (
          <option key={id} value={id}>
            {specName(id) || `spec ${id}`}
          </option>
        ))}
      </select>
      {filter.specId != null && specIconUrl(filter.specId) && (
        <img
          className="mlf-spec"
          src={specIconUrl(filter.specId)!}
          alt={specName(filter.specId)}
        />
      )}
      {active && (
        <button className="mlf-clear" onClick={() => onChange(EMPTY_FILTER)}>
          清除
        </button>
      )}
    </div>
  );
}

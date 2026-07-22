import { useMemo } from "react";

import type { StoredMatchMeta } from "../../../main/matchStore";
import { specIconUrl, specName } from "../report/data/gameConstants";

export interface ListFilter {
  result: "all" | "win" | "loss";
  bracket: string; // "all" 或具体值
  /**
   * 专精筛选,同队全含语义(backlog #9 的 spec 与 comp 用同一个控件):
   * 选 1 个 = 任一方阵容含该专精;选多个 = 存在一支队伍同时含全部所选
   * (comp 检索,如 冰法+痛苦术 = 双法组合)。空数组 = 不筛。
   */
  specIds: number[];
  /** 日期范围("YYYY-MM-DD",本地日,含端点);null = 不限。 */
  dateFrom: string | null;
  dateTo: string | null;
}

export const EMPTY_FILTER: ListFilter = {
  result: "all",
  bracket: "all",
  specIds: [],
  dateFrom: null,
  dateTo: null,
};

/** comp 最多选到 3 个专精(竞技场一队就 2–3 人)。 */
const MAX_COMP_SPECS = 3;

export function applyFilter(
  metas: StoredMatchMeta[],
  f: ListFilter,
): StoredMatchMeta[] {
  // 端点按本地日解释,含当天全部时刻
  const fromMs = f.dateFrom
    ? new Date(`${f.dateFrom}T00:00:00`).getTime()
    : null;
  const toMs = f.dateTo ? new Date(`${f.dateTo}T23:59:59.999`).getTime() : null;
  return metas.filter((m) => {
    if (f.result !== "all") {
      const r = m.result.toLowerCase();
      if (f.result === "win" ? r !== "win" : r === "win") return false;
    }
    if (f.bracket !== "all" && m.bracket !== f.bracket) return false;
    if (f.specIds.length > 0) {
      // 旧行无 teams:选了专精筛选时视为不匹配(回退行不可判定)
      if (!m.teams) return false;
      // 同队全含:所选专精必须全部出现在同一支队伍里
      if (
        !m.teams.some((team) =>
          f.specIds.every((id) => team.some((p) => p.specId === id)),
        )
      )
        return false;
    }
    if (fromMs !== null && m.startTime < fromMs) return false;
    if (toMs !== null && m.startTime > toMs) return false;
    return true;
  });
}

/**
 * 列表筛选条(backlog #9,纯客户端 —— #12 后台补载已把全量 meta 常驻内存):
 * 胜负、赛制下拉、专精 chips(同队全含 = comp 检索)、日期范围。
 * 选项来自已加载 meta 的实际阵容;补载完成前选项/结果会随加载增多。
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
    filter.specIds.length > 0 ||
    filter.dateFrom !== null ||
    filter.dateTo !== null;

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
      {filter.specIds.length < MAX_COMP_SPECS && (
        <select
          value=""
          onChange={(e) => {
            const id = Number(e.target.value);
            if (!e.target.value || filter.specIds.includes(id)) return;
            onChange({ ...filter, specIds: [...filter.specIds, id] });
          }}
          title="加一个专精(选多个 = 同队组合检索)"
        >
          <option value="">
            {filter.specIds.length === 0 ? "全部专精" : "+ 专精(同队)"}
          </option>
          {specIds
            .filter((id) => !filter.specIds.includes(id))
            .map((id) => (
              <option key={id} value={id}>
                {specName(id) || `spec ${id}`}
              </option>
            ))}
        </select>
      )}
      {filter.specIds.map((id) => (
        <button
          key={id}
          className="mlf-chip"
          title={`移除 ${specName(id)}`}
          onClick={() =>
            onChange({
              ...filter,
              specIds: filter.specIds.filter((s) => s !== id),
            })
          }
        >
          {specIconUrl(id) && (
            <img className="mlf-spec" src={specIconUrl(id)!} alt="" />
          )}
          {specName(id) || `spec ${id}`} ✕
        </button>
      ))}
      {/* 日期组包成不可拆单元:flex-wrap 折行时整组一起走,分隔符不孤行 */}
      <span className="mlf-dates">
        <input
          type="date"
          value={filter.dateFrom ?? ""}
          onChange={(e) =>
            onChange({ ...filter, dateFrom: e.target.value || null })
          }
          title="起始日期"
        />
        <span className="mlf-datesep">–</span>
        <input
          type="date"
          value={filter.dateTo ?? ""}
          onChange={(e) =>
            onChange({ ...filter, dateTo: e.target.value || null })
          }
          title="结束日期"
        />
      </span>
      {active && (
        <button className="mlf-clear" onClick={() => onChange(EMPTY_FILTER)}>
          清除
        </button>
      )}
    </div>
  );
}

import { zoneMetadata } from "@gladlog/analysis";
import { useMemo } from "react";

import type { StoredMatchMeta } from "../../../main/matchStore";
import { useIconDataUrls } from "../report/components/useIconDataUrl";
import { specIconName, specName } from "../report/data/gameConstants";

export interface ListFilter {
  result: "all" | "win" | "loss";
  bracket: string; // "all" or a concrete value
  /**
   * Spec filter with same-team all-of semantics (backlog #9 uses one control
   * for both spec and comp): picking 1 = either side's roster contains that
   * spec; picking several = some single team contains all of them (comp
   * search, e.g. Frost Mage + Affliction Warlock = the double-caster comp).
   * An empty array = no filtering.
   */
  specIds: number[];
  /** Map filter (entered by clicking a per-map card row on the records page);
   * null = no filtering. The entry point is the records page; the filter bar
   * itself only shows a clearable chip and offers no dropdown. */
  zoneId: string | null;
  /** Date range ("YYYY-MM-DD", local days, endpoints inclusive); null =
   * unbounded. */
  dateFrom: string | null;
  dateTo: string | null;
}

export const EMPTY_FILTER: ListFilter = {
  result: "all",
  bracket: "all",
  specIds: [],
  zoneId: null,
  dateFrom: null,
  dateTo: null,
};

/** A comp search takes at most 3 specs (an arena team is only 2–3 players). */
const MAX_COMP_SPECS = 3;

export function applyFilter(
  metas: StoredMatchMeta[],
  f: ListFilter,
): StoredMatchMeta[] {
  // Endpoints are interpreted as local days, covering every instant of that day
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
    if (f.zoneId !== null && m.zoneId !== f.zoneId) return false;
    if (f.specIds.length > 0) {
      // Old rows have no teams: treat them as non-matching when a spec filter
      // is active (a fallback row cannot be judged)
      if (!m.teams) return false;
      // Same-team all-of: every selected spec must appear on one same team
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
 * The list filter bar (backlog #9, purely client-side — #12's background
 * backfill already keeps every meta resident in memory): win/loss, a bracket
 * dropdown, spec chips (same-team all-of = comp search), and a date range.
 * The options come from the actual rosters of the metas loaded so far, so
 * until the backfill finishes both options and results grow as loading
 * progresses.
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

  // Chip icons for the selected specs: fetched via the main process's
  // iconCache, no longer hotlinked from an external CDN
  // (docs/DATA-COMPLIANCE.md). If an icon can't be fetched, only the spec name
  // is shown and the chip still works as usual.
  const specIcons = useIconDataUrls(filter.specIds.map(specIconName));

  const active =
    filter.result !== "all" ||
    filter.bracket !== "all" ||
    filter.specIds.length > 0 ||
    filter.zoneId !== null ||
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
          {specIcons[specIconName(id) ?? ""] && (
            <img
              className="mlf-spec"
              src={specIcons[specIconName(id) ?? ""]}
              alt=""
            />
          )}
          {specName(id) || `spec ${id}`} ✕
        </button>
      ))}
      {filter.zoneId !== null && (
        <button
          className="mlf-chip"
          title="移除地图筛选"
          onClick={() => onChange({ ...filter, zoneId: null })}
        >
          {zoneMetadata[filter.zoneId]?.name ?? `zone ${filter.zoneId}`} ✕
        </button>
      )}
      {/* Wrap the date group as an unbreakable unit: when flex-wrap wraps, the
          whole group moves together and the separator never ends up alone */}
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

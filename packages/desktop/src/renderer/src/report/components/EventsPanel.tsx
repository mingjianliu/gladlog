import { useEffect, useMemo, useState } from "react";

import {
  deriveEventRows,
  EMPTY_EVENTS_FILTER,
  EVENT_KIND_LABEL,
  filterEventRows,
  type EventKind,
} from "../derive/eventsView";
import type { TimeRange } from "../derive/timeRange";
import type { ReportSource } from "../derive/types";
import type { VulnBand } from "../derive/vulnWindows";

const fmtT = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** 一次渲染的行数上限;超出分页加载(事件量在万级,别一次挂全部 DOM)。 */
const PAGE = 300;

/**
 * events 视图(第四阶段②,WCL Events 的结构化过滤版):
 * 类型 chips / 单位 / 技能子串 / 窗口锚定(全场・全局时间窗・击杀/脆弱窗)
 * 五维过滤 + ▶ 逐行跳回放。窗口锚定 = WCL 手写 `IN RANGE FROM..TO`
 * 表达式的 90% 用例,选项直接用现成的计算窗口。
 */
export function EventsPanel({
  source,
  bands,
  globalRange,
  onSeek,
  inspectReq,
}: {
  source: ReportSource;
  bands: VulnBand[];
  /** 全局时间窗(战报视图选的);作为锚定选项之一。 */
  globalRange: TimeRange | null;
  onSeek?: (tSeconds: number, unitNames: string[]) => void;
  /** B2 溯源请求(finding →「原始事件」):nonce 变化时预置过滤。 */
  inspectReq?: {
    fromS: number;
    toS: number;
    unitName: string | null;
    nonce: number;
  } | null;
}) {
  const allRows = useMemo(() => deriveEventRows(source), [source]);
  const unitNames = useMemo(
    () =>
      [
        ...new Set(
          Object.values(source.units)
            .filter((u) => u.kind === "Player" && u.info)
            .map((u) => u.name.split("-")[0]!),
        ),
      ].sort(),
    [source],
  );

  const [kinds, setKinds] = useState<EventKind[]>([]);
  const [unitName, setUnitName] = useState<string | null>(null);
  const [spellQuery, setSpellQuery] = useState("");
  // 锚定键:'all' | 'global' | 'custom' | 'band:<i>' —— 每次渲染从键解 range
  const [anchor, setAnchor] = useState<string>(globalRange ? "global" : "all");
  const [customRange, setCustomRange] = useState<TimeRange | null>(null);
  const [shown, setShown] = useState(PAGE);

  // 溯源请求落地:±15s 窗口 + 单位过滤,清掉类型/技能过滤(别把目标事件滤没)
  useEffect(() => {
    if (!inspectReq) return;
    setCustomRange({ fromS: inspectReq.fromS, toS: inspectReq.toS });
    setAnchor("custom");
    setUnitName(inspectReq.unitName);
    setKinds([]);
    setSpellQuery("");
    setShown(PAGE);
  }, [inspectReq?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const range: TimeRange | null =
    anchor === "custom"
      ? customRange
      : anchor === "global"
      ? globalRange
      : anchor.startsWith("band:")
        ? (() => {
            const b = bands[Number(anchor.slice(5))];
            return b ? { fromS: b.fromS, toS: b.toS } : null;
          })()
        : null;

  const filtered = useMemo(
    () =>
      filterEventRows(allRows, {
        ...EMPTY_EVENTS_FILTER,
        kinds,
        unitName,
        spellQuery,
        range,
      }),
    [allRows, kinds, unitName, spellQuery, range],
  );

  const toggleKind = (k: EventKind) => {
    setKinds((cur) =>
      cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k],
    );
    setShown(PAGE);
  };

  return (
    <div className="rpt-events" data-testid="events-panel">
      <div className="rpt-events-filters">
        <div className="rpt-mode-seg rpt-events-kinds">
          {(Object.keys(EVENT_KIND_LABEL) as EventKind[]).map((k) => (
            <button
              key={k}
              className={kinds.includes(k) ? "active" : ""}
              onClick={() => toggleKind(k)}
            >
              {EVENT_KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <select
          value={unitName ?? ""}
          onChange={(e) => {
            setUnitName(e.target.value || null);
            setShown(PAGE);
          }}
          title="来源或目标含该玩家"
        >
          <option value="">全部玩家</option>
          {unitNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <select
          value={anchor}
          onChange={(e) => {
            setAnchor(e.target.value);
            setShown(PAGE);
          }}
          title="窗口锚定"
        >
          <option value="all">全场</option>
          {customRange && (
            <option value="custom">
              溯源窗口 {fmtT(customRange.fromS)}–{fmtT(customRange.toS)}
            </option>
          )}
          {globalRange && (
            <option value="global">
              全局时间窗 {fmtT(globalRange.fromS)}–{fmtT(globalRange.toS)}
            </option>
          )}
          {bands.map((b, i) => (
            <option key={i} value={`band:${i}`}>
              {fmtT(b.fromS)}–{fmtT(b.toS)}{" "}
              {b.kind === "burst" ? "击杀尝试" : "脆弱"} ·{" "}
              {b.targetName.split("-")[0]}
            </option>
          ))}
        </select>
        <input
          type="search"
          placeholder="技能名过滤…"
          value={spellQuery}
          onChange={(e) => {
            setSpellQuery(e.target.value);
            setShown(PAGE);
          }}
        />
        <span className="rpt-stats-dim">
          {filtered.length} / {allRows.length} 条
        </span>
      </div>
      <table className="rpt-stats rpt-events-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>类型</th>
            <th>来源</th>
            <th>目标</th>
            <th>技能</th>
            <th>详情</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {filtered.slice(0, shown).map((r, i) => (
            <tr key={i}>
              <td className="rpt-stats-detail-t">{fmtT(r.tS)}</td>
              <td>{EVENT_KIND_LABEL[r.kind]}</td>
              <td>{r.srcName}</td>
              <td>{r.destName}</td>
              <td>{r.spellName}</td>
              <td className="rpt-stats-dim">{r.detail}</td>
              <td>
                {onSeek && (
                  <button
                    className="rpt-stats-detail-jump"
                    title="回放此刻"
                    onClick={() =>
                      onSeek(
                        Math.max(0, r.tS - 3),
                        [r.destName || r.srcName].filter(Boolean),
                      )
                    }
                  >
                    ▶
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length > shown && (
        <button
          className="rpt-events-more"
          onClick={() => setShown((n) => n + PAGE)}
        >
          再显示 {Math.min(PAGE, filtered.length - shown)} 条(共{" "}
          {filtered.length})
        </button>
      )}
    </div>
  );
}

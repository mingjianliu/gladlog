import { zoneMetadata } from "@gladlog/analysis";

import type { ReportSource } from "../derive/types";

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const RESULT_LABEL: Record<string, string> = {
  win: "胜利",
  loss: "失败",
  lose: "失败",
  draw: "平局",
};

/**
 * 页头一行(1c):胜负 + 赛制·地图·时长。玩家名/评分不再出现在页头
 * (它们在榜单里);右侧视图 tab 由 MatchReport 排进同一行。
 */
export function ReportHeader({
  source,
  roundLabel,
}: {
  source: ReportSource;
  roundLabel?: string;
}) {
  const res = source.result.toLowerCase();
  return (
    <div className="rpt-head-left">
      <span className={`rpt-head-result rpt-result-${res}`}>
        {RESULT_LABEL[res] ?? source.result}
      </span>
      <span className="rpt-head-meta">
        {source.bracket} ·{" "}
        {zoneMetadata[String(source.zoneId)]?.name ?? `zone ${source.zoneId}`} ·{" "}
        {fmtDuration(source.endTime - source.startTime)}
        {roundLabel ? ` · ${roundLabel}` : ""}
      </span>
    </div>
  );
}

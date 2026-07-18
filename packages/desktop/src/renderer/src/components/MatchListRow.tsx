import { zoneMetadata } from "@gladlog/analysis";
import { useState } from "react";

import type { StoredMatchMeta } from "../../../main/matchStore";
import {
  classColor,
  classGlyph,
  specIconUrl,
  specName,
} from "../report/data/gameConstants";

const fmtDuration = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const fmtWhen = (t: number): string => new Date(t).toLocaleString();

const fmtHHMM = (t: number): string => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
};

/** spec 图标(CDN);加载失败/未知 spec → 职业色字形点(与回放图例同款)。 */
export function SpecDot({
  specId,
  classId,
}: {
  specId: number;
  classId: number;
}) {
  const [broken, setBroken] = useState(false);
  const url = specIconUrl(specId);
  if (!url || broken) {
    return (
      <span
        className="mlr-spec mlr-spec-fallback"
        title={specName(specId)}
        style={{ background: classColor(classId) }}
      >
        {classGlyph(classId)}
      </span>
    );
  }
  return (
    <img
      className="mlr-spec"
      src={url}
      alt={specName(specId)}
      title={specName(specId)}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

/**
 * 富行(1e):胜负 = 行左缘色线(无文字徽章);上行 地图 + 时长 + 评分涨跌,
 * 下行 己方 spec 组 vs 敌方组 + HH:MM。
 * 旧索引行缺 teams/durationS 时回退纯文本样式(不重建索引也可用)。
 */
export function MatchListRow({
  meta,
  ratingDelta,
}: {
  meta: StoredMatchMeta;
  /** 同 bracket+角色 与上一场的评分差;拿不到(首场/无评分)不显示箭头。 */
  ratingDelta?: number | null;
}) {
  const zone = zoneMetadata[meta.zoneId]?.name;
  const rich = !!meta.teams && meta.teams.length === 2;
  const res = meta.result.toLowerCase();
  const resCls =
    res === "win"
      ? "mlr-win"
      : res === "loss" || res === "lose"
        ? "mlr-loss"
        : "";

  if (!rich) {
    return (
      <div className={`mlr ${resCls}`}>
        <span className={`badge badge-${meta.kind}`}>[{meta.kind}]</span>{" "}
        {meta.bracket} · {fmtWhen(meta.startTime)} · {meta.result}
      </div>
    );
  }

  const [own, foe] = meta.teams!;
  const rating = meta.playerRating ?? meta.avgRating;
  return (
    <div className={`mlr ${resCls}`}>
      <div className="mlr-top">
        {meta.kind === "shuffle" && (
          <span className={`badge badge-${meta.kind}`}>shuffle</span>
        )}
        <span className="mlr-zone">{zone ?? meta.bracket}</span>
        {meta.durationS != null && (
          <span className="mlr-dur">{fmtDuration(meta.durationS)}</span>
        )}
        {rating != null && (
          <span
            className={
              ratingDelta != null && ratingDelta !== 0
                ? ratingDelta > 0
                  ? "mlr-rating up"
                  : "mlr-rating down"
                : "mlr-rating"
            }
          >
            {rating}
            {ratingDelta != null && ratingDelta !== 0
              ? ratingDelta > 0
                ? " ↑"
                : " ↓"
              : ""}
          </span>
        )}
      </div>
      <div className="mlr-teams">
        <span className="mlr-team">
          {own.map((p, i) => (
            <SpecDot key={i} specId={p.specId} classId={p.classId} />
          ))}
        </span>
        <span className="mlr-vs">vs</span>
        <span className="mlr-team">
          {foe.map((p, i) => (
            <SpecDot key={i} specId={p.specId} classId={p.classId} />
          ))}
        </span>
        <span className="mlr-when">{fmtHHMM(meta.startTime)}</span>
      </div>
    </div>
  );
}

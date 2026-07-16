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
 * 富行:上行 胜负 + 地图 + 时长 + 评分,下行 己方 spec 组 vs 敌方组。
 * 旧索引行缺 teams/durationS 时回退纯文本样式(不重建索引也可用)。
 */
export function MatchListRow({ meta }: { meta: StoredMatchMeta }) {
  const zone = zoneMetadata[meta.zoneId]?.name;
  const rich = !!meta.teams && meta.teams.length === 2;

  if (!rich) {
    return (
      <>
        <span className={`badge badge-${meta.kind}`}>[{meta.kind}]</span>{" "}
        {meta.bracket} · {fmtWhen(meta.startTime)} · {meta.result}
      </>
    );
  }

  const [own, foe] = meta.teams!;
  return (
    <div className="mlr">
      <div className="mlr-top">
        <span className={`mlr-result mlr-result-${meta.result.toLowerCase()}`}>
          {meta.result}
        </span>
        {meta.kind === "shuffle" && (
          <span className={`badge badge-${meta.kind}`}>shuffle</span>
        )}
        <span className="mlr-zone">{zone ?? meta.bracket}</span>
        {meta.durationS != null && (
          <span className="mlr-dur">{fmtDuration(meta.durationS)}</span>
        )}
        {meta.avgRating != null && (
          <span className="mlr-rating">{meta.avgRating}</span>
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
        <span className="mlr-when">{fmtWhen(meta.startTime)}</span>
      </div>
    </div>
  );
}

import { fmtTime } from "@gladlog/analysis";
import { useMemo, useState } from "react";

import type {
  Mistake,
  MistakeMoment,
  MistakeSeverity,
} from "../derive/mistakes";
import {
  groupMistakesByMoment,
  rankMistakeMoments,
  splitMistakesByOwner,
} from "../derive/mistakes";
import { UnitName } from "./UnitName";


const SEVERITY_CHIP: Record<MistakeSeverity, { cls: string; label: string }> = {
  major: { cls: "bad", label: "重大" },
  average: { cls: "warn", label: "一般" },
  minor: { cls: "dim", label: "轻微" },
};

/**
 * 默认展开的时刻数。
 *
 * **展示参数,不是判据。** 2026-08-17 实测(200 回合):UI 每回合中位 28 条,
 * 收敛到 owner 视角 9.9 条,再按 ±10s 并成时刻后约 6 组。展开前 3 组 ≈ 一屏,
 * 其余一键展开 —— 目的是让「这一场最该看的三件事」立得住,而不是把 28 条
 * 平铺给人自己挑。
 */
const TOP_MOMENTS = 3;

/**
 * Mistake list card (phase 4 ③ / backlog #8): emitted straight from
 * deterministic rules, never through the LLM.
 *
 * 2026-08-17 改版 —— 起因是 CI 视觉基线更新后看到失误卡被 `cd-hoarded` 刷屏,
 * 实测每回合中位 28 条。两处收敛,都不靠发明阈值:
 *
 *  1. **按归属拆**:队友的整块折叠。近 30% 的条目是 DPS 专属类型
 *     (off-target-in-window / unconverted-burst),owner 视角一条都不会出,
 *     全部来自对每个友方各跑一遍候选提取。
 *  2. **按时刻并**:同一波里的不同侧面并成一行。实测最高频的共现是
 *     `cc-locked + unsynced-burst` / `+ missed-sync-window` / `+ missed-purge`
 *     —— 都是「你被控住的同一波」,本来就是一件事。
 *
 * 三个严重度 chip 仍是过滤器(WoWAnalyzer 的 minor/average/major 形态),
 * 每行的 ▶ 仍跳回放。
 */
export function MistakesCard({
  mistakes,
  onSeek,
}: {
  mistakes: Mistake[];
  onSeek?: (tSeconds: number, unitNames: string[]) => void;
}) {
  const { own, teammates } = useMemo(
    () => splitMistakesByOwner(mistakes),
    [mistakes],
  );
  const ownMoments = useMemo(() => groupMistakesByMoment(own), [own]);
  const mateMoments = useMemo(
    () => groupMistakesByMoment(teammates),
    [teammates],
  );

  const counts = useMemo(() => {
    const c: Record<MistakeSeverity, number> = {
      major: 0,
      average: 0,
      minor: 0,
    };
    for (const m of ownMoments) c[m.severity]++;
    return c;
  }, [ownMoments]);

  const [sel, setSel] = useState<MistakeSeverity | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [showMates, setShowMates] = useState(false);

  if (mistakes.length === 0)
    return (
      <div className="rpt-ledger" data-testid="mistakes-card">
        <div className="rpt-ledger-head">
          <span className="rpt-ledger-title">失误清单</span>
        </div>
        <p className="rpt-ledger-empty">本场未检出失误 —— 干净局。</p>
      </div>
    );

  // 严重度 → 同档内实测判别力 → 时间(GH #19)—— 「最该看的」排前面,而不是
  // 「最早发生的」。排序键在 derive/mistakes.ts 单源,卡片不自带一份。
  const ranked = rankMistakeMoments(ownMoments);
  const filtered = sel ? ranked.filter((m) => m.severity === sel) : ranked;
  const visible = sel || showAll ? filtered : filtered.slice(0, TOP_MOMENTS);
  const hidden = filtered.length - visible.length;

  return (
    <div className="rpt-ledger" data-testid="mistakes-card">
      <div className="rpt-ledger-head">
        <span className="rpt-ledger-title">失误清单</span>
        <div className="rpt-ledger-tabs rpt-mistakes-filter">
          <button
            className={sel === null ? "active" : ""}
            onClick={() => setSel(null)}
          >
            全部 {ownMoments.length}
          </button>
          {(Object.keys(SEVERITY_CHIP) as MistakeSeverity[]).map((s) => (
            <button
              key={s}
              className={sel === s ? "active" : ""}
              onClick={() => setSel((cur) => (cur === s ? null : s))}
            >
              {SEVERITY_CHIP[s].label} {counts[s]}
            </button>
          ))}
        </div>
        <span className="rpt-stats-dim">确定性规则直出</span>
      </div>

      {ownMoments.length === 0 ? (
        // owner 自己干净、但队友有 —— 不能只剩一排 0 和一个折叠按钮,那看起来
        // 像「什么都没检出」。零失误是**正面信号**,要说出来。
        <p className="rpt-ledger-empty">你本人未检出失误 —— 干净局。</p>
      ) : (
        visible.map((moment, i) => (
          <MomentRow key={i} moment={moment} onSeek={onSeek} />
        ))
      )}

      {hidden > 0 && (
        <button
          className="rpt-ledger-empty rpt-mistakes-showminor"
          onClick={() => setShowAll(true)}
          data-testid="mistakes-show-all"
        >
          +{hidden} 个时刻已折叠 —— 点击展开
        </button>
      )}

      {mateMoments.length > 0 && (
        <>
          <button
            className="rpt-ledger-empty rpt-mistakes-showminor"
            onClick={() => setShowMates((v) => !v)}
            data-testid="mistakes-toggle-mates"
          >
            队友 {mateMoments.length} 个时刻 {showMates ? "▲ 收起" : "▼ 展开"}
          </button>
          {showMates &&
            mateMoments.map((moment, i) => (
              <MomentRow key={`m${i}`} moment={moment} onSeek={onSeek} />
            ))}
        </>
      )}
    </div>
  );
}

/** 一个时刻一行:主条目 + 同一波里的其余侧面作为附注。 */
function MomentRow({
  moment,
  onSeek,
}: {
  moment: MistakeMoment;
  onSeek?: (tSeconds: number, unitNames: string[]) => void;
}) {
  const [head, ...rest] = moment.items;
  if (!head) return null;
  const chip = SEVERITY_CHIP[moment.severity];
  return (
    <div className="rpt-ledger-row">
      <span className="rpt-stats-detail-t">
        {moment.timed && moment.tS > 0 ? fmtTime(moment.tS) : "全场"}
      </span>
      <span className={`rpt-ledger-chip rpt-ledger-chip-${chip.cls}`}>
        {chip.label}
      </span>
      <span>
        <UnitName name={head.unitName} /> · {head.label}
        {rest.length > 0 && (
          <span className="rpt-stats-dim">
            {" "}
            ＋同一波:{rest.map((r) => r.label).join("、")}
          </span>
        )}
      </span>
      {head.detail && <span className="rpt-stats-dim">{head.detail}</span>}
      {onSeek && moment.timed && moment.tS > 0 && (
        <button
          className="rpt-stats-detail-jump"
          title="回放此刻"
          onClick={() => onSeek(Math.max(0, moment.tS - 3), head.seekNames)}
        >
          ▶
        </button>
      )}
    </div>
  );
}

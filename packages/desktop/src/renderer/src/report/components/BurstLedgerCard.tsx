import { useMemo, useState } from "react";

import { classColor } from "../data/gameConstants";
import type { LedgerPlayer } from "../derive/burstLedger";

const fmtT = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const fmtDmg = (n: number): string =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(2)}M`
    : `${Math.round(n / 1000)}k`;

function Chip({ kind, children }: { kind: string; children: React.ReactNode }) {
  return (
    <span className={`rpt-ledger-chip rpt-ledger-chip-${kind}`}>
      {children}
    </span>
  );
}

function SeekBtn({
  tS,
  unitName,
  onSeek,
}: {
  tS: number;
  unitName: string;
  onSeek?: (tSeconds: number, unitNames: string[]) => void;
}) {
  if (!onSeek) return null;
  return (
    <button
      className="rpt-stats-detail-jump"
      title="回放此刻"
      onClick={() => onSeek(Math.max(0, tS - 3), [unitName])}
    >
      ▶
    </button>
  );
}

/**
 * 爆发账本卡(DPS 方向 D1):按玩家分页;三节 —— 爆发对齐(每次开大 CD 一行:
 * 目标/HP 变化/打进的减伤或免疫/协同/结局)、kill-window 目标纪律(命中窗口目标
 * 的伤害占比)、打断审计(打断/被骗/空放)。每行 ▶ 跳回放(同 findings seek 管线)。
 */
export function BurstLedgerCard({
  players,
  onSeek,
}: {
  players: LedgerPlayer[];
  onSeek?: (tSeconds: number, unitNames: string[]) => void;
}) {
  const defaultIdx = useMemo(
    () =>
      Math.max(
        0,
        players.findIndex((p) => !p.isHealer),
      ),
    [players],
  );
  const [idx, setIdx] = useState(defaultIdx);
  if (players.length === 0) return null;
  const p = players[Math.min(idx, players.length - 1)];

  return (
    <div className="rpt-ledger" data-testid="burst-ledger">
      <div className="rpt-ledger-head">
        <span className="rpt-ledger-title">爆发账本</span>
        <div className="rpt-ledger-tabs">
          {players.map((pl, i) => (
            <button
              key={pl.unitId}
              className={
                i === Math.min(idx, players.length - 1) ? "active" : ""
              }
              onClick={() => setIdx(i)}
            >
              <span
                className="rpt-meter-dot"
                style={{
                  background: classColor(pl.classId),
                  borderColor: classColor(pl.classId),
                }}
              />
              {pl.name}
            </button>
          ))}
        </div>
      </div>

      {p.bursts.length > 0 && (
        <div className="rpt-ledger-section">
          <span className="rpt-stats-detail-title">爆发对齐</span>
          {p.bursts.map((b, k) => {
            const t = b.dominantTarget;
            const immunities =
              t?.defensivesHit.filter((d) => d.isImmunity) ?? [];
            const walls = t?.defensivesHit.filter((d) => !d.isImmunity) ?? [];
            return (
              <div key={k} className="rpt-ledger-row">
                <span className="rpt-stats-detail-t">
                  {fmtT(b.fromSeconds)}–{fmtT(b.toSeconds)}
                </span>
                <span className="rpt-ledger-spells">
                  {b.spells.map((s) => s.spellName).join(" + ")}
                </span>
                {t ? (
                  <span>
                    → {t.unitName}
                    {t.hpStartPct !== null && t.hpEndPct !== null
                      ? `(${Math.round(t.hpStartPct)}%→${Math.round(t.hpEndPct)}%)`
                      : ""}{" "}
                    {fmtDmg(t.damage)}
                  </span>
                ) : (
                  <Chip kind="warn">未打出伤害</Chip>
                )}
                {immunities.map((d) => (
                  <Chip key={d.spellId} kind="bad">
                    打进免疫 {d.spellName} {d.overlapSeconds.toFixed(1)}s
                  </Chip>
                ))}
                {walls.map((d) => (
                  <Chip key={d.spellId} kind="warn">
                    对方减伤 {d.spellName} {d.overlapSeconds.toFixed(1)}s
                  </Chip>
                ))}
                {b.allyCDsOverlapping.length > 0 ? (
                  <Chip kind="good">
                    协同{" "}
                    {b.allyCDsOverlapping.map((a) => a.playerName).join("、")}
                  </Chip>
                ) : (
                  <Chip kind="dim">单开</Chip>
                )}
                {t?.died && <Chip kind="kill">击杀</Chip>}
                <SeekBtn tS={b.fromSeconds} unitName={p.name} onSeek={onSeek} />
              </div>
            );
          })}
        </div>
      )}

      {p.targeting.length > 0 && (
        <div className="rpt-ledger-section">
          <span className="rpt-stats-detail-title">窗口目标纪律</span>
          {p.targeting.map((w, k) => (
            <div key={k} className="rpt-ledger-row">
              <span className="rpt-stats-detail-t">
                {fmtT(w.windowFromSeconds)}–{fmtT(w.windowToSeconds)}
              </span>
              <span>窗口目标 {w.windowTargetName}</span>
              <Chip kind={w.onTargetPct >= 50 ? "good" : "bad"}>
                命中 {w.onTargetPct}%
              </Chip>
              {w.topOffTarget && w.onTargetPct < 50 && (
                <span className="rpt-stats-dim">
                  最大分流 {w.topOffTarget.unitName}(
                  {fmtDmg(w.topOffTarget.damage)})
                </span>
              )}
              <SeekBtn
                tS={w.windowFromSeconds}
                unitName={p.name}
                onSeek={onSeek}
              />
            </div>
          ))}
        </div>
      )}

      {p.kicks.length > 0 && (
        <div className="rpt-ledger-section">
          <span className="rpt-stats-detail-title">打断审计</span>
          {p.kicks.map((kk, k) => (
            <div key={k} className="rpt-ledger-row">
              <span className="rpt-stats-detail-t">{fmtT(kk.atSeconds)}</span>
              <span>{kk.kickSpellName}</span>
              {kk.result === "landed" && (
                <Chip kind="good">打断 {kk.interruptedSpellName}</Chip>
              )}
              {kk.result === "juked" && (
                <Chip kind="bad">被假读条骗掉({kk.jukedBySpellName})</Chip>
              )}
              {kk.result === "missed" && <Chip kind="warn">落空</Chip>}
              {kk.result === "unknown" && (
                <Chip kind="dim">旧档无读条数据</Chip>
              )}
              <SeekBtn tS={kk.atSeconds} unitName={p.name} onSeek={onSeek} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

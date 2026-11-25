import type { IKillWindowTargetEval } from "@gladlog/analysis";
import {
  burstSaysNoDamage,
  fmtTime,
  ON_TARGET_GOOD_PCT,
} from "@gladlog/analysis";
import { useContext, useMemo, useState } from "react";

import { useT } from "../../i18n/LangProvider";
import { classColor } from "../data/gameConstants";
import {
  burstSpellsLabel,
  groupAllyOverlaps,
  type LedgerPlayer,
  withNoPressLabel,
} from "../derive/burstLedger";
import { missedKickLabel } from "../derive/kickText";
import { shortUnitName, type TeamSide } from "../derive/teamSide";
import { TeamSideContext, UnitName } from "./UnitName";

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
  const { t } = useT();
  if (!onSeek) return null;
  return (
    <button
      className="rpt-stats-detail-jump"
      title={t("report.common.replayHere")}
      onClick={() => onSeek(Math.max(0, tS - 3), [unitName])}
    >
      ▶
    </button>
  );
}

/**
 * Burst ledger card (DPS direction D1): paged by player, in three sections --
 * burst alignment (one row per major-cooldown use: target, HP change, the
 * mitigation or immunity it hit into, coordination, outcome), kill-window
 * target discipline (share of damage landing on the window's target), and
 * interrupt audit (landed / juked / missed). Every row's ▶ seeks the replay
 * (the same seek pipeline as findings).
 */
export function BurstLedgerCard({
  players,
  targetSelection,
  onSeek,
}: {
  players: LedgerPlayer[];
  /** Team-level kill-window target-selection verdicts (#10 T3), joined to the
   * target-discipline rows by windowFromSeconds; windows with no match (fewer
   * than 2 enemies, or shorter than 5s) render no chip. */
  targetSelection?: IKillWindowTargetEval[];
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
  const { t: tr, lang } = useT();
  const sn = (name: string) =>
    withNoPressLabel(name, tr("report.burstLedger.noPress"));
  const [idx, setIdx] = useState(defaultIdx);
  const sides = useContext(TeamSideContext);
  /** Ring colour for the class dot. "unknown" keeps the class colour, i.e. no
   *  ring at all, rather than inventing a third state. */
  const teamRing = (side: TeamSide | undefined): string =>
    side === "friendly"
      ? "var(--friend)"
      : side === "enemy"
        ? "var(--foe)"
        : "transparent";
  // windowFromSeconds -> target-selection verdict (team-level, joined to the
  // target-discipline rows).
  const targetEvalByFrom = useMemo(() => {
    const m = new Map<number, IKillWindowTargetEval>();
    for (const ev of targetSelection ?? []) m.set(ev.windowFromSeconds, ev);
    return m;
  }, [targetSelection]);
  // Keep the card shell on empty data (P1-1)
  if (players.length === 0)
    return (
      <div className="rpt-ledger" data-testid="burst-ledger">
        <div className="rpt-ledger-head">
          <span className="rpt-ledger-title">
            {tr("report.burstLedger.title")}
          </span>
        </div>
        <p className="rpt-ledger-empty">{tr("report.burstLedger.noData")}</p>
      </div>
    );
  const p = players[Math.min(idx, players.length - 1)];

  return (
    <div className="rpt-ledger" data-testid="burst-ledger">
      <div className="rpt-ledger-head">
        <span className="rpt-ledger-title">
          {tr("report.burstLedger.title")}
        </span>
        <div className="rpt-ledger-tabs">
          {players.map((pl, i) => (
            <button
              key={pl.unitId}
              className={
                i === Math.min(idx, players.length - 1) ? "active" : ""
              }
              onClick={() => setIdx(i)}
            >
              {/* One mark, two facts: class colour fills it, team colour rings
                  it. A separate team dot next to this one would put two round
                  markers side by side and make neither legible. */}
              <span
                className="rpt-meter-dot"
                style={{
                  background: classColor(pl.classId),
                  borderColor: teamRing(sides.get(shortUnitName(pl.name))),
                }}
              />
              <span title={pl.name}>{shortUnitName(pl.name)}</span>
            </button>
          ))}
        </div>
      </div>

      {p.bursts.length > 0 && (
        <div className="rpt-ledger-section">
          <span className="rpt-stats-detail-title">
            {tr("report.burstLedger.alignment")}
          </span>
          {p.bursts.map((b, k) => {
            const t = b.dominantTarget;
            const immunities =
              t?.defensivesHit.filter((d) => d.isImmunity) ?? [];
            const walls = t?.defensivesHit.filter((d) => !d.isImmunity) ?? [];
            return (
              <div key={k} className="rpt-ledger-row">
                <span className="rpt-stats-detail-t">
                  {fmtTime(b.fromSeconds)}–{fmtTime(b.toSeconds)}
                </span>
                <span className="rpt-ledger-spells">
                  {burstSpellsLabel(
                    b.spells.map((s) => ({ spellName: sn(s.spellName) })),
                  )}
                </span>
                {t ? (
                  <span>
                    → <UnitName name={t.unitName} />
                    {t.hpStartPct !== null && t.hpEndPct !== null
                      ? `(${Math.round(t.hpStartPct)}%→${Math.round(t.hpEndPct)}%)`
                      : ""}{" "}
                    {fmtDmg(t.damage)}
                  </span>
                ) : burstSaysNoDamage(b) ? (
                  <Chip kind="warn">{tr("report.burstLedger.noDamage")}</Chip>
                ) : null}
                {immunities.map((d) => (
                  <Chip key={d.spellId} kind="bad">
                    {tr("report.burstLedger.intoImmunity", {
                      spell: sn(d.spellName),
                      s: d.overlapSeconds.toFixed(1),
                    })}
                  </Chip>
                ))}
                {walls.map((d) => (
                  <Chip key={d.spellId} kind="warn">
                    {tr("report.burstLedger.intoWall", {
                      spell: sn(d.spellName),
                      s: d.overlapSeconds.toFixed(1),
                    })}
                  </Chip>
                ))}
                {b.allyCDsOverlapping.length > 0 ? (
                  <Chip kind="good">
                    {tr("report.burstLedger.synced", {
                      names: groupAllyOverlaps(b.allyCDsOverlapping)
                        .map(
                          (a) =>
                            `${shortUnitName(a.playerName)}(${a.spellNames.map(sn).join(tr("report.common.listSep"))})`,
                        )
                        .join(tr("report.common.listSep")),
                    })}
                  </Chip>
                ) : (
                  // ruling R94: an empty list says no ally cooldown was on
                  // this player — a teammate's own may still be running, so
                  // not "solo" (the prompt's `NO_ALLY_CD_ON_HOLDER`)
                  <Chip kind="dim">{tr("report.burstLedger.noAllyCdOnPlayer")}</Chip>
                )}
                {t?.died && <Chip kind="kill">{tr("report.common.kill")}</Chip>}
                <SeekBtn tS={b.fromSeconds} unitName={p.name} onSeek={onSeek} />
              </div>
            );
          })}
        </div>
      )}

      {p.bursts.length === 0 && (
        <p className="rpt-ledger-empty">{tr("report.burstLedger.noBursts")}</p>
      )}

      {p.targeting.length === 0 ? (
        <p className="rpt-ledger-empty">
          {tr("report.burstLedger.noTargeting")}
        </p>
      ) : (
        <div className="rpt-ledger-section">
          <span className="rpt-stats-detail-title">
            {tr("report.burstLedger.targeting")}
          </span>
          {p.targeting.map((w, k) => {
            const targetEval = targetEvalByFrom.get(w.windowFromSeconds);
            return (
              <div key={k} className="rpt-ledger-row">
                <span className="rpt-stats-detail-t">
                  {fmtTime(w.windowFromSeconds)}–{fmtTime(w.windowToSeconds)}
                </span>
                <span>
                  {tr("report.burstLedger.windowTarget", {
                    name: w.windowTargetName,
                  })}
                </span>
                <Chip
                  kind={
                    w.onTargetPct >= ON_TARGET_GOOD_PCT || w.followedTeamFocus
                      ? "good"
                      : "bad"
                  }
                >
                  {tr("report.burstLedger.onTarget", { pct: w.onTargetPct })}
                </Chip>
                {w.topOffTarget &&
                  w.onTargetPct < ON_TARGET_GOOD_PCT &&
                  !w.followedTeamFocus && (
                    <span className="rpt-stats-dim">
                      {tr("report.burstLedger.topOffTarget", {
                        name: w.topOffTarget.unitName,
                        dmg: fmtDmg(w.topOffTarget.damage),
                      })}
                    </span>
                  )}
                {/* 2026-08-18 重设计:绿色「目标合理」合格证已删 —— 它与红色
                    指控出自同一个未验证的 softness 公式,61.9% 的窗口都在发。
                    现在只在有已验证依据的一种情形出面(集火对象非 prime 而
                    场上存在 prime 目标),其余不下判断。 */}
                {targetEval?.betterTargetExists && (
                  <Chip kind="bad">
                    {tr("report.burstLedger.betterTarget", {
                      name: targetEval.betterTargetName ?? "",
                      spec: targetEval.betterTargetSpec ?? "",
                    })}
                  </Chip>
                )}
                <SeekBtn
                  tS={w.windowFromSeconds}
                  unitName={p.name}
                  onSeek={onSeek}
                />
              </div>
            );
          })}
        </div>
      )}

      {p.kicks.length === 0 ? (
        <p className="rpt-ledger-empty">{tr("report.burstLedger.noKicks")}</p>
      ) : (
        <div className="rpt-ledger-section">
          <span className="rpt-stats-detail-title">
            {tr("report.burstLedger.kickAudit")}
          </span>
          {p.kicks.map((kk, k) => (
            <div key={k} className="rpt-ledger-row">
              <span className="rpt-stats-detail-t">
                {fmtTime(kk.atSeconds)}
              </span>
              <span>{kk.kickSpellName}</span>
              {kk.result === "landed" && (
                <Chip kind="good">
                  {tr("report.kicks.landed", {
                    spell: kk.interruptedSpellName ?? "",
                  })}
                </Chip>
              )}
              {kk.result === "juked" && (
                <Chip kind="bad">
                  {kk.jukedChannelStoppedAgoS !== undefined
                    ? tr("report.kicks.jukedChannel", {
                        spell: kk.jukedBySpellName ?? "",
                      })
                    : tr("report.kicks.jukedFake", {
                        spell: kk.jukedBySpellName ?? "",
                      })}
                </Chip>
              )}
              {kk.result === "silenced" && (
                <Chip kind="dim">
                  {kk.openCastSpellName
                    ? tr("report.kicks.silencedOpen", {
                        spell: kk.openCastSpellName,
                      })
                    : tr("report.kicks.silenced")}
                </Chip>
              )}
              {kk.result === "missed" && (
                <Chip kind="warn">{missedKickLabel(kk, lang)}</Chip>
              )}
              {kk.result === "unknown" && (
                <Chip kind="dim">{tr("report.kicks.unknown")}</Chip>
              )}
              <SeekBtn tS={kk.atSeconds} unitName={p.name} onSeek={onSeek} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import { fmtTime } from "@gladlog/analysis";
import { useState } from "react";

import { useT } from "../../i18n/LangProvider";
import { classColor } from "../data/gameConstants";
import type { CastControlSummary } from "../derive/castControl";
import type { KickDashRow } from "../derive/kickDash";
import { missedKickLabel } from "../derive/kickText";
import { UnitName } from "./UnitName";

/**
 * The kick dashboard (backlog #2): per-player landed/juked/missed kick
 * aggregates for both teams, with a per-cast audit when a row is expanded.
 * Same predicate as the burst ledger's "kick audit" (analyzeKickAudit); this
 * view adds the enemy side and a whole-match comparison. Each ▶ jumps to the
 * replay (the same seek pipeline as findings).
 */
export function KickDashboard({
  rows,
  castControl = null,
  onSeek,
}: {
  rows: KickDashRow[];
  /** The log recorder's own cast control (user request 2026-09-26); null =
   * not the recorder's log / streams not loaded yet — nothing is shown. */
  castControl?: CastControlSummary | null;
  onSeek?: (tSeconds: number, unitNames: string[]) => void;
}) {
  const { t, lang } = useT();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const castStrip = castControl ? (
    <CastControlStrip c={castControl} onSeek={onSeek} />
  ) : null;
  // Keep the card shell on empty data (P1-1): the feature stays discoverable
  // in short rounds with no kicks
  if (rows.length === 0)
    return (
      <div className="rpt-ledger" data-testid="kick-dash">
        <div className="rpt-ledger-head">
          <span className="rpt-ledger-title">{t("report.kickDash.title")}</span>
        </div>
        <p className="rpt-ledger-empty">{t("report.kickDash.empty")}</p>
        {castStrip}
      </div>
    );
  return (
    <div className="rpt-ledger" data-testid="kick-dash">
      <div className="rpt-ledger-head">
        <span className="rpt-ledger-title">{t("report.kickDash.title")}</span>
      </div>
      <table className="rpt-stats">
        <thead>
          <tr>
            <th>{t("report.common.player")}</th>
            <th>{t("report.kickDash.col.casts")}</th>
            <th>{t("report.kickDash.col.landed")}</th>
            <th>{t("report.kickDash.col.juked")}</th>
            <th>{t("report.kickDash.col.missed")}</th>
            <th>{t("report.kickDash.col.rate")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const expanded = !!open[r.unitId];
            return [
              <tr
                key={r.unitId}
                className={[
                  r.reaction === "Hostile" ? "rpt-stats-enemy" : "",
                  "rpt-stats-expandable",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() =>
                  setOpen((o) => ({ ...o, [r.unitId]: !o[r.unitId] }))
                }
              >
                <td>
                  <span
                    className="rpt-meter-dot"
                    style={{
                      background: classColor(r.classId),
                      borderColor: classColor(r.classId),
                    }}
                  />
                  <UnitName name={r.name} />
                  <span className="rpt-stats-caret">
                    {expanded ? " ▾" : " ▸"}
                  </span>
                </td>
                <td>{r.total}</td>
                <td>{r.landed}</td>
                <td>{r.juked}</td>
                <td>{r.missed}</td>
                <td className="rpt-stats-dim">
                  {r.landedRate === null
                    ? "—"
                    : `${Math.round(r.landedRate * 100)}%`}
                  {/* The notes go under the percentage, not beside it: in
                      the 1/3-width card "60%(落空含 1 次被免疫/反射)" ran into
                      the card edge. */}
                  {(r.silenced > 0 || r.refused > 0 || r.unknown > 0) && (
                    <span className="rpt-kick-note">
                      {r.silenced > 0
                        ? t("report.kickDash.silencedN", { n: r.silenced })
                        : ""}
                      {r.refused > 0
                        ? t("report.kickDash.refusedN", { n: r.refused })
                        : ""}
                      {r.unknown > 0
                        ? t("report.kickDash.unknownN", { n: r.unknown })
                        : ""}
                    </span>
                  )}
                </td>
              </tr>,
              expanded ? (
                <tr key={`${r.unitId}-d`} className="rpt-stats-detail-row">
                  <td colSpan={6}>
                    <div className="rpt-stats-detail-group">
                      {r.entries.map((k, i) => (
                        <span key={i} className="rpt-stats-detail-item">
                          <span className="rpt-stats-detail-t">
                            {fmtTime(k.atSeconds)}
                          </span>{" "}
                          {k.kickSpellName}
                          {k.result === "landed" &&
                            ` ${t("report.kicks.landed", { spell: k.interruptedSpellName ?? "" })}`}
                          {k.result === "juked" &&
                            ` ${
                              k.jukedChannelStoppedAgoS !== undefined
                                ? t("report.kicks.jukedChannel", {
                                    spell: k.jukedBySpellName ?? "",
                                  })
                                : t("report.kicks.jukedFake", {
                                    spell: k.jukedBySpellName ?? "",
                                  })
                            }`}
                          {k.result === "silenced" &&
                            ` ${
                              k.openCastSpellName
                                ? t("report.kicks.silencedOpen", {
                                    spell: k.openCastSpellName,
                                  })
                                : t("report.kicks.silenced")
                            }`}
                          {k.result === "missed" &&
                            ` ${missedKickLabel(k, lang)}`}
                          {k.result === "unknown" &&
                            ` ${t("report.kicks.unknown")}`}
                          {onSeek && (
                            <button
                              className="rpt-stats-detail-jump"
                              title={t("report.common.replayHere")}
                              onClick={() =>
                                onSeek(Math.max(0, k.atSeconds - 3), [r.name])
                              }
                            >
                              ▶
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ) : null,
            ];
          })}
        </tbody>
      </table>
      {castStrip}
    </div>
  );
}

/**
 * The recorder's own cast control: hardcasts, the ones they stopped
 * themselves (median progress), kicks eaten, and the enemy kicks those stops
 * baited — the same `ownerCastCancels` facts the coach menu's kick-eaten line
 * carries. A stopped cast is not called a fake: moving stops a cast bar too;
 * only a baited kick is shown as one.
 */
function CastControlStrip({
  c,
  onSeek,
}: {
  c: CastControlSummary;
  onSeek?: (tSeconds: number, unitNames: string[]) => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="rpt-stats-detail-group" data-testid="cast-control">
      <span className="rpt-stats-detail-item rpt-cast-control-line">
        <UnitName name={c.name} />
        {t("report.castControl.line", {
          hardcasts: c.hardcasts,
          cancels: c.cancels.length,
          median:
            c.medianCancelPct !== null
              ? t("report.castControl.median", { pct: c.medianCancelPct })
              : "",
          kicked: c.kicked,
          baited: c.baitedKicks.length,
        })}
        {c.baitedKicks.length > 0 && (
          <button
            className="rpt-stats-detail-jump"
            title={t("report.castControl.expand")}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "▾" : "▸"}
          </button>
        )}
      </span>
      {open &&
        c.baitedKicks.map((b, i) => (
          <span key={i} className="rpt-stats-detail-item">
            <span className="rpt-stats-detail-t">{fmtTime(b.atSeconds)}</span>{" "}
            <UnitName name={b.kickerName} />
            {t("report.castControl.baited", {
              kick: b.kickSpellName,
              bait: b.baitSpellName,
            })}
            {onSeek && (
              <button
                className="rpt-stats-detail-jump"
                title={t("report.common.replayHere")}
                onClick={() =>
                  onSeek(Math.max(0, b.atSeconds - 3), [c.name, b.kickerName])
                }
              >
                ▶
              </button>
            )}
          </span>
        ))}
    </div>
  );
}

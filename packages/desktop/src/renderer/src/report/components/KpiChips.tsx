import { useT } from "../../i18n/LangProvider";
import type { DispelDash } from "../derive/dispelDash";
import type { KickDashRow } from "../derive/kickDash";
import type { Mistake } from "../derive/mistakes";
import type { VulnBand } from "../derive/vulnWindows";

/**
 * The KPI chip row in the report header (UI redesign 1a): a one-line overview
 * of mistakes / burst windows / interrupts / dispels. The 终结 (finish) chip
 * moved to the hero line (ReportHeader, UI review 2026-08-21 #1).
 * Scope: **always the whole match**, never linked to the time window — the
 * same "how did this match go" overview role as MatchArcLine. Callers must
 * pass whole-match derives (no range); do not hand it windowed data.
 */
export function KpiChips({
  mistakes,
  bands,
  kickRows,
  dispelDash,
}: {
  /** Whole-match mistakes (not filtered by window). */
  mistakes: Mistake[];
  bands: VulnBand[];
  /** Whole-match interrupt rows (deriveKickDash(source) without a range). */
  kickRows: KickDashRow[];
  /** Whole-match dispels (deriveDispelDash(source) without a range). */
  dispelDash: DispelDash;
}) {
  const { t } = useT();
  const major = mistakes.filter((m) => m.severity === "major").length;
  const rest = mistakes.length - major;

  const bursts = bands.filter((b) => b.kind === "burst");
  const converted = bursts.filter((b) => b.targetDied).length;

  const kicksLanded = kickRows
    .filter((r) => r.reaction === "Friendly")
    .reduce((a, r) => a + r.landed, 0);
  // Deliberate dispels only; passive procs/riders ride along as a muted
  // suffix (UI review #3). One source: deriveDispelDash's totals.
  const { friendlyDeliberate, friendlyPassive } = dispelDash.totals;

  return (
    <div className="rpt-kpi-row" data-testid="kpi-chips">
      <span className="rpt-kpi">
        <span className="rpt-kpi-k">{t("report.kpi.findings")}</span>
        <span className="rpt-kpi-v">
          {major > 0 && (
            <span className="rpt-kpi-major">
              {t("report.kpi.majorN", { n: major })}
            </span>
          )}
          {major > 0 && rest > 0 && " · "}
          {(rest > 0 || major === 0) && t("report.kpi.restN", { n: rest })}
        </span>
      </span>
      {bursts.length > 0 && (
        <span className="rpt-kpi">
          <span className="rpt-kpi-k">{t("report.kpi.bursts")}</span>
          <span className="rpt-kpi-v">
            {t("report.kpi.converted", {
              done: converted,
              total: bursts.length,
            })}
          </span>
        </span>
      )}
      <span className="rpt-kpi">
        <span className="rpt-kpi-k">{t("report.kpi.kicks")}</span>
        <span className="rpt-kpi-v">{kicksLanded}</span>
      </span>
      <span className="rpt-kpi" data-testid="kpi-dispel">
        <span className="rpt-kpi-k">{t("report.kpi.dispels")}</span>
        <span className="rpt-kpi-v">
          {friendlyDeliberate}
          {friendlyPassive > 0 && (
            <span
              className="rpt-kpi-passive"
              title={t("report.common.passiveDispelTitle")}
            >
              {t("report.kpi.passiveN", { n: friendlyPassive })}
            </span>
          )}
        </span>
      </span>
    </div>
  );
}

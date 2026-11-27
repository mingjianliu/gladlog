import { fmtTime } from "@gladlog/analysis";

import { useT } from "../../i18n/LangProvider";
import type { DeathRecap } from "../derive/deathRecap";
import { deathReasons } from "../derive/deathReasons";
import { shortUnitName } from "../derive/teamSide";

/**
 * The report's headline: the death that ended our side's round and what the
 * death recap already established about it (an immunity left unpressed, an
 * external a teammate could have given, one they could not). Nothing is
 * judged here — every row is a field of the same DeathRecap the side card
 * renders; the headline is the card's summary, and the link opens the card.
 *
 * Direction pass 2026-11-27: the death time is set large in the condensed
 * numeral face and the clauses become a label / value list instead of one
 * comma-joined sentence — the time is the thing you scan for, the reasons are
 * the thing you read.
 */
export function VerdictLine({
  recap,
  onOpen,
}: {
  recap: DeathRecap;
  onOpen: () => void;
}) {
  const { t } = useT();
  // "你的 X", not "你 的 X": the owner's possessive is its own phrase.
  const castSpell = (name: string, spell: string, isOwner?: boolean) =>
    t("report.verdict.castSpell", {
      caster: isOwner
        ? t("report.verdict.yours")
        : t("report.verdict.whose", { name: shortUnitName(name) }),
      spell,
    });
  const rows: Array<{ k: string; label: string; value: string }> = [];
  const why = deathReasons(recap);
  const unpressed = why.unpressed[0];
  if (unpressed)
    rows.push({
      k: "unpressed",
      label: t("report.verdict.lblUnpressed"),
      value: unpressed.spellName,
    });
  const missed = why.missed[0];
  if (missed)
    rows.push({
      k: "missed",
      label: t("report.verdict.lblMissed"),
      value: castSpell(missed.casterName, missed.spellName, missed.casterIsOwner),
    });
  const blocked = why.blocked[0];
  if (blocked)
    rows.push({
      k: "blocked",
      label: t("report.verdict.lblBlocked"),
      value: castSpell(
        blocked.casterName,
        blocked.spellName,
        blocked.casterIsOwner,
      ),
    });
  return (
    <div className="rpt-verdict" data-testid="verdict-line">
      <span className="rpt-verdict-time">{fmtTime(recap.deathS)}</span>
      <div className="rpt-verdict-body">
        <p className="rpt-verdict-text">
          {t("report.verdict.died", { name: shortUnitName(recap.unitName) })}
        </p>
        {rows.length > 0 && (
          <dl className="rpt-verdict-why">
            {rows.map((r) => (
              <div key={r.k} className="rpt-verdict-row">
                <dt>{r.label}</dt>
                <dd>{r.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      <button className="rpt-verdict-open" onClick={onOpen}>
        {t("report.verdict.open")}
      </button>
    </div>
  );
}

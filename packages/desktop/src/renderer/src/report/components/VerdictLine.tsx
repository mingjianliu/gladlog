import { fmtTime } from "@gladlog/analysis";

import { useT } from "../../i18n/LangProvider";
import type { DeathRecap } from "../derive/deathRecap";
import { shortUnitName } from "../derive/teamSide";

/**
 * One sentence above the KPI figures: the death that ended our side's round
 * and what the death recap already established about it (an immunity left
 * unpressed, an external a teammate could have given, one they could not).
 * Nothing is judged here — every clause is a field of the same DeathRecap the
 * side card renders; the sentence is the card's headline, and clicking it
 * opens the card.
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
  const whose = (name: string, isOwner?: boolean) =>
    isOwner
      ? t("report.verdict.yours")
      : t("report.verdict.whose", { name: shortUnitName(name) });
  const clauses: string[] = [
    t("report.verdict.died", {
      time: fmtTime(recap.deathS),
      name: shortUnitName(recap.unitName),
    }),
  ];
  const unpressed = recap.availableImmunities.find((i) => !i.wasInCC);
  if (unpressed)
    clauses.push(t("report.verdict.unpressed", { spell: unpressed.spellName }));
  const missed = recap.missedExternals.find(
    (m) => !m.casterWasInCC && !m.casterCouldNotPay,
  );
  if (missed)
    clauses.push(
      t("report.verdict.missed", {
        caster: whose(missed.casterName, missed.casterIsOwner),
        spell: missed.spellName,
      }),
    );
  const blocked = recap.missedExternals.find((m) => m.casterWasInCC);
  if (blocked)
    clauses.push(
      t("report.verdict.blocked", {
        caster: whose(blocked.casterName, blocked.casterIsOwner),
        spell: blocked.spellName,
      }),
    );
  return (
    <div className="rpt-verdict" data-testid="verdict-line">
      <p className="rpt-verdict-text">
        {clauses.join(t("report.verdict.sep"))}
        {t("report.verdict.end")}
      </p>
      <button className="rpt-verdict-open" onClick={onOpen}>
        {t("report.verdict.open")}
      </button>
    </div>
  );
}

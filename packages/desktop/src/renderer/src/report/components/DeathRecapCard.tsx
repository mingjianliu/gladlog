import {
  DECISIVE_MARGIN_PCT,
  fmtTime,
  immunitySchoolWords,
} from "@gladlog/analysis";
import { Fragment, useEffect, useState } from "react";

import type { MessageKey, TFn } from "../../../../shared/i18n";
import { useT } from "../../i18n/LangProvider";
import {
  DEATH_RECAP_WINDOW_S,
  type DeathRecap,
  type DeathRecapEvent,
} from "../derive/deathRecap";
import { ChipIcon } from "./SpellInline";
import { UnitName } from "./UnitName";

const fmtK = (n: number): string => `${(n / 1000).toFixed(1)}k`;

const KIND_LABEL_KEY: Record<DeathRecapEvent["kind"], MessageKey> = {
  dmg: "report.deathCard.kind.dmg",
  heal: "report.deathCard.kind.heal",
  cc: "report.deathCard.kind.cc",
  def_used: "report.deathCard.kind.def_used",
  dispel: "report.deathCard.kind.dispel",
};

/** School words (`immunitySchoolWords`) → dictionary keys. */
const SCHOOL_KEY: Record<string, MessageKey> = {
  physical: "report.deathCard.school.physical",
  magic: "report.deathCard.school.magic",
  holy: "report.deathCard.school.holy",
  fire: "report.deathCard.school.fire",
  nature: "report.deathCard.school.nature",
  frost: "report.deathCard.school.frost",
  shadow: "report.deathCard.school.shadow",
  arcane: "report.deathCard.school.arcane",
};

/**
 * One-line text for the mitigation audit (form A, #17b Task4). Numbers are
 * taken straight from IMitigationAuditRow (the return value of Task1's
 * computeMitigationAudit) and never re-derived.
 */
function mitigationText(
  row: DeathRecap["mitigationAudit"][number],
  t: TFn,
): string {
  const overlap = row.activeOverlapS.toFixed(1);
  // a split entry's component rows name the school each prices — the
  // prompt's own words (`immunitySchoolWords`), in the UI language (T33,
  // ruling R07)
  const name =
    row.schoolMask !== undefined
      ? t("report.deathCard.schoolName", {
          spell: row.spellName,
          schools: immunitySchoolWords(row.schoolMask)
            .split("/")
            .map((w) => (SCHOOL_KEY[w] ? t(SCHOOL_KEY[w]) : w))
            .join("/"),
        })
      : row.spellName;
  const pctOf = (pct: number | undefined): string =>
    pct !== undefined ? t("report.deathCard.mit.pctMaxHp", { pct }) : "";
  if (row.kind === "arith") {
    const blockedK = Math.round((row.blockedAmount ?? 0) / 1000);
    return t("report.deathCard.mit.arith", {
      name,
      k: blockedK,
      pct: pctOf(row.blockedPctMaxHp),
      s: overlap,
    });
  }
  if (row.kind === "deferred") {
    // A deferral shield (Time Dilation, Stretch Time) holds damage back (Time
    // Dilation counts as 50 % mitigation — user rulings 2026-07-30 /
    // 2026-10-20); the amount is the log's own record of what it held back.
    const deferredK = Math.round((row.deferredAmount ?? 0) / 1000);
    return t("report.deathCard.mit.deferred", {
      name: row.spellName,
      k: deferredK,
      pct: pctOf(row.deferredPctMaxHp),
      s: overlap,
    });
  }
  if (row.kind === "immunity") {
    const dmgK = Math.round((row.damageTakenDuringImmunity ?? 0) / 1000);
    return t("report.deathCard.mit.immunity", { name, s: overlap, k: dmgK });
  }
  if (row.kind === "deflection") {
    // fact9 D3: Aspect of the Turtle deflects direct attacks, damage over
    // time still lands — no immunity (user ruling 2026-10-21)
    const dmgK = Math.round((row.damageTakenDuringImmunity ?? 0) / 1000);
    return t("report.deathCard.mit.deflection", {
      name,
      s: overlap,
      k: dmgK,
    });
  }
  if (row.kind === "absorb") {
    // Absorb shields are effective HP measured from the log's own absorb
    // events, so what is stated is what the shield actually ate inside the
    // window — a shield that expired unconsumed reports nothing rather than
    // its nominal size (absorbShields.ts).
    const absorbedK = Math.round((row.absorbedAmount ?? 0) / 1000);
    return t("report.deathCard.mit.absorb", {
      name: row.spellName,
      k: absorbedK,
      pct: pctOf(row.absorbedPctMaxHp),
      s: overlap,
    });
  }
  return t("report.deathCard.mit.other", { name: row.spellName, s: overlap });
}

/** A mitigation audit row: ChipIcon (the id is known; a missing table entry
 *  degrades to nothing on its own) + the text. */
function MitigationLine({
  row,
}: {
  row: DeathRecap["mitigationAudit"][number];
}) {
  const { t } = useT();
  return (
    <>
      <ChipIcon spellId={row.spellId} />
      {mitigationText(row, t)}
    </>
  );
}

/**
 * One-line text for a decisive counterfactual (B / narrow-gate merge, #17b
 * Task4) — worded as a possibility, arithmetic-only and single-factor, with the
 * margin coming from the same source as DECISIVE_MARGIN_PCT (Task1's
 * single-source constant).
 */
function counterfactualText(
  hit: DeathRecap["counterfactuals"][number],
  t: TFn,
): string {
  const subject =
    hit.source === "missed-external" && hit.casterName
      ? t("report.deathCard.cf.subject", {
          caster: hit.casterName,
          spell: hit.spellName,
        })
      : hit.spellName;
  return t("report.deathCard.cf.line", {
    subject,
    margin: DECISIVE_MARGIN_PCT,
  });
}

/** A decisive counterfactual row: ChipIcon (the id is known) + the text, wired
 *  up the same way as the mitigation row's icon. */
function CounterfactualLine({
  hit,
}: {
  hit: DeathRecap["counterfactuals"][number];
}) {
  const { t } = useT();
  return (
    <>
      <ChipIcon spellId={hit.spellId} />
      {counterfactualText(hit, t)}
    </>
  );
}

/**
 * Death recap drawer card (backlog #6): the 10s event stream before the death +
 * defensives that were available but never pressed + externals a teammate failed
 * to give. Every judgement comes from the analysis predicates
 * (deriveDeathRecaps).
 */
export function DeathRecapCard({
  recap,
  onClose,
  onJump,
  enemy = false,
}: {
  recap: DeathRecap;
  onClose: () => void;
  /** Replay this instant (relative seconds). */
  onJump?: (tSeconds: number, unitNames: string[]) => void;
  /** An enemy death (the fallback when auto-recap finds no friendly death): the
   * title switches to "kill" wording — an enemy dying is a result, and it should
   * not be headed "death recap" as if we were reviewing our own side. */
  enemy?: boolean;
}) {
  // Condensed view (issue #11) vs 显示全部 (the raw, every-tick stream); the
  // fold bucket has its own expand toggle. Both reset when the card moves to
  // another death.
  const { t } = useT();
  const [showAll, setShowAll] = useState(false);
  const [foldOpen, setFoldOpen] = useState(false);
  useEffect(() => {
    setShowAll(false);
    setFoldOpen(false);
  }, [recap]);

  const eventRow = (
    e: DeathRecapEvent,
    key: string | number,
    extraClass = "",
  ) => {
    const hasHp = e.hpBeforePct !== undefined && e.hpAfterPct !== undefined;
    return (
      <tr
        key={key}
        className={`rpt-recap-row rpt-recap-${e.kind}${extraClass ? ` ${extraClass}` : ""}`}
      >
        <td className="rpt-recap-t">{fmtTime(e.tS)}</td>
        <td className="rpt-recap-kind">{t(KIND_LABEL_KEY[e.kind])}</td>
        <td className="rpt-recap-spell">
          <ChipIcon spellId={e.spellId} />
          {e.spell}
          {e.kind === "def_used" && e.panic && (
            <span
              className="rpt-recap-panic-badge"
              title={t("report.deathCard.panicTitle")}
            >
              {t("report.deathCard.panic")}
            </span>
          )}
        </td>
        <td
          className={`rpt-recap-amt ${
            e.kind === "dmg"
              ? "rpt-recap-amt-dmg"
              : e.kind === "heal"
                ? "rpt-recap-amt-heal"
                : ""
          }`}
        >
          {e.amount != null ? fmtK(e.amount) : ""}
        </td>
        <td
          className="rpt-recap-hpbar"
          title={
            hasHp
              ? `${Math.round(e.hpBeforePct!)}% → ${Math.round(e.hpAfterPct!)}%`
              : undefined
          }
        >
          {hasHp && (
            <span className="rpt-recap-hpbar-track">
              <span
                className="rpt-recap-hpbar-base"
                style={{
                  width: `${Math.min(e.hpBeforePct!, e.hpAfterPct!).toFixed(1)}%`,
                }}
              />
              <span
                className={`rpt-recap-hpbar-delta rpt-recap-hpbar-delta-${
                  e.kind === "dmg" ? "dmg" : "heal"
                }`}
                style={{
                  left: `${Math.min(e.hpBeforePct!, e.hpAfterPct!).toFixed(1)}%`,
                  width: `${Math.abs(e.hpBeforePct! - e.hpAfterPct!).toFixed(1)}%`,
                }}
              />
            </span>
          )}
        </td>
        {/* Strip the realm suffix (convention across the whole UI): a
            cross-realm full name blows out the 384px right column
            horizontally (proven on a real match in acceptance run 2); the
            full name goes into title */}
        <td className="rpt-recap-src" title={e.srcName}>
          <UnitName name={e.srcName} />
        </td>
      </tr>
    );
  };

  const rows = recap.rows ?? [];
  const table = (
    <table className="rpt-recap-table">
      <tbody>
        {showAll
          ? recap.events.map((e, i) => eventRow(e, i))
          : rows.map((row, i) => {
              if (row.type === "event") return eventRow(row.event, i);
              if (row.type === "subtotal") {
                const spanS = Math.max(0, Math.round(row.toS - row.fromS));
                return (
                  <tr
                    key={i}
                    className={`rpt-recap-row rpt-recap-${row.kind} rpt-recap-subtotal`}
                  >
                    <td className="rpt-recap-t">{fmtTime(row.fromS)}</td>
                    <td className="rpt-recap-kind">
                      {t(KIND_LABEL_KEY[row.kind])}
                    </td>
                    <td className="rpt-recap-spell">
                      <ChipIcon spellId={row.spellId} />
                      {row.spell}
                      <span className="rpt-recap-subtotal-note">
                        {t("report.deathCard.ticks", {
                          ticks: row.ticks,
                          s: spanS,
                        })}
                      </span>
                    </td>
                    <td
                      className={`rpt-recap-amt ${
                        row.kind === "dmg"
                          ? "rpt-recap-amt-dmg"
                          : "rpt-recap-amt-heal"
                      }`}
                    >
                      {fmtK(row.total)}
                    </td>
                    <td className="rpt-recap-hpbar" />
                    <td className="rpt-recap-src" title={row.srcName}>
                      <UnitName name={row.srcName} />
                    </td>
                  </tr>
                );
              }
              // Folded bucket: never a silent delete — the row carries the
              // totals and expands to the constituent events in place.
              return (
                <Fragment key={i}>
                  <tr className="rpt-recap-row rpt-recap-foldrow">
                    <td colSpan={6} className="rpt-recap-fold-cell">
                      <button
                        className="rpt-recap-fold-toggle"
                        aria-expanded={foldOpen}
                        // Stable accessible name: the visible label carries
                        // amounts ("… 伤害 / … 治疗"), which would collide
                        // with role-button name queries for the meters' 伤害/
                        // 治疗 toggles (and reads badly in a screen reader).
                        aria-label={t(
                          foldOpen
                            ? "report.deathCard.foldCollapse"
                            : "report.deathCard.foldExpand",
                        )}
                        onClick={() => setFoldOpen((v) => !v)}
                      >
                        {`${foldOpen ? "▾" : "▸"} ${t(
                          "report.deathCard.foldLabel",
                          {
                            n: row.count,
                            dmg: fmtK(row.dmgTotal),
                            heal: fmtK(row.healTotal),
                          },
                        )}`}
                      </button>
                    </td>
                  </tr>
                  {foldOpen &&
                    row.events.map((e, j) =>
                      eventRow(e, `f${j}`, "rpt-recap-fold-detail"),
                    )}
                </Fragment>
              );
            })}
        {(showAll ? recap.events.length : rows.length) === 0 && (
          <tr>
            <td colSpan={6} className="rpt-recap-empty">
              {t("report.deathCard.empty", { s: DEATH_RECAP_WINDOW_S })}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );

  return (
    <div className="rpt-recap" data-testid="death-recap">
      <div className="rpt-recap-head">
        <span className="rpt-recap-title">
          {t(enemy ? "report.deathCard.titleEnemy" : "report.deathCard.title")}{" "}
          — {recap.unitName} @ {fmtTime(recap.deathS)}
        </span>
        <span className="rpt-recap-actions">
          <button
            className={`rpt-recap-showall${showAll ? " rpt-recap-showall-on" : ""}`}
            aria-pressed={showAll}
            title={t("report.deathCard.showAllTitle")}
            onClick={() => setShowAll((v) => !v)}
          >
            {t("report.deathCard.showAll")}
          </button>
          {onJump && (
            <button
              className="rpt-finding-jump"
              onClick={() =>
                onJump(Math.max(0, recap.deathS - 8), [recap.unitName])
              }
            >
              {t("report.deathCard.replayHere")}
            </button>
          )}
          <button className="rpt-recap-close" onClick={onClose}>
            ✕
          </button>
        </span>
      </div>

      {recap.availableImmunities.length > 0 && (
        <p className="rpt-recap-verdictish">
          {t("report.deathCard.unpressed")}
          {recap.availableImmunities.map((i, k) => (
            <span key={k} className="rpt-recap-pill">
              <ChipIcon spellId={i.spellId} />
              {i.spellName}
              {i.wasInCC ? t("report.deathCard.wasInCc") : ""}
              {i.cheaperAlternatives.length > 0 && (
                <span className="rpt-recap-cheaper">
                  {t("report.deathCard.cheaper", {
                    list: i.cheaperAlternatives.join(
                      t("report.common.listSep"),
                    ),
                  })}
                </span>
              )}
            </span>
          ))}
        </p>
      )}
      {recap.missedExternals.length > 0 && (
        <p className="rpt-recap-verdictish">
          {t("report.deathCard.missedExternals")}
          {recap.missedExternals.map((m, k) => (
            <span key={k} className="rpt-recap-pill">
              <ChipIcon spellId={m.spellId} />
              {t("report.deathCard.casterSpell", {
                caster: m.casterName,
                spell: m.spellName,
              })}
              {m.casterWasInCC ? t("report.deathCard.casterCc") : ""}
              {m.casterCouldNotPay ? t("report.deathCard.casterOom") : ""}
            </span>
          ))}
        </p>
      )}

      {recap.mitigationAudit.length > 0 && (
        <div className="rpt-recap-mitigation" data-testid="recap-mitigation">
          <p className="rpt-recap-mitigation-title">
            {t("report.deathCard.mitTitle")}
          </p>
          <ul className="rpt-recap-mitigation-list">
            {recap.mitigationAudit.map((row, k) => (
              <li
                key={k}
                className={`rpt-recap-mitigation-row rpt-recap-mitigation-${row.kind}`}
              >
                <MitigationLine row={row} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {recap.counterfactuals.length > 0 && (
        <div
          className="rpt-recap-counterfactual"
          data-testid="recap-counterfactual"
        >
          {recap.counterfactuals.map((hit, k) => (
            <p
              key={k}
              className="rpt-recap-verdictish rpt-recap-counterfactual-line"
            >
              <CounterfactualLine hit={hit} />
            </p>
          ))}
        </div>
      )}

      {/* Inner scroll (per the 1a spec's "timeline 5 rows" and the .rpt-windows
          precedent): the 10s before a death in a long round can hold dozens of
          small events, and without scrolling the whole right column stretches to
          several screens (proven in acceptance run 2).
          tabIndex: the table rows contain no focusable element, so the
          scrollable region must be reachable by keyboard itself (axe
          scrollable-region-focusable, caught immediately by the CI baseline
          run). */}
      <div
        className="rpt-recap-scroll"
        tabIndex={0}
        role="region"
        aria-label={t("report.deathCard.timelineAria")}
      >
        {table}
      </div>
    </div>
  );
}

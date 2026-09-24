import { DECISIVE_MARGIN_PCT, fmtTime } from "@gladlog/analysis";
import { Fragment, useEffect, useState } from "react";

import {
  DEATH_RECAP_WINDOW_S,
  type DeathRecap,
  type DeathRecapEvent,
} from "../derive/deathRecap";
import { ChipIcon } from "./SpellInline";
import { UnitName } from "./UnitName";


const fmtK = (n: number): string => `${(n / 1000).toFixed(1)}k`;

const KIND_LABEL: Record<string, string> = {
  dmg: "伤害",
  heal: "治疗",
  cc: "控制",
  def_used: "防御",
  dispel: "驱散",
};

/**
 * One-line text for the mitigation audit (form A, #17b Task4) — the Chinese card
 * version. Numbers are taken straight from IMitigationAuditRow (the return value
 * of Task1's computeMitigationAudit) and never re-derived.
 */
function mitigationText(row: DeathRecap["mitigationAudit"][number]): string {
  const overlap = row.activeOverlapS.toFixed(1);
  if (row.kind === "arith") {
    const blockedK = Math.round((row.blockedAmount ?? 0) / 1000);
    const pctPart =
      row.blockedPctMaxHp !== undefined
        ? `(≈${row.blockedPctMaxHp}% maxHp)`
        : "";
    return `${row.spellName} 挡了 ~${blockedK}k${pctPart},覆盖 ${overlap}s`;
  }
  if (row.kind === "immunity") {
    const dmgK = Math.round((row.damageTakenDuringImmunity ?? 0) / 1000);
    return `${row.spellName} 免疫覆盖 ${overlap}s(期内观测承伤 ~${dmgK}k)`;
  }
  if (row.kind === "absorb") {
    // Absorb shields are effective HP measured from the log's own absorb
    // events, so what is stated is what the shield actually ate inside the
    // window — a shield that expired unconsumed reports nothing rather than
    // its nominal size (absorbShields.ts).
    const absorbedK = Math.round((row.absorbedAmount ?? 0) / 1000);
    const pctPart =
      row.absorbedPctMaxHp !== undefined
        ? `(≈${row.absorbedPctMaxHp}% maxHp)`
        : "";
    return `${row.spellName} 吸收 ~${absorbedK}k${pctPart},覆盖 ${overlap}s`;
  }
  return `${row.spellName} 激活 ${overlap}s,机制特殊,不参与缺口算术`;
}

/** A mitigation audit row: ChipIcon (the id is known; a missing table entry
 *  degrades to nothing on its own) + the text. */
function MitigationLine({
  row,
}: {
  row: DeathRecap["mitigationAudit"][number];
}) {
  return (
    <>
      <ChipIcon spellId={row.spellId} />
      {mitigationText(row)}
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
): string {
  const subject =
    hit.source === "missed-external" && hit.casterName
      ? `${hit.casterName} 的 ${hit.spellName}`
      : hit.spellName;
  return `若${subject}覆盖此窗,该段伤害约降至致死线下(余量 >${DECISIVE_MARGIN_PCT}% 最大血量)——算术口径,单因素`;
}

/** A decisive counterfactual row: ChipIcon (the id is known) + the text, wired
 *  up the same way as the mitigation row's icon. */
function CounterfactualLine({
  hit,
}: {
  hit: DeathRecap["counterfactuals"][number];
}) {
  return (
    <>
      <ChipIcon spellId={hit.spellId} />
      {counterfactualText(hit)}
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
        <td className="rpt-recap-kind">{KIND_LABEL[e.kind]}</td>
        <td className="rpt-recap-spell">
          <ChipIcon spellId={e.spellId} />
          {e.spell}
          {e.kind === "def_used" && e.panic && (
            <span
              className="rpt-recap-panic-badge"
              title="恐慌性使用:未见明显敌方威胁/目标未受压下按下"
            >
              ⚠恐慌
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
                    <td className="rpt-recap-kind">{KIND_LABEL[row.kind]}</td>
                    <td className="rpt-recap-spell">
                      <ChipIcon spellId={row.spellId} />
                      {row.spell}
                      <span className="rpt-recap-subtotal-note">
                        {" "}
                        ×{row.ticks} 跳/{spanS}s
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
                        aria-label={`${foldOpen ? "收起" : "展开"}被折叠的小额事件`}
                        onClick={() => setFoldOpen((v) => !v)}
                      >
                        {`${foldOpen ? "▾" : "▸"} 已折叠 ${row.count} 行小额事件(合计 ${fmtK(row.dmgTotal)} 伤害 / ${fmtK(row.healTotal)} 治疗)`}
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
              死前 {DEATH_RECAP_WINDOW_S}s 无记录事件。
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
          {enemy ? "终结回顾" : "死亡回顾"} — {recap.unitName} @{" "}
          {fmtTime(recap.deathS)}
        </span>
        <span className="rpt-recap-actions">
          <button
            className={`rpt-recap-showall${showAll ? " rpt-recap-showall-on" : ""}`}
            aria-pressed={showAll}
            title="逐跳原始事件流(不过滤不合并)"
            onClick={() => setShowAll((v) => !v)}
          >
            显示全部
          </button>
          {onJump && (
            <button
              className="rpt-finding-jump"
              onClick={() =>
                onJump(Math.max(0, recap.deathS - 8), [recap.unitName])
              }
            >
              ▶ 回放此刻
            </button>
          )}
          <button className="rpt-recap-close" onClick={onClose}>
            ✕
          </button>
        </span>
      </div>

      {recap.availableImmunities.length > 0 && (
        <p className="rpt-recap-verdictish">
          死亡时可用而未按:
          {recap.availableImmunities.map((i, k) => (
            <span key={k} className="rpt-recap-pill">
              <ChipIcon spellId={i.spellId} />
              {i.spellName}
              {i.wasInCC ? "(当时被控)" : ""}
              {i.cheaperAlternatives.length > 0 && (
                <span className="rpt-recap-cheaper">
                  {" "}
                  · 更省替代:{i.cheaperAlternatives.join("、")}
                </span>
              )}
            </span>
          ))}
        </p>
      )}
      {recap.missedExternals.length > 0 && (
        <p className="rpt-recap-verdictish">
          队友可给未给:
          {recap.missedExternals.map((m, k) => (
            <span key={k} className="rpt-recap-pill">
              <ChipIcon spellId={m.spellId} />
              {m.casterName}:{m.spellName}
              {m.casterWasInCC ? "(被控)" : ""}
            </span>
          ))}
        </p>
      )}

      {recap.mitigationAudit.length > 0 && (
        <div className="rpt-recap-mitigation" data-testid="recap-mitigation">
          <p className="rpt-recap-mitigation-title">
            减伤核算(死亡窗内已激活,逐条独立口径,不建模叠加):
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
        aria-label="死前事件时间线(可滚动)"
      >
        {table}
      </div>
    </div>
  );
}

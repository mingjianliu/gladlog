import { memo } from "react";

import { classGlyph, specIconName, specName } from "../data/gameConstants";
import type { MeterRow } from "../derive/meterRows";
import {
  shortUnitName,
  TEAM_SIDE_LABEL,
  type TeamSide,
} from "../derive/teamSide";
import { useIconDataUrl } from "./useIconDataUrl";

/** Ring colour = team, the same mapping the swimlane dot and the replay
 * marker use (`sideRing` in GcdSwimlane.tsx / ReplayView.tsx). `unknown`
 * gets no ring rather than a grey one — same rule as TeamDot. */
const sideRing = (side: TeamSide): string =>
  side === "friendly"
    ? "var(--win)"
    : side === "enemy"
      ? "var(--loss)"
      : "transparent";

/**
 * The one identity element of a meter row (UI review 2026-08-21 #6): spec
 * icon, with a class-coloured glyph fallback while the icon loads or when the
 * spec is unknown, and the team carried by the ring. Replaces the glyph chip
 * + TeamDot pair — three identity channels before the bar started. Team stays
 * a separate channel from class colour (TeamDot.tsx explains why); here that
 * channel is the ring, not a dot.
 */
function MeterIdent({
  row,
  side,
  off,
}: {
  row: MeterRow;
  side: TeamSide;
  off: boolean;
}) {
  const { dataUrl } = useIconDataUrl(specIconName(row.specId));
  const title = `${specName(row.specId) || classGlyph(row.classId)} · ${
    TEAM_SIDE_LABEL[side]
  }`;
  const ring = { borderColor: sideRing(side) };
  if (dataUrl) {
    return (
      <img
        className={off ? "rpt-meter-ident off" : "rpt-meter-ident"}
        data-side={side}
        src={dataUrl}
        alt={title}
        title={title}
        style={ring}
      />
    );
  }
  return (
    <span
      className={
        off
          ? "rpt-meter-ident rpt-meter-ident-fallback off"
          : "rpt-meter-ident rpt-meter-ident-fallback"
      }
      data-side={side}
      role="img"
      aria-label={title}
      title={title}
      style={
        off
          ? {
              ...ring,
              background: "transparent",
              color: row.color,
              boxShadow: `inset 0 0 0 1.5px ${row.color}`,
            }
          : { ...ring, background: row.color }
      }
    >
      {classGlyph(row.classId)}
    </span>
  );
}

/**
 * One leaderboard row. Extracted from Meters.tsx so the async icon hook runs
 * per row (rules of hooks — the rows used to be mapped inline) and so the row
 * is memoised: Meters re-renders on every replay tick, and nothing in a row
 * changes between ticks unless its own props do.
 *
 * Class names `.rpt-meter-row` / `.rpt-meter-bar` / `.rpt-meter-value` are
 * load-bearing: derive/faithfulness.ts queries them positionally.
 */
export const MeterUnitRow = memo(function MeterUnitRow({
  row,
  side,
  off,
  expandable,
  onToggleUnit,
  onToggleExpand,
}: {
  row: MeterRow;
  side: TeamSide;
  off: boolean;
  expandable: boolean;
  onToggleUnit?: (unitId: string) => void;
  onToggleExpand: (unitId: string) => void;
}) {
  const nameCls = [
    "rpt-meter-name",
    side === "enemy" ? "enemy" : "",
    off ? "off" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className={off ? "rpt-meter-row off" : "rpt-meter-row"}
      title={`${row.name}: ${row.exactLabel}`}
    >
      <button
        type="button"
        className={nameCls}
        onClick={() => onToggleUnit?.(row.unitId)}
      >
        <MeterIdent row={row} side={side} off={off} />
        {/* Realm suffix stripped — the only bare-name surface in the app;
            the full name lives in the row title above. */}
        {shortUnitName(row.name)}
      </button>
      <span
        className={
          expandable ? "rpt-meter-body rpt-meter-clickable" : "rpt-meter-body"
        }
        onClick={expandable ? () => onToggleExpand(row.unitId) : undefined}
      >
        <span className="rpt-meter-bar-track">
          <span
            className="rpt-meter-bar"
            style={{ width: `${row.widthPct}%`, background: row.color }}
          />
        </span>
        <span className="rpt-meter-value">{row.label}</span>
      </span>
    </div>
  );
});

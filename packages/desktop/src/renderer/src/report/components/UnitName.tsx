import { createContext, useContext } from "react";

import { shortUnitName, type TeamSide } from "../derive/teamSide";
import { TeamDot } from "./TeamDot";

/**
 * Short name → side, provided once per report.
 *
 * A context rather than a prop because the team marker is cross-cutting: the
 * kick / dispel / aura / CC tables, the burst ledger, the mistake list and the
 * death recap all render a bare unit name several components deep. Threading a
 * map through every one of them would put the marker's fate in the hands of
 * whoever remembers to forward the prop — and the surface that forgets is
 * exactly the one that goes back to being unreadable.
 *
 * Default is an empty map: a component rendered outside a report (tests,
 * fixtures) shows no dots rather than throwing.
 */
export const TeamSideContext = createContext<Map<string, TeamSide>>(new Map());

/**
 * A unit's name with its team dot. Takes the name as rendered elsewhere —
 * full or short — and normalizes to the short form for lookup, so callers do
 * not each have to remember the `split("-")[0]` convention.
 */
export function UnitName({
  name,
  /** Render the full name as given (the tables that show "Player1-Test"); by
   * default the short name is displayed, matching the events table. */
  full = false,
  className,
}: {
  name: string;
  full?: boolean;
  className?: string;
}) {
  const sides = useContext(TeamSideContext);
  const short = shortUnitName(name);
  return (
    <span
      className={className ? `rpt-unitname ${className}` : "rpt-unitname"}
      title={!full && short !== name ? name : undefined}
    >
      <TeamDot side={sides.get(short) ?? "unknown"} />
      {full ? name : short}
    </span>
  );
}

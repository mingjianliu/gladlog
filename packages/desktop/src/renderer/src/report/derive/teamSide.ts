import type { ReportSource } from "./types";

/**
 * Whose side a unit is on, from the log owner's point of view.
 *
 * "unknown" is a real answer, not a fallback to guess around: an imported log
 * with no `playerTeamId`, a unit with no combatant info and no owner, an NPC
 * nobody owns. Every consumer must render nothing rather than a marker that
 * might lie about which team someone was on.
 */
export type TeamSide = "friendly" | "enemy" | "unknown";

export const TEAM_SIDE_LABEL: Record<TeamSide, string> = {
  friendly: "我方",
  enemy: "敌方",
  unknown: "未知",
};

/**
 * The predicate itself. Three call sites used to answer this question
 * independently — MatchReport's `isFriendlyUnit`, an inline
 * `teamId !== playerTeamId` in Meters, and roster.ts's `isPlayerTeam` — which
 * is the shared-predicate rule's UI edition waiting to happen: the moment one
 * of them treats a missing playerTeamId differently, the meters leaderboard and
 * the curve legend start disagreeing about who the enemy is on the same screen.
 */
export function sideOfTeamId(
  m: Pick<ReportSource, "playerTeamId">,
  teamId: number | null | undefined,
): TeamSide {
  if (m.playerTeamId == null || teamId == null) return "unknown";
  return teamId === m.playerTeamId ? "friendly" : "enemy";
}

/**
 * Side of a unit by id. A pet/totem/guardian inherits its owner's side — the
 * events table lists them as sources and targets by name, and "the felhunter is
 * on nobody's team" would be both wrong and useless there. Only one hop: a
 * pet's pet is not chased (same rule as flowSeries' petsOf).
 */
export function sideOfUnit(m: ReportSource, unitId: string): TeamSide {
  const u = m.units[unitId];
  if (!u) return "unknown";
  if (u.info) return sideOfTeamId(m, u.info.teamId);
  const owner = u.ownerId ? m.units[u.ownerId] : undefined;
  return owner?.info ? sideOfTeamId(m, owner.info.teamId) : "unknown";
}

/** unitId → side for every unit in the match. Built once per source and handed
 * to the surfaces that key on unit id (curves, legend, meters). */
export function teamSidesByUnitId(m: ReportSource): Map<string, TeamSide> {
  const out = new Map<string, TeamSide>();
  for (const u of Object.values(m.units)) out.set(u.id, sideOfUnit(m, u.id));
  return out;
}

/**
 * A unit's display name with the realm suffix removed ("Boozeskulls-Illidan"
 * → "Boozeskulls").
 *
 * This is the app's universal display convention: combat logs always carry
 * `Name-Realm` for players, and every surface that shows a name renders the
 * short form. It is also the key type of `teamSideByName` below, so a caller
 * that strips differently silently misses the team dot.
 *
 * Exported because it is a rule, not a string operation — new callers must
 * import it rather than hand-copy `split("-")[0]`. (The pre-2026-08-18 code
 * hand-copied it at ~30 sites; they were folded into this on 2026-09-24,
 * except MatchReport's `unitNames[0]?.split(...) ?? null`, which keeps `null`
 * for a nameless unit. `Meters` was the one surface that forgot to strip at
 * all — see its call site.)
 *
 * Total: a nameless unit yields "", never undefined, so it stays usable as a
 * Map key and as rendered text.
 */
export function shortUnitName(name: string | null | undefined): string {
  return (name ?? "").split("-")[0] ?? "";
}

/**
 * Short name → side, for the surfaces that only ever hold a display name (the
 * events table's 来源/目标 cells, the GCD lane headers, burst-ledger chips).
 *
 * Short name = `shortUnitName` above, matching how every one of those surfaces
 * renders it. A real player wins over a pet on a name collision: the player is
 * the one the reader is looking for.
 */
export function teamSideByName(m: ReportSource): Map<string, TeamSide> {
  const out = new Map<string, TeamSide>();
  const units = Object.values(m.units);
  // Pets first, players second, so a player overwrites a colliding pet name.
  for (const pass of [0, 1]) {
    for (const u of units) {
      const isPlayer = u.kind === "Player" && u.info != null;
      if ((pass === 0) === isPlayer) continue;
      const short = shortUnitName(u.name);
      if (!short) continue;
      const side = sideOfUnit(m, u.id);
      if (side === "unknown" && out.has(short)) continue;
      out.set(short, side);
    }
  }
  return out;
}

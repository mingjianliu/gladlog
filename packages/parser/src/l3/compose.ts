import { slimMatchParams } from "../slim";
import type { Segment, ShuffleClose } from "../l2/types";
import type { GladMatch, GladShuffle, GladShuffleRound } from "./model";
import { buildRoster } from "./roster";
import { collectEvents } from "./collect";
import { classIdOf } from "./data/specToClass";
import { matchResult, roundWinner } from "./outcome";
import type { ParsedLine } from "../l1/types";

// FNV-1a 32-bit rolling hash
function calculateFnv1a32(lines: string[]): string {
  let hash = 2166136261;
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      const charCode = line.charCodeAt(i);
      hash ^= charCode & 0xff;
      hash = Math.imul(hash, 16777619);
      if (charCode > 0xff) {
        hash ^= (charCode >> 8) & 0xff;
        hash = Math.imul(hash, 16777619);
      }
    }
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function buildMatch(seg: Segment, end: ParsedLine): GladMatch {
  const roster = buildRoster(seg.records);
  const gladUnitsMap = collectEvents(seg.records, roster);

  // Backfill from COMBATANT_INFO
  for (const record of seg.records) {
    if (record.combatantInfo) {
      const ci = record.combatantInfo;
      const unit = gladUnitsMap.get(ci.playerGuid);
      if (unit) {
        unit.info = {
          teamId: ci.teamId,
          specId: ci.specId,
          personalRating: ci.personalRating,
          talents: ci.talents,
          pvpTalents: ci.pvpTalents,
          equipment: ci.equipment,
          interestingAuras: ci.interestingAuras,
        };
        unit.specId = ci.specId;
        unit.classId = classIdOf(ci.specId);
      }
    }
  }

  const playerId = roster.ownerId ?? "";
  const ownerUnit = roster.ownerId ? gladUnitsMap.get(roster.ownerId) : null;
  const playerTeamId = ownerUnit?.info?.teamId ?? null;

  const winningTeamId = end.arenaEnd ? end.arenaEnd.winningTeamId : null;
  const result = matchResult(winningTeamId, playerTeamId);
  const teamMmr = teamMmrOf(end);

  const rawLines = [...seg.rawLines, end.raw];
  const id = calculateFnv1a32(rawLines);

  const hasAdvancedLogging = seg.hasAdvancedLogging ?? false;

  const builtUnits = Object.fromEntries(gladUnitsMap.entries());
  // Slim on the way out: the params 13+ tail is already materialized
  // (advancedSamples/crit), so trim it before writing to disk
  slimMatchParams({ units: builtUnits });
  return {
    kind: "match",
    id,
    bracket: seg.bracket,
    zoneId: seg.zoneId,
    startTime: seg.startLine.timestamp,
    endTime: end.timestamp,
    units: builtUnits,
    playerId,
    playerTeamId,
    winningTeamId,
    teamMmr,
    result,
    linesTotal: rawLines.length,
    linesDropped: 0,
    rawLines,
    hasAdvancedLogging,
    timezone: "local",
  };
}

/** The lobby's matchmaking rating per team id off a closing ARENA_MATCH_END
 * line; null without that line (an abnormal close, a shuffle cut at EOF) or
 * when either value is not a positive number (unrated lobbies write 0). */
function teamMmrOf(end: {
  arenaEnd?: { team0Mmr: number; team1Mmr: number };
}): { team0: number; team1: number } | null {
  const a = end.arenaEnd;
  if (!a) return null;
  return a.team0Mmr > 0 && a.team1Mmr > 0
    ? { team0: a.team0Mmr, team1: a.team1Mmr }
    : null;
}

function buildShuffleRound(
  seg: Segment,
  index: number,
  resolvedOwnerId: string | null,
): GladShuffleRound {
  const roster = buildRoster(seg.records);
  const gladUnitsMap = collectEvents(seg.records, roster);

  // Backfill from COMBATANT_INFO
  for (const record of seg.records) {
    if (record.combatantInfo) {
      const ci = record.combatantInfo;
      const unit = gladUnitsMap.get(ci.playerGuid);
      if (unit) {
        unit.info = {
          teamId: ci.teamId,
          specId: ci.specId,
          personalRating: ci.personalRating,
          talents: ci.talents,
          pvpTalents: ci.pvpTalents,
          equipment: ci.equipment,
          interestingAuras: ci.interestingAuras,
        };
        unit.specId = ci.specId;
        unit.classId = classIdOf(ci.specId);
      }
    }
  }

  const playerId = resolvedOwnerId ?? roster.ownerId ?? "";
  const ownerUnit = playerId ? gladUnitsMap.get(playerId) : null;
  const playerTeamId = ownerUnit?.info?.teamId ?? null;

  // Find round deaths in chronological order
  const roundDeaths: { destId: string }[] = [];
  let lastRoundDeathTs = 0;
  for (const r of seg.records) {
    if (r.eventName === "UNIT_DIED") {
      const destGuid = r.base?.destGuid;
      if (destGuid) {
        const isPlayer =
          destGuid.startsWith("Player-") ||
          roster.units.get(destGuid)?.kind === "Player";
        if (isPlayer) {
          const lastParam = r.params[r.params.length - 1];
          const unconscious = r.unitDied?.unconscious ?? lastParam === "1";
          if (!unconscious) {
            roundDeaths.push({ destId: destGuid });
            lastRoundDeathTs = Math.max(lastRoundDeathTs, r.timestamp);
          }
        }
      }
    }
  }

  const teamOf = (unitId: string) =>
    gladUnitsMap.get(unitId)?.info?.teamId ?? null;
  const winningTeamId = roundWinner(roundDeaths, teamOf);
  const result = matchResult(winningTeamId, playerTeamId);

  const startTime = seg.startLine.timestamp;
  // Solo Shuffle rounds have no ARENA_MATCH_END: the segment runs until the
  // next round's ARENA_MATCH_START, so "last record" includes the whole
  // between-round gap. That inflated round durations (~35s observed) and
  // attributed between-round re-setup casts (Beacons, buffs) to the previous
  // round — dead players appeared to cast (invariant sweep I9, 2026-07-16).
  // A shuffle round ends at its deciding death: clamp endTime to the last
  // round-ending player death plus a short grace for trailing combat records.
  // Timeout rounds (no deaths) keep the last-record end. rawLines/id are
  // untouched, so match ids and corpus fingerprints stay stable.
  const ROUND_END_GRACE_MS = 2_000;
  const lastRecordTs =
    seg.records.length > 0
      ? seg.records[seg.records.length - 1]!.timestamp
      : startTime;
  const endTime =
    lastRoundDeathTs > 0
      ? Math.min(lastRecordTs, lastRoundDeathTs + ROUND_END_GRACE_MS)
      : lastRecordTs;

  const rawLines = seg.rawLines;
  const id = calculateFnv1a32(rawLines);

  const hasAdvancedLogging = seg.hasAdvancedLogging ?? false;

  return {
    kind: "shuffleRound",
    sequenceNumber: seg.sequenceNumber ?? index,
    id,
    bracket: seg.bracket,
    zoneId: seg.zoneId,
    startTime,
    endTime,
    units: (() => {
      const u = Object.fromEntries(gladUnitsMap.entries());
      slimMatchParams({ units: u });
      return u;
    })(),
    playerId,
    playerTeamId,
    winningTeamId,
    result,
    linesTotal: rawLines.length,
    linesDropped: 0,
    rawLines,
    hasAdvancedLogging,
    timezone: "local",
  };
}

export function buildShuffle(close: ShuffleClose): GladShuffle {
  let ownerId: string | null = null;
  for (const roundSeg of close.rounds) {
    const rst = buildRoster(roundSeg.records);
    if (rst.ownerId) {
      ownerId = rst.ownerId;
      break;
    }
  }

  // every round carries the shuffle's closing line's lobby MMR (the rounds
  // themselves have no ARENA_MATCH_END)
  const teamMmr = teamMmrOf(close.end);
  const rounds = close.rounds.map((roundSeg, idx) => ({
    ...buildShuffleRound(roundSeg, idx, ownerId),
    teamMmr,
  }));

  const startTime = rounds[0] ? rounds[0].startTime : 0;
  const endTime = close.end.timestamp;

  const rawLines: string[] = [];
  for (let i = 0; i < rounds.length; i++) {
    rawLines.push(...rounds[i]!.rawLines);
  }
  rawLines.push(close.end.raw);

  const endWinner = close.end.arenaEnd
    ? close.end.arenaEnd.winningTeamId
    : null;
  const lastRound = rounds[rounds.length - 1];
  const playerTeamId = lastRound ? lastRound.playerTeamId : null;
  const result = matchResult(endWinner, playerTeamId);

  return {
    kind: "shuffle",
    rounds,
    startTime,
    endTime,
    rawLines,
    result,
  };
}

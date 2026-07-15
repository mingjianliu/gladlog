import type { Segment, ShuffleClose } from "../l2/types";
import type { GladMatch, GladShuffle, GladShuffleRound } from "./model";
import { buildRoster } from "./roster";
import { collectEvents } from "./collect";
import { classIdOf } from "./data/specToClass";
import { matchResult, roundWinner } from "./outcome";
import type { ParsedLine } from "../l1/types";

// FNV-1a 32-bit累积哈希
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

  // CI 回填
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

  const rawLines = [...seg.rawLines, end.raw];
  const id = calculateFnv1a32(rawLines);

  const hasAdvancedLogging = seg.records.some((r) => !!r.advanced);

  return {
    kind: "match",
    id,
    bracket: seg.bracket,
    zoneId: seg.zoneId,
    startTime: seg.startLine.timestamp,
    endTime: end.timestamp,
    units: Object.fromEntries(gladUnitsMap.entries()),
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

function buildShuffleRound(
  seg: Segment,
  index: number,
  resolvedOwnerId: string | null,
): GladShuffleRound {
  const roster = buildRoster(seg.records);
  const gladUnitsMap = collectEvents(seg.records, roster);

  // CI 回填
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

  const hasAdvancedLogging = seg.records.some((r) => !!r.advanced);

  return {
    kind: "shuffleRound",
    sequenceNumber: seg.sequenceNumber ?? index,
    id,
    bracket: seg.bracket,
    zoneId: seg.zoneId,
    startTime,
    endTime,
    units: Object.fromEntries(gladUnitsMap.entries()),
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

  const rounds = close.rounds.map((roundSeg, idx) =>
    buildShuffleRound(roundSeg, idx, ownerId),
  );

  const startTime = rounds[0] ? rounds[0].startTime : 0;
  const endTime = close.end.timestamp;

  const rawLines = [...rounds.flatMap((r) => r.rawLines), close.end.raw];

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

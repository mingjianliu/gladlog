import { decodeFlags } from "./flags";
import type { ParsedLine } from "../l1/types";

export interface RosterUnit {
  id: string;
  name: string | null;
  kind: 'Player' | 'NPC' | 'Pet' | 'Guardian' | 'Object' | 'Unknown';
  reaction: 'Friendly' | 'Neutral' | 'Hostile' | 'Unknown';
  ownerId?: string;
  flagsSeen: number[];
}

export function buildRoster(records: ParsedLine[]): {
  ownerId: string | null;
  units: Map<string, RosterUnit>;
} {
  const units = new Map<string, RosterUnit>();
  let ownerId: string | null = null;
  const petOwnersMap = new Map<string, string>();

  for (const record of records) {
    if (record.advanced) {
      const { actorGuid, ownerGuid } = record.advanced;
      if (ownerGuid && ownerGuid !== '0000000000000000' && ownerGuid !== 'nil') {
        petOwnersMap.set(actorGuid, ownerGuid);
      }
    }

    if (record.base) {
      const { srcGuid, srcName, srcFlags, destGuid, destName, destFlags } = record.base;

      if (srcGuid && srcGuid !== '0000000000000000' && srcName !== null) {
        let srcUnit = units.get(srcGuid);
        if (!srcUnit) {
          srcUnit = {
            id: srcGuid,
            name: srcName,
            kind: 'Unknown',
            reaction: 'Unknown',
            flagsSeen: [],
          };
          units.set(srcGuid, srcUnit);
        } else if (srcUnit.name === null && srcName !== null) {
          srcUnit.name = srcName;
        }
        srcUnit.flagsSeen.push(srcFlags);

        if (ownerId === null) {
          const decoded = decodeFlags(srcFlags);
          if (decoded.affiliation === 'Mine' && (srcGuid.startsWith('Player-') || decoded.kind === 'Player')) {
            ownerId = srcGuid;
          }
        }
      }

      if (destGuid && destGuid !== '0000000000000000' && destName !== null) {
        let destUnit = units.get(destGuid);
        if (!destUnit) {
          destUnit = {
            id: destGuid,
            name: destName,
            kind: 'Unknown',
            reaction: 'Unknown',
            flagsSeen: [],
          };
          units.set(destGuid, destUnit);
        } else if (destUnit.name === null && destName !== null) {
          destUnit.name = destName;
        }
        destUnit.flagsSeen.push(destFlags);

        if (ownerId === null) {
          const decoded = decodeFlags(destFlags);
          if (decoded.affiliation === 'Mine' && (destGuid.startsWith('Player-') || decoded.kind === 'Player')) {
            ownerId = destGuid;
          }
        }
      }
    }
  }

  for (const [id, unit] of units.entries()) {
    let kind: 'Player' | 'NPC' | 'Pet' | 'Guardian' | 'Object' | 'Unknown' = 'Unknown';
    if (id.startsWith('Player-')) {
      kind = 'Player';
    } else if (id.startsWith('Pet-')) {
      kind = 'Pet';
    } else if (id.startsWith('Creature-')) {
      const hasGuardianFlag = unit.flagsSeen.some(f => decodeFlags(f).kind === 'Guardian');
      kind = hasGuardianFlag ? 'Guardian' : 'NPC';
    } else {
      let decodedKind: 'Player' | 'NPC' | 'Pet' | 'Guardian' | 'Object' | 'Unknown' = 'Unknown';
      for (const f of unit.flagsSeen) {
        const k = decodeFlags(f).kind;
        if (k !== 'Unknown') {
          decodedKind = k;
          break;
        }
      }
      kind = decodedKind;
    }
    unit.kind = kind;

    const reactionCounts: Record<'Friendly' | 'Neutral' | 'Hostile' | 'Unknown', number> = {
      Friendly: 0,
      Neutral: 0,
      Hostile: 0,
      Unknown: 0
    };
    for (const f of unit.flagsSeen) {
      const decoded = decodeFlags(f);
      reactionCounts[decoded.reaction] = (reactionCounts[decoded.reaction] || 0) + 1;
    }
    let bestReaction: 'Friendly' | 'Neutral' | 'Hostile' | 'Unknown' = 'Unknown';
    let maxCount = 0;
    for (const r of ['Friendly', 'Neutral', 'Hostile'] as const) {
      const count = reactionCounts[r] || 0;
      if (count > maxCount) {
        maxCount = count;
        bestReaction = r;
      }
    }
    unit.reaction = bestReaction;

    if (kind === 'Pet') {
      const ownerGuid = petOwnersMap.get(id);
      if (ownerGuid) {
        unit.ownerId = ownerGuid;
      }
    }
  }

  return { ownerId, units };
}

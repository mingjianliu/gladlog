import { splitTopLevel } from "./splitTopLevel";

export interface GladCombatantInfoRaw {
  playerGuid: string;
  teamId: number;
  specId: number;
  talents: number[][];
  pvpTalents: number[];
  equipment: unknown[];
  personalRating: number;
  interestingAuras: {
    casterGuid: string;
    spellId: number;
  }[];
}

function parseOuterSegment(s: string): string[] | null {
  if (s.startsWith("[") && s.endsWith("]")) {
    const inner = s.substring(1, s.length - 1);
    if (inner === "") return [];
    return splitTopLevel(inner);
  }
  if (s.startsWith("(") && s.endsWith(")")) {
    const inner = s.substring(1, s.length - 1);
    if (inner === "") return [];
    return splitTopLevel(inner);
  }
  return null;
}

function decodeNested(s: string): unknown {
  if ((s.startsWith("[") && s.endsWith("]")) || (s.startsWith("(") && s.endsWith(")"))) {
    const inner = s.substring(1, s.length - 1);
    if (inner === "") return [];
    return splitTopLevel(inner).map(decodeNested);
  }
  if (/^-?\d+$/.test(s)) {
    return parseInt(s, 10);
  }
  if (/^-?\d+\.\d+$/.test(s)) {
    return parseFloat(s);
  }
  return s;
}

export function decodeCombatantInfo(params: string[]): GladCombatantInfoRaw | null {
  if (params.length < 30) {
    return null;
  }

  const playerGuid = params[0];
  const teamIdStr = params[1];
  if (playerGuid === undefined || teamIdStr === undefined) {
    return null;
  }

  const teamId = parseInt(teamIdStr, 10);
  if (isNaN(teamId)) return null;

  // Find the first index of the parameter starting with '[' or '('
  let i = -1;
  for (let idx = 0; idx < params.length; idx++) {
    const p = params[idx];
    if (p !== undefined && (p.startsWith("[") || p.startsWith("("))) {
      i = idx;
      break;
    }
  }

  if (i === -1 || i === 0) {
    return null;
  }

  const specIdStr = params[i - 1];
  if (specIdStr === undefined) return null;
  const specId = parseInt(specIdStr, 10);
  if (isNaN(specId)) return null;

  const talentsStr = params[i];
  if (talentsStr === undefined) return null;

  const talents: number[][] = [];
  if (talentsStr.startsWith("[")) {
    const talentsParts = parseOuterSegment(talentsStr);
    if (!talentsParts) return null;
    for (const part of talentsParts) {
      const innerParts = parseOuterSegment(part);
      if (!innerParts) return null;
      const item: number[] = [];
      for (const p of innerParts) {
        const num = parseInt(p, 10);
        if (isNaN(num)) return null;
        item.push(num);
      }
      talents.push(item);
    }
  } else if (talentsStr.startsWith("(")) {
    const talentsParts = parseOuterSegment(talentsStr);
    if (!talentsParts) return null;
    for (const p of talentsParts) {
      const num = parseInt(p, 10);
      if (isNaN(num)) return null;
      talents.push([num]);
    }
  } else {
    return null;
  }

  // pvpTalents is the next '(' segment
  let pvpTalentsIdx = -1;
  for (let idx = i + 1; idx < params.length; idx++) {
    const p = params[idx];
    if (p !== undefined && p.startsWith("(")) {
      pvpTalentsIdx = idx;
      break;
    }
  }
  if (pvpTalentsIdx === -1) return null;

  const pvpTalentsStr = params[pvpTalentsIdx];
  if (pvpTalentsStr === undefined) return null;
  const pvpTalentsParts = parseOuterSegment(pvpTalentsStr);
  if (!pvpTalentsParts) return null;
  const pvpTalents: number[] = [];
  for (const p of pvpTalentsParts) {
    const num = parseInt(p, 10);
    if (isNaN(num)) return null;
    pvpTalents.push(num);
  }

  // equipment is the next '[' segment
  let eqIdx = -1;
  for (let idx = pvpTalentsIdx + 1; idx < params.length; idx++) {
    const p = params[idx];
    if (p !== undefined && p.startsWith("[")) {
      eqIdx = idx;
      break;
    }
  }
  if (eqIdx === -1) return null;

  const equipmentStr = params[eqIdx];
  if (equipmentStr === undefined || !equipmentStr.startsWith("[") || !equipmentStr.endsWith("]")) {
    return null;
  }
  const equipment = decodeNested(equipmentStr);
  if (!Array.isArray(equipment)) {
    return null;
  }

  // interestingAuras is the next '[' segment (if it exists)
  let interestingAurasIdx = -1;
  for (let idx = eqIdx + 1; idx < params.length; idx++) {
    const p = params[idx];
    if (p !== undefined && p.startsWith("[")) {
      interestingAurasIdx = idx;
      break;
    }
  }

  let interestingAuras: { casterGuid: string; spellId: number }[] = [];
  if (interestingAurasIdx !== -1) {
    const interestingAurasStr = params[interestingAurasIdx];
    if (interestingAurasStr === undefined) return null;
    const auraParts = parseOuterSegment(interestingAurasStr);
    if (!auraParts) return null;

    if (auraParts.length === 0) {
      interestingAuras = [];
    } else if (auraParts.length % 3 === 0) {
      for (let idx = 0; idx < auraParts.length; idx += 3) {
        const caster = auraParts[idx];
        const spellIdStr = auraParts[idx + 1];
        if (caster === undefined || spellIdStr === undefined) return null;
        const spellId = parseInt(spellIdStr, 10);
        if (isNaN(spellId)) return null;
        interestingAuras.push({
          casterGuid: caster,
          spellId,
        });
      }
    } else if (auraParts.length % 2 === 0) {
      for (let idx = 0; idx < auraParts.length; idx += 2) {
        const caster = auraParts[idx];
        const spellIdStr = auraParts[idx + 1];
        if (caster === undefined || spellIdStr === undefined) return null;
        const spellId = parseInt(spellIdStr, 10);
        if (isNaN(spellId)) return null;
        interestingAuras.push({
          casterGuid: caster,
          spellId,
        });
      }
    } else {
      return null;
    }
  }

  const personalRatingStr = params[params.length - 2];
  if (personalRatingStr === undefined) return null;
  const personalRating = parseInt(personalRatingStr, 10);
  if (isNaN(personalRating)) return null;

  return {
    playerGuid,
    teamId,
    specId,
    talents,
    pvpTalents,
    equipment,
    personalRating,
    interestingAuras,
  };
}

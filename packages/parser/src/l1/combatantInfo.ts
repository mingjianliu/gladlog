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
  if (params.length < 32) {
    return null;
  }

  const playerGuid = params[0];
  const teamIdStr = params[1];
  const specIdStr = params[24];
  const talentsStr = params[25];
  const pvpTalentsStr = params[26];
  const equipmentStr = params[27];
  const interestingAurasStr = params[28];
  const personalRatingStr = params[params.length - 2];

  if (
    playerGuid === undefined ||
    teamIdStr === undefined ||
    specIdStr === undefined ||
    talentsStr === undefined ||
    pvpTalentsStr === undefined ||
    equipmentStr === undefined ||
    interestingAurasStr === undefined ||
    personalRatingStr === undefined
  ) {
    return null;
  }

  const teamId = parseInt(teamIdStr, 10);
  if (isNaN(teamId)) return null;

  const specId = parseInt(specIdStr, 10);
  if (isNaN(specId)) return null;

  const personalRating = parseInt(personalRatingStr, 10);
  if (isNaN(personalRating)) return null;

  const talentsParts = parseOuterSegment(talentsStr);
  if (!talentsParts) return null;

  const talents: number[][] = [];
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

  const pvpTalentsParts = parseOuterSegment(pvpTalentsStr);
  if (!pvpTalentsParts) return null;

  const pvpTalents: number[] = [];
  for (const p of pvpTalentsParts) {
    const num = parseInt(p, 10);
    if (isNaN(num)) return null;
    pvpTalents.push(num);
  }

  if (!equipmentStr.startsWith("[") || !equipmentStr.endsWith("]")) {
    return null;
  }
  const equipment = decodeNested(equipmentStr);
  if (!Array.isArray(equipment)) {
    return null;
  }

  const auraParts = parseOuterSegment(interestingAurasStr);
  if (!auraParts) return null;
  if (auraParts.length % 3 !== 0) return null;

  const interestingAuras: { casterGuid: string; spellId: number }[] = [];
  for (let i = 0; i < auraParts.length; i += 3) {
    const caster = auraParts[i];
    const spellIdStr = auraParts[i + 1];
    const flagStr = auraParts[i + 2];
    if (caster === undefined || spellIdStr === undefined || flagStr === undefined) {
      return null;
    }
    const spellId = parseInt(spellIdStr, 10);
    if (isNaN(spellId)) return null;
    interestingAuras.push({
      casterGuid: caster,
      spellId,
    });
  }

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

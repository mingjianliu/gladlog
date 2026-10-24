import { splitTopLevel } from "./splitTopLevel";

interface GladCombatantInfoRaw {
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
    const tokens = splitTopLevel(inner);
    const result: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i] !== "") result.push(tokens[i]!);
    }
    return result;
  }
  if (s.startsWith("(") && s.endsWith(")")) {
    const inner = s.substring(1, s.length - 1);
    if (inner === "") return [];
    const tokens = splitTopLevel(inner);
    const result: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i] !== "") result.push(tokens[i]!);
    }
    return result;
  }
  return null;
}

function decodeNested(s: string): unknown {
  if (
    (s.startsWith("[") && s.endsWith("]")) ||
    (s.startsWith("(") && s.endsWith(")"))
  ) {
    const inner = s.substring(1, s.length - 1);
    if (inner === "") return [];
    const tokens = splitTopLevel(inner);
    const result: unknown[] = [];
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i] !== "") result.push(decodeNested(tokens[i]!));
    }
    return result;
  }
  if (/^-?\d+$/.test(s)) {
    return parseInt(s, 10);
  }
  if (/^-?\d+\.\d+$/.test(s)) {
    return parseFloat(s);
  }
  return s;
}

export function decodeCombatantInfo(
  params: string[],
): GladCombatantInfoRaw | null {
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
  if (
    equipmentStr === undefined ||
    !equipmentStr.startsWith("[") ||
    !equipmentStr.endsWith("]")
  ) {
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

  // interestingAuras is a flat list of either (casterGuid, spellId) pairs or
  // (casterGuid, spellId, stacks) triples — both occur in real logs (public
  // wowarenalogs testlogs 2024: 166 lists of pairs, 66 of triples). The
  // format is read off the list's STRUCTURE, never its length: 3 pairs are
  // 6 elements, which the old `length % 3` test took for 2 triples, read
  // "1459" as a caster and dropped the whole COMBATANT_INFO — the player
  // then fell out of the round's roster (21 of 165 lines across
  // shuffle_reloads / shuffle_early_leaver). A list that is neither shape is
  // dropped on its own: losing a player for an unreadable aura list costs
  // far more than the auras.
  const interestingAuras: { casterGuid: string; spellId: number }[] = [];
  if (interestingAurasIdx !== -1) {
    const interestingAurasStr = params[interestingAurasIdx];
    const auraParts =
      interestingAurasStr !== undefined
        ? parseOuterSegment(interestingAurasStr)
        : null;
    const stride = auraParts ? interestingAuraStride(auraParts) : null;
    if (auraParts && stride !== null)
      for (let idx = 0; idx < auraParts.length; idx += stride)
        interestingAuras.push({
          casterGuid: auraParts[idx]!,
          spellId: parseInt(auraParts[idx + 1]!, 10),
        });
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

const INTEGER_RE = /^-?\d+$/;

/** The record size of an interesting-auras list: 3 for (caster, spellId,
 * stacks) triples, 2 for (caster, spellId) pairs, null for neither. The two
 * shapes exclude each other: a triple's third element is a number where a
 * pair list has its next caster. */
function interestingAuraStride(parts: string[]): 2 | 3 | null {
  if (parts.length === 0) return 2;
  const fits = (stride: 2 | 3) =>
    parts.length % stride === 0 &&
    parts.every((p, i) =>
      i % stride === 0 ? !INTEGER_RE.test(p) : INTEGER_RE.test(p),
    );
  return fits(3) ? 3 : fits(2) ? 2 : null;
}

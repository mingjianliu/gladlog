function parseHex(val: string | undefined): number {
  if (val === undefined) return NaN;
  return parseInt(val, 16);
}

function parseInt10(val: string | undefined): number {
  if (val === undefined) return NaN;
  return parseInt(val, 10);
}

function parseFloatSafe(val: string | undefined): number {
  if (val === undefined) return NaN;
  return parseFloat(val);
}

function parseHexOrDecimal(val: string | undefined): number {
  if (val === undefined) return NaN;
  if (val.startsWith("0x")) {
    return parseInt(val, 16);
  }
  return parseInt(val, 10);
}

function decodeCritical(val: string | undefined): boolean {
  return val === "1";
}

export function decodeBaseUnits(params: string[]): {
  srcGuid: string;
  srcName: string | null;
  srcFlags: number;
  srcRaidFlags: number;
  destGuid: string;
  destName: string | null;
  destFlags: number;
  destRaidFlags: number;
} {
  const srcGuid = params[0];
  const srcNameRaw = params[1];
  const srcFlagsStr = params[2];
  const srcRaidFlagsStr = params[3];
  const destGuid = params[4];
  const destNameRaw = params[5];
  const destFlagsStr = params[6];
  const destRaidFlagsStr = params[7];

  const srcName = srcNameRaw === "nil" || srcNameRaw === undefined ? null : srcNameRaw;
  const destName = destNameRaw === "nil" || destNameRaw === undefined ? null : destNameRaw;

  return {
    srcGuid: srcGuid ?? "",
    srcName,
    srcFlags: parseHex(srcFlagsStr),
    srcRaidFlags: parseHex(srcRaidFlagsStr),
    destGuid: destGuid ?? "",
    destName,
    destFlags: parseHex(destFlagsStr),
    destRaidFlags: parseHex(destRaidFlagsStr),
  };
}

export function decodeSpell(params: string[], at: number): {
  spellId: number;
  spellName: string;
  spellSchool: number;
} {
  const idStr = params[at];
  const nameStr = params[at + 1];
  const schoolStr = params[at + 2];

  return {
    spellId: parseInt10(idStr),
    spellName: nameStr ?? "",
    spellSchool: parseHex(schoolStr),
  };
}

export function decodeDamage(tailParams: string[]): {
  amount: number;
  baseAmount: number;
  overkill: number;
  school: number;
  resisted: number;
  blocked: number;
  absorbed: number;
  critical: boolean;
  effectiveAmount: number;
} {
  const amount = parseInt10(tailParams[0]);
  const baseAmount = parseInt10(tailParams[1]);
  const overkill = parseInt10(tailParams[2]);
  const school = parseHexOrDecimal(tailParams[3]);
  const resisted = parseInt10(tailParams[4]);
  const blocked = parseInt10(tailParams[5]);
  const absorbed = parseInt10(tailParams[6]);
  const critical = decodeCritical(tailParams[7]);

  const effectiveAmount = amount - Math.max(overkill || 0, 0);

  return {
    amount,
    baseAmount,
    overkill,
    school,
    resisted,
    blocked,
    absorbed,
    critical,
    effectiveAmount,
  };
}

export function decodeHeal(tailParams: string[]): {
  amount: number;
  baseAmount: number;
  overheal: number;
  absorbed: number;
  critical: boolean;
  effectiveAmount: number;
} {
  const amount = parseInt10(tailParams[0]);
  const baseAmount = parseInt10(tailParams[1]);
  const overheal = parseInt10(tailParams[2]);
  const absorbed = parseInt10(tailParams[3]);
  const critical = decodeCritical(tailParams[4]);

  const effectiveAmount = Math.max(0, amount - overheal);

  return {
    amount,
    baseAmount,
    overheal,
    absorbed,
    critical,
    effectiveAmount,
  };
}

export function decodeAdvanced(params: string[], at: number): {
  actorGuid: string;
  ownerGuid: string;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
  facing: number;
  mapId: number;
} {
  const actorGuid = params[at] ?? "";
  const ownerGuid = params[at + 1] ?? "";
  const hp = parseInt10(params[at + 2]);
  const maxHp = parseInt10(params[at + 3]);

  let xIdx = at + 14;
  let yIdx = at + 15;
  for (let i = at + 4; i < params.length - 1; i++) {
    const val1 = params[i];
    const val2 = params[i + 1];
    if (val1 !== undefined && val2 !== undefined && val1.includes(".") && val2.includes(".")) {
      xIdx = i;
      yIdx = i + 1;
      break;
    }
  }

  const x = parseFloatSafe(params[xIdx]);
  const y = parseFloatSafe(params[yIdx]);
  const mapId = parseInt10(params[xIdx + 2]);
  const facing = parseFloatSafe(params[xIdx + 3]);

  return {
    actorGuid,
    ownerGuid,
    hp,
    maxHp,
    x,
    y,
    facing,
    mapId,
  };
}

export function decodeAura(tailParams: string[]): {
  auraType: "BUFF" | "DEBUFF";
  amount?: number;
} {
  const typeStr = tailParams[0];
  const auraType = typeStr === "DEBUFF" ? "DEBUFF" : "BUFF";
  const amountStr = tailParams[1];
  if (amountStr !== undefined && amountStr !== "") {
    return {
      auraType,
      amount: parseInt10(amountStr),
    };
  }
  return {
    auraType,
  };
}

export function decodeExtraSpell(tailParams: string[]): {
  extraSpellId: number;
  extraSpellName: string;
  extraSchool: number;
} {
  return {
    extraSpellId: parseInt10(tailParams[0]),
    extraSpellName: tailParams[1] ?? "",
    extraSchool: parseHexOrDecimal(tailParams[2]),
  };
}

export function decodeAbsorbed(params: string[]): {
  shieldOwnerGuid: string;
  shieldOwnerName: string | null;
  shieldSpellId: number;
  shieldSpellName: string;
  absorbedAmount: number;
  totalAmount: number;
  critical: boolean;
} {
  const shieldOwnerNameRaw = params[12];
  const shieldOwnerName = shieldOwnerNameRaw === "nil" || shieldOwnerNameRaw === undefined ? null : shieldOwnerNameRaw;

  return {
    shieldOwnerGuid: params[11] ?? "",
    shieldOwnerName,
    shieldSpellId: parseInt10(params[15]),
    shieldSpellName: params[16] ?? "",
    absorbedAmount: parseInt10(params[18]),
    totalAmount: parseInt10(params[19]),
    critical: decodeCritical(params[20]),
  };
}

export function decodeArenaStart(params: string[]): {
  zoneId: string;
  unkInstanceId: string;
  bracket: string;
  isRated: boolean;
} {
  return {
    zoneId: params[0] ?? "",
    unkInstanceId: params[1] ?? "",
    bracket: params[2] ?? "",
    isRated: params[3] === "1",
  };
}

export function decodeArenaEnd(params: string[]): {
  winningTeamId: number;
  matchDurationSeconds: number;
  team0Mmr: number;
  team1Mmr: number;
} {
  return {
    winningTeamId: parseInt10(params[0]),
    matchDurationSeconds: parseInt10(params[1]),
    team0Mmr: parseInt10(params[2]),
    team1Mmr: parseInt10(params[3]),
  };
}

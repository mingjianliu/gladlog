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

  const srcName =
    srcNameRaw === "nil" || srcNameRaw === undefined ? null : srcNameRaw;
  const destName =
    destNameRaw === "nil" || destNameRaw === undefined ? null : destNameRaw;

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

export function decodeSpell(
  params: string[],
  at: number,
): {
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

export function decodeDamage(
  params: string[],
  at: number,
): {
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
  const amount = parseInt10(params[at]);
  const baseAmount = parseInt10(params[at + 1]);
  const overkill = parseInt10(params[at + 2]);
  const school = parseHexOrDecimal(params[at + 3]);
  const resisted = parseInt10(params[at + 4]);
  const blocked = parseInt10(params[at + 5]);
  const absorbed = parseInt10(params[at + 6]);
  const critical = decodeCritical(params[at + 7]);

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

export function decodeHeal(
  params: string[],
  at: number,
): {
  amount: number;
  baseAmount: number;
  overheal: number;
  absorbed: number;
  critical: boolean;
  effectiveAmount: number;
} {
  const amount = parseInt10(params[at]);
  const baseAmount = parseInt10(params[at + 1]);
  const overheal = parseInt10(params[at + 2]);
  const absorbed = parseInt10(params[at + 3]);
  const critical = decodeCritical(params[at + 4]);

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

/**
 * A power entry from the advanced block. The three power fields sit at
 * `xIdx-4 .. xIdx-2` — anchored off the auto-detected position pair, never off
 * a fixed offset, because the advanced block's length varies. Same anchoring as
 * `analysis/utils/rawStreams.ts`'s `extractManaFromAdvanced`, which is the
 * registered mirror of this decoder.
 *
 * A unit can report SEVERAL powers at once, pipe-separated ("13|3" with
 * "600|100" / "15000|100") — measured at 2.7% of SPELL_CAST_SUCCESS lines in
 * the 12.1 archive — so this returns a list, not a scalar.
 */
export interface PowerEntry {
  /** Blizzard power type: 0 Mana, 1 Rage, 2 Focus, 3 Energy, 6 Runic Power,
   * 13 Insanity, 19 Essence, … -1 when the field is absent/unparsable. */
  powerType: number;
  current: number;
  max: number;
}

function decodePowers(
  params: string[],
  typeIdx: number,
  curIdx: number,
  maxIdx: number,
): PowerEntry[] {
  const types = (params[typeIdx] ?? "").split("|");
  const currents = (params[curIdx] ?? "").split("|");
  const maxes = (params[maxIdx] ?? "").split("|");
  const out: PowerEntry[] = [];
  for (let i = 0; i < types.length; i++) {
    const powerType = parseInt10(types[i]);
    if (Number.isNaN(powerType)) continue;
    out.push({
      powerType,
      current: parseInt10(currents[i]),
      max: parseInt10(maxes[i]),
    });
  }
  return out;
}

export function decodeAdvanced(
  params: string[],
  at: number,
): {
  actorGuid: string;
  ownerGuid: string;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
  facing: number;
  mapId: number;
  powers: PowerEntry[];
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
    if (
      val1 !== undefined &&
      val2 !== undefined &&
      val1.includes(".") &&
      val2.includes(".")
    ) {
      xIdx = i;
      yIdx = i + 1;
      break;
    }
  }

  const x = parseFloatSafe(params[xIdx]);
  const y = parseFloatSafe(params[yIdx]);
  const mapId = parseInt10(params[xIdx + 2]);
  const facing = parseFloatSafe(params[xIdx + 3]);
  // powerType / currentPower / maxPower, then powerCost at xIdx-1.
  const powers =
    xIdx >= at + 4 ? decodePowers(params, xIdx - 4, xIdx - 3, xIdx - 2) : [];

  return {
    actorGuid,
    ownerGuid,
    hp,
    maxHp,
    x,
    y,
    facing,
    mapId,
    powers,
  };
}

/**
 * `*_MISSED`'s outcome fields, immediately after the spell triple (swings have
 * no spell triple, so `at` differs).
 *
 * ⚠ `missType === "ABSORB"` is NOT new information: the same hit is already
 * reported by its own `SPELL_ABSORBED` line at the same instant with the same
 * numbers (verified on real archive lines). Counting both double-counts. The
 * classes only this event carries are IMMUNE and REFLECT.
 */
export function decodeMissed(
  params: string[],
  at: number,
): {
  missType: string;
  isOffHand: boolean;
  amount: number;
} {
  return {
    missType: params[at] ?? "",
    isOffHand: params[at + 1] === "1",
    amount: parseInt10(params[at + 2]),
  };
}

/**
 * `SPELL_HEAL_ABSORBED`: healing that a heal-absorb effect ate.
 *
 * The prefix describes the ABSORB, not the heal — verified 13,809 : 0 against
 * same-instant `SPELL_HEAL` lines: base src is whoever applied the heal-absorb
 * debuff, base dest is the unit whose incoming healing was eaten, the base
 * spell is that debuff (e.g. Necrotic Wound), and the EXTRA block is the healer
 * plus the heal spell.
 *
 * Not an HPS correction: `SPELL_HEAL.amount` is already net of heal absorption
 * (grounding audit D8 — subtracting it again made the HP reconciliation
 * residual worse, 2.9% → 3.6%). What it adds is the missing fact of how much
 * healing was eaten, and by what.
 */
/**
 * Parameter offsets for SPELL_ABSORBED and SPELL_HEAL_ABSORBED events.
 *
 * In WoW combat logs:
 * - Spell attack form (>= 21 params): prefix (0..7), attack/absorb spell triple (8..10),
 *   shield/heal caster prefix (11..14), shield/heal spell triple (15..17), amounts (18..19), critical (20).
 * - Swing attack form (18 params): prefix (0..7), shield caster prefix (8..11),
 *   shield spell triple (12..14), amounts (15..16), critical (17).
 */
export const ABSORB_SPELL_OFFSETS = {
  ATTACKER_GUID: 0,
  ATTACKER_NAME: 1,
  VICTIM_GUID: 4,
  ATTACK_SPELL_ID: 8,
  ATTACK_SPELL_NAME: 9,
  ATTACK_SPELL_SCHOOL: 10,
  SHIELD_OWNER_GUID: 11,
  SHIELD_OWNER_NAME: 12,
  SHIELD_SPELL_ID: 15,
  SHIELD_SPELL_NAME: 16,
  ABSORBED_AMOUNT: 18,
  TOTAL_AMOUNT: 19,
  CRITICAL: 20,
} as const;

export const ABSORB_SWING_OFFSETS = {
  ATTACKER_GUID: 0,
  ATTACKER_NAME: 1,
  VICTIM_GUID: 4,
  SHIELD_OWNER_GUID: 8,
  SHIELD_OWNER_NAME: 9,
  SHIELD_SPELL_ID: 12,
  SHIELD_SPELL_NAME: 13,
  ABSORBED_AMOUNT: 15,
  TOTAL_AMOUNT: 16,
  CRITICAL: 17,
} as const;

export function decodeHealAbsorbed(params: string[]): {
  absorbCasterGuid: string;
  absorbCasterName: string | null;
  victimGuid: string;
  absorbSpellId: number;
  absorbSpellName: string;
  healerGuid: string;
  healerName: string | null;
  healSpellId: number;
  healSpellName: string;
  absorbedAmount: number;
  totalAmount: number;
} {
  const absorbCasterNameRaw = params[ABSORB_SPELL_OFFSETS.ATTACKER_NAME];
  const absorbCasterName =
    absorbCasterNameRaw === "nil" || absorbCasterNameRaw === undefined
      ? null
      : absorbCasterNameRaw;

  const healerNameRaw = params[ABSORB_SPELL_OFFSETS.SHIELD_OWNER_NAME];
  const healerName =
    healerNameRaw === "nil" || healerNameRaw === undefined
      ? null
      : healerNameRaw;

  return {
    absorbCasterGuid: params[ABSORB_SPELL_OFFSETS.ATTACKER_GUID] ?? "",
    absorbCasterName,
    victimGuid: params[ABSORB_SPELL_OFFSETS.VICTIM_GUID] ?? "",
    absorbSpellId: parseInt10(params[ABSORB_SPELL_OFFSETS.ATTACK_SPELL_ID]),
    absorbSpellName: params[ABSORB_SPELL_OFFSETS.ATTACK_SPELL_NAME] ?? "",
    healerGuid: params[ABSORB_SPELL_OFFSETS.SHIELD_OWNER_GUID] ?? "",
    healerName,
    healSpellId: parseInt10(params[ABSORB_SPELL_OFFSETS.SHIELD_SPELL_ID]),
    healSpellName: params[ABSORB_SPELL_OFFSETS.SHIELD_SPELL_NAME] ?? "",
    absorbedAmount: parseInt10(params[ABSORB_SPELL_OFFSETS.ABSORBED_AMOUNT]),
    totalAmount: parseInt10(params[ABSORB_SPELL_OFFSETS.TOTAL_AMOUNT]),
  };
}

export function decodeAura(
  params: string[],
  at: number,
): {
  auraType: "BUFF" | "DEBUFF";
  amount?: number;
} {
  const typeStr = params[at];
  const auraType = typeStr === "DEBUFF" ? "DEBUFF" : "BUFF";
  const amountStr = params[at + 1];
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

export function decodeExtraSpell(
  params: string[],
  at: number,
): {
  extraSpellId: number;
  extraSpellName: string;
  extraSchool: number;
} {
  return {
    extraSpellId: parseInt10(params[at]),
    extraSpellName: params[at + 1] ?? "",
    extraSchool: parseHexOrDecimal(params[at + 2]),
  };
}

export function decodeAbsorbed(params: string[]): {
  attackerGuid: string;
  victimGuid: string;
  shieldOwnerGuid: string;
  shieldOwnerName: string | null;
  shieldSpellId: number;
  shieldSpellName: string;
  absorbedAmount: number;
  totalAmount: number;
  critical: boolean;
  /** The spell that was absorbed — the ATTACKER's spell, not the shield. Only
   * the spell form carries it; a swing absorb (18 params) has no spell triple.
   * Nothing downstream could answer "what did the Grounding Totem eat" without
   * it: the event's own spellId is the shield, and the archive slimmer clears
   * these params (GH #100). */
  attackSpellId: number | null;
  attackSpellName: string | null;
} {
  const attackerGuid = params[ABSORB_SPELL_OFFSETS.ATTACKER_GUID] ?? "";
  const victimGuid = params[ABSORB_SPELL_OFFSETS.VICTIM_GUID] ?? "";

  let shieldOwnerGuid = "";
  let shieldOwnerNameRaw: string | undefined;
  let shieldSpellId = NaN;
  let shieldSpellName = "";
  let absorbedAmount = NaN;
  let totalAmount = NaN;
  let critical = false;
  let attackSpellId: number | null = null;
  let attackSpellName: string | null = null;

  if (params.length === 18) {
    shieldOwnerGuid = params[ABSORB_SWING_OFFSETS.SHIELD_OWNER_GUID] ?? "";
    shieldOwnerNameRaw = params[ABSORB_SWING_OFFSETS.SHIELD_OWNER_NAME];
    shieldSpellId = parseInt10(params[ABSORB_SWING_OFFSETS.SHIELD_SPELL_ID]);
    shieldSpellName = params[ABSORB_SWING_OFFSETS.SHIELD_SPELL_NAME] ?? "";
    absorbedAmount = parseInt10(params[ABSORB_SWING_OFFSETS.ABSORBED_AMOUNT]);
    totalAmount = parseInt10(params[ABSORB_SWING_OFFSETS.TOTAL_AMOUNT]);
    critical = decodeCritical(params[ABSORB_SWING_OFFSETS.CRITICAL]);
  } else {
    const id = parseInt10(params[ABSORB_SPELL_OFFSETS.ATTACK_SPELL_ID]);
    if (!Number.isNaN(id)) {
      attackSpellId = id;
      attackSpellName = params[ABSORB_SPELL_OFFSETS.ATTACK_SPELL_NAME] ?? null;
    }
    shieldOwnerGuid = params[ABSORB_SPELL_OFFSETS.SHIELD_OWNER_GUID] ?? "";
    shieldOwnerNameRaw = params[ABSORB_SPELL_OFFSETS.SHIELD_OWNER_NAME];
    shieldSpellId = parseInt10(params[ABSORB_SPELL_OFFSETS.SHIELD_SPELL_ID]);
    shieldSpellName = params[ABSORB_SPELL_OFFSETS.SHIELD_SPELL_NAME] ?? "";
    absorbedAmount = parseInt10(params[ABSORB_SPELL_OFFSETS.ABSORBED_AMOUNT]);
    totalAmount = parseInt10(params[ABSORB_SPELL_OFFSETS.TOTAL_AMOUNT]);
    critical = decodeCritical(params[ABSORB_SPELL_OFFSETS.CRITICAL]);
  }

  const shieldOwnerName =
    shieldOwnerNameRaw === "nil" || shieldOwnerNameRaw === undefined
      ? null
      : shieldOwnerNameRaw;

  return {
    attackerGuid,
    victimGuid,
    shieldOwnerGuid,
    shieldOwnerName,
    shieldSpellId,
    shieldSpellName,
    absorbedAmount,
    totalAmount,
    critical,
    attackSpellId,
    attackSpellName,
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

/** Used to locate the tail params of damage/heal events: finds the starting
 * index of the advanced coordinate pair (x, y). */
export function findXIdx(params: string[], at: number): number {
  let xIdx = at + 14;
  for (let i = at + 4; i < params.length - 1; i++) {
    const val1 = params[i];
    const val2 = params[i + 1];
    if (
      val1 !== undefined &&
      val2 !== undefined &&
      val1.indexOf(".") !== -1 &&
      val2.indexOf(".") !== -1
    ) {
      xIdx = i;
      break;
    }
  }
  return xIdx;
}

/** Tail-param slicing rule for damage/heal events (single source: shared by
 * parseLine and its consumers). */
export function hpTailSlice(
  eventName: string,
  params: string[],
): { kind: "damage" | "heal"; offset: number } | null {
  if (eventName.endsWith("_HEAL")) {
    if (params.length < 5) return null;
    return { kind: "heal", offset: params.length - 5 };
  }
  // ENVIRONMENTAL_DAMAGE: the environment type precedes a 10-field tail, so
  // the "11 or 10 past the position block" rule below would land on the type.
  if (eventName === "ENVIRONMENTAL_DAMAGE") {
    if (params.length < 11) return null;
    return { kind: "damage", offset: params.length - 10 };
  }
  const isSwing =
    eventName === "SWING_DAMAGE" || eventName === "SWING_DAMAGE_LANDED";
  // DAMAGE_SPLIT carries the same spell + advanced + damage-tail shape as
  // SPELL_DAMAGE but does not end in "_DAMAGE".
  if (
    !isSwing &&
    !eventName.endsWith("_DAMAGE") &&
    eventName !== "DAMAGE_SPLIT"
  )
    return null;
  if (params.length < 10) return null;
  const at = isSwing ? 8 : 11;
  const xIdx = findXIdx(params, at);
  const offset =
    params.length - (xIdx + 5) >= 11 ? params.length - 11 : params.length - 10;
  return { kind: "damage", offset };
}

/**
 * Decodes damage/heal tail params from the full params array (the single-source
 * entry point for the breakdown's crit flag and amounts).
 * Non-HP events or too few params → null (when a trimmed doc has no params,
 * consumers pass [] and get null).
 */
export function decodeHpTail(
  eventName: string,
  params: string[],
): { critical: boolean; amount: number; effectiveAmount: number } | null {
  const sliced = hpTailSlice(eventName, params);
  if (!sliced) return null;
  const d =
    sliced.kind === "heal"
      ? decodeHeal(params, sliced.offset)
      : decodeDamage(params, sliced.offset);
  return {
    critical: d.critical,
    amount: d.amount,
    effectiveAmount: d.effectiveAmount,
  };
}

import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  ICCInstance,
  immunityBreak,
  IPlayerCCTrinketSummary,
} from "../utils/ccTrinketAnalysis";
import {
  findCheaperDefensiveAlternatives,
  IMajorCooldownInfo,
} from "../utils/cooldowns";
import { buildMatchTimeline, BuildMatchTimelineParams } from "./matchTimeline";

/**
 * Triage 2026-09-29, group G10 (the `cheaper available:` note):
 *  - hp-state F-T1: a nil-dest group wall (Spirit Link Totem, Aura Mastery)
 *    is a team save, so a self-only tool is not its cheaper alternative;
 *  - enemy-def F-E20: an owner stunned at the cast — strictly inside the stun,
 *    or pressing the immunity that ended it — is offered only buttons usable
 *    while stunned, and the `[CC ON TEAM]` line says the immunity broke it.
 */

const DIVINE_SHIELD = "642";
const DIVINE_PROTECTION = "498";
const SPELLWARDING = "204018";
const HOJ = "853";
const SPIRIT_LINK = "98008";
const ASTRAL_SHIFT = "108271";

function mkUnit(id: string, overrides: Partial<ICombatUnit> = {}): ICombatUnit {
  return {
    id,
    name: `${id}-Realm`,
    ownerId: "",
    isWellFormed: true,
    type: CombatUnitType.Player,
    class: CombatUnitClass.Paladin,
    spec: CombatUnitSpec.Paladin_Holy,
    reaction: CombatUnitReaction.Friendly,
    damageIn: [],
    damageOut: [],
    healIn: [],
    healOut: [],
    absorbsIn: [],
    absorbsOut: [],
    auraEvents: [],
    spellCastEvents: [],
    castStartEvents: [],
    petSpellCastEvents: [],
    actionIn: [],
    actionOut: [],
    deathRecords: [],
    advancedActions: [],
    ...overrides,
  };
}

const castSuccess = (spellId: string, spellName: string, t: number) => ({
  spellId,
  spellName,
  timestamp: t,
  srcUnitId: "o",
  srcUnitName: "o-Realm",
  destUnitId: "0000000000000000",
  destUnitName: "nil",
  logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: t, parameters: [] },
});

const ledgerEntry = (
  spellId: string,
  spellName: string,
  cooldownSeconds: number,
  casts: number[],
): IMajorCooldownInfo => ({
  spellId,
  spellName,
  tag: "Defensive",
  cooldownSeconds,
  maxChargesDetected: 1,
  casts: casts.map((timeSeconds) => ({ timeSeconds })),
  availableWindows: [{ fromSeconds: 0, toSeconds: 120, durationSeconds: 120 }],
  neverUsed: casts.length === 0,
});

const hoj = (atSeconds: number, durationSeconds: number): ICCInstance => ({
  atSeconds,
  durationSeconds,
  spellId: HOJ,
  spellName: "Hammer of Justice",
  sourceName: "e-Realm",
  sourceId: "e",
  sourceSpec: "Holy Paladin",
  damageTakenDuring: 0,
  trinketState: "on_cooldown",
  trinketCDSecondsLeft: 11,
  drInfo: { category: "Stun", level: "Full", sequenceIndex: 0 },
  distanceYards: null,
  losBlocked: null,
});

function timeline(opts: {
  ownerCDs: IMajorCooldownInfo[];
  ownerCasts?: ReturnType<typeof castSuccess>[];
  cc?: ICCInstance[];
}): string {
  const owner = mkUnit("o", {
    spellCastEvents: (opts.ownerCasts ?? []) as never,
  });
  const enemy = mkUnit("e", { reaction: CombatUnitReaction.Hostile });
  const summary: IPlayerCCTrinketSummary = {
    playerName: owner.name,
    playerSpec: "Holy Paladin",
    trinketType: "Gladiator",
    trinketCooldownSeconds: 90,
    ccInstances: opts.cc ?? [],
    trinketUseTimes: [],
    missedTrinketWindows: [],
    rootInstances: [],
    disarmInstances: [],
    interruptInstances: [],
    ccAvoidedInstances: [],
  };
  const params: BuildMatchTimelineParams = {
    owner,
    ownerSpec: "Paladin_Holy",
    ownerCDs: opts.ownerCDs,
    teammateCDs: [],
    enemyCDTimeline: { players: [], alignedBurstWindows: [] },
    ccTrinketSummaries: [summary],
    dispelSummary: {
      allyCleanse: [],
      ourPurges: [],
      hostilePurges: [],
      missedCleanseWindows: [],
      lateCleanseWindows: [],
      ccEfficiency: [],
      missedPurgeWindows: [],
    },
    friendlyDeaths: [],
    enemyDeaths: [],
    pressureWindows: [],
    healingGaps: [],
    friends: [owner],
    enemies: [enemy],
    matchStartMs: 0,
    matchEndMs: 120_000,
    isHealer: true,
    criticalWindowSeconds: new Set<number>(),
  };
  return buildMatchTimeline(params);
}

const lineWith = (t: string, ...needles: string[]) =>
  t.split("\n").find((l) => needles.every((n) => l.includes(n)));

describe("cheaper note for a team save (hp-state F-T1)", () => {
  it("a nil-dest Spirit Link Totem is not offered the self-only Astral Shift", () => {
    const t = timeline({
      ownerCDs: [
        ledgerEntry(SPIRIT_LINK, "Spirit Link Totem", 180, [30]),
        ledgerEntry(ASTRAL_SHIFT, "Astral Shift", 120, []),
      ],
    });
    const line = lineWith(t, "[YOU] [CD]", "Spirit Link Totem");
    expect(line).toBeDefined();
    expect(line).not.toContain("cheaper available");
  });

  it("a personal wall still gets the cheaper personal wall", () => {
    const t = timeline({
      ownerCDs: [
        ledgerEntry(DIVINE_SHIELD, "Divine Shield", 210, [30]),
        ledgerEntry(DIVINE_PROTECTION, "Divine Protection", 60, []),
      ],
    });
    expect(lineWith(t, "[YOU] [CD]", "Divine Shield")).toContain(
      "cheaper available: Divine Protection",
    );
  });
});

describe("owner stunned at the cast (enemy-def F-E20)", () => {
  // e10c6bea: Hammer of Justice 162.494 → REMOVED 165.286 inside Divine
  // Shield's purge, SPELL_CAST_SUCCESS 165.287.
  const ledger = [
    ledgerEntry(DIVINE_SHIELD, "Divine Shield", 210, [45.287]),
    ledgerEntry(SPELLWARDING, "Blessing of Spellwarding", 180, []),
    ledgerEntry(DIVINE_PROTECTION, "Divine Protection", 60, []),
  ];
  const brokenStun = timeline({
    ownerCDs: ledger,
    ownerCasts: [castSuccess(DIVINE_SHIELD, "Divine Shield", 45_287)],
    cc: [hoj(42.494, 2.792)],
  });

  it("the immunity that ended the stun is offered only stun-usable buttons", () => {
    const line = lineWith(brokenStun, "[YOU] [CD]", "Divine Shield");
    expect(line).toContain("cheaper available: Divine Protection");
    expect(line).not.toContain("Blessing of Spellwarding");
    // the strict-inside tag is unchanged: the cast is after the stun's end
    expect(line).not.toContain("[while stunned");
  });

  it("the [CC ON TEAM] line names the immunity and keeps its duration", () => {
    const line = lineWith(brokenStun, "[CC ON TEAM]", "Hammer of Justice");
    expect(line).toContain(") | 3s");
    expect(line).toMatch(/\| Divine Shield broke this CC after 3s$/);
  });

  it("a cast strictly inside the stun is filtered the same way", () => {
    const t = timeline({
      ownerCDs: [
        ledgerEntry("33206", "Pain Suppression", 180, [44]),
        ledgerEntry("19236", "Desperate Prayer", 90, []),
      ],
      cc: [hoj(42.494, 6)],
    });
    const line = lineWith(t, "[YOU] [CD]", "Pain Suppression");
    expect(line).toContain("[while stunned: Hammer of Justice]");
    expect(line).not.toContain("cheaper available");
  });

  it("a cast after the stun ran out keeps every alternative and adds no note", () => {
    const t = timeline({
      ownerCDs: ledger,
      ownerCasts: [castSuccess(DIVINE_SHIELD, "Divine Shield", 45_287)],
      cc: [hoj(38, 6)],
    });
    expect(lineWith(t, "[YOU] [CD]", "Divine Shield")).toContain(
      "cheaper available: Blessing of Spellwarding, Divine Protection",
    );
    expect(lineWith(t, "[CC ON TEAM]", "Hammer of Justice")).not.toContain(
      "broke this CC",
    );
  });
});

describe("a cast just before the stun lands", () => {
  it("is not a stunned cast: the alternatives were pressable", () => {
    const t = timeline({
      ownerCDs: [
        ledgerEntry(DIVINE_SHIELD, "Divine Shield", 210, [42.3]),
        ledgerEntry(SPELLWARDING, "Blessing of Spellwarding", 180, []),
        ledgerEntry(DIVINE_PROTECTION, "Divine Protection", 60, []),
      ],
      cc: [hoj(42.494, 6)],
    });
    expect(lineWith(t, "[YOU] [CD]", "Divine Shield")).toContain(
      "cheaper available: Blessing of Spellwarding, Divine Protection",
    );
  });
});

describe("immunityBreak", () => {
  const player = (spellId: string, t: number, destUnitId?: string) => ({
    id: "o",
    spellCastEvents: [
      {
        ...castSuccess(spellId, "x", t),
        ...(destUnitId ? { destUnitId } : {}),
      },
    ] as never,
  });
  const stun = { atSeconds: 42.494, durationSeconds: 2.792 };

  it("binds an immunity cast at the CC's removal", () => {
    expect(immunityBreak(stun, 0, player(DIVINE_SHIELD, 45_287))?.spellId).toBe(
      DIVINE_SHIELD,
    );
  });

  it("ignores an immunity pressed mid-CC when the CC ran on", () => {
    expect(immunityBreak(stun, 0, player("31224", 43_500))).toBeNull();
  });

  it("an immunity thrown on a teammate ended nothing of the caster's", () => {
    expect(immunityBreak(stun, 0, player("1022", 45_287, "mate"))).toBeNull();
    expect(immunityBreak(stun, 0, player("1022", 45_287, "o"))?.spellId).toBe(
      "1022",
    );
  });

  it("a press right after the CC ran out on its own did not break it", () => {
    // 45.286 is the removal; the purge signature is 0–10 ms
    expect(immunityBreak(stun, 0, player(DIVINE_SHIELD, 45_296))?.spellId).toBe(
      DIVINE_SHIELD,
    );
    expect(immunityBreak(stun, 0, player(DIVINE_SHIELD, 45_315))).toBeNull();
    expect(immunityBreak(stun, 0, player("31224", 45_320))).toBeNull();
  });

  it("a press before a very short CC landed did not end it", () => {
    const blip = { atSeconds: 10, durationSeconds: 0.005 };
    expect(immunityBreak(blip, 0, player(DIVINE_SHIELD, 9_998))).toBeNull();
    expect(immunityBreak(blip, 0, player(DIVINE_SHIELD, 10_006))?.spellId).toBe(
      DIVINE_SHIELD,
    );
  });

  it("ignores a cast past the tolerance, and a non-immunity", () => {
    expect(immunityBreak(stun, 0, player(DIVINE_SHIELD, 45_400))).toBeNull();
    expect(
      immunityBreak(stun, 0, player(DIVINE_PROTECTION, 45_287)),
    ).toBeNull();
  });
});

describe("findCheaperDefensiveAlternatives stunnedCaster", () => {
  it("keeps only buttons usable while stunned", () => {
    const cds = [
      ledgerEntry(DIVINE_SHIELD, "Divine Shield", 210, []),
      ledgerEntry(SPELLWARDING, "Blessing of Spellwarding", 180, []),
      ledgerEntry(DIVINE_PROTECTION, "Divine Protection", 60, []),
    ];
    expect(findCheaperDefensiveAlternatives(cds[0]!, cds, 30)).toEqual([
      "Blessing of Spellwarding",
      "Divine Protection",
    ]);
    expect(
      findCheaperDefensiveAlternatives(cds[0]!, cds, 30, {
        stunnedCaster: { pvpTalentIds: new Set() },
      }),
    ).toEqual(["Divine Protection"]);
  });
});

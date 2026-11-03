/* eslint-disable @typescript-eslint/no-explicit-any -- hand-built parse fixtures */
/**
 * fact9 (F24) class 5 — whose miss / landing a row is:
 *  - D24: a press's miss row logged under the caster's summon (a Hunter's
 *    pet carries Intimidation's stun) is the press's — the cast line says
 *    `[IMMUNE …]`, not `[no CC aura logged]`;
 *  - D25: an aimed control's landing is its OWN aura — a Freezing Trap
 *    2.4 s after a Scatter Shot is not the Scatter Shot's;
 *  - D28: a Grounding Totem IMMUNE logged 1 ms before its cast row is that
 *    cast's redirect, one `[GROUNDED]`, not two.
 * (D15 is in externalDamage.test.ts; D29 / D31 in the parser's
 * l3.nilAttackerAbsorbs.test.ts.)
 */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src";
import {
  buildMatchTimeline,
  type BuildMatchTimelineParams,
} from "../src/context/matchTimeline";
import { groundingRedirects } from "../src/utils/groundingRedirects";

beforeAll(async () => {
  await ensureAnalysisData();
});

const END_MS = 180_000;
const ms = (s: number) => Math.round(s * 1000);

function mkUnit(
  id: string,
  name: string,
  overrides: Partial<ICombatUnit> = {},
): ICombatUnit {
  return {
    id,
    name,
    ownerId: "",
    isWellFormed: true,
    type: CombatUnitType.Player,
    class: CombatUnitClass.Hunter,
    spec: CombatUnitSpec.Hunter_Survival,
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
    missesIn: [],
    missesOut: [],
    ...overrides,
  };
}
const row = (
  event: LogEvent,
  spellId: string,
  spellName: string,
  src: ICombatUnit | { id: string; name: string },
  dest: { id: string; name: string },
  atS: number,
  extra: Record<string, unknown> = {},
): any => ({
  spellId,
  spellName,
  srcUnitId: src.id,
  srcUnitName: src.name,
  destUnitId: dest.id,
  destUnitName: dest.name,
  timestamp: ms(atS),
  logLine: { event, timestamp: ms(atS), parameters: [] },
  ...extra,
});

const OWNER = { id: "o", name: "Me-Realm" };
const PET = { id: "pet", name: "Reptar" };
const ENEMY = { id: "e", name: "Enemy-Realm" };

function ownerCcLines(opts: {
  spellId: string;
  spellName: string;
  atS: number;
  owner?: Partial<ICombatUnit>;
  pet?: Partial<ICombatUnit>;
  enemy?: Partial<ICombatUnit>;
}): string[] {
  const owner = mkUnit(OWNER.id, OWNER.name, {
    spellCastEvents: [
      row(
        LogEvent.SPELL_CAST_SUCCESS,
        opts.spellId,
        opts.spellName,
        OWNER,
        ENEMY,
        opts.atS,
      ),
    ],
    ...opts.owner,
  });
  const pet = mkUnit(PET.id, PET.name, {
    type: CombatUnitType.Pet,
    ownerId: OWNER.id,
    ...opts.pet,
  });
  const enemy = mkUnit(ENEMY.id, ENEMY.name, {
    reaction: CombatUnitReaction.Hostile,
    class: CombatUnitClass.Evoker,
    spec: CombatUnitSpec.Evoker_Preservation,
    ...opts.enemy,
  });
  const params: BuildMatchTimelineParams = {
    owner,
    ownerSpec: "Hunter_Survival",
    ownerCDs: [
      {
        spellId: opts.spellId,
        spellName: opts.spellName,
        tag: "CC",
        cooldownSeconds: 30,
        maxChargesDetected: 1,
        casts: [{ timeSeconds: opts.atS, targetName: ENEMY.name }],
        availableWindows: [],
        neverUsed: false,
      },
    ] as never,
    teammateCDs: [],
    enemyCDTimeline: { players: [], alignedBurstWindows: [] },
    ccTrinketSummaries: [],
    dispelSummary: {
      allyCleanse: [],
      ourPurges: [],
      hostilePurges: [],
      missedCleanseWindows: [],
      lateCleanseWindows: [],
      ccEfficiency: [],
      missedPurgeWindows: [],
    },
    enemyCCSummaries: [] as never,
    friendlyDeaths: [],
    enemyDeaths: [],
    pressureWindows: [],
    healingGaps: [],
    friends: [owner],
    enemies: [enemy],
    allUnits: [owner, pet, enemy],
    matchStartMs: 0,
    matchEndMs: END_MS,
    isHealer: false,
    criticalWindowSeconds: new Set<number>(),
  };
  return buildMatchTimeline(params)
    .split("\n")
    .filter((l) => l.includes("[YOU] [CC]"));
}

describe("fact9 D24 — a pet's miss row is its owner's press's", () => {
  it("Intimidation's IMMUNE logged under the pet tags the owner's cast line", () => {
    const [line] = ownerCcLines({
      spellId: "19577",
      spellName: "Intimidation",
      atS: 76.998,
      pet: {
        missesOut: [
          row(
            LogEvent.SPELL_MISSED,
            "24394",
            "Intimidation",
            PET,
            ENEMY,
            76.998,
            {
              missType: "IMMUNE",
              amount: 0,
            },
          ),
        ],
      },
    });
    expect(line).toContain("Intimidation");
    expect(line).toContain("[IMMUNE");
    expect(line).not.toContain("no CC aura logged");
  });
  it("…and with no miss row anywhere the line still says no aura was logged", () => {
    const [line] = ownerCcLines({
      spellId: "19577",
      spellName: "Intimidation",
      atS: 76.998,
    });
    expect(line).toContain("[no CC aura logged");
  });
});

describe("fact9 D25 — an aimed control's landing is its own aura", () => {
  const trap = row(
    LogEvent.SPELL_AURA_APPLIED,
    "3355",
    "Freezing Trap",
    OWNER,
    ENEMY,
    103.044,
    { auraType: "DEBUFF" },
  );
  it("a Freezing Trap 2.4 s after a Scatter Shot is not the Scatter Shot's landing", () => {
    const [line] = ownerCcLines({
      spellId: "213691",
      spellName: "Scatter Shot",
      atS: 100.647,
      enemy: { auraEvents: [trap] },
    });
    expect(line).toContain("Scatter Shot");
    expect(line).toContain("[no CC aura logged");
  });
  it("…its own aura is", () => {
    const [line] = ownerCcLines({
      spellId: "213691",
      spellName: "Scatter Shot",
      atS: 100.647,
      enemy: {
        auraEvents: [
          row(
            LogEvent.SPELL_AURA_APPLIED,
            "213691",
            "Scatter Shot",
            OWNER,
            ENEMY,
            100.8,
            { auraType: "DEBUFF" },
          ),
          trap,
        ],
      },
    });
    expect(line).not.toContain("no CC aura logged");
  });
});

describe("fact9 D28 — a Grounding IMMUNE logged just before its cast row", () => {
  const TOTEM = {
    id: "Creature-0-1-1-1-5925-000000000A",
    name: "Grounding Totem",
  };
  it("is the cast's redirect: one, not two", () => {
    const warlock = mkUnit("w", "Lock-Realm", {
      spellCastEvents: [
        row(
          LogEvent.SPELL_CAST_SUCCESS,
          "5782",
          "Fear",
          { id: "w", name: "Lock-Realm" },
          TOTEM,
          116.414,
        ),
      ],
      missesOut: [
        row(
          LogEvent.SPELL_MISSED,
          "118699",
          "Fear",
          { id: "w", name: "Lock-Realm" },
          TOTEM,
          116.413,
          {
            missType: "IMMUNE",
            amount: 0,
          },
        ),
      ],
    });
    const r = groundingRedirects(warlock);
    expect(r).toHaveLength(1);
    expect(r[0]!.via).toBe("cast");
  });
  it("…a miss 0.2 s before any cast stays a redirect of its own", () => {
    const warlock = mkUnit("w", "Lock-Realm", {
      spellCastEvents: [
        row(
          LogEvent.SPELL_CAST_SUCCESS,
          "5782",
          "Fear",
          { id: "w", name: "Lock-Realm" },
          TOTEM,
          116.414,
        ),
      ],
      missesOut: [
        row(
          LogEvent.SPELL_MISSED,
          "118699",
          "Fear",
          { id: "w", name: "Lock-Realm" },
          TOTEM,
          116.2,
          {
            missType: "IMMUNE",
            amount: 0,
          },
        ),
      ],
    });
    expect(groundingRedirects(warlock)).toHaveLength(2);
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  CombatUnitType,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { buildMatchTimeline } from "../src/context/matchTimeline";
import { ensureAnalysisData } from "../src/data/ensure";
import { formatDampeningForContext } from "../src/utils/dampening";
import { makeAuraEvent, makeUnit } from "./ported/testHelpers";

/**
 * FT-T13 — what one 2v2 prompt says about dampening before and after the
 * round's first logged stack.
 *
 * D10: the header, the alerts, `[MATCH END]`, the `[YOU] [CD]` notes and both
 * `[DEATH]` families read ONE classification of the bracket. Three of them
 * used to classify on a unit list that carried pets, so a healer 2v2 with a
 * pet out printed `started at 30%` in the header and `dampening: 10%` on the
 * press lines before the first stack (159 of 516 prompts / 220 lines of the
 * 605-file capture).
 */

const START = 1_000_000;
const ms = (s: number) => START + s * 1000;
const END_S = 120;
const FIRST_STACK_S = 11;

/** Dampening stacks 42 at 0:11, +1 every 10 s — the shape the log prints in
 * a 2v2 round with a healer on both teams. */
function doses(): any[] {
  const out: any[] = [];
  for (let i = 0; FIRST_STACK_S + i * 10 <= END_S; i++) {
    const e = makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED_DOSE,
      "110310",
      ms(FIRST_STACK_S + i * 10),
      "h",
      "h",
    );
    (e.logLine as any).parameters[12] = 42 + i;
    out.push(e);
  }
  return out;
}

function round() {
  const owner = makeUnit("PlayerYou", {
    spec: CombatUnitSpec.Shaman_Restoration,
    info: { teamId: "0" },
    auraEvents: doses(),
  });
  const alice = makeUnit("Alice", {
    spec: CombatUnitSpec.Hunter_BeastMastery,
    info: { teamId: "0" },
    auraEvents: doses(),
  });
  const enemyHealer = makeUnit("Enemy1", {
    spec: CombatUnitSpec.Druid_Restoration,
    reaction: CombatUnitReaction.Hostile,
    info: { teamId: "1" },
    auraEvents: doses(),
  });
  const enemyDps = makeUnit("Enemy2", {
    spec: CombatUnitSpec.Mage_Frost,
    reaction: CombatUnitReaction.Hostile,
    info: { teamId: "1" },
    auraEvents: doses(),
  });
  // Alice's pet and a totem: units of the round, not players
  const pet = {
    ...makeUnit("AlicePet", { ownerId: "Alice" }),
    type: CombatUnitType.Pet,
  };
  const totem = {
    ...makeUnit("Totem", { ownerId: "PlayerYou" }),
    type: CombatUnitType.Guardian,
  };
  return { owner, alice, enemyHealer, enemyDps, pet, totem };
}

const astralShift = {
  spellId: "108271",
  spellName: "Astral Shift",
  tag: "Defensive",
  cooldownSeconds: 90,
  maxChargesDetected: 1,
  // one press before the first logged stack, one after
  casts: [{ timeSeconds: 4 }, { timeSeconds: 17 }],
  availableWindows: [],
  neverUsed: false,
};

function renderTimeline(): string[] {
  const { owner, alice, enemyHealer, enemyDps, pet, totem } = round();
  const empty = {
    allyCleanse: [],
    ourPurges: [],
    hostilePurges: [],
    missedCleanseWindows: [],
    missedPurgeWindows: [],
  } as any;
  return buildMatchTimeline({
    owner,
    ownerSpec: "Restoration Shaman",
    ownerCDs: [astralShift] as any,
    teammateCDs: [],
    enemyCDTimeline: { players: [], alignedBurstWindows: [] } as any,
    ccTrinketSummaries: [],
    dispelSummary: empty,
    enemyDispelSummary: empty,
    enemyCCSummaries: [],
    friendlyDeaths: [
      { spec: "Beast Mastery Hunter", name: "Alice", atSeconds: 30 },
    ],
    enemyDeaths: [{ spec: "Frost Mage", name: "Enemy2", atSeconds: 8 }],
    pressureWindows: [],
    healingGaps: [],
    friends: [owner, alice],
    enemies: [enemyHealer, enemyDps],
    // the round's whole unit list — pets included, as buildMatchContext passes it
    allUnits: [owner, alice, enemyHealer, enemyDps, pet, totem] as any,
    matchStartMs: START,
    matchEndMs: ms(END_S),
    isHealer: true,
    playerIdMap: new Map([
      ["PlayerYou", 1],
      ["Alice", 2],
    ]),
    enemyIdMap: new Map([
      ["Enemy1", 3],
      ["Enemy2", 4],
    ]),
    outgoingCCChains: [],
    bracket: "2v2",
    criticalWindowSeconds: new Set<number>(),
  }).split("\n");
}

function header(): string[] {
  const { owner, alice, enemyHealer, enemyDps } = round();
  return formatDampeningForContext(
    "2v2",
    [owner, alice, enemyHealer, enemyDps] as any,
    START,
    ms(END_S),
  );
}

const lineOf = (lines: string[], re: RegExp) => lines.find((l) => re.test(l));

describe("FT-T13 D10: one 2v2 prompt states one dampening start", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("the header, the alert, the press line and the [DEATH] line before the first stack carry the same number", () => {
    const lines = renderTimeline();
    expect(header()[0]).toBe(
      "DAMPENING (2v2): started at 30%, ended at 52% at match end",
    );
    expect(lines).toContain("0:00  [DAMPENING ALERT: 30%]");
    expect(lineOf(lines, /^0:04 {2}\[YOU\] \[CD\] .*Astral Shift/)).toMatch(
      / \| dampening: 30%/,
    );
    expect(lineOf(lines, /^0:08 {2}\[DEATH\]/)).toMatch(/ \| dampening: 30%$/);
  });

  it("after the first stack every line reads the logged value", () => {
    const lines = renderTimeline();
    expect(lineOf(lines, /^0:17 {2}\[YOU\] \[CD\] .*Astral Shift/)).toMatch(
      / \| dampening: 42%/,
    );
    expect(lineOf(lines, /^0:30 {2}\[DEATH\]/)).toMatch(/ \| dampening: 43%$/);
    expect(lineOf(lines, /\[MATCH END\]/)).toMatch(/damp: 52%/);
  });
});

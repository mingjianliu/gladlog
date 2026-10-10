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
 * 605-file capture). The round below carries a pet and a totem in `allUnits`
 * for that reason.
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

function renderTimeline(
  over: { bracket?: string; pressureWindows?: any[] } = {},
): string[] {
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
    pressureWindows: over.pressureWindows ?? [],
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
    bracket: over.bracket ?? "2v2",
    criticalWindowSeconds: new Set<number>(),
  }).split("\n");
}

function header(bracket = "2v2"): string[] {
  const { owner, alice, enemyHealer, enemyDps } = round();
  return formatDampeningForContext(
    bracket,
    [owner, alice, enemyHealer, enemyDps] as any,
    START,
    ms(END_S),
  );
}

const lineOf = (lines: string[], re: RegExp) => lines.find((l) => re.test(l));
/** the timeline lines stamped before `s` seconds */
const stampedBefore = (lines: string[], s: number) =>
  lines.filter((l) => {
    const m = l.match(/^(\d+):(\d{2})\s/);
    return m !== null && Number(m[1]) * 60 + Number(m[2]) < s;
  });
const DAMPENING_NUMBER = /dampening: \d+%|DAMPENING ALERT|damp: \d+%/;
const SPIKE_LEGEND = "`next spike in Ns on X` on a [YOU] [CD] line";

/**
 * D11 (re-opens the signed O10 of 2026-09-30): the log never prints a value
 * before the first stack, and the first stack reads 42 in 258 of 258 2v2
 * rounds with two healers (22 in 32 of 32 of the other kind) — so the old
 * `started at 30%` was wrong and an extrapolated 41 would be a number the log
 * never prints. Before the first logged stack a 2v2 prompt states NO number.
 * (Under WP-H 1 alone every line below read 30%: header, 0:00 alert, the 0:04
 * press line and the 0:08 [DEATH] line.)
 */
describe("FT-T13 D10 + D11: one 2v2 prompt, no dampening number before the first logged stack", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("the header names the first logged stack and its second instead of a start value", () => {
    expect(header()[0]).toBe(
      "DAMPENING (2v2): first logged at 42% (0:11; the log prints no value before that), ended at 52% at match end",
    );
  });

  it("no line stamped before the first stack carries a dampening number — press line, [DEATH] line, alert", () => {
    const lines = renderTimeline();
    const before = stampedBefore(lines, FIRST_STACK_S);
    // the lines are there …
    expect(
      lineOf(before, /^0:04 {2}\[YOU\] \[CD\] .*Astral Shift/),
    ).toBeTruthy();
    expect(lineOf(before, /^0:08 {2}\[DEATH\]/)).toBeTruthy();
    // … and none of them states a number
    expect(before.filter((l) => DAMPENING_NUMBER.test(l))).toEqual([]);
    expect(lines).not.toContain("0:00  [DAMPENING ALERT: 30%]");
  });

  it("the 30% alert sits at the second of the first logged stack at or above 30", () => {
    const lines = renderTimeline();
    expect(lines.filter((l) => l.includes("[DAMPENING ALERT: 30%]"))).toEqual([
      "0:11  [DAMPENING ALERT: 30%]",
    ]);
    // 50% is crossed by the stack at 91 s (42 + 8), as before
    expect(lines).toContain("1:31  [DAMPENING ALERT: 50%]");
  });

  it("after the first stack every line reads the logged value (unchanged)", () => {
    const lines = renderTimeline();
    expect(lineOf(lines, /^0:17 {2}\[YOU\] \[CD\] .*Astral Shift/)).toMatch(
      / \| dampening: 42%/,
    );
    expect(lineOf(lines, /^0:30 {2}\[DEATH\]/)).toMatch(/ \| dampening: 43%$/);
    expect(lineOf(lines, /\[MATCH END\]/)).toMatch(/damp: 52%/);
  });

  it("the hindsight spike note survives without the dampening half, and keeps its legend", () => {
    const spike = {
      fromSeconds: 9,
      toSeconds: 14,
      totalDamage: 500_000,
      targetName: "Alice",
      targetSpec: "Beast Mastery Hunter",
    };
    const lines = renderTimeline({ pressureWindows: [spike] });
    const press = lineOf(lines, /^0:04 {2}\[YOU\] \[CD\] .*Astral Shift/)!;
    expect(press).toMatch(/ \| next spike in 5s on 2/);
    expect(press).not.toMatch(/dampening/);
    expect(lines.join("\n")).toContain(SPIKE_LEGEND);
  });

  it("3v3 is untouched: the same round under the 3v3 rules states 10% from 0:00", () => {
    expect(header("3v3")[0]).toBe(
      "DAMPENING (3v3): started at 10%, ended at 52% at match end",
    );
    const lines = renderTimeline({ bracket: "3v3" });
    expect(lineOf(lines, /^0:04 {2}\[YOU\] \[CD\] .*Astral Shift/)).toMatch(
      / \| dampening: 10%/,
    );
    expect(lineOf(lines, /^0:08 {2}\[DEATH\]/)).toMatch(/ \| dampening: 10%$/);
    expect(lines).toContain("0:11  [DAMPENING ALERT: 30%]");
  });
});

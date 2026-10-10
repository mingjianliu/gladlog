/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * FT-T09: what a `[CC ON ENEMY]` line says about its length and its end —
 * `<1s`, a control the round ended on, and the target's own press (the PvP
 * trinket ends every control on them, not only the one the
 * `[ENEMY TRINKET]` line names).
 */
import { CombatUnitReaction, LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { buildMatchTimeline } from "../src/context/matchTimeline";
import { MEDALLION_SPELL_ID } from "../src/utils/pvpTrinketUses";
import { makeUnit } from "./ported/testHelpers";

const HOJ = "853";
const FEAR = "5782";
const aura = (event: LogEvent, spellId: string, ms: number) =>
  ({
    logLine: { event, timestamp: ms, parameters: [] },
    timestamp: ms,
    spellId,
    srcUnitId: "o",
    srcUnitName: "Me",
    destUnitId: "e",
    destUnitName: "Enemy",
  }) as any;
const cc = (
  spellId: string,
  spellName: string,
  atSeconds: number,
  durationSeconds: number,
  over: Record<string, unknown> = {},
) => ({
  atSeconds,
  durationSeconds,
  spellId,
  spellName,
  sourceName: "Me",
  sourceId: "o",
  trinketState: "available_unused",
  ...over,
});

function render(ccInstances: unknown[], pressMs: number | null) {
  const owner = makeUnit("o", { name: "Me" });
  const mate = makeUnit("m", { name: "Mate" });
  const enemy = makeUnit("e", {
    name: "Enemy",
    reaction: CombatUnitReaction.Hostile,
    auraEvents: [
      aura(LogEvent.SPELL_AURA_APPLIED, HOJ, 10_000),
      aura(LogEvent.SPELL_AURA_APPLIED, FEAR, 11_600),
      aura(LogEvent.SPELL_AURA_REMOVED, HOJ, 12_000),
      aura(LogEvent.SPELL_AURA_REMOVED, FEAR, 12_000),
      // a later Fear that runs its course
      aura(LogEvent.SPELL_AURA_APPLIED, FEAR, 40_100),
      aura(LogEvent.SPELL_AURA_REMOVED, FEAR, 44_100),
    ],
    spellCastEvents:
      pressMs === null
        ? []
        : [
            {
              logLine: {
                event: LogEvent.SPELL_CAST_SUCCESS,
                timestamp: pressMs,
                parameters: [],
              },
              timestamp: pressMs,
              spellId: MEDALLION_SPELL_ID,
              srcUnitId: "e",
              destUnitId: "0000000000000000",
            } as any,
          ],
  });
  const emptyDispels = {
    allyCleanse: [],
    ourPurges: [],
    hostilePurges: [],
    missedCleanseWindows: [],
    missedPurgeWindows: [],
  } as any;
  return buildMatchTimeline({
    owner,
    ownerSpec: "Fury Warrior",
    ownerCDs: [],
    teammateCDs: [],
    enemyCDTimeline: { players: [], alignedBurstWindows: [] } as any,
    ccTrinketSummaries: [],
    enemyCCSummaries: [
      {
        playerName: "Enemy",
        trinketUseTimes: pressMs === null ? [] : [pressMs / 1000],
        trinketCooldownSeconds: 120,
        ccInstances,
      },
    ] as never,
    dispelSummary: emptyDispels,
    enemyDispelSummary: emptyDispels,
    friendlyDeaths: [],
    enemyDeaths: [],
    pressureWindows: [],
    healingGaps: [],
    friends: [owner, mate],
    enemies: [enemy],
    allUnits: [owner, mate, enemy],
    matchStartMs: 0,
    matchEndMs: 60_000,
    isHealer: false,
    outgoingCCChains: [],
    criticalWindowSeconds: new Set<number>(),
  } as any)
    .split("\n")
    .filter((l) => l.includes("[CC ON ENEMY]"));
}

describe("[CC ON ENEMY] — length and end (FT-T09)", () => {
  it("one trinket press ended both controls: both lines say so, not only the bound one", () => {
    const lines = render(
      [
        cc(HOJ, "Hammer of Justice", 10, 2, { trinketState: "used" }),
        cc(FEAR, "Fear", 11.6, 0.4),
      ],
      12_001,
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(
      /← Hammer of Justice \(by \S+\) \(2s\) \| ended by their PvP trinket$/,
    );
    expect(lines[1]).toMatch(
      /← Fear \(by \S+\) \(<1s\) \| ended by their PvP trinket$/,
    );
  });

  it("a control that ran its course says nothing; one bound to a press made before it landed neither", () => {
    // the binder takes a control landing up to 250 ms after the press; the press did not end it
    const lines = render(
      [cc(FEAR, "Fear", 40.1, 4, { trinketState: "used" })],
      40_000,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/← Fear \(by \S+\) \(4s\)$/);
    expect(render([cc(FEAR, "Fear", 40.1, 4)], null)[0]).toMatch(
      /← Fear \(by \S+\) \(4s\)$/,
    );
  });

  it("a control the round ended on prints the time to the round's end, as that", () => {
    const lines = render(
      [cc(FEAR, "Fear", 57.3, 2.7, { stillOnAtRoundEnd: true })],
      null,
    );
    expect(lines[0]).toMatch(
      /← Fear \(by \S+\) \(still on them when the round ended, 3s in\)$/,
    );
  });
});

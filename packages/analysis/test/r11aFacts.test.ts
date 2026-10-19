/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * fact1215 R11 (the fact half): the [RES] cc: slot names the control that
 * holds the unit longest (1120cb61 0:18); an empowered cast's dispel comes
 * with its release (34204ef9 Fire Breath); Dampening is read on the line's
 * own team (3867e9ef: the teams tick one stack apart).
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { buildResourceSnapshot } from "../src/context/resourceSnapshot";
import { ensureAnalysisData } from "../src/data/ensure";
import { getDampeningPercentage } from "../src/utils/dampening";
import { buildCastMatchIndex, classifyDispel } from "../src/utils/dispelKind";

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("[RES] cc: the control that holds the unit longest", () => {
  it("1120cb61 0:18: Blinding Sleet to 18.36, Capacitor Totem's stun to 20.30, Shockwave to 18.49 → the stun", () => {
    const cc = (spellName: string, atSeconds: number, toS: number) => ({
      spellId: "1",
      spellName,
      atSeconds,
      durationSeconds: toS - atSeconds,
    });
    const text = buildResourceSnapshot({
      timeSeconds: 18,
      ownerCDs: [],
      ownerName: "Druid",
      ownerSpec: "Restoration Druid",
      teammateCDs: [],
      ccTrinketSummaries: [
        {
          playerName: "Druid",
          ccInstances: [
            cc("Blinding Sleet", 14.349, 18.364),
            cc("Static Charge", 17.29, 20.3),
            cc("Shockwave", 17.468, 18.485),
          ],
          trinketUseTimes: [],
          rootInstances: [],
        },
      ],
      enemyCDTimeline: { players: [], alignedBurstWindows: [] },
      playerIdMap: new Map([["Druid", 1]]),
      matchStartMs: 0,
    } as any);
    expect(text).toContain("cc:1/Static Charge-");
    expect(text).not.toContain("Blinding Sleet");
  });
});

describe("an empowered cast's dispel comes with its release", () => {
  it("Fire Breath held 1.14 s: its dispel at the release is the cast's, not a passive one", () => {
    const T = 1_000_000;
    const unit = {
      id: "E",
      spellCastEvents: [
        {
          spellId: "357208",
          spellName: "Fire Breath",
          timestamp: T,
          logLine: { event: LogEvent.SPELL_CAST_SUCCESS },
        },
      ],
      empowerEnds: [
        { spellId: "357208", spellName: "Fire Breath", timestamp: T + 1100 },
      ],
    };
    const d = {
      srcUnitId: "E",
      spellId: "357208",
      spellName: "Fire Breath",
      timestamp: T + 1138,
    };
    expect(classifyDispel(buildCastMatchIndex([unit]), d)).toBe("deliberate");
    expect(
      classifyDispel(buildCastMatchIndex([{ ...unit, empowerEnds: [] }]), d),
    ).toBe("proc");
  });
});

describe("Dampening on the line's own team", () => {
  it("3867e9ef 1:14: owner side 16 at .262, enemy side 17 at .668", () => {
    const dose = (stacks: number, ts: number) => ({
      spellId: "110310",
      timestamp: ts,
      logLine: {
        event: "SPELL_AURA_APPLIED_DOSE",
        timestamp: ts,
        parameters: Object.assign([], { 12: stacks }),
      },
    });
    const mine = [{ id: "A", auraEvents: [dose(16, 74_262)] }] as any;
    const theirs = [{ id: "B", auraEvents: [dose(17, 74_668)] }] as any;
    const roster = [...mine, ...theirs];
    expect(getDampeningPercentage("3v3", mine, 75_000, roster)).toBe(16);
    expect(getDampeningPercentage("3v3", theirs, 75_000, roster)).toBe(17);
    // the round-wide reading was the latest dose of either team
    expect(getDampeningPercentage("3v3", roster, 75_000)).toBe(17);
  });
});

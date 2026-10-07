/**
 * B-tier B14a (user ruling 2026-10-06, "够不着就不列"): on the [RES] row
 * under a friendly death, a positional cooldown whose holder stood out of its
 * reach of the dying player is not `rdy:` — the predicate cd-hoarded and
 * [DEFENSIVE AVAILABLE] already read (`positionalWallReaches`, A58 / F-MC1).
 * 4446729d 1:31: the Hunter died with the owner's Darkness (an 8 yd zone)
 * "rdy" 21–28 yd away.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, describe, expect, it } from "vitest";

import {
  buildResourceSnapshot,
  positionalOutOfReachNames,
} from "../src/context/resourceSnapshot";
import { ensureAnalysisData } from "../src/data/ensure";
import type { IMajorCooldownInfo } from "../src/utils/cooldowns";
import {
  positionalWallReach,
  positionalWallReaches,
} from "../src/utils/deathOutcomeAnalysis";
import { makeAdvancedAction, makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const DEATH_S = 91;
const cd = (spellId: string, spellName: string): IMajorCooldownInfo => ({
  spellId,
  spellName,
  tag: "Defensive",
  cooldownSeconds: 180,
  maxChargesDetected: 1,
  casts: [],
  availableWindows: [],
  neverUsed: true,
});
const DARKNESS = cd("196718", "Darkness"); // positional (MITIGATION_TABLE)
const BLUR = cd("198589", "Blur");
/** a unit standing at (x, 0) through the death */
const standing = (id: string, name: string, x: number): any =>
  makeUnit(id, {
    name,
    advancedActions: [88, 89, 90, 91, 92].map((s) =>
      makeAdvancedAction(T0 + s * 1000, x, 0),
    ),
  } as any);
const victim = standing("v", "Hunter-R", 0);
const row = (
  ownerX: number,
  extra: Partial<Parameters<typeof buildResourceSnapshot>[0]> = {},
) =>
  buildResourceSnapshot({
    timeSeconds: DEATH_S,
    ownerCDs: [BLUR, DARKNESS],
    ownerName: "Havoc-R",
    ownerSpec: "Havoc Demon Hunter",
    teammateCDs: [],
    ccTrinketSummaries: [],
    enemyCDTimeline: { players: [], alignedBurstWindows: [] },
    matchStartMs: T0,
    ownerUnit: standing("o", "Havoc-R", ownerX),
    outOfReachOf: { victim, atMs: T0 + DEATH_S * 1000 },
    ...extra,
  });

describe("[RES] under a friendly death: positional cooldowns out of reach (B14a)", () => {
  it("25 yd from the dying player: Darkness leaves rdy:, the non-positional Blur stays, and Darkness is not on cd: either", () => {
    const line = row(25);
    expect(line).toContain("rdy:Blur");
    expect(line).not.toContain("Darkness");
  });

  it("5 yd away it is ready as before; without the death context nothing is dropped", () => {
    expect(row(5)).toContain("rdy:Blur,Darkness");
    expect(row(25, { outOfReachOf: undefined })).toContain("rdy:Blur,Darkness");
  });

  it("the dying player's own Darkness is untouched", () => {
    const line = buildResourceSnapshot({
      timeSeconds: DEATH_S,
      ownerCDs: [BLUR, DARKNESS],
      ownerName: "Hunter-R",
      ownerSpec: "Havoc Demon Hunter",
      teammateCDs: [],
      ccTrinketSummaries: [],
      enemyCDTimeline: { players: [], alignedBurstWindows: [] },
      matchStartMs: T0,
      ownerUnit: victim,
      outOfReachOf: { victim, atMs: T0 + DEATH_S * 1000 },
    });
    expect(line).toContain("rdy:Blur,Darkness");
  });

  it("a teammate's positional cooldown is judged from the teammate's position, under its label", () => {
    const mate = standing("m", "Mate-R", 30);
    const far = positionalOutOfReachNames(
      standing("o", "Havoc-R", 2),
      [BLUR, DARKNESS],
      [{ player: mate, cds: [DARKNESS], playerLabel: "2" }],
      { victim, atMs: T0 + DEATH_S * 1000 },
    );
    expect([...far]).toEqual(["2:Darkness"]);
  });

  it("a missing position sample drops nothing: the row only loses a cooldown the log shows was out of reach", () => {
    const noSamples: any = makeUnit("o", { name: "Havoc-R" } as any);
    expect(row(0, { ownerUnit: noSamples })).toContain("Darkness");
    // the accusation-side predicate still fails closed on the same input
    expect(
      positionalWallReaches("196718", noSamples, victim, T0 + DEATH_S * 1000),
    ).toBe(false);
    expect(
      positionalWallReach("196718", noSamples, victim, T0 + DEATH_S * 1000),
    ).toBe("unknown");
  });

  it("a delta row is never filtered — the drop would print as a spent cooldown", () => {
    const line = row(25, { prevReadyNames: ["Blur", "Darkness"] });
    expect(line).not.toContain("-Darkness");
  });
});

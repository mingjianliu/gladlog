/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * fact10 (cover set, resEnemyDuplicateWindow): an activation of a cooldown's
 * effect is that cooldown's `[RES]` window. Chosen of Frostbrood's free
 * Frostwyrm's Fury 1265384, 6 s into the first one's slow, refreshes the one
 * aura: the row lists `Frostwyrm's Fury/…` once (00e9d7bdc8 r1 1:52 listed it
 * twice).
 */
import { CombatUnitSpec } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { buildResourceSnapshot } from "../src/context/resourceSnapshot";
import { ensureAnalysisData } from "../src/data/ensure";
import { reconstructEnemyCDTimeline } from "../src/utils/enemyCDs";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

const START = 1_000_000;

function timeline() {
  const dk = makeUnit("e1", {
    name: "Knight",
    spec: CombatUnitSpec.DeathKnight_Frost,
    spellCastEvents: [
      makeSpellCastEvent(
        "279302",
        START + 105_000,
        "e1",
        "Knight",
        "p1",
        "Target",
      ),
      makeSpellCastEvent(
        "1265384",
        START + 111_000,
        "e1",
        "Knight",
        "p1",
        "Target",
      ),
    ],
  } as any);
  const combat = {
    startTime: START,
    endTime: START + 200_000,
    units: { e1: dk },
  } as any;
  return reconstructEnemyCDTimeline([dk], combat);
}

const enemyField = (tl: any, t: number) =>
  buildResourceSnapshot({
    timeSeconds: t,
    ownerCDs: [],
    ownerName: "Owner",
    ownerSpec: "Restoration Druid",
    teammateCDs: [],
    ccTrinketSummaries: [],
    enemyCDTimeline: tl,
    matchStartMs: START,
  }).match(/enemy:(.+)$/)?.[1];

describe("[RES] enemy: an effect activation is its cooldown's window", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("the press and its free recast both run; the row lists the cooldown once, with the later end", () => {
    const tl = timeline();
    expect(tl.players[0]!.offensiveCDs.map((c) => c.spellId)).toEqual([
      "279302",
      "1265384",
    ]);
    const field = enemyField(tl, 112)!;
    expect(field.match(/Frostwyrm's Fury\//g)).toHaveLength(1);
    const recast = tl.players[0]!.offensiveCDs[1]!;
    const left = Math.ceil(recast.buffEndSeconds - 112);
    expect(field).toContain(`(${left}s left)`);
  });
});

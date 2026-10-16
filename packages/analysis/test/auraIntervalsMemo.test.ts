import { CombatUnitReaction, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src";
import {
  buildAuraIntervals,
  buildAuraIntervalsUncached,
} from "../src/utils/auraIntervals";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

// The memo around `buildAuraIntervals` (2026-10-16): the same reading as the
// uncached function, a fresh array per call, and a new reading whenever one
// of the inputs the reading depends on changes under the same aura stream.

const T0 = 1_000_000;
const at = (s: number) => T0 + s * 1000;
const POLY = "118";
const HOJ = "853";

function fixture() {
  const mage = makeUnit("e1", {
    name: "Mage",
    reaction: CombatUnitReaction.Hostile,
    info: {},
    spellCastEvents: [makeSpellCastEvent(POLY, at(5), "p1", "Me", "e1", "Mage")],
  });
  const owner = makeUnit("p1", {
    name: "Me",
    reaction: CombatUnitReaction.Friendly,
    info: {},
    auraEvents: [
      makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, POLY, at(5), "e1", "p1"),
      makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, POLY, at(11), "e1", "p1"),
      makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, HOJ, at(20), "e1", "p1"),
      makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, HOJ, at(26), "e1", "p1"),
    ],
  });
  const combat = {
    startTime: T0,
    endTime: at(120),
    units: { p1: owner, e1: mage },
  };
  return { owner, mage, combat };
}

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("buildAuraIntervals — the memo holds to the uncached reading", () => {
  it("same intervals as the uncached function; the second call is a different array with the same objects", () => {
    const { owner, combat } = fixture();
    const plain = buildAuraIntervalsUncached(owner, combat);
    const first = buildAuraIntervals(owner, combat);
    const second = buildAuraIntervals(owner, combat);
    expect(first).toEqual(plain);
    expect(first).toHaveLength(2);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(second[0]).toBe(first[0]);
  });

  it("a caller that empties its copy does not touch the next caller's", () => {
    const { owner, combat } = fixture();
    const mine = buildAuraIntervals(owner, combat);
    mine.length = 0;
    expect(buildAuraIntervals(owner, combat)).toHaveLength(2);
  });

  it("an aura pushed onto the same stream, a cast pushed onto a caster, another window or another casters map each give a fresh reading", () => {
    const { owner, mage, combat } = fixture();
    expect(buildAuraIntervals(owner, combat)).toHaveLength(2);

    owner.auraEvents.push(
      makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, POLY, at(40), "e1", "p1") as never,
      makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, POLY, at(46), "e1", "p1") as never,
    );
    const grown = buildAuraIntervals(owner, combat);
    expect(grown).toHaveLength(3);
    expect(grown).toEqual(buildAuraIntervalsUncached(owner, combat));

    // a second Polymorph cast 1 s before the 40 s application: the reading
    // that asks the caster's casts changes, so the memo must not answer from
    // before the push
    mage.spellCastEvents.push(
      makeSpellCastEvent(POLY, at(39.5), "p1", "Me", "e1", "Mage") as never,
    );
    expect(buildAuraIntervals(owner, combat)).toEqual(
      buildAuraIntervalsUncached(owner, combat),
    );

    const shorter = { ...combat, endTime: at(8) };
    expect(buildAuraIntervals(owner, shorter)).toEqual(
      buildAuraIntervalsUncached(owner, shorter),
    );
    expect(buildAuraIntervals(owner, shorter)[0]!.toS).toBeLessThanOrEqual(8);

    const casters = new Map([["e1", mage]]);
    expect(buildAuraIntervals(owner, combat, casters)).toEqual(
      buildAuraIntervalsUncached(owner, combat, casters),
    );
  });

  it("two units sharing one aura stream are read apart", () => {
    const { owner, combat } = fixture();
    const twin = { ...owner, id: "p2" };
    expect(buildAuraIntervals(owner, combat)).toHaveLength(2);
    // nothing in the shared stream is on p2
    expect(buildAuraIntervals(twin, combat)).toEqual([]);
    expect(buildAuraIntervals(owner, combat)).toHaveLength(2);
  });
});

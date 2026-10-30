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

  it("an aura pushed onto the same stream, another end or another start of the window each give a fresh reading", () => {
    const { owner, combat } = fixture();
    expect(buildAuraIntervals(owner, combat)).toHaveLength(2);

    owner.auraEvents.push(
      makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, POLY, at(40), "e1", "p1") as never,
      makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, POLY, at(46), "e1", "p1") as never,
    );
    const grown = buildAuraIntervals(owner, combat);
    expect(grown).toHaveLength(3);
    expect(grown).toEqual(buildAuraIntervalsUncached(owner, combat));

    const shorter = { ...combat, endTime: at(8) };
    expect(buildAuraIntervals(owner, shorter)).toEqual(
      buildAuraIntervalsUncached(owner, shorter),
    );
    expect(buildAuraIntervals(owner, shorter)[0]!.toS).toBeLessThanOrEqual(8);

    // startTime alone: every fromS / toS moves with it
    const later = { ...combat, startTime: at(1) };
    const shifted = buildAuraIntervals(owner, later);
    expect(shifted).toEqual(buildAuraIntervalsUncached(owner, later));
    expect(shifted[0]!.fromS).toBe(4);
  });

  // review of 698fc58: the casters are an input only through the
  // re-broadcast test — a second APPLIED while the aura is open, inside its
  // official length, is the same aura unless its caster cast it then. These
  // cases make the casters change the reading, so each key part is asked.
  function rebroadcastFixture() {
    const f = fixture();
    // a second Polymorph APPLIED at 7 s while the 5 s one is still open
    f.owner.auraEvents.splice(
      1,
      0,
      makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, POLY, at(7), "e1", "p1") as never,
    );
    return f;
  }

  it("premises: with the caster's casts, a second APPLIED and no cast near it is one aura; a cast near it makes two", () => {
    const { owner, mage, combat } = rebroadcastFixture();
    const polys = () =>
      buildAuraIntervalsUncached(owner, combat).filter((i) => i.spellId === POLY);
    expect(polys()).toHaveLength(1);
    mage.spellCastEvents.push(
      makeSpellCastEvent(POLY, at(7), "p1", "Me", "e1", "Mage") as never,
    );
    expect(polys()).toHaveLength(2);
  });

  it("a cast pushed onto a caster between two readings gives the new reading", () => {
    const { owner, mage, combat } = rebroadcastFixture();
    const polys = (r: { spellId: string }[]) =>
      r.filter((i) => i.spellId === POLY);
    expect(polys(buildAuraIntervals(owner, combat))).toHaveLength(1);
    mage.spellCastEvents.push(
      makeSpellCastEvent(POLY, at(7), "p1", "Me", "e1", "Mage") as never,
    );
    expect(polys(buildAuraIntervals(owner, combat))).toHaveLength(2);
  });

  it("another casters container with as many casts gives its own reading", () => {
    const { owner, combat } = rebroadcastFixture();
    const polys = (r: { spellId: string }[]) =>
      r.filter((i) => i.spellId === POLY);
    expect(polys(buildAuraIntervals(owner, combat))).toHaveLength(1);
    // same number of casts as combat.units (one), so only the container
    // tells the two apart: this caster's one Polymorph is the 7 s one
    const other = makeUnit("e1", {
      name: "Mage",
      reaction: CombatUnitReaction.Hostile,
      info: {},
      spellCastEvents: [makeSpellCastEvent(POLY, at(7), "p1", "Me", "e1", "Mage")],
    });
    const map = new Map([["e1", other]]);
    expect(polys(buildAuraIntervals(owner, combat, map))).toHaveLength(2);
    expect(buildAuraIntervals(owner, combat, map)).toEqual(
      buildAuraIntervalsUncached(owner, combat, map),
    );
    // and the first container's entry is still there
    expect(polys(buildAuraIntervals(owner, combat))).toHaveLength(1);
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

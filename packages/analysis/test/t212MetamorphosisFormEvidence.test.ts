/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * T212 (round-14 D33): a pressed Havoc Metamorphosis with no end in the log
 * is not over at its nominal length while the unit goes on casting what only
 * the form allows.
 */
import { CombatUnitSpec, LogEvent } from "@gladlog/parser-compat";

import { buffFullDurationForCaster } from "../src/utils/buffDuration";
import {
  auraOffensiveOccurrences,
  DEMONIC_FORM_SECONDS,
} from "../src/utils/offensiveAuraOccurrences";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const START = 1_000_000;
const s = (sec: number) => START + sec * 1000;
const aura = (ev: LogEvent, sec: number) =>
  makeAuraEvent(ev, "162264", s(sec), "dh", "dh", "BUFF");
const cast = (id: string, sec: number) =>
  makeSpellCastEvent(id, s(sec), "dh", "Self", "dh");
const havoc = (casts: any[], auras: any[]) =>
  makeUnit("dh", {
    name: "Havoc",
    spec: CombatUnitSpec.DemonHunter_Havoc,
    spellCastEvents: casts,
    auraEvents: auras,
  });
const pressOf = (u: any, endSec: number) =>
  auraOffensiveOccurrences(u, {
    startTime: START,
    endTime: s(endSec),
  }).occurrences.find((o) => o.spellId === "191427")!;
const APPLIED = LogEvent.SPELL_AURA_APPLIED;
const REMOVED = LogEvent.SPELL_AURA_REMOVED;

describe("a pressed Metamorphosis with no logged end (T212)", () => {
  const press = [cast("200166", 10.6)];
  const up = [aura(APPLIED, 10)];
  const full = buffFullDurationForCaster("191427", havoc(press, up))!;
  // a landing within the logging lag of the aura start is no split: the
  // occurrence starts with the aura
  const due = 10 + full;

  it("no later evidence: the nominal length, as before", () => {
    const o = pressOf(havoc(press, up), 170);
    expect(o.endMs).toBe(s(due));
    expect(o.endObserved).toBe(false);
  });

  it("a Death Sweep / Annihilation after the nominal end is the form up at that instant", () => {
    const o = pressOf(
      havoc([...press, cast("210152", due + 6), cast("201427", due + 9.4)], up),
      170,
    );
    expect(o.endMs).toBe(s(due + 9.4));
    expect(o.endObserved).toBe(false);
    // where it was due to end is unchanged
    expect(o.officialEndMs).toBe(s(due));
  });

  it("an Eye Beam while the form is up holds it Demonic's 5 s; one after it ended does not", () => {
    const held = pressOf(havoc([...press, cast("198013", due - 1)], up), 170);
    expect(held.endMs).toBe(s(due - 1 + DEMONIC_FORM_SECONDS));
    const late = pressOf(havoc([...press, cast("198013", due + 3)], up), 170);
    expect(late.endMs).toBe(s(due));
  });

  it("an Eye Beam between two form casts past the nominal end counts: the later cast shows the form at the Eye Beam (the audited order)", () => {
    // 7669df4d: Death Sweep, Eye Beam 1.1 s later, Annihilation 1.1 s and
    // 2.4 s after that; the round ends 2 s after the last cast
    const u = havoc(
      [
        ...press,
        cast("210152", due + 5.9),
        cast("198013", due + 7),
        cast("201427", due + 8.1),
        cast("201427", due + 9.4),
      ],
      up,
    );
    expect(pressOf(u, 170).endMs).toBe(s(due + 7 + DEMONIC_FORM_SECONDS));
    expect(pressOf(u, due + 11.4).endMs).toBe(s(due + 11.4));
  });

  it("never past the round's end or the next application of the form", () => {
    // Demonic's 5 s from an Eye Beam 1 s before the nominal end, in a round
    // that ends 2 s after it
    const u = havoc([...press, cast("198013", due - 1)], up);
    expect(pressOf(u, due + 2).endMs).toBe(s(due + 2));
    const again = havoc(
      [...press, cast("201427", due + 8)],
      [...up, aura(APPLIED, due + 5)],
    );
    expect(pressOf(again, 170).endMs).toBeLessThanOrEqual(s(due + 5));
  });

  it("a logged end is the end: form casts of a later form move nothing", () => {
    const u = havoc([...press, cast("210152", 30)], [...up, aura(REMOVED, 22)]);
    const o = pressOf(u, 170);
    expect(o.endMs).toBe(s(22));
    expect(o.endObserved).toBe(true);
  });
});

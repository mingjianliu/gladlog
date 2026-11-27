/**
 * T270 — Brewmaster's brews come back sooner than their cooldown: Keg Smash
 * and Tiger Palm take seconds off every Brew (Face Palm, Blackout Combo and
 * Meditative Focus more), and Black Ox Brew gives a charge of Celestial
 * Brew. 12.1.5 logs (41243fd2) had 18 of 25 checked Celestial Brew presses
 * pressed again before the model's `back`.
 */
import { describe, expect, it } from "vitest";

import {
  EVENT_COOLDOWN_REDUCTIONS,
  eventReductionsFor,
  eventTriggersFor,
} from "../src/data/talentScriptedCooldowns";

const T0 = 1_000_000;
const row = (event: string, spellId: string, atS: number) => ({
  spellId,
  srcUnitId: "m",
  destUnitId: "m",
  logLine: { event, timestamp: T0 + Math.round(atS * 1000) },
});
type Unit = Parameters<typeof eventTriggersFor>[0];

const BREWMASTER_TALENTS = new Set([
  "322120", // Shuffle
  "389942", // Face Palm
  "196736", // Blackout Combo
  "1271105", // Meditative Focus
  "115399", // Black Ox Brew
]);
const holds = (t: string) => BREWMASTER_TALENTS.has(t);
const keysFor = (spellId: string, h: (t: string) => boolean, spec: string) =>
  eventReductionsFor(spellId, h, spec).map(
    (r) =>
      Object.entries(EVENT_COOLDOWN_REDUCTIONS).find(([, x]) => x === r)![0],
  );

describe("T270 brews — which rows a unit holds", () => {
  it("a Brewmaster with the talents: every row on Celestial Brew", () => {
    expect(keysFor("322507", holds, "268").sort()).toEqual(
      ["115399", "1271105", "137023", "196736", "322120", "389942"].sort(),
    );
  });
  it("Purifying Brew is refilled by Black Ox Brew, not given one charge", () => {
    const keys = keysFor("119582", holds, "268");
    expect(keys).toContain("115399:119582");
    expect(keys).not.toContain("115399");
    expect(EVENT_COOLDOWN_REDUCTIONS["115399:119582"]!.oneCharge).toBe(
      undefined,
    );
  });
  it("Tiger Palm is the Brewmaster's only: a Windwalker's Fortifying Brew keeps its cooldown", () => {
    expect(keysFor("115203", () => false, "269")).toEqual([]);
    expect(keysFor("115203", () => false, "268")).toEqual(["137023"]);
  });
  it("Meditative Focus needs Blackout Combo", () => {
    expect(
      keysFor("322507", (t) => t === "1271105" || t === "322120", "268"),
    ).not.toContain("1271105");
  });
});

describe("T270 brews — what each trigger gives back", () => {
  // a Tiger Palm cast with its hit row 1 ms later (a parry: a MISSED row)
  const monk = (
    casts: Array<[string, number]>,
    auras: Array<[string, string, number]> = [],
    palmMiss: Record<number, string> = {},
  ) => {
    const palms = casts.filter(([id]) => id === "100780");
    const hit = (s: number) => ({
      ...row("SPELL_DAMAGE", "100780", s + 0.001),
      destUnitId: "e",
    });
    return {
      id: "m",
      spec: "268",
      spellCastEvents: casts.map(([id, s]) => row("SPELL_CAST_SUCCESS", id, s)),
      auraEvents: auras.map(([ev, id, s]) => row(ev, id, s)),
      damageOut: palms.filter(([, s]) => !palmMiss[s]).map(([, s]) => hit(s)),
      missesOut: palms
        .filter(([, s]) => palmMiss[s])
        .map(([, s]) => ({
          ...row("SPELL_MISSED", "100780", s + 0.001),
          destUnitId: "e",
          missType: palmMiss[s],
        })),
    } as unknown as Unit;
  };
  const on = (spellId: string, h = holds) =>
    eventReductionsFor(spellId, h, "268");
  const given = (u: Unit, spellId: string, h = holds) =>
    eventTriggersFor(u, on(spellId, h)).map((g) => ({
      atS: (g.atMs - T0) / 1000,
      seconds: g.seconds,
      ...(g.oneCharge ? { oneCharge: true } : {}),
    }));

  it("Keg Smash 3 s; Tiger Palm 1 s + Face Palm 0.5 s", () => {
    const got = given(
      monk([
        ["121253", 10],
        ["100780", 12],
      ]),
      "322507",
    );
    expect(got.filter((g) => g.atS === 10).map((g) => g.seconds)).toEqual([3]);
    expect(
      got
        .filter((g) => g.atS === 12.001)
        .map((g) => g.seconds)
        .sort(),
    ).toEqual([0.5, 1]);
  });
  it("a parried Tiger Palm gives nothing; one a shield soaked whole does (41243fd2 r2 33.150 s)", () => {
    const parried = given(
      monk([["100780", 33.15]], [], { 33.15: "PARRY" }),
      "322507",
    );
    expect(parried).toEqual([]);
    const soaked = given(
      monk([["100780", 33.15]], [], { 33.15: "ABSORB" }),
      "322507",
    );
    expect(soaked.map((g) => g.seconds).sort()).toEqual([0.5, 1]);
  });
  it("a Keg Smash that spends Blackout Combo (REMOVED in its millisecond): 3 + 2 + 1 s", () => {
    const got = given(
      monk(
        [["121253", 20]],
        [
          ["SPELL_AURA_APPLIED", "228563", 18],
          ["SPELL_AURA_REMOVED", "228563", 20],
        ],
      ),
      "322507",
    );
    expect(got.map((g) => g.seconds).sort()).toEqual([1, 2, 3]);
  });
  it("a Blackout Combo that ran out 50 ms before the Keg Smash was not spent by it", () => {
    const got = given(
      monk(
        [["121253", 25.05]],
        [
          ["SPELL_AURA_APPLIED", "228563", 10],
          ["SPELL_AURA_REMOVED", "228563", 25],
        ],
      ),
      "322507",
    );
    expect(got.map((g) => g.seconds)).toEqual([3]);
  });
  it("a Tiger Palm that spends Blackout Combo takes nothing more off", () => {
    const got = given(
      monk(
        [["100780", 20]],
        [
          ["SPELL_AURA_APPLIED", "228563", 18],
          ["SPELL_AURA_REMOVED", "228563", 20],
        ],
      ),
      "322507",
    );
    expect(got.map((g) => g.seconds).sort()).toEqual([0.5, 1]);
  });
  it("Black Ox Brew: one charge of Celestial Brew", () => {
    expect(given(monk([["115399", 30]]), "322507")).toEqual([
      { atS: 30, seconds: Number.POSITIVE_INFINITY, oneCharge: true },
    ]);
  });
  it("Black Ox Brew's press is its own evidence: an unresolved choice node still gives it", () => {
    expect(given(monk([["115399", 30]]), "119582", () => false)).toEqual([
      { atS: 30, seconds: Number.POSITIVE_INFINITY },
    ]);
  });
});

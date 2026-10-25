/**
 * D7 (user 2026-10-24): a permanent pet's abilities go with it — its death
 * (UNIT_DIED on its GUID) or the owner's Dismiss Pet, until another pet of
 * the owner is seen. An end the log does not show leaves the pet there.
 */
import { describe, expect, it } from "vitest";

import { ownerPetGoneAt } from "../src/utils/petPresence";
import { warlockPurgePetSpans } from "../src/utils/warlockPet";

const T0 = 1_000_000;
const at = (s: number) => T0 + s * 1000;
const row = (s: number) => ({
  timestamp: at(s),
  logLine: { timestamp: at(s) },
});
const pet = (
  id: string,
  seenS: number,
  diedS?: number,
  extra: Record<string, unknown> = {},
) => ({
  id,
  ownerId: "owner",
  spellCastEvents: [],
  auraEvents: [row(seenS)],
  deathRecords: diedS === undefined ? [] : [{ timestamp: at(diedS) }],
  ...extra,
});
const owner = (casts: Array<{ spellId: string; s: number }> = []) => ({
  id: "owner",
  spec: "265",
  spellCastEvents: casts.map((c) => ({ spellId: c.spellId, timestamp: at(c.s) })),
});

describe("ownerPetGoneAt", () => {
  const A = "Pet-0-1-1-1-417-0204BBD685";
  const B = "Pet-0-1-1-1-417-0304BBD685"; // the same pet's next GUID
  it("dead → gone until a new pet unit is seen", () => {
    const units = [pet(A, 0, 30), pet(B, 45)];
    expect(ownerPetGoneAt(owner(), units as never, at(20))).toBe(false);
    expect(ownerPetGoneAt(owner(), units as never, at(31))).toBe(true);
    expect(ownerPetGoneAt(owner(), units as never, at(46))).toBe(false);
  });
  it("Dismiss Pet ends it; no row on the pet is needed", () => {
    const units = [pet(A, 0)];
    const o = owner([{ spellId: "2641", s: 50 }]);
    expect(ownerPetGoneAt(o as never, units as never, at(49))).toBe(false);
    expect(ownerPetGoneAt(o as never, units as never, at(51))).toBe(true);
  });
  it("two pets at once: one dying leaves the other", () => {
    const units = [pet(A, 0, 30), pet(B, 0)];
    expect(ownerPetGoneAt(owner(), units as never, at(40))).toBe(false);
  });
  it("no end in the log, or no pet unit at all: there", () => {
    expect(ownerPetGoneAt(owner(), [pet(A, 0)] as never, at(90))).toBe(false);
    expect(ownerPetGoneAt(owner(), [] as never, at(90))).toBe(false);
  });
});

describe("warlockPurgePetSpans ends the Felhunter at its death", () => {
  it("a Felhunter that died at 40 s purges until 40 s", () => {
    const felhunter = pet("Pet-0-1-1-1-417-0204BBD685", 0, 40);
    const spans = warlockPurgePetSpans(owner() as never, [felhunter] as never, T0);
    expect(spans).toEqual([{ fromSeconds: -Infinity, toSeconds: 40 }]);
  });
});

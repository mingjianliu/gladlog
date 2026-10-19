/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * F15 / fact1215 C10 (the rest): a damage miss of a cast whose control takes
 * only some targets is no failed control (Wake of Ashes); a warlock's purge
 * follows the pet the log shows (Sayaad); Ice Nova is a root.
 */
import { CombatUnitSpec } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { SPELL_CATEGORIES } from "../src/data/spellCategories";
import {
  CONTROL_EFFECT_MIN_HIT_SHARE,
  missReportsControl,
} from "../src/utils/castMissRows";
import {
  canOffensivePurge,
  missedPurgesFor,
} from "../src/utils/dispelAnalysis";
import { warlockRanPurgePet } from "../src/utils/warlockPet";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("missReportsControl — a miss row that stands for a control (0f894aee 1:54)", () => {
  it("Wake of Ashes' damage id is no control miss: its stun takes demons and undead only", () => {
    expect(missReportsControl("255937")).toBe(false);
    // the stun's own id still is
    expect(missReportsControl("255941")).toBe(true);
  });
  it("casts whose control is their usual result keep their miss: Chastise, Capacitor Totem, Storm Bolt, Sigil of Misery", () => {
    for (const id of ["88625", "192058", "107570", "207684"])
      expect(missReportsControl(id), id).toBe(true);
    expect(CONTROL_EFFECT_MIN_HIT_SHARE).toBe(0.5);
  });
  it("a control's own id, and a non-control, as before", () => {
    expect(missReportsControl("118")).toBe(true); // Polymorph
    expect(missReportsControl("133")).toBe(false); // Fireball
  });
});

describe("warlock purge follows the logged pet (1120cb61: a Sayaad warlock listed as a purger)", () => {
  const petCast = (pet: string, spellId: string) =>
    makeSpellCastEvent(spellId, 1_000_000, "Player-1-T", "Target", pet, "Pet");
  const lock = (petSpellCastEvents: any[]) =>
    makeUnit("Player-1-W", {
      name: "Lock",
      spec: CombatUnitSpec.Warlock_Affliction,
      petSpellCastEvents,
    });
  it("a Sayaad's Seduction: no purge", () => {
    const u = lock([petCast("Pet-0-1-1-1-1863-01", "6358")]);
    expect(warlockRanPurgePet(u)).toBe(false);
    expect(canOffensivePurge(u)).toBe(false);
  });
  it("a Felhunter: purge (also after a swap from a Sayaad)", () => {
    const u = lock([
      petCast("Pet-0-1-1-1-1863-01", "6358"),
      petCast("Pet-0-1-1-1-417-02", "19647"),
    ]);
    expect(warlockRanPurgePet(u)).toBe(true);
    expect(canOffensivePurge(u)).toBe(true);
  });
  it("the round's units, the roster's own reading: a silent Sayaad unit is still the pet", () => {
    const u = lock([]);
    const sayaad = makeUnit("Pet-0-1-1-1-1863-03", { ownerId: u.id });
    expect(warlockRanPurgePet(u, [u, sayaad])).toBe(false);
    expect(canOffensivePurge(u, [u, sayaad])).toBe(false);
  });
  it("the missed-purge list reads the same pets as the header when given the round (codex 20-F15-29)", () => {
    // a Sayaad that cast, then a Felhunter the log shows only as a unit
    const u = lock([petCast("Pet-0-1-1-1-1863-01", "6358")]);
    const felhunter = makeUnit("Pet-0-1-1-1-417-02", { ownerId: u.id });
    const w = { timeSeconds: 10, spellId: "1022" } as any;
    const summary = { missedPurgeWindows: [w], scopedMissedPurgeWindows: [] };
    expect(canOffensivePurge(u, [u, felhunter])).toBe(true);
    expect(missedPurgesFor(u, summary, [u, felhunter])).toEqual([w]);
  });
  it("no pet logged: nothing said, the talent reading stands", () => {
    expect(warlockRanPurgePet(lock([]))).toBeUndefined();
  });
});

describe("Ice Nova is a root (34204ef9 1:41)", () => {
  it("157997 is classed with Frost Nova", () => {
    expect(SPELL_CATEGORIES["157997"]?.type).toBe("roots");
    expect(SPELL_CATEGORIES["122"]?.type).toBe("roots");
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * fact12 D3 / D7 (pipeline T11): refused controls read as landed or "hit
 * nothing".
 *  - D3 (1d26a991 1:40): a Rebuke into Eye Beam logged its IMMUNE 178 ms
 *    after the press; the kick audit paired a miss within 100 ms only. It now
 *    pairs by the cast lines' `missBelongsToCast`.
 *  - D7 (3c8b52e7 r0 1:52): the ledger keys Imprison 217832, the press logs
 *    221527; the no-aura tag looked the press row up by id only. Both
 *    outcome readers use `pressRowOfLedgerId`.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { pressRowOfLedgerId } from "../src/utils/castPress";
import { analyzeKickAudit } from "../src/utils/kickAudit";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

const T0 = 1_000_000;
const WIND_SHEAR = "57994";
const info = { teamId: "0", specId: "x" } as any;

beforeAll(async () => {
  await ensureAnalysisData();
});

const shear = (ms: number) =>
  makeSpellCastEvent(
    WIND_SHEAR,
    ms,
    "e1",
    "Enemy",
    "p1",
    "Shaman",
    0,
    "Wind Shear",
  );
const immuneAt = (ms: number) => ({
  timestamp: ms,
  spellId: WIND_SHEAR,
  srcUnitId: "p1",
  destUnitId: "e1",
  destUnitName: "Enemy",
  missType: "IMMUNE",
});
const audit = (casts: any[], misses: any[]) => {
  const player = makeUnit("p1", {
    name: "Shaman",
    info,
    spellCastEvents: casts,
  } as any);
  player.missesOut = misses as any;
  const enemy = makeUnit("e1", { name: "Enemy", info } as any);
  return analyzeKickAudit(player, [enemy], {
    startTime: T0,
    endTime: T0 + 120_000,
    units: { p1: player, e1: enemy },
  } as any);
};

describe("a kick's own miss row, logged after the press (D3)", () => {
  it("an IMMUNE 178 ms after the kick is its miss", () => {
    const t = T0 + 100_440;
    const [k] = audit([shear(t)], [immuneAt(t + 178)]);
    expect(k?.kickMiss?.missType).toBe("IMMUNE");
  });
  it("controls: one past the cast window, and one after a later press, are not", () => {
    const t = T0 + 50_000;
    expect(
      audit([shear(t)], [immuneAt(t + 3_000)])[0]?.kickMiss,
    ).toBeUndefined();
    const two = audit([shear(t), shear(t + 1_000)], [immuneAt(t + 1_178)]);
    expect(two[0]?.kickMiss).toBeUndefined();
    expect(two[1]?.kickMiss?.missType).toBe("IMMUNE");
  });
});

describe("a kick's miss under its effect id (D3 residual)", () => {
  it("Solar Beam 78675's IMMUNE logged as 97547 in the same ms is its miss", () => {
    const t = T0 + 186_122;
    const beam = makeSpellCastEvent(
      "78675",
      t,
      "e1",
      "Enemy",
      "p1",
      "Druid",
      0,
      "Solar Beam",
    );
    const [k] = audit(
      [beam],
      [{ ...immuneAt(t), spellId: "97547", spellName: "Solar Beam" }],
    );
    expect(k?.kickMiss?.missType).toBe("IMMUNE");
    // control: another spell's IMMUNE in that ms is not the beam's
    const [o] = audit(
      [beam],
      [{ ...immuneAt(t), spellId: "33786", spellName: "Cyclone" }],
    );
    expect(o?.kickMiss).toBeUndefined();
  });
});

describe("pressRowOfLedgerId (D7)", () => {
  const row = (id: string, ms: number, name = "Imprison") =>
    makeSpellCastEvent(id, ms, "e1", "Enemy", "p1", "DH", 0, name) as any;
  it("finds the logged 221527 for the ledger's 217832, the exact id first", () => {
    const t = T0 + 112_322;
    const variant = row("221527", t);
    expect(pressRowOfLedgerId([variant], "217832", t, 1)).toBe(variant);
    const exact = row("217832", t);
    expect(pressRowOfLedgerId([variant, exact], "217832", t, 1)).toBe(exact);
  });
  it("controls: outside the tolerance, or another spell, is no press", () => {
    const t = T0 + 112_322;
    expect(
      pressRowOfLedgerId([row("221527", t + 5)], "217832", t, 1),
    ).toBeUndefined();
    expect(
      pressRowOfLedgerId([row("853", t, "Hammer of Justice")], "217832", t, 1),
    ).toBeUndefined();
  });
});

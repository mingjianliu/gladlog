/**
 * T137 — Slipstream (441257): Deep Breath / Breath of Eons gives one charge
 * of Hover back.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  EVENT_COOLDOWN_REDUCTIONS,
  eventTriggersFor,
} from "../src/data/talentScriptedCooldowns";
import { chargesAvailableAt } from "../src/utils/cooldowns";

const T0 = 1_000_000;
const cast = (spellId: string, atS: number) => ({
  spellId,
  logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: T0 + atS * 1000 },
});
const row = EVENT_COOLDOWN_REDUCTIONS["441257"]!;

describe("Slipstream — a breath gives one charge of Hover back", () => {
  it("the row: Hover, every breath press id, one charge", () => {
    expect(row.targets).toEqual(["358267"]);
    expect(row.triggerCastIds).toEqual([
      "357210",
      "433874",
      "403631",
      "442204",
    ]);
    expect(row.seconds).toBe(Number.POSITIVE_INFINITY);
    expect(row.oneCharge).toBe(true);
  });

  it("the audited shape: Hover 8.34 s, Deep Breath 16.25 s, Hover 20.93 s — a charge is in hand at 30.05 s", () => {
    const unit = {
      id: "e",
      spellCastEvents: [cast("358267", 8.34), cast("433874", 16.25)],
      auraEvents: [],
    };
    const reductions = eventTriggersFor(
      unit as never,
      [row],
      () => true,
      undefined,
      T0 + 300_000,
    ).map((g) => ({
      atSeconds: (g.atMs - T0) / 1000,
      seconds: g.seconds,
      ...(g.oneCharge ? { oneCharge: g.oneCharge } : {}),
    }));
    expect(reductions).toEqual([
      { atSeconds: 16.25, seconds: Number.POSITIVE_INFINITY, oneCharge: true },
    ]);
    const presses = [8.34, 20.93];
    // 35 s at the Blessing of the Bronze rate
    const recharge = 35 / (1 / 0.85);
    expect(chargesAvailableAt(presses, recharge, 2, 30.05)).toBe(0);
    expect(
      chargesAvailableAt(presses, recharge, 2, 30.05, { reductions }),
    ).toBe(1);
    // one charge only: a breath with both charges spent gives one, not two
    expect(chargesAvailableAt([8.34, 9], recharge, 2, 17, { reductions })).toBe(
      1,
    );
  });
});

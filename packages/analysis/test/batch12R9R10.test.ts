/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * F15 / fact1215 R9 + R10:
 *  - R10 (09dda3c6, 06356dd9): a press the game refused names the control's
 *    mechanic; it belongs to the control of that mechanic, not to whichever
 *    overlapping control started first.
 *  - R9 (62fdbf2e): a channel that puts no aura on its caster (Arcane
 *    Missiles) ends where its kick or its own last tick is logged.
 *  - R9 (519781fd): a channelled control ended by a kick on its caster says
 *    so instead of "cause not logged".
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  CONTROL_REJECT_MECHANIC,
  ownerPressesRejectedDuring,
} from "../src/context/controlRejectedPresses";
import { ensureAnalysisData } from "../src/data/ensure";
import { tickEndedChannelSpans } from "../src/utils/castCommitSpans";
import {
  ccEndedByCasterInterrupt,
  formatCcLoggedEnd,
} from "../src/utils/ccTrinketAnalysis";

const T0 = 1_000_000;

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("R10 — a refused press goes to the control its reason names", () => {
  const stun = { id: "stun", from: 69.9, to: 72.9, mech: 12 };
  const poly = { id: "poly", from: 70.9, to: 73.9, mech: 17 };
  const press = (t: number, reason: string) => ({
    unitGuid: "O",
    spellId: "33206",
    tSeconds: t,
    reason,
  });
  const run = (presses: any[]) =>
    ownerPressesRejectedDuring(
      presses as any,
      "O",
      new Map([["33206", "Pain Suppression"]]),
      "control",
      [stun, poly],
      (w) => ({ fromSeconds: w.from, toSeconds: w.to }),
      (w) => w.mech,
    );
  it("the mechanics the corpus read", () => {
    expect(CONTROL_REJECT_MECHANIC["Can't do that while polymorphed"]).toBe(17);
    expect(CONTROL_REJECT_MECHANIC["无法在变形时那样做"]).toBe(17);
    expect(CONTROL_REJECT_MECHANIC["Can't do that while stunned"]).toBe(12);
  });
  it("09dda3c6: 'while polymorphed' inside Asphyxiate and Polymorph is Polymorph's", () => {
    const out = run([press(71.1, "无法在变形时那样做")]);
    expect(out.get(poly as any)?.[0]?.count).toBe(1);
    expect(out.get(stun as any)).toBeUndefined();
  });
  it("'while stunned' in the same overlap is the stun's", () => {
    const out = run([press(71.1, "Can't do that while stunned")]);
    expect(out.get(stun as any)?.[0]?.count).toBe(1);
  });
  it("a reason naming no mechanic keeps the earliest-started window", () => {
    const out = run([press(71.1, "You are not in control of your actions")]);
    expect(out.get(stun as any)?.[0]?.count).toBe(1);
  });
  it("a press logged under a variant id of a kit cooldown counts under the kit's name (605 b34: refused presses of Stasis, Alter Time, Stampeding Roar … missing from the clause)", () => {
    const out = ownerPressesRejectedDuring(
      [
        { unitGuid: "O", spellId: "106898", spellName: "Stampeding Roar", tSeconds: 71, reason: "Can't do that while stunned" },
        { unitGuid: "O", spellId: "77764", spellName: "Stampeding Roar", tSeconds: 71.5, reason: "Can't do that while stunned" },
        // a button outside the kit is still not listed
        { unitGuid: "O", spellId: "8936", spellName: "Regrowth", tSeconds: 72, reason: "Can't do that while stunned" },
      ] as any,
      "O",
      new Map([["77764", "Stampeding Roar"]]),
      "control",
      [stun],
      (w) => ({ fromSeconds: w.from, toSeconds: w.to }),
      (w) => w.mech,
    );
    expect(out.get(stun as any)).toEqual([
      { spellId: "106898", spellName: "Stampeding Roar", count: 2, firstSeconds: 71 },
    ]);
  });
});

describe("R9 — a channel with no aura on its caster", () => {
  const AM = "5143"; // Arcane Missiles, 2.5 s, ticks log as 7268
  const mage = (extra: any = {}) =>
    ({
      id: "M",
      spellCastEvents: [
        {
          spellId: AM,
          spellName: "Arcane Missiles",
          timestamp: T0,
          logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: T0 },
        },
      ],
      auraEvents: [],
      damageOut: [0.4, 0.8, 1.2, 1.9].map((s) => ({
        spellId: "7268",
        spellName: "Arcane Missiles",
        srcUnitId: "M",
        timestamp: T0 + s * 1000,
        logLine: { event: "SPELL_DAMAGE", timestamp: T0 + s * 1000 },
      })),
      healOut: [],
      actionIn: [],
      ...extra,
    }) as any;
  it("ends at its own last tick (62fdbf2e 2:12.646 → 2:14.592)", () => {
    expect(tickEndedChannelSpans(mage())).toEqual([
      {
        spellId: AM,
        spellName: "Arcane Missiles",
        startMs: T0,
        endMs: T0 + 1900,
      },
    ]);
  });
  it("ends at the kick that stopped it (2:18.541 → Counterspell 2:19.168)", () => {
    const m = mage({
      actionIn: [
        {
          spellId: "2139",
          extraSpellId: AM,
          destUnitId: "M",
          timestamp: T0 + 1000,
          logLine: { event: LogEvent.SPELL_INTERRUPT, timestamp: T0 + 1000 },
        },
      ],
    });
    expect(tickEndedChannelSpans(m)[0]?.endMs).toBe(T0 + 1000);
  });
  it("no tick and no kick: nothing guessed", () => {
    expect(tickEndedChannelSpans(mage({ damageOut: [] }))).toEqual([]);
  });
  it("a tick after the caster's next press of another spell is no channelling (codex 20-F15-24, 0284fcd9 r3)", () => {
    // Missiles 0 s, Arcane Barrage 1.378 s, a Missiles hit landing at 1.95 s
    const m = mage({
      damageOut: [0.4, 0.8, 1.2, 1.95].map((s) => ({
        spellId: "7268",
        spellName: "Arcane Missiles",
        srcUnitId: "M",
        timestamp: T0 + s * 1000,
        logLine: { event: "SPELL_DAMAGE", timestamp: T0 + s * 1000 },
      })),
    });
    m.spellCastEvents.push({
      spellId: "44425",
      spellName: "Arcane Barrage",
      timestamp: T0 + 1378,
      logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: T0 + 1378 },
    });
    expect(tickEndedChannelSpans(m)[0]?.endMs).toBe(T0 + 1200);
  });
});

describe("R9 — a channelled control ended by a kick on its caster", () => {
  const MC = "605";
  it("519781fd 3:20: Spell Lock on the priest 12 ms before Mind Control left", () => {
    const holder = {
      auraEvents: [
        {
          spellId: MC,
          srcUnitId: "P",
          timestamp: T0 + 2381,
          logLine: { event: LogEvent.SPELL_AURA_REMOVED, timestamp: T0 + 2381 },
        },
      ],
    } as any;
    const priest = {
      actionIn: [
        {
          spellId: "19647",
          spellName: "Spell Lock",
          srcUnitId: "Pet-1",
          srcUnitName: "Bheenom",
          timestamp: T0 + 2369,
          logLine: { event: LogEvent.SPELL_INTERRUPT, timestamp: T0 + 2369 },
        },
      ],
    } as any;
    const end = ccEndedByCasterInterrupt(
      holder,
      { spellId: MC, atSeconds: 2.175, durationSeconds: 0.206, sourceId: "P" },
      T0,
      priest,
    );
    expect(end).toMatchObject({ kind: "casterInterrupted", byUnitId: "Pet-1" });
    expect(formatCcLoggedEnd(end, (n) => n)).toBe(
      " | ended by Bheenom's Spell Lock on its caster",
    );
    // a kick of another spell the caster started is not this channel's end
    // (codex 20-F15-24: Counterspell on the priest's Flash Heal)
    const flash = {
      actionIn: [
        { ...priest.actionIn[0], extraSpellId: "2061" },
      ],
    } as any;
    expect(
      ccEndedByCasterInterrupt(
        holder,
        { spellId: MC, atSeconds: 2.175, durationSeconds: 0.206, sourceId: "P" },
        T0,
        flash,
      ),
    ).toBeUndefined();
    // … and one naming the channel is
    expect(
      ccEndedByCasterInterrupt(
        holder,
        { spellId: MC, atSeconds: 2.175, durationSeconds: 0.206, sourceId: "P" },
        T0,
        { actionIn: [{ ...priest.actionIn[0], extraSpellId: MC }] } as any,
      ),
    ).toMatchObject({ kind: "casterInterrupted" });
    // no kick on the caster: no cause
    expect(
      ccEndedByCasterInterrupt(
        holder,
        {
          spellId: MC,
          atSeconds: 2.175,
          durationSeconds: 0.206,
          sourceId: "P",
        },
        T0,
        { actionIn: [] } as any,
      ),
    ).toBeUndefined();
  });
});

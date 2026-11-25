/**
 * T241 — two cooldown mechanisms the 12.1.5 logs showed the model missing:
 * Voidrush (Collapsing Star: Voidblade −10 s) and Savage Momentum's Skull
 * Bash into a Penance, which the game counts as an interrupt and the log
 * shows no SPELL_INTERRUPT row for.
 */
import { describe, expect, it } from "vitest";

import {
  castIntoChannelTimesMs,
  EVENT_COOLDOWN_REDUCTIONS,
  eventReducedCooldownSeconds,
  eventReductionsFor,
  eventTriggersFor,
} from "../src/data/talentScriptedCooldowns";

const T0 = 1_000_000;
const row = (
  event: string,
  spellId: string,
  atS: number,
  src = "d",
  dest = "p",
) => ({
  spellId,
  srcUnitId: src,
  destUnitId: dest,
  logLine: { event, timestamp: T0 + Math.round(atS * 1000) },
});
type Unit = Parameters<typeof eventTriggersFor>[0];

describe("T241 Voidrush — Collapsing Star: Voidblade −10 s", () => {
  const r = EVENT_COOLDOWN_REDUCTIONS["1272422"]!;
  it("is the holder's row on Voidblade", () => {
    expect(eventReductionsFor("1245412", (t) => t === "1272422")).toEqual([r]);
    expect(eventReductionsFor("1245412", () => false)).toEqual([]);
  });
  it("78408483 r69: Voidblade 34.6 s, Collapsing Star 57.6 s — back at 54.6 s, in time for 60.0 s", () => {
    const dh = {
      id: "d",
      spec: "1480",
      spellCastEvents: [
        row("SPELL_CAST_SUCCESS", "1245414", 34.6),
        row("SPELL_CAST_SUCCESS", "1221150", 57.6),
      ],
      damageOut: [],
    } as unknown as Unit;
    const triggers = eventTriggersFor(dh, [r]).map((g) => ({
      atSeconds: (g.atMs - T0) / 1000,
      seconds: g.seconds,
    }));
    expect(triggers).toEqual([{ atSeconds: 57.6, seconds: 10 }]);
    // 34.6 + 30 = 64.6; the star at 57.6 takes 10 s: back at once, 57.6
    expect(eventReducedCooldownSeconds(34.6, 30, triggers)).toBeCloseTo(23, 3);
  });
});

describe("T241 Savage Momentum — a Skull Bash into a Penance counts with no interrupt row", () => {
  const r = EVENT_COOLDOWN_REDUCTIONS["205673"]!;
  const priest = (casts: Array<[string, number]>) => ({
    spellCastEvents: casts.map(([id, s]) =>
      row("SPELL_CAST_SUCCESS", id, s, "p", "x"),
    ),
  });
  const feral = (bashS: number, interrupt = false) =>
    ({
      id: "d",
      spec: "103",
      spellCastEvents: [row("SPELL_CAST_SUCCESS", "93985", bashS)],
      damageOut: [],
      actionOut: interrupt
        ? [row("SPELL_INTERRUPT", "93985", bashS + 0.001)]
        : [],
    }) as unknown as Unit;
  const lookup =
    (p: ReturnType<typeof priest>) =>
    (id: string): ReturnType<typeof priest> | undefined =>
      id === "p" ? p : undefined;
  const times = (u: Unit, p: ReturnType<typeof priest>) =>
    castIntoChannelTimesMs(
      u as Parameters<typeof castIntoChannelTimesMs>[0],
      r.triggerCastIntoChannel!,
      lookup(p) as Parameters<typeof castIntoChannelTimesMs>[2],
    ).map((ms) => (ms - T0) / 1000);

  it("2d4d9d9d r309: Penance 59.5 s, Skull Bash 60.5 s, no interrupt row — one trigger of 10 s", () => {
    const p = priest([["47540", 59.5]]);
    expect(times(feral(60.5), p)).toEqual([60.5]);
    const got = eventTriggersFor(
      feral(60.5),
      [r],
      undefined,
      undefined,
      undefined,
      lookup(p) as Parameters<typeof eventTriggersFor>[5],
    );
    expect(got.map((g) => g.seconds)).toEqual([10]);
  });
  it("an interrupt the log shows is the interrupt row's trigger, never both", () => {
    const p = priest([["47540", 59.5]]);
    expect(times(feral(60.5, true), p)).toEqual([]);
    expect(
      eventTriggersFor(
        feral(60.5, true),
        [r],
        undefined,
        undefined,
        undefined,
        lookup(p) as Parameters<typeof eventTriggersFor>[5],
      ),
    ).toHaveLength(1);
  });
  it("nothing when the target's last cast is not a Penance, when it is older than 2 s, or without the other units", () => {
    expect(
      times(
        feral(60.5),
        priest([
          ["47540", 59.5],
          ["17", 60.2],
        ]),
      ),
    ).toEqual([]);
    expect(times(feral(62.0), priest([["47540", 59.5]]))).toEqual([]);
    expect(eventTriggersFor(feral(60.5), [r])).toEqual([]);
  });
});

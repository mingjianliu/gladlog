/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * fact1215 R7 (user approved 2026-10-18): "defenseless" says nothing was up —
 * the target's own immunity (3867e9ef: Vanish) and absorb shield (1120cb61:
 * a 494k Anti-Magic Shell) cut the span, and an area save cuts every unit
 * that carries its aura (1120cb61: Rallying Cry on the Death Knight). A heal
 * or a rewind is no defense that was up.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { areaSaveSpanOnS, ownSaveSpanS } from "../src/utils/enemyDefensives";

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("ownSaveSpanS", () => {
  const ev = (over: Record<string, unknown>) =>
    ({ atSeconds: 110.9, observedSeconds: 3, ...over }) as any;
  it("an immunity: its aura, for as long as it was up (the cap when the end was never logged)", () => {
    expect(ownSaveSpanS(ev({ kind: "immune" }), false)).toEqual({
      from: 110.9,
      to: 113.9,
    });
  });
  it("an absorb shield, by effect or by mechanism", () => {
    expect(
      ownSaveSpanS(ev({ kind: "self-save", effect: "absorb" }), false),
    ).toEqual({ from: 110.9, to: 113.9 });
    expect(
      ownSaveSpanS(
        ev({ kind: "self-save", mechanism: { kind: "absorb" } }),
        false,
      ),
    ).toEqual({ from: 110.9, to: 113.9 });
  });
  it("a heal, a rewind, a proc and a wall cut nothing here", () => {
    for (const over of [
      { kind: "self-save", mechanism: { kind: "heal", healAbsorb: false } },
      { kind: "self-save", mechanism: { kind: "rewind" } },
      { kind: "self-save", effect: "cheat-death proc" },
      { kind: "self" },
      { kind: "external" },
      { kind: "area" },
    ])
      expect(ownSaveSpanS(ev(over), false), JSON.stringify(over)).toBe(
        undefined,
      );
  });
  it("a press the state machine times keeps its hold: only an aura that came before the cast line is cut", () => {
    expect(
      ownSaveSpanS(ev({ kind: "immune", pressSeconds: 111.2 }), true),
    ).toEqual({ from: 110.9, to: 111.2 });
    expect(
      ownSaveSpanS(ev({ kind: "immune", pressSeconds: 110.9 }), true),
    ).toBe(undefined);
  });
});

describe("areaSaveSpanOnS", () => {
  const rc = { kind: "area", spellId: "97462", atSeconds: 29.4 } as any;
  const iv = (spellId: string, fromS: number, toS: number) =>
    ({ spellId, fromS, toS }) as any;
  it("Rallying Cry's aura 97463 on the holder, applied with the cast: its interval", () => {
    expect(areaSaveSpanOnS(rc, [iv("97463", 29.5, 42.5)])).toEqual({
      from: 29.5,
      to: 42.5,
    });
  });
  it("no aura on the holder, an aura from another cast, another save's aura: nothing", () => {
    expect(areaSaveSpanOnS(rc, [])).toBe(undefined);
    expect(areaSaveSpanOnS(rc, [iv("97463", 60, 70)])).toBe(undefined);
    expect(areaSaveSpanOnS(rc, [iv("325174", 29.5, 35)])).toBe(undefined);
    // Darkness has no effect aura in the table
    expect(
      areaSaveSpanOnS({ ...rc, spellId: "196718" }, [iv("209426", 29.5, 37)]),
    ).toBe(undefined);
  });
});

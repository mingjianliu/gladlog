/* eslint-disable @typescript-eslint/no-explicit-any -- fake legacy parse objects, the check reads them untyped */
/**
 * scan5 `resCcConcurrentDropped` (T102, codex 85-tk-L-T102-1 #2 / #3): a
 * same-name instance is not covered by the listed one, and a root aura with
 * no end row runs its official length.
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { run } from "../scripts/scan5/t102";

const START = 1_000_000;
const at = (s: number) => START + s * 1000;
const WIND_SHEAR = "57994";
const FROST_NOVA = "122";
const ROOTS = "339";

const kick = (src: string, s: number, school: string) => ({
  timestamp: at(s),
  logLine: { event: "SPELL_INTERRUPT", timestamp: at(s) },
  spellId: WIND_SHEAR,
  spellName: "Wind Shear",
  extraSpellId: school,
  srcUnitId: src,
});
const aura = (
  event: string,
  id: string,
  name: string,
  s: number,
  src: string,
) => ({
  timestamp: at(s),
  logLine: { event, timestamp: at(s) },
  spellId: id,
  spellName: name,
  srcUnitId: src,
  destUnitId: "u",
});

/** a death at `deathS` ends a Solo Shuffle round; a 3v3 round keeps the
 * log's end (`roundEndMs`) */
function scan(
  sec: number,
  cc: string,
  unit: any,
  round: { deathS?: number; bracket?: string } = {},
): number {
  let n = 0;
  const units = [
    { id: "u", reaction: 1, ...unit },
    { id: "e1", reaction: 2 },
    { id: "e2", reaction: 2 },
  ];
  const mm = Math.floor(sec / 60);
  const ss = String(sec % 60).padStart(2, "0");
  run({
    lines: [`  ${mm}:${ss}  [RES] rdy:—  cc:${cc}`],
    start: START,
    roundEndAt: round.deathS === undefined ? at(600) : at(round.deathS),
    legacy: {
      endTime: at(600),
      startInfo: { bracket: round.bracket ?? "Rated Solo Shuffle" },
      units:
        round.deathS === undefined
          ? []
          : [{ info: {}, deathRecords: [{ timestamp: at(round.deathS) }] }],
    },
    units,
    unitOfPid: (pid: string) => (pid === "1" ? units[0] : undefined),
    bump: () => {},
    violate: () => n++,
  } as any);
  return n;
}

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("resCcConcurrentDropped", () => {
  it("a second Wind Shear lockout is not covered by the first one's entry", () => {
    const u = { actionIn: [kick("e1", 9.5, "116"), kick("e2", 9.9, "2061")] };
    expect(scan(10, "1/Wind Shear-1s[kick]", u)).toBe(1);
    expect(scan(10, "1/Wind Shear-1s[kick],1/Wind Shear-1s[kick]", u)).toBe(0);
  });

  it("a row the log wrote twice is one interrupt", () => {
    const u = { actionIn: [kick("e1", 9, "116"), kick("e1", 9, "116")] };
    expect(scan(10, "1/Wind Shear-1s[kick]", u)).toBe(0);
  });

  it("another caster's longer Frost Nova is not covered by the listed one", () => {
    const u = {
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, FROST_NOVA, "Frost Nova", 9, "e1"),
        aura(LogEvent.SPELL_AURA_REMOVED, FROST_NOVA, "Frost Nova", 11.5, "e1"),
        aura(LogEvent.SPELL_AURA_APPLIED, FROST_NOVA, "Frost Nova", 9.5, "e2"),
        aura(LogEvent.SPELL_AURA_REMOVED, FROST_NOVA, "Frost Nova", 16.5, "e2"),
      ],
    };
    expect(scan(10, "1/Frost Nova-1s[root]", u)).toBe(1);
    expect(scan(10, "1/Frost Nova-6s[root]", u)).toBe(0);
  });

  it("a root with no end row runs its official length, not forever", () => {
    const u = {
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, ROOTS, "Entangling Roots", 1, "e1"),
        aura(LogEvent.SPELL_AURA_APPLIED, FROST_NOVA, "Frost Nova", 28, "e2"),
        aura(LogEvent.SPELL_AURA_REMOVED, FROST_NOVA, "Frost Nova", 31, "e2"),
      ],
    };
    expect(scan(30, "1/Frost Nova-<1s[root]", u)).toBe(0);
  });

  it("matches by the producer's rounding: a wrong `1s` does not cover the 1.8 s Nova (codex 85-tk-L-T102-1b #1)", () => {
    const u = {
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, FROST_NOVA, "Frost Nova", 8, "e1"),
        aura(LogEvent.SPELL_AURA_REMOVED, FROST_NOVA, "Frost Nova", 11.1, "e1"),
        aura(LogEvent.SPELL_AURA_APPLIED, FROST_NOVA, "Frost Nova", 9, "e2"),
        aura(LogEvent.SPELL_AURA_REMOVED, FROST_NOVA, "Frost Nova", 11.8, "e2"),
      ],
    };
    expect(scan(10, "1/Frost Nova-1s[root]", u)).toBe(1);
    expect(scan(10, "1/Frost Nova-2s[root]", u)).toBe(0);
  });

  it("the round's end bounds every instance (codex 85-tk-L-T102-1b #2)", () => {
    const u = {
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, FROST_NOVA, "Frost Nova", 8, "e1"),
        aura(LogEvent.SPELL_AURA_REMOVED, FROST_NOVA, "Frost Nova", 11.5, "e1"),
        aura(LogEvent.SPELL_AURA_APPLIED, FROST_NOVA, "Frost Nova", 9, "e2"),
        aura(LogEvent.SPELL_AURA_REMOVED, FROST_NOVA, "Frost Nova", 12.5, "e2"),
      ],
    };
    expect(scan(10, "1/Frost Nova-1s[root]", u, { deathS: 11.1 })).toBe(0);
  });

  it("of two Novas that both render `2s`, the listed one is the longer (codex 85-tk-L-T102-1c #1)", () => {
    const u = {
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, FROST_NOVA, "Frost Nova", 8, "e1"),
        aura(LogEvent.SPELL_AURA_REMOVED, FROST_NOVA, "Frost Nova", 11.6, "e1"),
        aura(LogEvent.SPELL_AURA_APPLIED, FROST_NOVA, "Frost Nova", 9, "e2"),
        aura(LogEvent.SPELL_AURA_REMOVED, FROST_NOVA, "Frost Nova", 12.4, "e2"),
      ],
    };
    expect(scan(10, "1/Frost Nova-2s[root]", u)).toBe(0);
  });

  it("a 3v3 death does not end the round for the roots (codex 85-tk-L-T102-1c #2)", () => {
    const u = {
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, FROST_NOVA, "Frost Nova", 8, "e1"),
        aura(LogEvent.SPELL_AURA_REMOVED, FROST_NOVA, "Frost Nova", 11.5, "e1"),
        aura(LogEvent.SPELL_AURA_APPLIED, FROST_NOVA, "Frost Nova", 9, "e2"),
        aura(LogEvent.SPELL_AURA_REMOVED, FROST_NOVA, "Frost Nova", 12.5, "e2"),
      ],
    };
    const threes = { deathS: 11.1, bracket: "Rated Arena 3v3" };
    expect(scan(10, "1/Frost Nova-2s[root]", u, threes)).toBe(1);
    expect(scan(10, "1/Frost Nova-3s[root]", u, threes)).toBe(0);
  });

  it("a kick keeps its full lockout past the round's end (codex 85-tk-L-T102-1c #3)", () => {
    const u = { actionIn: [kick("e1", 9.5, "116"), kick("e2", 9.9, "2061")] };
    expect(scan(10, "1/Wind Shear-1s[kick]", u, { deathS: 10.1 })).toBe(1);
  });
});

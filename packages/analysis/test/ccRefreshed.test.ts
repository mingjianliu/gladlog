/**
 * F06c — a control REFRESHed inside one APPLIED → REMOVED. A refresh its
 * source cast for starts a new instance (ruling A51, F-RF1); one with no
 * cast of its id behind it stays inside the instance — and is now carried
 * on it (`refreshedAtSeconds`), so the line can say the length printed runs
 * across a refresh. No window is cut and no DR level moves.
 */
import { CombatUnitReaction, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  analyzePlayerCCAndTrinket,
  CC_LOGGED_END_NOTE_RE_SRC,
  CC_REFRESHED_NOTE_RE_SRC,
  formatCcRefreshed,
} from "../src/utils/ccTrinketAnalysis";
import { fmtTime } from "../src/utils/renderGrid";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const START = 1_000_000;
const TERROR = "372245"; // Terror of the Skies — applied by Deep Breath (433874)
const DEEP_BREATH = "433874";
const aura = (event: LogEvent, spellId: string, s: number) => ({
  ...makeAuraEvent(event, spellId, START + s * 1000, "e1", "v"),
  event,
  spellName: spellId,
});
const combat = {
  startTime: START,
  endTime: START + 300_000,
  startInfo: { zoneId: "1672" },
};
const evoker = (castId: string, castAtS: number[]) =>
  makeUnit("e1", {
    reaction: CombatUnitReaction.Hostile,
    spellCastEvents: castAtS.map((s) =>
      makeSpellCastEvent(castId, START + s * 1000, "", "", "e1"),
    ),
  });
// 5c48e842 r6: APPLIED, REFRESH 2.935 s in, REMOVED 1.503 s after that; the
// evoker's Deep Breath rows 3.03 s before the APPLIED and 1.23 s before the
// REFRESH
const refreshed = [
  aura(LogEvent.SPELL_AURA_APPLIED, TERROR, 95.9),
  aura(LogEvent.SPELL_AURA_REFRESH, TERROR, 98.835),
  aura(LogEvent.SPELL_AURA_REMOVED, TERROR, 100.338),
  // a later stun in the same DR family, for the chain
  aura(LogEvent.SPELL_AURA_APPLIED, TERROR, 110),
  aura(LogEvent.SPELL_AURA_REMOVED, TERROR, 111.5),
];
const ccOf = (
  auraEvents: unknown[],
  caster = evoker(DEEP_BREATH, [92.87, 97.6]),
) =>
  analyzePlayerCCAndTrinket(
    makeUnit("v", { auraEvents: auraEvents as never }),
    [caster],
    combat,
  ).ccInstances;

describe("a refresh with no cast of its id behind it stays inside the instance, and is carried on it", () => {
  it("Terror of the Skies: one instance across the refresh, with the refresh's second", () => {
    const cc = ccOf(refreshed);
    expect(cc).toHaveLength(2);
    expect(cc[0]!.durationSeconds).toBeCloseTo(4.438, 3);
    expect(cc[0]!.refreshedAtSeconds).toEqual([98.835]);
    expect(cc[1]!.refreshedAtSeconds).toBeUndefined();
  });

  it("DR accounting is what it was: the same instances and levels as with the REFRESH row taken out", () => {
    const withRow = ccOf(refreshed);
    const withoutRow = ccOf(
      refreshed.filter((a) => a.event !== LogEvent.SPELL_AURA_REFRESH),
    );
    const view = (cs: typeof withRow) =>
      cs.map((c) => [c.atSeconds, c.durationSeconds, c.drInfo?.level]);
    expect(view(withRow)).toEqual(view(withoutRow));
    expect(withRow.map((c) => c.drInfo?.level)).toEqual(["Full", "50%"]);
  });

  it("a refresh the source cast its own id for still starts a new instance (A51) — and neither part carries a refresh", () => {
    const cc = ccOf(refreshed, evoker(TERROR, [95.8, 98.7]));
    expect(cc.map((c) => Math.round(c.durationSeconds * 10) / 10)).toEqual([
      2.9, 1.5, 1.5,
    ]);
    expect(cc.every((c) => c.refreshedAtSeconds === undefined)).toBe(true);
  });

  it("a refresh at the instance's own end is not inside it", () => {
    const cc = ccOf([
      aura(LogEvent.SPELL_AURA_APPLIED, TERROR, 95.9),
      aura(LogEvent.SPELL_AURA_REFRESH, TERROR, 98.9),
      aura(LogEvent.SPELL_AURA_REMOVED, TERROR, 98.9),
    ]);
    expect(cc).toHaveLength(1);
    expect(cc[0]!.refreshedAtSeconds).toBeUndefined();
  });
});

describe("formatCcRefreshed", () => {
  it("says where the refresh is and that the length runs across it; the DR half only on a line that prints a DR", () => {
    const cc = { refreshedAtSeconds: [98.835] };
    expect(formatCcRefreshed(cc, fmtTime, true)).toBe(
      " | refreshed at 1:38 — the length printed runs across it; the DR shown is from when it first landed",
    );
    expect(formatCcRefreshed(cc, fmtTime, false)).toBe(
      " | refreshed at 1:38 — the length printed runs across it",
    );
    expect(
      formatCcRefreshed({ refreshedAtSeconds: [98.8, 101.2] }, fmtTime, false),
    ).toBe(" | refreshed at 1:38, 1:41 — the length printed runs across it");
    expect(formatCcRefreshed({}, fmtTime, true)).toBe("");
  });

  it("the gates' patterns read it — alone and in front of an end clause", () => {
    const note = formatCcRefreshed(
      { refreshedAtSeconds: [98.8] },
      fmtTime,
      true,
    );
    expect(new RegExp(`^${CC_REFRESHED_NOTE_RE_SRC}$`).test(note)).toBe(true);
    const tail = new RegExp(`^${CC_LOGGED_END_NOTE_RE_SRC}$`);
    expect(tail.test(note)).toBe(true);
    expect(tail.test(`${note} | ended at their death`)).toBe(true);
    expect(tail.test(" | refreshed at 1:38")).toBe(false);
  });
});

/**
 * `hasOffensiveSpellActive` pairs an aura's APPLIED with its REMOVED per
 * source (fix-F16 fact2Scan offensiveTag, 5-2 2:55): two mages' Touch of the
 * Magi on one monk are two debuffs, and the first one's REMOVED does not end
 * the second.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { hasOffensiveSpellActive } from "../src/utils/cooldowns";
import { makeAuraEvent, makeUnit } from "./ported/testHelpers";

const TOTM = "210824";
const s = (sec: number) => 1_000_000 + sec * 1000;
const totm = (ev: LogEvent, sec: number, src: string) =>
  makeAuraEvent(ev, TOTM, s(sec), src, "monk", "DEBUFF");
const monk = makeUnit("monk", {
  name: "Monk",
  auraEvents: [
    totm(LogEvent.SPELL_AURA_APPLIED, 0, "mageA"),
    totm(LogEvent.SPELL_AURA_APPLIED, 6, "mageB"),
    totm(LogEvent.SPELL_AURA_REMOVED, 12, "mageA"),
    totm(LogEvent.SPELL_AURA_REMOVED, 18, "mageB"),
  ],
});
const friends = new Set(["mageA", "mageB"]);

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("hasOffensiveSpellActive — one run per aura and source", () => {
  it("the second mage's Touch of the Magi is up after the first one's REMOVED", () => {
    expect(hasOffensiveSpellActive(monk as never, s(13), friends)).toBe(true);
    expect(hasOffensiveSpellActive(monk as never, s(19), friends)).toBe(false);
  });
  it("a source filter that admits only the first mage sees its run end", () => {
    expect(
      hasOffensiveSpellActive(monk as never, s(13), new Set(["mageA"])),
    ).toBe(false);
  });
});

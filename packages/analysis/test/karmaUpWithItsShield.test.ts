/**
 * B2 (user 2026-10-24): Touch of Karma is "up" while its shield is — every
 * reader of `buildAuraIntervals` gets the marker (122470) ended where the
 * shield aura (125174) of the same press came off (2abc9185 shape: shield
 * eaten through 3.0 s in, marker 10.0 s).
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { buildAuraIntervals } from "../src/utils/auraIntervals";
import { makeAuraEvent, makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const at = (s: number) => T0 + s * 1000;
const combat = { startTime: T0, endTime: at(60) };
const on = (id: string, s: number) =>
  makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, id, at(s), "monk", "monk", "BUFF");
const off = (id: string, s: number) =>
  makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, id, at(s), "monk", "monk", "BUFF");
const karma = (ivs: ReturnType<typeof buildAuraIntervals>) =>
  ivs.filter((iv) => iv.spellId === "122470").map((iv) => [iv.fromS, iv.toS]);

describe("Touch of Karma ends with its shield", () => {
  it("the marker ends where the shield came off", () => {
    const monk = makeUnit("monk", {
      auraEvents: [on("122470", 20), on("125174", 20), off("125174", 23), off("122470", 30)],
    });
    expect(karma(buildAuraIntervals(monk, combat))).toEqual([[20, 23]]);
  });
  it("a shield that lasted keeps the marker's end; no shield aura keeps the marker", () => {
    const lasted = makeUnit("monk", {
      auraEvents: [on("122470", 20), on("125174", 20), off("125174", 30.01), off("122470", 30)],
    });
    expect(karma(buildAuraIntervals(lasted, combat))).toEqual([[20, 30]]);
    const bare = makeUnit("monk", {
      auraEvents: [on("122470", 20), off("122470", 30)],
    });
    expect(karma(buildAuraIntervals(bare, combat))).toEqual([[20, 30]]);
  });
  it("the marker takes the shield's end whole: inferred or not, and where its cap was counted from (T84, codex 85-tk-G-T84-1d)", () => {
    const refresh = makeAuraEvent(
      LogEvent.SPELL_AURA_REFRESH, "122470", at(15), "monk", "monk", "BUFF",
    );
    // neither removal logged, only the marker refreshed: the shield caps
    // from its own application, and the marker's end is that cap
    const open = makeUnit("monk", {
      auraEvents: [on("122470", 10), on("125174", 10), refresh],
    });
    const ivs = buildAuraIntervals(open, combat);
    const shield = ivs.find((iv) => iv.spellId === "125174")!;
    const marker = ivs.find((iv) => iv.spellId === "122470")!;
    expect(shield.inferredEnd).toBe(true);
    expect(shield.capFromS).toBe(10);
    expect([marker.toS, marker.inferredEnd, marker.capFromS]).toEqual([
      shield.toS, true, 10,
    ]);
    // a marker with no logged end, ended by a shield the log closed: no cap
    const closed = makeUnit("monk", {
      auraEvents: [on("122470", 20), on("125174", 20), off("125174", 23)],
    });
    const m2 = buildAuraIntervals(closed, combat).find(
      (iv) => iv.spellId === "122470",
    )!;
    expect([m2.toS, m2.inferredEnd, "capFromS" in m2]).toEqual([23, false, false]);
    // a logged marker shortened by an inferred shield gains the shield's anchor
    const short = makeUnit("monk", {
      auraEvents: [on("122470", 30), on("125174", 30), off("122470", 58)],
    });
    const ivs3 = buildAuraIntervals(short, combat);
    const s3 = ivs3.find((iv) => iv.spellId === "125174")!;
    const m3 = ivs3.find((iv) => iv.spellId === "122470")!;
    if (s3.toS < 58)
      expect([m3.inferredEnd, m3.capFromS]).toEqual([true, 30]);
  });
  it("a second press pairs with its own shield", () => {
    const monk = makeUnit("monk", {
      auraEvents: [
        on("122470", 10), on("125174", 10), off("125174", 12), off("122470", 20),
        on("122470", 40), on("125174", 40), off("125174", 45), off("122470", 50),
      ],
    });
    expect(karma(buildAuraIntervals(monk, combat))).toEqual([[10, 12], [40, 45]]);
  });
});

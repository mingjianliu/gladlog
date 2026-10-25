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

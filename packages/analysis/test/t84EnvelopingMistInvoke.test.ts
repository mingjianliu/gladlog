/**
 * T84 (GH #123 item 16): an Enveloping Mist applied while the monk's Invoke
 * Yu'lon / Chi-Ji is running lasts 4 s longer (`CASTER_WINDOW_DURATIONS`).
 * The one duration predicate adds it when it is given the application's
 * time; a holder of Gift of the Celestials, or a monk whose talents cannot
 * be read, is not lengthened.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

import { CASTER_WINDOW_DURATIONS } from "../src/data/casterWindowDurations";
import { ensureAnalysisData } from "../src/data/ensure";
import { buffFullDurationForCaster } from "../src/utils/buffDuration";
import { makeSpellCastEvent } from "./ported/testHelpers";

vi.mock("../src/utils/talentOwnership", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/utils/talentOwnership")>()),
  talentModifierOwnershipOf: (
    unit: { info: { holds: string[]; unknown?: string[] } },
    talentSpellId: string,
  ) =>
    unit.info.unknown?.includes(talentSpellId)
      ? "unknown"
      : unit.info.holds.includes(talentSpellId)
        ? "yes"
        : "no",
  talentRankOf: (unit: { info: { holds: string[] } }, talentSpellId: string) =>
    unit.info.holds.includes(talentSpellId) ? 1 : 0,
}));

const T0 = 1_700_000_000_000;
const at = (s: number) => T0 + Math.round(s * 1000);
const MIST = "124682";
const MIST_WRAP = "197900";
const GIFT = "388212";

const monk = (
  invokeId: string | undefined,
  invokeAtS: number,
  holds: string[] = [MIST_WRAP],
  unknown: string[] = [],
) =>
  ({
    spec: "270",
    info: { holds, unknown },
    spellCastEvents:
      invokeId === undefined
        ? []
        : [makeSpellCastEvent(invokeId, at(invokeAtS), "monk")],
  }) as never;

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("T84 — Enveloping Mist inside the monk's Invoke window", () => {
  it("the base is Mist Wrap's 7 s, with or without an application time", () => {
    expect(buffFullDurationForCaster(MIST, monk(undefined, 0))).toBe(7);
    expect(buffFullDurationForCaster(MIST, monk(undefined, 0), at(20))).toBe(7);
  });

  it.each(CASTER_WINDOW_DURATIONS[MIST]!.windowCastIds)(
    "applied while Invoke %s runs: 11 s",
    (invokeId) => {
      const m = monk(invokeId, 10);
      const windowS = buffFullDurationForCaster(invokeId, m)!;
      expect(windowS).toBe(25);
      expect(buffFullDurationForCaster(MIST, m, at(10))).toBe(11);
      expect(buffFullDurationForCaster(MIST, m, at(10 + windowS))).toBe(11);
    },
  );

  it("applied before the press or after its length: 7 s", () => {
    const m = monk("325197", 10);
    expect(buffFullDurationForCaster(MIST, m, at(9.9))).toBe(7);
    expect(buffFullDurationForCaster(MIST, m, at(35.1))).toBe(7);
  });

  it("no application time: the plain length", () => {
    expect(buffFullDurationForCaster(MIST, monk("325197", 10))).toBe(7);
  });

  it("a Gift of the Celestials holder is not lengthened, nor a monk whose talents cannot be read", () => {
    expect(
      buffFullDurationForCaster(
        MIST,
        monk("325197", 10, [MIST_WRAP, GIFT]),
        at(12),
      ),
    ).toBe(7);
    expect(
      buffFullDurationForCaster(
        MIST,
        monk("325197", 10, [MIST_WRAP], [GIFT]),
        at(12),
      ),
    ).toBe(7);
  });

  it("casts stored out of time order: an Invoke after a later-stamped cast still counts (codex 85-tk-G-T84-1 #1)", () => {
    const m = {
      spec: "270",
      info: { holds: [MIST_WRAP], unknown: [] },
      spellCastEvents: [
        makeSpellCastEvent("116670", at(10.01), "monk"),
        makeSpellCastEvent("325197", at(10), "monk"),
      ],
    } as never;
    expect(buffFullDurationForCaster(MIST, m, at(10.005))).toBe(11);
  });
});

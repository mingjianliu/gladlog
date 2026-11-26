/**
 * Pipeline T281 — a cast that landed before the immunity or the wall is not
 * a cast into it. The corpus check is `packages/eval/scripts/scan5/t281.ts`.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  PRESS_LANDED_SAME_INSTANT_MS,
  pressImmuneMissRows,
  pressLandedOn,
  refusedComponentLandedBefore,
} from "../src/utils/castMissRows";
import {
  landedBeforeWallRow,
  pressLandingRows,
  refusedByAnotherAura,
} from "../src/utils/offensiveWasteAnalysis";

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("T281 — the refused component had landed there before", () => {
  // audit-1215 17 D1 (0d211b8b r1): Merithra's Blessing 1256581 pressed
  // 92.744, healed the target 93.125, Cyclone on the target 93.189, a later
  // pulse IMMUNE 93.880
  const MERITHRA = "1256581";
  const row = (
    ms: number,
    spellId = MERITHRA,
    event = LogEvent.SPELL_HEAL,
  ) => ({
    spellId,
    spellName: "Merithra's Blessing",
    destUnitId: "T",
    timestamp: ms,
    logLine: { event, timestamp: ms },
  });
  const before = (rows: unknown[], castMs = 92_744, same = [92_744]) =>
    refusedComponentLandedBefore(
      rows as never,
      MERITHRA,
      same,
      castMs,
      "T",
      93_880,
    );
  it("its own id healed 755 ms before the refusal", () => {
    expect(before([row(93_125)])).toBe(true);
  });
  it("another component's hit is one press with one part refused", () => {
    // c3cb3e72 1:11: Eviscerate's Shadow part 328082 hit under a Blessing
    // of Protection already up, its physical 196819 was refused 139 ms later
    expect(before([row(93_125, "328082", LogEvent.SPELL_DAMAGE)])).toBe(false);
  });
  it("a row before the cast row is the previous press's", () => {
    // 0a118f43 4:41: a Throw Glaive in flight hit 81 ms before the next cast
    expect(before([row(92_744 - 81)])).toBe(false);
    expect(before([row(92_744)])).toBe(true);
  });
  it("an absorbed or periodic row, a row in or after the refusal's instant, a row of an earlier press", () => {
    // 504abea0 2:32: an absorbed Deep Breath tick writes a SPELL_ABSORBED
    expect(before([row(93_125, MERITHRA, LogEvent.SPELL_ABSORBED)])).toBe(
      false,
    );
    expect(before([row(93_125, MERITHRA, LogEvent.SPELL_PERIODIC_HEAL)])).toBe(
      false,
    );
    expect(before([row(93_880 - PRESS_LANDED_SAME_INSTANT_MS)])).toBe(false);
    expect(before([row(93_125)], 93_500, [92_744, 93_500])).toBe(false);
  });
  it("the same-instant reading is unchanged: only the refusal's own instant", () => {
    const landed = (ms: number) =>
      pressLandedOn(
        [row(ms)] as never,
        MERITHRA,
        "Merithra's Blessing",
        [92_744],
        92_744,
        "T",
        93_880,
      );
    expect(landed(93_125)).toBe(false);
    expect(landed(93_880)).toBe(true);
  });
  it("the press's refusal reading drops the row, and keeps it with no such row", () => {
    const immune = {
      spellId: MERITHRA,
      missType: "IMMUNE",
      destUnitId: "T",
      timestamp: 93_880,
      logLine: { event: LogEvent.SPELL_MISSED },
    };
    const rows = (hits: unknown[]) =>
      pressImmuneMissRows(
        [immune],
        MERITHRA,
        [92_744],
        92_744,
        undefined,
        hits as never,
      );
    expect(rows([row(93_125)])).toHaveLength(0);
    expect(rows([])).toHaveLength(1);
    expect(rows([row(93_125, "328082", LogEvent.SPELL_DAMAGE)])).toHaveLength(
      1,
    );
  });
});

describe("T281 — a landing row before the wall's APPLIED row in one millisecond", () => {
  // audit-1215 10 D1 (50b433c2 r5): Wrath's damage row and Ironbark's
  // APPLIED both at 20:10:57.795, the Wrath logged first
  it("the log's order decides inside the wall's opening millisecond", () => {
    expect(landedBeforeWallRow({ atMs: 5_000, lineIndex: 10 }, 5_000, 11)).toBe(
      true,
    );
    expect(landedBeforeWallRow({ atMs: 5_000, lineIndex: 12 }, 5_000, 11)).toBe(
      false,
    );
  });
  it("another millisecond, or no line number on either side, keeps the instant's reading", () => {
    expect(landedBeforeWallRow({ atMs: 5_001, lineIndex: 10 }, 5_000, 11)).toBe(
      false,
    );
    expect(landedBeforeWallRow({ atMs: 5_000 }, 5_000, 11)).toBe(false);
    expect(
      landedBeforeWallRow({ atMs: 5_000, lineIndex: 10 }, 5_000, undefined),
    ).toBe(false);
  });
});

describe("T281 — an IMMUNE landing under a damage-reduction wall", () => {
  const IRONBARK = "102342";
  const ICE_BLOCK = "45438";
  const DISPERSION = "47585";
  it("a Starsurge refused under Ironbark while Ice Block was up went into the Ice Block", () => {
    expect(
      refusedByAnotherAura(IRONBARK, { immune: true }, [ICE_BLOCK], false),
    ).toBe(true);
  });
  it("…or while a damage-immune control (Cyclone) was on the target", () => {
    expect(refusedByAnotherAura(IRONBARK, { immune: true }, [], true)).toBe(
      true,
    );
  });
  it("with nothing else up the refusal may be the wall's own: a root into Dispersion stays", () => {
    // codex 85-tk-L6-T281-1 #4 (05ea5983: Entangling Roots IMMUNE)
    expect(refusedByAnotherAura(DISPERSION, { immune: true }, [], false)).toBe(
      false,
    );
    expect(
      refusedByAnotherAura(DISPERSION, { immune: true }, [DISPERSION], false),
    ).toBe(false);
  });
  it("a landing that is no outright refusal stays the wall's", () => {
    expect(refusedByAnotherAura(IRONBARK, {}, [ICE_BLOCK], true)).toBe(false);
  });
  it("an immunity keeps its own refusals", () => {
    expect(
      refusedByAnotherAura(ICE_BLOCK, { immune: true }, [ICE_BLOCK], false),
    ).toBe(false);
  });
});

describe("T281 — a refused component beside a hit is no outright refusal", () => {
  // b3dea9f6 0:12: Rake's stun 163505 IMMUNE, its damage 1822 16 ms later
  const press = { spellId: "1822", spellName: "Rake", destUnitId: "T" };
  const landing = (damageMs: number | null) =>
    pressLandingRows(
      [press],
      () => 12_000,
      {
        id: "C",
        damageOut:
          damageMs === null
            ? []
            : [
                {
                  spellId: "1822",
                  spellName: "Rake",
                  destUnitId: "T",
                  logLine: {
                    event: LogEvent.SPELL_DAMAGE,
                    timestamp: damageMs,
                  },
                },
              ],
        missesOut: [
          {
            spellId: "163505",
            spellName: "Rake",
            destUnitId: "T",
            missType: "IMMUNE",
            timestamp: 12_050,
            logLine: { event: LogEvent.SPELL_MISSED, timestamp: 12_050 },
          },
        ],
      } as never,
      [],
    ).get(press)!;
  it("the stun's IMMUNE with the damage 16 ms later: the press landed", () => {
    expect(landing(12_066).immune).toBeUndefined();
  });
  it("the IMMUNE alone, or with a hit a second later: refused outright", () => {
    expect(landing(null).immune).toBe(true);
    expect(landing(13_100).immune).toBe(true);
  });
});

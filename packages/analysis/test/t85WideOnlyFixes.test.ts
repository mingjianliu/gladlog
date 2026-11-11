/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * T85: three product readings that only the wide capture exercised.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { AURA_PRESS_BY_ERA } from "../src/utils/auraActivationEra";
import { pressRowOfLedgerId } from "../src/utils/castPress";
import { unreleasedHoldMs } from "../src/utils/cooldowns";
import {
  hiddenAuraLifeMs,
  hiddenPressMs,
  relistedRunAt,
  RESYNC_BATCH_MIN_APPLIED,
} from "../src/utils/hiddenPress";
import {
  LOG_ZONE_UNCERTAINTY_MS,
  logDatedAt,
  PATCH_1215_ZONE_BAND_TAKES,
} from "../src/utils/logEra";
import {
  OVERRIDE_VARIANT_SHARES_BY_ERA,
  variantSharesCooldownAt,
} from "../src/utils/overrideVariantEra";
import { PATCH_1215_GOLIVE_EPOCH_MS, talentsOf } from "../src/utils/talents";

const T0 = 1_000_000;

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("a run listed twice before its REMOVED is no press (T85, wide s0/68 r1)", () => {
  const EVASION = "5277";
  const aura = (
    event: LogEvent,
    id: string,
    ms: number,
    src = "rogue",
  ): any => ({
    spellId: id,
    spellName: id,
    srcUnitId: src,
    destUnitId: "rogue",
    timestamp: ms,
    logLine: { event, timestamp: ms },
  });
  /** the batch that re-states the unit, the aura among its rows */
  const batch = (ms: number): any[] => [
    ...Array.from({ length: RESYNC_BATCH_MIN_APPLIED + 4 }, (_, i) =>
      aura(LogEvent.SPELL_AURA_APPLIED, String(900_000 + i), ms, "x"),
    ),
    aura(LogEvent.SPELL_AURA_APPLIED, EVASION, ms),
  ];
  const unitOf = (rows: any[]): any => ({
    id: "rogue",
    name: "rogue",
    auraEvents: rows,
    spellCastEvents: [
      {
        spellId: EVASION,
        logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: T0 + 20_000 },
      },
    ],
  });

  it("listed past its official length, listed again, then off: neither row is a press", () => {
    const pressMs = T0 + 20_000;
    const life = hiddenAuraLifeMs(EVASION, unitOf([]), pressMs);
    const first = pressMs + life + 2_000;
    const second = first + 900;
    const u = unitOf([
      aura(LogEvent.SPELL_AURA_APPLIED, EVASION, pressMs),
      ...batch(first),
      ...batch(second),
      aura(LogEvent.SPELL_AURA_REMOVED, EVASION, second + 1_000),
    ]);
    expect(hiddenPressMs(u, EVASION, T0)).toEqual([]);
    expect(relistedRunAt(u, EVASION, first)).toBe(true);
    expect(relistedRunAt(u, EVASION, second)).toBe(true);
  });

  it("a row whose own REMOVED comes a full life later is a press", () => {
    const pressMs = T0 + 20_000;
    const life = hiddenAuraLifeMs(EVASION, unitOf([]), pressMs);
    const first = pressMs + life + 2_000;
    const u = unitOf([
      aura(LogEvent.SPELL_AURA_APPLIED, EVASION, pressMs),
      ...batch(first),
      aura(LogEvent.SPELL_AURA_REMOVED, EVASION, first + life),
    ]);
    expect(hiddenPressMs(u, EVASION, T0)).toEqual([first]);
    expect(relistedRunAt(u, EVASION, first)).toBe(false);
  });

  it("an application after a REMOVED re-lists nothing", () => {
    const u = unitOf([
      aura(LogEvent.SPELL_AURA_APPLIED, EVASION, T0 + 20_000),
      aura(LogEvent.SPELL_AURA_REMOVED, EVASION, T0 + 25_000),
      aura(LogEvent.SPELL_AURA_APPLIED, EVASION, T0 + 40_000),
      aura(LogEvent.SPELL_AURA_REMOVED, EVASION, T0 + 41_000),
    ]);
    expect(relistedRunAt(u, EVASION, T0 + 40_000)).toBe(false);
  });
});

describe("the press row of a ledger id under an override variant (T85, wide s2/34 r16)", () => {
  const THE_HUNT = "1246167";
  const row = (spellId: string, spellName: string, ms: number): any => ({
    spellId,
    spellName,
    destUnitId: "enemy",
    logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: ms },
  });
  it("Predator's Wake is The Hunt's press when no The Hunt row is beside it", () => {
    const wake = row("1259431", "Predator's Wake", T0);
    // The Hunt's own impact row, outside the tolerance
    const impact = row("1246169", "The Hunt", T0 + 300);
    expect(pressRowOfLedgerId([wake, impact], THE_HUNT, T0, 100)).toBe(wake);
  });
  it("a row of the button's own name beside it still comes first", () => {
    const wake = row("1259431", "Predator's Wake", T0);
    const impact = row("1246169", "The Hunt", T0);
    expect(pressRowOfLedgerId([wake, impact], THE_HUNT, T0, 100)).toBe(impact);
  });
  it("an unrelated row is not the press", () => {
    expect(
      pressRowOfLedgerId([row("198013", "Eye Beam", T0)], THE_HUNT, T0, 100),
    ).toBeUndefined();
  });
});

describe("a hold the log never closed, begun again, spent no cooldown (T85, wide s0/106 r4)", () => {
  const SURGE = "359073";
  const start = (ms: number): any => ({
    spellId: SURGE,
    spellName: "Eternity Surge",
    timestamp: ms,
    logLine: { event: "SPELL_EMPOWER_START", timestamp: ms },
  });
  const end = (ms: number): any => ({
    spellId: SURGE,
    spellName: "Eternity Surge",
    timestamp: ms,
    level: 1,
    logLine: { event: "SPELL_EMPOWER_END", timestamp: ms },
  });
  const evoker = (starts: any[], ends: any[]): any => ({
    id: "evoker",
    name: "evoker",
    spellCastEvents: [],
    empowerStarts: starts,
    empowerEnds: ends,
    empowerInterrupts: [],
    damageOut: [
      {
        srcUnitId: "evoker",
        spellId: "359077",
        logLine: { event: "SPELL_DAMAGE", timestamp: T0 + 2_000 },
      },
    ],
    missesOut: [],
  });
  it("START with no END, START again 0.9 s later: the first is unreleased", () => {
    const u = evoker([start(T0), start(T0 + 900)], [end(T0 + 1_700)]);
    expect(unreleasedHoldMs(u, SURGE, [T0, T0 + 900])).toEqual([T0]);
  });
  it("the next START long after it says nothing about the first", () => {
    const u = evoker([start(T0), start(T0 + 30_000)], [end(T0 + 30_800)]);
    expect(unreleasedHoldMs(u, SURGE, [T0])).toEqual([]);
  });
});

// A log dated inside the zone uncertainty before the 12.1.5 go-live reads as
// 12.1.0 for every reader of that cutover (PATCH_1215_ZONE_BAND_TAKES).
describe("T85 12.1.5 上线前不确定带内的日志按 12.1.0 读", () => {
  const inBand = PATCH_1215_GOLIVE_EPOCH_MS - LOG_ZONE_UNCERTAINTY_MS / 2;
  it("Predator's Wake 是自己的冷却,不占 The Hunt", () => {
    expect(variantSharesCooldownAt("1259431", inBand)).toBe(false);
    expect(variantSharesCooldownAt("1259431", PATCH_1215_GOLIVE_EPOCH_MS)).toBe(
      true,
    );
    expect(variantSharesCooldownAt("1259431", undefined)).toBe(true);
  });
  it("这个切换点的每个读者都点名同一侧", () => {
    expect(PATCH_1215_ZONE_BAND_TAKES).toBe("before");
    for (const row of [
      ...Object.values(OVERRIDE_VARIANT_SHARES_BY_ERA),
      ...Object.values(AURA_PRESS_BY_ERA),
    ])
      if (row.cutoverEpochMs === PATCH_1215_GOLIVE_EPOCH_MS)
        expect(logDatedAt(row, inBand)).toBe(row.before);
    expect(variantSharesCooldownAt("1259431", Number.NaN)).toBe(true);
  });
  it("天赋表按 12.1.0 的条目读(交换过的条目换回)", () => {
    const unit = {
      info: { talents: [{ id1: 103900, id2: 103733, count: 1 }] },
      spellCastEvents: [{ logLine: { timestamp: inBand } }],
      auraEvents: [],
    };
    expect(talentsOf(unit)?.[0]).toMatchObject({ id1: 82612, id2: 103745 });
  });
});

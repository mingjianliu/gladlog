/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * fact3 D35 (5f4142ec r1): a save pressed while its holder was unseen — its
 * aura new in the batch that re-states the unit, no press row — is a press
 * (`hiddenPressMs`), on the `[ENEMY DEF]` / KILL ATTEMPTS path too
 * (`selfSaveCasts`).
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { selfSaveCasts } from "../src/utils/enemyDefensives";
import { hiddenPressMs } from "../src/utils/hiddenPress";

const T0 = 1_000_000;
const EVASION = "5277";
const BATCH_MS = T0 + 70_516;

const aura = (event: LogEvent, id: string, ms: number, src = "rogue"): any => ({
  spellId: id,
  spellName: id,
  srcUnitId: src,
  destUnitId: "rogue",
  timestamp: ms,
  logLine: { event, timestamp: ms },
});
/** the re-stating batch: `n` APPLIED rows on the rogue in one ms */
const batch = (n: number, withEvasion = true): any[] => [
  ...Array.from({ length: n - (withEvasion ? 1 : 0) }, (_, i) =>
    aura(LogEvent.SPELL_AURA_APPLIED, String(900_000 + i), BATCH_MS, "x"),
  ),
  ...(withEvasion
    ? [aura(LogEvent.SPELL_AURA_APPLIED, EVASION, BATCH_MS)]
    : []),
];
const rogue = (auraEvents: any[], casts: any[] = []): any => ({
  id: "rogue",
  name: "rogue",
  auraEvents,
  spellCastEvents: casts,
});

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("hiddenPressMs", () => {
  it("an aura new in a re-stating batch, no press row: a press at the batch", () => {
    expect(hiddenPressMs(rogue(batch(30)), EVASION, T0)).toEqual([BATCH_MS]);
  });
  it("re-stated while already up: no press (the state re-sync)", () => {
    const u = rogue([
      aura(LogEvent.SPELL_AURA_APPLIED, EVASION, T0 + 65_000),
      ...batch(30),
    ]);
    expect(hiddenPressMs(u, EVASION, T0)).toEqual([]);
  });
  it("up before, then removed: a new application in the batch is a press", () => {
    const u = rogue([
      aura(LogEvent.SPELL_AURA_APPLIED, EVASION, T0 + 20_000),
      aura(LogEvent.SPELL_AURA_REMOVED, EVASION, T0 + 30_000),
      ...batch(30),
    ]);
    expect(hiddenPressMs(u, EVASION, T0)).toEqual([BATCH_MS]);
  });
  it("a batch straddling a millisecond boundary is one batch (0284fcd9 r1 0:12: ten rows at .108, five at .109)", () => {
    const u = rogue([
      ...Array.from({ length: 10 }, (_, i) =>
        aura(
          LogEvent.SPELL_AURA_APPLIED,
          String(800_000 + i),
          BATCH_MS - 1,
          "x",
        ),
      ),
      ...batch(5),
    ]);
    expect(hiddenPressMs(u, EVASION, T0)).toEqual([BATCH_MS]);
  });
  it("a press that runs as its own effect aura (Alter Time 342245 → 342246) is found by its aura", () => {
    const u = rogue([
      ...batch(30, false),
      aura(LogEvent.SPELL_AURA_APPLIED, "342246", BATCH_MS),
    ]);
    expect(hiddenPressMs(u, "342245", T0)).toEqual([BATCH_MS]);
  });
  it("a copy applied while seen and re-stated by the batch (Exhilaration → Smoke Screen's Survival of the Fittest) is no hidden press", () => {
    const exhil = {
      spellId: "109304",
      logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: BATCH_MS - 1 },
    };
    const u = rogue(
      [aura(LogEvent.SPELL_AURA_APPLIED, EVASION, BATCH_MS - 1), ...batch(30)],
      [exhil],
    );
    expect(hiddenPressMs(u, EVASION, T0)).toEqual([]);
  });
  it("a press's second same-named aura in the batch is no re-statement (Incarnation: Avatar of Ashamane 252071 beside 102543)", () => {
    const u = rogue([
      aura(LogEvent.SPELL_AURA_APPLIED, "252071", BATCH_MS),
      ...batch(30, false),
      aura(LogEvent.SPELL_AURA_APPLIED, "102543", BATCH_MS),
    ]);
    expect(hiddenPressMs(u, "102543", T0)).toEqual([BATCH_MS]);
  });
  it("Herald of the Sun's proc Avenging Wrath, its bundle in the batch, is no hidden press (136-1-737 2:12)", () => {
    const u = rogue([
      aura(LogEvent.SPELL_AURA_APPLIED, "1241410", BATCH_MS),
      aura(LogEvent.SPELL_AURA_APPLIED, "454351", BATCH_MS),
      ...batch(8, false),
    ]);
    expect(hiddenPressMs(u, "454351", T0)).toEqual([]);
    // without the bundle, the same re-listing keeps it
    const plain = rogue([
      aura(LogEvent.SPELL_AURA_APPLIED, "454351", BATCH_MS),
      ...batch(8, false),
    ]);
    expect(hiddenPressMs(plain, "454351", T0)).toEqual([BATCH_MS]);
  });
  it("a stealth opener's cast in the batch's ms leaves the hidden press (51-4 0:08 Trueshot beside Moonlight Chakram)", () => {
    const opener = {
      spellId: "1264949",
      logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: BATCH_MS },
    };
    expect(hiddenPressMs(rogue(batch(30), [opener]), EVASION, T0)).toEqual([
      BATCH_MS,
    ]);
  });
  it("a press row beside it, or no batch: no hidden press", () => {
    const cast = {
      spellId: EVASION,
      logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: BATCH_MS + 3 },
    };
    expect(hiddenPressMs(rogue(batch(30), [cast]), EVASION, T0)).toEqual([]);
    expect(hiddenPressMs(rogue(batch(3)), EVASION, T0)).toEqual([]);
  });
});

describe("selfSaveCasts — a hidden press of a save", () => {
  it("is listed at the batch, marked unseen", () => {
    expect(selfSaveCasts(rogue(batch(30)), T0)).toEqual([
      {
        atSeconds: 70.516,
        spellId: EVASION,
        spellName: "Evasion",
        unseenPress: true,
      },
    ]);
  });
});

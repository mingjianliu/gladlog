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
import {
  hiddenAuraLifeMs,
  hiddenPressMs,
  isResyncBatchAt,
  RESYNC_BATCH_MIN_APPLIED,
  RESYNC_BATCH_SPAN_MS,
} from "../src/utils/hiddenPress";

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

// mutationProbe.ts (2026-10-24): 16 of 34 mutants of hiddenPress.ts survived
// every test in the repo — mostly the window bounds. Each case pins one; the
// two left (`d > 0` / `&&` in `hiddenAuraLifeMs`) are equivalent on the real
// data: no spell has a duration ≤ 0.
describe("hiddenPressMs — the bounds no test pinned", () => {
  const SPAN = RESYNC_BATCH_SPAN_MS;
  const MIN = RESYNC_BATCH_MIN_APPLIED;
  /** `n` APPLIED rows of other auras at `ms`, plus Evasion at `evasionMs` */
  const batchAt = (n: number, ms: number, evasionMs = ms): any[] => [
    ...Array.from({ length: n - 1 }, (_, i) =>
      aura(LogEvent.SPELL_AURA_APPLIED, String(910_000 + i), ms, "x"),
    ),
    aura(LogEvent.SPELL_AURA_APPLIED, EVASION, evasionMs),
  ];
  const cast = (ms: number): any => ({
    spellId: EVASION,
    logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: ms },
  });

  it("the window includes rows exactly at its start and at its end", () => {
    const u = rogue(batchAt(30, BATCH_MS));
    expect(hiddenPressMs(u, EVASION, BATCH_MS, BATCH_MS)).toEqual([BATCH_MS]);
  });
  it("a batch outside the window is not read", () => {
    const u = rogue(batchAt(30, BATCH_MS));
    expect(hiddenPressMs(u, EVASION, BATCH_MS + 1)).toEqual([]);
    expect(hiddenPressMs(u, EVASION, T0, BATCH_MS - 1)).toEqual([]);
  });
  it("exactly the minimum batch size is a batch; one fewer is not", () => {
    expect(hiddenPressMs(rogue(batchAt(MIN, BATCH_MS)), EVASION, T0)).toEqual([
      BATCH_MS,
    ]);
    expect(
      hiddenPressMs(rogue(batchAt(MIN - 1, BATCH_MS)), EVASION, T0),
    ).toEqual([]);
  });
  it("a batch row exactly SPAN ms from the aura counts toward the batch", () => {
    // MIN − 1 rows at the batch ms, the aura SPAN ms later: MIN in the span
    const u = rogue(batchAt(MIN, BATCH_MS, BATCH_MS + SPAN));
    expect(hiddenPressMs(u, EVASION, T0)).toEqual([BATCH_MS + SPAN]);
  });
  it("a press row exactly PAIR ms away is the aura's own press", () => {
    const u = rogue(batchAt(30, BATCH_MS), [cast(BATCH_MS - 1000)]);
    expect(hiddenPressMs(u, EVASION, T0)).toEqual([]);
    const far = rogue(batchAt(30, BATCH_MS), [cast(BATCH_MS - 1001)]);
    expect(hiddenPressMs(far, EVASION, T0)).toEqual([BATCH_MS]);
  });
  it("re-stated exactly SPAN ms later is a re-statement, not a press", () => {
    const u = rogue([
      ...batchAt(30, BATCH_MS),
      aura(LogEvent.SPELL_AURA_APPLIED, EVASION, BATCH_MS + SPAN),
    ]);
    expect(hiddenPressMs(u, EVASION, T0)).toEqual([]);
    const later = rogue([
      ...batchAt(30, BATCH_MS),
      aura(LogEvent.SPELL_AURA_APPLIED, EVASION, BATCH_MS + SPAN + 1),
    ]);
    expect(hiddenPressMs(later, EVASION, T0)).toEqual([BATCH_MS]);
  });
  it("up until exactly the official length + 1 s: a re-listing then is no new press", () => {
    const life = hiddenAuraLifeMs(EVASION);
    const first = T0 + 10_000;
    const atEdge = rogue([
      aura(LogEvent.SPELL_AURA_APPLIED, EVASION, first),
      ...batchAt(30, first + life),
    ]);
    expect(hiddenPressMs(atEdge, EVASION, T0)).toEqual([]);
    const past = rogue([
      aura(LogEvent.SPELL_AURA_APPLIED, EVASION, first),
      ...batchAt(30, first + life + 1),
    ]);
    expect(hiddenPressMs(past, EVASION, T0)).toEqual([first + life + 1]);
  });
  it("a press of two same-named auras: one's logged REMOVED keeps the press up across the other's re-listing (Alter Time 342245 / 342246)", () => {
    // untilOf's "up to its own REMOVED" is only visible here: the run of
    // 342246 is searched past the other id's rows to its REMOVED, so a
    // re-listing of 342245 in between finds the press still up
    const first = T0 + 10_000;
    const listedAt = first + hiddenAuraLifeMs("342246") + 5_000;
    const at = (event: LogEvent, id: string, ms: number) => ({
      ...aura(event, id, ms),
      destUnitId: "rogue",
    });
    const u = rogue([
      at(LogEvent.SPELL_AURA_APPLIED, "342246", first),
      ...Array.from({ length: 29 }, (_, i) =>
        aura(LogEvent.SPELL_AURA_APPLIED, String(920_000 + i), listedAt, "x"),
      ),
      at(LogEvent.SPELL_AURA_APPLIED, "342245", listedAt),
      at(LogEvent.SPELL_AURA_REMOVED, "342246", listedAt + 2_000),
    ]);
    expect(hiddenPressMs(u, "342245", T0)).toEqual([]);
  });
});

describe("hiddenPressMs — Herald of the Sun's proc bundle bound", () => {
  // the proc Avenging Wrath comes with its bundle in the same few ms: a
  // bundle row exactly SPAN ms from it still marks the proc (no press)
  const AW = "31884";
  const at = (id: string, ms: number, src = "rogue") =>
    aura(LogEvent.SPELL_AURA_APPLIED, id, ms, src);
  const withBundleAt = (offset: number) =>
    rogue([
      ...Array.from({ length: 29 }, (_, i) =>
        at(String(930_000 + i), BATCH_MS, "x"),
      ),
      at(AW, BATCH_MS),
      at("445206", BATCH_MS + offset, "rogue"),
    ]);
  it("a bundle row exactly SPAN ms away is the proc's", () => {
    expect(hiddenPressMs(withBundleAt(RESYNC_BATCH_SPAN_MS), AW, T0)).toEqual(
      [],
    );
  });
  it("one further away is not", () => {
    expect(
      hiddenPressMs(withBundleAt(RESYNC_BATCH_SPAN_MS + 1), AW, T0),
    ).toEqual([BATCH_MS]);
  });
});

describe("hiddenAuraLifeMs", () => {
  it("reads the caster's own length when the caster is given (Recklessness 1719: DB2 18 s, played 12 s)", () => {
    expect(hiddenAuraLifeMs("1719", { spellCastEvents: [] })).toBe(13_000);
    expect(hiddenAuraLifeMs("1719")).toBe(19_000);
  });
});

describe("isResyncBatchAt — a row in the batch that re-lists an unseen unit (hiddenPressMs' reading)", () => {
  it("RESYNC_BATCH_MIN_APPLIED APPLIED rows on the unit within the span: yes; one fewer, or a row outside it: no", () => {
    const unit = (rows: any[]) => ({ id: "rogue", auraEvents: rows });
    expect(
      isResyncBatchAt(unit(batch(RESYNC_BATCH_MIN_APPLIED)), BATCH_MS),
    ).toBe(true);
    expect(
      isResyncBatchAt(
        unit(batch(RESYNC_BATCH_MIN_APPLIED)),
        BATCH_MS + RESYNC_BATCH_SPAN_MS,
      ),
    ).toBe(true);
    // HAS TEETH
    expect(
      isResyncBatchAt(unit(batch(RESYNC_BATCH_MIN_APPLIED - 1)), BATCH_MS),
    ).toBe(false);
    expect(
      isResyncBatchAt(
        unit(batch(RESYNC_BATCH_MIN_APPLIED)),
        BATCH_MS + RESYNC_BATCH_SPAN_MS + 1,
      ),
    ).toBe(false);
    // rows on another unit are not this unit's re-listing
    const elsewhere = batch(RESYNC_BATCH_MIN_APPLIED).map((a) => ({
      ...a,
      destUnitId: "mage",
    }));
    expect(isResyncBatchAt(unit(elsewhere), BATCH_MS)).toBe(false);
  });
});

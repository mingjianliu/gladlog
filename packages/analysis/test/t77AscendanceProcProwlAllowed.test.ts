/**
 * Pipeline T77 — two readings of GH #124 item 9 and GH #173 item 36.
 *
 *  - Restoration's Ascendance 114052: a cast-less run that ends short of a
 *    press's length is Deeply Rooted Elements' proc (6 s; DB2 Spell 378270),
 *    not a press — the ledger's aura fallback read 427 six-second runs and 3
 *    twelve-second ones as presses on the 605 capture (4 "impossible"
 *    presses on ledgerImpossibleCastScan).
 *  - Prowl 5215 / 102547 stays up through a press allowed while stealthed
 *    (DB2 aura 16; 176 of 178 first presses on the 605's visible runs);
 *    Shadowmeld is not measured well enough (3 / 2) and still ends there.
 */
import { CombatUnitSpec, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  auraOnlyActivationSeconds,
  isTalentProcRun,
} from "../src/utils/cooldowns";
import {
  holderFirstOwnActionAfterMs,
  STEALTH_KEPT_BY_ALLOWED_PRESS_IDS,
} from "../src/utils/enemyDefensives";
import { stealthControlUsableAt } from "../src/utils/stealthControl";
import {
  makeAuraEvent,
  makeDamageEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const ASCENDANCE = "114052";
const DRE = { id1: 81051, id2: 101937, count: 1 };
const run = (fromMs: number, toMs: number | null) => [
  makeAuraEvent(
    LogEvent.SPELL_AURA_APPLIED,
    ASCENDANCE,
    fromMs,
    "s1",
    "s1",
    "BUFF",
  ),
  ...(toMs === null
    ? []
    : [
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          ASCENDANCE,
          toMs,
          "s1",
          "s1",
          "BUFF",
        ),
      ]),
];
const resto = (auraEvents: ReturnType<typeof run>, holder = true) =>
  makeUnit("s1", {
    spec: CombatUnitSpec.Shaman_Restoration,
    info: { talents: holder ? [DRE] : [], pvpTalents: [] },
    spellCastEvents: [],
    auraEvents,
  });

describe("T77 — a cast-less Ascendance run of the proc's length is no press", () => {
  it("a 6 s run and two procs back to back (12 s) are procs", () => {
    const u = resto([...run(30_000, 36_003), ...run(80_000, 92_010)]);
    expect(isTalentProcRun(u, ASCENDANCE, 30_000)).toBe(true);
    expect(isTalentProcRun(u, ASCENDANCE, 80_000)).toBe(true);
    expect(auraOnlyActivationSeconds(u, ASCENDANCE, 0)).toEqual([]);
  });

  it("a run a press's length long, and one the log never ends, stay presses", () => {
    const u = resto([...run(30_000, 45_010), ...run(200_000, null)]);
    expect(isTalentProcRun(u, ASCENDANCE, 30_000)).toBe(false);
    expect(isTalentProcRun(u, ASCENDANCE, 200_000)).toBe(false);
    expect(auraOnlyActivationSeconds(u, ASCENDANCE, 0)).toEqual([30, 200]);
  });

  it("a run cut at another length is no proof of a proc (a death 4 s into a press)", () => {
    // codex 85-tk-F-T77-1 #1
    const u = resto(run(30_000, 34_000));
    expect(isTalentProcRun(u, ASCENDANCE, 30_000)).toBe(false);
    expect(auraOnlyActivationSeconds(u, ASCENDANCE, 0)).toEqual([30]);
  });

  it("a REMOVED and an APPLIED of one millisecond inside a press are one run", () => {
    // codex 85-tk-F-T77-1 #3: 30–35 and 35–45 are one 15 s run
    const u = resto([...run(30_000, 35_000), ...run(35_000, 45_000)]);
    expect(isTalentProcRun(u, ASCENDANCE, 30_000)).toBe(false);
    expect(isTalentProcRun(u, ASCENDANCE, 35_000)).toBe(false);
    // …and one press (codex 85-tk-F-T77-1b #2)
    expect(auraOnlyActivationSeconds(u, ASCENDANCE, 0)).toEqual([30]);
    // …and a rebroadcast inside a proc leaves it a proc
    const p = resto([...run(30_000, 33_000), ...run(33_000, 36_000)]);
    expect(isTalentProcRun(p, ASCENDANCE, 30_000)).toBe(true);
    expect(isTalentProcRun(p, ASCENDANCE, 33_000)).toBe(true);
    expect(auraOnlyActivationSeconds(p, ASCENDANCE, 0)).toEqual([]);
  });

  it("a duplicate APPLIED inside a proc does not hide its end", () => {
    // codex 85-tk-F-T77-1b #3
    const [applied, removed] = run(30_000, 36_000);
    const u = resto([applied!, run(33_000, null)[0]!, removed!]);
    expect(isTalentProcRun(u, ASCENDANCE, 30_000)).toBe(true);
    expect(auraOnlyActivationSeconds(u, ASCENDANCE, 0)).toEqual([]);
  });

  it("a run the holder's death ended is no proof of a proc, whatever its length", () => {
    // codex 85-tk-F-T77-1b #1: REMOVED at 36.20 s, dead at 36.22 s
    const u = resto(run(30_000, 36_200));
    (u as { deathRecords: unknown[] }).deathRecords = [{ timestamp: 36_220 }];
    expect(isTalentProcRun(u, ASCENDANCE, 30_000)).toBe(false);
    expect(auraOnlyActivationSeconds(u, ASCENDANCE, 0)).toEqual([30]);
    // the REMOVED logged after the death record (1c #1)
    (u as { deathRecords: unknown[] }).deathRecords = [{ timestamp: 36_180 }];
    expect(isTalentProcRun(u, ASCENDANCE, 30_000)).toBe(false);
    expect(auraOnlyActivationSeconds(u, ASCENDANCE, 0)).toEqual([30]);
  });

  it("a unit without the proc talent has one length: every run is a press", () => {
    const u = resto(run(30_000, 36_000), false);
    expect(isTalentProcRun(u, ASCENDANCE, 30_000)).toBe(false);
    expect(auraOnlyActivationSeconds(u, ASCENDANCE, 0)).toEqual([30]);
  });
});

describe("T77 — Prowl stays up through a press stealth allows", () => {
  const T = 1_000_000;
  const druid = (casts: Array<[string, number]>) =>
    makeUnit("d1", {
      spellCastEvents: casts.map(([id, s]) =>
        makeSpellCastEvent(id, T + s * 1000, "d1", "d1"),
      ),
    });
  const TIGERS_FURY = "5217"; // DB2: allowed while stealthed
  const SHRED = "5221";

  it("Prowl (both ids) ends at the first press stealth does not allow", () => {
    for (const prowl of ["5215", "102547"]) {
      expect(STEALTH_KEPT_BY_ALLOWED_PRESS_IDS.has(prowl)).toBe(true);
      expect(
        holderFirstOwnActionAfterMs(
          druid([
            [TIGERS_FURY, 11],
            [SHRED, 12.5],
          ]),
          T + 10_000,
          prowl,
        ),
      ).toBe(T + 12_500);
    }
  });

  it("Shadowmeld still ends at any press", () => {
    expect(
      holderFirstOwnActionAfterMs(
        druid([
          [TIGERS_FURY, 11],
          [SHRED, 12.5],
        ]),
        T + 10_000,
        "58984",
      ),
    ).toBe(T + 11_000);
  });

  it("a Prowl the log never ends is over at a swing on its holder", () => {
    // codex 85-tk-F-T77-1 #2: Prowl at 10 s, Tiger's Fury at 11 s (no end
    // now), a swing on the druid at 12 s, no REMOVED
    const RAKE = "1822";
    const swing = {
      ...makeDamageEvent(T + 12_000, 1000, "d1"),
      logLine: {
        event: LogEvent.SWING_DAMAGE,
        timestamp: T + 12_000,
        parameters: [],
      },
    };
    for (const prowl of ["5215", "102547"]) {
      const mk = (
        damageIn: Array<ReturnType<typeof makeDamageEvent>>,
        removedAt?: number,
      ) =>
        makeUnit("d1", {
          spellCastEvents: [
            makeSpellCastEvent(TIGERS_FURY, T + 11_000, "d1", "d1"),
          ],
          auraEvents: [
            makeAuraEvent(
              LogEvent.SPELL_AURA_APPLIED,
              prowl,
              T + 10_000,
              "d1",
              "d1",
              "BUFF",
            ),
            ...(removedAt === undefined
              ? []
              : [
                  makeAuraEvent(
                    LogEvent.SPELL_AURA_REMOVED,
                    prowl,
                    removedAt,
                    "d1",
                    "d1",
                    "BUFF",
                  ),
                ]),
          ],
          damageIn,
        });
      expect(stealthControlUsableAt(mk([]), RAKE, T + 60_000)).toBe(true);
      expect(stealthControlUsableAt(mk([swing]), RAKE, T + 11_500)).toBe(true);
      expect(stealthControlUsableAt(mk([swing]), RAKE, T + 60_000)).toBe(false);
      // a later run's REMOVED is not this one's (codex 85-tk-F-T77-1b #4)
      const later = mk([swing]);
      later.auraEvents.push(
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          prowl,
          T + 30_000,
          "d1",
          "d1",
          "BUFF",
        ) as never,
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          prowl,
          T + 40_000,
          "d1",
          "d1",
          "BUFF",
        ) as never,
      );
      expect(stealthControlUsableAt(later, RAKE, T + 20_000)).toBe(false);
      expect(stealthControlUsableAt(later, RAKE, T + 35_000)).toBe(true);
      // nor one applied and removed in one millisecond (1c #2)
      const blink = mk([swing]);
      blink.auraEvents.push(
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          prowl,
          T + 30_000,
          "d1",
          "d1",
          "BUFF",
        ) as never,
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          prowl,
          T + 30_000,
          "d1",
          "d1",
          "BUFF",
        ) as never,
      );
      expect(stealthControlUsableAt(blink, RAKE, T + 20_000)).toBe(false);
      // a run the log ends keeps the log's end
      expect(
        stealthControlUsableAt(mk([swing], T + 20_000), RAKE, T + 15_000),
      ).toBe(true);
    }
  });
});

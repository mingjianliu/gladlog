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
  aurasRefusingSpellAt,
  claimLandingRow,
  isAuraLandingEvent,
  isTickStackRow,
  landedAfterWallRow,
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
  it("a row an earlier press of the spell can still own is not this press's", () => {
    // bf679e40: two Throw Glaives 440 ms apart, the first one's hit landing
    // 100 ms after the second cast — codex 85-tk-L6-T281-2 #1
    expect(before([row(93_125)], 92_744, [92_300, 92_744])).toBe(false);
    // an earlier press whose window closed before the row owns nothing
    expect(before([row(93_125)], 92_744, [90_000, 92_744])).toBe(true);
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
      refusedByAnotherAura(
        IRONBARK,
        "78674",
        { immune: true },
        [ICE_BLOCK],
        false,
      ),
    ).toBe(true);
  });
  it("…or while a damage-immune control (Cyclone) was on the target", () => {
    expect(
      refusedByAnotherAura(IRONBARK, "78674", { immune: true }, [], true),
    ).toBe(true);
  });
  it("with nothing else up the refusal may be the wall's own: a root into Dispersion stays", () => {
    // codex 85-tk-L6-T281-1 #4 (05ea5983: Entangling Roots IMMUNE)
    expect(
      refusedByAnotherAura(DISPERSION, "339", { immune: true }, [], false),
    ).toBe(false);
    expect(
      refusedByAnotherAura(
        DISPERSION,
        "339",
        { immune: true },
        [DISPERSION],
        false,
      ),
    ).toBe(false);
  });
  it("a landing that is no outright refusal stays the wall's", () => {
    expect(refusedByAnotherAura(IRONBARK, "78674", {}, [ICE_BLOCK], true)).toBe(
      false,
    );
  });
  it("an immunity among the refusing auras keeps its own refusals", () => {
    expect(
      refusedByAnotherAura(
        ICE_BLOCK,
        "78674",
        { immune: true },
        [ICE_BLOCK],
        false,
      ),
    ).toBe(false);
  });
  it("the wall among the refusing auras keeps the cast whatever else is up", () => {
    // Blessing of Protection beside Dispersion, a root: only Dispersion
    // stops it, and were both listed the wall still refuses it itself
    expect(
      refusedByAnotherAura(
        DISPERSION,
        "339",
        { immune: true },
        [DISPERSION, "1022"],
        false,
      ),
    ).toBe(false);
  });
  it("a wall that stops the spell keeps it though the reader shows it down (a rebroadcast between two rows)", () => {
    // Aspect of the Turtle REMOVED, Aimed Shot IMMUNE, Turtle APPLIED in
    // one millisecond, Blessing of Protection up — codex 85-tk-L6-T281-4 #4
    expect(
      refusedByAnotherAura(
        "186265",
        "19434",
        { immune: true },
        ["1022"],
        false,
      ),
    ).toBe(false);
  });
  it("the cursor: a hit after another press of the spell is that press's", () => {
    // presses 10.900 and 12.030; refusal 12.000, hit 12.070 — -4 #1
    const rows = [
      { atMs: 12_000, hit: false, immune: true as const },
      { atMs: 12_070, hit: true },
    ];
    const at = (r: { atMs: number }) => r.atMs;
    expect(claimLandingRow(rows, 0, at, 10_900, [10_900, 12_030])).toEqual({
      landing: 0,
      cursor: 1,
    });
    expect(claimLandingRow(rows, 0, at, 10_900, [10_900])).toEqual({
      landing: 1,
      cursor: 2,
    });
    // the press's own success row logged between its refusal and its hit
    // (b3dea9f6: Rake) is no later press — -5 #1
    expect(claimLandingRow(rows, 0, at, 12_030, [12_030])).toEqual({
      landing: 1,
      cursor: 2,
    });
  });
  it("the cursor: a hit takes the refusal of its own millisecond with it", () => {
    // Rake damage and stun refusal both at 12.050, damage first — -4 #5
    const rows = [
      { atMs: 12_050, hit: true },
      { atMs: 12_050, hit: false, immune: true as const },
      { atMs: 12_180, hit: true },
    ];
    expect(
      claimLandingRow(rows, 0, (r) => r.atMs, 12_000, [12_000, 12_010]),
    ).toEqual({
      landing: 0,
      cursor: 2,
    });
  });
  it("a school-limited immunity wall gives up a refusal only another aura explains", () => {
    // Blessing of Spellwarding 204018 and Icebound Fortitude 48792 up,
    // Intimidation's physical stun 24394 refused: only Fortitude stops it
    expect(
      refusedByAnotherAura(
        "204018",
        "24394",
        { immune: true },
        ["48792"],
        false,
      ),
    ).toBe(true);
  });
  it("DB2 and the tables: Ice Block stops a Starsurge, Blessing of Protection no root, Dispersion a root", () => {
    const up = (auraId: string, spellId: string, _name: string) =>
      aurasRefusingSpellAt(
        {
          auraEvents: [
            {
              spellId: auraId,
              spellName: "",
              srcUnitId: "T",
              srcUnitName: "T",
              destUnitId: "T",
              destUnitName: "T",
              auraType: "BUFF",
              timestamp: 1_000,
              logLine: {
                event: LogEvent.SPELL_AURA_APPLIED,
                timestamp: 1_000,
                lineIndex: 1,
              },
            },
          ],
        } as never,
        [],
        spellId,
        2_000,
        undefined,
      );
    expect(up(ICE_BLOCK, "78674", "Starsurge")).toEqual([ICE_BLOCK]);
    expect(up("1022", "339", "Entangling Roots")).toEqual([]);
    expect(up(DISPERSION, "339", "Entangling Roots")).toEqual([DISPERSION]);
    expect(up(IRONBARK, "78674", "Starsurge")).toEqual([]);
    // Time Stop: no table row, DB2's all-school immunity on the aura
    expect(up("378441", "1329", "Mutilate")).toEqual(["378441"]);
    // Imprison 221527: DB2's all-school immunity on the debuff itself
    expect(up("221527", "356995", "Disintegrate")).toEqual(["221527"]);
    // movement out of a ground effect refuses nothing on the target
    expect(up("358267", "187650", "Freezing Trap")).toEqual([]); // Hover
    // Precognition's mechanic list has no bleed (Barbed Shot, mechanic 15)
    expect(up("377362", "217200", "Barbed Shot")).toEqual([]);
    // the pressed Spirit of Redemption form: an immunity that lasts its aura
    expect(up("215769", "191037", "Starfall")).toEqual(["215769"]);
    // Deep Breath's flight: a listed control immunity, for a control only
    expect(up("433874", "3355", "Freezing Trap")).toEqual(["433874"]);
    expect(up("433874", "78674", "Starsurge")).toEqual([]);
    // …and for the control aura only: a control press's damage or slow
    // lands under Precognition (58a92059 r4, ccada8e6 — -5 #2)
    expect(up("377362", "88625", "Holy Word: Chastise")).toEqual([]);
    expect(up("377362", "389823", "Snowdrift")).toEqual([]);
    expect(up("377362", "389831", "Snowdrift")).toEqual(["377362"]);
    // an interrupt, a silence: the aura's DB2 list names the mechanic (-6 #1)
    expect(up("377362", "47528", "Mind Freeze")).toEqual(["377362"]);
    expect(up("289655", "47476", "Strangulate")).toEqual(["289655"]);
    // Ultimate Penitence lists a root only and is a listed control immunity
    // (-6 #2); Chastise's damage id landed under Deep Breath (-6 #3)
    expect(up("421453", "118905", "Static Charge")).toEqual(["421453"]);
    expect(up("421453", "118", "Polymorph")).toEqual(["421453"]);
    expect(up("433874", "88625", "Holy Word: Chastise")).toEqual([]);
    expect(up("433874", "200200", "Holy Word: Chastise")).toEqual(["433874"]);
    expect(up("377362", "390171", "Snowdrift")).toEqual([]);
    // a horror no category table holds (Sin and Punishment) — -7 #3
    expect(up("377362", "87204", "Sin and Punishment")).toEqual(["377362"]);
    // Obsidian Scales stops a silence only with Obsidian Mettle — -7 #1
    expect(up("363916", "47476", "Strangulate")).toEqual([]);
    // area damage lands through Vanish (-5 #3)
    expect(up("11327", "81297", "Consecration")).toEqual([]);
    // Blessing of Freedom stops no stun
    expect(up("1044", "118905", "Static Charge")).toEqual([]);
    // Spellwarding stops no physical stun; Fortitude stops a stun
    expect(up("204018", "24394", "Intimidation")).toEqual([]);
    expect(up("48792", "24394", "Intimidation")).toEqual(["48792"]);
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
  it("the stun's IMMUNE with the damage 16 ms later: the press landed, at the damage row", () => {
    expect(landing(12_066)).toMatchObject({ atMs: 12_066, hit: true });
    expect(landing(12_066).immune).toBeUndefined();
  });
  it("the hit row beside a refusal is taken once: a second press does not land on it", () => {
    // codex 85-tk-L6-T281-3 #1: two presses, one refusal, one damage row
    const second = { ...press };
    const got = pressLandingRows(
      [press, second],
      (p) => (p === press ? 12_000 : 12_001),
      {
        id: "C",
        damageOut: [
          {
            spellId: "1822",
            spellName: "Rake",
            destUnitId: "T",
            logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: 12_066 },
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
    );
    expect(got.get(press)).toMatchObject({ atMs: 12_066, hit: true });
    expect(got.get(second)).toMatchObject({ atMs: 12_001, hit: false });
  });
  it("a stack its own tick added is no landing; a row below the wall's closing row came after it", () => {
    const DOSE = LogEvent.SPELL_AURA_APPLIED_DOSE;
    expect(isTickStackRow(DOSE, 126_464, [126_464])).toBe(true);
    expect(isTickStackRow(DOSE, 31_274, [30_100, 32_100])).toBe(false);
    expect(isTickStackRow(LogEvent.SPELL_AURA_REFRESH, 5, [5])).toBe(false);
    const close = { ms: 109_045, lineIndex: 1890 };
    expect(landedAfterWallRow({ atMs: 109_045, lineIndex: 1891 }, close)).toBe(
      true,
    );
    expect(landedAfterWallRow({ atMs: 109_045, lineIndex: 1889 }, close)).toBe(
      false,
    );
    expect(
      landedAfterWallRow({ atMs: 109_045, lineIndex: 1891 }, undefined),
    ).toBe(false);
  });
  it("a stack added is a landing row", () => {
    expect(isAuraLandingEvent(LogEvent.SPELL_AURA_APPLIED_DOSE)).toBe(true);
    expect(isAuraLandingEvent(LogEvent.SPELL_AURA_REMOVED)).toBe(false);
  });
  it("the IMMUNE alone, or with a hit a second later: refused outright", () => {
    expect(landing(null).immune).toBe(true);
    expect(landing(13_100).immune).toBe(true);
  });
});

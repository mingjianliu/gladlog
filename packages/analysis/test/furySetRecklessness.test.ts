/** GH #175 row 1: the Fury 12.1 2pc (1296645) — 「在鲁莽期间，怒击使鲁莽的持续
 * 时间延长2秒，最多延长6秒」 — prices Recklessness press by press for a
 * holder of two pieces of set 2067, and for nobody else. */
import { CombatUnitSpec, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  CLASS_SET_ITEM_IDS,
  SET_BONUS_PER_EVENT_DURATIONS,
  setBonusPerEventFor,
} from "../src/data/classSetBonuses";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  buffDurationRangeForCaster,
  buffFullDurationForCaster,
} from "../src/utils/buffDuration";

beforeAll(async () => {
  await ensureAnalysisData();
});

const RECKLESSNESS = "1719";
const RAGING_BLOW = "85288";
const CRUSHING_BLOW = "335097";
const SET = CLASS_SET_ITEM_IDS["2067"]!;
const T0 = 1_000_000;
const press = (spellId: string, s: number) => ({
  spellId,
  logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: T0 + s * 1000 },
});
const warrior = (
  pieces: number,
  casts: ReturnType<typeof press>[],
  spec: string = CombatUnitSpec.Warrior_Fury,
) =>
  ({
    spec,
    info: {
      // Rampaging Berserker, rank 1: 12 × 1.5 = 18 s
      talents: [{ id1: 110412, id2: 137002, count: 1 }],
      pvpTalents: [],
      equipment: [...SET.slice(0, pieces).map((id) => ({ id })), { id: "1" }],
    },
    spellCastEvents: casts,
  }) as never;

describe("Fury 2pc: Raging Blow extends Recklessness by 2 s per press, up to 6 s", () => {
  it("the row is the bonus spell's DB2 numbers", () => {
    const r = SET_BONUS_PER_EVENT_DURATIONS[RECKLESSNESS]!;
    expect(r).toMatchObject({
      bonusSpellId: "1296645",
      itemSetId: "2067",
      pieces: 2,
      specs: [CombatUnitSpec.Warrior_Fury],
      addSecondsPerEvent: 2,
      capSeconds: 6,
    });
    expect([...r.qualifyingSpellIds].sort()).toEqual(
      [CRUSHING_BLOW, RAGING_BLOW].sort(),
    );
  });

  it("each Raging Blow or Crushing Blow while it is up adds 2 s", () => {
    expect(buffFullDurationForCaster(RECKLESSNESS, warrior(2, []), T0)).toBe(
      18,
    );
    expect(
      buffFullDurationForCaster(
        RECKLESSNESS,
        warrior(2, [press(RAGING_BLOW, 3)]),
        T0,
      ),
    ).toBe(20);
    expect(
      buffFullDurationForCaster(
        RECKLESSNESS,
        warrior(2, [press(CRUSHING_BLOW, 3), press(RAGING_BLOW, 5)]),
        T0,
      ),
    ).toBe(22);
  });

  it("stops at 6 s", () => {
    expect(
      buffFullDurationForCaster(
        RECKLESSNESS,
        warrior(
          2,
          [1, 3, 5, 7, 9].map((s) => press(RAGING_BLOW, s)),
        ),
        T0,
      ),
    ).toBe(24);
  });

  it("walks the window as it grows: a press past 18 s counts once an earlier one extended it", () => {
    expect(
      buffFullDurationForCaster(
        RECKLESSNESS,
        warrior(2, [press(RAGING_BLOW, 18.5)]),
        T0,
      ),
    ).toBe(18);
    expect(
      buffFullDurationForCaster(
        RECKLESSNESS,
        warrior(2, [press(RAGING_BLOW, 17), press(RAGING_BLOW, 19.5)]),
        T0,
      ),
    ).toBe(22);
    // a press before the application is not in it
    expect(
      buffFullDurationForCaster(
        RECKLESSNESS,
        warrior(2, [press(RAGING_BLOW, -1)]),
        T0,
      ),
    ).toBe(18);
  });

  // 605 352b7bd2 round 4, 0:20: the window's one press was a Crushing Blow
  // its target refused IMMUNE, and the aura ran a flat 18.0 s
  it("a press none of whose hits landed extends nothing; a landed or absorbed hit does", () => {
    const aimed = (spellId: string, s: number) => ({
      ...press(spellId, s),
      spellName: spellId === CRUSHING_BLOW ? "Crushing Blow" : "Raging Blow",
      destUnitId: "enemy",
    });
    const row = (spellId: string, name: string, s: number) => ({
      spellId,
      spellName: name,
      destUnitId: "enemy",
      logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: T0 + s * 1000 },
    });
    const refused = {
      ...(warrior(2, [aimed(CRUSHING_BLOW, 12.5)]) as object),
      damageOut: [],
      missesOut: [
        {
          ...row("335098", "Crushing Blow", 12.65),
          missType: "IMMUNE",
          amount: 0,
        },
      ],
    } as never;
    expect(buffFullDurationForCaster(RECKLESSNESS, refused, T0)).toBe(18);
    const landed = {
      ...(warrior(2, [aimed(RAGING_BLOW, 3)]) as object),
      damageOut: [row("96103", "Raging Blow", 3.05)],
      missesOut: [],
    } as never;
    expect(buffFullDurationForCaster(RECKLESSNESS, landed, T0)).toBe(20);
    const absorbed = {
      ...(warrior(2, [aimed(RAGING_BLOW, 3)]) as object),
      damageOut: [],
      missesOut: [
        { ...row("85384", "Raging Blow", 3.05), missType: "ABSORB", amount: 9 },
      ],
    } as never;
    expect(buffFullDurationForCaster(RECKLESSNESS, absorbed, T0)).toBe(20);
    // a hit of a later press is not this press landing
    const late = {
      ...(warrior(2, [
        aimed(RAGING_BLOW, 3),
        aimed(RAGING_BLOW, 30),
      ]) as object),
      damageOut: [row("96103", "Raging Blow", 30.05)],
      missesOut: [],
    } as never;
    expect(buffFullDurationForCaster(RECKLESSNESS, late, T0)).toBe(18);
  });

  // codex 85-tk-A-T18-1 #1: readers pass the press's time, half a second
  // after the aura row; a press after the aura's REMOVED extends nothing
  it("walks the aura's own logged run: from its APPLIED, not past its REMOVED", () => {
    const auraRow = (event: LogEvent, s: number) => ({
      spellId: RECKLESSNESS,
      srcUnitId: "w",
      destUnitId: "w",
      timestamp: T0 + s * 1000,
      logLine: { event, timestamp: T0 + s * 1000 },
    });
    const holder = (
      removedAt: number | undefined,
      casts: ReturnType<typeof press>[],
    ) =>
      ({
        ...(warrior(2, casts) as object),
        id: "w",
        auraEvents: [
          auraRow(LogEvent.SPELL_AURA_APPLIED, 0),
          ...(removedAt === undefined
            ? []
            : [auraRow(LogEvent.SPELL_AURA_REMOVED, removedAt)]),
        ],
      }) as never;
    const AT = T0 + 500;
    expect(
      buffFullDurationForCaster(
        RECKLESSNESS,
        holder(18, [press(RAGING_BLOW, 18.25)]),
        AT,
      ),
    ).toBe(18);
    // without the REMOVED, 18.25 s is past the run anchored at the APPLIED
    expect(
      buffFullDurationForCaster(
        RECKLESSNESS,
        holder(undefined, [press(RAGING_BLOW, 18.25)]),
        AT,
      ),
    ).toBe(18);
    expect(
      buffFullDurationForCaster(
        RECKLESSNESS,
        holder(20, [press(RAGING_BLOW, 3)]),
        AT,
      ),
    ).toBe(20);
    // a same-ms REMOVED → APPLIED re-broadcast does not end the run
    const rebroadcast = {
      ...(holder(undefined, [press(RAGING_BLOW, 12)]) as object),
      id: "w",
      auraEvents: [
        auraRow(LogEvent.SPELL_AURA_APPLIED, 0),
        auraRow(LogEvent.SPELL_AURA_REMOVED, 10),
        auraRow(LogEvent.SPELL_AURA_APPLIED, 10),
      ],
    } as never;
    expect(buffFullDurationForCaster(RECKLESSNESS, rebroadcast, AT)).toBe(20);
    // codex 85-tk-A-T18-1b #1: a 1 ms re-broadcast is one run too
    // (`dropAuraRebroadcasts`), and a duplicate APPLIED then the real
    // REMOVED in one ms is the end
    const run = (rows: ReturnType<typeof auraRow>[]) =>
      ({
        ...(holder(undefined, [press(RAGING_BLOW, 12)]) as object),
        id: "w",
        auraEvents: rows,
      }) as never;
    expect(
      buffFullDurationForCaster(
        RECKLESSNESS,
        run([
          auraRow(LogEvent.SPELL_AURA_APPLIED, 0),
          auraRow(LogEvent.SPELL_AURA_REMOVED, 10),
          auraRow(LogEvent.SPELL_AURA_APPLIED, 10.001),
        ]),
        AT,
      ),
    ).toBe(20);
    expect(
      buffFullDurationForCaster(
        RECKLESSNESS,
        run([
          auraRow(LogEvent.SPELL_AURA_APPLIED, 0),
          auraRow(LogEvent.SPELL_AURA_APPLIED, 10),
          auraRow(LogEvent.SPELL_AURA_REMOVED, 10),
        ]),
        AT,
      ),
    ).toBe(18);
  });

  // codex 85-tk-A-T18-1c: a press in the REMOVED's ms but logged after it
  // is past the run; a duplicate APPLIED inside a run starts nothing
  it("log order at the REMOVED's ms, and duplicate APPLIED rows", () => {
    const row = (event: LogEvent, s: number, lineIndex?: number) => ({
      spellId: RECKLESSNESS,
      srcUnitId: "w",
      destUnitId: "w",
      timestamp: T0 + s * 1000,
      logLine: { event, timestamp: T0 + s * 1000, lineIndex },
    });
    const at = (s: number, lineIndex: number) => ({
      spellId: RAGING_BLOW,
      logLine: {
        event: LogEvent.SPELL_CAST_SUCCESS,
        timestamp: T0 + s * 1000,
        lineIndex,
      },
    });
    const unit = (rows: ReturnType<typeof row>[], casts: unknown[]) =>
      ({
        ...(warrior(2, casts as never) as object),
        id: "w",
        auraEvents: rows,
      }) as never;
    const ended = [
      row(LogEvent.SPELL_AURA_APPLIED, 0, 1),
      row(LogEvent.SPELL_AURA_REMOVED, 18, 100),
    ];
    expect(
      buffFullDurationForCaster(RECKLESSNESS, unit(ended, [at(18, 101)]), T0),
    ).toBe(18);
    expect(
      buffFullDurationForCaster(RECKLESSNESS, unit(ended, [at(18, 99)]), T0),
    ).toBe(20);
    // a duplicate APPLIED at 10 s does not split the run 0–22 s: both
    // presses are in it
    const dup = [
      row(LogEvent.SPELL_AURA_APPLIED, 0),
      row(LogEvent.SPELL_AURA_APPLIED, 10),
      row(LogEvent.SPELL_AURA_REMOVED, 22),
    ];
    expect(
      buffFullDurationForCaster(
        RECKLESSNESS,
        unit(dup, [press(RAGING_BLOW, 3), press(RAGING_BLOW, 12)]),
        T0 + 500,
      ),
    ).toBe(22);
  });

  it("one piece, another spec, another press, or no application time: nothing", () => {
    const three = [1, 3, 5].map((s) => press(RAGING_BLOW, s));
    expect(buffFullDurationForCaster(RECKLESSNESS, warrior(1, three), T0)).toBe(
      18,
    );
    expect(setBonusPerEventFor(RECKLESSNESS, warrior(1, []))).toBeUndefined();
    expect(
      setBonusPerEventFor(
        RECKLESSNESS,
        warrior(2, [], CombatUnitSpec.Warrior_Arms),
      ),
    ).toBeUndefined();
    expect(
      buffFullDurationForCaster(
        RECKLESSNESS,
        warrior(2, [press("23881", 3)]),
        T0,
      ),
    ).toBe(18);
    expect(buffFullDurationForCaster(RECKLESSNESS, warrior(2, three))).toBe(18);
  });

  it("the loadout reads the span for a holder, the flat 18 s for a non-holder", () => {
    expect(buffDurationRangeForCaster(RECKLESSNESS, warrior(2, []))).toEqual({
      min: 18,
      max: 24,
    });
    expect(buffDurationRangeForCaster(RECKLESSNESS, warrior(1, []))).toEqual({
      min: 18,
      max: 18,
    });
  });
});

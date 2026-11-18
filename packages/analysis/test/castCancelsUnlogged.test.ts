/**
 * Pipeline T47: a cast bar the recorder stopped by starting another one
 * writes no "Interrupted" SPELL_CAST_FAILED row — the log has its
 * SPELL_CAST_START, then the next SPELL_CAST_START, and no row of the spell
 * between them. 1d26a991: Searing Glare begun 28.02 and again 29.14, an enemy
 * Disrupt at 28.77 that interrupted nothing; the ledger said
 * `yourCancels=0, baitedKicks=0`.
 */
import { CombatUnitReaction, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src";
import { castBarOutcomesOf } from "../src/utils/castBarOutcomes";
import { cancelPlacedAtS, ownerCastCancels } from "../src/utils/castCancels";
import type { RawStreams } from "../src/utils/rawStreams";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_000_000;
const at = (s: number) => T0 + s * 1000;
const SEARING_GLARE = "410126";
const FLASH_OF_LIGHT = "19750";
const DISRUPT = "183752";
const HAMMER_OF_JUSTICE = "853";

const start = (spellId: string, s: number) => ({
  ...makeSpellCastEvent(spellId, at(s), "e1", "Enemy", "p1", "Me"),
  logLine: {
    event: LogEvent.SPELL_CAST_START,
    timestamp: at(s),
    parameters: [],
  },
});
const success = (spellId: string, s: number) =>
  makeSpellCastEvent(spellId, at(s), "p1", "Me", "p1", "Me");
const fail = (spellId: string, s: number, reason: string) => ({
  tSeconds: s,
  unitGuid: "p1",
  spellId: Number(spellId),
  spellName: spellId,
  reason,
});
/** the recorder's rows: one of another spell, so the unit is the recorder */
const streamsOf = (castFailed: ReturnType<typeof fail>[]): RawStreams => ({
  available: true,
  manaSamples: [],
  castFailed: [fail("20271", 5, "Not yet recovered"), ...castFailed],
});

type OwnerRows = Parameters<typeof makeUnit>[1];
function ledger(
  rows: OwnerRows,
  kicksAtS: number[],
  castFailed: ReturnType<typeof fail>[] = [],
  endS = 120,
  others: ReturnType<typeof makeUnit>[] = [],
) {
  const owner = makeUnit("p1", {
    name: "Me",
    reaction: CombatUnitReaction.Friendly,
    info: {},
    ...rows,
  });
  const enemy = makeUnit("e1", {
    name: "Enemy",
    reaction: CombatUnitReaction.Hostile,
    info: {},
    spellCastEvents: kicksAtS.map((s) =>
      makeSpellCastEvent(DISRUPT, at(s), "p1", "Me", "e1", "Enemy"),
    ),
  });
  const combat = {
    startTime: T0,
    endTime: at(endS),
    units: {
      p1: owner,
      e1: enemy,
      ...Object.fromEntries(others.map((u) => [u.id, u])),
    },
  } as unknown as Parameters<typeof ownerCastCancels>[0]["combat"];
  return ownerCastCancels({
    owner,
    friends: [owner],
    enemies: [enemy],
    combat,
    rawStreams: streamsOf(castFailed),
  })!;
}

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("T47 — a bar superseded by the next cast bar, with no end row", () => {
  // Searing Glare: 28.02 (no end row) → 29.14 (no end row here either, but
  // nothing follows inside its cap) → 35.17, completed 36.35
  const repro: OwnerRows = {
    castStartEvents: [28.02, 29.14, 35.17].map((s) => start(SEARING_GLARE, s)),
    spellCastEvents: [success(SEARING_GLARE, 36.35)],
  };

  it("is a cancel of the ledger, and the kick that went out at it is a baited kick", () => {
    const r = ledger(repro, [28.77]);
    expect(r.cancels).toEqual([
      {
        spellId: SEARING_GLARE,
        spellName: expect.any(String),
        startS: 28.02,
        // the next bar's start: the stop is at or before it
        cancelS: 29.14,
        // no stop instant, so no progress estimate
        progressPct: null,
        unlogged: true,
      },
    ]);
    expect(r.baitedKicks.map((b) => [b.atSeconds, b.baitSpellName])).toEqual([
      [28.77, expect.any(String)],
    ]);
  });

  it("a kick before the bar began, or at the bar that replaced it, is not baited by it", () => {
    expect(ledger(repro, [27.9]).baitedKicks).toEqual([]);
    // 29.5 is inside the second bar, which nothing superseded
    expect(ledger(repro, [29.5]).baitedKicks).toEqual([]);
  });

  it("the reading: `none` with `superseded`, for the next bar of another spell too", () => {
    const unit = makeUnit("p1", {
      castStartEvents: [
        start(FLASH_OF_LIGHT, 10),
        start(SEARING_GLARE, 10.6),
        start(SEARING_GLARE, 20),
      ],
      spellCastEvents: [success(SEARING_GLARE, 11.8)],
    });
    const bars = castBarOutcomesOf({
      unit,
      startMs: T0,
      failed: streamsOf([]).castFailed,
    });
    expect(bars.map((b) => b.end)).toEqual([
      { kind: "none", superseded: { atS: 10.6, near: null } },
      { kind: "completed", atS: 11.8 },
      { kind: "none" }, // nothing after it: no evidence that it ended
    ]);
  });

  it("a control that landed between the start and the next bar: not the player's stop", () => {
    const r = ledger(
      {
        ...repro,
        auraEvents: [
          makeAuraEvent(
            LogEvent.SPELL_AURA_APPLIED,
            HAMMER_OF_JUSTICE,
            at(28.5),
            "e1",
            "p1",
          ),
        ],
      },
      [28.77],
    );
    expect(r.cancels).toEqual([]);
    expect(r.baitedKicks).toEqual([]);
  });

  it("not counted: the spell never went off as itself in the round", () => {
    const r = ledger(
      {
        castStartEvents: [28.02, 29.14].map((s) => start(SEARING_GLARE, s)),
        spellCastEvents: [],
      },
      [28.77],
    );
    expect(r.cancels).toEqual([]);
    expect(r.baitedKicks).toEqual([]);
  });

  it("not counted: a failure row of the spell inside the bar, the next bar past the cap, or past the round's end", () => {
    // a key pressed again inside the bar ("not ready"): the bar has a row
    expect(
      ledger(repro, [], [fail(SEARING_GLARE, 28.4, "Not yet recovered")])
        .cancels,
    ).toEqual([]);
    // the next bar 4 s later: the cap closed the window, not the next bar
    expect(
      ledger(
        {
          castStartEvents: [28, 32, 35.17].map((s) => start(SEARING_GLARE, s)),
          spellCastEvents: [success(SEARING_GLARE, 36.35)],
        },
        [],
      ).cancels.map((c) => c.startS),
    ).toEqual([32]);
    // the round ended (29 s) before the next bar began
    expect(
      ledger(
        {
          castStartEvents: [10, 28.02, 29.14].map((s) =>
            start(SEARING_GLARE, s),
          ),
          spellCastEvents: [success(SEARING_GLARE, 11.2)],
        },
        [],
        [],
        29,
      ).cancels,
    ).toEqual([]);
  });

  it("a START with its own SUCCESS in the same ms (a pet command) supersedes nothing", () => {
    // Searing Glare 28.02, a command row pair 28.5, the bar's own SUCCESS
    // 29.2 — past the queue tolerance, so the bar reads `none`, not stopped
    const r = ledger(
      {
        castStartEvents: [
          start(SEARING_GLARE, 28.02),
          start(FLASH_OF_LIGHT, 28.5),
          start(SEARING_GLARE, 35.17),
        ],
        spellCastEvents: [
          success(FLASH_OF_LIGHT, 28.5),
          success(SEARING_GLARE, 29.2),
          success(SEARING_GLARE, 36.35),
        ],
      },
      [28.3],
    );
    expect(r.cancels).toEqual([]);
    expect(r.baitedKicks).toEqual([]);
  });

  it("codex #1: a failure row of the spell in the START's own millisecond is not 'no row'", () => {
    // the client refused the cast as it began (line of sight): no stop of
    // the player's
    expect(
      ledger(
        repro,
        [28.77],
        [fail(SEARING_GLARE, 28.02, "Target not in line of sight")],
      ).cancels,
    ).toEqual([]);
    // …but the previous bar's own "Interrupted" row in that millisecond is
    // that bar's end, and the bar begun there can still be superseded
    const r = ledger(
      {
        castStartEvents: [27, 28.02, 29.14, 35.17].map((s) =>
          start(SEARING_GLARE, s),
        ),
        spellCastEvents: [success(SEARING_GLARE, 36.35)],
      },
      [],
      [fail(SEARING_GLARE, 28.02, "Interrupted")],
    );
    expect(r.cancels.map((c) => [c.startS, !!c.unlogged])).toEqual([
      [27, false],
      [28.02, true],
    ]);
  });

  it("codex 1b #1: the previous bar's end row excuses one same-millisecond row, not a second one", () => {
    const r = ledger(
      {
        castStartEvents: [27, 28.02, 29.14, 35.17].map((s) =>
          start(SEARING_GLARE, s),
        ),
        spellCastEvents: [success(SEARING_GLARE, 36.35)],
      },
      [],
      [
        fail(SEARING_GLARE, 28.02, "Interrupted"),
        fail(SEARING_GLARE, 28.02, "Target not in line of sight"),
      ],
    );
    expect(r.cancels.map((c) => [c.startS, !!c.unlogged])).toEqual([
      [27, false],
    ]);
  });

  it("codex #2: another player died inside the stretch — the bar may have lost its target", () => {
    const mate = makeUnit("p2", {
      name: "Mate",
      reaction: CombatUnitReaction.Friendly,
      info: {},
      deathRecords: [{ timestamp: at(28.5) }],
    } as never);
    expect(ledger(repro, [28.77], [], 120, [mate]).cancels).toEqual([]);
    const later = makeUnit("p2", {
      name: "Mate",
      reaction: CombatUnitReaction.Friendly,
      info: {},
      deathRecords: [{ timestamp: at(60) }],
    } as never);
    expect(
      ledger(repro, [28.77], [], 120, [later]).cancels.map((c) => c.startS),
    ).toEqual([28.02]);
  });

  it("codex #3: a time-range reader places an unlogged cancel at its bar's start", () => {
    const [c] = ledger(repro, [28.77]).cancels;
    // 28.02, at or before the kick it baited (28.77) — not the 29.14 bound
    expect(cancelPlacedAtS(c!)).toBe(28.02);
    expect(cancelPlacedAtS({ startS: 20, cancelS: 20.6 })).toBe(20.6);
  });

  it("codex #5: the completed bar that vouches for the spell is inside the round", () => {
    expect(
      ledger(
        {
          castStartEvents: [28.02, 29.14, 122].map((s) =>
            start(SEARING_GLARE, s),
          ),
          spellCastEvents: [success(SEARING_GLARE, 123)],
        },
        [28.77],
      ).cancels,
    ).toEqual([]);
  });

  it("a logged stop keeps its own reading beside an unlogged one", () => {
    const r = ledger(
      {
        castStartEvents: [10, 20, 28.02, 29.14, 35.17].map((s) =>
          start(SEARING_GLARE, s),
        ),
        spellCastEvents: [
          success(SEARING_GLARE, 11.2),
          success(SEARING_GLARE, 36.35),
        ],
      },
      [],
      [fail(SEARING_GLARE, 20.6, "Interrupted")],
    );
    expect(
      r.cancels.map((c) => [c.startS, c.cancelS, c.progressPct, !!c.unlogged]),
    ).toEqual([
      [20, 20.6, 50, false],
      [28.02, 29.14, null, true],
    ]);
  });
});

describe("T148 — a bar with no end row, then a press a cast bar cannot outlive", () => {
  // cf909ac1 r1: Searing Glare begun 23.83, an enemy Wind Shear at 24.69
  // that interrupted nothing, Judgment (on the global cooldown) out at
  // 24.84; the next Searing Glare 50.1, completed 51.3
  const JUDGMENT = "275773";
  const FIRE_BLAST = "108853"; // off the GCD, castable while casting
  const SHADOWY_APPARITION = "341263"; // no SpellCooldowns row: no press
  const rows = (pressId: string, pressS: number): OwnerRows => ({
    castStartEvents: [23.83, 50.1].map((s) => start(SEARING_GLARE, s)),
    spellCastEvents: [success(pressId, pressS), success(SEARING_GLARE, 51.3)],
  });
  const firstEnd = (r: OwnerRows) =>
    castBarOutcomesOf({
      unit: makeUnit("p1", r),
      startMs: T0,
      failed: streamsOf([]).castFailed,
    })[0]!.end;

  it("is a cancel of the ledger, and the kick that went out at it is a baited kick", () => {
    const r = ledger(rows(JUDGMENT, 24.84), [24.69]);
    expect(r.cancels).toEqual([
      {
        spellId: SEARING_GLARE,
        spellName: expect.any(String),
        startS: 23.83,
        // the press: the stop is at or before it
        cancelS: 24.84,
        progressPct: null,
        unlogged: true,
      },
    ]);
    expect(r.baitedKicks.map((b) => b.atSeconds)).toEqual([24.69]);
  });

  it("codex #1: a kick just after the press, still called juked, went out at this bar", () => {
    // 2e45d523 r1: Polymorph begun 97.892, Counterspell out 98.917, Counter
    // Shot 99.013 — inside the audit's "just before"
    expect(
      ledger(rows(JUDGMENT, 24.84), [24.94]).baitedKicks.map(
        (b) => b.atSeconds,
      ),
    ).toEqual([24.94]);
    // …but not once another bar has begun in between
    const r: OwnerRows = {
      castStartEvents: [
        start(SEARING_GLARE, 23.83),
        start(FLASH_OF_LIGHT, 24.9),
        start(SEARING_GLARE, 50.1),
      ],
      spellCastEvents: [success(JUDGMENT, 24.84), success(SEARING_GLARE, 51.3)],
    };
    const l = ledger(r, [25.0]);
    expect(
      l.baitedKicks.filter((b) => b.baitSpellName !== "Flash of Light"),
    ).toEqual([]);
  });

  it("the reading: `none` with `superseded` at the press", () => {
    expect(firstEnd(rows(JUDGMENT, 24.84))).toEqual({
      kind: "none",
      superseded: { atS: 24.84, near: null },
    });
  });

  it("a press that rides along with a cast, or a row that is no button, ends nothing", () => {
    expect(firstEnd(rows(FIRE_BLAST, 24.84))).toEqual({ kind: "none" });
    expect(firstEnd(rows(SHADOWY_APPARITION, 24.84))).toEqual({
      kind: "none",
    });
    expect(ledger(rows(FIRE_BLAST, 24.84), [24.69]).cancels).toEqual([]);
  });

  it("a press past the bar's cap says nothing of it", () => {
    expect(firstEnd(rows(JUDGMENT, 28.5))).toEqual({ kind: "none" });
  });

  it("the earlier of the press and the next bar supersedes", () => {
    const r: OwnerRows = {
      castStartEvents: [
        start(SEARING_GLARE, 23.83),
        start(FLASH_OF_LIGHT, 24.5),
        start(SEARING_GLARE, 50.1),
      ],
      spellCastEvents: [success(JUDGMENT, 25.2), success(SEARING_GLARE, 51.3)],
    };
    expect(firstEnd(r)).toEqual({
      kind: "none",
      superseded: { atS: 24.5, near: null },
    });
  });

  it("the previous bar's queued completion just after this START is no new press", () => {
    // Flash of Light begun 10, its SUCCESS logged 0.1 s after the next START
    const bars = castBarOutcomesOf({
      unit: makeUnit("p1", {
        castStartEvents: [
          start(FLASH_OF_LIGHT, 10),
          start(SEARING_GLARE, 11.5),
        ],
        spellCastEvents: [success(FLASH_OF_LIGHT, 11.6)],
      }),
      startMs: T0,
      failed: streamsOf([]).castFailed,
    });
    expect(bars[1]!.end).toEqual({ kind: "none" });
  });

  it("a bar with its own end row keeps it, whatever was pressed inside", () => {
    expect(
      firstEnd({
        castStartEvents: [start(SEARING_GLARE, 23.83)],
        spellCastEvents: [
          success(JUDGMENT, 24.3),
          success(SEARING_GLARE, 25.0),
        ],
      }),
    ).toEqual({ kind: "completed", atS: 25.0 });
  });
});

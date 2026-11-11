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

/**
 * scan5/t47: the recorder's cast bar that ended with no row at all. The shape
 * is 1d26a991's — Searing Glare begun 28.02 and again 29.14 with no row of
 * the spell between the two SPELL_CAST_START rows, an enemy Disrupt at 28.77
 * that interrupted nothing.
 */
import { ensureAnalysisData } from "@gladlog/analysis/src/data/ensure";
import { CombatUnitReaction, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "../../analysis/test/ported/testHelpers";
import { run } from "../scripts/scan5/t47";

const START = 1_000_000;
const at = (s: number) => START + s * 1000;
const SEARING_GLARE = "410126";
const FLASH_OF_LIGHT = "19750";
const DISRUPT = "183752";
const HAMMER_OF_JUSTICE = "853";

type Ctx = Parameters<typeof run>[0];
type OwnerRows = Parameters<typeof makeUnit>[1];

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

function scan(
  rows: OwnerRows,
  kicksAtS: number[],
  castFailed: ReturnType<typeof fail>[] = [],
): { checked: Record<string, number>; seen: string[] } {
  const seen: string[] = [];
  const checked: Record<string, number> = {};
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
  const legacy = {
    startTime: START,
    endTime: at(120),
    units: { p1: owner, e1: enemy },
  };
  run({
    firstOwnerOfRound: true,
    players: [owner, enemy],
    units: [owner, enemy],
    legacy,
    start: START,
    where: "f",
    rawStreams: () => ({
      available: true,
      manaSamples: [],
      // one row of another spell, so the unit is the log's recorder
      castFailed: [fail("20271", 5, "Not yet recovered"), ...castFailed],
    }),
    violate: (check: string, kind: string, _t: number, _f: string, d: string) =>
      seen.push(`${check}|${kind}: ${d}`),
    bump: (c: string, n = 1) => {
      checked[c] = (checked[c] ?? 0) + n;
    },
  } as unknown as Ctx);
  return { checked, seen };
}

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("scan5/t47 — a bar the next cast bar replaced, with no end row", () => {
  const repro: OwnerRows = {
    castStartEvents: [28.02, 29.14, 35.17].map((s) => start(SEARING_GLARE, s)),
    spellCastEvents: [success(SEARING_GLARE, 36.35)],
  };

  it("the bar and the kick that went out at it are in the ledger: counted, no violation", () => {
    // before T47 this was 1 violation of each check (4 and 2 on the match)
    expect(scan(repro, [28.77])).toEqual({
      checked: { unloggedStopNotCancel: 1, jukedNotBaited: 1 },
      seen: [],
    });
  });

  it("a bar with an Interrupted row is the logged cancel, not this check's", () => {
    const r = scan(repro, [28.77], [fail(SEARING_GLARE, 28.9, "Interrupted")]);
    expect(r).toEqual({ checked: { jukedNotBaited: 1 }, seen: [] });
  });

  it("not counted: a control between the two starts, a spell that never completes as itself, the next bar past the cap", () => {
    expect(
      scan(
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
        [],
      ).checked,
    ).toEqual({});
    expect(
      scan(
        {
          castStartEvents: [28.02, 29.14].map((s) => start(SEARING_GLARE, s)),
          spellCastEvents: [],
        },
        [],
      ).checked,
    ).toEqual({});
    expect(
      scan(
        {
          castStartEvents: [28, 32.5, 35.17].map((s) =>
            start(SEARING_GLARE, s),
          ),
          spellCastEvents: [success(SEARING_GLARE, 36.35)],
        },
        [],
      ).checked,
    ).toEqual({ unloggedStopNotCancel: 1 }); // 32.5 → 35.17 only
  });

  it("not counted: the next START is an instant (its SUCCESS in the same ms)", () => {
    const r = scan(
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
      [],
    );
    expect(r).toEqual({ checked: {}, seen: [] });
  });

  it("a SUCCESS of the START's millisecond logged before it is the previous cast's (codex #4)", () => {
    const line = (e: object, lineIndex: number) => {
      const row = e as { logLine: object };
      return { ...row, logLine: { ...row.logLine, lineIndex } } as never;
    };
    const r = scan(
      {
        castStartEvents: [
          line(start(SEARING_GLARE, 28.02), 101),
          line(start(SEARING_GLARE, 29.14), 200),
          line(start(SEARING_GLARE, 35.17), 300),
        ],
        spellCastEvents: [
          line(success(SEARING_GLARE, 28.02), 100),
          line(success(SEARING_GLARE, 36.35), 400),
        ],
      },
      [],
    );
    expect(r).toEqual({ checked: { unloggedStopNotCancel: 1 }, seen: [] });
  });

  it("not counted: the only later bar of the spell was interrupted before its SUCCESS (codex 1b #2)", () => {
    const r = scan(
      {
        castStartEvents: [
          start(SEARING_GLARE, 28.02),
          start(FLASH_OF_LIGHT, 29.14),
          start(SEARING_GLARE, 35.17),
        ],
        spellCastEvents: [
          success(FLASH_OF_LIGHT, 30.3),
          success(SEARING_GLARE, 36.35),
        ],
      },
      [],
      [fail(SEARING_GLARE, 35.7, "Interrupted")],
    );
    expect(r).toEqual({ checked: {}, seen: [] });
  });

  it("the next bar of another spell is the same reading", () => {
    const r = scan(
      {
        castStartEvents: [
          start(SEARING_GLARE, 28.02),
          start(FLASH_OF_LIGHT, 28.9),
          start(SEARING_GLARE, 35.17),
        ],
        spellCastEvents: [
          success(FLASH_OF_LIGHT, 30.3),
          success(SEARING_GLARE, 36.35),
        ],
      },
      [],
    );
    expect(r).toEqual({ checked: { unloggedStopNotCancel: 1 }, seen: [] });
  });
});

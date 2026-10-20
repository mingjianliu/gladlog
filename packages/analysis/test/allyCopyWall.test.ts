/* eslint-disable @typescript-eslint/no-explicit-any */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { MITIGATION_TABLE } from "../src/data/mitigationData";
import {
  ALLY_COPY_PAIR_MS,
  allyCopyRecipient,
  isAllyCopyWallId,
} from "../src/utils/allyCopyWall";
import {
  enemyDefensiveEvents,
  isBelowWallFloorExternal,
} from "../src/utils/enemyDefensives";

/**
 * F15 / fact1215 C1: a Flameshaper Obsidian Scales press cast on an ally puts
 * the aura on the caster AND on the ally. The log fact is the ally's copy;
 * the cast's dest alone proves nothing (without Lifecinders the cast line
 * names the caster's current target and nothing lands there).
 */

const MATCH_START = Date.UTC(2026, 9, 16);
const ms = (s: number): number => MATCH_START + s * 1000;
const OS = "363916";

function unit(id: string, over: Record<string, unknown> = {}): any {
  return {
    id,
    name: id,
    type: 1,
    spec: "1468",
    reaction: 1,
    info: {},
    spellCastEvents: [],
    auraEvents: [],
    damageOut: [],
    damageIn: [],
    healIn: [],
    deathRecords: [],
    advancedActions: [],
    ...over,
  };
}
const aura = (
  src: string,
  dest: string,
  atS: number,
  event: LogEvent,
): any => ({
  spellId: OS,
  spellName: "Obsidian Scales",
  srcUnitId: src,
  srcUnitName: src,
  destUnitId: dest,
  destUnitName: dest,
  timestamp: ms(atS),
  logLine: { event, timestamp: ms(atS), parameters: [] },
  auraType: "BUFF",
});
const applied = (src: string, dest: string, atS: number) =>
  aura(src, dest, atS, LogEvent.SPELL_AURA_APPLIED);
const refreshed = (src: string, dest: string, atS: number) =>
  aura(src, dest, atS, LogEvent.SPELL_AURA_REFRESH);
const removed = (src: string, dest: string, atS: number) =>
  aura(src, dest, atS, LogEvent.SPELL_AURA_REMOVED);
const cast = (dest: string, atS: number): any => ({
  spellId: OS,
  spellName: "Obsidian Scales",
  destUnitId: dest,
  destUnitName: dest,
  logLine: {
    event: LogEvent.SPELL_CAST_SUCCESS,
    timestamp: ms(atS),
    parameters: [],
  },
});
const combat = { startTime: ms(0), endTime: ms(120) };

describe("allyCopyWall", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("the talent-shared walls are exactly the table rows with pctOnOthers", () => {
    const ids = Object.keys(MITIGATION_TABLE).filter(isAllyCopyWallId);
    expect(ids).toEqual([OS]);
    expect(MITIGATION_TABLE[OS]!.pctOnOthers).toBe(15);
  });

  it("names the ally only when the ally's copy is in the log", () => {
    const by = (units: any[]) => units;
    const ally = unit("a1", { auraEvents: [applied("ev", "a1", 10)] });
    expect(allyCopyRecipient("ev", cast("a1", 10), by([ally]))?.id).toBe("a1");
    // a REFRESH of an ally copy still up is the same press landing
    const refreshedAlly = unit("a1", {
      auraEvents: [refreshed("ev", "a1", 10)],
    });
    expect(
      allyCopyRecipient("ev", cast("a1", 10), by([refreshedAlly]))?.id,
    ).toBe("a1");
    // dest named, nothing landed there (no Lifecinders)
    expect(
      allyCopyRecipient("ev", cast("a1", 10), by([unit("a1")])),
    ).toBeUndefined();
    // another caster's copy is not this press's
    const other = unit("a1", { auraEvents: [applied("ev2", "a1", 10)] });
    expect(
      allyCopyRecipient("ev", cast("a1", 10), by([other])),
    ).toBeUndefined();
    // outside the pairing window
    const late = unit("a1", {
      auraEvents: [applied("ev", "a1", 10 + (ALLY_COPY_PAIR_MS + 1) / 1000)],
    });
    expect(allyCopyRecipient("ev", cast("a1", 10), by([late]))).toBeUndefined();
    // cast on oneself
    const self = unit("ev", { auraEvents: [applied("ev", "ev", 10)] });
    expect(allyCopyRecipient("ev", cast("ev", 10), by([self]))).toBeUndefined();
  });

  it("fact2 C1: the copy is found on whichever ally carries it — dest the caster, or dest another unit", () => {
    const self = unit("ev", { auraEvents: [applied("ev", "ev", 10)] });
    const ally = unit("a1", { auraEvents: [applied("ev", "a1", 10.027)] });
    // 0457a45e 0:48: the press names the evoker itself, the copy is on Tupi
    expect(
      allyCopyRecipient("ev", cast("ev", 10), [self, ally])?.id,
    ).toBe("a1");
    // 691a7f31 2:21: aimed at an enemy, the copy is on a teammate
    const enemy = unit("x1");
    expect(
      allyCopyRecipient("ev", cast("x1", 10), [self, enemy, ally])?.id,
    ).toBe("a1");
    // two carriers: the cast's dest wins over a closer one
    const a2 = unit("a2", { auraEvents: [applied("ev", "a2", 10)] });
    expect(
      allyCopyRecipient("ev", cast("a1", 10), [self, a2, ally])?.id,
    ).toBe("a1");
  });

  it("[ENEMY DEF]: the ally copy is an external at 15 %, below the wall floor; the caster keeps its self line", () => {
    const evoker = unit("ev", {
      spellCastEvents: [cast("a1", 10)],
      auraEvents: [applied("ev", "ev", 10), removed("ev", "ev", 22)],
    });
    const ally = unit("a1", {
      auraEvents: [applied("ev", "a1", 10), removed("ev", "a1", 22)],
    });
    const ev = enemyDefensiveEvents(evoker, [evoker, ally], combat);
    expect(
      ev.map((d) => [d.kind, d.recipientId, d.pct, d.observedSeconds]),
    ).toEqual([
      ["self", undefined, 30, 12],
      ["external", "a1", 15, 12],
    ]);
    expect(isBelowWallFloorExternal(ev[1]!)).toBe(true);
    expect(isBelowWallFloorExternal(ev[0]!)).toBe(false);
  });

  it("[ENEMY DEF]: a press that only REFRESHes the caster's own copy still has its ally line (332b9b2f)", () => {
    const evoker = unit("ev", {
      spellCastEvents: [cast("a1", 10), cast("a2", 20)],
      auraEvents: [
        applied("ev", "ev", 10),
        refreshed("ev", "ev", 20),
        removed("ev", "ev", 32),
      ],
    });
    const a1 = unit("a1", {
      auraEvents: [applied("ev", "a1", 10), removed("ev", "a1", 22)],
    });
    const a2 = unit("a2", {
      auraEvents: [applied("ev", "a2", 20), removed("ev", "a2", 32)],
    });
    const ext = enemyDefensiveEvents(evoker, [evoker, a1, a2], combat).filter(
      (d) => d.kind === "external",
    );
    expect(ext.map((d) => [d.recipientId, d.atSeconds])).toEqual([
      ["a1", 10],
      ["a2", 20],
    ]);
  });

  it("[ENEMY DEF]: a press with no ally copy (cast line naming an enemy) stays a self wall only", () => {
    const evoker = unit("ev", {
      spellCastEvents: [cast("x1", 10)],
      auraEvents: [applied("ev", "ev", 10), removed("ev", "ev", 22)],
    });
    const enemyOfTheEvoker = unit("x1");
    expect(
      enemyDefensiveEvents(evoker, [evoker, enemyOfTheEvoker], combat).map(
        (d) => d.kind,
      ),
    ).toEqual(["self"]);
  });
});

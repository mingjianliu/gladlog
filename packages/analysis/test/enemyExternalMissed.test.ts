/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * fact3 D24 (3cf004cb 0:46): an external press whose own SPELL_MISSED row
 * says it never reached the ally — Pain Suppression IMMUNE on a cycloned
 * DK, no aura ever applied — put nothing on it, so it has no `[ENEMY DEF]
 * … → ally` line. A press with neither aura nor miss row keeps its line
 * (Lay on Hands leaves no aura).
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { enemyDefensiveEvents } from "../src/utils/enemyDefensives";

const T0 = Date.UTC(2026, 9, 21);
const ms = (s: number): number => T0 + Math.round(s * 1000);
const PAIN_SUPPRESSION = "33206";
const combat = { startTime: T0, endTime: ms(120) };

const unit = (id: string, over: Record<string, unknown> = {}): any => ({
  id,
  name: id,
  type: 1,
  reaction: 1,
  info: {},
  auraEvents: [],
  spellCastEvents: [],
  missesOut: [],
  ...over,
});

const press = (atS: number): any => ({
  spellId: PAIN_SUPPRESSION,
  spellName: "Pain Suppression",
  srcUnitId: "priest",
  destUnitId: "dk",
  destUnitName: "dk",
  logLine: {
    event: LogEvent.SPELL_CAST_SUCCESS,
    timestamp: ms(atS),
    parameters: [],
  },
});

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("an external press that missed its ally (fact3 D24)", () => {
  it("IMMUNE on the ally, no aura: no external event", () => {
    const priest = unit("priest", {
      spellCastEvents: [press(46.73)],
      missesOut: [
        {
          timestamp: ms(46.731),
          spellId: PAIN_SUPPRESSION,
          srcUnitId: "priest",
          destUnitId: "dk",
          missType: "IMMUNE",
          amount: 0,
          logLine: { event: LogEvent.SPELL_MISSED, timestamp: ms(46.731) },
        },
      ],
    });
    const dk = unit("dk");
    expect(
      enemyDefensiveEvents(priest, [priest, dk], combat).filter(
        (e) => e.kind === "external",
      ),
    ).toEqual([]);
  });
  it("no aura and no miss row: the press keeps its line", () => {
    const priest = unit("priest", { spellCastEvents: [press(46.73)] });
    const dk = unit("dk");
    expect(
      enemyDefensiveEvents(priest, [priest, dk], combat)
        .filter((e) => e.kind === "external")
        .map((e) => e.recipientId),
    ).toEqual(["dk"]);
  });
});

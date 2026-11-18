/* eslint-disable @typescript-eslint/no-explicit-any -- the scan context is a fake */
/**
 * scan5/t134 `procCastReadAsPress` (T134): a low-HP proc's marker beside a
 * cast of the cooldown it casts — counted, its cast row measured, and no
 * ledger press beside it.
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "../../analysis/test/ported/testHelpers";
import { run } from "../scripts/scan5/t134";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T = 1_000_000;
const FR = "22842";

function scan(castSeconds: number[], markerSeconds: number[]) {
  const druid = makeUnit("P1", {
    class: CombatUnitClass.Druid,
    spec: CombatUnitSpec.Druid_Feral,
    reaction: CombatUnitReaction.Friendly,
    spellCastEvents: castSeconds.map((s) =>
      makeSpellCastEvent(
        FR,
        T + s * 1000,
        "P1",
        "P1",
        "P1",
        "P1",
        0,
        "Frenzied Regeneration",
      ),
    ),
    auraEvents: markerSeconds.map((s) =>
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        "382912",
        T + s * 1000,
        "P1",
        "P1",
        "BUFF",
      ),
    ),
  });
  const kinds: string[] = [];
  let checked = 0;
  run({
    firstOwnerOfRound: true,
    roundKey: "r",
    start: T,
    roundEndAt: T + 300_000,
    owner: druid,
    players: [druid],
    units: [druid],
    legacy: { startTime: T, endTime: T + 300_000, units: { P1: druid } },
    bump: () => {
      checked++;
    },
    violate: (_c: string, k: string) => {
      kinds.push(k);
    },
  } as any);
  return { checked, kinds };
}

describe("scan5 procCastReadAsPress", () => {
  it("a proc (no cast row of its own) beside two presses: nothing in the ledger at the marker", () => {
    expect(scan([19.3, 54.6], [44.8])).toEqual({ checked: 1, kinds: [] });
  });

  it("a press a second after the proc is measured and stays a press", () => {
    expect(scan([46], [44.8]).kinds).toEqual([
      "Frenzied Regeneration | cast row within 1500 ms",
    ]);
  });

  it("a real cast row 50 ms before the marker is the player's press: measured, not a violation (assembly review 80-PIPE-127-B112)", () => {
    expect(scan([44.75], [44.8])).toEqual({
      checked: 1,
      kinds: ["Frenzied Regeneration | cast row within 100 ms"],
    });
  });

  it("no marker, nothing checked", () => {
    expect(scan([19.3, 44.8], [])).toEqual({ checked: 0, kinds: [] });
  });
});

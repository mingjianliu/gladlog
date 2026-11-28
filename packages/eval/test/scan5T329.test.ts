/**
 * Pipeline T329 — scan5 castLineNoButton read an item's spell (a drink, a
 * toy, a mount) and two class buttons with no DB2 SpellCooldowns row as a
 * passive's row (54 in-total rows on the 605, all the scan's error). An
 * item's pressed spell (DB2 ItemEffect, on use / learned) is a button; the
 * reviewed class buttons (`NO_COOLDOWN_ROW_BUTTON_IDS`) count out of the
 * total; a passive's row stays flagged.
 *
 * Writes `DATAGEN_CACHE` to a fixture cache, so this file runs isolated (not
 * listed in vitest.shared.json).
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureAnalysisData } from "@gladlog/analysis";
import { NO_COOLDOWN_ROW_BUTTON_IDS } from "@gladlog/analysis/src/data/noCooldownRowButtons";
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { DB2_BUILD } from "../scripts/scan5/db2Cache";
import { DB2_TABLES, OUT_OF_TOTAL, run } from "../scripts/scan5/fact11";

const START = 1_000_000;

interface IViolation {
  check: string;
  kind: string;
}

/** the kinds castLineNoButton files for one `[YOU] [CAST]` line at 0:20 */
function kindsOf(spellId: string, spellName: string): string[] {
  const owner = {
    id: "o",
    name: "Owner",
    pid: "1",
    reaction: 1,
    spellCastEvents: [
      {
        timestamp: START + 20_300,
        logLine: {
          event: LogEvent.SPELL_CAST_SUCCESS,
          timestamp: START + 20_300,
          lineIndex: 0,
        },
        srcUnitId: "o",
        spellId,
        spellName,
      },
    ],
  };
  const players = [owner];
  const lines = [`0:20  [YOU] [CAST]   ${spellName}`];
  const seen: IViolation[] = [];
  const end = START + 600_000;
  run({
    lines,
    text: lines.join("\n"),
    menu: "",
    rawLines: [],
    legacy: { startTime: START, endTime: end, units: { o: owner } },
    players,
    units: players,
    byName: new Map([[owner.name, owner]]),
    owner,
    unitOfPid: (pid: string | undefined) => players.find((p) => p.pid === pid),
    pidOf: (name: string) => players.find((p) => p.name === name)?.pid,
    start: START,
    end,
    roundEndAt: end,
    bump: () => {},
    violate: (check: string, kind: string) => seen.push({ check, kind }),
  } as unknown as Parameters<typeof run>[0]);
  return seen.filter((v) => v.check === "castLineNoButton").map((v) => v.kind);
}

beforeAll(async () => {
  await ensureAnalysisData();
  // a fixture cache: Drink 1291791 on use (0), Argent Charger 66906 learned
  // (6), a made-up equip passive 999001 (1)
  const dir = mkdtempSync(join(tmpdir(), "scan5T329-"));
  writeFileSync(
    join(dir, `ItemEffect-${DB2_BUILD}.csv`),
    [
      "ID,LegacySlotIndex,TriggerType,Charges,CoolDownMSec,CategoryCoolDownMSec,SpellCategoryID,SpellID,ChrSpecializationID,PlayerConditionID",
      "1,0,0,0,0,0,0,1291791,0,0",
      "2,0,6,0,0,0,0,66906,0,0",
      "3,0,1,0,0,0,0,999001,0,0",
      "",
    ].join("\n"),
  );
  process.env.DATAGEN_CACHE = dir;
});

describe("castLineNoButton (T329)", () => {
  it("declares the ItemEffect table, so a run without it is refused", () => {
    expect(DB2_TABLES.castLineNoButton).toEqual(["ItemEffect"]);
  });

  it("reads a drink's on-use spell as a button", () => {
    expect(kindsOf("1291791", "Drink")).toEqual([]);
  });

  it("reads a mount's learned spell as a button", () => {
    expect(kindsOf("66906", "Argent Charger")).toEqual([]);
  });

  it("still flags an item's equip passive", () => {
    expect(kindsOf("999001", "Equip Passive")).toEqual([
      "Equip Passive 999001",
    ]);
  });

  it("files Rite of Sanctification and Unity Within out of the total", () => {
    for (const [id, name] of [
      ["433568", "Rite of Sanctification"],
      ["443591", "Unity Within"],
    ] as const) {
      expect(NO_COOLDOWN_ROW_BUTTON_IDS.has(id)).toBe(true);
      const kinds = kindsOf(id, name);
      expect(kinds).toEqual(["reviewed button"]);
      expect(OUT_OF_TOTAL.has(`castLineNoButton|${kinds[0]}`)).toBe(true);
    }
  });

  it("still flags the rescued unit's own Rescue row and a passive's row", () => {
    expect(kindsOf("420217", "Rescue")).toEqual(["Rescue 420217"]);
    expect(kindsOf("289655", "Sanctified Ground")).toEqual([
      "Sanctified Ground 289655",
    ]);
  });
});

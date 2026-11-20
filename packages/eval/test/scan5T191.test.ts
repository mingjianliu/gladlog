/**
 * scan5 t191 (review 85-tk-CD-T191-2 #1): a re-steal after the next press
 * REFRESHED the debuff (7a4d43c8 shape — the refreshing press steals in the
 * refresh's own ms, the earlier press's repeat 12 ms later) is found from the
 * raw rows, so a producer that misses the refresh evidence is caught.
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { parseRawTimestamp } from "@gladlog/analysis/src/utils/rawStreams";
import { beforeAll, describe, expect, it } from "vitest";

import { run } from "../scripts/scan5/t191";

const MAGE = "Player-1-AAAA";
const TARGET = "Player-2-BBBB";
const row = (ms: string, ev: string, rest: string) =>
  `11/8/2026 20:01:${ms}-5  ${ev},${MAGE},"Mage-R",0x548,0x80000000,${TARGET},"Druid-R",0x10512,0x80000000,${rest}`;
const LINES = [
  row("09.179", "SPELL_CAST_SUCCESS", '30449,"Spellsteal",0x40'),
  row("09.188", "SPELL_AURA_REFRESH", '1270828,"Spellsteal",0x40,DEBUFF'),
  row(
    "09.188",
    "SPELL_STOLEN",
    '30449,"Spellsteal",0x40,1126,"Mark of the Wild",8,BUFF',
  ),
  row(
    "09.200",
    "SPELL_STOLEN",
    '30449,"Spellsteal",0x40,774,"Rejuvenation",8,BUFF',
  ),
];
const ms = (s: string) => parseRawTimestamp(`11/8/2026 20:01:${s}-5`)!;

/** the producer's view of the round: the mage's press, and (or not) the
 * refresh row on the target */
function units(withRefresh: boolean) {
  return [
    {
      id: MAGE,
      spellCastEvents: [
        {
          logLine: { event: "SPELL_CAST_SUCCESS" },
          srcUnitId: MAGE,
          destUnitId: TARGET,
          spellId: "30449",
          spellName: "Spellsteal",
          timestamp: ms("09.179"),
        },
      ],
      auraEvents: [],
    },
    {
      id: TARGET,
      spellCastEvents: [],
      auraEvents: withRefresh
        ? [
            {
              logLine: { event: "SPELL_AURA_REFRESH" },
              srcUnitId: MAGE,
              spellId: "1270828",
              spellName: "Spellsteal",
              timestamp: ms("09.188"),
            },
          ]
        : [],
    },
  ];
}

function scan(withRefresh: boolean): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  run({
    firstOwnerOfRound: true,
    rawLines: LINES,
    start: ms("00.000"),
    roundEndAt: ms("59.000"),
    roundKey: "r",
    units: units(withRefresh),
    bump: () => {},
    violate: (c: string, kind: string) => {
      (out[c] ??= []).push(kind);
    },
  } as never);
  return out;
}

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("scan5 t191 — a re-steal after a refresh", () => {
  it("the repeat 12 ms after the refresh is found; the refreshing press's own steal is not", () => {
    expect(scan(true).restealShape).toEqual(["after a refresh | resolved"]);
  });

  it("a producer that misses the refresh reads the repeat as a press — the scan flags it", () => {
    expect(scan(false).restealReadAsPress).toEqual([
      "after a refresh | resolved",
    ]);
  });

  it("with the refresh row, the producer reads it as the earlier press's — no violation", () => {
    const out = scan(true);
    expect(out.restealReadAsPress).toBeUndefined();
    expect(out.restealSideEffect).toBeUndefined();
  });
});

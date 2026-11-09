/* eslint-disable @typescript-eslint/no-explicit-any -- fake legacy parse objects, the check reads them untyped */
/**
 * scan5/t17 `noManaCostOffBase`: a [RES] `(no mana a/b)` tag's b against the
 * cost the owner's own cast rows imply (GH #129.1). The shape is 3282debd's:
 * a Holy Paladin whose max mana is above base, Divine Toll printed `8.2k`
 * (3 % of the max) where base prices it 7,500.
 */
import { ensureAnalysisData } from "@gladlog/analysis/src/data/ensure";
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { run } from "../scripts/scan5/t17";

const START = 1_000_000;
/** the round's length; a row after it is a later Solo Shuffle round's */
const ROUND_MS = 120_000;
const HOLY_LIGHT = "82326"; // 7 %
const DIVINE_TOLL = "375576"; // 3 %
const VIVIFY = "116670"; // 3 % (Mistweaver)

const cast = (spellId: string, atMs: number, cost?: number): any => ({
  spellId,
  timestamp: START + atMs,
  logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: START + atMs },
  ...(cost !== undefined ? { powerCosts: [{ type: 0, cost }] } : {}),
});

function scan(
  owner: any,
  lines: string[],
): { checked: number; seen: string[] } {
  const seen: string[] = [];
  let checked = 0;
  run({
    lines,
    owner,
    start: START,
    legacy: { startTime: START, endTime: START + ROUND_MS },
    violate: (check: string, _k: string, _t: number, _f: string, d: string) =>
      seen.push(`${check}: ${d}`),
    bump: () => {
      checked++;
    },
  } as any);
  return { checked, seen };
}

const paladin = (casts: any[]) => ({
  name: "Paladin",
  spec: "65",
  spellCastEvents: casts,
});

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("scan5/t17 noManaCostOffBase", () => {
  it("a percentage cost priced on the max is caught, on base it passes", () => {
    const owner = paladin([cast(HOLY_LIGHT, 5_000, 17_500)]); // base 250,000
    expect(
      scan(owner, [
        "      [RES] rdy:Δ +Divine Toll(no mana 4.1k/8.2k) +Blessing of Sacrifice  cd:—",
      ]).seen,
    ).toEqual([
      "noManaCostOffBase: Paladin Divine Toll 375576: printed 8.2k, the log implies 7.5k (base 250000)",
    ]);
    expect(
      scan(owner, [
        "      [RES] rdy:Aura Mastery,Divine Toll(no mana 4.1k/7.5k),2:Blessing of Sacrifice  cd:—",
      ]),
    ).toEqual({ checked: 1, seen: [] });
  });

  it("no percentage-priced cast row to read base mana from → not counted", () => {
    expect(
      scan(paladin([cast(DIVINE_TOLL, 5_000)]), [
        "      [RES] rdy:Δ +Divine Toll(no mana 4.1k/8.2k)",
      ]),
    ).toEqual({ checked: 0, seen: [] });
  });

  it("the spell's own stated cost is the truth when the owner's rows carry it", () => {
    // Divine Toll stated 7,500 in another round; no other pct row needed
    const owner = paladin([cast(DIVINE_TOLL, 5_000, 7_500)]);
    expect(
      scan(owner, ["      [RES] rdy:Δ +Divine Toll(no mana 4.1k/8.2k)"]).seen,
    ).toEqual([
      "noManaCostOffBase: Paladin Divine Toll 375576: printed 8.2k, the log implies 7.5k (its own cast rows)",
    ]);
  });

  it("a name carrying a comma is read whole, full and delta form (codex 85-tk-E-T17-1 #1)", () => {
    const monk = {
      name: "Monk",
      spec: "270",
      spellCastEvents: [cast(VIVIFY, 5_000, 7_500)], // base 250,000
    };
    for (const line of [
      "      [RES] rdy:Δ +Invoke Chi-Ji, the Red Crane(no mana 4.0k/13.1k)",
      "      [RES] rdy:Life Cocoon,Invoke Chi-Ji, the Red Crane(no mana 4.0k/13.1k),2:Blessing of Sacrifice",
    ])
      expect(scan(monk, [line])).toEqual({
        checked: 1,
        seen: [
          "noManaCostOffBase: Monk Invoke Chi-Ji, the Red Crane 325197: printed 13.1k, the log implies 12.5k (base 250000)",
        ],
      });
  });

  it("a flat cost is the truth even when the spell's rows state what it drained (codex 85-tk-E-T17-1b)", () => {
    // Arcane Surge 365350: 1 mana flat, its cast row states 320,773
    const mage = {
      name: "Mage",
      spec: "62",
      spellCastEvents: [cast("365350", 5_000, 320_773)],
    };
    expect(
      scan(mage, ["      [RES] rdy:Δ +Arcane Surge(no mana 0.0k/0.0k)"]),
    ).toEqual({ checked: 1, seen: [] });
  });

  it("only the round's own rows are read, through the producer's selection (batch review 80-PIPE-31-B31b #1)", () => {
    // Divine Toll stated 7,500 in this round, 8,250 twice in a later one
    const owner = paladin([
      cast(DIVINE_TOLL, 5_000, 7_500),
      cast(DIVINE_TOLL, ROUND_MS + 10_000, 8_250),
      cast(DIVINE_TOLL, ROUND_MS + 70_000, 8_250),
    ]);
    expect(
      scan(owner, ["      [RES] rdy:Δ +Divine Toll(no mana 4.1k/7.5k)"]),
    ).toEqual({ checked: 1, seen: [] });
    expect(
      scan(owner, ["      [RES] rdy:Δ +Divine Toll(no mana 4.1k/8.3k)"]).seen,
    ).toEqual([
      "noManaCostOffBase: Paladin Divine Toll 375576: printed 8.3k, the log implies 7.5k (its own cast rows)",
    ]);
    // base mana from a later round's row only: no truth for this round
    expect(
      scan(paladin([cast(HOLY_LIGHT, ROUND_MS + 5_000, 17_500)]), [
        "      [RES] rdy:Δ +Divine Toll(no mana 4.1k/8.2k)",
      ]),
    ).toEqual({ checked: 0, seen: [] });
  });
});

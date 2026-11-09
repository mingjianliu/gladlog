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
const HOLY_LIGHT = "82326"; // 7 %
const DIVINE_TOLL = "375576"; // 3 %

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
});

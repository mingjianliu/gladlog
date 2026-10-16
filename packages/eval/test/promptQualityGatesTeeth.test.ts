import {
  lookupSyncWindowPrior,
  syncRefClearsMinContrast,
} from "@gladlog/analysis/src/data/syncWindowPrior";
import { describe, expect, it } from "vitest";

import type { CoverageManifest } from "../src/quality/coverageManifest";
import {
  checkFriendlyDeaths,
  checkSpells,
  checkSyncWindowRefConsistency,
  checkTrinkets,
} from "../src/quality/promptQualityCheck";

// Has-teeth tests for the four gates no test named (2026-10-16 coverage
// check of promptQualityCheck.ts's 98 `check*`): each gate passes the input
// it is meant to pass and fails on the one its doc comment names.

const manifestOf = (
  o: Partial<CoverageManifest> & Partial<Pick<CoverageManifest, "counts">>,
): CoverageManifest =>
  ({
    matchId: "m",
    durationSec: 120,
    players: [],
    deaths: [],
    ccApplied: [],
    interrupts: [],
    dispels: [],
    trinketCasts: [],
    counts: {
      deaths: 0,
      friendlyDeaths: 0,
      ccApplied: 0,
      interrupts: 0,
      dispels: 0,
      trinketCasts: 0,
      ...o.counts,
    },
    ...o,
  }) as CoverageManifest;

describe("checkSpells — an event is covered by its logged OR its English name", () => {
  const events = [
    { spellId: "118", spellName: "变形术", spellNameEn: "Polymorph" },
    { spellId: "853", spellName: "制裁之锤", spellNameEn: "Hammer of Justice" },
    { spellId: null, spellName: null, spellNameEn: null }, // nothing to cover
  ];
  it("both names count; the missing entry names the English name", () => {
    expect(checkSpells("… Polymorph … 制裁之锤 …", events)).toEqual({
      present: 2,
      total: 2,
      missing: [],
    });
    expect(checkSpells("… Polymorph …", events)).toEqual({
      present: 1,
      total: 2,
      missing: ["Hammer of Justice"],
    });
  });
  it("two events of one spell id are one entry", () => {
    expect(checkSpells("", [events[0]!, events[0]!]).total).toBe(1);
  });
});

describe("checkTrinkets — use annotations against the manifest's cast count", () => {
  const manifest = manifestOf({ counts: { trinketCasts: 2 } as never });
  it("'trinketed', 'trinket broke', [TRINKET] / [ENEMY TRINKET] and 'trinket: used' are uses; 'trinket: ON CD' is not", () => {
    expect(
      checkTrinkets(
        ["0:12  [TRINKET] 1(DPriest) used PvP trinket", "0:40 … trinketed …"],
        manifest,
      ),
    ).toEqual({ present: 2, total: 2, missing: [] });
    expect(
      checkTrinkets(
        ["0:12 trinket: ON CD (30s left)", "0:40 [ENEMY TRINKET] out of Fear"],
        manifest,
      ),
    ).toEqual({
      present: 1,
      total: 2,
      missing: ["1 of 2 trinket casts have no use annotation"],
    });
  });
  it("more mentions than casts never over-counts", () => {
    expect(
      checkTrinkets(["trinketed", "trinketed", "trinket broke this CC"], manifest)
        .present,
    ).toBe(2);
  });
});

describe("checkFriendlyDeaths — every friendly death is on a death line, by short name or spec", () => {
  const manifest = manifestOf({
    players: [
      { name: "Looß-Tichondrius-US", spec: "Discipline Priest", reaction: "friendly" },
      { name: "Enemy-Realm", spec: "Arms Warrior", reaction: "hostile" },
    ],
    deaths: [
      { tRelSec: 42, unitName: "Looß-Tichondrius-US", reaction: "friendly" },
      { tRelSec: 70, unitName: "Enemy-Realm", reaction: "hostile" },
    ],
  });
  it("short name on a death line, or the spec on one, covers it; an enemy death is not asked", () => {
    expect(
      checkFriendlyDeaths(["0:42  [DEATH] Looß — killing blow: …"], manifest),
    ).toEqual({ present: 1, total: 1, missing: [] });
    expect(
      checkFriendlyDeaths(["0:42  1 (Discipline Priest — friendly) died"], manifest),
    ).toEqual({ present: 1, total: 1, missing: [] });
  });
  it("the name without a death keyword, or a death keyword without the name, leaves it missing", () => {
    expect(
      checkFriendlyDeaths(
        ["0:40  Looß casts Penance", "0:42  [DEATH] Someone else"],
        manifest,
      ),
    ).toEqual({
      present: 0,
      total: 1,
      missing: ["Looß-Tichondrius-US @ 42s"],
    });
  });
});

describe("checkSyncWindowRefConsistency — the rendered reference numbers are the table's", () => {
  const ref = ["Rated Solo Shuffle", "3v3", "2v2"]
    .map((b) => lookupSyncWindowPrior(b))
    .find((r) => r && syncRefClearsMinContrast(r));
  const lineWith = (facts: string) =>
    `- id=msw:1 type=missed-sync-window t=85s facts={${facts}}`;
  const good = () =>
    lineWith(
      `cellKey=${ref!.cellKey}, refN=${ref!.nEntered + ref!.nUnentered}, refKillEntered=${ref!.killEnteredPct}, refKillUnentered=${ref!.killUnenteredPct}, healer=3(HPriest)`,
    );

  it("premise: the generated table has a bracket that clears the contrast door", () => {
    expect(ref).toBeTruthy();
  });

  it("a row carrying the table's own numbers passes; other lines are not read", () => {
    expect(
      checkSyncWindowRefConsistency([
        "0:10  [STATE] …",
        good(),
        "- id=x type=cd-hoarded t=12s facts={cellKey=whatever}",
      ]),
    ).toEqual([]);
  });

  it("a number the table does not carry, a missing facts block, a missing cellKey and an unknown cell each fail", () => {
    const off = good().replace(
      `refN=${ref!.nEntered + ref!.nUnentered}`,
      `refN=${ref!.nEntered + ref!.nUnentered + 1}`,
    );
    expect(checkSyncWindowRefConsistency([off])).toEqual([
      expect.stringContaining("refN="),
    ]);
    expect(
      checkSyncWindowRefConsistency(["- id=msw:1 type=missed-sync-window t=85s"]),
    ).toEqual([expect.stringContaining("无 facts")]);
    expect(
      checkSyncWindowRefConsistency([lineWith("refN=1, healer=X")]),
    ).toEqual([expect.stringContaining("缺 cellKey")]);
    expect(
      checkSyncWindowRefConsistency([lineWith("cellKey=Nowhere, refN=1")]),
    ).toEqual([expect.stringContaining("查不到")]);
  });
});

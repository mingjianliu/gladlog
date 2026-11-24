/* eslint-disable @typescript-eslint/no-explicit-any -- fake legacy parse objects, the check reads them untyped */
/**
 * scan5 effectEnd `unseenEndOpener` (T261, codex 85-mac-minifix-T261-1 #1):
 * the scan reads the product's own debuff-opener predicate, with row order
 * inside the application's millisecond — a Cheap Shot logged below Vanish's
 * APPLIED in its millisecond ends it; a Polymorph whose SUCCESS sits above
 * Greater Invisibility's APPLIED does not.
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { run } from "../scripts/scan5/effectEnd";

const START = 1_000_000;
const at = (s: number): number => START + s * 1000;
const row = (
  event: string,
  s: number,
  line: number,
  extra: Record<string, unknown>,
) => ({
  timestamp: at(s),
  logLine: { event, timestamp: at(s), lineIndex: line },
  ...extra,
});

function scan(o: {
  auraId: string;
  auraName: string;
  debuffId: string;
  casts: any[];
  printed: string;
}): string[] {
  const applied = row(LogEvent.SPELL_AURA_APPLIED, 10, 2, {
    spellId: o.auraId,
    spellName: o.auraName,
    srcUnitId: "h",
    destUnitId: "h",
    auraType: "BUFF",
  });
  const debuff = row(LogEvent.SPELL_AURA_APPLIED, 10, 5, {
    spellId: o.debuffId,
    spellName: "x",
    srcUnitId: "h",
    destUnitId: "e",
    auraType: "DEBUFF",
  });
  const h = {
    id: "h",
    name: "h",
    reaction: 2,
    info: {},
    spellCastEvents: o.casts,
    auraEvents: [applied],
    damageOut: [],
  };
  const e = { id: "e", name: "e", reaction: 1, info: {}, auraEvents: [debuff] };
  const players = [h, e];
  const kinds: string[] = [];
  run({
    lines: [
      "Burst #1 — 0:09–0:20",
      `  h: ${o.auraName} active ON THE TARGET ${o.printed}s of this burst (already up)`,
    ],
    rawLines: [],
    start: START,
    roundEndAt: at(600),
    units: players,
    players,
    owner: e,
    byName: new Map(players.map((p) => [p.name, p])),
    unitOfPid: () => undefined,
    pidOf: () => undefined,
    bump: () => {},
    violate: (check: string, kind: string) => kinds.push(`${check}/${kind}`),
  } as any);
  return kinds.filter((k) => k.startsWith("unseenEndOpener"));
}

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("scan5 unseenEndOpener — the product's opener reading, row order kept", () => {
  it("a Cheap Shot logged below Vanish's APPLIED in its millisecond ends it (1.0 s printed is a violation)", () => {
    expect(
      scan({
        auraId: "11327",
        auraName: "Vanish",
        debuffId: "1833",
        casts: [],
        printed: "1.0",
      }),
    ).toEqual(["unseenEndOpener/Vanish"]);
  });
  it("a Polymorph whose SUCCESS sits above Greater Invisibility's APPLIED is its own landing (0c2f3878)", () => {
    expect(
      scan({
        auraId: "110960",
        auraName: "Greater Invisibility",
        debuffId: "118",
        casts: [
          row(LogEvent.SPELL_CAST_SUCCESS, 10, 1, {
            spellId: "118",
            spellName: "Polymorph",
            srcUnitId: "h",
            destUnitId: "e",
          }),
        ],
        printed: "1.4",
      }),
    ).toEqual([]);
  });
});

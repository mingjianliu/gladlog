/* eslint-disable @typescript-eslint/no-explicit-any -- fake legacy parse objects, the check reads them untyped */
/**
 * scan5 effectEnd `unseenEndOpener` (T261, codex 85-mac-minifix-T261-1 #1,
 * -1b #1 / #2): the scan reads the product's own debuff-opener predicate and
 * row, with row order inside the application's millisecond, on the burst
 * target's own run.
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { run } from "../scripts/scan5/effectEnd";

const START = 1_000_000;
const at = (s: number): number => START + s * 1000;
let lineNo = 0;
const row = (
  event: string,
  s: number,
  extra: Record<string, unknown>,
  line = ++lineNo,
) => ({
  timestamp: at(s),
  logLine: { event, timestamp: at(s), lineIndex: line },
  ...extra,
});
const aura = (
  event: string,
  spellId: string,
  spellName: string,
  s: number,
  src: string,
  dest: string,
  auraType: string,
  line?: number,
) =>
  row(
    event,
    s,
    { spellId, spellName, srcUnitId: src, destUnitId: dest, auraType },
    line,
  );
const applied = (
  id: string,
  name: string,
  s: number,
  holder: string,
  line?: number,
) =>
  aura(LogEvent.SPELL_AURA_APPLIED, id, name, s, holder, holder, "BUFF", line);
const removed = (id: string, name: string, s: number, holder: string) =>
  aura(LogEvent.SPELL_AURA_REMOVED, id, name, s, holder, holder, "BUFF");
const debuff = (id: string, s: number, src: string, line?: number) =>
  aura(LogEvent.SPELL_AURA_APPLIED, id, "x", s, src, "e", "DEBUFF", line);
const cast = (
  id: string,
  s: number,
  src: string,
  dest: string,
  line?: number,
) =>
  row(
    LogEvent.SPELL_CAST_SUCCESS,
    s,
    { spellId: id, spellName: "x", srcUnitId: src, destUnitId: dest },
    line,
  );

function scan(o: {
  holders: Array<{ id: string; auras: any[]; casts?: any[] }>;
  debuffs: any[];
  lines: string[];
}): string[] {
  const hs = o.holders.map((h) => ({
    id: h.id,
    name: h.id,
    reaction: 2,
    info: {},
    spellCastEvents: h.casts ?? [],
    auraEvents: h.auras,
    damageOut: [],
  }));
  const e = {
    id: "e",
    name: "e",
    reaction: 1,
    info: {},
    auraEvents: o.debuffs,
  };
  const players = [...hs, e];
  const out: string[] = [];
  run({
    lines: o.lines,
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
    violate: (
      check: string,
      kind: string,
      _a: number,
      _f: string,
      detail: string,
    ) => out.push(`${check}/${kind}: ${detail}`),
  } as any);
  return out.filter((k) => k.startsWith("unseenEndOpener"));
}

const burst = (
  head: string,
  target: string,
  auraName: string,
  printed: string,
) => [
  `  Burst #1 — ${head}–${head.replace(/:\d\d$/, ":59")}`,
  `    Target: ${target} 100% → 90%`,
  `    Target had a major defensive up: ${auraName} active ON THE TARGET ${printed}s of this burst (already up)`,
];

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("scan5 unseenEndOpener — the product's opener reading, row order kept", () => {
  it("a Cheap Shot logged below Vanish's APPLIED in its millisecond ends it (1.0 s printed is a violation)", () => {
    expect(
      scan({
        holders: [{ id: "h", auras: [applied("11327", "Vanish", 10, "h", 2)] }],
        debuffs: [debuff("1833", 10, "h", 5)],
        lines: burst("0:09", "h", "Vanish", "1.0"),
      }),
    ).toHaveLength(1);
  });
  it("a Polymorph whose SUCCESS sits above Greater Invisibility's APPLIED is its own landing (0c2f3878)", () => {
    expect(
      scan({
        holders: [
          {
            id: "h",
            auras: [applied("110960", "Greater Invisibility", 10, "h", 2)],
            casts: [cast("118", 10, "h", "e", 1)],
          },
        ],
        debuffs: [debuff("118", 10, "h", 5)],
        lines: burst("0:09", "h", "Greater Invisibility", "1.4"),
      }),
    ).toEqual([]);
  });
  it("an earlier unclosed Vanish is not the run of a later burst whose own run's REMOVED is logged (-1b #1)", () => {
    expect(
      scan({
        holders: [
          {
            id: "h",
            auras: [
              applied("11327", "Vanish", 20, "h", 2),
              applied("11327", "Vanish", 239.5, "h"),
              removed("11327", "Vanish", 241, "h"),
            ],
          },
        ],
        debuffs: [debuff("1833", 20, "h", 5)],
        lines: burst("4:00", "h", "Vanish", "1.0"),
      }),
    ).toEqual([]);
  });
  it("another rogue's unclosed run is not the burst target's (-1b #1)", () => {
    expect(
      scan({
        holders: [
          {
            id: "h",
            auras: [
              applied("11327", "Vanish", 239.5, "h"),
              removed("11327", "Vanish", 241, "h"),
            ],
          },
          { id: "h2", auras: [applied("11327", "Vanish", 239.5, "h2", 2)] },
        ],
        debuffs: [debuff("1833", 239.5, "h2", 5)],
        lines: burst("4:00", "h", "Vanish", "1.0"),
      }),
    ).toEqual([]);
  });
  it("the cited debuff is the product's row: Frost Nova, not a standing Ring of Frost of the same millisecond (-1b #2)", () => {
    const out = scan({
      holders: [
        {
          id: "h",
          auras: [applied("414664", "Mass Invisibility", 20, "h")],
          casts: [cast("113724", 18, "h", "0000000000000000")],
        },
      ],
      debuffs: [debuff("82691", 21, "h"), debuff("122", 21, "h")],
      lines: burst("0:19", "h", "Mass Invisibility", "2.0"),
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("Frost Nova");
  });
});

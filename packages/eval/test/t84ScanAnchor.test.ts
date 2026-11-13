/* eslint-disable @typescript-eslint/no-explicit-any -- fake legacy parse objects, the check reads them untyped */
/**
 * scan5/t65 `envMistInvoke`, the shapes codex 85-tk-G-T84-1 #2 / #3 named:
 * the cap is measured from the run's last application the log shows (a
 * REFRESH moves it), and a run the monk's next application closed is no
 * cap expiry. The monk here holds Mist Wrap (spec node 101093 / entry
 * 124871) and, readably, not Gift of the Celestials: the product lengthens.
 */
import { ensureAnalysisData } from "@gladlog/analysis/src/data/ensure";
import {
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "../../analysis/test/ported/testHelpers";
import { run } from "../scripts/scan5/t65";

const START = 1_700_000_000_000;
const at = (s: number) => START + Math.round(s * 1000);
const {
  SPELL_AURA_APPLIED: APPLIED,
  SPELL_AURA_REFRESH: REFRESH,
  SPELL_AURA_REMOVED: REMOVED,
} = LogEvent;

beforeAll(async () => {
  await ensureAnalysisData();
});

function scan(mist: Array<[LogEvent, number]>, casts: number[] = []) {
  const monk: any = makeUnit("Player-1", {
    name: "Monk",
    class: CombatUnitClass.Monk,
    spec: CombatUnitSpec.Monk_Mistweaver,
    info: {
      talents: [{ id1: 101093, id2: 124871, count: 1 }],
      pvpTalents: [],
    } as never,
    spellCastEvents: [
      makeSpellCastEvent("325197", at(10), "Player-1"),
      ...casts.map((s) => makeSpellCastEvent("124682", at(s), "Player-1")),
    ],
  });
  const mate: any = makeUnit("Player-2", {
    name: "Mate",
    info: {} as never,
    auraEvents: mist.map(([event, s]) =>
      makeAuraEvent(event, "124682", at(s), "Player-1", "Player-2", "BUFF"),
    ),
  });
  const units = [monk, mate];
  const seen: Array<{ kind: string; detail: string }> = [];
  let checked = 0;
  run({
    firstOwnerOfRound: true,
    rawLines: [],
    units,
    players: units,
    legacy: { units: { [monk.id]: monk, [mate.id]: mate } },
    start: START,
    end: at(120),
    violate: (c: string, kind: string, _t: number, _f: string, d: string) => {
      if (c === "envMistInvoke") seen.push({ kind, detail: d });
    },
    bump: (c: string) => {
      if (c === "envMistInvoke") checked++;
    },
  } as any);
  return { checked, seen };
}

describe("scan5/t65 envMistInvoke — the cap's anchor (codex 85-tk-G-T84-1)", () => {
  it("applied inside the window, never refreshed: the cap carries the +4 s", () => {
    const r = scan([[APPLIED, 12]]);
    expect(r.checked).toBe(1);
    expect(r.seen).toHaveLength(1);
    expect(r.seen[0]!.kind).toMatch(/the cap carries the window's \+4 s/);
    expect(r.seen[0]!.detail).toContain("12.0–23.0s");
  });

  it("#2 refreshed past the window: the plain cap from the refresh is right, and the run is not the window's", () => {
    // Invoke 10–35 s; applied 34 s, refreshed 36 s, closed at 43 s
    const r = scan([
      [APPLIED, 34],
      [REFRESH, 36],
    ]);
    expect(r.checked).toBe(0);
    expect(r.seen).toEqual([]);
  });

  it("#2 refreshed inside the window: +4 s is owed from the refresh", () => {
    // applied 12 s, refreshed 16 s: the cap is 16 + 11 = 27 s
    const r = scan([
      [APPLIED, 12],
      [REFRESH, 16],
    ]);
    expect(r.checked).toBe(1);
    expect(r.seen).toHaveLength(1);
    expect(r.seen[0]!.kind).toMatch(/^occasion: left without REMOVED: the cap/);
    expect(r.seen[0]!.detail).toContain("12.0–27.0s");
  });

  it("#3 a recast with no REMOVED between: the first run ends at the second application, no cap to measure", () => {
    const r = scan(
      [
        [APPLIED, 12],
        [APPLIED, 15],
      ],
      [12, 15],
    );
    expect(r.checked).toBe(2);
    expect(r.seen.map((s) => s.kind)).toEqual([
      expect.stringMatching(/closed by the monk's next application/),
      expect.stringMatching(/the cap carries the window's \+4 s/),
    ]);
    expect(r.seen[0]!.detail).toContain("12.0–15.0s");
  });

  it("a re-broadcast is no new anchor: REMOVED + APPLIED in one millisecond, or a bare APPLIED with no cast (codex 85-tk-G-T84-1b)", () => {
    // applied 12 s inside the window; the cap is 12 + 11 = 23 s either way
    for (const rows of [
      [
        [APPLIED, 12],
        [REMOVED, 16],
        [APPLIED, 16],
      ],
      [
        [APPLIED, 12],
        [APPLIED, 16],
      ],
    ] as Array<Array<[LogEvent, number]>>) {
      const r = scan(rows, [12]);
      expect(r.checked).toBe(1);
      expect(r.seen).toHaveLength(1);
      expect(r.seen[0]!.kind).toMatch(
        /^occasion: left without REMOVED: the cap/,
      );
      expect(r.seen[0]!.detail).toContain("12.0–23.0s");
    }
  });

  it("two pieces the builder joined are capped from the later one (codex 85-tk-G-T84-1c)", () => {
    // one Mist cast at 34.5 s, APPLIED at 34.5 and again at 35.1, no
    // REMOVED: the builder splits at 35.1 (the cast is within its pairing
    // radius), joins the pieces, and caps from 35.1 — past the window
    // (10–35 s), so the plain 7 s to 42.1 s is right and the run is not the
    // window's. Anchored at 34.5 it read as cut without the +4 s.
    const r = scan(
      [
        [APPLIED, 34.5],
        [APPLIED, 35.1],
      ],
      [34.5],
    );
    expect(r.seen).toEqual([]);
    expect(r.checked).toBe(0);
  });
});

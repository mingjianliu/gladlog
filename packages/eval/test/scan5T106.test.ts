/* eslint-disable @typescript-eslint/no-explicit-any -- the scan context is a fake */
/**
 * scan5 `feignReadyInSpan` (T106, ruling R40): a `defenseless` span on a
 * hunter while its Feign Death — pressed this round, readiness from the
 * shared cooldown model — was ready.
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
  makeUnit,
} from "../../analysis/test/ported/testHelpers";
import { run } from "../scripts/scan5/t106";

const T = 1_000_000;
const at = (s: number) => T + s * 1000;

const hunter = (feignAtS: number[]) =>
  makeUnit("e1", {
    name: "Hunter",
    class: CombatUnitClass.Hunter,
    spec: CombatUnitSpec.Hunter_Marksmanship,
    reaction: CombatUnitReaction.Hostile,
    info: { talents: [], pvpTalents: [] } as never,
    auraEvents: feignAtS.map((s) =>
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        "202748",
        at(s),
        "e1",
        "e1",
        "BUFF",
      ),
    ) as never,
  });
const owner = makeUnit("p1", {
  name: "Owner",
  reaction: CombatUnitReaction.Friendly,
});

function scan(span: string, h: ReturnType<typeof hunter>) {
  let checked = 0;
  const details: string[] = [];
  const units = [owner, h];
  run({
    lines: [
      `  [KILL WINDOW] ${span} on Marksmanship Hunter (Hunter): team burst 100k (defenseless ${span})`,
    ],
    start: T,
    end: at(120),
    roundEndAt: at(120),
    legacy: { startTime: T, endTime: at(120), units: { e1: h, p1: owner } },
    units,
    players: units,
    owner,
    bump: () => checked++,
    violate: (_c: string, _k: string, _t: number, _f: string, d: string) =>
      details.push(d),
  } as any);
  return { checked, details };
}

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("scan5 feignReadyInSpan", () => {
  it("a span while Feign Death was on cooldown passes", () => {
    expect(scan("0:20–0:40", hunter([15]))).toEqual({
      checked: 1,
      details: [],
    });
  });
  it("a span past its return is a violation", () => {
    const got = scan("0:40–0:55", hunter([15]));
    expect(got.checked).toBe(1);
    expect(got.details).toHaveLength(1);
  });
  // codex 85-tk-K-T106-1 #1: one that never pressed it holds it all round
  it("a hunter that never pressed it holds it all round: any span is a violation", () => {
    const got = scan("0:40–0:55", hunter([]));
    expect(got.checked).toBe(1);
    expect(got.details).toHaveLength(1);
  });
  // codex 85-tk-K-T106-1 #3: the product's spans for presses at 15 s / 70 s
  // end on the cooldown's whole-second return — no overlap
  it("a span ending at the cooldown's whole-second return passes", () => {
    for (const span of ["0:17–0:45", "1:12–1:40"])
      expect(scan(span, hunter([15, 70])), span).toEqual({
        checked: 1,
        details: [],
      });
  });
});

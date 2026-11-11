/* eslint-disable @typescript-eslint/no-explicit-any -- fake legacy parse objects, the check reads them untyped */
/**
 * scan5/t65 `envMistInvoke` as T84 reads it: an Enveloping Mist applied
 * inside its monk's Invoke window and left without a REMOVED row. Wrong
 * when the builder's cap cut it short of the plain length + 4 s with the
 * round still running; an occasion when the cap carries the +4 s, and a
 * separate one for a monk the product does not lengthen (Gift of the
 * Celestials, or talents it cannot read). The lengthened cap itself is
 * pinned in analysis `t84EnvelopingMistInvoke.test.ts`.
 */
import { ensureAnalysisData } from "@gladlog/analysis/src/data/ensure";
import { buffFullDurationForCaster } from "@gladlog/analysis/src/utils/buffDuration";
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

beforeAll(async () => {
  await ensureAnalysisData();
});

function scan(invokeAtS: number | undefined, mistAtS: number, endS = 120) {
  const monk: any = makeUnit("Player-1", {
    name: "Monk",
    class: CombatUnitClass.Monk,
    spec: CombatUnitSpec.Monk_Mistweaver,
    info: {} as never,
    spellCastEvents:
      invokeAtS === undefined
        ? []
        : [makeSpellCastEvent("325197", at(invokeAtS), "Player-1")],
  });
  const mate: any = makeUnit("Player-2", {
    name: "Mate",
    info: {} as never,
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        "124682",
        at(mistAtS),
        "Player-1",
        "Player-2",
        "BUFF",
      ),
    ],
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
    end: at(endS),
    violate: (c: string, kind: string, _t: number, _f: string, d: string) => {
      if (c === "envMistInvoke") seen.push({ kind, detail: d });
    },
    bump: (c: string) => {
      if (c === "envMistInvoke") checked++;
    },
  } as any);
  return { checked, seen, monk };
}

describe("scan5/t65 envMistInvoke (T84)", () => {
  it("outside any Invoke window: not counted", () => {
    expect(scan(undefined, 20).checked).toBe(0);
    expect(scan(10, 50).checked).toBe(0);
  });

  it("inside the window, no REMOVED, talents unreadable: not lengthened, and filed as its own occasion", () => {
    const r = scan(10, 12);
    expect(r.checked).toBe(1);
    const plain = buffFullDurationForCaster("124682", r.monk)!;
    expect(r.seen).toHaveLength(1);
    expect(r.seen[0]!.kind).toMatch(/unreadable talents/);
    expect(r.seen[0]!.detail).toContain(`12.0–${(12 + plain).toFixed(1)}s`);
  });

  it("the round ended before the cap: an occasion, nothing was cut", () => {
    const r = scan(10, 12, 14);
    expect(r.seen).toHaveLength(1);
    expect(r.seen[0]!.kind).toMatch(/the round ended first/);
  });
});

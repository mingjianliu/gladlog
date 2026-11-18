/**
 * T140 (GH #218 item 3.4): a `(no press)` effect — a talent's proc put the
 * cooldown's aura up — still up when the analysed slice ends has no observed
 * end; `[RES]` counts to the aura's official end, which a proc's effect does
 * not outrun but need not reach: an upper bound, printed `(≤Ns left)`.
 */
import {
  CombatUnitClass,
  CombatUnitSpec,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  enemyEffectLeftIsUpperBound,
  enemyEffectOwnEndSeconds,
  reconstructEnemyCDTimeline,
} from "../src/utils/enemyCDs";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_700_000_000_000;
const at = (s: number) => T0 + Math.round(s * 1000);
const END_S = 40;
const AW = "31884";

beforeAll(async () => {
  await ensureAnalysisData();
});

const ret = (o: {
  pressed?: boolean;
  removedS?: number;
  auraId?: string;
  diedS?: number;
}): ICombatUnit =>
  makeUnit("player-1", {
    name: "Ret",
    class: CombatUnitClass.Paladin,
    spec: CombatUnitSpec.Paladin_Retribution,
    info: {} as never,
    ...(o.diedS === undefined
      ? {}
      : { deathRecords: [{ timestamp: at(o.diedS) }] as never }),
    spellCastEvents: o.pressed
      ? [makeSpellCastEvent(AW, at(35), "player-1")]
      : [],
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        o.auraId ?? AW,
        at(35),
        "player-1",
        "player-1",
        "BUFF",
      ),
      ...(o.removedS === undefined
        ? []
        : [
            makeAuraEvent(
              LogEvent.SPELL_AURA_REMOVED,
              o.auraId ?? AW,
              at(o.removedS),
              "player-1",
              "player-1",
              "BUFF",
            ),
          ]),
    ],
  });

const wrath = (u: ICombatUnit) => {
  const p = reconstructEnemyCDTimeline([u], {
    startTime: T0,
    endTime: at(END_S),
    units: { [u.id]: u },
  } as never).players[0]!;
  return [...p.offensiveCDs, ...(p.offensiveFacts ?? [])].find((c) =>
    c.spellName.startsWith("Avenging Wrath"),
  )!;
};

describe("T140 — a proc's effect still up at the slice's end: the time left is a bound", () => {
  it("no press, no REMOVED: counted to the aura's official end, as an upper bound", () => {
    const c = wrath(ret({}));
    expect(c.spellName).toBe("Avenging Wrath (no press)");
    expect(enemyEffectOwnEndSeconds(c)).toBeGreaterThan(END_S);
    expect(enemyEffectLeftIsUpperBound(c)).toBe(true);
  });

  it("no press, REMOVED inside the slice: the end is the log's, exact", () => {
    const c = wrath(ret({ removedS: 38 }));
    expect(enemyEffectOwnEndSeconds(c)).toBeCloseTo(38, 3);
    expect(enemyEffectLeftIsUpperBound(c)).toBe(false);
  });

  it("a pressed one still up at the slice's end keeps its exact own end (T41)", () => {
    const c = wrath(ret({ pressed: true }));
    expect(c.spellName).toBe("Avenging Wrath");
    expect(enemyEffectOwnEndSeconds(c)).toBeGreaterThan(END_S);
    expect(enemyEffectLeftIsUpperBound(c)).toBe(false);
  });

  it("the cast-less twin aura 454351 carries its official end too (codex 85-tk-CD-T140-1 #1)", () => {
    const c = wrath(ret({ auraId: "454351" }));
    expect(c.spellName).toBe("Avenging Wrath (no press)");
    expect(enemyEffectOwnEndSeconds(c)).toBeGreaterThan(END_S);
    expect(enemyEffectLeftIsUpperBound(c)).toBe(true);
  });

  it("a proc its holder's death cut: the official end the row counts to stays a bound (codex 85-tk-CD-T140-1 #2)", () => {
    const c = wrath(ret({ diedS: END_S, removedS: END_S + 0.05 }));
    expect(c.deathCutOfficialEndSeconds).toBeGreaterThan(END_S);
    expect(enemyEffectLeftIsUpperBound(c)).toBe(true);
  });
});

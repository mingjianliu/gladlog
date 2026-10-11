/**
 * F06b / F08 — break causes the log does not write.
 *  - `ccUnloggedEarlyEnd`: a control gone within half a second with nothing
 *    in the log to say why prints `ended early — cause not logged`, not a
 *    bare `<1s`;
 *  - `formatCcRemovalCause`: `endedBy` of a damage break names the hit the
 *    log's break line names AS the breaking hit.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  CC_BREAKING_HIT_LEAD,
  CC_END_CAUSE_NOT_LOGGED,
  CC_LOGGED_END_NOTE_RE_SRC,
  ccUnloggedEarlyEnd,
  formatCcRemovalCause,
  formatCcUnloggedEnd,
} from "../src/utils/ccTrinketAnalysis";
import { makeAuraEvent, makeUnit } from "./ported/testHelpers";

const T0 = 1_700_000_000_000;
const FEAR = "5782";

const holderWith = (removedAtS: number | null, src = "enemy-1") =>
  makeUnit("player-1", {
    auraEvents: [
      makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, FEAR, T0 + 20_000, src),
      ...(removedAtS === null
        ? []
        : [
            makeAuraEvent(
              LogEvent.SPELL_AURA_REMOVED,
              FEAR,
              T0 + removedAtS * 1000,
              src,
            ),
          ]),
    ],
  }) as ICombatUnit;
const cc = (durationSeconds: number, over: Record<string, unknown> = {}) =>
  ({
    spellId: FEAR,
    atSeconds: 20,
    durationSeconds,
    expectedDurationSeconds: 6,
    sourceId: "enemy-1",
    ...over,
  }) as any;

describe("ccUnloggedEarlyEnd", () => {
  it("a control that prints <1s, has an official length of a second or more and a logged REMOVED → no_cause", () => {
    // f08c748e r5: Fear ran 68 ms of 6 s, nothing at its REMOVED
    expect(ccUnloggedEarlyEnd(holderWith(20.068), cc(0.068), T0)).toBe(
      "no_cause",
    );
    expect(formatCcUnloggedEnd("no_cause")).toBe(
      ` | ${CC_END_CAUSE_NOT_LOGGED}`,
    );
    // 0.49 s still prints <1s
    expect(ccUnloggedEarlyEnd(holderWith(20.49), cc(0.49), T0)).toBe(
      "no_cause",
    );
  });

  it("a control that prints a whole second is never called early, however short of its table length", () => {
    // 08428e7e r5: Hex ran 0.77 of 6 s → the line prints 1s
    expect(ccUnloggedEarlyEnd(holderWith(20.77), cc(0.77), T0)).toBeUndefined();
    expect(ccUnloggedEarlyEnd(holderWith(22), cc(2), T0)).toBeUndefined();
    expect(formatCcUnloggedEnd(undefined)).toBe("");
  });

  it("no official length, the round's end, or no REMOVED line of this caster's → nothing is claimed", () => {
    const h = holderWith(20.068);
    expect(
      ccUnloggedEarlyEnd(
        h,
        cc(0.068, { expectedDurationSeconds: undefined }),
        T0,
      ),
    ).toBeUndefined();
    // a DR'd control whose own length prints <1s ran its length
    expect(
      ccUnloggedEarlyEnd(h, cc(0.068, { expectedDurationSeconds: 0.4 }), T0),
    ).toBeUndefined();
    expect(
      ccUnloggedEarlyEnd(h, cc(0.068, { stillOnAtRoundEnd: true }), T0),
    ).toBeUndefined();
    expect(ccUnloggedEarlyEnd(holderWith(null), cc(0.068), T0)).toBeUndefined();
    // another caster's copy ending there is not this one's REMOVED
    expect(
      ccUnloggedEarlyEnd(holderWith(20.068, "enemy-2"), cc(0.068), T0),
    ).toBeUndefined();
  });

  it("the gates' end-note pattern reads the note", () => {
    const re = new RegExp(`^${CC_LOGGED_END_NOTE_RE_SRC}$`);
    expect(re.test(` | ${CC_END_CAUSE_NOT_LOGGED}`)).toBe(true);
    expect(re.test(" | ended early — cause unknown")).toBe(false);
  });
});

describe("formatCcRemovalCause — a damage break names the breaking hit as that (F06b)", () => {
  it("leads with CC_BREAKING_HIT_LEAD; the breaker is 'you' for the owner", () => {
    expect(
      formatCcRemovalCause(
        { kind: "broken", spellName: "Agony", byUnitId: "p2", byName: "Lock" },
        "p1",
      ),
    ).toBe(`${CC_BREAKING_HIT_LEAD}Agony (Lock)`);
    expect(
      formatCcRemovalCause(
        { kind: "broken", spellName: "Melee", byUnitId: "p1", byName: "Me" },
        "p1",
      ),
    ).toBe(`${CC_BREAKING_HIT_LEAD}Melee (you)`);
    // a break line with no source: the spell alone
    expect(
      formatCcRemovalCause(
        { kind: "broken", spellName: "Shadow Word: Death" },
        "p1",
      ),
    ).toBe(`${CC_BREAKING_HIT_LEAD}Shadow Word: Death`);
  });

  it("a press or a dispel is not a hit: unchanged, and no value carries a ', '", () => {
    expect(
      formatCcRemovalCause(
        { kind: "trinket", spellName: "Gladiator's Medallion" },
        "p1",
      ),
    ).toBe("trinket (Gladiator's Medallion)");
    expect(
      formatCcRemovalCause({ kind: "break", spellName: "Blink" }, "p1"),
    ).toBe("Blink");
    expect(
      formatCcRemovalCause(
        {
          kind: "dispel",
          spellName: "Reverse Magic",
          byUnitId: "e2",
          byName: "Evoker",
        },
        "p1",
      ),
    ).toBe("Reverse Magic (Evoker)");
    const withComma = formatCcRemovalCause(
      {
        kind: "broken",
        spellName: "Invoke Xuen, the White Tiger",
        byUnitId: "p2",
        byName: "Monk",
      },
      "p1",
    );
    expect(withComma).not.toContain(", ");
  });
});

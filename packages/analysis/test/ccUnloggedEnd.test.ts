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
  ccEndedByImmunityAura,
  ccUnloggedEarlyEnd,
  formatCcLoggedEnd,
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

describe("ccEndedByImmunityAura — a control immunity that went up in the REMOVED's millisecond is a cause the log gives", () => {
  const MIGHTY_BASH = "5211";
  const BLADESTORM = "446035";
  const AMS = "48707"; // magic-only
  const POWER_WORD_FORTITUDE = "21562"; // any buff that is no immunity
  const label = (name: string, id: string | undefined) => `<${id}:${name}>`;
  // 5e8b11c1 round 4: Mighty Bash APPLIED 22:28:32.889, REMOVED 22:28:33.131;
  // the warrior's own Bladestorm 446035 APPLIED at .131 (he was stunned —
  // the SUCCESS row at .132 is the proc's)
  const stunned = (
    extra: ReturnType<typeof makeAuraEvent>[],
    removedMs = T0 + 15_242,
  ) =>
    makeUnit("player-1", {
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, MIGHTY_BASH, T0 + 15_000),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, MIGHTY_BASH, removedMs),
        ...extra,
      ].sort((a, b) => a.timestamp - b.timestamp),
    }) as ICombatUnit;
  const bash = (over: Record<string, unknown> = {}) =>
    ({
      spellId: MIGHTY_BASH,
      atSeconds: 15,
      durationSeconds: 0.242,
      expectedDurationSeconds: 4,
      sourceId: "enemy-1",
      ...over,
    }) as any;
  const up = (spellId: string, ms: number, src = "player-1") =>
    makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED,
      spellId,
      ms,
      src,
      "player-1",
      "BUFF",
    );

  it("the holder's own Bladestorm in that millisecond → `ended by their Bladestorm`, and no `cause not logged`", () => {
    const h = stunned([up(BLADESTORM, T0 + 15_242)]);
    const end = ccEndedByImmunityAura(h, bash(), T0);
    expect(end).toEqual({ kind: "immunity", spellName: "Bladestorm" });
    expect(formatCcLoggedEnd(end, label)).toBe(" | ended by their Bladestorm");
    // the same instance with nothing there is what `cause not logged` is for
    expect(ccEndedByImmunityAura(stunned([]), bash(), T0)).toBeUndefined();
    expect(ccUnloggedEarlyEnd(stunned([]), bash(), T0)).toBe("no_cause");
  });

  it("the same millisecond only: one ms either side is not read", () => {
    for (const ms of [T0 + 15_241, T0 + 15_243, T0 + 15_100])
      expect(
        ccEndedByImmunityAura(stunned([up(BLADESTORM, ms)]), bash(), T0),
      ).toBeUndefined();
  });

  it("an immunity someone else put there is named with its source", () => {
    const BOP = "1022";
    const h = stunned([up(BOP, T0 + 15_242, "pal-1")]);
    const end = ccEndedByImmunityAura(h, bash(), T0);
    expect(end).toEqual({
      kind: "immunity",
      spellName: "Blessing of Protection",
      byUnitId: "pal-1",
      byName: "Source",
    });
    expect(formatCcLoggedEnd(end, label)).toBe(
      " | ended by <pal-1:Source>'s Blessing of Protection",
    );
  });

  it("not a cause: a buff that is no control immunity, a magic-only shield against a physical stun, an immunity on somebody else", () => {
    expect(
      ccEndedByImmunityAura(
        stunned([up(POWER_WORD_FORTITUDE, T0 + 15_242)]),
        bash(),
        T0,
      ),
    ).toBeUndefined();
    expect(
      ccEndedByImmunityAura(stunned([up(AMS, T0 + 15_242)]), bash(), T0),
    ).toBeUndefined();
    const onMate = makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED,
      BLADESTORM,
      T0 + 15_242,
      "player-1",
      "player-2",
      "BUFF",
    );
    expect(
      ccEndedByImmunityAura(stunned([onMate]), bash(), T0),
    ).toBeUndefined();
  });

  it("no REMOVED row of this control at that instant, or the round's end → nothing is read", () => {
    // the instance closed 100 ms away from any REMOVED row
    expect(
      ccEndedByImmunityAura(
        stunned([up(BLADESTORM, T0 + 15_342)]),
        bash({ durationSeconds: 0.342 }),
        T0,
      ),
    ).toBeUndefined();
    expect(
      ccEndedByImmunityAura(
        stunned([up(BLADESTORM, T0 + 15_242)]),
        bash({ stillOnAtRoundEnd: true }),
        T0,
      ),
    ).toBeUndefined();
  });

  it("the gates' end-note pattern reads both forms", () => {
    const re = new RegExp(`^${CC_LOGGED_END_NOTE_RE_SRC}$`);
    expect(re.test(" | ended by their Bladestorm")).toBe(true);
    expect(re.test(" | ended by 6(HPaladin)'s Blessing of Protection")).toBe(
      true,
    );
    expect(re.test(" | ended somehow")).toBe(false);
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

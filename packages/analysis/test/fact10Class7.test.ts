/**
 * fact10 class 7, D19 (46eb2199 r0 0:03.256): a prowling Balance Druid's
 * cat-form Stampeding Roar 77764 went up on two allies with no cast row of
 * any Stampeding Roar id in the round, and the kit read
 * `Stampeding Roar [120s] [UNUSED]`. The cooldown's own id — or a form
 * variant's — on ANOTHER unit from the unit itself proves the press, not a
 * control's only (fact4 D25 Blind).
 */
import {
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { effectEvidenceCastSeconds } from "../src/utils/cooldowns";
import { makeAuraEvent, makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const PID = "druid-1";
const ROAR = "106898";
const CAT_ROAR = "77764";
const combatOf = (u: ReturnType<typeof makeUnit>) =>
  ({ startTime: 0, endTime: 85_000, units: { [PID]: u } }) as never;
const roarOn = (dest: string, src = PID) => [
  makeAuraEvent(
    LogEvent.SPELL_AURA_APPLIED,
    CAT_ROAR,
    3_256,
    src,
    dest,
    "BUFF",
  ),
  makeAuraEvent(
    LogEvent.SPELL_AURA_REMOVED,
    CAT_ROAR,
    11_280,
    src,
    dest,
    "BUFF",
  ),
];
const druid = (auraEvents: ReturnType<typeof makeAuraEvent>[]) =>
  makeUnit(PID, {
    class: CombatUnitClass.Druid,
    spec: CombatUnitSpec.Druid_Balance,
    auraEvents,
  });

describe("fact10 D19: a press proven by its own aura on others", () => {
  it("the cat-form roar on two allies, no cast row → one press at 3.256", () => {
    const u = druid([...roarOn("ally-1"), ...roarOn("ally-2")]);
    expect(effectEvidenceCastSeconds(u, ROAR, 120, combatOf(u))).toEqual([
      3.256,
    ]);
  });

  it("the unit's own copy alone, or another unit's roar, proves nothing here", () => {
    const self = druid(roarOn(PID));
    expect(effectEvidenceCastSeconds(self, ROAR, 120, combatOf(self))).toEqual(
      [],
    );
    const other = druid(roarOn("ally-1", "druid-2"));
    expect(
      effectEvidenceCastSeconds(other, ROAR, 120, combatOf(other)),
    ).toEqual([]);
  });
});

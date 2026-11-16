/**
 * T127 (fact13 D35): an absorb shield pressed on a kill-window target by a
 * unit of the OTHER side ends `defenseless` as an ally's does. b8a9f3e3 r0: a
 * Discipline Priest's no-target Void Shield went onto the warlock it had
 * Mind-Controlled, in the ms the control ended (118k, 117k of the priest's
 * own team's damage absorbed) — `offensiveWindows` looked the caster up
 * among the target's team only, and the span ran through it.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { NO_TARGET_GUID } from "../src/utils/enemyDefensives";
import { computeOffensiveWindows } from "../src/utils/offensiveWindows";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_000_000;
const at = (s: number) => T0 + s * 1000;
const BARKSKIN = "22812";
const VOID_SHIELD = "1253593";

beforeAll(async () => {
  await ensureAnalysisData();
});

/** the enemy druid pressed Barkskin at 50 s (on cooldown, a span opens);
 * the priest `p1` (the other side) pressed Void Shield with no target at
 * `from + 2`, its aura on the druid to `from + 7`, absorbing at `from + 4` */
function round(
  from: number | undefined,
  pressed: boolean,
  /** the aura reaches the druid half a second after the press: `stolen` =
   * by the druid's own SPELL_STOLEN row, `late` = with no such row */
  how: "pressedOn" | "stolen" | "late" = "pressedOn",
) {
  const lag = how === "pressedOn" ? 0 : 0.5;
  const druid = makeUnit("e1", {
    name: "EnemyDruid",
    spec: CombatUnitSpec.Druid_Feral,
    reaction: CombatUnitReaction.Hostile,
    info: {},
    spellCastEvents: [
      makeSpellCastEvent(
        BARKSKIN,
        at(50),
        "e1",
        "EnemyDruid",
        "e1",
        "EnemyDruid",
      ),
    ],
    auraEvents:
      from === undefined
        ? []
        : [
            makeAuraEvent(
              LogEvent.SPELL_AURA_APPLIED,
              VOID_SHIELD,
              at(from + 2 + lag),
              "p1",
              "e1",
              "BUFF",
            ),
            makeAuraEvent(
              LogEvent.SPELL_AURA_REMOVED,
              VOID_SHIELD,
              at(from + 7),
              "p1",
              "e1",
              "BUFF",
            ),
          ],
    actionOut:
      from !== undefined && how === "stolen"
        ? [
            {
              srcUnitId: "e1",
              destUnitId: "p9",
              spellId: "30449",
              extraSpellId: VOID_SHIELD,
              timestamp: at(from + 2.5),
              logLine: {
                event: LogEvent.SPELL_STOLEN,
                timestamp: at(from + 2.5),
              },
            },
          ]
        : [],
    absorbsIn:
      from === undefined
        ? []
        : [
            {
              spellId: VOID_SHIELD,
              srcUnitId: "p1",
              absorbedAmount: 33_459,
              timestamp: at(from + 4),
              logLine: { timestamp: at(from + 4) },
            },
          ],
  });
  const priest = makeUnit("p1", {
    name: "Priest",
    spec: CombatUnitSpec.Priest_Discipline,
    reaction: CombatUnitReaction.Friendly,
    info: {},
    spellCastEvents:
      from !== undefined && pressed
        ? [
            makeSpellCastEvent(
              VOID_SHIELD,
              at(from + 2),
              NO_TARGET_GUID,
              "nil",
              "p1",
              "Priest",
            ),
          ]
        : [],
  });
  const combat = {
    startTime: T0,
    endTime: at(107),
    units: { e1: druid, p1: priest },
  } as never;
  return computeOffensiveWindows([druid] as never, [priest] as never, combat);
}

describe("T127 — a shield the other side pressed on the target ends `defenseless`", () => {
  it("the span skips the seconds the shield was up", () => {
    const from = round(undefined, false)[0]!.fromSeconds;
    const w = round(from, true);
    for (const x of w)
      expect(
        x.toSeconds <= from + 2.001 || x.fromSeconds >= from + 6.999,
        `${x.fromSeconds}–${x.toSeconds}`,
      ).toBe(true);
  });
  // batch review 80-PIPE-87-B78: the priest pressed a no-target Void
  // Shield, the target STOLE a copy half a second later — the copy keeps the
  // priest as its source, and a stolen shield does not count (user ruling
  // 2026-10-30, #167)
  it("a copy the target stole is no protection, though its source pressed it", () => {
    const from = round(undefined, false)[0]!.fromSeconds;
    expect(round(from, true, "stolen")).toEqual(round(undefined, false));
    // the same rows without the steal: the shield counts
    expect(round(from, true, "late")).not.toEqual(round(undefined, false));
  });
  it("…but not without the caster's press (a proc shield stays no protection)", () => {
    const from = round(undefined, false)[0]!.fromSeconds;
    expect(round(from, false)).toEqual(round(undefined, false));
  });
});

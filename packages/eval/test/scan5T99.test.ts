/* eslint-disable @typescript-eslint/no-explicit-any -- the scan context is a fake */
/**
 * scan5/t99 (T99, user ruling R45): `pressedDuringSubSpell` reads the
 * clause through the producer's item pattern, so an item carrying the
 * `/cancelaura` note is still checked; `secondStageUnderControl` classes a
 * ready aura that ended under a control by what followed it.
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import {
  formatPressedDuringNote,
  SECOND_STAGE_MACRO_NOTE,
} from "@gladlog/analysis/src/context/controlRejectedPresses";
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  makeAuraEvent,
  makeHealEvent,
  makeUnit,
} from "../../analysis/test/ported/testHelpers";
import { run } from "../scripts/scan5/t99";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T = 1_000_000;
const at = (s: number) => T + s * 1000;
const info = { teamId: "0", specId: "x" } as unknown as NonNullable<
  Parameters<typeof makeUnit>[1]
>["info"];

/** a mage whose Alter Time (342246) went up at 5 s and ended at 9 s, inside
 * a rogue's Kidney Shot (408, 8–12 s); `heal`: the return heal 1219545 */
function round(heal: boolean, lines: string[] = []) {
  const mage = makeUnit("p1", {
    name: "Mage",
    spec: CombatUnitSpec.Mage_Frost,
    reaction: CombatUnitReaction.Friendly,
    info,
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        "342246",
        at(5),
        "p1",
        "p1",
        "BUFF",
      ),
      makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "408", at(8), "e1", "p1"),
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        "342246",
        at(9),
        "p1",
        "p1",
        "BUFF",
      ),
      makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, "408", at(12), "e1", "p1"),
    ],
    healOut: heal
      ? [
          {
            ...makeHealEvent(at(9) + 20, "p1", 100_000),
            destUnitId: "p1",
            spellId: "1219545",
          },
        ]
      : [],
  });
  const rogue = makeUnit("e1", {
    name: "Rogue",
    spec: CombatUnitSpec.Rogue_Subtlety,
    reaction: CombatUnitReaction.Hostile,
    info,
  });
  const all = [mage, rogue];
  const kinds: string[] = [];
  const checked = new Map<string, number>();
  run({
    lines,
    start: T,
    end: at(120),
    roundEndAt: at(120),
    firstOwnerOfRound: true,
    legacy: { startTime: T, endTime: at(120) },
    units: all,
    players: all,
    owner: mage,
    rawStreams: () => ({
      available: true,
      castFailed: [
        {
          tSeconds: 9,
          unitGuid: "p1",
          spellId: 342247,
          spellName: "Alter Time",
          reason: "Can't do that while stunned",
        },
      ],
    }),
    bump: (c: string) => checked.set(c, (checked.get(c) ?? 0) + 1),
    violate: (c: string, k: string) => kinds.push(`${c}|${k}`),
  } as any);
  return { kinds, checked };
}

describe("scan5/t99 — R45 second stages", () => {
  it("reads an item that carries the /cancelaura note", () => {
    const line = `0:08  [CC ON TEAM]   1(Mage) ← Kidney Shot (by 2(Rogue)) | 4s${formatPressedDuringNote(
      [
        {
          spellId: "342247",
          spellName: "Alter Time",
          count: 1,
          firstSeconds: 9,
          secondStage: true,
        },
      ],
    )}`;
    expect(line).toContain(SECOND_STAGE_MACRO_NOTE);
    const { checked, kinds } = round(true, [line]);
    expect(checked.get("pressedDuringSubSpell")).toBe(1);
    expect(kinds.filter((k) => k.startsWith("pressedDuringSubSpell"))).toEqual(
      [],
    );
  });
  it("Alter Time ended under a stun with its return heal is `released`", () => {
    expect(round(true).kinds).toEqual([
      "secondStageUnderControl|Alter Time released",
    ]);
  });
  it("…and without it `noEffect`", () => {
    expect(round(false).kinds).toEqual([
      "secondStageUnderControl|Alter Time noEffect",
    ]);
  });
});

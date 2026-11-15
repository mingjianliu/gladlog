/* eslint-disable @typescript-eslint/no-explicit-any -- the scan context is a fake */
/**
 * scan5 `ledgerPressedNotAtPress` (T114): the wall's intervals and presses
 * are the producer's own selection (`buildAuraIntervals`, `pressReadingOf`,
 * `pressRowOf`), found without the printed Z — a wrong Z is a violation, not
 * a line out of coverage (codex 85-tk-K-T114-1) — and a totem's press is
 * anchored at its first pulse (batch review 80-PIPE-73-B70 #2).
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "../../analysis/test/ported/testHelpers";
import { run } from "../scripts/scan5/t114";

const T = 1_000_000;
const at = (s: number) => T + s * 1000;
const BOP = "1022";
const SLT_CAST = "98008";
const SLT_AURA = "325174";
const info = { teamId: "0", specId: "x" } as unknown as NonNullable<
  Parameters<typeof makeUnit>[1]
>["info"];

const ret = makeUnit("p1", {
  name: "Ret",
  spec: CombatUnitSpec.Paladin_Retribution,
  reaction: CombatUnitReaction.Friendly,
  info,
  spellCastEvents: [
    makeSpellCastEvent(
      "31884",
      at(10),
      "p1",
      "Ret",
      "p1",
      "Ret",
      0,
      "Avenging Wrath",
    ),
  ],
});

function scan(
  wall: string,
  printed: string,
  units: ReturnType<typeof makeUnit>[],
): { checked: number; details: string[] } {
  let checked = 0;
  const details: string[] = [];
  const all = [ret, ...units];
  run({
    lines: [
      "  Burst #1 — 0:10–0:20 | Avenging Wrath",
      "  Target: Pala 90% → 40%",
      `  Target had a major defensive up: ${wall} active ON THE TARGET 4.4s of this burst (pressed ${printed}s after the burst opened)`,
    ],
    start: T,
    end: at(120),
    legacy: {
      startTime: T,
      endTime: at(120),
      units: Object.fromEntries(all.map((u) => [u.id, u])),
    },
    units: all,
    players: all.filter((u) => !u.ownerId),
    owner: ret,
    unitOfPid: () => undefined,
    bump: () => checked++,
    violate: (_c: string, _k: string, _t: number, _f: string, d: string) =>
      details.push(d),
  } as any);
  return { checked, details };
}

const bopUnits = () => {
  const aura = (event: LogEvent, s: number) => ({
    ...makeAuraEvent(event, BOP, at(s), "e2", "e1", "BUFF"),
    srcUnitName: "Holy",
    spellName: "Blessing of Protection",
  });
  return [
    makeUnit("e1", {
      name: "Pala",
      spec: CombatUnitSpec.Paladin_Retribution,
      reaction: CombatUnitReaction.Hostile,
      info,
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, 16.74),
        aura(LogEvent.SPELL_AURA_REMOVED, 21.14),
      ],
    }),
    makeUnit("e2", {
      name: "Holy",
      spec: CombatUnitSpec.Paladin_Holy,
      reaction: CombatUnitReaction.Hostile,
      info,
      spellCastEvents: [
        makeSpellCastEvent(
          BOP,
          at(15.51),
          "e1",
          "Pala",
          "e2",
          "Holy",
          0,
          "Blessing of Protection",
        ),
      ],
    }),
  ];
};

/** codex's case: Spirit Link Totem pressed at 15, its first pulse at 15.1,
 * the holder linked only at 19 */
const totemUnits = () => {
  const aura = (event: LogEvent, s: number) => ({
    ...makeAuraEvent(event, SLT_AURA, at(s), "t1", "e1", "BUFF"),
    srcUnitName: "Spirit Link Totem",
    spellName: "Spirit Link Totem",
  });
  return [
    makeUnit("e1", {
      name: "Pala",
      spec: CombatUnitSpec.Paladin_Retribution,
      reaction: CombatUnitReaction.Hostile,
      info,
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, 19),
        aura(LogEvent.SPELL_AURA_REMOVED, 21),
      ],
    }),
    makeUnit("e2", {
      name: "Sham",
      spec: CombatUnitSpec.Shaman_Restoration,
      reaction: CombatUnitReaction.Hostile,
      info,
      spellCastEvents: [
        makeSpellCastEvent(
          SLT_CAST,
          at(15),
          "",
          "",
          "e2",
          "Sham",
          0,
          "Spirit Link Totem",
        ),
      ],
    }),
    makeUnit("t1", {
      name: "Spirit Link Totem",
      ownerId: "e2",
      reaction: CombatUnitReaction.Hostile,
      spellCastEvents: [
        makeSpellCastEvent(
          SLT_AURA,
          at(15.1),
          "e2",
          "Sham",
          "t1",
          "Spirit Link Totem",
          0,
          "Spirit Link Totem",
        ),
      ],
    }),
  ];
};

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("scan5 ledgerPressedNotAtPress — the producer's presses, not the printed Z", () => {
  it("an external's press reading passes", () => {
    expect(scan("Blessing of Protection", "5.5", bopUnits())).toEqual({
      checked: 1,
      details: [],
    });
  });
  it("the external's aura start is a violation", () => {
    const got = scan("Blessing of Protection", "6.7", bopUnits());
    expect(got.checked).toBe(1);
    expect(got.details).toHaveLength(1);
  });
  it("a Z near neither is a violation, not out of coverage", () => {
    const got = scan("Blessing of Protection", "5.0", bopUnits());
    expect(got.checked).toBe(1);
    expect(got.details).toHaveLength(1);
  });
  it("a totem linked 4 s after its first pulse reads the totem's press", () => {
    expect(scan("Spirit Link Totem", "5.0", totemUnits())).toEqual({
      checked: 1,
      details: [],
    });
  });
  it("a totem's corrupted Z is checked and fails", () => {
    const got = scan("Spirit Link Totem", "9.0", totemUnits());
    expect(got.checked).toBe(1);
    expect(got.details).toHaveLength(1);
  });
});

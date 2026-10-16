import { CombatUnitReaction, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src";
import { DEATH_GRIP_ID } from "../src/context/resUtilityCds";
import {
  deathGripsOn,
  forcedMovesInRenderedSpan,
  forcedMovesText,
  GRIP_MISS_PAIR_MS,
} from "../src/utils/forcedDisplacement";
import {
  makeAuraEvent,
  makeDamageEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

// The one reading of "something other than the player moved them" behind the
// [GRIP] line, STAYED IN's "you moved N yd … not all of it yourself" and the
// position-mistake row's `movedIncludes` fact. Until now it was pinned only
// by predicateIndex.test.ts (the symbol exists), not by behaviour.

const T0 = 1_000_000;
const at = (s: number) => T0 + s * 1000;

const grip = (s: number, dkId: string, victimId = "p1") =>
  makeSpellCastEvent(DEATH_GRIP_ID, at(s), victimId, "Victim", dkId, "DK");
const miss = (s: number, dkId: string, missType: string) => ({
  logLine: { event: LogEvent.SPELL_MISSED, timestamp: at(s), parameters: [] },
  timestamp: at(s),
  spellId: DEATH_GRIP_ID,
  spellName: "Death Grip",
  srcUnitId: dkId,
  srcUnitName: "DK",
  destUnitId: "p1",
  destUnitName: "Victim",
  missType,
  amount: 0,
});

function victimWith(
  overrides: Parameters<typeof makeUnit>[1] & { missesIn?: unknown[] },
) {
  const { missesIn, ...rest } = overrides;
  return {
    ...makeUnit("p1", { name: "Victim", ...rest }),
    missesIn: (missesIn ?? []) as never,
  };
}

const dk1 = makeUnit("dk1", {
  name: "DK1",
  reaction: CombatUnitReaction.Hostile,
  spellCastEvents: [grip(15.4, "dk1"), grip(40, "dk1", "p2")],
});
const dk2 = makeUnit("dk2", {
  name: "DK2",
  reaction: CombatUnitReaction.Hostile,
  spellCastEvents: [
    grip(5, "dk2"),
    // a SPELL_CAST_START row of the grip is not a press
    {
      ...grip(60, "dk2"),
      logLine: {
        event: LogEvent.SPELL_CAST_START,
        timestamp: at(60),
        parameters: [],
      },
    },
  ],
});

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("deathGripsOn — 谁对这个人放了死亡之握", () => {
  it("收每个敌人对受害者的 SUCCESS,按施放时间排序;别人身上的、CAST_START 的不收", () => {
    const victim = victimWith({});
    const r = deathGripsOn(victim, [dk1, dk2]);
    expect(r.map((g) => [g.caster.id, (g.castMs - T0) / 1000])).toEqual([
      ["dk2", 5],
      ["dk1", 15.4],
    ]);
    expect(r.every((g) => g.missType === undefined)).toBe(true);
  });

  it("200 ms 内同一施法者的 SPELL_MISSED 行 = 没拉动,带 missType;再远的不配对", () => {
    const pair = GRIP_MISS_PAIR_MS / 1000;
    const victim = victimWith({
      missesIn: [
        miss(5 + pair - 0.01, "dk2", "IMMUNE"),
        miss(15.4 + pair + 0.1, "dk1", "MISS"), // too far from 15.4
      ],
    });
    const r = deathGripsOn(victim, [dk1, dk2]);
    expect(r.map((g) => [g.caster.id, g.missType])).toEqual([
      ["dk2", "IMMUNE"],
      ["dk1", undefined],
    ]);
  });

  it("miss 行要同一个施法者的:dk1 的 miss 行不会配到 dk2 的握上", () => {
    const victim = victimWith({ missesIn: [miss(5.05, "dk1", "IMMUNE")] });
    expect(deathGripsOn(victim, [dk2]).map((g) => g.missType)).toEqual([
      undefined,
    ]);
  });
});

describe("forcedMovesInRenderedSpan — 两个渲染秒之间谁动了你", () => {
  const THUNDERSTORM = "51490";
  const TYPHOON_DAZE = "61391";

  it("落地的握 + 击退证据(伤害或光环),按渲染秒去重,区间左闭右开", () => {
    const victim = victimWith({
      // a Typhoon daze aura and Thunderstorm damage 50 ms apart: one move
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          TYPHOON_DAZE,
          at(18.25),
          "e1",
          "p1",
        ),
      ],
      damageIn: [
        { ...makeDamageEvent(at(18.2), 100, "p1"), spellId: THUNDERSTORM },
        // a second displacement in another second is its own entry
        { ...makeDamageEvent(at(19.9), 100, "p1"), spellId: THUNDERSTORM },
      ],
    });
    const moves = forcedMovesInRenderedSpan(victim, [dk1, dk2], T0, 15, 20);
    expect(moves).toEqual([
      { atSeconds: 15.4, kind: "grip" },
      { atSeconds: 18.2, kind: "displacement" },
      { atSeconds: 19.9, kind: "displacement" },
    ]);
    // from = 15 includes the 15.4 grip (rendered second 15); to = 20 excludes
    // a move rendered at 20, and the 5 s grip is before the span
    expect(
      forcedMovesInRenderedSpan(victim, [dk1, dk2], T0, 16, 20).map(
        (m) => m.kind,
      ),
    ).toEqual(["displacement", "displacement"]);
    expect(
      forcedMovesInRenderedSpan(victim, [dk1, dk2], T0, 15, 18),
    ).toEqual([{ atSeconds: 15.4, kind: "grip" }]);
  });

  it("没拉动的握(有 miss 行)不算移动", () => {
    const victim = victimWith({ missesIn: [miss(15.45, "dk1", "IMMUNE")] });
    expect(forcedMovesInRenderedSpan(victim, [dk1], T0, 15, 20)).toEqual([]);
  });

  it("forcedMovesText:一种措辞,逗号连接,时间按 fmtTime", () => {
    expect(
      forcedMovesText([
        { atSeconds: 15.4, kind: "grip" },
        { atSeconds: 78.9, kind: "displacement" },
      ]),
    ).toBe(
      "Death Grip pulled you at 0:15, an enemy knockback or pull landed on you at 1:18",
    );
  });
});

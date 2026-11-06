/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * fact11 (F26) D16 — an enemy Holy Paladin's Avenging Wrath is that healer's
 * throughput major: an [ENEMY HEAL CD], no burst on the enemy-CD timeline
 * (no [OFFENSIVE WINDOW], no [BURST ANSWERED] opener, no crisis
 * `enemyBurst`). A Retribution Paladin's press is unchanged. The corpus
 * check is `packages/eval/scripts/scan5/fact11.ts` healerRosterAsEnemyBurst.
 */
import {
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { isEnemyHealCdFor } from "../src/data/enemyHealCds";
import { ensureAnalysisData } from "../src/data/ensure";
import { castlessHealCdAuras } from "../src/utils/auraOnlyActivations";
import { reconstructEnemyCDTimeline } from "../src/utils/enemyCDs";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const AW = "31884";
const row = (event: LogEvent, s: number) => ({
  spellId: AW,
  spellName: "Avenging Wrath",
  srcUnitId: "p",
  srcUnitName: "Pal",
  destUnitId: "p",
  destUnitName: "Pal",
  auraType: "BUFF",
  timestamp: T0 + s * 1000,
  logLine: { event, timestamp: T0 + s * 1000 },
});
const paladin = (
  spec: CombatUnitSpec,
  auras: Array<[LogEvent, number]>,
  presses: number[],
) => ({
  id: "p",
  name: "Pal",
  type: 1,
  class: CombatUnitClass.Paladin,
  spec,
  spellCastEvents: presses.map((s) => row(LogEvent.SPELL_CAST_SUCCESS, s)),
  auraEvents: auras.map(([e, s]) => row(e, s)),
  damageIn: [],
  damageOut: [],
  healOut: [],
  healIn: [],
  absorbsIn: [],
  absorbsOut: [],
  actionIn: [],
  actionOut: [],
  deathRecords: [],
});
const timeline = (u: any) =>
  reconstructEnemyCDTimeline([u as never], {
    startTime: T0,
    endTime: T0 + 200_000,
    units: { p: u },
  } as never).players.flatMap((p) => p.offensiveCDs.map((c) => c.spellName));

describe("fact11 D16 — a healer's Avenging Wrath is no enemy burst", () => {
  // 26b28640 2:02: pressed 122.023, aura to 152.034
  const auras: Array<[LogEvent, number]> = [
    [LogEvent.SPELL_AURA_APPLIED, 122.023],
    [LogEvent.SPELL_AURA_REMOVED, 152.034],
  ];

  it("Holy: no offensive cooldown on the timeline, an [ENEMY HEAL CD] id", () => {
    expect(
      timeline(paladin(CombatUnitSpec.Paladin_Holy, auras, [122.023])),
    ).toEqual([]);
    expect(isEnemyHealCdFor(AW, CombatUnitSpec.Paladin_Holy)).toBe(true);
  });

  it("Retribution: the press stays an offensive cooldown", () => {
    expect(
      timeline(paladin(CombatUnitSpec.Paladin_Retribution, auras, [122.023])),
    ).toEqual(["Avenging Wrath"]);
    expect(isEnemyHealCdFor(AW, CombatUnitSpec.Paladin_Retribution)).toBe(
      false,
    );
  });

  it("Holy, an aura with no press: neither an offensive (no press) nor lost — the heal line's", () => {
    const u = paladin(CombatUnitSpec.Paladin_Holy, auras, []);
    expect(timeline(u)).toEqual([]);
    expect(
      castlessHealCdAuras(u as never, T0, T0 + 200_000).map((a) => [
        a.spellId,
        Number(a.atSeconds.toFixed(3)),
      ]),
    ).toEqual([[AW, 122.023]]);
  });
});

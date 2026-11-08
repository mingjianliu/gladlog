/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * fact12 D8 (pipeline T13, 3e1f5c3a r0): `ccSamplerFor` (CC BOOKMARK, PEEL
 * OPTIONS) promises its target was "not CC'd" on every counted second. A
 * silence the prompt prints as a `[SILENCE]` line on that target — Spider
 * Venom on the enemy Discipline Priest 0:51–0:54, which `[CONSEQ]` also
 * counts as the healer controlled — is such a second: the sampler reads the
 * same `silenceIntervalsInRound` the line is printed from (the other side's
 * players and their summons as the source).
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { ccSamplerFor } from "../src/utils/ccTargetState";
import { makeAuraEvent, makeUnit } from "./ported/testHelpers";

const T0 = 1_000_000;
const at = (s: number) => T0 + s * 1000;
const STORM_BOLT = "107570";
const SPIDER_VENOM = "356727";

beforeAll(async () => {
  await ensureAnalysisData();
});

const cd: any = {
  spellId: STORM_BOLT,
  spellName: "Storm Bolt",
  tag: "CC",
  cooldownSeconds: 30,
  maxChargesDetected: 1,
  casts: [],
  availableWindows: [],
  neverUsed: true,
};
const venom = (src: string, onId: string, fromS: number, toS: number) => [
  makeAuraEvent(
    LogEvent.SPELL_AURA_APPLIED,
    SPIDER_VENOM,
    at(fromS),
    src,
    onId,
  ),
  makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, SPIDER_VENOM, at(toS), src, onId),
];
const reasonAt = (sampler: any, target: any, s: number): string | undefined =>
  sampler.stateAt(target, s).reason;
const build = (venomSrc: string) => {
  const owner = makeUnit("o", {
    name: "Warrior",
    spec: CombatUnitSpec.Warrior_Fury,
    info: {},
    reaction: CombatUnitReaction.Friendly,
  });
  const hunter = makeUnit("h", {
    name: "Hunter",
    spec: CombatUnitSpec.Hunter_Marksmanship,
    info: {},
    reaction: CombatUnitReaction.Friendly,
  });
  const healer = makeUnit("e", {
    name: "Priest",
    spec: CombatUnitSpec.Priest_Discipline,
    info: {},
    reaction: CombatUnitReaction.Hostile,
    auraEvents: venom(venomSrc, "e", 51, 54),
  });
  const combat: any = {
    startTime: T0,
    endTime: at(120),
    startInfo: { zoneId: "" },
    units: Object.fromEntries([owner, hunter, healer].map((u) => [u.id, u])),
  };
  const sampler = ccSamplerFor({
    combat,
    owner: owner as any,
    cd,
    enemyIds: new Set(["e"]),
  });
  return { sampler: sampler!, healer };
};

describe("ccSamplerFor: a [SILENCE] on the target is control (fact12 D8)", () => {
  it("every second the teammate's Spider Venom overlaps reads target-cc", () => {
    const { sampler, healer } = build("h");
    expect(sampler).not.toBeNull();
    for (const s of [51, 52, 53])
      expect(reasonAt(sampler, healer, s), String(s)).toBe("target-cc");
    // before and after it, the silence is no reason
    for (const s of [49, 50, 54, 55])
      expect(reasonAt(sampler, healer, s), String(s)).not.toBe("target-cc");
  });

  it("a silence the target's own side put on it prints no [SILENCE] line: not read", () => {
    const { sampler, healer } = build("e2");
    expect(reasonAt(sampler, healer, 52)).not.toBe("target-cc");
  });
});

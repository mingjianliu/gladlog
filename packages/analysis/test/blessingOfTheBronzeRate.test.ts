/**
 * Blessing of the Bronze (fact3 D13, GH #153): an evoker ally's raid buff on
 * the priest — 381753, aura 454 −15 % on SpellCategory 2308 "Class - Priest -
 * Leap of Faith" — speeds Leap of Faith's recovery (1 / 0.85). 20e0f243: two
 * recasts 84.3 / 81.6 s under a `[90s]` kit. The carrier is an aura ON the
 * unit whoever applied it, and the round can open with it (COMBATANT_INFO,
 * no APPLIED row).
 */
import {
  AtomicArenaCombat,
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { extractMajorCooldowns } from "../src/utils/cooldowns";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const BOTB = "381753";
const LOF = "73325";
const priest = (opts: { applied?: boolean; atStart?: boolean }) =>
  makeUnit("player-1", {
    class: CombatUnitClass.Priest,
    spec: CombatUnitSpec.Priest_Discipline,
    info: {
      pvpTalents: [],
      interestingAurasJSON: JSON.stringify(
        opts.atStart ? ["player-2", Number(BOTB), 1] : [],
      ),
    },
    spellCastEvents: [
      makeSpellCastEvent(LOF, 10_000, "player-1", "Mate", "player-2"),
    ],
    auraEvents: opts.applied
      ? [
          makeAuraEvent(
            LogEvent.SPELL_AURA_APPLIED,
            BOTB,
            1_000,
            "player-2",
            "player-1",
            "BUFF",
          ),
        ]
      : [],
  });
const lof = (u: ReturnType<typeof makeUnit>) =>
  extractMajorCooldowns(u, {
    startTime: 0,
    endTime: 300_000,
    units: { "player-1": u },
  } as unknown as AtomicArenaCombat).find((c) => c.spellId === LOF);

describe("Blessing of the Bronze speeds Leap of Faith", () => {
  it("applied by an ally: a rate window at 1 / 0.85", () => {
    const e = lof(priest({ applied: true }))!;
    expect(e).toBeDefined();
    expect(e.rateWindows?.length).toBe(1);
    expect(e.rateWindows![0]!.mult).toBeCloseTo(1 / 0.85, 6);
    expect(e.rateWindows![0]!.fromSeconds).toBeCloseTo(1, 3);
  });
  it("listed on COMBATANT_INFO only: up from the round's start", () => {
    const e = lof(priest({ atStart: true }))!;
    expect(e.rateWindows?.[0]?.fromSeconds).toBe(0);
    expect(e.rateWindows?.[0]?.toSeconds).toBe(300);
  });
  it("without it: no rate window", () => {
    expect(lof(priest({}))!.rateWindows).toBeUndefined();
  });
});

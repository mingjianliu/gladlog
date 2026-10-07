/**
 * B-tier B3a (user ruling 2026-10-06): `cheaper available:` and the friendly
 * `[DEATH] … Unused:` list read cd-hoarded's school rule — a school-limited
 * save is named only when it covers at least SCHOOL_SAVE_MIN_SHARE of what
 * the unit was being hit with in the 2 s before — and a Holy Paladin's
 * Avenging Wrath is never the cheaper substitute.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, describe, expect, it } from "vitest";

import {
  coversCrisisSchool,
  saveCoversPressureOn,
  SCHOOL_SAVE_MIN_SHARE,
} from "../src/analysis/candidates/cooldownTiming";
import { DMG_WINDOW_MS } from "../src/analysis/crisisDecisionPoints";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  findCheaperDefensiveAlternatives,
  NON_SUBSTITUTE_DEFENSIVE_IDS,
} from "../src/utils/cooldowns";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T = 1_000_000;
const SPELLWARDING = "204018"; // magic only (0x7e)
const PROTECTION = "1022"; // physical only (0x1)
const SACRIFICE = "6940"; // all schools
const hit = (ms: number, school: number, amount: number): any => ({
  logLine: { timestamp: ms, parameters: [] },
  spellSchoolId: `0x${school.toString(16)}`,
  effectiveAmount: -amount,
  spellId: "1",
  srcUnitId: "enemy",
});
const unit = (hits: any[]): any => ({ id: "u", damageIn: hits, absorbsIn: [] });

describe("saveCoversPressureOn — cd-hoarded's school rule at an instant", () => {
  it("is coversCrisisSchool over the 2 s up to the instant", () => {
    expect(SCHOOL_SAVE_MIN_SHARE).toBe(0.5);
    expect(DMG_WINDOW_MS).toBe(2000);
    // 58 % physical, 42 % magic
    const u = unit([hit(T - 1500, 0x1, 58_000), hit(T - 500, 0x8, 42_000)]);
    expect(saveCoversPressureOn(SPELLWARDING, u, T)).toBe(false);
    expect(saveCoversPressureOn(PROTECTION, u, T)).toBe(true);
    expect(saveCoversPressureOn(SACRIFICE, u, T)).toBe(true);
    // the same answer coversCrisisSchool gives a crisis point with that split
    expect(
      coversCrisisSchool(SPELLWARDING, {
        dmg2sBySchool: { "1": 58_000, "8": 42_000 },
      }),
    ).toBe(false);
  });

  it("exactly half covers; the window is (instant − 2 s, instant]", () => {
    const half = unit([hit(T - 1000, 0x1, 50_000), hit(T - 900, 0x8, 50_000)]);
    expect(saveCoversPressureOn(SPELLWARDING, half, T)).toBe(true);
    // the physical hit sits exactly 2 s back: outside, so it is all magic
    const edge = unit([hit(T - 2000, 0x1, 90_000), hit(T - 900, 0x8, 10_000)]);
    expect(saveCoversPressureOn(SPELLWARDING, edge, T)).toBe(true);
    expect(saveCoversPressureOn(PROTECTION, edge, T)).toBe(false);
    // a hit after the instant is not in it
    const later = unit([hit(T - 900, 0x1, 10_000), hit(T + 1, 0x8, 90_000)]);
    expect(saveCoversPressureOn(SPELLWARDING, later, T)).toBe(false);
  });

  it("fails open: no damage in the window, or a save with no school claim", () => {
    expect(saveCoversPressureOn(SPELLWARDING, unit([]), T)).toBe(true);
    expect(
      saveCoversPressureOn("999999999", unit([hit(T - 1, 0x1, 1)]), T),
    ).toBe(true);
  });

  it("what a shield absorbed counts as what was thrown", () => {
    const u = {
      id: "u",
      damageIn: [hit(T - 500, 0x1, 40_000)],
      absorbsIn: [
        {
          logLine: { timestamp: T - 400, parameters: [] },
          attackSpellId: "116", // Frostbolt — its official school is Frost
          attackerId: "enemy",
          absorbedAmount: 60_000,
        },
      ],
    } as any;
    expect(
      saveCoversPressureOn(SPELLWARDING, u, T, { recordsAttackSpell: true }),
    ).toBe(true);
    expect(
      saveCoversPressureOn(PROTECTION, u, T, { recordsAttackSpell: true }),
    ).toBe(false);
  });
});

describe("findCheaperDefensiveAlternatives — the school gate and Avenging Wrath", () => {
  const cd = (
    spellId: string,
    spellName: string,
    cooldownSeconds: number,
  ): any => ({
    spellId,
    spellName,
    tag: "Defensive",
    cooldownSeconds,
    casts: [],
    neverUsed: true,
    availableWindows: [{ fromSeconds: 0, toSeconds: 600 }],
  });
  const LOH = cd("633", "Lay on Hands", 420);
  const ledger = [
    LOH,
    cd(SPELLWARDING, "Blessing of Spellwarding", 300),
    cd("498", "Divine Protection", 60),
    cd("31884", "Avenging Wrath", 120),
  ];

  it("a school-limited save that does not cover the recipient's damage is not offered; an absent gate offers it", () => {
    const gated = findCheaperDefensiveAlternatives(LOH, ledger, 20, {
      coversSchool: (id) => id !== SPELLWARDING,
    });
    expect(gated).toEqual(["Divine Protection"]);
    const open = findCheaperDefensiveAlternatives(LOH, ledger, 20);
    expect(open).toEqual(["Blessing of Spellwarding", "Divine Protection"]);
  });

  it("Avenging Wrath is never the cheaper substitute — it stays a Defensive row for every other reader", () => {
    expect(NON_SUBSTITUTE_DEFENSIVE_IDS.has("31884")).toBe(true);
    expect(findCheaperDefensiveAlternatives(LOH, ledger, 20)).not.toContain(
      "Avenging Wrath",
    );
    expect(ledger.find((c) => c.spellId === "31884")!.tag).toBe("Defensive");
  });
});

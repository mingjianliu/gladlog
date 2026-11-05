/**
 * GH #146 item 2 (user rulings 2026-11-03 / 2026-11-04): an external already
 * up when a kill attempt began is named only when the target would have died
 * without it — taken away one at a time, reductions multiplying, a shield by
 * what it absorbed, strictly at or below zero HP.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { formatKillAttemptsForContext } from "../src/utils/killAttempts";
import {
  accountedSave,
  type IAccountedSave,
  judgeAlreadyUpExternals,
  wouldHaveDiedWithout,
} from "../src/utils/killAttemptSaveAccount";
import {
  makeAdvancedAction,
  makeDamageEvent,
  makeHealEvent,
} from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const at = (s: number) => T0 + s * 1000;
const hp = (s: number, cur: number) => ({
  ...makeAdvancedAction(at(s), 0, 0, 1_000_000, cur),
  advancedActorId: "t",
});
const hit = (s: number, amount: number, school = "0x1") => ({
  ...makeDamageEvent(at(s), amount, "t"),
  spellSchoolId: school,
});
const target = (o: {
  damageIn?: any[];
  healIn?: any[];
  absorbsIn?: any[];
  advancedActions?: any[];
}): ICombatUnit =>
  ({
    id: "t",
    name: "Target",
    damageIn: o.damageIn ?? [],
    healIn: o.healIn ?? [],
    absorbsIn: o.absorbsIn ?? [],
    advancedActions: o.advancedActions ?? [],
  }) as any;
const pct = (name: string, p: number, mask = 0x7f): IAccountedSave => ({
  name,
  kind: "pct",
  pct: p,
  schoolMask: mask,
  shieldIds: new Set(),
  fromS: 0,
  toS: 30,
});
const died = (u: ICombatUnit, removed: IAccountedSave[]) =>
  wouldHaveDiedWithout(u, T0, at(1), at(20), removed);

describe("wouldHaveDiedWithout", () => {
  it("puts a reduction back on the hits it covered, strictly at zero HP", () => {
    // 240k landed under 20 % → 300k before it: 60k more
    const mk = (left: number) =>
      target({ damageIn: [hit(5, 240_000)], advancedActions: [hp(5, left)] });
    expect(died(mk(60_000), [pct("Ironbark", 20)])).toBe(true);
    expect(died(mk(60_001), [pct("Ironbark", 20)])).toBe(false);
  });

  it("takes one of two reductions away by its own factor (they multiply)", () => {
    // 64k landed under Ironbark 20 % × Barkskin 20 %: without Ironbark
    // 64 / 0.8 = 80k (16k more). Added (40 %), the same removal would be
    // 64 / 0.6 × 0.8 = 85.3k (21.3k more) and kill at 18k left.
    const u = target({
      damageIn: [hit(5, 64_000)],
      advancedActions: [hp(5, 18_000)],
    });
    expect(died(u, [pct("Ironbark", 20)])).toBe(false);
    const both = [pct("Ironbark", 20), pct("Barkskin", 20)];
    // both away: 64 / 0.64 = 100k (36k more)
    expect(died(u, both)).toBe(true);
  });

  it("only counts the hits of the schools it covers, while it was up", () => {
    const u = target({
      damageIn: [hit(5, 240_000, "0x20"), hit(6, 240_000)],
      advancedActions: [hp(6, 50_000)],
    });
    // physical only: 60k more from the 0:06 hit → dies
    expect(died(u, [pct("Phys", 20, 0x1)])).toBe(true);
    // magic only: 60k more from the 0:05 hit, but the reading is after both
    expect(died(u, [pct("Magic", 20, 0x7e)])).toBe(true);
    // up only until 0:05.5: the 0:06 physical hit is not its own
    expect(died(u, [{ ...pct("Phys", 20, 0x1), toS: 5.5 }])).toBe(false);
  });

  it("lets overhealing pay the deficit back", () => {
    const u = target({
      damageIn: [hit(5, 240_000)],
      healIn: [{ ...makeHealEvent(at(5.5), "h", 100_000, 40_000) }],
      advancedActions: [hp(6, 30_000)],
    });
    // 60k more, 40k of it healed by what was overhealing → 20k < 30k
    expect(died(u, [pct("Ironbark", 20)])).toBe(false);
  });

  it("reads a reading after its own row, before a later row of the same millisecond (codex review 2026-11-04)", () => {
    const u = target({
      damageIn: [
        {
          ...hit(5, 240_000),
          logLine: {
            event: LogEvent.SPELL_DAMAGE,
            timestamp: at(5),
            lineIndex: 1,
          },
        },
      ],
      advancedActions: [
        {
          ...hp(5, 50_000),
          logLine: { event: "ADVANCED_SAMPLE", timestamp: at(5), lineIndex: 2 },
        },
      ],
      healIn: [
        {
          ...makeHealEvent(at(5), "h", 100_000, 100_000),
          logLine: {
            event: LogEvent.SPELL_HEAL,
            timestamp: at(5),
            lineIndex: 3,
          },
        },
      ],
    });
    // 60k more against 50k at that reading: dead before the overheal lands
    expect(died(u, [pct("Ironbark", 20)])).toBe(true);
  });

  it("puts a removed reduction back on what a removed shield ate (codex review 2026-11-04)", () => {
    // a 100k hit: Ironbark 20 % → 80k, a cocoon eats 60k, 20k lands; 70k left
    const cocoon: IAccountedSave = {
      name: "Life Cocoon",
      kind: "absorb",
      pct: 0,
      schoolMask: 0x7f,
      shieldIds: new Set(["116849"]),
      fromS: 0,
      toS: 30,
    };
    const u = target({
      damageIn: [hit(5, 20_000)],
      absorbsIn: [
        {
          logLine: { event: LogEvent.SPELL_ABSORBED, timestamp: at(5) },
          timestamp: at(5),
          spellId: "116849",
          absorbedAmount: 60_000,
        },
      ],
      advancedActions: [hp(5, 70_000)],
    });
    expect(died(u, [pct("Ironbark", 20)])).toBe(false); // 5k more
    expect(died(u, [cocoon])).toBe(false); // 60k more
    expect(died(u, [pct("Ironbark", 20), cocoon])).toBe(true); // 80k more
  });

  it("reads a hit on the attempt's own first millisecond (codex review 2026-11-04, round 2)", () => {
    const u = target({
      damageIn: [hit(1, 240_000)],
      advancedActions: [hp(1, 50_000)],
    });
    expect(died(u, [pct("Ironbark", 20)])).toBe(true);
  });

  it("reads the school of the hit a removed shield ate (codex review 2026-11-04, round 2)", () => {
    // a 100k Frost hit: Anti-Magic Zone 30 % (magic) → 70k, a cocoon eats
    // 60k, 10k lands; 80k left. Both away: 10/0.7−10 + 60/0.7 = 90k more.
    const amz = pct("Anti-Magic Zone", 30, 0x7e);
    const cocoon: IAccountedSave = {
      name: "Life Cocoon",
      kind: "absorb",
      pct: 0,
      schoolMask: 0x7f,
      shieldIds: new Set(["116849"]),
      fromS: 0,
      toS: 30,
    };
    const parameters: unknown[] = [];
    parameters[10] = "0x10";
    const u = target({
      damageIn: [hit(5, 10_000, "0x10")],
      absorbsIn: [
        {
          logLine: {
            event: LogEvent.SPELL_ABSORBED,
            timestamp: at(5),
            parameters,
          },
          timestamp: at(5),
          spellId: "116849",
          attackSpellId: "116",
          absorbedAmount: 60_000,
        },
      ],
      advancedActions: [hp(5, 80_000)],
    });
    expect(died(u, [amz])).toBe(false);
    expect(died(u, [cocoon])).toBe(false);
    expect(died(u, [amz, cocoon])).toBe(true);
  });

  it("counts a shield by what its own rows absorbed", () => {
    const row = (s: number, id: string, amount: number) => ({
      logLine: { event: LogEvent.SPELL_ABSORBED, timestamp: at(s) },
      timestamp: at(s),
      spellId: id,
      absorbedAmount: amount,
    });
    const cocoon: IAccountedSave = {
      name: "Life Cocoon",
      kind: "absorb",
      pct: 0,
      schoolMask: 0x7f,
      shieldIds: new Set(["116849"]),
      fromS: 0,
      toS: 30,
    };
    const u = (left: number) =>
      target({
        absorbsIn: [row(4, "116849", 300_000), row(4, "17", 500_000)],
        advancedActions: [hp(5, left)],
      });
    expect(died(u(300_000), [cocoon])).toBe(true);
    expect(died(u(300_001), [cocoon])).toBe(false);
  });
});

describe("accountedSave", () => {
  const carrier = { unit: target({}), isCaster: false };
  const save = (id: string) =>
    accountedSave({ name: id, spellId: id, fromS: 0, toS: 10 }, carrier);
  it("prices a percentage row and a shield; nothing else", () => {
    expect(save("102342")).toMatchObject({ kind: "pct", pct: 20 }); // Ironbark
    expect(save("116849")).toMatchObject({ kind: "absorb" }); // Life Cocoon
    expect(save("47788")).toBeUndefined(); // Guardian Spirit
    expect(save("1022")).toBeUndefined(); // Blessing of Protection (immunity)
    expect(save("196718")).toBeUndefined(); // Darkness (positional)
  });
  it("keeps the saves whose row or shield is not what they do (user ruling A)", () => {
    expect(save("357170")).toBeUndefined(); // Time Dilation: deferral
    expect(save("6940")).toBeUndefined(); // Blessing of Sacrifice: transfer
    // its talented press, Ultimate Sacrifice — an absorb row in DB2, a
    // transfer in the game (605 preview 2026-11-04)
    expect(save("199448")).toBeUndefined();
    expect(
      accountedSave(
        {
          name: "Blessing of Sacrifice",
          spellId: "199448",
          castId: "199448",
          fromS: 0,
          toS: 10,
        },
        carrier,
      ),
    ).toBeUndefined();
    expect(save("98008")).toBeUndefined(); // Spirit Link Totem: redistribution
  });
});

describe("judgeAlreadyUpExternals", () => {
  const judge = (u: ICombatUnit, ext: any[], own: IAccountedSave[] = []) =>
    judgeAlreadyUpExternals(u, T0, at(1), at(20), ext, own);
  const u = (left: number) =>
    target({ damageIn: [hit(5, 64_000)], advancedActions: [hp(5, left)] });
  const ib = { ...pct("Ironbark", 20), fromS: 0 };
  const bark = { ...pct("Barkskin", 20), fromS: 0.5 };

  it("alone / dropped", () => {
    expect(judge(u(16_000), [ib])).toEqual([{ kind: "alone" }]);
    expect(judge(u(40_000), [ib])).toEqual([{ kind: "dropped" }]);
  });

  it("together, when none alone and all of them would", () => {
    expect(judge(u(18_000), [ib], [bark])).toEqual([
      { kind: "together", with: ["Barkskin"] },
    ]);
  });

  it("dropped when the target's own reduction alone decides it", () => {
    const strong = { ...pct("Survival Instincts", 50), fromS: 0.5 };
    // without Survival Instincts: 64 / 0.5 = 128k (64k more) ≥ 40k
    expect(judge(u(40_000), [ib], [strong])).toEqual([{ kind: "dropped" }]);
  });

  it("names every external as before without the target's HP readings", () => {
    const blind = target({ damageIn: [hit(5, 64_000)] });
    expect(judge(blind, [ib, undefined])).toEqual([
      { kind: "unaccounted" },
      { kind: "unaccounted" },
    ]);
    expect(judge(u(40_000), [undefined])).toEqual([{ kind: "unaccounted" }]);
  });
});

describe("FAILED cause after the account (rendering)", () => {
  const attempt = (attribution: Record<string, unknown>): any => ({
    targetUnitId: "e1",
    targetName: "Druid-R",
    anchor: "burst",
    anchorSpellName: "The Hunt",
    fromSeconds: 91.2,
    toSeconds: 105.4,
    stuns: [],
    opportunity: { tier: "prime", wallsInHand: [] },
    teamDamageToTarget: 1_120_000,
    teamDamageToTargetInBracket: 1_120_000,
    teamDamageTotal: 1_500_000,
    teamOnTargetPct: 71,
    killed: false,
    attribution: {
      trinketed: false,
      brokeOut: [],
      immunityBaited: false,
      defensivePopped: [],
      defensivePoppedAtS: [],
      externalReceived: [],
      externalReceivedAtS: [],
      selfSaved: [],
      selfSavedAtS: [],
      outhealed: false,
      ...attribution,
    },
  });
  const line = (attribution: Record<string, unknown>) =>
    formatKillAttemptsForContext([attempt(attribution)]).find((l) =>
      l.includes("| FAILED: "),
    )!;
  const failed = (attribution: Record<string, unknown>) =>
    line(attribution).split("| FAILED: ")[1];

  it("names the externals kept only together as `A + B together`, after the others", () => {
    expect(
      failed({
        primary: "defensive",
        defensivePopped: ["Barkskin"],
        defensivePoppedAtS: [89.4],
        externalReceived: ["Lay on Hands", "Ironbark"],
        externalReceivedAtS: [99, 89.1],
        externalTogether: { names: ["Ironbark"], with: ["Barkskin"] },
      }),
    ).toBe(
      "popped Barkskin [up since 1:29]; saved by external (Lay on Hands/Ironbark [up since 1:29] + Barkskin together)",
    );
    // the opportunity clause restates each [up since] once
    expect(
      line({
        primary: "external",
        externalReceived: ["Ironbark", "Pain Suppression"],
        externalReceivedAtS: [89.1, 87.5],
        externalTogether: { names: ["Ironbark", "Pain Suppression"], with: [] },
      }),
    ).toContain(
      "saved by external (Ironbark [up since 1:29] + Pain Suppression [up since 1:27] together)",
    );
  });

  it("keeps every save of the target's own when the account took the external off", () => {
    const own = {
      primary: "defensive",
      defensivePopped: ["Survival of the Fittest"],
      defensivePoppedAtS: [95],
      selfSaved: ["Exhilaration"],
      selfSavedAtS: [98],
    };
    expect(failed({ ...own, externalAccountDropped: true })).toBe(
      "popped Survival of the Fittest; popped Exhilaration",
    );
    // without a dropped external the first of the two, as before
    expect(failed(own)).toBe("popped Survival of the Fittest");
  });
});

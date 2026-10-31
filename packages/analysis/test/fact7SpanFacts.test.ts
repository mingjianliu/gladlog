/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Round-7 audit (fact7 F21): the spell-blind cannot-cast readers (class 6) and
 * the single items of class 14 — a kill attempt's anchor, causes and sums, and
 * the spans and samples behind five printed facts. Each case is the audited
 * line reduced to the rows that decide it.
 */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { formatObservedConsequences } from "../src/context/observedConsequences";
import { ensureAnalysisData } from "../src/data/ensure";
import { staleMaxHpRows } from "../src/utils/advancedActions";
import { analyzeBurstLedger } from "../src/utils/burstLedger";
import { pressBlockedIntervalsForSpells } from "../src/utils/cannotCastIntervals";
import { analyzePlayerCCAndTrinket } from "../src/utils/ccTrinketAnalysis";
import {
  extractMajorCooldowns,
  gridHpPct,
  hpTroughInWindow,
  usableWhileStunned,
} from "../src/utils/cooldowns";
import {
  extractKillAttempts,
  formatKillAttemptsForContext,
} from "../src/utils/killAttempts";
import {
  makeAdvancedAction,
  makeAuraEvent,
  makeInterruptEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T = 1_000_000;
const at = (s: number) => T + s * 1000;

beforeAll(async () => {
  await ensureAnalysisData();
});

const aura = (
  event: LogEvent,
  spellId: string,
  s: number,
  src: string,
  dest: string,
  type: "BUFF" | "DEBUFF" = "DEBUFF",
) => makeAuraEvent(event, spellId, at(s), src, dest, type);
const auraSpan = (
  spellId: string,
  from: number,
  to: number,
  src: string,
  dest: string,
  type: "BUFF" | "DEBUFF" = "DEBUFF",
) => [
  aura(LogEvent.SPELL_AURA_APPLIED, spellId, from, src, dest, type),
  aura(LogEvent.SPELL_AURA_REMOVED, spellId, to, src, dest, type),
];

describe("D21 / D30 — cannot-cast time for a named spell", () => {
  const BARKSKIN = "22812";
  const REGROWTH = "8936";
  const druid = () =>
    makeUnit("p", {
      name: "Druid",
      class: CombatUnitClass.Druid,
      spec: CombatUnitSpec.Druid_Restoration,
      reaction: CombatUnitReaction.Friendly,
      info: { pvpTalents: [], talents: [] } as never,
      auraEvents: [
        ...auraSpan("408", 10, 14, "e", "p"), // Kidney Shot, a stun
        ...auraSpan("118", 20, 24, "e", "p"), // Polymorph
      ],
    });
  const spans = (spellId: string, onSelf: boolean) =>
    pressBlockedIntervalsForSpells(
      druid(),
      new Set(["e"]),
      [spellId],
      [],
      onSelf,
    ).map((iv) => [iv.from, iv.to]);

  it("a usable-while-stunned spell is held by the Polymorph, not by the stun", () => {
    expect(usableWhileStunned(BARKSKIN, new Set())).toBe(true);
    expect(spans(BARKSKIN, true)).toEqual([[at(20), at(24)]]);
  });

  it("any other spell is held by both", () => {
    expect(usableWhileStunned(REGROWTH, new Set())).toBe(false);
    expect(spans(REGROWTH, true)).toEqual([
      [at(10), at(14)],
      [at(20), at(24)],
    ]);
  });
});

describe("D2 — a cooldown that came back for less than the grace", () => {
  it("readyWindows holds the stretch availableWindows trims", () => {
    const BARKSKIN = "22812";
    const first = makeSpellCastEvent(BARKSKIN, at(10), "p", "D", "p", "D");
    const owner = (lastS: number) =>
      makeUnit("p", {
        class: CombatUnitClass.Druid,
        spec: CombatUnitSpec.Druid_Restoration,
        spellCastEvents: [
          first,
          makeSpellCastEvent(BARKSKIN, at(lastS), "p", "D", "p", "D"),
        ],
      });
    const combat = (u: any) =>
      ({ startTime: T, endTime: at(300), units: { p: u } }) as any;
    const probe = owner(200);
    const cd = extractMajorCooldowns(probe, combat(probe)).find(
      (c) => c.spellId === BARKSKIN,
    )!;
    const readyAt = 10 + cd.cooldownSeconds;
    const u = owner(readyAt + 1);
    const c = extractMajorCooldowns(u, combat(u)).find(
      (x) => x.spellId === BARKSKIN,
    )!;
    const startsAt = (w: { fromSeconds: number }) =>
      Math.abs(w.fromSeconds - readyAt) < 0.01;
    expect(c.availableWindows.some(startsAt)).toBe(false);
    expect(c.readyWindows?.some(startsAt)).toBe(true);
  });
});

describe("D25 — the post-kick window ends with the round", () => {
  it("a control landed after the round's end is not in ccInWindowS", () => {
    const FLASH_HEAL = "2061";
    const hunter = makeUnit("e1", {
      name: "Hunter",
      reaction: CombatUnitReaction.Hostile,
      info: { pvpTalents: [], talents: [] } as never,
    });
    const priest = makeUnit("player-1", {
      name: "Owner",
      class: CombatUnitClass.Priest,
      spec: CombatUnitSpec.Priest_Holy,
      reaction: CombatUnitReaction.Friendly,
      info: { pvpTalents: [], talents: [] } as never,
      spellCastEvents: [
        makeSpellCastEvent(FLASH_HEAL, at(5), "player-1", "O", "player-1", "O"),
      ],
      auraEvents: auraSpan("408", 12, 16, "e1", "player-1"),
      actionIn: [
        {
          ...makeInterruptEvent(
            "147362",
            "Counter Shot",
            FLASH_HEAL,
            "Flash Heal",
            at(10),
            "e1",
            "Hunter",
          ),
          destUnitId: "player-1",
        },
      ],
    });
    const read = (endS: number) =>
      analyzePlayerCCAndTrinket(priest, [hunter], {
        startTime: T,
        endTime: at(endS),
        startInfo: { zoneId: "1672" },
        units: { "player-1": priest, e1: hunter },
      } as never).interruptInstances[0]!.ccInWindowS ?? 0;
    expect(read(60)).toBeCloseTo(3, 1); // 12 → 15
    expect(read(12)).toBe(0); // the stun landed at the round's end
    // 3v3 (bd473d94 1:34): the first friendly death decides the match, the log
    // runs on past it
    const mate = makeUnit("player-2", {
      name: "Mate",
      reaction: CombatUnitReaction.Friendly,
      info: { pvpTalents: [], talents: [] } as never,
      deathRecords: [{ timestamp: at(11) } as never],
    });
    const threes = analyzePlayerCCAndTrinket(priest, [hunter], {
      startTime: T,
      endTime: at(60),
      startInfo: { zoneId: "1672", bracket: "3v3" },
      units: { "player-1": priest, "player-2": mate, e1: hunter },
    } as never);
    expect(threes.interruptInstances[0]!.ccInWindowS ?? 0).toBe(0);
  });
});

describe("kill attempts", () => {
  const unit = (id: string, over: Record<string, unknown> = {}): any => ({
    id,
    name: id,
    type: 1,
    spec: "265",
    reaction: 2,
    info: {},
    spellCastEvents: [],
    auraEvents: [],
    damageOut: [],
    damageIn: [],
    healIn: [],
    deathRecords: [],
    advancedActions: [],
    actionIn: [],
    actionOut: [],
    ...over,
  });
  const hit = (dest: string, s: number, amount = 60_000): any => ({
    destUnitId: dest,
    effectiveAmount: amount,
    logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: at(s), parameters: [] },
  });
  const press = (spellId: string, name: string, s: number, dest?: string) => ({
    spellId,
    spellName: name,
    ...(dest ? { destUnitId: dest, destUnitName: dest } : {}),
    logLine: {
      event: LogEvent.SPELL_CAST_SUCCESS,
      timestamp: at(s),
      parameters: [],
    },
  });
  const combat = (units: any[]): any => ({
    startTime: T,
    endTime: T + 300_000,
    startInfo: { zoneId: "1505" },
    units: Object.fromEntries(units.map((u) => [u.id, u])),
  });

  it("D4: an untargeted self-buff that opens the bracket names it", () => {
    const e1 = unit("e1");
    const e2 = unit("e2");
    const f1 = unit("f1", {
      reaction: 1,
      spec: "71",
      spellCastEvents: [
        press("1719", "Recklessness", 40),
        press("107574", "Avatar", 45, "e1"),
      ],
      damageOut: [hit("e1", 42), hit("e1", 46)],
    });
    const a = extractKillAttempts([f1], [e1, e2], combat([f1, e1, e2]));
    expect(a[0]!.anchorSpellName).toBe("Recklessness");
  });

  it("D4: a self-buff whose caster hit only another enemy stays out of it", () => {
    const e1 = unit("e1");
    const e2 = unit("e2");
    const f1 = unit("f1", {
      reaction: 1,
      spec: "71",
      spellCastEvents: [press("1719", "Recklessness", 40)],
      damageOut: [hit("e2", 42)],
    });
    const f2 = unit("f2", {
      reaction: 1,
      spec: "71",
      spellCastEvents: [press("107574", "Avatar", 41, "e1")],
      damageOut: [hit("e1", 42, 200_000)],
    });
    const a = extractKillAttempts([f1, f2], [e1, e2], combat([f1, f2, e1, e2]));
    expect(a.map((x) => x.anchorSpellName)).toContain("Avatar");
    expect(a.map((x) => x.anchorSpellName)).not.toContain(
      "Recklessness (cast into e1)",
    );
  });

  it("D4: a self-buff's hit a shield ate on the target went into the target", () => {
    const e1 = unit("e1");
    const e2 = unit("e2");
    // 1405c83e 0:48: Bestial Wrath's 344572 landed on the other enemy, and
    // every hit on the target was absorbed: `spellId` is the shield
    const absorbed = {
      ...hit("e1", 40.1, 35_000),
      spellId: "11426",
      spellName: "Ice Barrier",
      attackSpellId: "344572",
      attackSpellName: "Bestial Wrath",
    };
    const f1 = unit("f1", {
      reaction: 1,
      spec: "253",
      spellCastEvents: [
        press("19574", "Bestial Wrath", 40),
        press("107574", "Avatar", 45, "e1"),
      ],
      damageOut: [
        {
          ...hit("e2", 40.1, 1_000),
          spellId: "344572",
          spellName: "Bestial Wrath",
        },
        absorbed,
        hit("e1", 42),
      ],
    });
    const a = extractKillAttempts([f1], [e1, e2], combat([f1, e1, e2]));
    expect(a[0]!.anchorSpellName).toBe("Bestial Wrath");
  });

  it("D4: a splash of the press elsewhere does not aim it: its caster's damage does", () => {
    const e1 = unit("e1");
    const e2 = unit("e2");
    // 90c01e7f 2:28: Ascendance's 344548 hit the healer, 83 % of the shaman's
    // bracket went into the target
    const f1 = unit("f1", {
      reaction: 1,
      spec: "263",
      spellCastEvents: [
        press("114051", "Ascendance", 40),
        press("107574", "Avatar", 44, "e1"),
      ],
      damageOut: [
        { ...hit("e2", 40, 5_000), spellId: "344548", spellName: "Ascendance" },
        hit("e1", 42, 200_000),
      ],
    });
    const a = extractKillAttempts([f1], [e1, e2], combat([f1, e1, e2]));
    expect(a[0]!.anchorSpellName).toBe("Ascendance");
  });

  it("D4: a splash whose caster stayed on the other enemy leaves the press out", () => {
    const e1 = unit("e1");
    const e2 = unit("e2");
    const f1 = unit("f1", {
      reaction: 1,
      spec: "265",
      spellCastEvents: [press("442726", "Malevolence", 40)],
      damageOut: [
        {
          ...hit("e2", 40, 5_000),
          spellId: "446285",
          spellName: "Malevolence",
        },
        hit("e2", 41, 300_000),
        hit("e1", 42, 1_000),
      ],
    });
    const f2 = unit("f2", {
      reaction: 1,
      spec: "71",
      spellCastEvents: [press("107574", "Avatar", 41, "e1")],
      damageOut: [hit("e1", 42, 400_000)],
    });
    const a = extractKillAttempts([f1, f2], [e1, e2], combat([f1, f2, e1, e2]));
    expect(a[0]!.anchorSpellName).toBe("Avatar");
  });

  it("D4: an absorbed splash on the target does not aim the press either (codex 06-1)", () => {
    const e1 = unit("e1");
    const e2 = unit("e2");
    const absorbed = {
      ...hit("e1", 40.1, 1_000),
      spellId: "11426",
      spellName: "Ice Barrier",
      attackSpellId: "446285",
      attackSpellName: "Malevolence",
    };
    const f1 = unit("f1", {
      reaction: 1,
      spec: "265",
      spellCastEvents: [press("442726", "Malevolence", 40)],
      damageOut: [
        {
          ...hit("e2", 40, 5_000),
          spellId: "446285",
          spellName: "Malevolence",
        },
        absorbed,
        hit("e2", 41, 300_000),
      ],
    });
    const f2 = unit("f2", {
      reaction: 1,
      spec: "71",
      spellCastEvents: [press("107574", "Avatar", 41, "e1")],
      damageOut: [hit("e1", 42, 400_000)],
    });
    const a = extractKillAttempts([f1, f2], [e1, e2], combat([f1, f2, e1, e2]));
    expect(a[0]!.anchorSpellName).toBe("Avatar");
  });

  it("D10: the target's own area save, its aura on it, is a press of its own", () => {
    const e1 = unit("e1", {
      spec: "71",
      class: CombatUnitClass.Warrior,
      spellCastEvents: [press("97462", "Rallying Cry", 41)],
      auraEvents: auraSpan("97463", 41, 51, "e1", "e1", "BUFF"),
    });
    const f1 = unit("f1", {
      reaction: 1,
      spec: "71",
      spellCastEvents: [press("1719", "Recklessness", 40)],
      damageOut: [hit("e1", 42)],
    });
    const lines = formatKillAttemptsForContext(
      extractKillAttempts([f1], [e1], combat([f1, e1])),
    ).join("\n");
    expect(lines).toContain("FAILED: popped Rallying Cry");
  });

  it("D67: a bracket cut at the target's death reads its sums over the cut span", () => {
    const e1 = unit("e1", { deathRecords: [{ timestamp: at(44) }] });
    const e2 = unit("e2");
    const f1 = unit("f1", {
      reaction: 1,
      spec: "71",
      spellCastEvents: [press("1719", "Recklessness", 40)],
      // past the death + 5 s: the other enemy, in the uncut span alone
      damageOut: [hit("e1", 42), hit("e2", 43, 20_000), hit("e2", 56, 60_000)],
    });
    const a = extractKillAttempts([f1], [e1, e2], combat([f1, e1, e2]));
    expect(a[0]!.toSeconds).toBe(44);
    expect(a[0]!.teamDamageTotal).toBe(80_000);
    expect(a[0]!.teamOnTargetPct).toBe(75);
  });
});

describe("D20 — [CONSEQ] for a unit the log did not read near the landing", () => {
  it("starts at the unit's first reading inside the span", () => {
    const healer = makeUnit("h", {
      name: "Healer-R",
      spec: CombatUnitSpec.Priest_Discipline,
      auraEvents: [
        {
          ...aura(LogEvent.SPELL_AURA_APPLIED, "1330", 16, "e1", "h"),
          spellName: "Garrote - Silence",
        },
        aura(LogEvent.SPELL_AURA_REMOVED, "1330", 22, "e1", "h"),
      ],
    });
    const mate = makeUnit("m", {
      name: "Mate-R",
      advancedActions: [
        makeAdvancedAction(at(4), 0, 0, 500_000, 500_000),
        makeAdvancedAction(at(21), 0, 0, 500_000, 500_000),
        makeAdvancedAction(at(21.8), 0, 0, 500_000, 450_000),
      ].map((a) => ({ ...a, advancedActorId: "m" })),
    });
    const rogue = makeUnit("e1", {
      name: "Rogue-R",
      reaction: CombatUnitReaction.Hostile,
    });
    const lines = formatObservedConsequences({
      combat: {
        startTime: T,
        endTime: at(60),
        units: { h: healer, m: mate, e1: rogue },
      } as never,
      friends: [healer, mate],
      enemies: [rogue],
      friendlyCC: [],
      enemyCC: [],
      labels: { friendly: (n) => n, enemy: (n) => n },
    });
    expect(lines.find((l) => l.includes("(silence)"))).toContain(
      "Mate-R 100% → low 90% at 0:21",
    );
  });
});

describe("D40 — a teammate's proc immunity in the burst ledger", () => {
  it("Peaceweaver on the target reads as its defensive", () => {
    const info = { teamId: "0", specId: "x" } as any;
    const dmg = (s: number) => ({
      logLine: {
        event: LogEvent.SPELL_DAMAGE,
        timestamp: at(s),
        parameters: [],
      },
      timestamp: at(s),
      effectiveAmount: -50_000,
      amount: -50_000,
      srcUnitId: "p1",
      srcUnitName: "Ret",
      destUnitId: "e1",
      destUnitName: "e1",
      spellId: "1",
      spellName: "TestSpell",
    });
    const ret = makeUnit("p1", {
      name: "Ret",
      spec: CombatUnitSpec.Paladin_Retribution,
      info,
      spellCastEvents: [
        makeSpellCastEvent(
          "31884",
          at(10),
          "p1",
          "S",
          "p1",
          "Ret",
          0,
          "Avenging Wrath",
        ),
      ],
      damageOut: [dmg(12)],
    } as any);
    const mate = makeUnit("e1", {
      name: "Mate",
      info,
      auraEvents: auraSpan("353319", 11, 13, "e2", "e1", "BUFF"),
    } as any);
    const hits = analyzeBurstLedger(ret, [], [mate], {
      startTime: T,
      endTime: at(120),
    } as any)[0]!.dominantTarget?.defensivesHit;
    expect(hits?.map((d) => d.spellId)).toEqual(["353319"]);
    expect(hits?.[0]?.viaLoggedAura).toBe(true);
  });
});

describe("D60 — a form shift's row: fresh current over a stale max", () => {
  const row = (s: number, cur: number, max: number) =>
    makeAdvancedAction(at(s), 0, 0, max, cur);
  const unitOf = (rows: any[]) => makeUnit("unit-1", { advancedActions: rows });
  // 4f8a5947 2:33: the Feral's rows around leaving Bear Form
  const shift = [
    row(10, 204_288, 1_361_920), // 15.0 %
    row(10.1, 151_364, 1_361_920), // 11.1 %: Cat current, Bear max
    row(10.3, 151_771, 1_047_640), // 14.5 %
    row(11, 150_180, 1_047_640), // 14.3 %
  ];

  it("flags the row, and neither the trough nor the tick stands on it", () => {
    const u = unitOf(shift);
    expect(staleMaxHpRows(u).size).toBe(1);
    expect(staleMaxHpRows(u).has(u.advancedActions[1] as never)).toBe(true);
    expect(hpTroughInWindow(u as never, T, 10, 11)?.pct).toBe(14);
    expect(gridHpPct(u as never, at(10.2))).toBe(15);
  });

  it("a max that rises, and a max lost with its share, flag nothing", () => {
    const up = unitOf([
      row(10, 700_000, 1_000_000),
      row(10.1, 700_000, 1_000_000),
      row(10.2, 700_000, 1_200_000),
    ]);
    expect(staleMaxHpRows(up).size).toBe(0);
    // a real hit on the old max: its current does not recover the reading
    const hit = unitOf([
      row(10, 900_000, 1_400_000),
      row(10.1, 500_000, 1_400_000),
      row(10.2, 500_000, 1_000_000),
    ]);
    expect(staleMaxHpRows(hit).size).toBe(0);
  });

  it("a hit, then a proportional shift: the step keeps the dip, so the row stands (codex 03-2)", () => {
    const u = unitOf([
      row(10, 180_000, 1_300_000), // 13.8 %
      row(10.1, 100_000, 1_300_000), // 7.7 %: an 80,000 hit
      row(10.3, 76_923, 1_000_000), // 7.7 %: the form, proportionally
    ]);
    expect(staleMaxHpRows(u).size).toBe(0);
    expect(hpTroughInWindow(u as never, T, 10, 11)?.pct).toBe(8);
  });

  it("real hits inside the run do not hide it: the step's own pair decides (1-5-13 2:14, Rallying Cry ends)", () => {
    const u = unitOf([
      row(10, 649_816, 914_167), // 71.1 %
      row(10.016, 516_366, 914_167), // 56.5 %: the buff's HP gone, its max not
      row(10.333, 494_678, 914_167), // 54.1 %: two more hits
      row(10.51, 491_679, 781_340), // 62.9 %: current carried over the step
    ]);
    expect(staleMaxHpRows(u).size).toBe(2);
    expect(hpTroughInWindow(u as never, T, 10, 11)?.pct).toBe(63);
  });
});

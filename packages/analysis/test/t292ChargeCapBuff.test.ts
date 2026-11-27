/**
 * Pipeline T292: a buff that raises a charge pool's cap while it is up (aura
 * 411, the "charges" rows of conditionalCooldownsGenerated.json) — Call of
 * the Elder Druid 319454's +1 Frenzied Regeneration. Two presses 1.3 s apart
 * under it are two charges, each with its own press; without it the second
 * row of a one-charge spell within 2 s is still folded into the first.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  AtomicArenaCombat,
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import CONDITIONAL from "../src/data/conditionalCooldownsGenerated.json";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  cdAvailableAt,
  cdMaybeAvailableAt,
  cdRealisedSecondsUntilReady,
  cdSecondsUntilReady,
  entryAvailabilityTransitions,
  extractMajorCooldowns,
  pressReadyAgainAtSeconds,
  unitCooldownAvailableAt,
  unitCooldownEntry,
} from "../src/utils/cooldowns";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const PID = "player-1";
const T0 = 1_000_000;
const FR = "22842";
const ELDER = "319454";

const aura = (event: LogEvent, atMs: number): any => ({
  logLine: { event, timestamp: T0 + atMs },
  timestamp: T0 + atMs,
  spellId: ELDER,
  srcUnitId: PID,
  destUnitId: PID,
});
const druid = (pressS: number[], auraEvents: any[]) =>
  makeUnit(PID, {
    class: CombatUnitClass.Druid,
    spec: CombatUnitSpec.Druid_Restoration,
    info: { talents: [], pvpTalents: [] },
    spellCastEvents: pressS.map((s) =>
      makeSpellCastEvent(FR, T0 + s * 1000, ""),
    ),
    auraEvents,
  } as any);
const combatOf = (u: any) =>
  ({
    startTime: T0,
    endTime: T0 + 300_000,
    units: { [PID]: u },
  }) as unknown as AtomicArenaCombat;

describe("T292 — a charge-cap buff keeps the second press", () => {
  it("DB2's aura 411 row: Call of the Elder Druid +1 Frenzied Regeneration", () => {
    const rows = (CONDITIONAL.byTarget as Record<string, any[]>)[FR] ?? [];
    expect(rows).toContainEqual({ carrier: ELDER, kind: "charges", n: 1 });
  });

  it("a proc aura the next press spends is no raised cap (codex 85-tk-L6-T292-1 #1/#2)", () => {
    const by = CONDITIONAL.byTarget as Record<string, any[]>;
    const charges = (id: string) =>
      (by[id] ?? []).filter((m) => m.kind === "charges");
    // Shadowy Insight on Mind Blast, Shot in the Dark on Cheap Shot, the
    // rogue's Time Spiral on Sprint's pool, Save the Day on Leap of Faith
    for (const id of ["8092", "1833", "2983", "73325", "187874"])
      expect(charges(id)).toEqual([]);
  });

  it("two presses 1.3 s apart under the buff are two presses", () => {
    const u = druid(
      [17.164, 18.485],
      [
        aura(LogEvent.SPELL_AURA_APPLIED, 9_557),
        aura(LogEvent.SPELL_AURA_REMOVED, 24_557),
      ],
    );
    const entry = unitCooldownEntry(u, combatOf(u), FR)!;
    expect(entry.charges).toBe(1);
    expect(entry.casts.map((c) => c.timeSeconds)).toEqual([17.164, 18.485]);
    // the buff's charge funds the second: the recharge the first started
    // keeps running (codex 85-tk-L6-T292-2 #1)
    expect(entry.casts[1]!.freeRecast).toBe(true);
    const cd = entry.cooldownSeconds;
    expect(pressReadyAgainAtSeconds(entry, 18.485)).toBeCloseTo(17.164 + cd, 6);
    // the opener with the bonus charge still in hand is ready again at once
    expect(pressReadyAgainAtSeconds(entry, 17.164)).toBeCloseTo(17.164, 6);
  });

  it("without the buff (or after it fell off) the second row folds into the first", () => {
    const none = druid([17.164, 18.485], []);
    expect(
      unitCooldownEntry(none, combatOf(none), FR)!.casts.map(
        (c) => c.timeSeconds,
      ),
    ).toEqual([17.164]);
    const gone = druid(
      [17.164, 18.485],
      [
        aura(LogEvent.SPELL_AURA_APPLIED, 2_000),
        aura(LogEvent.SPELL_AURA_REMOVED, 17_000),
      ],
    );
    expect(
      unitCooldownEntry(gone, combatOf(gone), FR)!.casts.map(
        (c) => c.timeSeconds,
      ),
    ).toEqual([17.164]);
  });

  const underElder = (pressS: number[]) =>
    druid(pressS, [
      aura(LogEvent.SPELL_AURA_APPLIED, 10_000),
      aura(LogEvent.SPELL_AURA_REMOVED, 25_000),
    ]);

  it("one application funds one press: rows at 17, 18.5 and 20 s keep two (codex 85-tk-L6-T292-3 #2)", () => {
    const u = underElder([17, 18.5, 20]);
    const entry = unitCooldownEntry(u, combatOf(u), FR)!;
    expect(entry.casts.map((c) => c.timeSeconds)).toEqual([17, 18.5]);
  });

  it("a press past the 2 s fold under a running recharge spends the bonus charge too (#1)", () => {
    const u = underElder([12, 16]);
    const entry = unitCooldownEntry(u, combatOf(u), FR)!;
    expect(entry.casts.map((c) => c.timeSeconds)).toEqual([12, 16]);
    expect(entry.casts[1]!.freeRecast).toBe(true);
    expect(pressReadyAgainAtSeconds(entry, 16)).toBeCloseTo(
      12 + entry.cooldownSeconds,
      6,
    );
  });

  it("charges go in press order: 12 paid, 16 spends the bonus, 17.5 folds (codex -4 #3)", () => {
    const u = underElder([12, 16, 17.5]);
    const entry = unitCooldownEntry(u, combatOf(u), FR)!;
    expect(entry.casts.map((c) => c.timeSeconds)).toEqual([12, 16]);
    expect(pressReadyAgainAtSeconds(entry, 16)).toBeCloseTo(
      12 + entry.cooldownSeconds,
      6,
    );
  });

  it("the bonus press keeps the paid press's deadline on the rate-warped clock (codex -4 #4)", () => {
    const berserk = (event: LogEvent, atMs: number): any => ({
      ...aura(event, atMs),
      spellId: "50334",
    });
    const u = druid(
      [17, 21],
      [
        aura(LogEvent.SPELL_AURA_APPLIED, 10_000),
        berserk(LogEvent.SPELL_AURA_APPLIED, 17_000),
        berserk(LogEvent.SPELL_AURA_REMOVED, 18_000),
        aura(LogEvent.SPELL_AURA_REMOVED, 25_000),
      ],
    );
    const entry = unitCooldownEntry(u, combatOf(u), FR)!;
    expect(entry.casts.map((c) => c.timeSeconds)).toEqual([17, 21]);
    expect(entry.casts[1]!.freeRecast).toBe(true);
    // 17 s + 1 s at ×20 (20 s of cooldown) + the 16 s left = 34 s
    const cd = entry.cooldownSeconds;
    expect(pressReadyAgainAtSeconds(entry, 21)).toBeCloseTo(
      18 + (cd - 1 - 19),
      6,
    );
  });

  it("the bonus charge in hand reads available, bounded by both buff ends (codex -4 #1/#2)", () => {
    // paid at 5 s, buff 10–25 s, bonus spent at 17 s
    const spent = underElder([5, 17]);
    const a = unitCooldownEntry(spent, combatOf(spent), FR)!;
    expect(a.casts.map((c) => c.timeSeconds)).toEqual([5, 17]);
    expect(cdAvailableAt(a, 8)).toBe(false);
    expect(cdAvailableAt(a, 12)).toBe(true);
    expect(cdAvailableAt(a, 18)).toBe(false);
    // the ready window opens at the buff, not at the bonus press
    expect(
      (a.readyWindows ?? []).some(
        (w) => w.fromSeconds === 10 && w.toSeconds === 17,
      ),
    ).toBe(true);
    // unspent: in hand from the buff's start to its end
    const held = underElder([5]);
    const b = unitCooldownEntry(held, combatOf(held), FR)!;
    expect(cdAvailableAt(b, 8)).toBe(false);
    expect(cdAvailableAt(b, 12)).toBe(true);
    expect(cdAvailableAt(b, 24)).toBe(true);
    expect(cdAvailableAt(b, 27)).toBe(false);
  });

  it("a free press's anchored override keeps the recast floor on its anchor", () => {
    const cd: any = {
      casts: [
        { timeSeconds: 17 },
        {
          timeSeconds: 18.5,
          freeRecast: true,
          freeRecastOf: 17,
          cooldownSecondsOverride: 34.5,
        },
      ],
      cooldownSeconds: 36,
      earliestCooldownSeconds: 20,
      neverUsed: false,
      charges: 1,
    };
    expect(cdSecondsUntilReady(cd, 19)).toBeCloseTo(34, 6);
    expect(cdSecondsUntilReady(cd, 19, 20)).toBeCloseTo(18, 6);
    expect(cdMaybeAvailableAt(cd, 30)).toBe(false);
    expect(cdMaybeAvailableAt(cd, 37)).toBe(true);
  });

  const berserkAura = (event: LogEvent, atMs: number): any => ({
    ...aura(event, atMs),
    spellId: "50334",
  });

  it("a press after the warped recharge ran out inside 2 s is a paid press (codex -5 #1)", () => {
    // ×20 for 17–22 s: the 17 s press is back at 18.8; 18.3 spent the bonus
    const u = druid(
      [17, 18.3, 19.4],
      [
        aura(LogEvent.SPELL_AURA_APPLIED, 10_000),
        berserkAura(LogEvent.SPELL_AURA_APPLIED, 17_000),
        berserkAura(LogEvent.SPELL_AURA_REMOVED, 22_000),
        aura(LogEvent.SPELL_AURA_REMOVED, 25_000),
      ],
    );
    const entry = unitCooldownEntry(u, combatOf(u), FR)!;
    expect(entry.casts.map((c) => c.timeSeconds)).toEqual([17, 18.3, 19.4]);
    expect(entry.casts[2]!.freeRecast).toBeUndefined();
  });

  it("a later spend does not erase the span the bonus sat in hand before (codex -5 #2)", () => {
    const u = druid(
      [5, 42, 45],
      [
        aura(LogEvent.SPELL_AURA_APPLIED, 35_000),
        aura(LogEvent.SPELL_AURA_REMOVED, 50_000),
      ],
    );
    const entry = unitCooldownEntry(u, combatOf(u), FR)!;
    expect(entry.cooldownSeconds).toBe(36);
    expect(entry.casts.map((c) => c.timeSeconds)).toEqual([5, 42, 45]);
    expect(cdAvailableAt(entry, 37)).toBe(true);
    expect(
      (entry.readyWindows ?? []).some(
        // one stretch: bonus 35–41, the charge 41–42, the bonus again to 45 (codex -7 #1)
        (w) => w.fromSeconds === 35 && w.toSeconds === 45,
      ),
    ).toBe(true);
    expect(cdAvailableAt(entry, 43)).toBe(true);
    expect(cdAvailableAt(entry, 46)).toBe(false);
  });

  it("the paid press is back when the bonus charge comes into hand (codex -5 #3)", () => {
    const u = underElder([5, 17]);
    const entry = unitCooldownEntry(u, combatOf(u), FR)!;
    expect(pressReadyAgainAtSeconds(entry, 5)).toBe(10);
  });

  it("the two recast-floor readers agree under a rate window (codex -5 #5)", () => {
    const u = druid(
      [17, 18.3],
      [
        aura(LogEvent.SPELL_AURA_APPLIED, 10_000),
        berserkAura(LogEvent.SPELL_AURA_APPLIED, 17_000),
        berserkAura(LogEvent.SPELL_AURA_REMOVED, 18_000),
        aura(LogEvent.SPELL_AURA_REMOVED, 25_000),
      ],
    );
    const entry = unitCooldownEntry(u, combatOf(u), FR)!;
    const e = entry.earliestCooldownSeconds;
    if (e === undefined) return;
    for (const t of [18, 19, 20, 25, 30])
      expect(cdMaybeAvailableAt(entry, t)).toBe(
        cdSecondsUntilReady(entry, t, e) === 0 && !cdAvailableAt(entry, t),
      );
  });

  it("the rendered row of the paid press reads the bonus charge in hand (codex -6 #1, 755e175d 1:03)", () => {
    const u = underElder([13.725, 14.876]);
    const entry = unitCooldownEntry(u, combatOf(u), FR)!;
    // row 0:13: the press at 13.725 is spent by the render rule
    expect(cdAvailableAt(entry, 13)).toBe(true);
  });

  it("the transitions close an unspent bonus at the buff's end (codex -6 #2, 2c68ad74 r3)", () => {
    const u = druid(
      [17.231, 60],
      [
        aura(LogEvent.SPELL_AURA_APPLIED, 10_000),
        aura(LogEvent.SPELL_AURA_REMOVED, 23_437),
      ],
    );
    const entry = unitCooldownEntry(u, combatOf(u), FR)!;
    const cd = entry.cooldownSeconds;
    const flips = entryAvailabilityTransitions(entry, 100);
    expect(flips).toContainEqual({ atSeconds: 23.437, available: false });
    expect(flips).toContainEqual({ atSeconds: 17.231 + cd, available: true });
    expect(cdAvailableAt(entry, 24)).toBe(false);
    // the flips agree with the point reading
    for (const t of [18, 24, 40, 17.231 + cd + 1]) {
      const last = flips.filter((f) => f.atSeconds <= t + 0.5).pop();
      expect(last?.available ?? true).toBe(cdAvailableAt(entry, t));
    }
  });

  it("the recast audit's bonus label (codex -6 #4)", () => {
    const u = underElder([17.164, 18.485]);
    const entry = unitCooldownEntry(u, combatOf(u), FR)!;
    expect(entry.casts[1]!.bonusChargeSpent).toBe(true);
    expect(entry.casts[0]!.bonusChargeSpent).toBeUndefined();
  });

  it("a talent window's free recast under a rate window: one return (codex -6 #3, f694532a)", () => {
    const LOF = "73325";
    const u = makeUnit(PID, {
      class: CombatUnitClass.Priest,
      spec: CombatUnitSpec.Priest_Discipline,
      info: {
        talents: [{ id1: 94675, id2: 119331, count: 1 }],
        pvpTalents: [],
        interestingAurasJSON: JSON.stringify(["player-2", 381753, 1]),
      },
      spellCastEvents: [
        makeSpellCastEvent(LOF, T0 + 32_552, ""),
        makeSpellCastEvent(LOF, T0 + 33_822, ""),
      ],
      auraEvents: [],
    } as any);
    const entry = extractMajorCooldowns(u, combatOf(u)).find(
      (c) => c.spellId === LOF,
    )!;
    expect(entry.rateWindows?.length).toBe(1);
    expect(entry.casts.map((c) => c.timeSeconds)).toEqual([32.552, 33.822]);
    expect(entry.casts[1]!.freeRecast).toBe(true);
    const back = pressReadyAgainAtSeconds(entry, 33.822)!;
    expect(back).toBeCloseTo(32.552 + entry.cooldownSeconds * 0.85, 6);
    expect(
      (entry.readyWindows ?? []).some(
        (w) => Math.abs(w.fromSeconds - back) < 1e-6,
      ),
    ).toBe(true);
  });

  it("a bonus span touching a ready window is one available stretch (codex -7 #1, b2db52b4 r3)", () => {
    // ready from the start to 25.472 s, bonus in hand to 28.046 (buff end)
    const u = druid(
      [25.472, 70],
      [
        aura(LogEvent.SPELL_AURA_APPLIED, 20_000),
        aura(LogEvent.SPELL_AURA_REMOVED, 28_046),
      ],
    );
    const entry = unitCooldownEntry(u, combatOf(u), FR)!;
    expect(entry.availableWindows).toContainEqual({
      fromSeconds: 0,
      toSeconds: 28.046,
      durationSeconds: 28.046,
    });
  });

  it("a pre-press query does not see the bonus spend it drops (codex -7 #2, 755e175d)", () => {
    const u = underElder([13.725, 14.876]);
    expect(
      unitCooldownAvailableAt(u, combatOf(u), FR, 14.7, { before: true }),
    ).toBe(true);
    // with the spend in view it is spent inside the slack
    expect(unitCooldownAvailableAt(u, combatOf(u), FR, 14.7)).toBe(false);
  });

  it("the render clamp keeps a free press's anchored deadline (codex -7 #3, f281cc6f r4)", () => {
    const u = druid(
      [156.075, 163.591],
      [
        aura(LogEvent.SPELL_AURA_APPLIED, 150_000),
        aura(LogEvent.SPELL_AURA_REMOVED, 165_000),
      ],
    );
    const entry = unitCooldownEntry(u, combatOf(u), FR)!;
    expect(entry.casts[1]!.freeRecast).toBe(true);
    const deadline = 156.075 + entry.cooldownSeconds;
    // row 2:43: the 163.591 press is spent by the render rule
    expect(cdSecondsUntilReady(entry, 163)).toBeCloseTo(deadline - 163, 6);
  });

  it("the realised return counts a bonus that came into hand later (codex -7 #4, 2c68ad74 r3)", () => {
    const u = druid(
      [53.949],
      [
        aura(LogEvent.SPELL_AURA_APPLIED, 72_102),
        aura(LogEvent.SPELL_AURA_REMOVED, 87_102),
      ],
    );
    const entry = unitCooldownEntry(u, combatOf(u), FR)!;
    expect(pressReadyAgainAtSeconds(entry, 53.949)).toBeCloseTo(72.102, 6);
    expect(cdRealisedSecondsUntilReady(entry, 53.949)).toBeCloseTo(
      72.102 - 53.949,
      6,
    );
  });

  it("the render clamp leaves an already-ready free press ready (codex -8 #1, d90bd21f)", () => {
    const cd: any = {
      casts: [
        { timeSeconds: 10 },
        {
          timeSeconds: 60.782,
          freeRecast: true,
          freeRecastOf: 10,
          cooldownSecondsOverride: 0,
        },
      ],
      cooldownSeconds: 30,
      neverUsed: false,
      charges: 1,
    };
    expect(cdAvailableAt(cd, 60)).toBe(true);
    expect(cdSecondsUntilReady(cd, 60)).toBe(0);
  });

  it("a pre-press query keeps the bonus to the buff's end at t itself (codex -8 #2, 755e175d)", () => {
    const u = druid(
      [13.725, 14.876],
      [
        aura(LogEvent.SPELL_AURA_APPLIED, 5_000),
        aura(LogEvent.SPELL_AURA_REMOVED, 15_322),
      ],
    );
    for (const t of [14.84, 14.87])
      expect(
        unitCooldownAvailableAt(u, combatOf(u), FR, t, { before: true }),
      ).toBe(true);
    expect(
      unitCooldownAvailableAt(u, combatOf(u), FR, 15.4, { before: true }),
    ).toBe(false);
  });

  it("the transitions of a view without the spend read the open end (codex -8 #3, f281cc6f)", () => {
    const u = underElder([13.725, 14.876]);
    const entry = unitCooldownEntry(u, combatOf(u), FR)!;
    const view = {
      ...entry,
      casts: entry.casts.filter((c) => c.timeSeconds < 14.8),
    };
    const flips = entryAvailabilityTransitions(view, 100);
    expect(flips).not.toContainEqual({ atSeconds: 14.876, available: false });
    expect(flips).toContainEqual({ atSeconds: 25, available: false });
    expect(cdAvailableAt(view, 20)).toBe(true);
  });

  it("the raised cap is one more press, not any number: a third row inside 2 s still folds", () => {
    const u = druid(
      [17.0, 17.9, 18.8],
      [
        aura(LogEvent.SPELL_AURA_APPLIED, 9_557),
        aura(LogEvent.SPELL_AURA_REMOVED, 24_557),
      ],
    );
    expect(
      unitCooldownEntry(u, combatOf(u), FR)!.casts.map((c) => c.timeSeconds),
    ).toEqual([17.0, 17.9]);
  });
});

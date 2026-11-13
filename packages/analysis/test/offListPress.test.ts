/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  AtomicArenaCombat,
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import trinketItemIds from "../src/data/trinketItemIds.json";
import { unitCooldownEntry } from "../src/utils/cooldowns";
import {
  extractOffListPresses,
  isOffListPressId,
  isRosterPressId,
  lineStatesPress,
  PRESS_LINE_MIN_CD_SECONDS,
  PRESS_LINE_WHITELIST_IDS,
  PRESS_TARGET_AURA_LEAD_MS,
  pressChainFollowUps,
  pressDuration,
  pressLineCaster,
  timeStopHeldSeconds,
} from "../src/utils/offListPress";
import {
  equippedBadgeCount,
  GLADIATOR_BADGE_SPELL_ID,
} from "../src/utils/trinketType";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("[PRESS] — which presses (GH #176, user ruling 2026-11-02)", () => {
  it("the threshold is 45 s", () => {
    expect(PRESS_LINE_MIN_CD_SECONDS).toBe(45);
  });
  it("an off-roster 45 s button is the line's; a 30 s one, a trinket and a roster button are not", () => {
    expect(isOffListPressId("190784")).toBe(true); // Divine Steed, 45 s
    expect(isOffListPressId("13877")).toBe(false); // Blade Flurry, 30 s
    expect(isOffListPressId("336126")).toBe(false); // Gladiator's Medallion
    expect(isRosterPressId("642")).toBe(true); // Divine Shield
    expect(isOffListPressId("642")).toBe(false);
  });
  it("a picked button under 45 s is the line's, its other cast ids too; an unpicked 30 s button is not (GH #183)", () => {
    expect(isOffListPressId("586")).toBe(true); // Fade, 30 s, picked
    expect(isOffListPressId("1245412")).toBe(true); // Voidblade
    expect(isOffListPressId("1245483")).toBe(true); // Pierce the Veil, its variant
    expect(isOffListPressId("382411")).toBe(true); // Eternity Surge (Font of Magic)
    expect(isOffListPressId("122")).toBe(false); // Frost Nova, not picked
    expect(PRESS_LINE_WHITELIST_IDS.size).toBe(33);
  });
  it("every picked id is on no roster and passes the press predicate (else the pick is moot)", () => {
    for (const id of PRESS_LINE_WHITELIST_IDS) {
      expect(isRosterPressId(id), id).toBe(false);
      expect(isOffListPressId(id), id).toBe(true);
    }
  });
});

describe("[PRESS] — does a line already state the press", () => {
  it("reads the caster from (by N), N's, [YOU], or the first unit", () => {
    expect(
      pressLineCaster(
        "[CC ON TEAM]   1(AWarrior) ← Sap (by 4(ORogue))",
        "Sap",
        "1",
      ),
    ).toBe("4");
    expect(
      pressLineCaster(
        "[KICK]   4(ORogue) interrupted 2(AMage)'s Arcane Surge",
        "Arcane Surge",
        "1",
      ),
    ).toBe("2");
    expect(
      pressLineCaster(
        "[YOU] [PRESS]   Gladiator's Badge (60s cd)",
        "Gladiator's Badge",
        "1",
      ),
    ).toBe("1");
    expect(
      pressLineCaster(
        "[TEAM] [CD]   2(AMage) (Arcane Mage): Mass Invisibility",
        "Mass Invisibility",
        "1",
      ),
    ).toBe("2");
  });
  it("a press tag naming the spell for that caster states it; another caster's or a damage line does not", () => {
    const team = "[TEAM] [CD]   2(AMage) (Arcane Mage): Mirror Image";
    expect(lineStatesPress(team, "Mirror Image", "2", "1")).toBe(true);
    expect(lineStatesPress(team, "Mirror Image", "3", "1")).toBe(false);
    expect(
      lineStatesPress(
        "[STATE]   friends 2(AMage):90 Mirror Image",
        "Mirror Image",
        "2",
        "1",
      ),
    ).toBe(false);
    expect(
      lineStatesPress(
        "[PRESS]   4(ORogue) (Outlaw Rogue): Sprint (60s cd)",
        "Sprint",
        "4",
        "1",
      ),
    ).toBe(true);
  });
});

describe("a reset between two presses keeps both (Ace Up Your Sleeve, GH #176)", () => {
  const PID = "player-1";
  const T0 = 1_000_000;
  const energize = (spellId: string, atMs: number) => ({
    logLine: {
      event: LogEvent.SPELL_ENERGIZE,
      timestamp: T0 + atMs,
      parameters: [],
    },
    timestamp: T0 + atMs,
    spellId,
    srcUnitId: PID,
    destUnitId: PID,
  });
  const rogue = (actionOut: any[]) =>
    makeUnit(PID, {
      class: CombatUnitClass.Rogue,
      spec: CombatUnitSpec.Rogue_Outlaw,
      // Ace Up Your Sleeve: node 90668
      info: { talents: [{ id1: 90668, id2: 0, count: 2 }], pvpTalents: [] },
      spellCastEvents: [
        makeSpellCastEvent("315341", T0 + 20_000, "e"),
        makeSpellCastEvent("315341", T0 + 20_800, "e"),
      ],
      actionOut,
    });
  const combatOf = (u: any) =>
    ({
      startTime: T0,
      endTime: T0 + 120_000,
      units: { [PID]: u },
    }) as unknown as AtomicArenaCombat;

  it("the proc's energize on the first press: both presses count, the first is ready again at once", () => {
    const u = rogue([energize("394120", 20_000)]);
    const entry = unitCooldownEntry(u, combatOf(u), "315341")!;
    expect(entry.casts.map((c) => c.timeSeconds)).toEqual([20, 20.8]);
    const presses = extractOffListPresses([u], combatOf(u), T0 + 120_000);
    expect(presses.map((p) => [p.timeSeconds, p.readyAgainAtSeconds])).toEqual([
      [20, 20],
      [20.8, 65.8],
    ]);
  });
  it("no proc: the two rows 0.8 s apart are one press", () => {
    const u = rogue([]);
    const entry = unitCooldownEntry(u, combatOf(u), "315341")!;
    expect(entry.casts.map((c) => c.timeSeconds)).toEqual([20]);
  });
});

describe("two Gladiator's Badges — two items, a cooldown each (GH #176)", () => {
  const PID = "player-2";
  const T0 = 2_000_000;
  const badges = trinketItemIds.badgeItemIds;
  const eq = (slot12: string, slot13: string) =>
    Array.from({ length: 16 }, (_, i) => ({
      id: i === 12 ? slot12 : i === 13 ? slot13 : "0",
      ilvl: 0,
      enchants: [],
      bonuses: [],
      gems: [],
    }));
  const unit = (equipment: any[], pressS: number[]) =>
    makeUnit(PID, {
      class: CombatUnitClass.Paladin,
      spec: CombatUnitSpec.Paladin_Retribution,
      info: { talents: [], pvpTalents: [], equipment },
      spellCastEvents: pressS.map((s) =>
        makeSpellCastEvent(GLADIATOR_BADGE_SPELL_ID, T0 + s * 1000, ""),
      ),
    } as any);
  const combatOf = (u: any) =>
    ({
      startTime: T0,
      endTime: T0 + 300_000,
      units: { [PID]: u },
    }) as unknown as AtomicArenaCombat;

  it("reads the badges off the trinket slots", () => {
    expect(equippedBadgeCount(unit(eq(badges[0]!, badges[1]!), []))).toBe(2);
    expect(equippedBadgeCount(unit(eq(badges[0]!, "1"), []))).toBe(1);
    expect(equippedBadgeCount(unit([], []))).toBe(0);
  });

  it("alternating presses 30 s apart: each back when either badge is", () => {
    const u = unit(eq(badges[0]!, badges[1]!), [10, 40, 75]);
    const presses = extractOffListPresses([u], combatOf(u), T0 + 300_000);
    expect(
      presses.map((p) => [p.timeSeconds, p.readyAgainAtSeconds, p.equipped]),
    ).toEqual([
      [10, 10, 2], // the other badge in hand
      [40, 70, 2], // both out: the first is back at 70
      [75, 100, 2], // took the first (back at 70); the second back at 100
    ]);
  });

  it("one badge: the plain 60 s", () => {
    const u = unit(eq(badges[0]!, "1"), [10, 75]);
    const presses = extractOffListPresses([u], combatOf(u), T0 + 300_000);
    expect(presses.map((p) => [p.readyAgainAtSeconds, p.equipped])).toEqual([
      [70, undefined],
      [135, undefined],
    ]);
  });
});

describe("[PRESS] lasts — an effect that is a series of auras (pipeline T40)", () => {
  const T = 1_000_000;
  const { SPELL_AURA_APPLIED: APPLIED } = LogEvent;

  it("Chimaeral Sting: Scorpid → Spider → Viper, 3 + 3 + 3 s on the first venom's row", () => {
    const cast = makeSpellCastEvent("356719", T, "foe", "Foe", "hun", "Hun");
    const hun = makeUnit("hun", { spellCastEvents: [cast] });
    const row = makeAuraEvent(
      APPLIED,
      "356723",
      T + 150,
      "hun",
      "foe",
      "DEBUFF",
    );
    const foe = makeUnit("foe", { auraEvents: [row] });
    const d = pressDuration(hun, cast as any, [hun, foe], hun.spellCastEvents);
    expect(d?.row).toBe(row);
    expect(d?.durationSeconds).toBe(9);
  });

  it("Aspect of the Cheetah: 3 s, then its second phase's 9 s", () => {
    const cast = makeSpellCastEvent("186257", T, "hun", "Hun", "hun", "Hun");
    const hun = makeUnit("hun", {
      spellCastEvents: [cast],
      auraEvents: [makeAuraEvent(APPLIED, "186257", T, "hun", "hun", "BUFF")],
    });
    expect(
      pressDuration(hun, cast as any, [hun], hun.spellCastEvents)
        ?.durationSeconds,
    ).toBe(12);
  });
});

describe("[PRESS] lasts — a series' follow-ups at their own reading (codex 85-tk-G-T40-1)", () => {
  const T = 1_000_000;
  const { SPELL_AURA_APPLIED: APPLIED, SPELL_AURA_REMOVED: REMOVED } = LogEvent;
  const ROAR = "406971";

  it("#1 Aspect of the Fox: the second phase runs 13 s for its holder, 9 s without", () => {
    const cast = makeSpellCastEvent("186257", T, "hun", "Hun", "hun", "Hun");
    const hunter = (pvpTalents: string[]) =>
      makeUnit("hun", {
        spec: CombatUnitSpec.Hunter_Marksmanship,
        info: { talents: [], pvpTalents } as any,
        spellCastEvents: [cast],
        auraEvents: [makeAuraEvent(APPLIED, "186257", T, "hun", "hun", "BUFF")],
      });
    const lasts = (u: ReturnType<typeof hunter>) =>
      pressDuration(u, cast as any, [u], u.spellCastEvents)?.durationSeconds;
    expect(lasts(hunter(["1219162"]))).toBe(16);
    expect(lasts(hunter([]))).toBe(12);
  });

  it("#2 a Roar still up when Spider Venom lands and gone before Viper: 3.9 + 3.9 + 3", () => {
    const cast = makeSpellCastEvent("356719", T, "foe", "Foe", "hun", "Hun");
    const hun = makeUnit("hun", { spellCastEvents: [cast] });
    const venom = (id: string, event: string, ms: number) =>
      makeAuraEvent(event as never, id, T + ms, "hun", "foe", "DEBUFF");
    const head = venom("356723", APPLIED, 150);
    const spider = venom("356727", APPLIED, 4050);
    const viper = venom("356730", APPLIED, 7950);
    const foe = makeUnit("foe", {
      auraEvents: [
        makeAuraEvent(APPLIED, ROAR, T - 1000, "evo", "foe", "DEBUFF"),
        head,
        venom("356723", REMOVED, 4050),
        spider,
        makeAuraEvent(REMOVED, ROAR, T + 5000, "evo", "foe", "DEBUFF"),
        venom("356727", REMOVED, 7950),
        viper,
      ],
    });
    const d = pressDuration(hun, cast as any, [hun, foe], hun.spellCastEvents);
    expect(d?.followUps.map((f) => f.applied)).toEqual([spider, viper]);
    expect(d?.durationSeconds).toBeCloseTo(3.9 + 3.9 + 3, 5);
  });

  it("#2 a follow-up the log does not show runs its plain length, and none after it has a row", () => {
    const cast = makeSpellCastEvent("356719", T, "foe", "Foe", "hun", "Hun");
    const hun = makeUnit("hun", { spellCastEvents: [cast] });
    const head = makeAuraEvent(APPLIED, "356723", T, "hun", "foe", "DEBUFF");
    // a Viper Venom of another hunter is not this series'
    const stray = makeAuraEvent(
      APPLIED,
      "356730",
      T + 500,
      "hun2",
      "foe",
      "DEBUFF",
    );
    const foe = makeUnit("foe", { auraEvents: [head, stray] });
    expect(pressChainFollowUps(hun, foe, head as never)).toEqual([
      { spellId: "356727", source: hun },
      { spellId: "356730", source: hun },
    ]);
    expect(
      pressDuration(hun, cast as any, [hun, foe], hun.spellCastEvents)
        ?.durationSeconds,
    ).toBe(9);
  });

  it("#3 the ally's copy heads a series too: its second phase is the ally's own aura", () => {
    const cast = makeSpellCastEvent("186257", T, "hun", "Hun", "hun", "Hun");
    const hun = makeUnit("hun", {
      spec: CombatUnitSpec.Hunter_Marksmanship,
      info: { talents: [], pvpTalents: ["1219162"] } as any,
      spellCastEvents: [cast],
      // the hunter's own row, logged 2 ms ahead of the cast row
      auraEvents: [
        makeAuraEvent(APPLIED, "186257", T - 2, "hun", "hun", "BUFF"),
      ],
    });
    const head = makeAuraEvent(APPLIED, "356781", T, "hun", "ally", "BUFF");
    const second = makeAuraEvent(
      APPLIED,
      "186258",
      T + 3000,
      "ally",
      "ally",
      "BUFF",
    );
    const ally = makeUnit("ally", {
      auraEvents: [
        head,
        makeAuraEvent(REMOVED, "356781", T + 3000, "hun", "ally", "BUFF"),
        second,
      ],
    });
    const d = pressDuration(hun, cast as any, [hun, ally], hun.spellCastEvents);
    expect(d?.row).toBe(head);
    expect(d?.followUps).toEqual([
      { spellId: "186258", source: ally, applied: second },
    ]);
    // the ally holds no Aspect of the Fox: 3 + 9
    expect(d?.durationSeconds).toBe(12);
  });
});

describe("[PRESS] lasts — a series' rows are its own (codex 85-tk-G-T40-1b)", () => {
  const T = 1_000_000;
  const { SPELL_AURA_APPLIED: APPLIED, SPELL_AURA_REMOVED: REMOVED } = LogEvent;
  const TIME_STOP = "378441";

  it("#1 a Time Stop in the second phase holds that phase", () => {
    const cast = makeSpellCastEvent("186257", T, "hun", "Hun", "hun", "Hun");
    const self = (event: string, id: string, ms: number, src = "hun") =>
      makeAuraEvent(event as never, id, T + ms, src, "hun", "BUFF");
    const hun = makeUnit("hun", {
      spellCastEvents: [cast],
      auraEvents: [
        self(APPLIED, "186257", 0),
        self(REMOVED, "186257", 3000),
        self(APPLIED, "186258", 3000),
        self(APPLIED, TIME_STOP, 5000, "evo"),
        self(REMOVED, TIME_STOP, 10000, "evo"),
      ],
    });
    expect(
      pressDuration(hun, cast as any, [hun], hun.spellCastEvents)
        ?.durationSeconds,
    ).toBe(3 + 9 + 5);
    // …one of the round's own. The round over at 4 s, that Time Stop is a
    // row of what came after: it holds nothing of this press (codex
    // 85-tk-G-T40-1c #1: `lasts 12s` became 17s)
    expect(
      pressDuration(hun, cast as any, [hun], hun.spellCastEvents, T + 4000)
        ?.durationSeconds,
    ).toBe(3 + 9);
  });

  it("#2 a follow-up row after the round's end is not read", () => {
    const ROAR = "372048";
    const cast = makeSpellCastEvent("356719", T, "foe", "Foe", "hun", "Hun");
    const hun = makeUnit("hun", { spellCastEvents: [cast] });
    const venom = (id: string, event: string, ms: number) =>
      makeAuraEvent(event as never, id, T + ms, "hun", "foe", "DEBUFF");
    const foe = makeUnit("foe", {
      auraEvents: [
        venom("356723", APPLIED, 0),
        makeAuraEvent(APPLIED, ROAR, T + 2000, "evo", "foe", "DEBUFF"),
        venom("356723", REMOVED, 3000),
        venom("356727", APPLIED, 3000),
      ],
    });
    const at = (roundEnd?: number) =>
      pressDuration(
        hun,
        cast as any,
        [hun, foe],
        hun.spellCastEvents,
        roundEnd,
      );
    // read: Spider Venom landed under the Roar, 3 + 3.9 + 3
    expect(at()?.durationSeconds).toBeCloseTo(9.9, 5);
    expect(at(T + 3000)?.durationSeconds).toBeCloseTo(9.9, 5);
    // the round ended at 1 s: the rows after it are not this round's
    expect(at(T + 1000)?.followUps.some((f) => f.applied)).toBe(false);
    expect(at(T + 1000)?.durationSeconds).toBe(9);
  });

  it("#3 a second phase the holder got from its own later press is not this copy's", () => {
    const cast = makeSpellCastEvent("186257", T, "hunA", "A", "hunA", "A");
    const hunA = makeUnit("hunA", {
      spellCastEvents: [cast],
      auraEvents: [
        makeAuraEvent(APPLIED, "186257", T - 2, "hunA", "hunA", "BUFF"),
      ],
    });
    const head = makeAuraEvent(APPLIED, "356781", T, "hunA", "hunB", "BUFF");
    const own = (event: string, id: string, ms: number) =>
      makeAuraEvent(event as never, id, T + ms, "hunB", "hunB", "BUFF");
    const hunB = makeUnit("hunB", {
      auraEvents: [
        head,
        // the copy ends with no second phase
        makeAuraEvent(REMOVED, "356781", T + 1000, "hunA", "hunB", "BUFF"),
        // B's own Cheetah 30 s later
        own(APPLIED, "186257", 30000),
        own(REMOVED, "186257", 33000),
        own(APPLIED, "186258", 33000),
        own(REMOVED, "186258", 42000),
      ],
    });
    expect(pressChainFollowUps(hunA, hunB, head as never)).toEqual([
      { spellId: "186258", source: hunB },
    ]);
  });

  it("an aura applied again before it ends hands nothing over; an older instance's REMOVED in the row's millisecond is not its end", () => {
    const hun = makeUnit("hun", {});
    const venom = (id: string, event: string, ms: number) =>
      makeAuraEvent(event as never, id, T + ms, "hun", "foe", "DEBUFF");
    const head = venom("356723", APPLIED, 0);
    const again = makeUnit("foe", {
      auraEvents: [
        head,
        venom("356723", APPLIED, 60000),
        venom("356723", REMOVED, 63000),
        venom("356727", APPLIED, 63000),
      ],
    });
    expect(
      pressChainFollowUps(hun, again, head as never).some((f) => f.applied),
    ).toBe(false);
    const spider = venom("356727", APPLIED, 3000);
    const viper = venom("356730", APPLIED, 6000);
    const sameMs = makeUnit("foe", {
      auraEvents: [
        head,
        venom("356723", REMOVED, 3000),
        // the Spider Venom of an earlier press leaves in this millisecond
        venom("356727", REMOVED, 3000),
        spider,
        venom("356727", REMOVED, 6000),
        viper,
      ],
    });
    expect(
      pressChainFollowUps(hun, sameMs, head as never).map((f) => f.applied),
    ).toEqual([spider, viper]);
  });
});

describe("[PRESS] lasts — which aura it reads (GH #179)", () => {
  // Holy Bulwark: the cast 432459 arms its target and its caster with 432496
  const CAST = "432459";
  const AURA = "432496";
  const T = 1_000_000;
  const { SPELL_AURA_APPLIED: APPLIED, SPELL_AURA_REFRESH: REFRESH } = LogEvent;
  const setup = (targetRows: any[], casterExtra: any[] = []) => {
    const cast = makeSpellCastEvent(CAST, T, "ally", "Ally", "pal", "Pal");
    const pal = makeUnit("pal", {
      spellCastEvents: [cast, ...casterExtra],
      auraEvents: [makeAuraEvent(APPLIED, AURA, T, "pal", "pal", "BUFF")],
    });
    const ally = makeUnit("ally", { auraEvents: targetRows });
    return { cast, pal, ally };
  };

  it("the target's copy, landing 1.5 s after the cast, before the caster's own", () => {
    const row = makeAuraEvent(APPLIED, AURA, T + 1500, "pal", "ally", "BUFF");
    const { cast, pal, ally } = setup([row]);
    const d = pressDuration(pal, cast as any, [pal, ally], pal.spellCastEvents);
    expect(d?.unit.id).toBe("ally");
    expect(d?.row).toBe(row);
    expect(d?.durationSeconds).toBe(20);
    expect(PRESS_TARGET_AURA_LEAD_MS).toBe(4000);
  });

  it("not past the caster's next press of the spell: then the caster's copy", () => {
    const row = makeAuraEvent(APPLIED, AURA, T + 1500, "pal", "ally", "BUFF");
    const next = makeSpellCastEvent(CAST, T + 1200, "x", "X", "pal", "Pal");
    const { cast, pal, ally } = setup([row], [next]);
    const d = pressDuration(pal, cast as any, [pal, ally], pal.spellCastEvents);
    expect(d?.unit.id).toBe("pal");
  });

  it("a second copy in the same millisecond (APPLIED then REFRESH): no lasts", () => {
    const rows = [
      makeAuraEvent(APPLIED, AURA, T + 300, "pal", "ally", "BUFF"),
      makeAuraEvent(REFRESH, AURA, T + 300, "pal", "ally", "BUFF"),
    ];
    const { cast, pal, ally } = setup(rows);
    expect(
      pressDuration(pal, cast as any, [pal, ally], pal.spellCastEvents),
    ).toBeUndefined();
  });
});

describe("[PRESS] lasts — a row the log wrote ahead of the cast row (GH #179 3d)", () => {
  const T = 1_000_000;
  const { SPELL_AURA_APPLIED: APPLIED, SPELL_AURA_REFRESH: REFRESH } = LogEvent;

  it("no row at or after the press: the one 1 ms ahead is its own", () => {
    const cast = makeSpellCastEvent(
      GLADIATOR_BADGE_SPELL_ID,
      T,
      "",
      "",
      "r",
      "R",
    );
    const ret = makeUnit("r", {
      spellCastEvents: [cast],
      auraEvents: [
        makeAuraEvent(
          APPLIED,
          GLADIATOR_BADGE_SPELL_ID,
          T - 1,
          "r",
          "r",
          "BUFF",
        ),
      ],
    });
    expect(
      pressDuration(ret, cast as any, [ret], ret.spellCastEvents)
        ?.durationSeconds,
    ).toBe(15);
  });

  it("past the lead (151 ms ahead) it is not", () => {
    const cast = makeSpellCastEvent(
      GLADIATOR_BADGE_SPELL_ID,
      T,
      "",
      "",
      "r",
      "R",
    );
    const ret = makeUnit("r", {
      spellCastEvents: [cast],
      auraEvents: [
        makeAuraEvent(
          APPLIED,
          GLADIATOR_BADGE_SPELL_ID,
          T - 151,
          "r",
          "r",
          "BUFF",
        ),
      ],
    });
    expect(
      pressDuration(ret, cast as any, [ret], ret.spellCastEvents),
    ).toBeUndefined();
  });

  it("a row at the press elsewhere wins over one ahead on the target (Holy Armament's self REFRESH 1 ms ahead)", () => {
    const cast = makeSpellCastEvent("432459", T, "pal", "Pal", "pal", "Pal");
    const pal = makeUnit("pal", {
      spellCastEvents: [cast],
      auraEvents: [
        makeAuraEvent(REFRESH, "432496", T - 1, "pal", "pal", "BUFF"),
      ],
    });
    const ally = makeUnit("ally", {
      auraEvents: [makeAuraEvent(APPLIED, "432496", T, "pal", "ally", "BUFF")],
    });
    const d = pressDuration(pal, cast as any, [pal, ally], pal.spellCastEvents);
    expect(d?.unit.id).toBe("ally");
    expect(d?.durationSeconds).toBe(20);
  });

  it("ahead of the press, the first row of that millisecond: Holy Bulwark's 432496, not its re-laid shield 432607", () => {
    const cast = makeSpellCastEvent("432459", T, "ally", "Ally", "pal", "Pal");
    const pal = makeUnit("pal", {
      spellCastEvents: [cast],
      auraEvents: [
        makeAuraEvent(APPLIED, "432496", T - 1, "pal", "pal", "BUFF"),
        makeAuraEvent(APPLIED, "432607", T - 1, "pal", "pal", "BUFF"),
      ],
    });
    const ally = makeUnit("ally", { auraEvents: [] });
    expect(
      pressDuration(pal, cast as any, [pal, ally], pal.spellCastEvents)?.row
        .spellId,
    ).toBe("432496");
  });

  it("extensions stay bounded by the row: a Lightning Bolt between Spiritwalker's Grace's row and its SUCCESS adds its 1 s (codex 20-179d #1)", () => {
    const cast = makeSpellCastEvent("79206", T, "", "", "sh", "Sh");
    const sh = makeUnit("sh", {
      spec: CombatUnitSpec.Shaman_Elemental,
      spellCastEvents: [
        // the talent's own cast is the ownership evidence without a loadout
        makeSpellCastEvent("443425", T - 100_000, "", "", "sh", "Sh"),
        makeSpellCastEvent("188196", T - 50, "", "", "sh", "Sh"),
        cast,
      ],
      auraEvents: [
        makeAuraEvent(APPLIED, "79206", T - 100, "sh", "sh", "BUFF"),
      ],
    });
    (sh as any).info = { talents: [], pvpTalents: [] };
    expect(
      pressDuration(sh, cast as any, [sh], sh.spellCastEvents)?.durationSeconds,
    ).toBe(16);
  });

  it("priced at the press: a Tip the Scales Dream Breath's HoT 1 ms ahead is level 3's 8 s, not DB2's 2 s", () => {
    const cast = makeSpellCastEvent("355936", T, "", "", "ev", "Ev");
    const ev = makeUnit("ev", {
      spellCastEvents: [cast],
      auraEvents: [makeAuraEvent(APPLIED, "355941", T - 1, "ev", "ev", "BUFF")],
    });
    (ev as any).empowerEnds = [];
    const d = pressDuration(ev, cast as any, [ev], ev.spellCastEvents);
    expect(d?.row.spellId).toBe("355941");
    expect(d?.durationSeconds).toBe(8);
  });
});

describe("[PRESS] lasts — a Timewalker floor (user ruling 2026-11-05)", () => {
  const SP = "406732"; // Spatial Paradox
  const T = 1_000_000;
  const press = (spec: CombatUnitSpec) => {
    const cast = makeSpellCastEvent(SP, T, "ev", "Ev", "ev", "Ev");
    const ev = makeUnit("ev", {
      spec,
      spellCastEvents: [cast],
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, SP, T, "ev", "ev", "BUFF"),
      ],
    });
    return pressDuration(ev, cast as any, [ev], ev.spellCastEvents);
  };

  it("an Augmentation evoker's copy is a floor, the number stays the official one", () => {
    const d = press(CombatUnitSpec.Evoker_Augmentation);
    expect(d?.durationSeconds).toBe(10);
    expect(d?.floor).toBe(true);
  });

  it("another spec's is not", () => {
    expect(press(CombatUnitSpec.Evoker_Preservation)?.floor).toBe(false);
  });
});

// GH #179 (2026-11-05): what the game did to one application
describe("[PRESS] lasts — re-stated rows, Oppressing Roar, Time Stop (GH #179)", () => {
  const T = 1_000_000;
  const { SPELL_AURA_APPLIED: APPLIED, SPELL_AURA_REMOVED: REMOVED } = LogEvent;

  it("a target row inside a re-state batch is skipped: the caster's own copy prints", () => {
    const cast = makeSpellCastEvent("432459", T, "ally", "Ally", "pal", "Pal");
    const pal = makeUnit("pal", {
      spellCastEvents: [cast],
      auraEvents: [makeAuraEvent(APPLIED, "432496", T, "pal", "pal", "BUFF")],
    });
    // the target vanished; 2.09 s later the log re-states six of its auras
    const at = T + 2090;
    const restate = ["1", "2", "3", "4", "5"].map((id) =>
      makeAuraEvent(APPLIED, id, at, "x", "ally", "BUFF"),
    );
    const own = makeAuraEvent(APPLIED, "432496", at, "pal", "ally", "BUFF");
    const ally = makeUnit("ally", { auraEvents: [...restate, own] });
    const d = pressDuration(pal, cast as any, [pal, ally], pal.spellCastEvents);
    expect(d?.unit.id).toBe("pal");
    // one APPLIED short of a batch: the target's row is the press's
    const ally5 = makeUnit("ally", {
      auraEvents: [...restate.slice(1), own],
    });
    expect(
      pressDuration(pal, cast as any, [pal, ally5], pal.spellCastEvents)?.unit
        .id,
    ).toBe("ally");
  });

  it("after a re-stated row, the same aura on another unit — logged ahead of the cast row too", () => {
    const cast = makeSpellCastEvent("432459", T, "ally", "Ally", "pal", "Pal");
    // the caster's own copy 1 ms before the SUCCESS, beside the shield
    // 432607 the bulwark re-lays (in the press's millisecond)
    const pal = makeUnit("pal", {
      spellCastEvents: [cast],
      auraEvents: [
        makeAuraEvent(APPLIED, "432496", T - 1, "pal", "pal", "BUFF"),
        makeAuraEvent(APPLIED, "432607", T, "pal", "pal", "BUFF"),
      ],
    });
    const at = T + 1760;
    const ally = makeUnit("ally", {
      auraEvents: [
        ...["1", "2", "3", "4", "5"].map((id) =>
          makeAuraEvent(APPLIED, id, at, "x", "ally", "BUFF"),
        ),
        makeAuraEvent(APPLIED, "432496", at, "pal", "ally", "BUFF"),
      ],
    });
    const d = pressDuration(pal, cast as any, [pal, ally], pal.spellCastEvents);
    expect(d?.unit.id).toBe("pal");
    expect(d?.row.spellId).toBe("432496");
    // the caster's copy missing: no other aura of the press stands in
    const palShieldOnly = makeUnit("pal", {
      spellCastEvents: [cast],
      auraEvents: [makeAuraEvent(APPLIED, "432607", T, "pal", "pal", "BUFF")],
    });
    expect(
      pressDuration(
        palShieldOnly,
        cast as any,
        [palShieldOnly, ally],
        palShieldOnly.spellCastEvents,
      ),
    ).toBeUndefined();
  });

  it("the lead never takes a previous press's row over this press's REFRESH (codex 20-179a #1)", () => {
    const cast = makeSpellCastEvent("432459", T, "ally", "Ally", "pal", "Pal");
    const pal = makeUnit("pal", {
      spellCastEvents: [cast],
      auraEvents: [
        makeAuraEvent(APPLIED, "432496", T - 100, "pal", "pal", "BUFF"),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REFRESH,
          "432496",
          T + 10,
          "pal",
          "pal",
          "BUFF",
        ),
      ],
    });
    const at = T + 2000;
    const ally = makeUnit("ally", {
      auraEvents: [
        ...["1", "2", "3", "4", "5"].map((id) =>
          makeAuraEvent(APPLIED, id, at, "x", "ally", "BUFF"),
        ),
        makeAuraEvent(APPLIED, "432496", at, "pal", "ally", "BUFF"),
      ],
    });
    expect(
      pressDuration(pal, cast as any, [pal, ally], pal.spellCastEvents),
    ).toBeUndefined();
  });

  it("an empowered press's bundle at its release is no re-state (codex 20-179a #3)", () => {
    const cast = makeSpellCastEvent("355936", T, "ally", "Ally", "ev", "Ev");
    const rel = T + 2000;
    const ev = makeUnit("ev", { spellCastEvents: [cast] });
    // makeUnit carries no empower rows
    (ev as any).empowerEnds = [
      {
        spellId: "355936",
        spellName: "Dream Breath",
        timestamp: rel,
        level: 1,
        logLine: { timestamp: rel, lineIndex: 1 },
      },
    ];
    const ally = makeUnit("ally", {
      auraEvents: [
        ...["1", "2", "3", "4", "5"].map((id) =>
          makeAuraEvent(APPLIED, id, rel, "x", "ally", "BUFF"),
        ),
        makeAuraEvent(APPLIED, "355941", rel, "ev", "ally", "BUFF"),
      ],
    });
    const d = pressDuration(ev, cast as any, [ev, ally], ev.spellCastEvents);
    expect(d?.unit.id).toBe("ally");
    expect(d?.row.spellId).toBe("355941");
  });

  it("a batch in the press's own millisecond is its bundle, not a re-state", () => {
    // Gladiator's Badge pressed beside wings and procs: six APPLIED rows on
    // the caster at the press, the badge's own among them
    const cast = makeSpellCastEvent("345228", T, "", "", "r", "R");
    const bundle = ["1", "2", "3", "4", "5"].map((id) =>
      makeAuraEvent(APPLIED, id, T, "r", "r", "BUFF"),
    );
    const badge = makeAuraEvent(APPLIED, "345228", T, "r", "r", "BUFF");
    const ret = makeUnit("r", {
      spellCastEvents: [cast],
      auraEvents: [...bundle, badge],
    });
    expect(
      pressDuration(ret, cast as any, [ret], ret.spellCastEvents)
        ?.durationSeconds,
    ).toBe(15);
  });

  it("Oppressing Roar on the target at the landing: Chimaeral Sting's slow runs 3.9 s of its series", () => {
    const sting = (roar: boolean) => {
      const cast = makeSpellCastEvent("356719", T, "e", "E", "h", "H");
      const hunter = makeUnit("h", { spellCastEvents: [cast] });
      const rows = [
        ...(roar
          ? [makeAuraEvent(APPLIED, "406971", T - 1000, "ev", "e", "DEBUFF")]
          : []),
        makeAuraEvent(APPLIED, "356723", T + 100, "h", "e", "DEBUFF"),
      ];
      const enemy = makeUnit("e", { auraEvents: rows });
      return pressDuration(
        hunter,
        cast as any,
        [hunter, enemy],
        hunter.spellCastEvents,
      )?.durationSeconds;
    };
    // the whole series since pipeline T40: 3 + 3 + 3
    expect(sting(false)).toBe(9);
    // the roar is read on the first venom's row: 3.9 + 3 + 3
    expect(sting(true)).toBeCloseTo(9.9, 5);
  });

  it("a Time Stop on the holder holds the aura for its own length", () => {
    const u = (spans: Array<[number, number]>) =>
      makeUnit("u", {
        auraEvents: spans.flatMap(([a, b]) => [
          makeAuraEvent(APPLIED, "378441", T + a * 1000, "u", "u", "BUFF"),
          makeAuraEvent(REMOVED, "378441", T + b * 1000, "u", "u", "BUFF"),
        ]),
      });
    // a 15 s badge: Time Stop from 14.9 s for 5 s → 20 s
    expect(timeStopHeldSeconds(u([[14.9, 19.9]]), T, 15)).toBeCloseTo(5, 5);
    // one starting at the (held) end or before the aura: nothing
    expect(timeStopHeldSeconds(u([[15, 20]]), T, 15)).toBe(0);
    expect(timeStopHeldSeconds(u([[-1, 4]]), T, 15)).toBe(0);
    // the second one starts inside the time the first one added
    expect(
      timeStopHeldSeconds(
        u([
          [14, 19],
          [19.5, 21],
        ]),
        T,
        15,
      ),
    ).toBeCloseTo(6.5, 5);
    // another unit's Time Stop holds nothing here
    const other = makeUnit("u", {
      auraEvents: [
        makeAuraEvent(APPLIED, "378441", T + 1000, "v", "v", "BUFF"),
        makeAuraEvent(REMOVED, "378441", T + 6000, "v", "v", "BUFF"),
      ],
    });
    expect(timeStopHeldSeconds(other, T, 15)).toBe(0);
  });

  it("a Time Stop after the aura's own REMOVED holds nothing", () => {
    // Time Spiral: 10 s press, its aura consumed 1.1 s in, Time Stop 3.2 s in
    const rows = [
      makeAuraEvent(APPLIED, "375234", T, "u", "u", "BUFF"),
      makeAuraEvent(REMOVED, "375234", T + 1100, "u", "u", "BUFF"),
      makeAuraEvent(APPLIED, "378441", T + 3200, "u", "u", "BUFF"),
      makeAuraEvent(REMOVED, "378441", T + 8200, "u", "u", "BUFF"),
    ];
    const u = makeUnit("u", { auraEvents: rows });
    const aura = { spellId: "375234", srcUnitId: "u" };
    expect(timeStopHeldSeconds(u, T, 10, aura)).toBe(0);
    // still up at the Time Stop: held
    const up = makeUnit("u", {
      auraEvents: [rows[0]!, rows[2]!, rows[3]!],
    });
    expect(timeStopHeldSeconds(up, T, 10, aura)).toBeCloseTo(5, 5);
    // consumed in its own millisecond, logged after the aura's row (#4)
    const applied = {
      ...rows[0]!,
      logLine: { ...rows[0]!.logLine, lineIndex: 10 },
    };
    const gone = {
      ...rows[1]!,
      logLine: { ...rows[1]!.logLine, timestamp: T, lineIndex: 11 },
    };
    const sameMs = makeUnit("u", {
      auraEvents: [applied, gone, rows[2]!, rows[3]!] as any,
    });
    expect(timeStopHeldSeconds(sameMs, T, 10, applied)).toBe(0);
  });

  it("Time Stop rows pair per caster (codex 20-179a #2)", () => {
    // A's Time Stop never closes; B's REMOVED has no APPLIED
    const u = makeUnit("u", {
      auraEvents: [
        makeAuraEvent(APPLIED, "378441", T + 1000, "a", "u", "BUFF"),
        makeAuraEvent(REMOVED, "378441", T + 35_000, "b", "u", "BUFF"),
      ],
    });
    expect(timeStopHeldSeconds(u, T, 15)).toBe(0);
  });
});

describe("[PRESS] lasts — Prismatic Barrier shortens a harmful Magic effect only (GH #126)", () => {
  const T = 1_000_000;
  it("the barrier's own buff keeps its length under itself (codex 20-cat4A-01 #1: it read 60 → 51)", () => {
    const cast = makeSpellCastEvent(
      "235450",
      T,
      "mage",
      "Mage",
      "mage",
      "Mage",
    );
    const mage = makeUnit("mage", {
      spellCastEvents: [cast],
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "235450",
          T,
          "mage",
          "mage",
          "BUFF",
        ),
      ],
    });
    const d = pressDuration(mage, cast as any, [mage], mage.spellCastEvents);
    expect(d?.durationSeconds).toBe(60);
  });
});

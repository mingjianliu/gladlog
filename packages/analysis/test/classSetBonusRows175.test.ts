/** GH #175 rows 2–17 (pipeline T35): the 12.1 class set bonuses that move a
 * duration or a cooldown the analysis reads, priced for a holder of the
 * pieces in the bonus's spec and for nobody else. */
import { CombatUnitSpec, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  CLASS_SET_ITEM_IDS,
  classSetPiecesOf,
  SET_BONUS_COOLDOWN_ROWS,
  SET_BONUS_DURATION_ROWS,
  setBonusCooldownReductionSeconds,
} from "../src/data/classSetBonuses";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  EVENT_COOLDOWN_REDUCTIONS,
  eventTriggersFor,
} from "../src/data/talentScriptedCooldowns";
import { buffFullDurationForCaster } from "../src/utils/buffDuration";
import { unitCooldownOf } from "../src/utils/cooldowns";
import { makeSpellCastEvent } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const gear = (setId: string, pieces: number) => [
  ...CLASS_SET_ITEM_IDS[setId]!.slice(0, pieces).map((id) => ({ id })),
  { id: "1" },
];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const unit = (spec: string, setId: string, pieces: number): any => ({
  id: "u",
  spec,
  info: { talents: [], pvpTalents: [], equipment: gear(setId, pieces) },
  spellCastEvents: [],
  auraEvents: [],
  damageOut: [],
  missesOut: [],
});

describe("the thirteen 12.1 class sets", () => {
  it("every class set is five items, read off the gear", () => {
    expect(Object.keys(CLASS_SET_ITEM_IDS).sort()).toEqual(
      Array.from({ length: 13 }, (_, i) => String(2055 + i)),
    );
    for (const items of Object.values(CLASS_SET_ITEM_IDS))
      expect(new Set(items).size).toBe(5);
    expect(
      classSetPiecesOf(unit(CombatUnitSpec.Warrior_Protection, "2067", 4)),
    ).toEqual({ "2067": 4 });
    expect(
      classSetPiecesOf(unit(CombatUnitSpec.Warrior_Protection, "2067", 0)),
    ).toEqual({});
  });
});

describe("cooldown rows (Protection 4pc Ravager, Augmentation 2pc Upheaval, Shadow 2pc Tentacle Slam)", () => {
  it("the rows are the bonus spells' DB2 numbers × PvpMultiplier", () => {
    expect(SET_BONUS_COOLDOWN_ROWS["228920"]).toEqual([
      expect.objectContaining({
        bonusSpellId: "1296648",
        itemSetId: "2067",
        pieces: 4,
        specs: ["73"],
        reduceSeconds: 15, // −30000 ms × 0.5
      }),
    ]);
    expect(SET_BONUS_COOLDOWN_ROWS["396286"]).toEqual([
      expect.objectContaining({
        bonusSpellId: "1296637",
        itemSetId: "2058",
        pieces: 2,
        specs: ["1473"],
        reduceSeconds: 5, // −10000 ms × 0.5
      }),
    ]);
    expect(SET_BONUS_COOLDOWN_ROWS["1227280"]).toEqual([
      expect.objectContaining({
        bonusSpellId: "1296579",
        itemSetId: "2063",
        pieces: 2,
        specs: ["258"],
        reduceSeconds: 3, // −3000 ms × 1
      }),
    ]);
  });

  it("Ravager: a Protection holder of 4 pieces 75 s; 3 pieces, or the set in Arms hands, 90 s", () => {
    const cd = (spec: string, pieces: number) =>
      unitCooldownOf(unit(spec, "2067", pieces), "228920")?.cooldownSeconds;
    expect(cd(CombatUnitSpec.Warrior_Protection, 4)).toBe(75);
    expect(cd(CombatUnitSpec.Warrior_Protection, 5)).toBe(75);
    expect(cd(CombatUnitSpec.Warrior_Protection, 3)).toBe(90);
    expect(cd(CombatUnitSpec.Warrior_Arms, 4)).toBe(90);
  });

  it("Upheaval 40 → 35 s and Tentacle Slam 15 → 12 s at 2 pieces", () => {
    expect(
      unitCooldownOf(
        unit(CombatUnitSpec.Evoker_Augmentation, "2058", 2),
        "396286",
      )?.cooldownSeconds,
    ).toBe(35);
    expect(
      unitCooldownOf(
        unit(CombatUnitSpec.Evoker_Augmentation, "2058", 1),
        "396286",
      )?.cooldownSeconds,
    ).toBe(40);
    expect(
      unitCooldownOf(unit(CombatUnitSpec.Priest_Shadow, "2063", 2), "1227280")
        ?.cooldownSeconds,
    ).toBe(12);
    expect(
      unitCooldownOf(
        unit(CombatUnitSpec.Priest_Discipline, "2063", 4),
        "1227280",
      )?.cooldownSeconds,
    ).toBe(15);
  });

  it("the gear reading and the ledger's owner reading agree", () => {
    const u = unit(CombatUnitSpec.Warrior_Protection, "2067", 4);
    expect(setBonusCooldownReductionSeconds("228920", u)).toBe(15);
    expect(
      setBonusCooldownReductionSeconds(
        "228920",
        unit(CombatUnitSpec.Warrior_Protection, "2067", 3),
      ),
    ).toBe(0);
  });
});

describe("duration rows (Feral 4pc Berserk, Marksmanship 2pc Explosive Shot)", () => {
  it("Feral 4pc: Berserk 15 → 20 s, like Incarnation 20 → 25 s; a Guardian wearing it is no holder", () => {
    expect(SET_BONUS_DURATION_ROWS["106951"]).toEqual([
      expect.objectContaining({
        bonusSpellId: "1296606",
        itemSetId: "2057",
        pieces: 4,
        specs: ["103"],
        addSeconds: 5,
      }),
    ]);
    const d = (aura: string, spec: string, pieces: number) =>
      buffFullDurationForCaster(aura, unit(spec, "2057", pieces), T0);
    expect(d("106951", CombatUnitSpec.Druid_Feral, 4)).toBe(20);
    expect(d("106951", CombatUnitSpec.Druid_Feral, 3)).toBe(15);
    expect(d("106951", CombatUnitSpec.Druid_Guardian, 4)).toBe(15);
    expect(d("102543", CombatUnitSpec.Druid_Feral, 4)).toBe(25);
  });

  it("Marksmanship 2pc: Explosive Shot +0.5 s (1000 ms × 0.5); a Survival wearing it is no holder", () => {
    const d = (spec: string, pieces: number) =>
      buffFullDurationForCaster("212431", unit(spec, "2059", pieces), T0);
    const base = d(CombatUnitSpec.Hunter_Marksmanship, 0)!;
    expect(d(CombatUnitSpec.Hunter_Marksmanship, 2)).toBe(base + 0.5);
    expect(d(CombatUnitSpec.Hunter_Marksmanship, 1)).toBe(base);
    expect(d(CombatUnitSpec.Hunter_Survival, 4)).toBe(
      d(CombatUnitSpec.Hunter_Survival, 0),
    );
  });
});

describe("Devastation 4pc: Causality gives back 0.05 s more per trigger", () => {
  const tick = (ms: number, dest: string) => ({
    spellId: "356995",
    destUnitId: dest,
    logLine: { event: LogEvent.SPELL_PERIODIC_DAMAGE, timestamp: T0 + ms },
  });
  const dev = (
    pieces: number,
    spec: string = CombatUnitSpec.Evoker_Devastation,
  ) => ({
    ...unit(spec, "2058", pieces),
    spellCastEvents: [makeSpellCastEvent("356995", T0 + 1_000, "enemy-1")],
    damageOut: [tick(1_800, "enemy-1"), tick(2_600, "enemy-1")],
  });
  const seconds = (u: ReturnType<typeof dev>) =>
    eventTriggersFor(u, [EVENT_COOLDOWN_REDUCTIONS["375777"]!]).map(
      (g) => Math.round(g.seconds * 1000) / 1000,
    );
  it("both Causality rows carry the bonus", () => {
    for (const k of ["375777", "375777:pyre"])
      expect(EVENT_COOLDOWN_REDUCTIONS[k]!.setBonus).toEqual({
        bonusSpellId: "1296640",
        itemSetId: "2058",
        pieces: 4,
        specs: ["1467"],
        addSeconds: 0.05,
      });
  });
  it("4 pieces 0.55 s per tick; 3 pieces, or another spec, 0.5 s", () => {
    expect(seconds(dev(4))).toEqual([0.55, 0.55]);
    expect(seconds(dev(3))).toEqual([0.5, 0.5]);
    expect(seconds(dev(4, CombatUnitSpec.Evoker_Preservation))).toEqual([
      0.5, 0.5,
    ]);
  });
});

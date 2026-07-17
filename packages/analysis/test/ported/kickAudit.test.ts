/* eslint-disable @typescript-eslint/no-explicit-any */
import { LogEvent } from "@gladlog/parser-compat";

import { analyzeKickAudit } from "../../src/utils/kickAudit";
import {
  makeInterruptEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./testHelpers";

const MATCH_START = 1_000_000;
const WIND_SHEAR = "57994"; // interrupts category

function makeCombat() {
  return { startTime: MATCH_START, endTime: MATCH_START + 120_000 } as any;
}

/** SPELL_CAST_START stub (same shape as a cast event, different log event). */
function castStart(spellId: string, timestamp: number, unitId: string): any {
  const e = makeSpellCastEvent(
    spellId,
    timestamp,
    unitId,
    unitId,
    unitId,
    unitId,
    0,
    spellId,
  );
  e.logLine.event = LogEvent.SPELL_CAST_START;
  return e;
}

const info = { teamId: "0", specId: "x" } as any;

function makeKicker(kickTs: number, destUnitId = "e1") {
  return makeUnit("p1", {
    name: "Shaman",
    info,
    spellCastEvents: [
      makeSpellCastEvent(
        WIND_SHEAR,
        kickTs,
        destUnitId,
        "Enemy",
        "p1",
        "Shaman",
        0,
        "Wind Shear",
      ),
    ],
  } as any);
}

describe("kickAudit", () => {
  it("labels a kick landed when SPELL_INTERRUPT confirms it (D1-K1)", () => {
    const kickTs = MATCH_START + 20_000;
    const player = makeKicker(kickTs);
    const enemy = makeUnit("e1", {
      name: "Enemy",
      info,
      actionIn: [
        // id 116 = Frostbolt;getEnglishSpellName 按 id 权威覆盖传入名
        makeInterruptEvent(
          WIND_SHEAR,
          "Wind Shear",
          "116",
          "Frostbolt",
          kickTs,
          "p1",
          "Shaman",
        ),
      ],
    } as any);

    const entries = analyzeKickAudit(player, [enemy], makeCombat());
    expect(entries).toHaveLength(1);
    expect(entries[0].result).toBe("landed");
    expect(entries[0].interruptedSpellName).toBe("Frostbolt");
    expect(entries[0].atSeconds).toBe(20);
  });

  it("labels a missed kick juked when the target cancelled a cast just before (D1-K2)", () => {
    const kickTs = MATCH_START + 20_000;
    const player = makeKicker(kickTs);
    // Enemy started a cast 1.5s before the kick and never completed it.
    const enemy = makeUnit("e1", {
      name: "Enemy",
      info,
      castStartEvents: [castStart("116", kickTs - 1_500, "e1")],
    } as any);

    const entries = analyzeKickAudit(player, [enemy], makeCombat());
    expect(entries[0].result).toBe("juked");
    expect(entries[0].jukedBySpellName).toBeTruthy();
  });

  it("does not call it a juke when the cast completed (D1-K3)", () => {
    const kickTs = MATCH_START + 20_000;
    const player = makeKicker(kickTs);
    const enemy = makeUnit("e1", {
      name: "Enemy",
      info,
      castStartEvents: [castStart("116", kickTs - 1_500, "e1")],
      spellCastEvents: [
        makeSpellCastEvent(
          "116",
          kickTs + 500,
          "p1",
          "Player",
          "e1",
          "Enemy",
          0,
          "116",
        ),
      ],
    } as any);

    const entries = analyzeKickAudit(player, [enemy], makeCombat());
    expect(entries[0].result).toBe("missed");
  });

  it("labels unknown when the match has no cast-start data (old archive) (D1-K4)", () => {
    const player = makeKicker(MATCH_START + 20_000);
    const enemy = makeUnit("e1", { name: "Enemy", info } as any);
    // makeUnit defaults castStartEvents to [] — simulate an old archive (field absent)
    delete (enemy as any).castStartEvents;

    const entries = analyzeKickAudit(player, [enemy], makeCombat());
    expect(entries[0].result).toBe("unknown");
  });

  it("returns nothing for a player with no interrupt casts (D1-K5)", () => {
    const player = makeUnit("p1", { name: "Shaman", info } as any);
    const enemy = makeUnit("e1", { name: "Enemy", info } as any);
    expect(analyzeKickAudit(player, [enemy], makeCombat())).toHaveLength(0);
  });
});

describe("kickAudit — DPS baseline 修复(2026-07-16)", () => {
  it("宠物执行的打断(src=宠物 id)也算 landed", () => {
    const kickTs = MATCH_START + 20_000;
    // Spell Lock 19647 若不在 interrupts 分类,用风剪代替语义:owner 施放、宠物落地
    const player = makeKicker(kickTs);
    const pet = makeUnit("pet1", { name: "Felhunter", ownerId: "p1" } as any);
    const enemy = makeUnit("e1", {
      name: "Enemy",
      info,
      actionIn: [
        makeInterruptEvent(WIND_SHEAR, "Wind Shear", "116", "Frostbolt", kickTs, "pet1", "Felhunter"),
      ],
    } as any);
    const combat = {
      startTime: MATCH_START,
      endTime: MATCH_START + 120_000,
      units: { p1: player, pet1: pet, e1: enemy },
    } as any;
    const entries = analyzeKickAudit(player, [enemy], combat);
    expect(entries[0].result).toBe("landed");
  });

  it("敌方读条被队友打断 ≠ 假读条:不判 juked", () => {
    const kickTs = MATCH_START + 20_000;
    const player = makeKicker(kickTs);
    const stTs = kickTs - 1_500;
    const enemy = makeUnit("e1", {
      name: "Enemy",
      info,
      castStartEvents: [castStart("116", stTs, "e1")],
      // 队友 f2 在读条开始后 1s 打断了它(SPELL_INTERRUPT src=f2,dest=e1)
      actionIn: [
        (() => {
          const ev = makeInterruptEvent("57994", "Wind Shear", "116", "Frostbolt", stTs + 1_000, "f2", "Teammate");
          ev.destUnitId = "e1";
          return ev;
        })(),
      ],
    } as any);
    const entries = analyzeKickAudit(player, [enemy], makeCombat());
    // 不是 juked(读条是真的,被队友踢了);player 自己的风剪落空 → missed
    expect(entries[0].result).toBe("missed");
  });
});

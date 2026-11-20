/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Pipeline T218 (round-14 D36, 3c8cd2a3 r0 2:49): a damage row's source
 * label reads the summon's kind with the unit's own SPELL_SUMMON row — a
 * Counterstrike Totem (npc 105451, in no npc table) read `4(EShaman)'s
 * guardian — Counterstrike`.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  buildSummonOwnerNames,
  damageEventLabel,
  SummonOwnerNames,
} from "../src/context/timelineHelpers";
import { ensureAnalysisData } from "../src/data/ensure";

beforeAll(async () => {
  await ensureAnalysisData();
});

const TOTEM = "Creature-0-3019-1505-1-105451-000012345A";
const ELEMENTAL = "Creature-0-3019-1505-1-61029-000012345B";
const summoned = (spellId: string, spellName: string): any => ({
  logLine: { event: LogEvent.SPELL_SUMMON },
  spellId,
  spellName,
});
const units: any[] = [
  { id: "Player-1", name: "Sham-R-US" },
  {
    id: TOTEM,
    name: "Counterstrike Totem",
    ownerId: "Player-1",
    actionIn: [summoned("204331", "Counterstrike Totem")],
  },
  {
    id: ELEMENTAL,
    name: "Fire Elemental",
    ownerId: "Player-1",
    actionIn: [summoned("198067", "Fire Elemental")],
  },
];
const enemyIds = new Map([["Sham-R-US", 4]]);
const hit = (srcUnitId: string, spellName: string): any => ({
  srcUnitId,
  srcUnitName: "x",
  srcUnitFlags: 0x2148, // guardian, hostile
  spellId: "",
  spellName,
});

describe("T218 — 伤害行的召唤物称呼读召唤行", () => {
  it("3c8cd2a3 r0: Counterstrike Totem 的伤害是 totem,不是 guardian", () => {
    const owners = buildSummonOwnerNames(units);
    expect(owners).toBeInstanceOf(SummonOwnerNames);
    expect(owners.kinds.get(TOTEM)).toBe("totem");
    expect(
      damageEventLabel(hit(TOTEM, "Counterstrike"), undefined, enemyIds, owners),
    ).toBe("4's totem — Counterstrike");
  });

  it("不是图腾法术召唤出来的单位照旧是 guardian", () => {
    const owners = buildSummonOwnerNames(units);
    expect(
      damageEventLabel(
        hit(ELEMENTAL, "Lava Burst"),
        undefined,
        enemyIds,
        owners,
      ),
    ).toBe("4's guardian — Lava Burst");
  });

  it("只有名字表、没有单位证据的普通 Map:保持按 GUID 的读法", () => {
    const bare = new Map([[TOTEM, "Sham-R-US"]]);
    expect(
      damageEventLabel(hit(TOTEM, "Counterstrike"), undefined, enemyIds, bare),
    ).toBe("4's guardian — Counterstrike");
  });
});

import { rendersOnCaster } from "@gladlog/analysis";

import { deriveCasts } from "../src/renderer/src/report/derive/casts";
import { loadMatchFixture } from "./fixtures/loadFixture";

describe("deriveCasts", () => {
  const m = loadMatchFixture();
  const anyPlayer = Object.values(m.units).find(
    (u) => u.kind === "Player" && u.casts.length > 0,
  )!;
  it("施法序列升序合并,数量=casts+petCasts", () => {
    const rows = deriveCasts(m, anyPlayer.id);
    expect(rows).toHaveLength(
      anyPlayer.casts.length + anyPlayer.petCasts.length,
    );
    for (let i = 1; i < rows.length; i++)
      expect(rows[i]!.t).toBeGreaterThanOrEqual(rows[i - 1]!.t);
    expect(rows.every((r) => r.spellName.length > 0)).toBe(true);
  });
  it("未知 unitId → 空数组", () => {
    expect(deriveCasts(m, "nope")).toEqual([]);
  });
  // GH #187: Evangelism writes its own Radiance row at its target just ahead
  // of the press; the lane shows the Evangelism press only (the prompt's
  // cast lines drop the same row through the same predicate)
  it("Evangelism 自带的真言术：耀不画成第二次按键,单独的耀照画", () => {
    const cast = (timestamp: number, spellId: number, destId = "P-2") => ({
      timestamp,
      spellId,
      spellName: `S${spellId}`,
      destId,
      destName: destId,
    });
    const src = {
      units: {
        "P-1": {
          casts: [
            cast(1_000, 194509),
            cast(1_001, 472433),
            cast(20_000, 194509),
            cast(40_000, 194509, "P-3"),
            cast(40_001, 472433, "P-2"),
          ],
          petCasts: [],
        },
      },
    };
    const rows = deriveCasts(src as never, "P-1");
    expect(rows.map((r) => [r.t, r.spellId])).toEqual([
      [1_001, 472433],
      [20_000, 194509],
      [40_000, 194509],
      [40_001, 472433],
    ]);
  });
});

describe("filterGcdNoise(GCD 泳道滤噪,2026-07-25 用户实测 44.5% 折叠)", () => {
  const row = (t: number, spellId: number, byPet = false) => ({
    t,
    spellId,
    spellName: `S${spellId}`,
    targetName: "",
    byPet,
  });
  it("分层否决:拒绝表丢、tick 刷屏丢、表外正常节奏保留", async () => {
    const { filterGcdNoise } =
      await import("../src/renderer/src/report/derive/casts");
    const rows = [
      // Rejection table (Devour 1217610, empirically auto-triggered in the
      // corpus) → dropped
      ...[0, 1500, 3000].map((t) => row(t, 1217610)),
      // Tick spam (300ms apart, below the GCD floor) → dropped at the physical
      // layer (whether or not it is in the table)
      ...[0, 300, 600, 900, 1200].map((t) => row(t, 2061)),
      // An off-table id at a normal GCD cadence → kept by default
      // (SkillLineAbility is incomplete)
      ...[0, 1500, 3000, 4500, 6000].map((t) => row(t, 999002)),
    ];
    const kept = filterGcdNoise(rows);
    expect(kept.every((r) => r.spellId === 999002)).toBe(true);
    expect(kept).toHaveLength(5);
  });
  it("双 id 交替刷屏(DH 吞噬型)按名聚合抓住", async () => {
    const { filterGcdNoise } =
      await import("../src/renderer/src/report/derive/casts");
    const mk = (t: number, spellId: number) => ({
      t,
      spellId,
      spellName: "Devour",
      targetName: "",
      byPet: false,
    });
    // Two in-table ids alternating, each 1200ms apart but 600ms once merged →
    // caught at the physical layer by NAME
    const rows = [0, 600, 1200, 1800, 2400, 3000].map((t, i) =>
      mk(t, i % 2 === 0 ? 2061 : 19750),
    );
    expect(filterGcdNoise(rows)).toHaveLength(0);
  });

  it("宠物填充剔除;curated 分类的宠物施法保留(断法 19647)", async () => {
    const { filterGcdNoise } =
      await import("../src/renderer/src/report/derive/casts");
    const rows = [
      row(0, 999003, true), // uncategorized pet filler
      row(1000, 19647, true), // Spell Lock, present in SPELL_CATEGORIES
    ];
    const kept = filterGcdNoise(rows);
    expect(kept.map((r) => r.spellId)).toEqual([19647]);
  });
  // pipeline T239: a personal defensive's cast row logs the caster's current
  // target (Survival of the Fittest → an enemy, 69915cc5 r1); the lane names
  // a target only where analysis says the destination is one
  it("只能给自己的防御技能不带施法行里的目标,其余照旧", () => {
    const cast = (timestamp: number, spellId: number, destId = "P-9") => ({
      timestamp,
      spellId,
      spellName: `S${spellId}`,
      destId,
      destName: destId === "P-9" ? "Enemy-Realm" : "Mate-Realm",
    });
    const player = (teamId: number, casts: unknown[] = []) => ({
      info: { teamId },
      casts,
      petCasts: [],
    });
    const src = {
      playerTeamId: 0,
      units: {
        "P-1": player(0, [
          cast(1_000, 264735), // Survival of the Fittest: personal
          cast(2_000, 122470), // Touch of Karma: pressed on an enemy
          cast(3_000, 33206), // Pain Suppression: an external
          cast(4_000, 116), // Frostbolt: no defensive
          cast(5_000, 33786), // Cyclone: a control
          cast(6_000, 421453), // Ultimate Penitence: its bolts go there
          cast(7_000, 264735, "P-2"), // …a teammate is no target of it either
          // Obsidian Scales: a talent puts it on an ally, never on an enemy
          cast(8_000, 363916),
          cast(9_000, 363916, "P-2"),
        ]),
        "P-2": player(0),
        "P-9": player(1),
      },
    } as never;
    expect(
      deriveCasts(src, "P-1").map((r) => [r.spellId, r.targetName]),
    ).toEqual([
      [264735, ""],
      [122470, "Enemy-Realm"],
      [33206, "Enemy-Realm"],
      [116, "Enemy-Realm"],
      [33786, "Enemy-Realm"],
      [421453, "Enemy-Realm"],
      [264735, ""],
      [363916, ""],
      [363916, "Mate-Realm"],
    ]);
    // the first leg is analysis's, the one the prompt's press lines read
    expect(rendersOnCaster("264735")).toBe(true);
    expect(rendersOnCaster("421453")).toBe(false);
  });
});

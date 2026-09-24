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
    const { filterGcdNoise } = await import(
      "../src/renderer/src/report/derive/casts"
    );
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
    const { filterGcdNoise } = await import(
      "../src/renderer/src/report/derive/casts"
    );
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
    const { filterGcdNoise } = await import(
      "../src/renderer/src/report/derive/casts"
    );
    const rows = [
      row(0, 999003, true), // uncategorized pet filler
      row(1000, 19647, true), // Spell Lock, present in SPELL_CATEGORIES
    ];
    const kept = filterGcdNoise(rows);
    expect(kept.map((r) => r.spellId)).toEqual([19647]);
  });
});

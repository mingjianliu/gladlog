import {
  auraCategory,
  deriveAuraEvents,
  deriveCasts,
  deriveUnitTimeline,
} from "../src/renderer/src/report/derive/casts";
import { loadMatchFixture } from "./fixtures/loadFixture";

describe("deriveCasts / deriveAuraEvents", () => {
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
  it("光环序列:applied 标记与 REMOVED 事件名互补", () => {
    const withAuras = Object.values(m.units).find(
      (u) => u.kind === "Player" && u.auraEvents.length > 0,
    )!;
    const rows = deriveAuraEvents(m, withAuras.id);
    expect(rows).toHaveLength(withAuras.auraEvents.length);
    const removed = withAuras.auraEvents.filter((e) =>
      e.eventName.includes("REMOVED"),
    ).length;
    expect(rows.filter((r) => !r.applied)).toHaveLength(removed);
  });
  it("未知 unitId → 空数组", () => {
    expect(deriveCasts(m, "nope")).toEqual([]);
    expect(deriveAuraEvents(m, "nope")).toEqual([]);
  });
});

describe("deriveUnitTimeline(合并施法+重要光环)", () => {
  const m = loadMatchFixture();
  const player = Object.values(m.units).find(
    (u) =>
      u.kind === "Player" && (u.casts.length > 0 || u.auraEvents.length > 0),
  )!;

  it("= 施法 + curated 分类内光环,按时间升序", () => {
    const timeline = deriveUnitTimeline(m, player.id);
    const casts = deriveCasts(m, player.id);
    const importantAuras = deriveAuraEvents(m, player.id).filter((a) =>
      auraCategory(a.spellId),
    );
    expect(timeline).toHaveLength(casts.length + importantAuras.length);
    for (let i = 1; i < timeline.length; i++)
      expect(timeline[i]!.t).toBeGreaterThanOrEqual(timeline[i - 1]!.t);
  });

  it("aura 事件都带有效分类;cast 事件带目标", () => {
    const timeline = deriveUnitTimeline(m, player.id);
    for (const e of timeline) {
      if (e.kind === "aura") {
        expect(e.category.length).toBeGreaterThan(0);
        expect(auraCategory(e.spellId)).toBe(e.category);
      } else {
        expect(e.kind).toBe("cast");
        expect(typeof e.targetName).toBe("string");
      }
    }
  });

  it("过滤掉未分类光环(杂噪 proc 不入流)", () => {
    const timeline = deriveUnitTimeline(m, player.id);
    const auraEvents = timeline.filter((e) => e.kind === "aura");
    expect(auraEvents.every((e) => auraCategory(e.spellId))).toBe(true);
  });

  it("未知 unitId → 空数组", () => {
    expect(deriveUnitTimeline(m, "nope")).toEqual([]);
  });
});

import {
  deriveAuraEvents,
  deriveCasts,
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

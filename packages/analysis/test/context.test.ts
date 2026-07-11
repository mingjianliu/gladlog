import { buildMatchContext } from "../src/context/buildMatchContext";
import { loadLegacyMatchFixture } from "./helpers/legacyFixture";

describe("buildMatchContext on real fixture", () => {
  const match = loadLegacyMatchFixture();
  const units = Object.values(match.units).filter((u) => u.info);
  const friends = units.filter((u) => u.reaction === 1); // Friendly
  const enemies = units.filter((u) => u.reaction === 2); // Hostile
  it("产出完整 prompt 上下文:非空、含玩家名与关键段落", () => {
    const ctx = buildMatchContext(match, friends, enemies, {});
    expect(ctx.length).toBeGreaterThan(2000);
    const owner = Object.values(match.units).find((u) => u.id === match.playerId);
    expect(ctx).toContain(owner!.name);
    expect(/dampening/i.test(ctx)).toBe(true);
  });
  it("timeline 模式同样可产出", () => {
    const ctx = buildMatchContext(match, friends, enemies, {
      useTimelinePrompt: true,
    });
    expect(ctx.length).toBeGreaterThan(1000);
  });
});

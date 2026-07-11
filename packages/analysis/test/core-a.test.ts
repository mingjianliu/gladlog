import { extractMajorCooldowns, specToString } from "../src/utils/cooldowns";
import { loadLegacyMatchFixture } from "./helpers/legacyFixture";

describe("core batch A on real fixture", () => {
  const match = loadLegacyMatchFixture();
  it("toLegacyMatch 桥:单位与队伍成立", () => {
    expect(Object.values(match.units).length).toBeGreaterThanOrEqual(4);
    for (const u of Object.values(match.units).filter((x) => x.info)) {
      expect(specToString(u.spec)).toBeTruthy();
    }
  });
  it("extractMajorCooldowns 冒烟:返回数组且元素带时间字段", () => {
    const players = Object.values(match.units).filter((u) => u.info);
    const all = players.flatMap((u) => extractMajorCooldowns(u, match));
    expect(Array.isArray(all)).toBe(true);
    for (const cd of all.slice(0, 5)) {
      expect(cd.spellId.length).toBeGreaterThan(0);
      expect(typeof cd.cooldownSeconds).toBe("number");
      expect(Array.isArray(cd.casts)).toBe(true);
    }
  });
});

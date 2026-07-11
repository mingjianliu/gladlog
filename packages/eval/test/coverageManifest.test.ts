import { buildCoverageManifest } from "../src/quality/coverageManifest";
import { loadLegacyMatchFixture } from "./helpers/legacyFixture";

describe("buildCoverageManifest", () => {
  it("fixture 清单:玩家齐、友方死亡与 CC 数组形状正确", () => {
    const m = loadLegacyMatchFixture();
    const manifest = buildCoverageManifest(m, "fixture-match");
    expect(manifest.players.length).toBeGreaterThanOrEqual(4);
    for (const p of manifest.players) {
      expect(typeof p.name).toBe("string");
      expect(typeof p.spec).toBe("string");
    }
    for (const d of manifest.deaths) {
      expect(["friendly", "hostile"]).toContain(d.reaction);
      expect(typeof d.tRelSec).toBe("number");
    }
    expect(manifest.counts.trinketCasts).toBeGreaterThanOrEqual(0);
    for (const e of manifest.ccApplied) {
      expect(e.spellId ?? e.spellName).toBeTruthy();
    }
  });
});

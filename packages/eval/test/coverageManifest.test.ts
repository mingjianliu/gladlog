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

describe("buildCoverageManifest — Adaptation 算一次饰品使用", () => {
  it("自身光环 283167 APPLIED 计入 trinketCasts（codex 62-POSTHOC-13g #3）", () => {
    const m = loadLegacyMatchFixture();
    const before = buildCoverageManifest(m, "fixture-match").counts
      .trinketCasts;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = Object.values(m.units as Record<string, any>).find(
      (u) => u.type === 1 && u.auraEvents?.length,
    );
    expect(p).toBeTruthy();
    const proto = p.auraEvents[0];
    const t = m.startTime + 57_756;
    const row = {
      ...proto,
      spellId: "283167",
      spellName: "PvP Trinket",
      srcUnitName: p.name,
      destUnitName: p.name,
      timestamp: t,
      logLine: { ...proto.logLine, event: "SPELL_AURA_APPLIED", timestamp: t },
    };
    p.auraEvents.push(row);
    // the same row on another unit's array is the same use
    const after = buildCoverageManifest(m, "fixture-match");
    expect(after.counts.trinketCasts).toBe(before + 1);
    expect(after.trinketCasts.some((e) => e.spellId === "283167")).toBe(true);
    // someone else's Adaptation aura row seen on this unit is not its use
    p.auraEvents.push({ ...row, destUnitName: "Someone-Else", timestamp: t + 1 });
    expect(buildCoverageManifest(m, "fixture-match").counts.trinketCasts).toBe(
      before + 1,
    );
  });
});

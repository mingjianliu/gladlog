import { checkMatch } from "../src/quality/promptQualityCheck";
import type { CoverageManifest } from "../src/quality/coverageManifest";

const entry = {
  ordinal: 1,
  matchId: "m1",
  spec: "Restoration Druid",
  result: "loss",
  file: "prompts/001-m1.txt",
};

const manifest = {
  players: [{ name: "Heals-Realm", spec: "Restoration Druid" }],
  deaths: [{ unitName: "Heals-Realm", reaction: "friendly", tRelSec: 42 }],
  ccApplied: [
    { spellId: "408", spellName: "Kidney Shot", spellNameEn: "Kidney Shot" },
  ],
  interrupts: [],
  dispels: [],
  counts: { trinketCasts: 1 },
} as unknown as CoverageManifest;

describe("promptQualityCheck.checkMatch", () => {
  it("友方死亡不在 prompt → hardFailure;在 → 覆盖 100%", () => {
    const miss = checkMatch(entry, "nothing here\njust lines", manifest);
    expect(miss.hardFailures.length).toBeGreaterThan(0);
    expect(miss.coverage.friendlyDeaths.present).toBe(0);

    const hit = checkMatch(
      entry,
      "[DEATH] 42s Heals died\nKidney Shot lands\ntrinketed out of it",
      manifest,
    );
    expect(hit.hardFailures).toEqual([]);
    expect(hit.coverage.friendlyDeaths.present).toBe(1);
    expect(hit.coverage.ccSpells.present).toBe(1);
    expect(hit.coverage.trinketCasts.present).toBe(1);
  });

  it("重复率:4 非空行含 1 对重复 → exactDuplicateRatio 0.25", () => {
    const q = checkMatch(
      entry,
      "[DEATH] Heals died\nKidney Shot\nsame line\nsame line",
      manifest,
    );
    expect(q.noise.exactDuplicateRatio).toBeCloseTo(0.25, 3);
  });

  it("模板重复率:数字归一化后重复计入 templateDuplicateRatio", () => {
    const q = checkMatch(
      entry,
      "[DEATH] Heals died at 42\n[HP] 100 at 1s\n[HP] 250 at 7s\nKidney Shot",
      manifest,
    );
    expect(q.noise.templateDuplicateRatio).toBeCloseTo(0.25, 3);
    expect(q.noise.exactDuplicateRatio).toBe(0);
  });

  it("bias 词典命中计数与样例行号", () => {
    const q = checkMatch(
      entry,
      "[DEATH] Heals died ok\nKidney Shot\nthat was catastrophic",
      manifest,
    );
    expect(q.labelBias.totalHits).toBe(1);
    expect(q.labelBias.hits[0].term).toBe("catastrophic");
    expect(q.labelBias.hits[0].sampleLines).toEqual([3]);
  });

  it("localized 与英文名任一命中即覆盖", () => {
    const zh = {
      ...manifest,
      ccApplied: [
        { spellId: "408", spellName: "腎擊", spellNameEn: "Kidney Shot" },
      ],
    } as unknown as CoverageManifest;
    const q = checkMatch(entry, "[DEATH] Heals died\nKidney Shot hit", zh);
    expect(q.coverage.ccSpells.present).toBe(1);
  });
});

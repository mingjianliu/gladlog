import { describe, expect, test } from "vitest";

import {
  MITIGATION_OVERRIDES,
  MITIGATION_TABLE,
  mitigationPctFor,
  NO_MITIGATION_IDS,
} from "../src/data/mitigationData";
import generatedJson from "../src/data/mitigationGenerated.json";
import spellIdLists from "../src/data/spellIdLists";

const WL = new Set([
  ...spellIdLists.bigDefensiveSpellIds,
  ...spellIdLists.externalDefensiveSpellIds,
  ...spellIdLists.attributedMitigationSpellIds,
]);

describe("减伤表防腐(无第三态)", () => {
  test("白名单全覆盖:TABLE ∪ NO_MITIGATION_IDS ⊇ 白名单,且无第三态", () => {
    const missing = [...WL].filter(
      (id) => !(id in MITIGATION_TABLE) && !NO_MITIGATION_IDS.has(id),
    );
    expect(missing).toEqual([]); // whoever is missing turns it red, and the failure message reads directly
  });

  test("两态互斥:登记为无减伤的 id 不得同时在表里", () => {
    const both = Object.keys(MITIGATION_TABLE).filter((id) =>
      NO_MITIGATION_IDS.has(id),
    );
    expect(both).toEqual([]);
  });

  test("值域:pct∈(0,100],schoolMask∈(0,0x7F]", () => {
    for (const [id, e] of Object.entries(MITIGATION_TABLE)) {
      expect(e.pct, id).toBeGreaterThan(0);
      expect(e.pct, id).toBeLessThanOrEqual(100);
      expect(e.schoolMask, id).toBeGreaterThan(0);
      expect(e.schoolMask, id).toBeLessThanOrEqual(0x7f);
    }
  });

  test("表不越界:TABLE/OVERRIDES/NO_MITIGATION_IDS 的键都在白名单内", () => {
    for (const id of Object.keys(MITIGATION_TABLE))
      expect(WL.has(id), id).toBe(true);
    for (const id of Object.keys(MITIGATION_OVERRIDES))
      expect(WL.has(id), id).toBe(true);
    for (const id of NO_MITIGATION_IDS) expect(WL.has(id), id).toBe(true);
  });

  test("值域(显式覆盖 OVERRIDES 层):pct∈(0,100],schoolMask∈(0,0x7F]", () => {
    for (const [id, e] of Object.entries(MITIGATION_OVERRIDES)) {
      expect(e.pct, id).toBeGreaterThan(0);
      expect(e.pct, id).toBeLessThanOrEqual(100);
      expect(e.schoolMask, id).toBeGreaterThan(0);
      expect(e.schoolMask, id).toBeLessThanOrEqual(0x7f);
    }
  });

  test("generated 层永不产出 positional(仅 OVERRIDES 允许)", () => {
    const gen = (generatedJson as { entries: Record<string, object> }).entries;
    for (const [id, e] of Object.entries(gen))
      expect("positional" in e, id).toBe(false);
  });
});

describe("锚点(游戏事实,2026-07 人审后钉死)", () => {
  // All three anchors were confirmed by human review: 22812/33206 come straight
  // from the DB2 12.1.0.68629 aura-87 rows (the SpellID is the whitelist id);
  // 642 is a DB2 aura-39 (school immunity) row, given pct=100 via OVERRIDES per
  // the spec's immunity semantics.
  test("Barkskin 22812:20% 全学派", () => {
    expect(MITIGATION_TABLE["22812"]).toEqual({ pct: 20, schoolMask: 0x7f });
  });
  test("Pain Suppression 33206:40% 全学派", () => {
    expect(MITIGATION_TABLE["33206"]).toEqual({ pct: 40, schoolMask: 0x7f });
  });
  test("Divine Shield 642:免疫=100", () => {
    expect(MITIGATION_TABLE["642"]?.pct).toBe(100);
  });
  test("锚点:196718 黑暗全形状(2026-07-30 用户改判)", () => {
    expect(MITIGATION_TABLE["196718"]).toEqual({
      pct: 40,
      schoolMask: 0x7f,
      positional: true,
    });
  });
});

describe("pctOnOthers(天赋共享的个人墙:一个 id、两个值,2026-09-12)", () => {
  test("generated 层永不产出 pctOnOthers(仅 OVERRIDES 允许)", () => {
    const gen = (generatedJson as { entries: Record<string, object> }).entries;
    for (const [id, e] of Object.entries(gen))
      expect("pctOnOthers" in e, id).toBe(false);
  });

  test("值域:pctOnOthers ∈ (0, pct)", () => {
    for (const [id, e] of Object.entries(MITIGATION_TABLE)) {
      if (e.pctOnOthers === undefined) continue;
      expect(e.pctOnOthers, id).toBeGreaterThan(0);
      expect(e.pctOnOthers, id).toBeLessThan(e.pct);
    }
  });

  test("锚点:黑曜鳞片 363916 = 自己 30% / 队友 15%(塑焰者共享,语料 48.9% 上在别人身上)", () => {
    expect(MITIGATION_TABLE["363916"]).toEqual({
      pct: 30,
      schoolMask: 0x7f,
      pctOnOthers: 15,
    });
  });

  test("mitigationPctFor:施法者自己 → pct,别人身上 → pctOnOthers,没登记的 id 两边都是 pct", () => {
    const os = MITIGATION_TABLE["363916"]!;
    expect(mitigationPctFor(os, true)).toBe(30);
    expect(mitigationPctFor(os, false)).toBe(15);
    const bark = MITIGATION_TABLE["22812"]!;
    expect(mitigationPctFor(bark, true)).toBe(bark.pct);
    expect(mitigationPctFor(bark, false)).toBe(bark.pct);
  });
});

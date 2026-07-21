import { describe, expect, it } from "vitest";

import { SPELL_CATEGORIES } from "../data/spellCategories";
import { spellEffectData } from "../data/spellEffectData";
import {
  HIGH_VALUE_PURGEABLE_BUFFS,
  PURGE_WHITELIST_DATA_BLOCKED,
} from "./matchTimeline";

/**
 * 门规谓词即规范:「这个敌方增益可驱散且值得报」这一个事实被三份清单各自断言 ——
 * ① spellEffectData 的 dispelType(dispelAnalysis.getDispelType)
 * ② SPELL_CATEGORIES 的 type(dispelAnalysis.getPriority,未收录 → Low → 丢弃)
 * ③ matchTimeline 的 HIGH_VALUE_PURGEABLE_BUFFS(发射端)
 *
 * 三者独立演化过,结果是 2026-07-21 全语料实测:9 条白名单里 7 条永远发不出来,
 * 1245 场只见过 Power Infusion 与 Blessing of Protection。语料里看不出区别 ——
 * 「没发生过」和「发不出来」长得一模一样。所以在这里断言。
 */

// getPriority 的镜像(dispelAnalysis.ts 里是私有函数;两边分歧就是本测试要抓的东西)
const CRITICAL_TYPES = new Set(["cc", "immunities"]);
const HIGH_TYPES = new Set([
  "roots",
  "immunities_spells",
  "buffs_offensive",
  "debuffs_offensive",
  "buffs_defensive",
]);

function reachesEmitter(spellId: string): {
  ok: boolean;
  dispelType: string | null;
  category: string | null;
} {
  const dispelType = spellEffectData[spellId]?.dispelType ?? null;
  const category = SPELL_CATEGORIES[spellId]?.type ?? null;
  const priorityOk =
    category !== null &&
    (CRITICAL_TYPES.has(category) || HIGH_TYPES.has(category));
  return { ok: dispelType === "Magic" && priorityOk, dispelType, category };
}

describe("HIGH_VALUE_PURGEABLE_BUFFS 与上游目录一致", () => {
  it("每条白名单要么真能发出,要么登记在 DATA_BLOCKED 里", () => {
    const silentlyDead: string[] = [];
    for (const spellId of HIGH_VALUE_PURGEABLE_BUFFS) {
      const r = reachesEmitter(spellId);
      if (!r.ok && !PURGE_WHITELIST_DATA_BLOCKED.has(spellId)) {
        silentlyDead.push(
          `${spellId}: dispelType=${r.dispelType} category=${r.category}`,
        );
      }
    }
    expect(silentlyDead).toEqual([]);
  });

  it("DATA_BLOCKED 不留已经修好的条目", () => {
    // 数据补齐后这条会失败,提醒把 id 从豁免名单里删掉 —— 豁免不该沉淀成永久白名单。
    const nowWorking: string[] = [];
    for (const spellId of PURGE_WHITELIST_DATA_BLOCKED) {
      if (reachesEmitter(spellId).ok) nowWorking.push(spellId);
    }
    expect(nowWorking).toEqual([]);
  });

  it("DATA_BLOCKED 只收白名单内的 id", () => {
    const orphans = [...PURGE_WHITELIST_DATA_BLOCKED].filter(
      (id) => !HIGH_VALUE_PURGEABLE_BUFFS.has(id),
    );
    expect(orphans).toEqual([]);
  });

  it("圣骑士三祝福都能走到发射端(本次修复的回归锚)", () => {
    for (const spellId of ["1022", "1044", "6940"]) {
      expect(reachesEmitter(spellId).ok, `spell ${spellId}`).toBe(true);
    }
  });
});

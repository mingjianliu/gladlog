/**
 * GH #28 的核心回归(2026-08-30 随 GH #34 决策点重写更新):cd-hoarded 不许拿
 * 「够不着队友的技能」指控你没救队友。
 *
 * 用户原话:「我玩牧师,绝望祷言全场没用,然后我队友生命垂危的时候我应该用 ——
 * 这技能只能给自己加血。」下面第一批用例就是这句话的机制化复现。
 *
 * 2026-08-30 重写(GH #34,决策点形状):判据从 `availableWindows` 换成了
 * `crisisDecisionPoints`(与 crisis-no-response 同一谓词),owner 自己的危机
 * 和每个队友的危机各自一路 source;GH #28 的限制现在体现在
 * `cdHoardedEvents` 内部的 own/teammate 两条 help-gate 上(own=自愈墙或
 * 「不是自施-无效的外放」;teammate=`canHelpAnotherUnit`),不再靠调用方往
 * 探针里塞 onlyUnitName。
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  cdHoardedEvents,
  type ICdHoardedCrisisSource,
} from "../src/analysis/candidates/cooldownTiming";
import { ensureAnalysisData } from "../src/data/ensure";

const OWNER = { id: "h", name: "Healer-R" };
const MATE = { id: "m", name: "Ally-R" };

/** 一个满足 dangerous(dmg2s>=10%)且不在硬控中的危机决策点 —— 只需要
 * `cdHoardedEvents` 实际读取的七个字段(见 `ICdHoardedCrisisSource`)。 */
function point(
  tSec: number,
  hpPct: number,
  over: Partial<ICdHoardedCrisisSource["points"][number]> = {},
): ICdHoardedCrisisSource["points"][number] {
  return {
    tSec,
    hpPct,
    dmg2s: 0.3,
    attackers2s: 1,
    enemyBurst: false,
    inCC: false,
    dangerous: true,
    ...over,
  };
}

function ownCrisis(...pts: ICdHoardedCrisisSource["points"][number][]) {
  return { crisisUnit: OWNER, own: true, points: pts };
}
function mateCrisis(...pts: ICdHoardedCrisisSource["points"][number][]) {
  return { crisisUnit: MATE, own: false, points: pts };
}

const cd = (
  spellId: string,
  spellName: string,
  over: Record<string, unknown> = {},
) => ({
  spellId,
  spellName,
  tag: "Defensive",
  cooldownSeconds: 300,
  casts: [] as { timeSeconds: number }[],
  neverUsed: true,
  ...over,
});

// 官方数据动态载入:先 await 聚合入口(与 prompt 路径同一契约)——
// canHelpAnotherUnit(队友危机门)与 isSurvivalWall(终极苦修那条兜底)都要读
// 官方生成表。
beforeAll(async () => {
  await ensureAnalysisData();
});

describe("cd-hoarded × 够不着队友的技能(GH #28,2026-08-30 决策点重写)", () => {
  it("绝望祷言 + 队友垂危 → 0 条(自愈技能救不了别人的血条)", () => {
    const evts = cdHoardedEvents(
      [mateCrisis(point(10, 13))],
      [cd("19236", "Desperate Prayer")],
      OWNER,
    );
    expect(evts).toEqual([]);
  });

  it("绝望祷言 + owner 自己垂危 → 仍然出 1 条,且危机单位是 owner 本人", () => {
    const evts = cdHoardedEvents(
      [ownCrisis(point(10, 20))],
      [cd("19236", "Desperate Prayer")],
      OWNER,
    );
    expect(evts).toHaveLength(1);
    expect(evts[0]!.facts["crisisUnit"]).toBe(OWNER.name);
    expect(evts[0]!.facts["crisisHpPct"]).toBe("20");
    expect(evts[0]!.facts["own"]).toBe("yes");
  });

  it("能作用到队友的 CD(宁静)+ 队友垂危 → 照常出,且引用队友、own=no", () => {
    const evts = cdHoardedEvents(
      [mateCrisis(point(10, 13))],
      [cd("740", "Tranquility")],
      OWNER,
    );
    expect(evts).toHaveLength(1);
    expect(evts[0]!.facts["crisisUnit"]).toBe("Ally-R");
    expect(evts[0]!.facts["own"]).toBe("no");
  });

  // 2026-08-30 重写的范围收窄(见 cooldownTiming.ts 的 cdHoardedEvents 文档
  // 注释):基础门现在硬性要求 tag==="Defensive"——定身术(Control)不再进入
  // ready 集合,peel 角度的旧用例随之退役(不是回归,是本轮重写的既定收窄)。

  it("被标成 Defensive 的产出增益(神圣显灵,isThroughput)+ 队友垂危 → 0 条:isThroughput 门先把它挡在外面", () => {
    const evts = cdHoardedEvents(
      [mateCrisis(point(10, 13))],
      [cd("200183", "Apotheosis", { isThroughput: true })],
      OWNER,
    );
    expect(evts).toEqual([]);
  });

  it("运行时注入的 Defensive CD(终极苦修):带 tag 就该被自愈门拦住 —— 队友的危机救不了", () => {
    const evts = cdHoardedEvents(
      [mateCrisis(point(10, 13))],
      [cd("421453", "Ultimate Penitence")],
      OWNER,
    );
    expect(evts).toEqual([]);
  });

  it("终极苦修 + owner 自己垂危 → 照常出(它是纯自身吸收盾,救得了自己)", () => {
    const evts = cdHoardedEvents(
      [ownCrisis(point(10, 20))],
      [cd("421453", "Ultimate Penitence")],
      OWNER,
    );
    expect(evts).toHaveLength(1);
  });
});

describe("cd-hoarded 决策点门(2026-08-30,GH #34)", () => {
  it("ready 且未在响应窗内施放 → 出 1 条", () => {
    const evts = cdHoardedEvents(
      [ownCrisis(point(100, 30))],
      [cd("642", "Divine Shield")],
      OWNER,
    );
    expect(evts).toHaveLength(1);
  });

  it("ready 墙在 t+3s(响应窗 CD_HOARD_RESPONSE_S=5 内)施放 → 0 条(按了不算屯)", () => {
    const evts = cdHoardedEvents(
      [ownCrisis(point(100, 30))],
      [cd("642", "Divine Shield", { casts: [{ timeSeconds: 103 }] })],
      OWNER,
    );
    expect(evts).toEqual([]);
  });

  it("ready 墙在响应窗外(t+8s)才施放 → 仍出 1 条(那一刻确实屯了)", () => {
    const evts = cdHoardedEvents(
      [ownCrisis(point(100, 30))],
      [cd("642", "Divine Shield", { casts: [{ timeSeconds: 108 }] })],
      OWNER,
    );
    expect(evts).toHaveLength(1);
  });

  it("响应窗前沿(-1.5s)内的施放也算已答 —— 与 crisisDecisionPoints 自己的 RESPONSE_PRE_MS 同一约定", () => {
    const evts = cdHoardedEvents(
      [ownCrisis(point(100, 30))],
      [cd("642", "Divine Shield", { casts: [{ timeSeconds: 99 }] })],
      OWNER,
    );
    expect(evts).toEqual([]);
  });

  it("dangerous=false → 0 条(没有真实伤害的危机不算)", () => {
    const evts = cdHoardedEvents(
      [ownCrisis(point(100, 30, { dangerous: false }))],
      [cd("642", "Divine Shield")],
      OWNER,
    );
    expect(evts).toEqual([]);
  });

  it("inCC=true → 0 条(危机单位当时在控中——只看 gate 1,不要求 feasible 整体)", () => {
    const evts = cdHoardedEvents(
      [ownCrisis(point(100, 30, { inCC: true }))],
      [cd("642", "Divine Shield")],
      OWNER,
    );
    expect(evts).toEqual([]);
  });

  it("没有任何 ready 的防御 CD(全部在冷却中)→ 0 条", () => {
    const evts = cdHoardedEvents(
      [ownCrisis(point(100, 30))],
      [cd("642", "Divine Shield", { casts: [{ timeSeconds: 0 }] })],
      OWNER,
    );
    expect(evts).toEqual([]);
  });

  it("facts.readyCds 最多列 3 个、以 '; ' 连接", () => {
    const evts = cdHoardedEvents(
      [ownCrisis(point(100, 30))],
      [
        cd("642", "Divine Shield"),
        cd("871", "Shield Wall"),
        cd("48792", "Icebound Fortitude"),
        cd("104773", "Cannon Barrage"),
      ],
      OWNER,
    );
    expect(evts).toHaveLength(1);
    expect(evts[0]!.facts["readyCds"].split("; ")).toHaveLength(3);
  });

  it("上限与按危险度排序(enemyBurst > attackers2s > dmg2s),从不按结局", () => {
    const sources = [
      ownCrisis(
        point(10, 30, { enemyBurst: false, attackers2s: 1, dmg2s: 0.9 }),
        point(20, 30, { enemyBurst: true, attackers2s: 1, dmg2s: 0.1 }),
        point(30, 30, { enemyBurst: false, attackers2s: 3, dmg2s: 0.2 }),
      ),
    ];
    const evts = cdHoardedEvents(sources, [cd("642", "Divine Shield")], OWNER);
    // 上限 2:enemyBurst 那条最先入选,其次 attackers2s 更高的那条;
    // dmg2s 最高但 enemyBurst=false/attackers2s=1 的那条被挤出去。
    expect(evts).toHaveLength(2);
    expect(evts.map((e) => e.facts["t"]).sort()).toEqual(["20", "30"]);
  });

  it("最终按时间顺序展示(不是按危险度顺序)", () => {
    const sources = [
      ownCrisis(
        point(50, 30, { enemyBurst: true }),
        point(10, 30, { enemyBurst: false, attackers2s: 5 }),
      ),
    ];
    const evts = cdHoardedEvents(sources, [cd("642", "Divine Shield")], OWNER);
    expect(evts.map((e) => e.facts["t"])).toEqual(["10", "50"]);
  });

  it("facts 携带固定的语料参照三件套(CD_HOARDED_OUTCOME_REF)", () => {
    const evts = cdHoardedEvents(
      [ownCrisis(point(100, 30))],
      [cd("642", "Divine Shield")],
      OWNER,
    );
    // GH #115 regen 2026-10-08 (was 4.5 / 11.4 / 16960, 2026-08-30)
    expect(evts[0]!.facts["refDeathSpent"]).toBe("5.8");
    expect(evts[0]!.facts["refDeathHeld"]).toBe("13.0");
    expect(evts[0]!.facts["refN"]).toBe("15645");
  });
});

describe("cd-hoarded 意图守护(BACKLOG #26 Task 2,按了被拒不算屯 —— 2026-08-30 沿用)", () => {
  it("屯窗内该技能 CAST_FAILED → facts.attempted 命中", () => {
    const evts = cdHoardedEvents(
      [ownCrisis(point(100, 30))],
      [cd("642", "Divine Shield")],
      OWNER,
      undefined,
      {
        available: true,
        manaSamples: [],
        castFailed: [
          {
            tSeconds: 101,
            unitGuid: "h",
            spellId: 642,
            spellName: "Divine Shield",
            reason: "尚未恢复",
          },
        ],
      },
    );
    expect(evts).toHaveLength(1);
    expect(evts[0]!.facts["attempted"]).toBe("曾尝试施放被拒(尚未恢复×1)");
  });

  it("rawStreams 缺省 → facts 无 attempted 字段,行为与传空 castFailed 一致", () => {
    const withGuard = cdHoardedEvents(
      [ownCrisis(point(100, 30))],
      [cd("642", "Divine Shield")],
      OWNER,
      undefined,
      { available: false, manaSamples: [], castFailed: [] },
    );
    const without = cdHoardedEvents(
      [ownCrisis(point(100, 30))],
      [cd("642", "Divine Shield")],
      OWNER,
    );
    expect(withGuard).toEqual(without);
    expect(withGuard[0]!.facts["attempted"]).toBeUndefined();
  });
});

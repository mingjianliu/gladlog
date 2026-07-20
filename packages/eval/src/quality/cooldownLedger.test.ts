import { describe, expect, it } from "vitest";

import { checkCooldownLedgerConsistency } from "./promptQualityCheck";

/**
 * D 类:冷却台账自相矛盾。用例取自真实语料
 * ab/2026-07-20-prompt-defects/control/prompts/041-657187a1.txt。
 *
 * 判定必须**带归属**:missed-option 行写角色名、[RES] 台账写数字 id,
 * 两者靠名册对齐。无前缀的台账条目属于 log owner。
 * 合成用例一律带名册 —— 真实 prompt 必有名册,不带名册的片段测不出归属逻辑。
 */
const ROSTER_OWNER_BOOMY = [
  '  <unit id="1" name="Boomyenjoyer-Stormrage-US" spec="Restoration Druid" role="log owner">',
  '  <unit id="3" name="Gawbaghoul-MoonGuard-US" spec="Havoc Demon Hunter" role="teammate">',
];

describe("checkCooldownLedgerConsistency", () => {
  it("**回归**:线上真实矛盾 —— Ironbark 同时被判 available 与 on-cooldown", () => {
    const v = checkCooldownLedgerConsistency([
      ...ROSTER_OWNER_BOOMY,
      "1:53  [DEATH]  3(HDHunter) (Havoc Demon Hunter — friendly)",
      "      [RES] rdy:Incapacitating Roar  cd:Ironbark(7s),Stampeding Roar(50s)  enemy:Frozen Orb/Frost Mage(10s left)",
      "DEATHS WITH MISSED OPTIONS",
      "  [1:53] Gawbaghoul-MoonGuard-US died — Boomyenjoyer-Stormrage-US had Ironbark available, caster was free",
    ]);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("Ironbark");
    expect(v[0]).toContain("cd:");
  });

  it("台账把它列在 rdy: 时不报", () => {
    expect(
      checkCooldownLedgerConsistency([
        ...ROSTER_OWNER_BOOMY,
        "1:53  [DEATH]  3(HDHunter)",
        "      [RES] rdy:Ironbark,Incapacitating Roar  cd:Stampeding Roar(50s)",
        "DEATHS WITH MISSED OPTIONS",
        "  [1:53] X died — Boomyenjoyer-Stormrage-US had Ironbark available, caster was free",
      ]),
    ).toEqual([]);
  });

  it("台账完全没提该技能时不报(未追踪 ≠ 不可用)", () => {
    expect(
      checkCooldownLedgerConsistency([
        ...ROSTER_OWNER_BOOMY,
        "1:53  [DEATH]  3(HDHunter)",
        "      [RES] rdy:Incapacitating Roar  cd:Stampeding Roar(50s)",
        "DEATHS WITH MISSED OPTIONS",
        "  [1:53] X died — Boomyenjoyer-Stormrage-US had Lay on Hands available, caster was free",
      ]),
    ).toEqual([]);
  });

  it("台账条目带队友前缀、且归属与声称者一致时,仍要报", () => {
    const v = checkCooldownLedgerConsistency([
      '  <unit id="1" name="Own-Realm-US" spec="Preservation Evoker" role="log owner">',
      '  <unit id="2" name="Y-Realm-US" spec="Unholy Death Knight" role="teammate">',
      "2:10  [DEATH]  2(UDKnight)",
      "      [RES] rdy:—  cd:2:Icebound Fortitude(42s),3:Darkness(211s)",
      "DEATHS WITH MISSED OPTIONS",
      "  [2:10] X died — Y-Realm-US had Icebound Fortitude available, caster was free",
    ]);
    expect(v).toHaveLength(1);
  });

  /**
   * **回归**(2026-07-20 全语料审计):门规原本丢弃 `N:` 归属前缀,只按技能名
   * 全局比对 —— 镜像阵容(同队两个圣骑)里,甲的 Divine Shield 在冷却会把
   * 「乙有 Divine Shield 可用」误判成矛盾。9 条报告里 6 条是这么来的(67%
   * 假阳性),而这道门两天前刚被提升为常驻硬门。
   * 真实来源:runs/2026-07-20-fullscale-audit ord 923(Ëxørçïsm=2 放盾,
   * Øxý=3 被判可用,台账写 cd:2:Divine Shield(263s))。
   */
  it("**回归**:同技能异主不报 —— 队友的冷却不能算到别人头上", () => {
    expect(
      checkCooldownLedgerConsistency([
        '  <unit id="1" name="Bumbingdr-Tichondrius-US" spec="Preservation Evoker" role="log owner">',
        '  <unit id="2" name="Ëxørçïsm-Tichondrius-US" spec="Retribution Paladin" role="teammate">',
        '  <unit id="3" name="Øxý-Illidan-US" spec="Retribution Paladin" role="teammate">',
        "1:13  [TEAM] [CD]   2(RPaladin) (Retribution Paladin): Divine Shield",
        "      [RES] rdy:—  cd:2:Divine Shield(263s)",
        "DEATHS WITH MISSED OPTIONS",
        "  [1:23] Retribution Paladin (Øxý-Illidan-US) — had Divine Shield available, was not CC'd",
      ]),
    ).toEqual([]);
  });

  it("无前缀条目归属 log owner —— 声称者正是 log owner 时要报", () => {
    const v = checkCooldownLedgerConsistency([
      '  <unit id="1" name="Nevertrinket-Illidan-US" spec="Mistweaver Monk" role="log owner">',
      '  <unit id="3" name="Lidenn-Tichondrius-US" spec="Frost Mage" role="teammate">',
      "3:34  [DEATH]  3(FMage) (Frost Mage — friendly)",
      "      [RES] rdy:—  cd:Life Cocoon(2s),Leg Sweep(2s)",
      "DEATHS WITH MISSED OPTIONS",
      "  [3:34] Lidenn-Tichondrius-US died — Nevertrinket-Illidan-US had Life Cocoon available, caster was free",
    ]);
    expect(v).toHaveLength(1);
  });

  it("名册缺失时不报 —— 判不出归属就别猜(宁可漏报也不制造假红)", () => {
    expect(
      checkCooldownLedgerConsistency([
        "2:10  [DEATH]  2(UDKnight)",
        "      [RES] rdy:—  cd:2:Icebound Fortitude(42s)",
        "DEATHS WITH MISSED OPTIONS",
        "  [2:10] X died — Y had Icebound Fortitude available, caster was free",
      ]),
    ).toEqual([]);
  });

  it("剥掉充能后缀 [n/m] 后仍能匹配", () => {
    const v = checkCooldownLedgerConsistency([
      '  <unit id="1" name="Y-Realm-US" spec="Holy Priest" role="log owner">',
      "1:00  [DEATH]  1(HPriest)",
      "      [RES] rdy:—  cd:Pain Suppression(90s)[1/2]",
      "DEATHS WITH MISSED OPTIONS",
      "  [1:00] X died — Y-Realm-US had Pain Suppression available, caster was free",
    ]);
    expect(v).toHaveLength(1);
  });

  it("用死亡时刻之前最近的一条台账,不用之后的", () => {
    // 2:00 时 Ironbark 还在冷却;2:30(死亡之后)才 ready —— 不该拿 2:30 来判
    const v = checkCooldownLedgerConsistency([
      '  <unit id="1" name="Y-Realm-US" spec="Holy Priest" role="log owner">',
      "2:00  [DEATH]  1(HPriest)",
      "      [RES] rdy:—  cd:Ironbark(30s)",
      "2:30  [STATE]   friends 1(HPriest):99",
      "      [RES] rdy:Ironbark  cd:—",
      "DEATHS WITH MISSED OPTIONS",
      "  [2:00] X died — Y-Realm-US had Ironbark available, caster was free",
    ]);
    expect(v).toHaveLength(1);
  });

  it("「was not CC'd」句式(自身免疫类)同样受检", () => {
    const v = checkCooldownLedgerConsistency([
      '  <unit id="2" name="Eastï-Archimonde-EU" spec="Frost Mage" role="log owner">',
      "2:21  [DEATH]  2(FMage)",
      "      [RES] rdy:—  cd:Ice Block(120s)",
      "DEATHS WITH MISSED OPTIONS",
      "  [2:21] Frost Mage (Eastï-Archimonde-EU) — had Ice Block available, was not CC'd",
    ]);
    expect(v).toHaveLength(1);
  });

  it("空输入 → 无违规", () => {
    expect(checkCooldownLedgerConsistency([])).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";

import { checkCooldownLedgerConsistency } from "./promptQualityCheck";

/**
 * D 类:冷却台账自相矛盾。用例取自真实语料
 * ab/2026-07-20-prompt-defects/control/prompts/041-657187a1.txt。
 */
describe("checkCooldownLedgerConsistency", () => {
  it("**回归**:线上真实矛盾 —— Ironbark 同时被判 available 与 on-cooldown", () => {
    const v = checkCooldownLedgerConsistency([
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
        "1:53  [DEATH]  3(HDHunter)",
        "      [RES] rdy:Ironbark,Incapacitating Roar  cd:Stampeding Roar(50s)",
        "DEATHS WITH MISSED OPTIONS",
        "  [1:53] X died — Y had Ironbark available, caster was free",
      ]),
    ).toEqual([]);
  });

  it("台账完全没提该技能时不报(未追踪 ≠ 不可用)", () => {
    expect(
      checkCooldownLedgerConsistency([
        "1:53  [DEATH]  3(HDHunter)",
        "      [RES] rdy:Incapacitating Roar  cd:Stampeding Roar(50s)",
        "DEATHS WITH MISSED OPTIONS",
        "  [1:53] X died — Y had Lay on Hands available, caster was free",
      ]),
    ).toEqual([]);
  });

  it("剥掉队友数字前缀后仍能匹配", () => {
    const v = checkCooldownLedgerConsistency([
      "2:10  [DEATH]  2(UDKnight)",
      "      [RES] rdy:—  cd:2:Icebound Fortitude(42s),3:Darkness(211s)",
      "DEATHS WITH MISSED OPTIONS",
      "  [2:10] X died — Y had Icebound Fortitude available, caster was free",
    ]);
    expect(v).toHaveLength(1);
  });

  it("剥掉充能后缀 [n/m] 后仍能匹配", () => {
    const v = checkCooldownLedgerConsistency([
      "1:00  [DEATH]  1(HPriest)",
      "      [RES] rdy:—  cd:Pain Suppression(90s)[1/2]",
      "DEATHS WITH MISSED OPTIONS",
      "  [1:00] X died — Y had Pain Suppression available, caster was free",
    ]);
    expect(v).toHaveLength(1);
  });

  it("用死亡时刻之前最近的一条台账,不用之后的", () => {
    // 2:00 时 Ironbark 还在冷却;2:30(死亡之后)才 ready —— 不该拿 2:30 来判
    const v = checkCooldownLedgerConsistency([
      "2:00  [DEATH]  1(HPriest)",
      "      [RES] rdy:—  cd:Ironbark(30s)",
      "2:30  [STATE]   friends 1(HPriest):99",
      "      [RES] rdy:Ironbark  cd:—",
      "DEATHS WITH MISSED OPTIONS",
      "  [2:00] X died — Y had Ironbark available, caster was free",
    ]);
    expect(v).toHaveLength(1);
  });

  it("「was not CC'd」句式(自身免疫类)同样受检", () => {
    const v = checkCooldownLedgerConsistency([
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

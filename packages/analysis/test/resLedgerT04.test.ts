/**
 * FT-T04 (2026-10-09) — the [RES] ledger's arithmetic and one lockout:
 *  - a `cd:` entry's remaining is floored onto the render grid (a press at
 *    6.6 s read `(121s)` on the 0:06 row of a 120 s cooldown);
 *  - a `cc:` entry under a second from its end reads `<1s`, not `0s`, and the
 *    ledger prune still parses it;
 *  - Forbearance is read off the unit's own 25771 aura (cast model only when
 *    the log has no aura line for the cast);
 *  - Divine Shield off cooldown under Forbearance is not `rdy:` — it is
 *    `cd:Divine Shield(Forbearance Ns)`.
 */
import {
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  classifyNoChangeResRows,
  resCcRemainingText,
} from "../src/context/resLedgerPrune";
import {
  buildResourceSnapshot,
  computeOnCDDisplayNames,
  computeReadyNames,
  RES_FORBEARANCE_RE_SRC,
} from "../src/context/resourceSnapshot";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  cdLatestRemainingSeconds,
  cdRemainingWholeSeconds,
  FORBEARANCE_SECONDS,
  forbearanceStopsPress,
  type IMajorCooldownInfo,
  selfForbearanceActiveAt,
  selfForbearanceUntil,
} from "../src/utils/cooldowns";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const DIVINE_SHIELD = "642";
const BOP = "1022";
const FORBEARANCE = "25771";

const cd = (
  spellId: string,
  spellName: string,
  cooldownSeconds: number,
  casts: number[] = [],
): IMajorCooldownInfo =>
  ({
    spellId,
    spellName,
    tag: "Defensive",
    cooldownSeconds,
    maxChargesDetected: 1,
    casts: casts.map((timeSeconds) => ({ timeSeconds })),
    availableWindows: [],
    neverUsed: casts.length === 0,
  }) as unknown as IMajorCooldownInfo;

const row = (
  timeSeconds: number,
  ownerCDs: IMajorCooldownInfo[],
  extra: Partial<Parameters<typeof buildResourceSnapshot>[0]> = {},
) =>
  buildResourceSnapshot({
    timeSeconds,
    ownerCDs,
    ownerName: "P-R",
    ownerSpec: "Holy Paladin",
    teammateCDs: [],
    ccTrinketSummaries: [],
    enemyCDTimeline: { players: [], alignedBurstWindows: [] },
    matchStartMs: T0,
    ...extra,
  });

describe("FT-T04 — cd: remaining is floored onto the render grid", () => {
  it("6.6 秒按下的 120 秒冷却,0:06 行印 (120s),不是 (121s)", () => {
    const pi = cd("10060", "Power Infusion", 120, [6.6]);
    expect(cdLatestRemainingSeconds(pi, 6)).toBe(120);
    expect(row(6.6, [pi])).toContain("cd:Power Infusion(120s)");
    // 1:40 行:126.6 − 100 = 26.6 → 26,即 fmtTime(126.6) = 2:06 那一秒
    expect(cdLatestRemainingSeconds(pi, 100)).toBe(26);
    // 还没好的冷却不会是 0 秒
    expect(cdLatestRemainingSeconds(pi, 126)).toBe(1);
  });

  it("整数秒按下的不变;浮点误差不会把 120 读成 119", () => {
    expect(cdLatestRemainingSeconds(cd("x", "X", 120, [6]), 6)).toBe(120);
    expect(cdRemainingWholeSeconds(119.9999999)).toBe(120);
    expect(cdRemainingWholeSeconds(0.2)).toBe(1);
  });
});

describe("FT-T04 — cc: under a second left reads <1s", () => {
  it("resCcRemainingText:0.4 秒 → <1s;0.5 秒起照旧四舍五入", () => {
    expect(resCcRemainingText(0.4)).toBe("<1s");
    expect(resCcRemainingText(0)).toBe("<1s");
    expect(resCcRemainingText(0.5)).toBe("1s");
    expect(resCcRemainingText(2.6)).toBe("3s");
  });

  it("[RES] 行:还剩 0.3 秒的控制印 -<1s", () => {
    const line = row(10, [], {
      ccTrinketSummaries: [
        {
          playerName: "P-R",
          trinketUseTimes: [],
          ccInstances: [
            { atSeconds: 8, durationSeconds: 2.3, spellName: "Psychic Scream" },
          ],
        },
      ] as never,
    });
    expect(line).toContain("cc:P-R/Psychic Scream-<1s");
    expect(line).not.toContain("-0s");
  });

  it("裁剪器照样读得出法术名:被 [CC ON TEAM] 行覆盖的 -<1s 条目可以省掉这一行", () => {
    const lines = [
      "0:08  [CC ON TEAM]   1(HPriest) ← Psychic Scream (by 6(HPriest)) | 3s [DR: Disorient Full]",
      "      [RES] rdy:Δ  cd:—  focus:2  cc:1/Psychic Scream-2s",
      "0:10  [STATE]   friends 1(HPriest):80",
      "      [RES] rdy:Δ  cd:—  focus:2  cc:1/Psychic Scream-<1s",
    ];
    const verdicts = classifyNoChangeResRows(lines);
    const last = verdicts.find((v) => v.index === 3);
    expect(last).toBeDefined();
    expect(last!.uniqueFacts).not.toContain("cc");
    // 没有任何落地行覆盖的 -<1s 条目(打断锁定)是这一行独有的事实:不能
    // 因为解析不出法术名就当它不存在
    const kick = classifyNoChangeResRows([
      "0:10  [STATE]   friends 1(HPriest):80",
      "      [RES] rdy:Δ  cd:—  focus:2  cc:1/Wind Shear-<1s[kick]",
    ]);
    expect(kick[0]!.uniqueFacts).toContain("cc");
  });
});

describe("FT-T04 — Forbearance is read off the unit's own aura", () => {
  const paladin = (over: Record<string, unknown> = {}) =>
    makeUnit("P", {
      name: "P-R",
      class: CombatUnitClass.Paladin,
      spec: CombatUnitSpec.Paladin_Holy,
      ...over,
    } as never);
  const aura = (event: LogEvent, s: number, src = "P") =>
    makeAuraEvent(event, FORBEARANCE, T0 + s * 1000, src, "P", "DEBUFF");
  const selfBop = (s: number) =>
    makeSpellCastEvent(BOP, T0 + s * 1000, "P", "P-R", "P");

  it("光环在身上 → 生效;日志里的 REMOVED 结束它(模型会一直算满时长)", () => {
    const p = paladin({
      spellCastEvents: [selfBop(10)],
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, 10),
        aura(LogEvent.SPELL_AURA_REMOVED, 18),
      ],
    });
    expect(selfForbearanceActiveAt(p, [p], 12, T0)).toBe(true);
    expect(selfForbearanceUntil(p, [p], 12, T0)).toBe(10 + FORBEARANCE_SECONDS);
    // 18 秒被移除(日志里的结束,不是死亡带走的):之后不再生效,施放模型不再把它补回来
    expect(selfForbearanceActiveAt(p, [p], 20, T0)).toBe(false);
    expect(forbearanceStopsPress(p, DIVINE_SHIELD, p, [p], 20, T0)).toBe(false);
    expect(forbearanceStopsPress(p, DIVINE_SHIELD, p, [p], 12, T0)).toBe(true);
  });

  it("死亡带走的 REMOVED 不算结束:死的那一刻仍在 Forbearance 下(105-2:Divine Shield 后 12.6 秒阵亡,REMOVED 早 57 ms)", () => {
    const p = paladin({
      spellCastEvents: [
        makeSpellCastEvent(DIVINE_SHIELD, T0 + 137_286, "", "", "P"),
      ],
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, 137.308),
        aura(LogEvent.SPELL_AURA_REMOVED, 149.852),
      ],
      deathRecords: [{ timestamp: T0 + 149_909 }],
    });
    // 死亡那一刻:救命技(落在自己身上的)仍被 Forbearance 挡着
    expect(forbearanceStopsPress(p, BOP, p, [p], 149.909, T0)).toBe(true);
    expect(selfForbearanceActiveAt(p, [p], 149.9, T0)).toBe(true);
    // 不在死亡级联窗口里的 REMOVED 仍然是结束
    const alive = paladin({
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, 137.308),
        aura(LogEvent.SPELL_AURA_REMOVED, 149.852),
      ],
      deathRecords: [{ timestamp: T0 + 151_000 }],
    });
    expect(selfForbearanceActiveAt(alive, [alive], 150.5, T0)).toBe(false);
  });

  it("光环行排在施放行前面(同一毫秒)也认", () => {
    const p = paladin({
      spellCastEvents: [selfBop(10)],
      auraEvents: [aura(LogEvent.SPELL_AURA_APPLIED, 10)],
    });
    expect(selfForbearanceActiveAt(p, [p], 10, T0)).toBe(true);
    // 回合没记到 REMOVED:封顶在官方时长
    expect(
      selfForbearanceActiveAt(p, [p], 10 + FORBEARANCE_SECONDS + 1, T0),
    ).toBe(false);
  });

  it("日志里没有这次施放的光环行 → 照旧按施放 + 时长推算", () => {
    const p = paladin({ spellCastEvents: [selfBop(10)] });
    expect(selfForbearanceActiveAt(p, [p], 20, T0)).toBe(true);
    expect(
      selfForbearanceActiveAt(p, [p], 10 + FORBEARANCE_SECONDS + 1, T0),
    ).toBe(false);
    expect(selfForbearanceActiveAt(p, [p], 9, T0)).toBe(false);
  });
});

describe("FT-T04 — [RES]: Divine Shield under Forbearance is not ready", () => {
  const ds = cd(DIVINE_SHIELD, "Divine Shield", 210);
  const bop = cd(BOP, "Blessing of Protection", 300, [40]);
  const owner = makeUnit("P", {
    name: "P-R",
    class: CombatUnitClass.Paladin,
    spec: CombatUnitSpec.Paladin_Holy,
    spellCastEvents: [makeSpellCastEvent(BOP, T0 + 40_000, "P", "P-R", "P")],
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        FORBEARANCE,
        T0 + 40_000,
        "P",
        "P",
        "DEBUFF",
      ),
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        FORBEARANCE,
        T0 + 70_000,
        "P",
        "P",
        "DEBUFF",
      ),
    ],
  } as never);
  const deaths = { matchStartMs: T0, ownerUnit: owner };

  it("Forbearance 期间:不在 rdy,在 cd 里写 (Forbearance Ns);结束后回到 rdy", () => {
    expect(computeReadyNames(52, [ds, bop], [], deaths)).toEqual([]);
    expect(computeReadyNames(71, [ds, bop], [], deaths)).toEqual([
      "Divine Shield",
    ]);
    const line = row(52.4, [ds, bop], { ownerUnit: owner });
    expect(line).toContain("Divine Shield(Forbearance 18s)");
    expect(line).toMatch(new RegExp(RES_FORBEARANCE_RE_SRC));
    expect(line).not.toMatch(/rdy:[^ ]*Divine Shield/);
    expect(row(71, [ds, bop], { ownerUnit: owner })).toContain(
      "rdy:Divine Shield",
    );
  });

  it("Δ 行:Forbearance 开始时 -Divine Shield 并列出锁定;同一次锁定不重复印", () => {
    const first = row(41, [ds, bop], {
      ownerUnit: owner,
      prevReadyNames: ["Divine Shield", "Blessing of Protection"],
      prevOnCDNames: [],
    });
    expect(first).toContain("-Divine Shield");
    expect(first).toContain("Divine Shield(Forbearance 29s)");
    const again = row(50, [ds, bop], {
      ownerUnit: owner,
      prevReadyNames: [],
      prevOnCDNames: computeOnCDDisplayNames(41, [ds, bop], [], deaths),
    });
    expect(again).not.toContain("Forbearance");
  });

  it("没有持有者单位(手搭的夹具)或持有者不在 Forbearance 下:行为不变", () => {
    expect(computeReadyNames(52, [ds], [])).toEqual(["Divine Shield"]);
    expect(computeReadyNames(30, [ds], [], deaths)).toEqual(["Divine Shield"]);
  });
});

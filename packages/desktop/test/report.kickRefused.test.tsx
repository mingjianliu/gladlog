// @vitest-environment jsdom
import { analyzeKickAudit, missedKickKind } from "@gladlog/analysis";
import { CombatUnitReaction } from "@gladlog/parser-compat";
import { fireEvent, render } from "@testing-library/react";

import { KickDashboard } from "../src/renderer/src/report/components/KickDashboard";
import { deriveKickDash } from "../src/renderer/src/report/derive/kickDash";
import {
  MISSED_KICK_TEXT,
  missedKickLabel,
} from "../src/renderer/src/report/derive/kickText";
import { toLegacySafe } from "../src/renderer/src/report/derive/legacySource";
import { deriveMistakes } from "../src/renderer/src/report/derive/mistakes";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

/**
 * 用户裁决 A12(2026-11-17,pipeline T196):打断被日志拒在一条正在读的读条上
 * (SPELL_MISSED IMMUNE / REFLECT,`refusedAtCastSpellName`),桌面端三处逐条
 * 渲染(失误卡、爆发账本 chip、打断面板条目)不叫「落空」,照 miss 行说;
 * 其余落空的照旧。
 */
const base = loadRealMatchFixture();

const KICKER = "Player-1-00000001"; // Friendly
const CASTER = "Player-1-00000002"; // Hostile

/** A Frostbolt bar begun 80.0 s that goes off 81.5 s; our Wind Shear at
 * 81.0 s is logged `missType` on the caster. A second Wind Shear at 100 s
 * with a miss row and no bar running, and a third at 120 s with neither. */
function withRefusedKick(missType: string) {
  const m = JSON.parse(JSON.stringify(base)) as typeof base;
  const units = m.units as unknown as Record<string, Record<string, unknown>>;
  const p1 = units[KICKER]!;
  const p2 = units[CASTER]!;
  const t0 = m.startTime;
  const row = (over: Record<string, unknown>) => ({
    srcId: p1.id,
    srcName: p1.name,
    destId: p2.id,
    destName: p2.name,
    params: [],
    ...over,
  });
  const frostbolt = (tMs: number, eventName: string) =>
    row({
      timestamp: tMs,
      eventName,
      spellId: 116,
      spellName: "Frostbolt",
      srcId: p2.id,
      srcName: p2.name,
    });
  const shear = (tMs: number) =>
    row({
      timestamp: tMs,
      eventName: "SPELL_CAST_SUCCESS",
      spellId: 57994,
      spellName: "Wind Shear",
    });
  const miss = (tMs: number) =>
    row({
      timestamp: tMs,
      eventName: "SPELL_MISSED",
      spellId: 57994,
      spellName: "Wind Shear",
      missType,
      amount: 0,
    });
  p2.castStarts = [frostbolt(t0 + 80_000, "SPELL_CAST_START")];
  (p2.casts as unknown[]).push(frostbolt(t0 + 81_500, "SPELL_CAST_SUCCESS"));
  (p1.casts as unknown[]).push(
    shear(t0 + 81_000),
    shear(t0 + 100_000),
    shear(t0 + 120_000),
  );
  // the audit reads the kicker's own miss rows
  p1.missesOut = [
    ...((p1.missesOut as unknown[] | undefined) ?? []),
    miss(t0 + 81_000),
    miss(t0 + 100_000),
  ];
  return m;
}

const at = (tS: number) => (x: { tS: number }) => Math.abs(x.tS - tS) < 0.2;

describe("A12:被拒在读条上的打断不叫落空", () => {
  it("夹具自检:审计把 81s 这一脚判成 missed + refusedAtCastSpellName,100s / 120s 没有", () => {
    const legacy = toLegacySafe(withRefusedKick("IMMUNE"));
    const players = Object.values(legacy.units).filter((u) => u.info);
    const p = players.find((u) => u.id === KICKER)!;
    const enemies = players.filter(
      (u) => u.reaction === CombatUnitReaction.Hostile,
    );
    const kicks = analyzeKickAudit(p, enemies, legacy);
    const k81 = kicks.find((k) => Math.abs(k.atSeconds - 81) < 0.2)!;
    const k100 = kicks.find((k) => Math.abs(k.atSeconds - 100) < 0.2)!;
    const k120 = kicks.find((k) => Math.abs(k.atSeconds - 120) < 0.2)!;
    expect(k81.result).toBe("missed");
    expect(k81.refusedAtCastSpellName).toBe("Frostbolt");
    expect(k81.kickMiss?.missType).toBe("IMMUNE");
    expect(missedKickKind(k81)).toBe("immune");
    // a miss row at no running bar, and no miss row at all: plain missed
    expect(k100.result).toBe("missed");
    expect(k100.kickMiss?.missType).toBe("IMMUNE");
    expect(k100.refusedAtCastSpellName).toBeUndefined();
    expect(missedKickKind(k100)).toBe("missed");
    expect(k120.result).toBe("missed");
    expect(missedKickKind(k120)).toBe("missed");
  });

  it("措辞单源:immune / reflected 各有其词,其余(含拒在读条上的 MISS / DODGE)是落空", () => {
    const k = (missType?: string, refused = true) => ({
      ...(missType
        ? { kickMiss: { missType, targetId: "x", targetName: "x" } }
        : {}),
      ...(refused ? { refusedAtCastSpellName: "Polymorph" } : {}),
    });
    expect(missedKickLabel(k("IMMUNE"))).toBe("目标免疫打断");
    expect(missedKickLabel(k("REFLECT"))).toBe("被目标反射");
    expect(missedKickLabel(k("MISS"))).toBe(MISSED_KICK_TEXT);
    expect(missedKickLabel(k("IMMUNE", false))).toBe(MISSED_KICK_TEXT);
    expect(missedKickLabel(k(undefined, false))).toBe(MISSED_KICK_TEXT);
  });

  it("失误卡:81s 仍列出(类型 missed-kick),标签是「目标免疫打断」、明细不写空放;100s / 120s 照旧「打断空放」", () => {
    const mistakes = deriveMistakes(withRefusedKick("IMMUNE")).filter(
      (mk) => mk.type === "missed-kick",
    );
    const m81 = mistakes.find(at(81))!;
    expect(m81, "被拒的打断仍在清单里").toBeTruthy();
    expect(m81.label).toBe("目标免疫打断");
    expect(m81.detail).toBe("Wind Shear 打在 Frostbolt 读条上");
    for (const t of [100, 120]) {
      const mk = mistakes.find(at(t))!;
      expect(mk.label).toBe("打断空放");
      expect(mk.detail).toBe("Wind Shear 空放");
    }
  });

  it("失误卡:REFLECT 写「被目标反射」", () => {
    const m81 = deriveMistakes(withRefusedKick("REFLECT")).find(
      (mk) => mk.type === "missed-kick" && at(81)(mk),
    )!;
    expect(m81.label).toBe("被目标反射");
  });

  it("打断面板:条目照同一措辞;落空计数仍含它,其中 1 次记为被免疫/反射", () => {
    const rows = deriveKickDash(withRefusedKick("IMMUNE"));
    const row = rows.find((r) => r.unitId === KICKER)!;
    // the refused kick stays inside 落空's count (nothing was stopped): the
    // three injected kicks, plus the fixture's own once cast-bar data exists
    expect(row.refused).toBe(1);
    expect(row.missed).toBeGreaterThanOrEqual(3);
    const { container } = render(<KickDashboard rows={rows} />);
    const tr = [...container.querySelectorAll("tr")].find((el) =>
      el.textContent?.includes("被免疫/反射"),
    );
    expect(tr, "计数行注明被免疫/反射").toBeTruthy();
    fireEvent.click(tr as HTMLElement);
    const items = [...container.querySelectorAll(".rpt-stats-detail-item")].map(
      (el) => el.textContent ?? "",
    );
    expect(
      items.filter((t) => t.includes("Wind Shear 目标免疫打断")).length,
    ).toBe(1);
    expect(items.some((t) => t.includes("Wind Shear 落空"))).toBe(true);
  });
});

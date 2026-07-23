// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { extractCandidateFindings } from "@gladlog/analysis";

import { MatchReport } from "../src/renderer/src/report/components/MatchReport";
import { MistakesCard } from "../src/renderer/src/report/components/MistakesCard";
import { toLegacySafe } from "../src/renderer/src/report/derive/legacySource";
import {
  deriveMistakes,
  IGNORED_CANDIDATE_TYPES,
  MISTAKE_RULES,
} from "../src/renderer/src/report/derive/mistakes";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const base = loadRealMatchFixture();

/** 注入一次可判定的被骗 kick(敌方假读条 + 我方空踢)与一次空放:
 * fixture 无 castStarts(全部 unknown),这里补上让 juked/missed 可判。 */
function withInjectedMistakes() {
  const m = JSON.parse(JSON.stringify(base)) as typeof base;
  const units = m.units as unknown as Record<string, Record<string, unknown>>;
  const p1 = units["Player-1-00000001"]!; // Friendly kicker
  const p2 = units["Player-1-00000002"]!; // Hostile 假读条者
  const t0 = m.startTime;
  const ev = (over: Record<string, unknown>) => ({
    srcId: p2.id,
    srcName: p2.name,
    destId: p2.id,
    destName: p2.name,
    ...over,
  });
  // 敌方 50s 开读条,52s 被我方踢(空,读条已取消:无对应 SUCCESS)→ juked
  p2.castStarts = [
    ev({
      timestamp: t0 + 50_000,
      eventName: "SPELL_CAST_START",
      spellId: 116,
      spellName: "Frostbolt",
    }),
  ];
  (p1.casts as unknown[]).push(
    {
      timestamp: t0 + 52_000,
      eventName: "SPELL_CAST_SUCCESS",
      spellId: 57994,
      spellName: "Wind Shear",
      srcId: p1.id,
      srcName: p1.name,
      destId: p2.id,
      destName: p2.name,
    },
    // 70s 再空踢一次,读条数据在场且无 bait → missed
    {
      timestamp: t0 + 70_000,
      eventName: "SPELL_CAST_SUCCESS",
      spellId: 57994,
      spellName: "Wind Shear",
      srcId: p1.id,
      srcName: p1.name,
      destId: p2.id,
      destName: p2.name,
    },
  );
  return m;
}

const m = withInjectedMistakes();

describe("失误引擎(第四阶段③ / backlog #8)— 规则表防腐", () => {
  it("规则表:类型唯一、严重度合法、来源合法", () => {
    const types = MISTAKE_RULES.map((r) => r.type);
    expect(new Set(types).size).toBe(types.length);
    for (const r of MISTAKE_RULES) {
      expect(["minor", "average", "major"]).toContain(r.severity);
      expect(["candidate", "kick", "dispel"]).toContain(r.source);
    }
  });

  it("上游 candidateFindings 的每个产出类型,必须在规则表或豁免表里表态", () => {
    const legacy = toLegacySafe(m);
    const ruleTypes = new Set(
      MISTAKE_RULES.filter((r) => r.source === "candidate").map((r) => r.type),
    );
    const friendlies = Object.values(legacy.units).filter(
      (u) => u.info && String(u.reaction) === String(1),
    );
    const seen = new Set<string>();
    for (const p of Object.values(legacy.units).filter((u) => u.info)) {
      for (const c of extractCandidateFindings(legacy, p.id)) {
        seen.add(c.type);
      }
    }
    expect(seen.size).toBeGreaterThan(0);
    const untriaged = [...seen].filter(
      (t) => !ruleTypes.has(t) && !IGNORED_CANDIDATE_TYPES.has(t),
    );
    expect(
      untriaged,
      "candidateFindings 新增了类型,请在 MISTAKE_RULES 或 IGNORED_CANDIDATE_TYPES 表态",
    ).toEqual([]);
    void friendlies;
  });
});

describe("失误引擎 — derive 与 UI", () => {
  it("注入的 juked/missed kick 被规则捕获,时间正确,按时间升序", () => {
    const mistakes = deriveMistakes(m);
    const juked = mistakes.find((mk) => mk.type === "juked-kick");
    const missed = mistakes.filter((mk) => mk.type === "missed-kick");
    expect(juked, "juked-kick").toBeTruthy();
    expect(juked!.tS).toBeCloseTo(52, 1);
    expect(juked!.severity).toBe("average");
    // fixture 自带的真实 kick 在 castStarts 出现后也会从 unknown 变 missed,
    // 断言集合含注入的 70s 那脚,不假设它是唯一/第一条
    expect(
      missed.some((mk) => Math.abs(mk.tS - 70) < 0.2),
      "missed-kick@70s",
    ).toBe(true);
    for (let i = 1; i < mistakes.length; i++) {
      expect(mistakes[i]!.tS).toBeGreaterThanOrEqual(mistakes[i - 1]!.tS);
    }
  });

  it("时间窗过滤:窗口外的失误不出现", () => {
    const windowed = deriveMistakes(m, { fromS: 60, toS: 90 });
    expect(windowed.some((mk) => mk.type === "juked-kick")).toBe(false);
    expect(windowed.some((mk) => mk.type === "missed-kick")).toBe(true);
  });

  it("UI:失误清单卡渲染 + 时间轴 ⚠ 标记;空清单不渲染", () => {
    const { container } = render(<MatchReport source={m} matchId="t" />);
    expect(screen.getByTestId("mistakes-card")).toBeTruthy();
    expect(
      container.querySelectorAll("[data-testid=tl-mistake]").length,
    ).toBeGreaterThan(0);
    const { container: empty } = render(
      <MistakesCard mistakes={[]} onSeek={() => {}} />,
    );
    expect(empty.querySelector("[data-testid=mistakes-card]")).toBeNull();
  });
});

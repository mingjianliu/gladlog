// @vitest-environment jsdom
import {
  CANDIDATE_TYPE_REGISTRY,
  CARD_TYPES,
  extractCandidateFindings,
  MENU_ONLY_TYPES,
} from "@gladlog/analysis";
import { render, screen } from "@testing-library/react";

import { MatchReport } from "../src/renderer/src/report/components/MatchReport";
import { MistakesCard } from "../src/renderer/src/report/components/MistakesCard";
import { toLegacySafe } from "../src/renderer/src/report/derive/legacySource";
import {
  candidateDetail,
  deriveMistakes,
  IGNORED_CANDIDATE_TYPES,
  MISTAKE_RULES,
  timedAnchorsFromMistakes,
} from "../src/renderer/src/report/derive/mistakes";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const base = loadRealMatchFixture();

/** Injects one decidable juked kick (an enemy bait cast + our whiffed kick) and
 * one plain whiff: the fixture has no castStarts (everything is unknown), so we
 * add them here to make juked/missed decidable. */
function withInjectedMistakes() {
  const m = JSON.parse(JSON.stringify(base)) as typeof base;
  const units = m.units as unknown as Record<string, Record<string, unknown>>;
  const p1 = units["Player-1-00000001"]!; // Friendly kicker
  const p2 = units["Player-1-00000002"]!; // Hostile baiter
  const t0 = m.startTime;
  const ev = (over: Record<string, unknown>) => ({
    srcId: p2.id,
    srcName: p2.name,
    destId: p2.id,
    destName: p2.name,
    ...over,
  });
  // Enemy starts a cast at 50s, we kick at 52s into nothing (the cast was
  // already cancelled: no matching SUCCESS) -> juked
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
    // A second whiffed kick at 70s: cast data is present and there is no bait
    // -> missed
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

  it("questionable-external(17a)在规则表中登记,字段与 brief 一致——真实 fixture 发生率仅 0.52%,靠下面这条通用 untriaged 测试兜不住误删", () => {
    // Corpus evidence (task-3 report): across the 794-match library the
    // cast-level occurrence rate is only 0.52%, so the single match behind
    // loadRealMatchFixture() most likely never produces questionable-external
    // naturally -- which makes the "every upstream output type must be triaged"
    // anti-rot test mute here: delete this rule-table entry and that test still
    // passes (the type simply never enters the seen set). So assert on the rule
    // table directly, without depending on the fixture to trigger it.
    const rule = MISTAKE_RULES.find((r) => r.type === "questionable-external");
    expect(rule).toBeTruthy();
    expect(rule?.severity).toBe("minor"); // average→minor 2026-08-20 GH #16 severity 证据审计(反向判别力)
    expect(rule?.label).toBe("无压力窗口交出外减");
    expect(rule?.source).toBe("candidate");
  });

  it("severity 证据倒挂修正(GH #19,2026-08-20 用户裁定):missed-purge-kill-window 降 average、cd-hoarded 升 major", () => {
    // 12.1 正式重跑(459 场 / 2114 回合,docs/coaching-grounding-audit.md §C):
    // cd-hoarded +22.7pp 全库最强非循环信号,却在 average;missed-purge +2.6
    // 弱正却占 major 桶 92%,把第一屏整个占掉。
    expect(
      MISTAKE_RULES.find((r) => r.type === "missed-purge-kill-window")
        ?.severity,
    ).toBe("average");
    expect(MISTAKE_RULES.find((r) => r.type === "cd-hoarded")?.severity).toBe(
      "major",
    );
  });

  it("规则表 == 登记表的 CARD_TYPES(GH #76:失误卡名单从 candidateTypeRegistry 派生,规则行是手写的标签/严重度,所以只能断言相等)", () => {
    // Resurrect a card type: set status "live" in the registry AND add its
    // MISTAKE_RULES row — this test names whichever half is missing.
    const rules = MISTAKE_RULES.map((r) => r.type).sort();
    expect(rules).toEqual([...CARD_TYPES].sort());
    // The two "no card" meanings are disjoint from the card set and from each other only
    // where the registry says so (missed-purge is both retired and menu-only by design).
    for (const t of rules) expect(IGNORED_CANDIDATE_TYPES.has(t)).toBe(false);
    for (const t of MENU_ONLY_TYPES) expect(rules).not.toContain(t);
    // Origin "desktop" rows must be exactly the kick/dispel-sourced rules.
    const desktopOrigin = Object.entries(CANDIDATE_TYPE_REGISTRY)
      .filter(([, e]) => e.origin === "desktop")
      .map(([t]) => t)
      .sort();
    expect(
      MISTAKE_RULES.filter((r) => r.source !== "candidate")
        .map((r) => r.type)
        .sort(),
    ).toEqual(desktopOrigin);
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
      "candidateFindings 新增了类型,请在 packages/analysis/src/data/candidateTypeRegistry.ts 登记(surface 为 card 的还要加 MISTAKE_RULES 行)",
    ).toEqual([]);
    void friendlies;
  });

  it("crisis-no-response has a rule and a detail string; falls back to facts.refOutcome when facts.refOutcomeKey is absent (a cached round from before it existed)", () => {
    expect(
      MISTAKE_RULES.find((r) => r.type === "crisis-no-response"),
    ).toMatchObject({ severity: "major", source: "candidate" });
    expect(
      candidateDetail({
        type: "crisis-no-response",
        facts: {
          hpPct: "38",
          refDeathNoResp: "22",
          refDeathResp: "8",
          // no refOutcomeKey — pre-PROMPT_VERSION-40 cache, refOutcome was
          // still the bare enum token
          refOutcome: "ownDeath10s",
          refTop: "selfHeal 76%; wall 36%",
        },
      } as any),
    ).toBe(
      "血量 38% 后 3 秒无应对(此状态下无应对者 22% 十秒内死亡,有应对者 8%,出手者常见应对:selfHeal 76%; wall 36%)",
    );
  });

  it("crisis-no-response (spec §1c): refOutcomeKey=teamDeath15s (Solo Shuffle) renders the team-death wording instead of the own-death wording, driven by the key — refOutcome is now prose and never branched on", () => {
    expect(
      candidateDetail({
        type: "crisis-no-response",
        facts: {
          hpPct: "38",
          refDeathNoResp: "25",
          refDeathResp: "15",
          refOutcome: "a teammate (or the healer) died within 15 s",
          refOutcomeKey: "teamDeath15s",
          refTop: "selfHeal 75%; wall 23%",
        },
      } as any),
    ).toBe(
      "血量 38% 后 3 秒无应对(此状态下无应对者 25% 十五秒内我方有人阵亡,有应对者 15%,出手者常见应对:selfHeal 75%; wall 23%)",
    );
  });
});

describe("失误引擎 — derive 与 UI", () => {
  it("注入的 juked/missed kick 被规则捕获,时间正确,按时间升序", () => {
    const mistakes = deriveMistakes(m);
    const juked = mistakes.find((mk) => mk.type === "juked-kick");
    const missed = mistakes.filter((mk) => mk.type === "missed-kick");
    // juked-kick 已退役(2026-08-19,GH #15):夹具仍注入可判定的 juke,
    // 失误清单必须不再产出该行 —— 这是退役负控。
    expect(juked, "juked-kick 应随退役消失").toBeUndefined();
    // Once castStarts exist, the fixture's own real kicks also flip from
    // unknown to missed, so assert that the set contains the injected 70s kick
    // without assuming it is the only or the first one
    expect(
      missed.some((mk) => Math.abs(mk.tS - 70) < 0.2),
      "missed-kick@70s",
    ).toBe(true);
    for (let i = 1; i < mistakes.length; i++) {
      expect(mistakes[i]!.tS).toBeGreaterThanOrEqual(mistakes[i - 1]!.tS);
    }
  });

  it("timed 标志(BACKLOG #13 复核轮修复):cd-waste 是整场观察,timed=false;其余全部行 timed=true", () => {
    const mistakes = deriveMistakes(m);
    const cdWaste = mistakes.find((mk) => mk.type === "cd-waste");
    expect(cdWaste, "fixture 应产出至少一条 cd-waste").toBeTruthy();
    expect(cdWaste!.timed).toBe(false); // sentinel t=0 (a whole-round observation in candidateFindings.ts), not a real moment
    const others = mistakes.filter((mk) => mk.type !== "cd-waste");
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((mk) => mk.timed)).toBe(true);
  });

  it("timedAnchorsFromMistakes:过滤掉 timed=false 的行(红→绿——修复前的 bug 是把全部 tS 折进锚点,含 cd-waste 的哨兵 t=0)", () => {
    const mistakes = deriveMistakes(m);
    const anchors = timedAnchorsFromMistakes(mistakes);
    // The precise regression guard is the length check below (the historical
    // bug folded EVERY row's tS into the anchor set regardless of `timed`, so
    // a buggy implementation would yield anchors.length === mistakes.length,
    // not === the timed subset's length). This used to also assert
    // `not.toContain(0)` as a cd-waste-specific belt-and-suspenders check, but
    // that is no longer a valid invariant on real fixture data (2026-08-06):
    // cc-held (signal-expansion batch 1) can legitimately produce a REAL
    // t=0 anchor when a CC major sat available since the opening bell, and
    // that row IS timed=true, so 0 correctly belongs in the anchor set now.
    // The cd-waste row itself is still confirmed excluded by identity below.
    const cdWaste = mistakes.find((mk) => mk.type === "cd-waste");
    expect(cdWaste, "fixture 应产出至少一条 cd-waste").toBeTruthy();
    expect(cdWaste!.timed).toBe(false);
    expect(anchors.length).toBe(mistakes.filter((mk) => mk.timed).length);
    // Minimal synthetic counterexample for the "red" case: feed a single
    // timed=false mistake at tS=0 -- before the filter it yielded [0] (the bug:
    // the opening sliding window [0,20] would be wrongly treated as covered),
    // after the filter it must be empty.
    const onlyWholeRound = [
      {
        tS: 0,
        unitName: "x",
        type: "cd-waste",
        label: "",
        severity: "minor" as const,
        detail: "",
        seekNames: [],
        isOwner: true,
        timed: false,
      },
    ];
    expect(timedAnchorsFromMistakes(onlyWholeRound)).toEqual([]);
  });

  it("时间窗过滤:窗口外的失误不出现", () => {
    const windowed = deriveMistakes(m, { fromS: 60, toS: 90 });
    expect(windowed.some((mk) => mk.type === "juked-kick")).toBe(false);
    expect(windowed.some((mk) => mk.type === "missed-kick")).toBe(true);
  });

  it("UI:失误清单卡渲染 + 时间轴 ⚠ 标记;空清单保留卡壳(P1-1 干净局)", () => {
    const { container } = render(<MatchReport source={m} matchId="t" />);
    expect(screen.getByTestId("mistakes-card")).toBeTruthy();
    expect(
      container.querySelectorAll("[data-testid=tl-mistake]").length,
    ).toBeGreaterThan(0);
    const { container: empty } = render(
      <MistakesCard mistakes={[]} onSeek={() => {}} />,
    );
    expect(
      empty.querySelector("[data-testid=mistakes-card] .rpt-ledger-empty")
        ?.textContent,
    ).toContain("干净局");
  });
});

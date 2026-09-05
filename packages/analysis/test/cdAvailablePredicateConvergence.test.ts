/**
 * BACKLOG #18 final review, Minor #3 (shared-predicate rule convergence): the
 * single fact "available but not pressed at death / at the end" used to have
 * several independent implementations — matchTimelineSections' [DEATH] Unused
 * (previously hand-computed availableWindows hits), timelineHelpers'
 * [DEFENSIVE AVAILABLE] (previously a hand-computed readyAt),
 * candidateFindings' death-unused-defensive / external-unused (already
 * consuming cdAvailableAt), (criticalMoments' three spots — module deleted 2026-09-05, GH #51)
 * buildKillMomentFields (mechanical availability / spentCDs /
 * allDefensivesSpent, each previously hand-computing readyAt), and the
 * spentAtEnd in matchNarrative's buildMatchFlow (previously a hand-computed
 * readyAt). All of them now import and call cdAvailableAt directly — this test
 * is the anti-drift sentinel: given the same synthetic cooldown ledger and the
 * same instant, every consumer must reach the same boolean conclusion as
 * cdAvailableAt itself. If any of them is ever reverted to a local formula,
 * this fails the moment that formula diverges from cdAvailableAt's semantics.
 *
 * Explicitly out of scope: matchNarrative's `ownerDefsAvailableInWindow`
 * (inside buildMatchFlow, the Post-Trade Window section) is a two-instant check
 * — "casts before the window start firstBurst.toSeconds vs whether it is ready
 * by the window end midEnd" — which is not equivalent to cdAvailableAt's
 * single-instant semantics, so a mechanical substitution would change
 * behaviour. It is not part of this convergence and is honestly recorded in the
 * BACKLOG as a separate item pending a generalized predicate.
 */
import { CombatUnitReaction, CombatUnitSpec } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { deathUnusedDefensiveEvents } from "../src/analysis/candidateFindings";
import { buildMatchFlow } from "../src/context/matchNarrative";
import { emitFriendlyDeathEntries } from "../src/context/matchTimelineSections";
import { buildKillSequenceBlock } from "../src/context/timelineHelpers";
import { cdAvailableAt, IMajorCooldownInfo } from "../src/utils/cooldowns";
import { makeUnit } from "./ported/testHelpers";

const SPELL_ID = "102342"; // Ironbark — Defensive, not in any CC/Forbearance whitelist
const SPELL_NAME = "Ironbark";
const DEATH_T = 15;

function makeCd(casts: number[], cooldownSeconds: number): IMajorCooldownInfo {
  return {
    spellId: SPELL_ID,
    spellName: SPELL_NAME,
    tag: "Defensive",
    cooldownSeconds,
    maxChargesDetected: 1,
    casts: casts.map((timeSeconds) => ({ timeSeconds })),
    availableWindows: [], // none of the consumers read this field any more
    // (matchTimelineSections read it before the Minor #3 convergence; afterwards
    // everything goes through cdAvailableAt) — left empty to prove nobody is
    // still quietly depending on it.
    neverUsed: casts.length === 0,
  };
}

/** Whether the [DEATH] line lists Ironbark under "(Unused: …)". */
function deathSectionFlagsUnused(cd: IMajorCooldownInfo): boolean {
  const dyingUnit = makeUnit("Player1", {
    name: "Player1",
    spec: CombatUnitSpec.Druid_Restoration,
    reaction: CombatUnitReaction.Friendly,
  });
  const lines: string[] = [];
  emitFriendlyDeathEntries<never>({
    friendlyDeaths: [
      { spec: "Restoration Druid", name: "Player1", atSeconds: DEATH_T },
    ],
    unitsByName: new Map([["Player1", dyingUnit]]),
    ccTrinketSummaries: [],
    owner: dyingUnit,
    ownerCDs: [cd],
    teammateCDs: [],
    matchStartMs: 0,
    pid: (n) => n,
    requestSnapshotPlaceholder: () => "SNAPSHOT" as never,
    addEntry: (_t, ...ls) => {
      for (const l of ls) if (typeof l === "string") lines.push(l);
    },
  });
  expect(lines.length).toBeGreaterThan(0);
  return lines[0].includes(`Unused: ${SPELL_NAME}`);
}

/** Whether the [DEFENSIVE AVAILABLE] line names Ironbark. */
function killSeqFlagsAvailable(cd: IMajorCooldownInfo): boolean {
  const dyingUnit = makeUnit("Player1", {
    name: "Player1",
    spec: CombatUnitSpec.Druid_Restoration,
    reaction: CombatUnitReaction.Friendly,
  });
  const lines = buildKillSequenceBlock({
    matchStartMs: 0,
    matchEndSeconds: DEATH_T + 5, // < 90, so the KILL SEQUENCE branch fires
    owner: dyingUnit,
    friends: [dyingUnit],
    enemies: [],
    ownerCDs: [cd],
    teammateCDs: [],
    enemyCDTimeline: { alignedBurstWindows: [], players: [] } as any,
    ccTrinketSummaries: [],
    friendlyDeaths: [
      { spec: "Restoration Druid", name: "Player1", atSeconds: DEATH_T },
    ],
    enemyDeaths: [],
    isHealer: false,
    pid: (n) => n,
    actorLabel: (n) => n,
  });
  return lines.some(
    (l) => l.includes("[DEFENSIVE AVAILABLE]") && l.includes(SPELL_NAME),
  );
}

/** Whether the death-unused-defensive candidate lists Ironbark under walls. */
function candidateFlagsUnused(cd: IMajorCooldownInfo): boolean {
  const events = deathUnusedDefensiveEvents(
    {
      deathT: DEATH_T,
      victim: { id: "Player1", name: "Player1" },
      victimCC: { ccInstances: [], trinketUseTimes: [] },
      victimCDs: [cd],
    },
    { isOwner: true },
  );
  if (events.length === 0) return false;
  return String(events[0].facts.walls).includes(SPELL_NAME);
}

/** Whether the "spentAtEnd" of matchNarrative's buildMatchFlow lists Ironbark
 * under "on cooldown". */
function matchFlowFlagsSpent(cd: IMajorCooldownInfo): boolean {
  const lines = buildMatchFlow(
    {
      alignedBurstWindows: [
        { fromSeconds: 0, toSeconds: 1, activeCDs: [], dangerLabel: "Low" },
      ],
      players: [],
    } as any,
    [cd],
    [],
    [{ spec: "Restoration Druid", atSeconds: DEATH_T }],
    DEATH_T + 5,
  );
  return lines.some((l) => l.includes("on cooldown") && l.includes(SPELL_NAME));
}

describe("cdAvailableAt 消费点防漂移一致性(BACKLOG #18 Minor #3 + 追加轮)", () => {
  const cases: Array<{ label: string; cd: IMajorCooldownInfo }> = [
    { label: "从未使用 → 全程可用", cd: makeCd([], 60) },
    { label: "刚用过、CD 未转好 → 不可用", cd: makeCd([10], 60) },
    { label: "用过、CD 已转好 → 可用", cd: makeCd([5], 5) },
    {
      label: "两次施放取死亡前最近一次、仍在冷却 → 不可用",
      cd: makeCd([1, 12], 60),
    },
    // GH #61 (2026-09-02): the press 0.3 s AFTER the death sits in the same
    // rendered second, and the [RES] ledger lists it on cd: — every consumer
    // must call it "pressed" too (CD_INSTANT_SLACK_S), or the prompt
    // contradicts itself one line apart. 0.6 s after is the next second.
    {
      label: "施放落在死亡后 0.3s(同一渲染秒)→ 已按下,不可用(GH #61)",
      cd: makeCd([DEATH_T + 0.3], 60),
    },
    {
      label: "施放落在死亡后 0.6s(下一渲染秒)→ 可用",
      cd: makeCd([DEATH_T + 0.6], 60),
    },
  ];

  it("GH #61 容差方向钉死:0.3s 后不可用、0.6s 后可用", () => {
    expect(cdAvailableAt(makeCd([DEATH_T + 0.3], 60), DEATH_T)).toBe(false);
    expect(cdAvailableAt(makeCd([DEATH_T + 0.6], 60), DEATH_T)).toBe(true);
  });

  it.each(cases)("$label", ({ cd }) => {
    const expected = cdAvailableAt(cd, DEATH_T);
    expect(deathSectionFlagsUnused(cd)).toBe(expected);
    expect(killSeqFlagsAvailable(cd)).toBe(expected);
    expect(candidateFlagsUnused(cd)).toBe(expected);


    expect(matchFlowFlagsSpent(cd)).toBe(!expected);
  });
});

/**
 * 自施放空操作的外减(牺牲祝福:30% 伤害转给施法者本人)绝不能出现在
 * 「你死时还没交的减伤」清单里 —— 对自己放它救不了自己。两条消费路径
 * (prompt 死亡行、death-unused-defensive finding)共用
 * SELF_CAST_NOOP_EXTERNAL_IDS 这一个 set;此测试同时钉住两边,漏改一边即红。
 * 基线:本机 80 场里带 Unused 清单的死亡行 9 条,其中 4 条含牺牲祝福。
 */
describe("死亡未用清单:自施放空操作的外减不算本人的减伤", () => {
  const bos = (): IMajorCooldownInfo => ({
    spellId: "6940",
    spellName: "Blessing of Sacrifice",
    tag: "Defensive",
    cooldownSeconds: 120,
    maxChargesDetected: 1,
    casts: [], // 全程可用
    availableWindows: [],
    neverUsed: true,
  });

  it("prompt 死亡行不列牺牲祝福", () => {
    const dyingUnit = makeUnit("Player1", {
      name: "Player1",
      spec: CombatUnitSpec.Paladin_Holy,
      reaction: CombatUnitReaction.Friendly,
    });
    const lines: string[] = [];
    emitFriendlyDeathEntries<never>({
      friendlyDeaths: [
        { spec: "Holy Paladin", name: "Player1", atSeconds: DEATH_T },
      ],
      unitsByName: new Map([["Player1", dyingUnit]]),
      ccTrinketSummaries: [],
      owner: dyingUnit,
      ownerCDs: [bos()],
      teammateCDs: [],
      matchStartMs: 0,
      pid: (n) => n,
      requestSnapshotPlaceholder: () => "SNAPSHOT" as never,
      addEntry: (_t, ...ls) => {
        for (const l of ls) if (typeof l === "string") lines.push(l);
      },
    });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).not.toContain("Blessing of Sacrifice");
    // 阴性对照:同样全程可用的 Ironbark(非转移型)仍要被列出
    expect(deathSectionFlagsUnused(makeCd([], 60))).toBe(true);
  });

  it("death-unused-defensive finding 不列牺牲祝福", () => {
    const events = deathUnusedDefensiveEvents(
      {
        deathT: DEATH_T,
        victim: { id: "Player1", name: "Player1" },
        victimCC: { ccInstances: [], trinketUseTimes: [] },
        victimCDs: [bos()],
      } as any,
      { isOwner: true },
    );
    // 只有牺牲祝福一个候选 → 过滤后无墙可列,整条 finding 不出面
    expect(events).toHaveLength(0);
    // 阴性对照
    expect(candidateFlagsUnused(makeCd([], 60))).toBe(true);
  });
});

// @vitest-environment jsdom
import {
  analyzePlayerCCAndTrinket,
  buildWindowPack,
  ensureAnalysisData,
  extractCandidateFindings,
  reconstructDispelSummary,
  reconstructEnemyCDTimeline,
} from "@gladlog/analysis";
import {
  setCombatMemoEnabledForTest,
  setSharedReadingsFrozenForTest,
} from "@gladlog/analysis/src/utils/combatMemo";
import { CombatUnitReaction } from "@gladlog/parser-compat";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { MatchReport } from "../src/renderer/src/report/components/MatchReport";
import {
  buildAnalysisInput,
  resolveOwner,
} from "../src/renderer/src/report/derive/analysisInput";
import { toLegacySafe } from "../src/renderer/src/report/derive/legacySource";
import type { StoredMatch } from "../src/renderer/src/report/derive/types";
import {
  deriveUncoveredHighlights,
  SWEEP_STRIDE_S,
  SWEEP_WINDOW_S,
} from "../src/renderer/src/report/derive/uncoveredHighlights";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const sidesOf = (legacy: ReturnType<typeof toLegacySafe>) => {
  const units = Object.values(legacy.units);
  const players = units.filter((u) => u.info);
  const friends = players.filter(
    (u) => u.reaction === CombatUnitReaction.Friendly,
  );
  const enemies = players.filter(
    (u) => u.reaction !== CombatUnitReaction.Friendly,
  );
  const petsOf = (side: typeof players) => {
    const ids = new Set(side.map((u) => u.id));
    return units.filter((u) => u.ownerId && ids.has(u.ownerId));
  };
  return {
    friends,
    enemies,
    friendlyPets: petsOf(friends),
    enemyPets: petsOf(enemies),
  };
};

/** Everything the AI view computes on first entry, as plain data: the prompt
 * input, the uncovered-highlights sweep, and the pack of every sweep window
 * (anchors empty, so no window is skipped). */
function aiViewFirstEntry(source: StoredMatch) {
  const durationS = (source.endTime - source.startTime) / 1000;
  const legacy = toLegacySafe(source);
  const owner = resolveOwner(legacy)!;
  const candidates = extractCandidateFindings(legacy, owner.id, undefined);
  const packs: unknown[] = [];
  for (let fromS = 0; fromS < durationS; fromS += SWEEP_STRIDE_S)
    packs.push(
      buildWindowPack(
        legacy,
        fromS,
        Math.min(fromS + SWEEP_WINDOW_S, durationS),
        candidates,
        owner.name,
      ),
    );
  return JSON.parse(
    JSON.stringify({
      input: buildAnalysisInput(source, "m"),
      highlights: deriveUncoveredHighlights(source, durationS, []),
      packs,
    }),
  ) as { packs: unknown[]; input: { richContext: string } };
}

// T81 attempt 2: three whole-round readings (each unit's CC / trinket
// summary, the enemy cooldown timeline, the dispel summary) and the deep-dive
// pack's own readings are computed once per round object and shared by every
// asker. Performance only. What that rests on is checked here on the real
// fixture: with every shared result frozen all the way down — a reader that
// writes to one throws — the AI view's first entry and the whole report
// render come out as they do with nothing shared.
describe("整局读数每回合只算一次 —— 共享的结果只读,输出与逐次现算相等(真实 fixture)", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });
  afterEach(() => {
    setCombatMemoEnabledForTest(true);
    setSharedReadingsFrozenForTest(false);
    cleanup();
  });

  it("AI 视图首次进入:prompt 输入、未覆盖片段、每个窗口的证据包", () => {
    setSharedReadingsFrozenForTest(true);
    const shared = aiViewFirstEntry(loadRealMatchFixture());
    setCombatMemoEnabledForTest(false);
    const computed = aiViewFirstEntry(loadRealMatchFixture());
    expect(shared.packs.filter((p) => p !== null).length).toBeGreaterThan(0);
    expect(shared.input.richContext.length).toBeGreaterThan(1000);
    expect(shared).toEqual(computed);
  }, 120_000);

  it("整份战报渲染:冻结共享结果后的 DOM 与不共享时逐字符相同", () => {
    const html = () => {
      const { container } = render(
        <MatchReport source={loadRealMatchFixture()} matchId="m" />,
      );
      const out = container.innerHTML;
      cleanup();
      return out;
    };
    setSharedReadingsFrozenForTest(true);
    const shared = html();
    setCombatMemoEnabledForTest(false);
    const computed = html();
    expect(shared.length).toBeGreaterThan(10_000);
    expect(shared).toBe(computed);
  }, 120_000);

  it("同一回合对象、同一组参数第二次拿到同一个对象;参数对象换了、回合被原地改了就重算", () => {
    const legacy = toLegacySafe(loadRealMatchFixture());
    const { friends, enemies, friendlyPets, enemyPets } = sidesOf(legacy);
    const cc = analyzePlayerCCAndTrinket(
      friends[0]!,
      enemies,
      legacy,
      enemyPets,
    );
    // filter() builds fresh arrays over the same units: still one entry
    const again = sidesOf(legacy);
    expect(
      analyzePlayerCCAndTrinket(
        again.friends[0]!,
        again.enemies,
        legacy,
        again.enemyPets,
      ),
    ).toBe(cc);
    // another unit, the other side, another cast-failed list: other entries
    expect(
      analyzePlayerCCAndTrinket(friends[1]!, enemies, legacy, enemyPets),
    ).not.toBe(cc);
    expect(
      analyzePlayerCCAndTrinket(friends[0]!, enemies, legacy, enemyPets, []),
    ).not.toBe(cc);

    const tl = reconstructEnemyCDTimeline(enemies, legacy);
    expect(reconstructEnemyCDTimeline(enemies, legacy)).toBe(tl);
    expect(reconstructEnemyCDTimeline(friends, legacy)).not.toBe(tl);
    expect(
      reconstructEnemyCDTimeline(enemies, legacy, friends[0], friends),
    ).not.toBe(tl);

    // the dispel summary: shared rows, but each caller its own missed-purge
    // rows (`annotateMissedPurgesWithKillWindows` writes onto them)
    const dispels = () =>
      reconstructDispelSummary(
        friends,
        enemies,
        legacy,
        friendlyPets,
        enemyPets,
      );
    const ds = dispels();
    const ds2 = dispels();
    expect(ds2.allyCleanse).toBe(ds.allyCleanse);
    expect(ds2.ccEfficiency).toBe(ds.ccEfficiency);
    expect(ds2.missedPurgeWindows).toEqual(ds.missedPurgeWindows);
    expect(ds2.missedPurgeWindows).not.toBe(ds.missedPurgeWindows);
    for (const w of ds.missedPurgeWindows) w.duringKillWindow = true;
    expect(
      dispels().missedPurgeWindows.some((w) => "duringKillWindow" in w),
    ).toBe(false);

    // the round edited in place: an enemy loses its aura rows
    const edited = enemies.find((u) => u.auraEvents.length > 0)!;
    edited.auraEvents.length = 0;
    const cc2 = analyzePlayerCCAndTrinket(
      friends[0]!,
      enemies,
      legacy,
      enemyPets,
    );
    expect(cc2).not.toBe(cc);
    setCombatMemoEnabledForTest(false);
    expect(cc2).toEqual(
      analyzePlayerCCAndTrinket(friends[0]!, enemies, legacy, enemyPets),
    );
  });
});

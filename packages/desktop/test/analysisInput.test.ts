import { ensureAnalysisData } from "@gladlog/analysis";
import { CJK_LEAK } from "@gladlog/analysis/src/utils/localizedText";
import { CombatUnitReaction, type ICombatUnit } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  buildAnalysisInput,
  buildDeepenPacks,
  buildWindowAnalysisRequest,
  resolveOwner,
} from "../src/renderer/src/report/derive/analysisInput";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

const m = loadRealMatchFixture();

beforeAll(async () => {
  // Precondition contract for the driver/panel: the tables must be ready
  // before building (spell names in the prompt may never degrade)
  await ensureAnalysisData();
});

describe("buildAnalysisInput(panel 与批量共享的输入构建)", () => {
  it("真 fixture 构建成功:owner 解析、candidates、richContext、spec 齐全", () => {
    const input = buildAnalysisInput(m, "fix-1");
    expect(input).not.toBeNull();
    expect(input!.matchId).toBe("fix-1");
    expect(Array.isArray(input!.candidates)).toBe(true);
    expect(input!.richContext.length).toBeGreaterThan(0);
    expect(input!.spec.length).toBeGreaterThan(0);
    expect(input!.ownerName.length).toBeGreaterThan(0);
    expect(input!.enemySpecs.length).toBeGreaterThan(0);
  });

  it("坏 source 不抛,返回 null(批量循环据此计 failed 不中断)", () => {
    expect(
      buildAnalysisInput({ units: null } as unknown as typeof m, "bad"),
    ).toBeNull();
  });

  it("buildDeepenPacks 对空 findings 返回空数组且不抛", () => {
    const input = buildAnalysisInput(m, "fix-1")!;
    expect(buildDeepenPacks(m, [], input.candidates, input.ownerName)).toEqual(
      [],
    );
  });
});

describe("pack 的 chip label 跟随传入的语言(spec §6.5)", () => {
  it("选段请求:zh 带「敌 …」,en 无中文", () => {
    const zh = buildWindowAnalysisRequest(m, 0, 90)!;
    const en = buildWindowAnalysisRequest(m, 0, 90, "en")!;
    expect(zh.pack.items.some((i) => i.label.startsWith("敌 "))).toBe(true);
    expect(en.pack.items.filter((i) => CJK_LEAK.test(i.label))).toEqual([]);
    expect(en.pack.facts).toEqual(zh.pack.facts);
  });
});

/**
 * `resolveOwner`'s own fixture-level truth table (Task 6 review round 1,
 * 2026-08-15, task-6-review.md Important #2). This function had no direct
 * unit test before this — only exercised indirectly through
 * `buildAnalysisInput`'s real-fixture test above. `packages/eval/src/
 * explore/candidateCalibration.ts`'s `ownerResolvable` (`storeAccess.ts`'s
 * `splitTeams().owner`) is an independently hand-written MIRROR of this
 * function — `packages/eval` cannot import this file (it pulls in
 * `rawStreamsCache.ts`'s `bridge` import, an Electron-renderer
 * `window.gladlog` dependency with no place in a Node vitest run), so a
 * true shared export is not possible without either adding a
 * `packages/eval`→`packages/desktop` dependency edge (against this repo's
 * "eval never imports desktop" convention) or relocating `resolveOwner` out
 * of the renderer tree (a larger refactor, not attempted here). Per
 * CLAUDE.md's shared-predicate rule fallback, this exact table of cases is
 * mirrored in `packages/eval/test/explore.candidateCalibration.test.ts`'s
 * `describe("ownerResolvable parity vs resolveOwner's own truth table")`
 * block — both files must be updated together if this function's branch
 * structure ever changes. Registered in `docs/predicate-index.md`'s "Not
 * yet unified" section.
 */
describe("resolveOwner", () => {
  function u(overrides: Partial<ICombatUnit> = {}): ICombatUnit {
    return {
      id: overrides.id ?? "u1",
      name: overrides.name ?? "Unit-Realm",
      info: overrides.info ?? ({} as never),
      reaction: overrides.reaction ?? CombatUnitReaction.Friendly,
      spec: overrides.spec ?? ("0" as never),
      ...overrides,
    } as unknown as ICombatUnit;
  }

  it("① playerId 命中一个友方玩家 → 返回该玩家(不看是不是治疗)", () => {
    const legacy = {
      units: {
        p1: u({ id: "p1", reaction: CombatUnitReaction.Friendly }),
        e1: u({
          id: "e1",
          reaction: CombatUnitReaction.Hostile,
          spec: "257" as never,
        }),
      },
      playerId: "p1",
    };
    expect(resolveOwner(legacy)?.id).toBe("p1");
  });

  it("② playerId 不命中任何人,但存在友方治疗 → 回退到治疗", () => {
    const legacy = {
      units: {
        p1: u({ id: "p1", reaction: CombatUnitReaction.Friendly }),
        heal: u({
          id: "heal",
          reaction: CombatUnitReaction.Friendly,
          spec: "257" as never, // Priest_Holy
        }),
      },
      playerId: "no-such-id",
    };
    expect(resolveOwner(legacy)?.id).toBe("heal");
  });

  it("③ playerId 命中的是敌方单位(id 巧合)→ 不算数,回退到友方治疗", () => {
    const legacy = {
      units: {
        p1: u({ id: "p1", reaction: CombatUnitReaction.Hostile }),
        heal: u({
          id: "heal",
          reaction: CombatUnitReaction.Friendly,
          spec: "257" as never,
        }),
      },
      playerId: "p1",
    };
    expect(resolveOwner(legacy)?.id).toBe("heal");
  });

  it("④ playerId 命中的友方单位没有 info(非玩家,如宠物)→ 不算数,回退到友方治疗", () => {
    const legacy = {
      units: {
        pet: u({
          id: "pet",
          reaction: CombatUnitReaction.Friendly,
          info: undefined as never,
        }),
        heal: u({
          id: "heal",
          reaction: CombatUnitReaction.Friendly,
          spec: "257" as never,
        }),
      },
      playerId: "pet",
    };
    expect(resolveOwner(legacy)?.id).toBe("heal");
  });

  it("⑤ playerId 不命中,且没有任何友方治疗 → undefined", () => {
    const legacy = {
      units: {
        p1: u({ id: "p1", reaction: CombatUnitReaction.Friendly }),
        e1: u({
          id: "e1",
          reaction: CombatUnitReaction.Hostile,
          spec: "257" as never,
        }),
      },
      playerId: "no-such-id",
    };
    expect(resolveOwner(legacy)).toBeUndefined();
  });
});
